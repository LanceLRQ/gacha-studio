/**
 * 鸣潮插件 manifest。
 *
 * 本文件由 M2-S1/S2 的纸面填表演练草稿（`drills/wuwa/manifest.ts`）转化而来
 * ——演练验证的是"S2 改过的插件契约类型是否装得下鸣潮的真实差异点"，本文件
 * 是把验证结论落地成真正接入 `plugins/index.ts` 的可运行插件。转化过程中
 * 删掉了演练文件里大段"为什么当时填不下"的过程性注释（那些空白已经被
 * S2/S3 的契约改动填平，继续保留会误导读者以为字段仍然缺失），只保留仍然
 * 成立的领域知识；已获得真实参数的字段（请求 body 具名占位符、
 * `allowedHosts`、`stopCondition`）按下方注释里的来源重新校准填写。
 *
 * 数据来源（不凭训练记忆编造字段名/数值）：
 * - `docs/example-projects/WWGachaExport/WWGachaExport/Services/ConfigService.cs:29-43`
 *   （13 项 `PoolType` 表，构造函数签名 `GachaPoolInfo(poolType, name, noobPool,
 *   levelFiveMaxDraw, levelFourMaxDraw, inherit = true)`，本文件实现前已逐行核对源码原文）
 * - `docs/example-projects/WWGachaExport/WWGachaExport/ViewModels/Dialogs/UpdateGachaDataDialogViewModel.cs`
 *   （日志路径拼接、异或解混淆参数、query 参数 → POST body 字段映射、
 *   `cardPoolType`/`playerId` 的 C# 类型、User-Agent、请求 host 二选一逻辑、
 *   `apiData.Data.Reverse()` 的调用位置，本文件实现前已逐行核对源码原文）
 * - `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮真实存档实测.md`（3371 条
 *   真实存档的字段类型统计、`record_key` 碰撞率实测、保底间隔与逐抽命中率）
 * - `packages/gs-plugin-kit/manifest.ts`、`packages/gs-plugin-kit/types/generated.ts`
 *   （S3 之后的契约类型：具名占位符 `{{credential.<queryParam>}}`、
 *   `RequestTemplate.method`/`headers`/`body`、`StopCondition.singleRequest`）
 * - `crates/paradigms/gs-p-authkey/src/pipeline.rs`（`RequestTemplateJson` 上方
 *   "已知缺口 C8" 注释：国际服 host 无法从 `svr_area` 推出 TLD，刻意不预放
 *   `.net`；`substitute_named_credential_placeholders` 的三条 fail-closed 规则）
 *
 * 仍未解决、如实标注、不编造的缺口见对应字段旁的注释：4★/多数 5★ 池的渐进
 * 概率精确数值本机样本不足以标定、`resolveTimezone` 缺少 svr_id/svr_area 到
 * UTC 偏移量的真实映射表、联动池的"期次内保底重置"参考实现在真实数据上已
 * 失效因而本插件不实现。
 */
import type { PluginManifest } from "gs-plugin-kit";

// 打包脚本（scripts/gs-bundle-plugins.mjs）从 manifest.ts 这一个入口同时取
// manifest 与 hooks 两个导出，与 plugins/genshin/manifest.ts 的写法一致。
export { hooks } from "./hooks.ts";

/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 响应记录的 `resourceId`/`qualityLevel` 是 JSON number（`Models/GachaAPI.cs`
 * 的 `resourceId: int`、`qualityLevel: int`，且已被
 * `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §2.1 的真实存档字段类型统计
 * 独立证实），与米哈游三游"数字字符串"不同，因此单独一个转换函数。
 */
function numericToString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/**
 * `count: int`（`Models/GachaAPI.cs`，同上已被真实存档统计独立证实恒为同一
 * 整数取值）。防御式转换 + 异常兜底为 1，容忍响应形态与本机核实的样本不完全
 * 一致的情况。
 */
function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

/**
 * 从 `POST gmserver-api.aki-game2.com/gacha/record/query` 响应体取出该
 * PoolType 的全部记录数组。
 *
 * ⚠️ **响应外层信封形态本身研究未覆盖**：`Models/GachaAPI.cs` 给出的是单条
 * 记录的 DTO 字段，没有给出响应外层信封的完整 JSON 形态；本机没有鸣潮 API
 * 的真实抓包样本。这里防御式兼容米哈游三游同族插件常见的两种信封
 * （`{ data: [...] }` 与 `{ data: { list: [...] } }`），两者都是**类比**，
 * 不是已核实事实，任何一层形状不对就返回空数组而不是抛异常——分页引擎会把
 * 空数组当作终止条件处理，比让一次响应形态不符直接中断整条采集流程更安全。
 */
function extractGachaRecordList(response: unknown): unknown[] {
  if (typeof response !== "object" || response === null) return [];
  const data = (response as { data?: unknown }).data;
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    const list = (data as { list?: unknown }).list;
    if (Array.isArray(list)) return list;
  }
  return [];
}

/**
 * 13 项 `PoolType` 表，逐字段取自 `Services/ConfigService.cs:29-43` 原样表格：
 *   `(PoolType, 名称, 是否新手池, 5★硬保底, 4★硬保底, 保底是否继承)`
 *
 * 本表保留真正用得上的三列：id / displayName / hardPity5Star，外加
 * `fiveStarGuaranteeKind`（本插件自行归纳，不在 `ConfigService.cs` 原表里，
 * 见下方单独说明）。4★ 硬保底恒为 10（见下方 `WUWA_4STAR_HARD_PITY`），不再
 * 需要逐行区分。「是否新手池」「保底是否继承」两列目前的插件契约里没有对应
 * 字段可以承载，「是否继承」这一列即使有字段也无法正确实现，见下方
 * `pityGroups` 一节的"已知缺口"说明。
 *
 * `fiveStarGuaranteeKind` 取值依据（`docs/_internal/milestones/
 * 03-M2-鸣潮插件与抽象证伪.md` §4.4："角色池 50/50，武器池必中不歪"）：
 *   - 5 个「角色」池（id 1/3/8/10/12）取 `fiftyFifty`——依据是把 §4.4「角色池
 *     50/50」这条通用结论按「角色卡池」大类应用，不是对常驻/新旅/联动/忆旅
 *     这些子类型逐一单独验证过。
 *   - 5 个「武器」池（id 2/4/9/11/13）取 `alwaysRateUp`——同上，按「武器卡池」
 *     大类应用。
 *
 *   ⚠️ 严格说，只有「角色活动唤取」「武器活动唤取」（id 1/2）这两个子类型
 *   在 §4.4 里有直接对照，其余 8 个是**同类推广**。推广本身是合理的领域推断
 *   （担保规则在鸣潮里按物品大类而非按卡池子类型划分），但它没有逐池实测
 *   背书——若日后某个子类型被发现规则不同，改这一列即可，不必动任何逻辑。
 *   - 3 个「新手」池（id 5/6/7）取 `none`——**没有任何实测依据**，只是沿用
 *     此前用池名字符串匹配时的现状（池名不含"角色"也不含"武器"，匹配不上
 *     任何一支才落到 `none`），逐行标注 `// 无实测依据，沿用现状`。
 *
 * 之前是从 `pool.name` 用 `.includes("角色")`/`.includes("武器")` 现场推导
 * 这个值，这里改成显式列出——显示名是给人看的，不该承担"决定保底语义"这个
 * 职责：改一个字、或出现同时含/都不含这两个词的池名，语义会静默改变；固化
 * 成表格后每一行的取值直接可读，不用跳到别处反推。
 */
const WUWA_POOL_TYPES = [
  { id: "1", name: "角色活动唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "fiftyFifty" },
  { id: "2", name: "武器活动唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "alwaysRateUp" },
  { id: "3", name: "角色常驻唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "fiftyFifty" },
  { id: "4", name: "武器常驻唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "alwaysRateUp" },
  { id: "5", name: "新手唤取", hardPity5Star: 50, fiveStarGuaranteeKind: "none" }, // 无实测依据，沿用现状
  { id: "6", name: "新手自选唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "none" }, // 无实测依据，沿用现状
  { id: "7", name: "新手自选唤取（感恩定向唤取）", hardPity5Star: 1, fiveStarGuaranteeKind: "none" }, // 无实测依据，沿用现状
  { id: "8", name: "角色新旅唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "fiftyFifty" },
  { id: "9", name: "武器新旅唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "alwaysRateUp" },
  { id: "10", name: "角色联动唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "fiftyFifty" },
  { id: "11", name: "武器联动唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "alwaysRateUp" },
  { id: "12", name: "角色忆旅唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "fiftyFifty" },
  { id: "13", name: "武器忆旅唤取", hardPity5Star: 80, fiveStarGuaranteeKind: "alwaysRateUp" },
] as const;

/** 4★ 硬保底，全部 13 项 PoolType 共用同一个值（`ConfigService.cs` 第 5 列恒为 10）。 */
const WUWA_4STAR_HARD_PITY = 10;

/** `fiveStarGuaranteeKind` → 实际 `GuaranteeRule` 字面量对象（P2 表）。 */
const WUWA_FIVE_STAR_GUARANTEE_BY_KIND = {
  fiftyFifty: { kind: "fiftyFifty" as const },
  alwaysRateUp: { kind: "alwaysRateUp" as const },
  none: { kind: "none" as const },
} as const;

/**
 * 从日志行提取 gachaLink 的正则，逐字取自参考实现
 * （`UpdateGachaDataDialogViewModel.cs` 的 `Regex.Match` 调用）：
 *   `(https?.*\/aki\/gacha\/index\.html#\/record[\?=&\w\-]+)`
 *
 * 按行**倒序**扫描、命中第一个即停这件事完全是 Rust L1
 * （`crate::cache_scan`）的实现细节，本正则只声明匹配模式本身，插件侧不需要
 * （也不能）声明扫描方向。
 */
const WUWA_GACHA_LINK_PATTERN = /(https?.*\/aki\/gacha\/index\.html#\/record[\?=&\w\-]+)/;

// ============================================================
// 5★ 渐进概率曲线
// ============================================================
//
// ⚠️ 这两个声明必须放在 `export const manifest` 之前——下面 `manifest.pityGroups`
// 的 `flatMap` 在**模块求值期**就会调用 `fiveStarCurve`，若把
// `WUWA_FIVE_STAR_PROGRESSIVE_CURVE` 声明放在 `manifest` 之后，`const` 不会
// 被提升初始化（暂时性死区），会在求值 `manifest` 时直接抛
// "Cannot access before initialization"。

/**
 * 5★ 渐进概率曲线的**粗粒度近似**，只对硬保底 80 的池子成立
 * （1/2/3/4/6/8/9/10/11/12/13——即除 5、7 之外的全部）。
 *
 * 数值直接取自 `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §3.3（PoolType
 * 1/2/4 合并、按 10 抽分桶的真实命中率，不是逐抽拟合出来的曲线）：
 *   1~60 抽：命中率在 0.5%~1.9% 之间波动，该文档判定为小样本噪声，
 *            六个分桶均值 ≈0.93%，四舍五入取 1% 作为 base
 *   61~70 抽：6.9%（317 个样本、22 次命中）
 *   71~80 抽：48.1%（27 个样本、13 次命中，**置信区间极宽**——样本量小，
 *             这个数字本身就有很大不确定性，不要当成精确值使用）
 *
 * `crates/gs-analysis/src/pity.rs` 的 `evaluate_curve` 对 `Progressive` 的
 * 语义是「`table` 每个元素对应一抽」：`pull_index <= start` 时取 `base`，
 * `pull_index > start` 时取 `table[pull_index - start - 1]`（即 `table[0]`
 * 对应第 `start + 1` 抽），下标越界钳制到最后一个元素——这条曲线现在会被
 * 真实消费，不再是占位声明。按这个语义，下面 20 个元素是把上面两个 10 抽
 * 分桶**逐抽展开**：第 61~70 抽（`table[0..9]`）取 6.9%，第 71~80 抽
 * （`table[10..19]`）取 48.1%。
 *
 * ⚠️ **这是分段常数展开，不是逐抽标定**：桶内每一抽取同一个值是一个显式的
 * 建模选择，信息量与原始分桶数据完全相同，没有凭空编造任何新信息；但真实
 * 曲线在桶内大概率是单调上升的（越接近保底命中率越高），分段常数会让桶的
 * 前几抽概率偏高、后几抽偏低，这是已知的近似误差，不是错误数据。等有逐抽
 * 精细样本（尤其是 71~80 抽这一桶，27 个样本撑不起精确曲线）再替换。
 */
const WUWA_FIVE_STAR_PROGRESSIVE_CURVE = {
  kind: "progressive" as const,
  base: 0.01,
  start: 60,
  // 10 个 6.9%（第 61~70 抽）+ 10 个 48.1%（第 71~80 抽），对应上方注释的
  // 分段常数展开。用 Array.fill 拼接而非手写 20 个字面量，避免数错个数，
  // 也让「10 + 10」这个分桶结构在代码里保持可见。
  table: [...Array(10).fill(0.069), ...Array(10).fill(0.481)],
};

/**
 * 按 PoolType 分派 5★ 曲线。
 *
 * - PoolType 7（新手自选唤取·感谢定向唤取）：硬保底 = 1，数学上直接等价于
 *   "每次唤取都必出 5★"，不是猜测——硬保底数值本身决定的，不依赖任何实测
 *   样本。
 * - PoolType 5（新手唤取，硬保底 50）：真实存档实测该池 **0 条记录**
 *   （`AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §1.2 "空槽位"列出 5 在内），
 *   而 `WUWA_FIVE_STAR_PROGRESSIVE_CURVE` 的曲线形状是从硬保底 80 的三个池
 *   （1/2/4）实测数据里推出的——渐进曲线理应随硬保底位置本身变化（保底 50
 *   的池子不可能在第 60 抽才开始"跃升"，那已经超过硬保底本身），把 80 硬
 *   保底池子的曲线直接套到 50 硬保底的池子上是没有证据支持的外推，因此
 *   本池仍用 custom 占位，不外推。
 * - 其余全部硬保底 80 的池子：共用同一条 `WUWA_FIVE_STAR_PROGRESSIVE_CURVE`
 *   ——只有 1/2/4 三个池有真实样本，其余同硬保底池子没有独立样本，但也没有
 *   任何理由认为它们的曲线形状不同，用同一条曲线是"用仅有的证据一致地应用"，
 *   不是逐池编造出互不相同的数字。
 */
function fiveStarCurve(pool: (typeof WUWA_POOL_TYPES)[number]) {
  if (pool.hardPity5Star === 1) {
    return { kind: "flat" as const, base: 1 };
  }
  if (pool.hardPity5Star !== 80) {
    return { kind: "custom" as const, id: `wuwa-unconfirmed-5star-pool-${pool.id}` };
  }
  return WUWA_FIVE_STAR_PROGRESSIVE_CURVE;
}

export const manifest = {
  id: "wuwa",
  displayName: { "zh-CN": "鸣潮" },
  sdkVersion: "1.0.0",
  platforms: ["windows"],
  maintainers: ["gacha-studio"],
  // exchangeFormats 不声明：鸣潮没有已知的公开标准交换格式（WWGF 之类的说法
  // 未经证实，`research/01` §3.2 已确认参考实现的本地存档是自定义 JSON 结构
  // 而非任何标准格式），声明一个不存在的格式比不声明更有害。

  // 图标地址来自 TapTap 应用市场页面，已实测验证，同 `plugins/genshin/
  // manifest.ts` 同款教训——地址以 .jpg 结尾但实际内容是 PNG，不要"纠正"
  // 扩展名，格式校验（content-type + magic bytes）是宿主侧职责。
  iconUrl:
    "https://img-tc.tapimg.com/market/images/a465e34f0e4afb3631e8ee5b1f02c992.png/_tap_appicon_m.jpg",

  // ============================================================
  // collect：先从 Client.log 拿凭据（gachaLink），再调 record/query 接口
  // ============================================================
  collect: {
    paradigm: "credentialedApi",
    params: {
      credential: {
        kind: "logFile",
        // ⚠️ 相对片段，不是绝对路径——`UpdateGachaDataDialogViewModel.cs:66-67`
        // 显示官方启动器与 WeGame 启动器的日志相对路径不同（官方启动器在游戏
        // 目录下多套一层 "Wuthering Waves Game/"，WeGame 没有这一层）。
        // `logPath` 目前仍是单个字符串字段，装不下两个候选；Rust 侧
        // `locate_log_candidates` 会同时尝试"直接命中"与"恰好一层子目录"两种
        // 候选路径，因此这里**不要**把 "Wuthering Waves Game" 前缀写进来——
        // 写了反而只能匹配官方启动器这一种，Rust 侧的双候选机制就用不上了。
        logPath: "Client/Saved/Logs/Client.log",
        urlPattern: WUWA_GACHA_LINK_PATTERN,
        // 字节级解混淆参数：跳过前 3 字节，此后逐字节按**该字节自身的值**
        // （不是下标）的奇偶分别异或 0xA5/0xEF。源码依据
        // `UpdateGachaDataDialogViewModel.cs` 第 118~123 行：
        //   `byte b = encrypted[i]; if ((b & 1) == 1) b ^= 0xA5; else b ^= 0xEF;`
        // 判据是 b（字节值），循环变量 i 只用于取值和写回，与下标无关——这条
        // 已经被证伪过一次二手转述（`research/01` 原记载鸣潮日志是明文，压根
        // 没描述过解码），因此只认这段源码原文，不认任何转述。
        decode: { kind: "xorByLowBit", skipBytes: 3, maskWhenOdd: 0xa5, maskWhenEven: 0xef },
      },

      // POST + JSON body。字段映射逐字取自
      // `UpdateGachaDataDialogViewModel.cs:163-196`（query 参数解析）与
      // `:239-253`（构造请求体）：
      //   resources_id → cardPoolId    lang      → languageCode
      //   player_id    → playerId      record_id → recordId
      //   svr_id       → serverId      （随卡池变化）→ cardPoolType
      //
      // ⚠️ **引号陷阱，六个字段里两个不能加引号**：`cardPoolId`/`languageCode`/
      // `recordId`/`serverId` 在 C# 里是 `string`，序列化后是 JSON 字符串，
      // body 模板里对应的占位符要加引号；但 `cardPoolType` 直接赋值
      // `gachaPool.PoolType`（`int`），`playerId` 是 `long.Parse(...)` 的结果
      // （`long`）——这两个在 C# 侧都是数值类型，`JsonConvert.SerializeObject`
      // 会把它们序列化成不带引号的 JSON 数字。占位符替换是纯字符串拼接
      // （`crates/paradigms/gs-p-authkey/src/pipeline.rs` 的
      // `substitute_placeholders`），模板里给 `{{gachaType}}`/
      // `{{credential.player_id}}` 套上引号会产出 `"cardPoolType":"1"`——
      // 服务端收到的是字符串 "1" 而不是数字 1，与真实客户端发送的请求形态
      // 不一致，因此下面 body 模板里这两处**故意不加引号**。
      request: {
        url: "https://gmserver-api.aki-game2.com/gacha/record/query",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 参考实现固定附带的 User-Agent（`UpdateGachaDataDialogViewModel.cs`
          // `client.DefaultRequestHeaders.Add("User-Agent", ...)` 调用处，原样抄录）。
          "User-Agent":
            "Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36",
        },
        body:
          '{"cardPoolId":"{{credential.resources_id}}","cardPoolType":{{gachaType}},' +
          '"languageCode":"{{credential.lang}}","playerId":{{credential.player_id}},' +
          '"recordId":"{{credential.record_id}}","serverId":"{{credential.svr_id}}"}',
      },

      // ⚠️ **只放国服 `.com`，刻意不预放国际服 `.net`**：参考实现按凭据
      // `svr_area` 在两个 host 之间二选一（`UpdateGachaDataDialogViewModel.cs`
      // `serverCN ? "....com" : "....net"`），但本项目本机只有国服存档样本，
      // 国际服分支无法验证。`crates/paradigms/gs-p-authkey/src/pipeline.rs`
      // 里 `RequestTemplateJson` 上方的"已知缺口 C8"注释已经把这条钉死：
      // "collect.params.allowedHosts 里同样不预放 .net：预放等于声明一个跑不到
      // 的能力"。预放一个未经验证、当前请求模板也打不到的 host，只会制造一种
      // "看起来支持国际服"的假象。等真的有国际服样本时，需要同时补
      // 请求端点分支机制与这里的白名单，两者缺一不可。
      allowedHosts: ["gmserver-api.aki-game2.com"],

      extractList: extractGachaRecordList,

      // 接口本身不分页，一次请求即拿到该卡池全部记录
      // （`UpdateGachaDataDialogViewModel.cs` 里每个卡池只发一次 POST，没有
      // 任何分页参数）。用缺省的 `emptyPage` 会对同一份全量响应死循环。
      //
      // ⚠️ 这不只是"接口形态如此"这么简单——`hooks.deriveRecordKeys`（见
      // `./hooks.ts`）依赖"每次都是整池全量拉取"这条前提计算批次内序位，
      // 若日后误改成增量/分页采集，序位会在局部集合上计算，
      // `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §1.8 实测的 32.60%
      // （1099/3371，key 正确性依赖序位的记录）会立刻出现 key 漂移。
      stopCondition: { kind: "singleRequest" },

      // 卡池归属以本次查询用的 banner 为准，不信响应——鸣潮响应记录里的
      // `cardPoolType` 是不可还原的中文展示标签（见下方
      // `fields.extractRecord` 里 `bannerId` 字段旁的详细说明），而鸣潮
      // 一次查询只返回一个池的全量记录，不存在混池，因此查询时的 banner
      // 就是唯一权威来源。与原神相反——原神一次查询会混回其它卡池的记录
      // （`fixtures/genshin/raw_response/301_page_1.json` 实测），必须信
      // 响应。完整对照见 `packages/gs-plugin-kit/manifest.ts` 里
      // `CredentialedApiPipelineParams.bannerIdentity` 的文档。
      bannerIdentity: "query",
    },
  },

  // ============================================================
  // fields：响应记录 → 统一字段
  // ============================================================
  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("鸣潮 extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;

      // 响应记录字段（`Models/GachaAPI.cs`）：
      //   cardPoolType: string   resourceId: int      qualityLevel: int
      //   resourceType: string   name: string         count: int
      //   time: DateTime
      // 没有任何形式的记录 ID（无 id/uuid/index），与真实存档实测结论一致
      // （`AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §一）——因此 stableId 不填，
      // `hooks.deriveRecordKeys` 必须实现（见 `./hooks.ts`），不能依赖宿主
      // 兜底用 stableId。
      const itemId = numericToString(record.resourceId);
      if (!itemId) {
        throw new Error("鸣潮 extractRecord：记录缺少 resourceId，无法确定 itemId");
      }

      return {
        itemId,
        time: toNonEmptyString(record.time) ?? "",
        // ⚠️ **本字段不由响应决定**——`fixtures/wuwa/raw_response/1_page_1.json`
        // 真实样本证实，PoolType=1 的响应记录里 `cardPoolType` 取值是中文
        // 展示标签 `"角色精准调谐"`，**不是** `"1"`；只有 `10_page_1.json`
        // （PoolType=10）恰好降级成了数字字符串 `"10"`。也就是说
        // `cardPoolType` 多数情况下不是 `WUWA_POOL_TYPES` 表的 id，直接拿它
        // 当 bannerId 会产出一个不匹配任何 `banners[].id`/
        // `pityGroups[].members` 的字符串，保底统计会对这些记录静默失效。
        //
        // 这不是"值取错了"这么简单：`FieldMapping.extractRecord` 的签名是
        // `(raw: unknown) => UnifiedRecordFields`，**没有任何参数能告诉它
        // 这批记录是查询哪个 PoolType 得到的**——这是结构性限制，不是能在
        // 这个函数内部修好的实现细节（POST body 里发的 `cardPoolType` 是
        // 我们自己指定的查询参数，响应里同名字段却是服务端自己的展示值，
        // 两者不保证一致，真实数据已经证伪"一致"这个假设）。
        //
        // 因此这里不再尝试从响应解析卡池归属，改用宿主侧覆盖：
        // `collect.params.bannerIdentity: "query"`（见上方声明）让宿主**在
        // 本函数返回之后、调用 `hooks.deriveRecordKeys` 之前**，就把这个字段
        // 换成发起本次查询时实际使用的 banner id——完整决策依据见
        // `packages/gs-plugin-kit/manifest.ts` 里
        // `CredentialedApiPipelineParams.bannerIdentity` 的文档（原神会混池
        // 必须信响应，鸣潮不混池必须信查询，两者对照）。
        //
        // ⚠️ 覆盖时机是「在 hooks 之前」而不是「落库时」，这一点对
        // `record_key` 的正确性是必要的：`hooks.deriveRecordKeys`（见
        // `./hooks.ts`）会读 `bannerId` 参与哈希，若它看到的是下面这个与卡池
        // 无关的占位值，key 就少了卡池这一维——鸣潮十连整组共用同一个时间戳，
        // 而 3★ 武器同时出现在角色池与武器池，两池同一秒各出一次同一件 3★ 且
        // 组内序位相同时会算出相同的 key，被 `UNIQUE(account_id, record_key)`
        // + `INSERT OR IGNORE` 静默吞掉一条。宿主侧对应实现与钉住该时机的断言
        // 见 `crates/paradigms/gs-p-authkey/src/pipeline.rs`。
        //
        // 那为什么这里还要填一个占位值而不是随便填 `cardPoolType`？因为
        // `UnifiedRecordFields.bannerId` 是必填字段，总得返回点什么；而这个值
        // 唯一会真正生效的场景，是**有人误删了上面的 `bannerIdentity: "query"`
        // 声明**——那时占位值会让每条记录都落到一个不匹配任何 `banners[].id`
        // 的卡池上，问题当场显形；若改填 `cardPoolType`，落库的会是"角色精准
        // 调谐"这类看着挺合理、实际同样匹配不上的值，反而更难发现。
        bannerId: "wuwa-banner-identity-not-derivable-from-response",
        count: toCount(record.count),
        name: toNonEmptyString(record.name),
        itemType: toNonEmptyString(record.resourceType),
        rarity: numericToString(record.qualityLevel),
        // stableId 留空：见上方注释，API 响应没有任何记录 ID 字段。
      };
    },
  },

  // 卡池表：13 个 PoolType 槽位，没有任何一条声明 endpointOverride——13 个池
  // 共用同一个端点，区别完全在 POST body 的 cardPoolType 字段值。
  banners: WUWA_POOL_TYPES.map((pool) => ({
    id: pool.id,
    displayName: { "zh-CN": pool.name },
  })),

  // ============================================================
  // pityGroups：5★/4★ 双档保底
  // ============================================================
  //
  // 每个 PoolType 声明两个 PityGroup，members 都指向同一个卡池 id：
  //   - 5★ 那份不填 pityTarget，回落 rarity.pityTarget = "5"；
  //   - 4★ 那份显式 pityTarget: "4"，hardPity 取 WUWA_4STAR_HARD_PITY。
  //
  // ⚠️ **5★ 组必须排在数组前面**：宿主落库时 `pity_group_for()`
  // （`pipeline.rs`）取"声明顺序第一个"作为写入 `GachaRecord.pity_group`
  // 单值列的那一个——这个隐式语义已知有问题（S5 待解决），但当前行为如此，
  // 顺序不能乱。下面 `flatMap` 对每个 PoolType 先产出 5★ 分组、再产出 4★
  // 分组，保证这一点。
  //
  // 「保底是否继承」（参考实现里联动池 10/11 传 inherit=false，其余默认
  // true）没有字段承载，且即使有字段也做不到——见下方大段"已知缺口"说明。
  pityGroups: WUWA_POOL_TYPES.flatMap((pool) => [
    {
      key: `${pool.id}-5star`,
      members: [pool.id],
      hardPity: pool.hardPity5Star,
      curve: fiveStarCurve(pool),
      // 取值依据见上方 WUWA_POOL_TYPES 表格注释（角色/武器/新手三类的
      // fiveStarGuaranteeKind 判定依据与"无实测依据"标注都在那里）。
      guarantee: WUWA_FIVE_STAR_GUARANTEE_BY_KIND[pool.fiveStarGuaranteeKind],
      // pityTarget 不填：回落 rarity.pityTarget = "5"。
    },
    {
      key: `${pool.id}-4star`,
      members: [pool.id],
      hardPity: WUWA_4STAR_HARD_PITY,
      pityTarget: "4",
      // 4★ 软保底/渐进概率数值没有任何来源给出分桶命中率（真实存档实测
      // 只统计了 4★ 出货间隔的最小/最大/均值，见
      // `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §3.2，没有像 5★ 那样的
      // 逐抽命中率分桶数据），用 custom 占位——不编造没有分桶数据支撑的
      // 曲线形状。
      curve: { kind: "custom" as const, id: `wuwa-unconfirmed-4star-pool-${pool.id}` },
      // 4★ 是否有类似 5★ 的"角色/武器必中不歪"规则未经证实，不套用 5★ 的
      // 规则，如实标注为未知。
      guarantee: { kind: "none" as const },
    },
  ]),

  rarity: { ladder: ["3", "4", "5"], pityTarget: "5" },

  time: {
    // 记录时间就是服务器返回的挂钟时间字符串、未经客户端本地化——
    // `Models/GachaData.cs` 的 `Time` 字段与 fixture 样本的形态一致，这一点
    // 与"是否知道具体时区偏移"是两回事，不受下面这条缺口影响，予以保留。
    rawTimeConvention: "serverLocal",

    // rawFormat: "isoLocal" —— 取值来自 `fixtures/wuwa/raw_response/*.json`
    // 与 `fixtures/wuwa/archive/wwgacha_archive.json` 的形状（`"2100-01-06
    // T22:53:07"` 这类 `YYYY-MM-DDTHH:MM:SS`），即本地存档字段（C#
    // `DateTime`，Newtonsoft 默认序列化产物）的形态。
    //
    // ⚠️ **API 真实线格式仍未验证**，这不是遗漏，是如实标注的空白——完整
    // 查证过程见 `fixtures/wuwa/meta.toml`"已知未验证项：API 的 Time
    // 线格式"一节：`Models/GachaData.cs` 里 `Time` 是 `DateTime` 强类型，
    // API 发来的原始线格式在反序列化那一刻就被吃掉了，反推不出来；
    // `docs/_internal/capture/` 下没有鸣潮抓包样本。声明 `isoLocal` 赌的是
    // "本地存档的格式大概率与 API 一致"，如果这个假设错了，Rust 侧
    // `parse_record_time` 现在改成了严格匹配（不再依次尝试多种格式），会在
    // 首次真实采集时明确报错，而不是被静默兜底吸收掉——参见 gs-core::
    // RawTimeFormat 文档"为什么改成严格匹配"一节。
    //
    // ⚠️ **已知褶皱**：鸣潮同时有两条数据来源共用这一份声明——采集走 API
    // （格式未验证），导入走本地存档（ISO，确定）。若将来证实 API 发的是
    // 别的格式，这一个 rawFormat 就不够用了，需要按数据来源分别声明；现在
    // 样本数为 1，按三次法则不为此设计机制，只在这里记一笔。
    rawFormat: { kind: "isoLocal" },

    // ⚠️ timezoneSource 刻意不声明（而不是填 "computed"）。三个可选形态逐一
    // 排除，不是漏填：
    //   - apiField：`Models/GachaAPI.cs` 的 KRAPIItem 只有 7 个字段，没有任何
    //     时区/偏移量字段，响应体里没有能读的值。
    //   - staticTable：`field` 语义是"响应体里哪个字段是查表键"（与 apiField
    //     对称，见 packages/gs-plugin-kit/types/generated.ts 对应字段注释），
    //     但查表键同样必须来自响应体——响应体没有 region/svr 类字段，
    //     这个形态在鸣潮身上无字段可查，不是"表不全"的问题。
    //   - computed：本机只有国服（svr_area=cn）样本，`TimezoneContext` 能给
    //     到 hook 的账号侧信号只有 uid/region 两个字段；`hooks.resolveTimezone`
    //     的签名要求对任意输入都返回一个确定的 number，国际服的区服划分与
    //     时区没有任何可验证依据，要么编一张查无实据的映射表，要么对未知
    //     region 直接抛错中断采集——两者都比"如实声明不知道"更糟。
    //
    // 省略 timezoneSource 后走的是宿主已经设计好的兜底路径（不是本插件另开
    // 的口子）：`crates/paradigms/gs-p-authkey/src/pipeline.rs` 的
    // `resolve_page_level_timezone_offset_hours` 对 `None` 就返回
    // `Ok(None)`，`normalize_time` 在偏移量为 `None` 时把挂钟时间原样当成
    // UTC 存入 `occurred_at`、`tz_origin` 标记为 `Assumed`——即"数字照抄，
    // 明确标注不保真"，不是静默产出一个自信但可能错误的时间戳。
    //
    // 对用户的真实后果（如实写，不粉饰）：不区分国服/国际服，**所有**鸣潮
    // 账号的 occurred_at 都会带着这个"未知偏移"标记——不是国际服比国服更差，
    // 而是两者一样不保真。国服用户看到的挂钟数字大概率就是本地时间（因为
    // "assumed UTC" 恰好约等于"不做换算，原样显示"），但只要牵涉跨时区
    // 换算或与其它已知时区来源的游戏做时间线比对，这个字段都不可信。等
    // 拿到 svr_id/svr_area → UTC 偏移量的真实验证依据（哪怕只是国服一条），
    // 应改回 `computed` 并补上 `hooks.resolveTimezone`。
  },

  preconditions: [
    {
      id: "wuwa.credential.logHasGachaLink",
      capability: "credential",
      level: "required",
      describe: {
        "zh-CN": "自动获取唤取记录要求打开过一次游戏内的唤取详情页，且需要在链接有效期内立即导出",
      },
      // 同原神先例：HostEnv 目前没有"日志文件是否已包含匹配 URL"这个信号，
      // check 只能返回 unknown。
      check: () => ({ kind: "unknown" }),
      remedy: {
        "zh-CN": "请在游戏内打开唤取详情页后，立即回到本应用重试（链接有效期未经实测确认，按最短情况处理）",
      },
    },
  ],

  // baseline 不声明：鸣潮接口不分页、也没有已知的权威聚合统计接口，
  // `inGamePageCount`/`authoritativeApi` 两个变体套用鸣潮的情况都会名不副实。

  // retention 不声明：没有任何来源给出鸣潮官方记录保留期，不跨游戏挪用
  // 米哈游三游"6 个月"的说法。

  // itemIdSource 不声明，默认 "native"——resourceId 是 API 原生字段，不是
  // 本地化物品名，与星铁/绝区零同理。

  // metadata 不声明：响应记录自带 name/resourceType/qualityLevel，不需要
  // 反查字典。

  // drawCounting 不声明，默认 perRecord（见上方 toCount 函数注释）。
} satisfies PluginManifest;
