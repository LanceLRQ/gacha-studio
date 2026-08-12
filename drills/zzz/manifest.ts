/**
 * 绝区零 manifest 纸面填表演练草稿。
 *
 * ⚠️ **这不是可运行插件**：没有 `hooks.ts`、没有接入 `plugins/index.ts`、
 * 没有 fixture 契约测试。唯一目的是用 M1-S1 定的插件契约类型
 * （`packages/gs-plugin-kit`）表达绝区零已实测的真实差异点，验证「填不填
 * 得下」，见 `docs/_internal/milestones/02-M1-原神插件全链路.md` S7。
 *
 * 绝区零是本次演练里更能戳穿抽象漏洞的对象（`00-实施总览.md` §8.2 裁定），
 * 因为它同时具备稀有度阶梯差异、分页参数名差异、卡池实例 ID 恒为常量三重
 * 差异——本文件的注释会格外注意每一处"能填但别扭"的地方。
 *
 * 数据来源（严格限定，不凭训练记忆编造字段名）：
 * - docs/_internal/research/03-真实导出数据格式实测.md §1.1（rank_type 取值
 *   2/3/4）§1.2（gacha_id 恒为 '0'）§1.4（响应体是 9 键对象，同星铁）
 *   §2.1（typeMap）§2.3（region_time_zone=8，无 region——**这是导出存档
 *   里的观测，见下方 timezoneSource 注释里对这条与 research/04 的核对）
 * - docs/_internal/research/04-同族工具三方源码对比.md §4.1（real_gacha_type
 *   参数名）§4.4（时区来源：API 只返回 region，客户端自维护静态表）
 *   §4.5（稀有度体系与物品分类：代理人/音擎/邦布）
 * - docs/_internal/research/01-抽卡工具生态与采集范式调研.md（credential.gameDir
 *   的目录片段，范式 A 通用结论）
 * - plugins/genshin/manifest.ts（同族已落地的真实插件，写法对齐）
 *
 * 演练结论汇总见 `docs/_internal/audit/AUDIT-2026-08-11-S7纸面填表演练.md`，
 * 本文件内的注释只记录「为什么这么填」，不重复整篇结论。
 */
import type { PluginManifest } from "gs-plugin-kit";

/**
 * 从分页响应体取出本页记录数组。
 *
 * ⚠️ **假设边界**：与星铁草稿同理（见 drills/starrail/manifest.ts 同名函数
 * 的注释），具体的 `{ data: { list } }` 嵌套形态是类比原神已验证的真实响应
 * 结构，不是绝区零的独立实测——research/03、04 都没有给出绝区零某一页原始
 * 响应体的完整 JSON。
 *
 * ⚠️ **另一处未覆盖项**：research/04 §4.1 只给出绝区零分页**查询参数名**
 * 是 `real_gacha_type`（与星铁的 `gacha_type` 不同），没有给出绝区零默认
 * 端点本身的字面路径名（星铁的默认端点名 "getGachaLog" 是直接从源码引用
 * 确认的，见 research/04 §4.2；绝区零没有等价的确认）。下方 urlPattern
 * 沿用与原神/星铁相同的 "getGachaLog" 只是为了让草稿在结构上成立，
 * **这个具体端点名本身是 research 未覆盖，需实测**，不当作已核实事实。
 */
function extractGachaLogList(response: unknown): unknown[] {
  if (typeof response !== "object" || response === null) return [];
  const data = (response as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return [];
  const list = (data as { list?: unknown }).list;
  return Array.isArray(list) ? list : [];
}

/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 官方响应里的 `count` 是数字字符串（如 `"1"`），防御式转换。 */
function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

export const manifest = {
  id: "zzz",
  displayName: { "zh-CN": "绝区零" },
  sdkVersion: "1.0.0",
  platforms: ["windows"],
  maintainers: ["gacha-studio"],
  // exchangeFormats 不声明：绝区零的 UIGF 字段映射未经真实实现校准，
  // 不在本次演练范围内编造。

  collect: {
    // paradigm 随 M2-S2 契约改名同步更新："authkey" → "credentialedApi"，
    // 见 packages/gs-plugin-kit/manifest.ts 对 CredentialedApiPipelineParams
    // 的说明；本文件其余内容为 M1-S7 历史演练记录，不改动。
    paradigm: "credentialedApi",
    params: {
      credential: {
        kind: "chromiumCache",
        // 相对片段，来源 research/01「数据采集原理分层」范式 A：
        // {安装目录}/ZenlessZoneZero_Data/webCaches/{版本}/Cache/Cache_Data/data_2
        gameDir: "ZenlessZoneZero_Data/webCaches",
        // ⚠️ 见上方 extractGachaLogList 的第二条注释：端点字面名未在
        // research/03、04 中被确认，此处沿用同族默认端点名，仅用于让草稿
        // 结构成立。
        urlPattern: /https:\/\/.+?getGachaLog[^"]+/,
      },
      request: {
        // 差异点：分页参数名是 real_gacha_type 而非 gacha_type。
        // 来源 research/04 §4.1 的源码引用：
        //   zzz getData.js:202   `${url}&real_gacha_type=${key}&page=...`
        //   （zzz getData.js:333 的 getQuerystring 清理参数时删的也是
        //    real_gacha_type，确认不是笔误）
        //
        // ★ 这是本次演练要正面验证的核心问题：AuthkeyPipelineParams 曾有
        // typeParam/pageParam 两个字段声明"参数名叫什么"，M1-S3 实测后确认
        // 从未被任何代码路径读取而删除（packages/gs-plugin-kit/manifest.ts
        // 第 180～186 行的说明）。这里直接把 real_gacha_type 写进 url 模板
        // 字面量——不需要 typeParam，也不需要任何其他声明字段，字符串模板
        // 本身就是"参数名"这件事的完整表达。**验证结论：M1-S5 删除
        // typeParam 的判断是对的**，绝区零这个更极端的差异（参数名整个变了，
        // 不只是取值变了）依然只需要改这一行字符串。
        //
        // size/end_id 两个参数沿用同族假设（见 extractGachaLogList 注释），
        // 未独立实测。
        url: "{{credential}}&page={{page}}&real_gacha_type={{gachaType}}&size={{pageSize}}&end_id=0",
      },
      extractList: extractGachaLogList,
    },
  },

  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("绝区零 extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;

      // 响应记录字段名沿用星铁的 9 键结构（research/03 §1.4：
      // 「绝区零 9 键对象（同星铁）」）：
      //   { id, item_id, item_type, name, rank_type, time, gacha_id,
      //     gacha_type, count }
      //
      // ⚠️ **勉强填进去但别扭之处**：research/04 §4.1 明确的是查询参数名
      // 变成了 real_gacha_type，但没有明确响应体里对应字段的键名是否也叫
      // real_gacha_type，还是仍然叫 gacha_type（只是查询参数名变了，返回
      // 结构不变）。本文件按"同构"结论选择继续读 record.gacha_type——这是
      // **推断**，不是 research/03、04 里任何一份直接给出的事实，如实标注。
      const itemId = toNonEmptyString(record.item_id);
      if (!itemId) {
        // 与星铁同理：绝区零 API 同样直接返回 item_id（"同构"于星铁的
        // research/03 §1.3 样例），缺失属于异常输入，直接拒绝。
        throw new Error("绝区零 extractRecord：记录缺少 item_id，无法确定 itemId");
      }

      return {
        itemId,
        time: toNonEmptyString(record.time) ?? "",
        bannerId: toNonEmptyString(record.gacha_type) ?? "",
        count: toCount(record.count),
        name: toNonEmptyString(record.name),
        // 差异点：物品分类三档——代理人 / 音擎 / 邦布（research/04 §4.5），
        // 比原神/星铁多一档。**验证结论：不需要任何新字段**——itemType 本来
        // 就是自由字符串（UnifiedRecordFields.itemType?: string），装两档
        // 还是三档对类型系统没有区别，这正是 `00-实施总览.md` §8.2 举的
        // "能归因→通过"例子之一。
        itemType: toNonEmptyString(record.item_type),
        rarity: toNonEmptyString(record.rank_type),
        stableId: toNonEmptyString(record.id),
        // 差异点：gacha_id 恒为 '0'（research/03 §1.2）。
        // **验证结论：不需要处理**——record.gacha_id 在这份草稿里从头到尾
        // 没有被读取。UnifiedRecordFields 根本没有承载 gacha_id 的字段，
        // 卡池期次归属完全交给 bannerId（gacha_type 类别码）+ 外部
        // banner_meta 元数据表推导，这条路径本来就不要求 gacha_id 有意义
        // ——"允许退化为时间窗口+元数据表推导"这条设计早已通过原神验证
        // （原神同样没有等价于 gacha_id 的字段），绝区零只是再确认一次
        // "即使这个字段存在但取值恒为常量，也不会污染任何东西"。
      };
    },
  },

  // 卡池类别码与显示名，直接取自 research/03 §2.1 的 typeMap 实测结果。
  // 注意与星铁的对照：这里没有任何一个 banner 需要 endpointOverride——
  // research/04 没有观测到绝区零存在类似星铁 21/22 的端点分流。这本身也是
  // 一条已验证的差异（"星铁需要端点覆盖，绝区零不需要"），可选字段
  // `endpointOverride?: string` 天然表达了"有的游戏需要，有的不需要"，
  // 不需要额外设计。
  banners: [
    { id: "1", displayName: { "zh-CN": "常驻频段" } },
    { id: "2", displayName: { "zh-CN": "独家频段" } },
    { id: "3", displayName: { "zh-CN": "音擎频段" } },
    { id: "5", displayName: { "zh-CN": "邦布频段" } },
    { id: "102", displayName: { "zh-CN": "独家重映" } },
    { id: "103", displayName: { "zh-CN": "音擎回响" } },
  ],

  // pityGroups 不声明。理由同星铁草稿：每个 gacha_type 类别码看起来各自
  // 独立保底，不需要合并；具体保底数值（硬保底抽数/软保底曲线参数）不在
  // research/03、04 范围内，本次演练不编造。

  // 差异点：RaritySpec 阶梯是 2/3/4，不是 3/4/5（research/03 §1.1：
  // 「绝区零的 rank_type 取值是 ['2','3','4']，不是 3/4/5」）。
  //
  // **这是本次演练最核心的验证点**：`RaritySpec.ladder` 是
  // `Array<string>`、`pityTarget` 是 `string`，类型层完全没有假设任何
  // 具体字面量——干净通过，不需要 as any、不需要兜底。而且这条差异不只是
  // "类型层填得下"，已经在 crates/gs-analysis/src/pity.rs:228 的文档注释与
  // 单元测试里被直接引用为验证案例（"绝区零 RaritySpec { ladder: ["2","3","4"],
  // pity_target: "4" } 与米哈游三游的 ["3","4","5"] / "5" 走的是同一段代码"），
  // 说明这条差异不仅"能声明"，分析引擎那一侧也已经验证过"声明了会正确生效"
  // ——是本次四项差异点里唯一走通全链路（类型 → 分析引擎）的一条。
  rarity: { ladder: ["2", "3", "4"], pityTarget: "4" },

  time: {
    // 直连官方 API 得到的是服务器本地时间，不经过任何第三方工具的二次
    // 本地化处理——理由同星铁草稿，不适用 research/03 §2.3.1 的
    // tool_localized 风险（那是导入第三方已导出文件才会遇到的问题）。
    rawTimeConvention: "serverLocal",
    // 差异点：时区来源是 region 字段 + 客户端静态表，不是 apiField。
    //
    // ⚠️ **这里核对出一处 research 文档之间容易被误读的表述**：
    // research/03 §2.3 的表格写"绝区零 region: 无，region_time_zone: 8"，
    // 单看这张表容易得出"绝区零应该走 apiField，字段名 region_time_zone"
    // 的结论（即误以为绝区零该和星铁一样处理）。但 research/04 §4.4 用
    // 源码复核给出了更细的结论："绝区零 API 只返回 region，客户端自维护
    // 静态表 {"prod_gf_cn":8,"prod_gf_us":-5,"prod_gf_eu":1,...}
    // （getData.js:33-39）"计算出 region_time_zone，再把计算结果写回导出
    // 存档——也就是 research/03 表格里那个"region_time_zone: 8"是**客户端
    // 算出来再写回存档的值**，不是原始 API 响应本就有的字段；本插件直连
    // 官方 API（不经过 zzz-signal-search-export 这个第三方工具的处理），
    // 拿到的是原始响应，只有 region，没有 region_time_zone，因此正确的
    // 分支是 staticTable，不是 apiField。这处两份研究文档表述层级不同
    // （存档观测 vs 源码复核）但容易被读成矛盾，在 AUDIT 文档里也会记录。
    //
    // ⚠️ **另一处值得记录的项目内部不一致**：`crates/gs-core/src/record.rs:241`
    // 与 `crates/gs-core/src/collect.rs:109` 的既有注释断言"绝区零只有
    // region_time_zone"（暗示绝区零该用 apiField），与上述 research/04
    // 的源码级结论不一致。这不是本次演练能自行裁定的事——两份都是项目内部
    // 已有资料，只是深度不同，交由主进程核实取舍，本文件按 research/04
    // 的结论（更细、有源码行号支撑）声明为 staticTable。
    //
    // table 只收录 research/04 §4.4 引用里明确给出的三项（该表在原文里用
    // "..." 省略了其余条目，本文件不据此编造更多区服）。
    timezoneSource: {
      kind: "staticTable",
      // 查表键来源，M1-S7 演练报告 §3.1 指出的类型不对称已在本次修复补上，
      // 见 packages/gs-plugin-kit/manifest.ts 与 gs_core::TimezoneSource::StaticTable。
      field: "region",
      table: {
        prod_gf_cn: 8,
        prod_gf_us: -5,
        prod_gf_eu: 1,
      },
    },
  },

  // 与原神一致的范式 A 通用基线策略，非绝区零专属差异点。
  baseline: { kind: "inGamePageCount" },

  retention: {
    displayText: { "zh-CN": "6 个月" },
    conservativeDays: 6 * 28,
  },

  // itemIdSource 不声明，默认 "native"——理由同星铁草稿：绝区零的 item_id
  // 由"同构于星铁"推断为 API 原生字段，不是原神那种本地化物品名特例。

  // metadata / preconditions 均不声明，理由同星铁草稿：内容不在
  // research/03、04 引用范围内，不编造；聚焦本次演练的差异点。
} satisfies PluginManifest;
