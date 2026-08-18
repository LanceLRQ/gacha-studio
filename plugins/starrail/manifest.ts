/**
 * 崩坏：星穹铁道插件 manifest。
 *
 * 采集范式：credentialedApi（`gs-p-authkey`），与原神同源——凭据来自游戏内置
 * Chromium 组件的磁盘缓存（玩家打开跃迁记录页时，webview 会命中官方
 * `getGachaLog` 接口并带上 authkey，落在 `webCaches` 目录下某个版本号子目录的
 * `Cache/Cache_Data/data_2` 索引文件里）。
 *
 * 本文件由 M1-S7 纸面填表演练草稿 `drills/starrail/manifest.ts` 转化而来——
 * 演练验证的是"S2 改过的插件契约类型是否装得下星铁的真实差异点"，本文件是把
 * 验证结论落地成真正接入 `plugins/index.ts` 的可运行插件（本次改动范围不含
 * `plugins/index.ts` 的注册，由主进程统一处理）。草稿里的以下内容已随本次
 * 转化过期、不再照抄：
 *   - `allowedHosts` 占位域名 → 换成下方真实核实的两个 host
 *   - "`endpointOverride` 从未被 `build_page_url` 读取""apiField 分支被标
 *     `#[allow(dead_code)]`" → 均是 M1-S7 时的状态，M2 已全部实装，本文件不再
 *     复述过期描述
 *   - 新增 `pityGroups`、`hooks.ts`（草稿刻意不填，理由已随保底数值到位而失效）
 *   - 显式决策 `bannerIdentity` 不声明（见下方 collect.params 内注释）
 *   - 新增 `rateLimit` 显式声明
 *
 * 数据来源（不凭训练记忆编造字段名/数值）：
 * - `docs/example-projects/HoYo.Gacha/crates/game_biz/src/api.rs:42-46`
 *   （host 与端点路径前缀：`public-operation-hkrpg.mihoyo.com` /
 *   `public-operation-hkrpg-sg.hoyoverse.com`，路径前缀
 *   `/common/hkrpg_gacha_record/api/`，`getGachaLog`/`getLdGachaLog` 端点名）
 * - `docs/example-projects/star-rail-warp-export/src/main/getData.js:216-234`
 *   （`['21','22'].includes(key) ? 'getLdGachaLog' : 'getGachaLog'` 的端点选择逻辑；
 *   该参考实现用的路径前缀是 `/common/gacha_record/api/`，与 HoYo.Gacha 的
 *   `/common/hkrpg_gacha_record/api/` 不同——本插件不改写路径前缀，两套写法
 *   都不会踩到，见下方 request.url 注释）、`:223-225`（`sleep(0.3)` 每页延迟 +
 *   注释掉的每 10 页 `sleep(1)` 批量停顿 + `retryCount: 5`）、`:226-234`
 *   （响应信封 `res.data` 下 `list`/`region`/`region_time_zone` 同级）、
 *   `:451-452`（本地存档字段：仅保留 9 键，`uid`/`lang` 被丢弃，证明真实 API
 *   记录本身携带这两个字段——与下方「11 键」的任务简报口径互相印证）
 * - `docs/_internal/research/03-真实导出数据格式实测.md` §1.2（`gacha_id`）
 *   §1.3（元数据缺失真实样例，`item_id` 是唯一保证非空的锚点）§2.1（typeMap）
 *   §2.3（`region_time_zone` 是页级字段，不是逐条记录字段）
 * - 官方保底概率公示 JSON（`operation-webstatic.mihoyo.com/gacha_info/hkrpg/
 *   prod_gf_cn/<bannerId>/zh-cn.json`）——**已由主进程在任务简报阶段独立核验**，
 *   本 Agent 会话未重新抓取，`pityGroups` 里逐组标注了这条边界。
 * - `plugins/genshin/manifest.ts` / `plugins/wuwa/manifest.ts`（同族已落地插件，
 *   写法与注释密度对齐）
 */
import type { PluginManifest } from "gs-plugin-kit";

export { hooks } from "./hooks.ts";

/**
 * 从 `getGachaLog`/`getLdGachaLog` 响应体里取出本页记录数组。
 *
 * 真实响应形态是 `{ retcode, message, data: { list: [...], region, region_time_zone } }`
 * ——与原神同构，`region`/`region_time_zone` 与 `list` 同级，是页级元数据，
 * 不是逐条记录字段（`research/03` §2.3；`star-rail-warp-export/src/main/
 * getData.js:226-234` 的 `const { list, uid, region, region_time_zone } =
 * await getGachaLogs(...)` 印证三者从同一个 `res?.data` 对象解构而来）。
 * 防御式解析：任何一层形状不对就返回空数组而不是抛异常——分页引擎会把空数组
 * 当作 `emptyPage` 终止条件处理，比让一次偶发的畸形响应中断整条采集流程更安全。
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

/** 官方响应里的 `count` 是数字字符串（如 `"1"`），防御式转换，异常输入兜底为 1。 */
function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

// ============================================================
// 保底：5★ 软保底曲线的两套社区推算口径
// ============================================================
//
// ⚠️ **base / hardPity / guarantee 来自官方公示 JSON（已由主进程核验），
// curve 的 start / step 官方从未公示，是同人社区口径的推算值，不同来源在
// 73~75 之间不一致**——标注方式对齐 `plugins/genshin/manifest.ts:161-164`
// 的同款先例，不把推算值说成官方数值。

/** 角色类池（硬保底 90）的软保底曲线：74 抽起、每抽 +6%，同人社区口径。 */
const CHARACTER_SOFT_PITY_CURVE = {
  kind: "softPity" as const,
  base: 0.006,
  start: 74,
  step: 0.06,
};

/** 光锥类池（硬保底 80）的软保底曲线：按角色池口径等比例外推，65 抽起、每抽 +7%。 */
const LIGHT_CONE_SOFT_PITY_CURVE = {
  kind: "softPity" as const,
  base: 0.008,
  start: 65,
  step: 0.07,
};

export const manifest = {
  id: "starrail",
  displayName: { "zh-CN": "崩坏：星穹铁道" },
  sdkVersion: "1.0.0",
  platforms: ["windows"],
  maintainers: ["gacha-studio"],
  // exchangeFormats 不声明：星铁的 UIGF 字段映射未经真实实现校准，不在本次
  // 接入范围内编造（与 drills/starrail/manifest.ts 的既有立场一致）。

  // 图标地址来自 TapTap 应用市场页面，已实测验证，同 `plugins/genshin/
  // manifest.ts` 同款教训——地址以 .jpg 结尾但实际内容是 PNG，不要"纠正"
  // 扩展名，格式校验（content-type + magic bytes）是宿主侧职责。
  iconUrl:
    "https://img-tc.tapimg.com/market/images/1b7385da5dbf6d5342a832e6685e2066.png/_tap_appicon_m.jpg",

  collect: {
    paradigm: "credentialedApi",
    params: {
      credential: {
        kind: "chromiumCache",
        // 相对片段，不是绝对路径——绝对安装目录来自用户配置，由 Rust 侧拼接。
        gameDir: "StarRail_Data/webCaches",
        urlPattern: /https:\/\/.+?getGachaLog[^"]+/,
      },
      request: {
        // ⚠️ **端点路径前缀有两套写法，本插件不改写前缀**：参考实现
        // star-rail-warp-export 用 `/common/gacha_record/api/`
        // （getData.js:217），HoYo.Gacha 用 `/common/hkrpg_gacha_record/api/`
        // （game_biz/src/api.rs:42-46）。凭据 URL 是从游戏缓存里原样扫出来的
        // 完整请求 URL（含真实前缀），下面的模板用 `{{credential}}` 原串
        // 追加分页参数，不重新拼路径——无论真实客户端命中哪一套前缀都能正常
        // 工作。`banners[].endpointOverride`（见下方 banners）只替换 URL 的
        // 最后一个路径段（`getGachaLog` → `getLdGachaLog`），同样不关心前缀
        // 是哪一套，两种写法都不会踩雷。
        //
        // 参数名与原神模板一致：page/gacha_type/size/end_id，来源
        // star-rail-warp-export/src/main/getData.js:188（
        // `${url}&gacha_type=${key}&page=${page}&size=${20}${endId?'&end_id='+endId:''}`）。
        url: "{{credential}}&page={{page}}&gacha_type={{gachaType}}&size={{pageSize}}&end_id=0",
      },
      // 国服 + 国际服两个 host 都要收录，理由与 plugins/genshin/manifest.ts
      // 79-88 行同款教训一致：urlPattern 本身不区分域名，只要 URL 里出现
      // "getGachaLog" 就会匹配，若只声明国服 host，国际服玩家的正常请求会被
      // 误判为投毒而拒绝。两个域名已用 HoYo.Gacha 源码核实：
      // docs/example-projects/HoYo.Gacha/crates/game_biz/src/api.rs:42-43
      //   ((Hkrpg, Official), Standard) -> "https://public-operation-hkrpg.mihoyo.com/..."
      //   ((Hkrpg, Oversea),  Standard) -> "https://public-operation-hkrpg-sg.hoyoverse.com/..."
      allowedHosts: ["public-operation-hkrpg.mihoyo.com", "public-operation-hkrpg-sg.hoyoverse.com"],
      extractList: extractGachaLogList,
      // 限速策略：显式声明，取值抄自参考实现的真实行为——
      // star-rail-warp-export/src/main/getData.js:223（`await sleep(0.3)`
      // 每页延迟 300ms）、:219-222（每 10 页额外停顿 1s，该版本里这段被注释
      // 掉了，但数值本身仍是可信的参考实现设计意图）、:225（`retryCount: 5`）。
      // 宿主按"逐字段取更温和者"合并这里的声明与宿主本次会话的注入策略
      // （`crates/paradigms/gs-p-authkey/src/rate_limit.rs` 的
      // `merged_with_declared`）——任何一方都不能把另一方放松，因此这里填
      // "游戏 API 能受多少"，不需要担心被宿主的更激进策略覆盖。
      rateLimit: {
        perPageDelayMs: 300,
        batchSize: 10,
        batchDelayMs: 1000,
        retry: { maxAttempts: 5, delayMs: 5000 },
      },
      // bannerIdentity 不声明，缺省 "response"——这是显式决策，不是漏填。
      // 米哈游三游共享同一套 `getGachaLog` 响应形态，原神已实测证实会混池
      // （fixtures/genshin/raw_response/301_page_1.json：查询 gacha_type=301，
      // 响应里混回 gacha_type=400 的记录）。星铁是否会混池，本次任务简报与
      // research/03、04 均未给出星铁自身的独立混池实测，与鸣潮那种「已证实
      // 不混池」的情况不同——鸣潮能安全声明 "query"（见
      // plugins/wuwa/manifest.ts 的同名字段注释）是因为有真实存档实测背书，
      // 星铁没有。声明 "query" 一旦假设错误，混入的记录会被静默错误归池且
      // 极难定位，代价远高于"不声明、沿用更保守的默认值"，因此这里不赌。
    },
  },

  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("星铁 extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;

      // 星铁 API 原生返回 item_id——与原神不同（原神 getGachaLog 不返回
      // item_id，itemId 只能退而求其次用本地化物品名，见
      // plugins/genshin/manifest.ts 的详细说明）。真实记录样例见 research/03
      // §1.3：该样例恰好是一条元数据缺失记录（item_id="1223" 有真实值，
      // name/item_type/rank_type 全为空字符串）——这条样例反而更有说服力，
      // 证明 item_id 是这类异常记录里唯一仍然保证非空的锚点。
      const itemId = toNonEmptyString(record.item_id);
      if (!itemId) {
        throw new Error("星铁 extractRecord：记录缺少 item_id，无法确定 itemId");
      }

      return {
        itemId,
        time: toNonEmptyString(record.time) ?? "",
        // bannerId 用 gacha_type（卡池类别码：1/2/11/12/21/22），不是
        // gacha_id——gacha_id 是具体卡池实例 id（如同一类别码下随时间推出的
        // 不同期数，research/03 §1.2 实测有 49 种真实取值）。把它塞进
        // bannerId 会导致 banners[] 需要枚举持续增长的实例 id，维护负担远
        // 高于按类别声明，因此卡池归属仍然只用 gacha_type 这一层类别；
        // gacha_id 改走下方独立的 gachaId 字段留底（不参与卡池归属判定）。
        bannerId: toNonEmptyString(record.gacha_type) ?? "",
        count: toCount(record.count),
        name: toNonEmptyString(record.name),
        itemType: toNonEmptyString(record.item_type),
        rarity: toNonEmptyString(record.rank_type),
        stableId: toNonEmptyString(record.id),
        // 星铁 API 原生返回 gacha_id（真实存档实测，research/03 §1.2/§1.3
        // 样例记录里的 "gacha_id": "2041"）。UnifiedRecordFields.gachaId 现已
        // 承载这个字段（UIGF v4.2 hkrpg 段把它列为 required），原样落库留底；
        // ⚠️ 不用它做卡池归属判定——49 种真实取值无法可靠映射回稳定的
        // BannerSpec，理由同上方 bannerId 的说明，本次改动不改变这一点。
        gachaId: toNonEmptyString(record.gacha_id),
      };
    },
  },

  // 卡池类别码与显示名，直接取自 research/03 §2.1 的 typeMap 实测结果，
  // 官方展示名沿用任务简报口径（1/2 两个池的第三方导出工具 typeMap 用的是
  // 通用标签"常驻跃迁"/"新手跃迁"，不是游戏内官方展示名"群星跃迁"/
  // "始发跃迁"——两者指向同一个 gacha_type，只是标签来源不同，如实标注）。
  banners: [
    { id: "1", displayName: { "zh-CN": "群星跃迁" } },
    { id: "2", displayName: { "zh-CN": "始发跃迁" } },
    { id: "11", displayName: { "zh-CN": "角色活动跃迁" } },
    { id: "12", displayName: { "zh-CN": "光锥活动跃迁" } },
    // 联动跃迁走独立端点，来源 star-rail-warp-export/src/main/getData.js:216
    // （`['21','22'].includes(key) ? 'getLdGachaLog' : 'getGachaLog'`），
    // HoYo.Gacha 的 game_biz/src/api.rs:45-46（Collaboration 分支）同样印证。
    { id: "21", displayName: { "zh-CN": "角色联动跃迁" }, endpointOverride: "getLdGachaLog" },
    { id: "22", displayName: { "zh-CN": "光锥联动跃迁" }, endpointOverride: "getLdGachaLog" },
  ],

  // ============================================================
  // pityGroups：6 个卡池各自独立一组，联动池不与常规池合并
  // ============================================================
  //
  // base / hardPity / guarantee 三项取自官方保底概率公示 JSON
  // （operation-webstatic.mihoyo.com/gacha_info/hkrpg/prod_gf_cn/<id>/
  // zh-cn.json，已由主进程独立核验，本 Agent 会话未重新抓取），可信度视为
  // 「官方」。curve 的 start/step 是同人社区推算值，非官方，见上方
  // CHARACTER_SOFT_PITY_CURVE / LIGHT_CONE_SOFT_PITY_CURVE 的注释。
  //
  // ⚠️ **21/22 联动池保底独立于 11/12 常规池，不合并 members**——官方公示
  // JSON 原文（已由主进程核验）：「在任意「Fate[UBW] 角色联动跃迁」中未获取
  // 5星角色的累计跃迁次数会一直累计于「Fate[UBW] 角色联动跃迁」中，与其他
  // 跃迁的跃迁次数保底相互独立计算，互不影响。」这条此前是本项目的未决项，
  // 现已有官方原文背书，21/22 各自单独成组。
  pityGroups: [
    {
      key: "characterEventWarp", // 11 角色活动跃迁
      members: ["11"],
      hardPity: 90,
      curve: CHARACTER_SOFT_PITY_CURVE,
      guarantee: { kind: "fiftyFifty" }, // 50% 直接 UP，歪则下次必中
    },
    {
      key: "lightConeEventWarp", // 12 光锥活动跃迁
      members: ["12"],
      hardPity: 80,
      curve: LIGHT_CONE_SOFT_PITY_CURVE,
      guarantee: { kind: "weighted", rateUpChance: 0.75 }, // 75% 直接 UP
    },
    {
      key: "stellarWarp", // 1 群星跃迁（常驻），无 UP
      members: ["1"],
      hardPity: 90,
      curve: CHARACTER_SOFT_PITY_CURVE,
      guarantee: { kind: "none" },
    },
    {
      key: "departureWarp", // 2 始发跃迁（新手），无 UP
      members: ["2"],
      hardPity: 50,
      // ⚠️ **start/step 未覆盖，如实留空用 custom 占位，不外推**：任务简报
      // 给出的两条社区推算口径分别对应硬保底 90（角色类）与硬保底 80
      // （光锥类）两档，本卡池硬保底 50，不属于任一档；没有第三档的推算值
      // 可用，也没有分桶命中率数据支撑现推一条新曲线。处理方式对齐
      // plugins/wuwa/manifest.ts 对无分桶数据支撑曲线的一贯做法
      // （`wuwa-unconfirmed-*star-pool-*` 占位 id）。
      curve: { kind: "custom", id: "starrail-unconfirmed-softpity-pool-2" },
      guarantee: { kind: "none" },
    },
    {
      key: "characterEventWarpCollab", // 21 角色联动跃迁，独立保底，不与 11 合并
      members: ["21"],
      hardPity: 90,
      curve: CHARACTER_SOFT_PITY_CURVE,
      guarantee: { kind: "fiftyFifty" },
    },
    {
      key: "lightConeEventWarpCollab", // 22 光锥联动跃迁，独立保底，不与 12 合并
      members: ["22"],
      hardPity: 80,
      curve: LIGHT_CONE_SOFT_PITY_CURVE,
      guarantee: { kind: "weighted", rateUpChance: 0.75 },
    },
  ],
  // 本轮只声明 5★ 保底组，不声明 4★ 组——基线 plugins/genshin/manifest.ts
  // 同样没有 4★ 分组，保持可比；本轮未覆盖，留待后续有分桶数据支撑时再补。

  rarity: {
    ladder: ["3", "4", "5"],
    pityTarget: "5",
    tierLabels: {
      "3": { "zh-CN": "三星" },
      "4": { "zh-CN": "四星" },
      "5": { "zh-CN": "五星" },
    },
  },

  time: {
    // 直连官方 API，得到的是服务器本地时间字符串，不带时区
    // （research/03 §2.3："时间字符串一律不带时区，是服务器本地时间"）。
    rawTimeConvention: "serverLocal",
    // region_time_zone 是响应体 data 层的页级字段（与 list 同级，不是逐条
    // 记录字段）——来源 research/03 §2.3「星铁 region_time_zone=8」+
    // star-rail-warp-export/src/main/getData.js:226-234（`res?.data` 解构出
    // `list`/`region`/`region_time_zone` 三者同级）。宿主的
    // `read_page_level_field` 已实装（不同于 drills/starrail/manifest.ts
    // 撰写时 M1-S7 的状态——当时这个分支从未被消费，标了
    // `#[allow(dead_code)]`，M2 已实装并被真实消费），因此这里不需要
    // hooks.resolveTimezone，宿主会直接从响应体页级字段读取偏移量。
    timezoneSource: { kind: "apiField", field: "region_time_zone" },
    // rawFormat 不填：响应 time 是空格分隔格式 "YYYY-MM-DD HH:mm:ss"
    // （如 research/03 §1.3 样例 "2024-09-10 10:05:26"），恰好是
    // RawTimeFormat 的默认值 spaceSeparated，不需要显式声明。
  },

  preconditions: [
    {
      id: "starrail.credential.cacheDirExists",
      capability: "credential",
      level: "required",
      describe: {
        "zh-CN": "自动获取跃迁记录要求游戏客户端至少运行过一次，缓存目录才会被创建",
      },
      // 同原神先例：HostEnv 目前没有「credential.gameDir 声明的缓存目录是否
      // 已被观测到」这一事实，check 只能返回 unknown。
      check: () => ({ kind: "unknown" }),
      remedy: { "zh-CN": "请先启动游戏并打开一次跃迁记录页，再回到本应用重试" },
    },
  ],

  // 与原神一致的范式 A 通用基线策略：分页响应自带总条数，零成本、全覆盖、
  // 无额外凭据风险。
  baseline: { kind: "inGamePageCount" },

  retention: {
    displayText: { "zh-CN": "6 个月" },
    // 官方 API 只返回近 6 个月记录，月长不一，按 6×28=168 天这类较短值取，
    // 告警宁早勿晚，展示文案一律用「6 个月」——口径与 genshin 一致，来源
    // research/02-异环NTE采集方案调研.md §5.1：「原神 / 星铁 / 绝区零 |
    // 约 6 个月」。
    conservativeDays: 6 * 28,
  },

  // itemIdSource 不声明，默认 "native"。这是与原神的清晰对照：原神因为 API
  // 不返回 item_id 才需要显式声明 "displayName"；星铁的 item_id 是 API 原生
  // 字段（真实存档统计证实，见上方 fields.extractRecord 内的说明），不需要
  // 这个特例。

  // metadata 不声明。research/03 §1.3 指出星铁存档确有元数据缺失记录
  // （1/5372），MetadataProvider 的"事后回填"能力对星铁是必要的，但静态
  // 字典内容本次未获取，不编造字典内容，留空与原神现状一致
  // （plugins/genshin/manifest.ts 同样未声明 metadata）——本轮未覆盖。

  // drawCounting 不声明，默认 perRecord（米哈游三游 count 恒为 1，适用）。
} satisfies PluginManifest;
