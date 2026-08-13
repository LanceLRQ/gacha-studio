/**
 * 鸣潮插件的逃生舱 hooks。
 *
 * 只实现 `deriveRecordKeys` 一个 hook——`resolveTimezone` 缺少
 * svr_id/svr_area 到 UTC 偏移量的真实映射表，`countDraws` 不需要（鸣潮
 * `drawCounting` 未声明，走默认 `perRecord`），见 `./manifest.ts` 对应字段
 * 旁的注释。
 *
 * ## 为什么必须是批处理版本（`deriveRecordKeys`），不能用 `deriveRecordKey`
 *
 * 鸣潮响应记录没有任何形式的稳定 ID（见 `./manifest.ts` 的
 * `fields.extractRecord` 注释），`record_key` 策略是
 * `hash(时间 + 物品 + 同批次内序位)`——"同批次内序位"这个信息**结构上只有
 * 同时看到"这一批里的其余记录"才算得出来**，单记录签名
 * `(record) => string` 做不到，因此必须用批处理版本。
 *
 * ## 真实存档实测的两个百分比（不要混用）
 *
 * `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §一对 3371 条真实记录按
 * `(卡池, 时间, 物品)` 分组统计出两个不同含义的百分比，行文时必须分清楚
 * 指的是哪一个：
 * - **32.60%（1099/3371）**——key 的正确性**依赖序位**的记录比例（碰撞组
 *   全部成员：组内只要有 ≥2 条记录，整组都算在内，因为组内任何一条的 key
 *   是否正确都取决于序位算得对不对）。
 * - **17.53%（591/3371）**——不用序位、只按 `(卡池, 时间, 物品)` 三元组算
 *   key 时，会被 `INSERT OR IGNORE` **静默丢弃**的记录比例（每个碰撞组里
 *   "抢到"三元组 key 的那一条能活下来，组内其余成员全部撞键丢失）。
 *
 * 碰撞组共 508 组。508 个碰撞组内**逐字段完全相同**（同一个 `(卡池, 秒)`
 * 内的十连批次天然如此）——鸣潮 API 不分页、一次返回整池全量，这是本文件
 * 两个设计难点（方向、序位安全性）唯一的容错来源，下面逐一说明。
 *
 * ## 设计难点一：数组方向不可信，必须归一化
 *
 * 参考实现 `UpdateGachaDataDialogViewModel.cs` 里 `apiData.Data.Reverse()`
 * 证实：API 响应本身是**倒序**（最新的记录排最前面），参考实现拿到响应后
 * 整体反转一次才使用。`extractList`（见 `./manifest.ts`）不改变数组顺序，
 * 原样把这个倒序数组交给 `fields.extractRecord`，再交给本文件的
 * `deriveRecordKeys`——也就是说，本 hook 拿到的记录顺序**继承自 API 的
 * 真实返回顺序，方向不由插件自己控制**。
 *
 * 若序位直接按输入数组下标计算，而两次采集之间数组方向发生变化（例如未来
 * 有代码在 `extractList` 与本 hook 之间插入了一次反转、或 API 本身的排序
 * 约定发生变化），同一批记录会算出不同的序位，`record_key` 就会漂移
 * ——这正是 `PluginHooks.deriveRecordKeys` 幂等性要求（"同一条实际记录，
 * 任意时间任意次采集都必须产出相同的 key"）会被打破的地方。
 *
 * **解决方案：显式归一化，不假设方向不变。** 比较数组首尾两条记录的时间，
 * 若首 > 尾（倒序），先把整个数组反转成"旧→新"的正序再计算序位；若首 <=
 * 尾（已经是正序，或数组长度 <= 1 无法判断方向），按原样处理。这个归一化
 * 之所以正确、且不需要对"组内顺序是否也被正确还原"另作证明：API 响应是对
 * **整个数组**做一次单一方向的排序（不是"组间倒序、组内另有独立顺序"），
 * `apiData.Data.Reverse()` 证实参考实现处理的是对整个数组的整体反转——
 * 整体反转是自身的逆操作，比较首尾判断方向后按需整体反转一次，得到的正序
 * 数组与"API 一开始就返回正序"时逐位置完全一致，包括组内成员的相对顺序。
 *
 * 归一化之后再按（现已保证是正序的）数组下标顺序给每个 `(bannerId, time)`
 * 分组内的记录编号，最后把算出的 key 写回**原始输入下标**对应的位置——
 * 返回值必须与输入 `records` 逐位置对应，这是 `PluginHooks.deriveRecordKeys`
 * 的契约（"返回值必须与输入等长、按输入顺序一一对应"）。
 *
 * ## 设计难点二：API 响应线格式未经抓包验证，key 不能直接哈希原始字符串
 *
 * 参考实现反序列化 API 响应时，`Models/GachaData.cs` 的 `Time` 字段是强
 * 类型 `DateTime`——线格式在反序列化那一步就被语言运行时吃掉了，源码里看
 * 不出 API 到底发的是 `2024-06-06T10:23:48`（ISO）还是
 * `2024/06/06 10:23:48`（斜杠）还是别的写法；本地存档里出现的 ISO 格式是
 * Newtonsoft 序列化 `DateTime` 的默认产物，不代表 API 响应本身的线格式；
 * `DateFormatString = "yyyy/MM/dd hh:mm:ss"` 只在反序列化路径上生效的证据
 * 很弱，不足以定论；本仓库没有鸣潮 API 的真实抓包样本能验证。
 *
 * 若 `deriveRecordKeys` 直接把 `record.time` 原始字符串拼进哈希输入，一旦
 * 线格式猜错——或者日后 API 换了个分隔符——所有 key 都会与预期不同：不会
 * 报错，只会静默重复入库，或者让已入库的 key 与新采集算出的 key 对不上，
 * 与 HoYo.Gacha 因为 `record_key` 设计不到位付出过一次整表重建迁移是同一类
 * 代价。
 *
 * **解决方案：先把 `time` 规范化成与线格式无关的形式，再参与哈希**，见下方
 * `normalizeTimeForKey`。
 */
import type { PluginHooks, UnifiedRecordFields } from "gs-plugin-kit";

/**
 * 把 API 响应的 `time` 字段规范化成与线格式无关、可直接按字符串比较大小的
 * 形式（`YYYYMMDDHHmmss`，14 位纯数字）。
 *
 * `2024-06-06T10:23:48` 与 `2024/06/06 10:23:48` 归一后都是
 * `"20240606102348"`——用正则拆出年/月/日/时/分/秒六个数字分量再拼接，
 * 分隔符本身（`-`/`/`/`T`/空格）被正则直接吃掉、不影响归一化结果。
 *
 * ⚠️ **不用 `new Date(...)` 解析**：`Date` 构造函数对不带时区后缀的字符串
 * 按*运行环境本地时区*解释，同一个字符串在不同机器/不同时区上跑出的
 * `Date` 对象代表的绝对时刻不同——这与"纯函数、结果只取决于输入"这条硬
 * 约束直接冲突（`PluginHooks.deriveRecordKeys` 必须是纯函数，TS 运行环境
 * 物理上也不提供能替代 `Date` 本地时区行为的时区数据库）。改用正则直接拆
 * 数字分量，不经过 `Date`，规范化结果与运行环境无关。
 *
 * ⚠️ **无法识别的格式必须报错，不能静默回落到原始字符串**：静默回落等于
 * "先归一化再哈希"这层保护完全不存在——本项目已经多次抓到"看起来有防护、
 * 实际什么都没做"这一类失效模式，这里不能重蹈。
 *
 * 目前只认两种已知候选格式（ISO 的 `-`/`T` 分隔、参考实现暗示的 `/`/空格
 * 分隔）；若未来真实抓包发现第三种格式，这里需要同步扩展正则，而不是放宽
 * 到"随便什么都收"。
 */
function normalizeTimeForKey(time: string): string {
  const match = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    throw new Error(
      `鸣潮 deriveRecordKeys：无法识别的时间格式 "${time}"——线格式未经抓包验证，拒绝在猜测的格式上计算 record_key`,
    );
  }
  const [, year, month, day, hour, minute, second] = match;
  return `${year}${month}${day}${hour}${minute}${second}`;
}

/**
 * FNV-1a 32 位哈希，纯位运算实现，不依赖任何 Node/Web 加密 API——TS 侧运行
 * 环境物理上不提供 `crypto`，插件代码只能用语言内置能力（`charCodeAt`/
 * `Math.imul`/移位运算，ES2022 标准 JS，任何遵循规范的引擎都能跑，包括宿主
 * 内嵌的 QuickJS）。
 *
 * 只对 ASCII 字符正确：本文件唯一的调用点传入的是
 * `JSON.stringify([bannerId, normalizedTime, itemId, seqInGroup])`，四个
 * 分量分别是纯数字字符串（PoolType id、`normalizeTimeForKey` 的输出、
 * `resourceId` 转的字符串、批次内序位）加 JSON 本身的标点，逐字符都在
 * ASCII 范围内，`charCodeAt` 与字节值一一对应，不需要处理多字节字符。
 */
function fnv1a32(input: string, offsetBasis: number): string {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 标准 FNV-1a 32 位偏移基准。 */
const FNV_OFFSET_BASIS_A = 0x811c9dc5;
/**
 * 第二个偏移基准，只要求与 A 不同——用来把两次独立的 32 位哈希拼成一个
 * 16 位十六进制（64 位）的复合 key，降低单独一个 32 位哈希在几千条记录
 * 规模下的生日碰撞概率（`sqrt(2^32) ≈ 65536`，一个账号的记录数量级已经
 * 够不上放心只用 32 位）。取值本身没有特殊含义，只要求是一个与 A 不同的
 * 固定常量。
 */
const FNV_OFFSET_BASIS_B = 0x9e3779b9;

/**
 * 计算单条记录的 `record_key`。
 *
 * 用 `JSON.stringify` 把四个分量序列化成一个数组字符串，而不是用分隔符
 * （如 `:`）手工拼接——`normalizedTime` 内部全是数字没有歧义，但 JSON 的
 * 转义规则能保证"不同的输入元组不会拼出同一个字符串"这条性质在任何未来
 * 分量类型变化时依然成立，比手工挑一个"看起来不会出现在字段里"的分隔符
 * 更可靠。
 */
function hashRecordKey(bannerId: string, normalizedTime: string, itemId: string, seqInGroup: number): string {
  const canonical = JSON.stringify([bannerId, normalizedTime, itemId, seqInGroup]);
  return `${fnv1a32(canonical, FNV_OFFSET_BASIS_A)}${fnv1a32(canonical, FNV_OFFSET_BASIS_B)}`;
}

export const hooks: PluginHooks = {
  deriveRecordKeys: (records: UnifiedRecordFields[]): string[] => {
    const total = records.length;
    if (total === 0) return [];

    // 时间线格式无关：先统一规范化，出现无法识别的格式立刻报错（见
    // normalizeTimeForKey 文档），不允许某一条记录悄悄用原始字符串参与哈希。
    const normalizedTimes = records.map((record) => normalizeTimeForKey(record.time));

    // 方向归一化：比较首尾两条记录的规范化时间。首 > 尾说明数组是倒序
    // （API 真实返回的顺序，参考实现用 apiData.Data.Reverse() 处理），需要
    // 按"原始输入下标"到"正序遍历顺序"建立一份映射；否则（已经是正序，或
    // 长度 <= 1 无法判断方向）直接按原始下标遍历。见文件头部"设计难点一"。
    //
    // 下标访问在 noUncheckedIndexedAccess 下类型是 `string | undefined`——
    // 这里不用非空断言/类型转换假装"肯定不会错"，而是显式判空后抛内部错误
    // （与 packages/gs-plugin-kit/testkit/index.ts 处理同类情形的写法一致），
    // 理论上不会触发：firstTime/lastTime 的下标恒在 [0, total) 内。
    const firstTime = normalizedTimes[0];
    const lastTime = normalizedTimes[total - 1];
    if (firstTime === undefined || lastTime === undefined) {
      throw new Error("鸣潮 deriveRecordKeys 内部错误：无法取到首/尾记录的规范化时间");
    }
    const isDescending = total > 1 && firstTime > lastTime;

    const ascendingOrder: number[] = new Array(total);
    for (let i = 0; i < total; i += 1) {
      ascendingOrder[i] = isDescending ? total - 1 - i : i;
    }

    // 按（已保证正序的）遍历顺序，对每个 (bannerId, 规范化时间) 分组内的
    // 记录编号，编号即"批次内序位"；算出的 key 写回原始输入下标对应的位置。
    const seqByGroup = new Map<string, number>();
    const keys = new Array<string>(total);
    for (const originalIndex of ascendingOrder) {
      const record = records[originalIndex];
      const normalizedTime = normalizedTimes[originalIndex];
      if (record === undefined || normalizedTime === undefined) {
        // 不应发生：originalIndex 由上面的循环生成，取值范围恒在 [0, total)。
        throw new Error(`鸣潮 deriveRecordKeys 内部错误：下标 ${originalIndex} 处的记录或规范化时间缺失`);
      }
      // ★ 分组键必须包含 itemId，不能只按 (bannerId, 时间) 分组。
      //
      // 序位存在的唯一目的，是区分**逐字段完全相同、否则无法区分**的记录。
      // 真实存档实测（`AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §一）里同秒
      // 碰撞组共 508 组、组内记录逐字段全等；该审计 §1.7 ③ 给出的安全性论证
      // 也正是「组内记录逐字段完全相同 → 交换它们产出的 key 多重集不变」。
      // 这条论证成立的前提，是分组按**全等字段**划分。
      //
      // 若分组键漏掉 itemId，一次十连（10 条同秒、但物品各不相同的记录）会被
      // 塞进同一组拿到序位 0~9，于是每条记录的 key 都取决于它在数组里的位置。
      // 后果已在全量真实数据（3371 条）上实测：
      //   - 方向违例 10 条——PoolType=12 整批共用同一个时间戳，首尾相等，
      //     上面那套"比较首尾判方向"的逻辑失效，正序/倒序喂入产出两套 key；
      //   - **增长稳定性违例 20 条**——这条才真正会伤到用户：整池全量拉取下，
      //     后一次采集必然比前一次记录更多，一旦记录变多让方向判定从"判不出"
      //     翻转成"判得出"，早先那批记录的序位会整体反转、key 全变，于是被
      //     当成新记录**重复入库**。
      // 把 itemId 并进分组键后，上述两项实测分别降为 2 与 0；剩下那 2 条经
      // 核对都是「与另一条逐字段全等」的记录互换了 key——记录本身不可区分，
      // 全部 5 个非空池的 key 多重集均一致，去重结果完全等价。
      //
      // 分隔符用普通空格即可：bannerId 是纯数字 PoolType id，normalizedTime
      // 是 normalizeTimeForKey 产出的 14 位纯数字字符串，itemId 是纯数字
      // resourceId，三者都不可能含空格，不会出现拼接歧义。
      const groupKey = `${record.bannerId} ${normalizedTime} ${record.itemId}`;
      const seqInGroup = seqByGroup.get(groupKey) ?? 0;
      seqByGroup.set(groupKey, seqInGroup + 1);
      keys[originalIndex] = hashRecordKey(record.bannerId, normalizedTime, record.itemId, seqInGroup);
    }

    return keys;
  },
};
