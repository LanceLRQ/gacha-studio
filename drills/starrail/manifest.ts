/**
 * 星铁 manifest 纸面填表演练草稿。
 *
 * ⚠️ **这不是可运行插件**：没有 `hooks.ts`、没有接入 `plugins/index.ts`、
 * 没有 fixture 契约测试。唯一目的是用 M1-S1 定的插件契约类型
 * （`packages/gs-plugin-kit`）表达星铁已实测的真实差异点，验证「填不填得下」，
 * 见 `docs/_internal/milestones/02-M1-原神插件全链路.md` S7。
 *
 * 数据来源（严格限定，不凭训练记忆编造字段名）：
 * - docs/_internal/research/03-真实导出数据格式实测.md §1.2（gacha_id）
 *   §1.3（真实记录样例，本文件 extractRecord 的 9 个字段名直接取自这里）
 *   §1.4（响应体是对象而非位置数组）§2.1（typeMap）§2.3（region_time_zone）
 * - docs/_internal/research/04-同族工具三方源码对比.md §4.2（getLdGachaLog
 *   端点路由）§三（分页拉取控制流~90%雷同，本文件 request/extractList 的
 *   骨架按此比例复用原神已验证的形态，非独立实测）
 * - docs/_internal/research/01-抽卡工具生态与采集范式调研.md（credential.gameDir
 *   的目录片段，范式 A 通用结论）
 * - plugins/genshin/manifest.ts（同族已落地的真实插件，写法对齐）
 *
 * 演练结论汇总见 `docs/_internal/audit/AUDIT-2026-08-11-S7纸面填表演练.md`，
 * 本文件内的注释只记录「为什么这么填」，不重复整篇结论。
 */
import type { PluginManifest } from "gs-plugin-kit";

/**
 * 从 `getGachaLog` 响应体取出本页记录数组。
 *
 * ⚠️ **假设边界**：具体的 `{ data: { list } }` 嵌套形态沿用原神已验证的
 * 真实响应结构（plugins/genshin/manifest.ts 同名函数），依据是
 * research/04 §三「分页拉取控制流 ~90% 雷同」——research/03、04 均未给出
 * 星铁某一页原始响应体的完整 JSON，这一层嵌套是**类比推断**，不是独立实测，
 * 如实标注在此，不当作已核实事实使用。
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
  id: "starrail",
  displayName: { "zh-CN": "崩坏：星穹铁道" },
  sdkVersion: "1.0.0",
  platforms: ["windows"],
  maintainers: ["gacha-studio"],
  // exchangeFormats 不声明：星铁的 UIGF 字段映射未经真实实现校准，
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
        // {安装目录}/StarRail_Data/webCaches/{版本}/Cache/Cache_Data/data_2
        gameDir: "StarRail_Data/webCaches",
        // 端点名 "getGachaLog" 直接取自 research/04 §4.2 的源码引用：
        //   star-rail getData.js:216
        //   let gachaURLPath = ['21','22'].includes(key) ? 'getLdGachaLog' : 'getGachaLog'
        // 即默认端点确定是 getGachaLog，不是类比推断。
        urlPattern: /https:\/\/.+?getGachaLog[^"]+/,
      },
      request: {
        // ⚠️ 同 extractGachaLogList 的假设边界：page/size/end_id 三个参数名
        // 沿用原神已验证模板，research/03、04 没有单独给出星铁请求 URL 的
        // 完整查询串，只确认了 gacha_type 这一个参数名（与绝区零的
        // real_gacha_type 对照才被提及）。这里如实标注为类比而非独立实测。
        url: "{{credential}}&page={{page}}&gacha_type={{gachaType}}&size={{pageSize}}&end_id=0",
      },
      extractList: extractGachaLogList,
    },
  },

  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("星铁 extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;

      // 星铁响应记录是 9 键对象（research/03 §1.4：「星铁 9 键对象」，
      // 与原神本身的 API 响应形态一致，都是对象——研究报告里作为反例的
      // 位置数组，是 genshin-wish-export 这个第三方工具自己选择的**存档
      // 文件格式**，不是官方 API 的响应形态，不需要特殊处理）。
      //
      // 9 个字段名直接取自 research/03 §1.3 给出的真实记录样例（该样例恰好
      // 是一条元数据缺失的记录，字段名因此格外可信——它证明这 9 个键确实
      // 存在，只是这一条的部分取值为空串）：
      //   { id, item_id, item_type, name, rank_type, time, gacha_id,
      //     gacha_type, count }
      const itemId = toNonEmptyString(record.item_id);
      if (!itemId) {
        // 与原神不同：星铁 API 直接返回 item_id（research/03 §1.3 样例中
        // item_id="1223" 有真实值，即使同一条记录的 name/item_type/rank_type
        // 全是空串）。itemId 缺失说明连这个「唯一保证非空」的锚点都没有，
        // 属于比原神那种「item_id 天生不存在」更严重的异常输入，直接拒绝。
        throw new Error("星铁 extractRecord：记录缺少 item_id，无法确定 itemId");
      }

      return {
        itemId,
        time: toNonEmptyString(record.time) ?? "",
        // bannerId 用 gacha_type（卡池类别码：11/12/1/2/21/22），不是 gacha_id。
        //
        // ⚠️ 差异点①「gacha_id 可直接用作卡池实例 ID」的处理说明：
        // research/03 §1.2 指出星铁 gacha_id 有 49 种真实取值，能直接标识
        // 「哪一期具体卡池」，这与原神完全没有这个信息（只能靠 301/400
        // 合并 + 外部卡池元数据表推导期次）形成对比。但这条差异**没有落地
        // 到本文件的任何字段**——UnifiedRecordFields 没有 bannerInstanceId
        // 或任何透传字段能承载 gacha_id，把它塞进 bannerId 会导致 banners[]
        // 需要枚举 49+ 个随时间持续增长的实例 id（每次新卡池上线都要加一条），
        // 维护负担远高于按类别声明；这不是契约填不下，而是"能填但选择不填"
        // ——具体权衡见 AUDIT 文档「勉强填进去但别扭」一节。
        bannerId: toNonEmptyString(record.gacha_type) ?? "",
        count: toCount(record.count),
        name: toNonEmptyString(record.name),
        itemType: toNonEmptyString(record.item_type),
        rarity: toNonEmptyString(record.rank_type),
        stableId: toNonEmptyString(record.id),
      };
    },
  },

  // 卡池类别码与显示名，直接取自 research/03 §2.1 的 typeMap 实测结果。
  banners: [
    { id: "1", displayName: { "zh-CN": "常驻跃迁" } },
    { id: "2", displayName: { "zh-CN": "新手跃迁" } },
    { id: "11", displayName: { "zh-CN": "角色活动跃迁" } },
    { id: "12", displayName: { "zh-CN": "光锥活动跃迁" } },
    // 差异点②：联动跃迁走独立端点，来源 research/04 §4.2 的源码引用
    // （star-rail getData.js:216，见上方 credential.urlPattern 注释）。
    // endpointOverride 类型层完全能表达这个差异；能否真的生效见 AUDIT 文档
    // ——`crates/paradigms/gs-p-authkey/src/pipeline.rs` 的 `build_page_url`
    // 目前从未读取这个字段，任何卡池都会用同一个 request.url 模板发请求。
    { id: "21", displayName: { "zh-CN": "角色联动跃迁" }, endpointOverride: "getLdGachaLog" },
    { id: "22", displayName: { "zh-CN": "光锥联动跃迁" }, endpointOverride: "getLdGachaLog" },
  ],

  // pityGroups 不声明。理由：
  // 1. 星铁的每个 gacha_type 类别码看起来各自独立保底，不像原神 301/400
  //    需要合并到同一个 PityGroup——即"不需要合并"这条差异本身，靠"少填一个
  //    合并关系"就已经表达清楚，不需要额外语法。
  // 2. PityGroup 的 hardPity/curve/guarantee 是必填的数值字段，research/03、
  //    04 都没有给出星铁的真实保底数值（硬保底抽数、软保底起点/步长），
  //    本演练不编造这些数字（哪怕原神那份真实 manifest 也只是引用"公开的
  //    祈愿概率说明""同人社区口径"，性质与本次严格限定 research/03、04 的
  //    约束不同）。

  rarity: { ladder: ["3", "4", "5"], pityTarget: "5" },

  time: {
    // 直连官方 API，得到的是服务器本地时间字符串（research/03 §2.3：
    // 「时间字符串一律不带时区，是服务器本地时间」）。这与 research/03
    // §2.3.1 提到的"某些第三方导出工具会把时间换算成采集时的本机时区
    // （tool_localized）"是完全不同的问题——那是导入第三方工具已导出文件
    // 时才会遇到的坑，本插件直连官方 API，不经过任何第三方工具的二次处理，
    // 因此明确声明为 serverLocal，而不是被那条 ☠️ 警告吓得不敢下判断。
    rawTimeConvention: "serverLocal",
    // 差异点③：时区来源是响应体的 region_time_zone 字段
    // （research/03 §2.3：星铁 region_time_zone=8；research/04 §4.4：
    // 「星铁 API 直接返回 region_time_zone」）。
    //
    // ⚠️ 类型层能声明，但落地有两处存疑，详见 AUDIT 文档：
    // (a) region_time_zone 按 research/03 §1.4 的表述是"顶层元数据"，
    //     不是逐条记录的字段——而 apiField.field 语义上到底是"从每条记录读"
    //     还是"从整页响应读"没有文档说明，UnifiedRecordFields 也没有位置
    //     承载页级元数据；
    // (b) `crates/paradigms/gs-p-authkey/src/pipeline.rs` 里 apiField 分支
    //     被 serde 解析出来后标 `#[allow(dead_code)]`，从未被消费——
    //     声明了这个分支，实际跑起来时区偏移量仍然恒为 None，归一化结果是
    //     `TzOrigin::Assumed`，比声明的可信度更低。
    timezoneSource: { kind: "apiField", field: "region_time_zone" },
  },

  // 与原神一致的范式 A 通用基线策略，非星铁专属差异点。
  baseline: { kind: "inGamePageCount" },

  retention: {
    displayText: { "zh-CN": "6 个月" },
    conservativeDays: 6 * 28,
  },

  // itemIdSource 不声明，默认 "native"。这是与原神的清晰对照：原神因为
  // API 不返回 item_id 才需要显式声明 "displayName"（见 plugins/genshin/manifest.ts），
  // 星铁的 item_id 是 API 原生字段（research/03 §1.3 样例 item_id="1223"
  // 为真实值），不需要这个特例——这条差异点的验证结果是"干净通过"，
  // 二元判别字段准确捕捉到了两款游戏的真实区别。

  // metadata 不声明。research/03 §1.3 指出星铁存档确有 1/5372 条元数据缺失
  // 记录，`MetadataProvider` 的"事后回填"能力对星铁是必要的，但静态字典
  // （research/04 §4.7 提到的 idJson.json）内容不在 research/03、04 的
  // 引用范围内，本次演练不编造字典内容，留空与原神现状一致
  // （plugins/genshin/manifest.ts 同样未声明 metadata）。

  // preconditions 不声明。credential.cacheDirExists 这类前置条件在
  // plugins/genshin/manifest.ts 已有先例，且已知 HostEnv 尚不支持这个信号
  // （check 只能返回 unknown），复制一份不会带来新信息，聚焦本次演练的
  // 差异点。
} satisfies PluginManifest;
