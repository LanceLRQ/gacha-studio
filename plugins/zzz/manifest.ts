/**
 * 绝区零插件 manifest。
 *
 * 采集范式：credentialedApi（`gs-p-authkey`），凭据来源与原神同款——玩家打开
 * 讯号（抽卡）记录页时，客户端 webview 会命中官方 `getGachaLog` 接口并带上
 * authkey，请求 URL 被写入 `webCaches` 目录下 `Cache/Cache_Data/data_2` 缓存
 * 索引文件（同 `plugins/genshin/manifest.ts` 顶部说明，两者是同一套凭据获取
 * 机制，只是 `gameDir` 片段不同）。
 *
 * 本文件是 `drills/zzz/manifest.ts`（M1-S7 纸面填表演练草稿）的可运行版本，
 * 转化时按以下资料重新校准，草稿里标注为「未覆盖 / 需实测」的几处已用真实
 * 源码补齐（详见各字段旁注释），不再是推断：
 * - `docs/example-projects/HoYo.Gacha/crates/game_biz/src/api.rs:49-50`
 *   （`allowedHosts` 两个域名 + 默认端点完整路径 `/common/gacha_record/api/getGachaLog`）
 * - `docs/example-projects/HoYo.Gacha/crates/game_biz/src/lib.rs:145-149,200-204`
 *   （`timezoneSource.table` 五条区服码到 UTC 偏移量的完整映射）
 * - `docs/example-projects/HoYo.Gacha/crates/url_scraper/src/types.rs:60-160`
 *   （`GachaLog` 结构体：`gacha_type`/`item_id`/`item_type`/`rank_type`/`gacha_id`
 *   四款米哈游游戏共用同一套字段定义，绝区零没有任何字段名特例）
 * - `docs/example-projects/zzz-signal-search-export/src/main/getData.js:23-39,199-249,477-478`
 *   （`real_gacha_type` 分页参数名、限速与重试的真实实现、响应记录 9 键结构、
 *   卡池类别码表）
 * - 真实抽卡存档实测（本地脱敏样本，见 `fixtures/zzz/meta.toml`）：
 *   `gacha_id` 恒为 `'0'`、`count` 恒为 `'1'`、`id` 恒为 19 位数字字符串、
 *   `item_type`/`rank_type` 组合不是笛卡尔积（音擎独有 B 级）
 * - 官方保底概率公示 JSON（`operation-webstatic.mihoyo.com/gacha_info/nap/...`），
 *   见下方 `pityGroups` 旁注释
 *
 * exchangeFormats 不声明：绝区零的 UIGF 字段映射未经真实实现校准，本 Stage
 * 不在没有校准的情况下编造导出格式支持（与 `drills/zzz/manifest.ts` 的判断
 * 一致，原神已实现的 `uigf-v4` 不代表绝区零可以直接照抄同一份声明）。
 */
import type { PluginManifest } from "gs-plugin-kit";

export { hooks } from "./hooks.ts";

/**
 * 从 `getGachaLog` 响应体里取出本页记录数组。
 *
 * 真实响应形态 `{ retcode, message, data: { list: [...], region } }` 与原神
 * 完全同构，已用 `zzz-signal-search-export/src/main/getData.js:203-204`
 * （`res?.data?.list` 判空、`res.region` 取值）核实，不是类比推断。防御式
 * 解析：任何一层形状不对就返回空数组而不是抛异常，交给分页引擎按空页处理。
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

/** 官方响应里的 `count` 是数字字符串（真实存档实测恒为 `"1"`），防御式转换，异常输入兜底为 1。 */
function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

// ============================================================
// 5★（S 级）保底曲线
// ============================================================
//
// base / hardPity / guarantee 三项取自官方保底概率公示 JSON（一手数据，
// `https://operation-webstatic.mihoyo.com/gacha_info/nap/prod_gf_cn/<id>/zh-cn.json`）；
// start / step 官方从未公示，按同人社区口径推算——与
// `plugins/genshin/manifest.ts:161-164` 同一处理方式（90 硬保底沿用原神
// 「74 抽起每抽 +6%」的口径；80 硬保底按比例换算，取 `start: 65, step: 0.07`，
// **这两个数字本身没有官方来源，纯粹是按 90→74/0.06 的比例外推**）。
// ⚠️ 不要把 start/step 误当官方数值使用。
const EXCLUSIVE_CURVE = { kind: "softPity", base: 0.006, start: 74, step: 0.06 } as const;
const W_ENGINE_CURVE = { kind: "softPity", base: 0.01, start: 65, step: 0.07 } as const;

export const manifest = {
  id: "zzz",
  displayName: { "zh-CN": "绝区零" },
  sdkVersion: "1.0.0",
  platforms: ["windows"],
  maintainers: ["gacha-studio"],

  // exchangeFormats 不声明，见文件头注释。

  // 图标地址来自 TapTap 应用市场页面，已实测验证，同 `plugins/genshin/
  // manifest.ts` 同款教训——地址以 .jpg 结尾但实际内容是 PNG，不要"纠正"
  // 扩展名，格式校验（content-type + magic bytes）是宿主侧职责。
  iconUrl:
    "https://img-tc.tapimg.com/market/images/cca4b17d6dd9030037095c19aa9fe78a.png/_tap_appicon_m.jpg",

  collect: {
    paradigm: "credentialedApi",
    params: {
      credential: {
        kind: "chromiumCache",
        // ⚠️ 相对片段，不是绝对路径。来源 research/01「数据采集原理分层」
        // 范式 A 通用结论：{安装目录}/ZenlessZoneZero_Data/webCaches/{版本}/
        // Cache/Cache_Data/data_2。
        gameDir: "ZenlessZoneZero_Data/webCaches",
        // 端点最后一段是 "getGachaLog"（与原神/星铁同名），已用
        // HoYo.Gacha `crates/game_biz/src/api.rs:49-50` 的完整路径
        // "https://public-operation-nap(-sg).../common/gacha_record/api/getGachaLog"
        // 核实——drills 草稿里"端点字面名未覆盖，需实测"这条 TODO 已解决。
        urlPattern: /https:\/\/.+?getGachaLog[^"]+/,
      },
      request: {
        // ★ 差异点：分页参数名是 real_gacha_type，不是 gacha_type——直接写
        // 进这一行字符串模板，不需要任何额外声明字段。这是对
        // `CredentialedApiPipelineParams.pageSize` 文档里那条"绝区零的
        // real_gacha_type 差异照样只改自己那一行模板"结论的实际落地，来源
        // `zzz-signal-search-export/src/main/getData.js:202`：
        //   `${url}&real_gacha_type=${key}&page=${page}&size=${20}...`
        //
        // end_id=0：与原神/星铁的写法一致，作为每页固定追加的常量参数。
        // ⚠️ 真实参考实现里 end_id 其实是会变化的游标（同文件同一行的
        // `${endId ? '&end_id=' + endId : ''}`，取上一页最后一条记录的
        // id），但本项目的 L1 分页引擎按页码递增翻页、不追踪游标（未声明
        // `extractCursor` 时的缺省行为），固定传 0 是沿用同族约定，未针对
        // 绝区零独立验证"服务端在 end_id 恒为 0 时是否仍能正确翻页"——与
        // `drills/zzz/manifest.ts` 对这个参数的态度一致（未独立实测）。
        url: "{{credential}}&page={{page}}&real_gacha_type={{gachaType}}&size={{pageSize}}&end_id=0",
      },
      // 两个 host 都必须填：urlPattern 本身不区分域名，只要 URL 里出现
      // "getGachaLog" 就会匹配，国服/国际服客户端缓存都可能命中——只填国服
      // 会把国际服玩家的正常请求误判为投毒（同原神 manifest 79-88 行的教训）。
      // 两个域名与默认端点路径已用 HoYo.Gacha 源码核实（非本插件独立实测，
      // 仅作事实引用）：
      //   crates/game_biz/src/api.rs:49
      //     ((Nap, Official), Standard) -> "https://public-operation-nap.mihoyo.com/common/gacha_record/api/getGachaLog"
      //   crates/game_biz/src/api.rs:50
      //     ((Nap, Oversea),  Standard) -> "https://public-operation-nap-sg.hoyoverse.com/common/gacha_record/api/getGachaLog"
      // 与 `zzz-signal-search-export/src/main/getData.js:15`（国服域名）、
      // `:322-324`（国际服域名切换分支）互相印证。
      allowedHosts: ["public-operation-nap.mihoyo.com", "public-operation-nap-sg.hoyoverse.com"],
      extractList: extractGachaLogList,

      // 限速策略：宿主按字段逐一取"更温和者"与缺省值合并，不是整体覆盖
      // （见 `CredentialedApiPipelineParams.rateLimit` 文档）。数值直接取自
      // 参考实现 `zzz-signal-search-export/src/main/getData.js`：
      //   :234（`await sleep(0.3)`，每页请求后固定等待）
      //   :227-230（`if (page % 10 === 0) { ...; await sleep(1) }`，每 10 页
      //     额外多等 1 秒）
      //   :199-212（`getGachaLog` 递归重试，初始 `retryCount: 5`，重试间隔
      //     `await sleep(5)`）
      // perPageDelayMs/retry.maxAttempts 恰好与宿主缺省值相同，这里仍然显式
      // 声明——理由是"这个数字有出处"本身就是文档，不是为了改变缺省行为。
      rateLimit: {
        perPageDelayMs: 300,
        batchSize: 10,
        batchDelayMs: 1000,
        retry: { maxAttempts: 5, delayMs: 5000 },
      },

      // bannerIdentity 不声明，缺省 "response"——米哈游三游都可能混池（原神
      // 已实测 301 响应里混回 400 的记录，见 `plugins/genshin/manifest.ts`
      // banners 注释），绝区零虽然本插件尚未拿到"响应混池"的直接证据，但
      // 也没有证据排除，按同族保守假设继续信响应，不贸然声明 "query"——
      // `bannerIdentity` 文档明确警告过："若某游戏其实会混池却声明了
      // query，被混进来的记录会被静默错误归池"，代价不对称，因此不写这
      // 一行（缺省即正确选择），仅在此注释里说明为什么不写。
    },
  },

  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("绝区零 extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;

      // 响应记录 11 键（真实存档实测 + `zzz-signal-search-export/src/main/getData.js:477-478`
      // 双来源确认一致）：id / uid / gacha_type / gacha_id / item_id / count /
      // time / name / item_type / rank_type / lang。与原神不同，绝区零 API
      // 直接返回 item_id（HoYo.Gacha `crates/url_scraper/src/types.rs:144-149`：
      // "Except for 'Genshin Impact'"，即绝区零、星铁均有此字段），因此 itemId
      // 取 item_id，不走原神那条"本地化物品名兜底"的特例路径，也不需要声明
      // `itemIdSource`（缺省 "native" 即正确）。
      const itemId = toNonEmptyString(record.item_id);
      if (!itemId) {
        throw new Error("绝区零 extractRecord：记录缺少 item_id，无法确定 itemId");
      }

      return {
        itemId,
        time: toNonEmptyString(record.time) ?? "",
        // ⚠️ **推断，非实测**：查询参数名已确认改成了 real_gacha_type
        // （`getData.js:202`），但响应记录里对应字段的键名是否也叫
        // real_gacha_type、还是仍然叫 gacha_type，research/03、04 均未直接
        // 给出。这里选择继续读 record.gacha_type——最强旁证是 HoYo.Gacha
        // `crates/url_scraper/src/types.rs:80-90` 的 `GachaLog.gacha_type`
        // 字段：四款米哈游游戏（含绝区零）共用同一个 `gacha_type` 反序列化
        // 目标，doc comment 没有为绝区零留任何字段名特例（唯一的特例注释是
        // "Genshin Impact: Miliastra Wonderland"，与绝区零无关）。是旁证，
        // 不是直接实测绝区零某一条真实响应报文得出的结论，如实标注。
        bannerId: toNonEmptyString(record.gacha_type) ?? "",
        count: toCount(record.count),
        name: toNonEmptyString(record.name),
        // 第三档物品分类"邦布"——itemType 本来就是自由字符串
        // （`UnifiedRecordFields.itemType?: string`），装两档还是三档对类型
        // 系统没有区别，不需要任何新字段。
        itemType: toNonEmptyString(record.item_type),
        rarity: toNonEmptyString(record.rank_type),
        stableId: toNonEmptyString(record.id),
        // gacha_id 恒为 '0'（真实存档实测全量记录一致），刻意不读取——
        // ⚠️ **前提已更新**：`UnifiedRecordFields` 现在有 `gachaId` 字段了
        // （星铁插件已接入，见 `plugins/starrail/manifest.ts`），"没有字段能
        // 承载它"不再是理由。绝区零仍然不读的真实理由：UIGF v4.2 权威 JSON
        // Schema 里 `nap`（绝区零）段把 `gacha_id` 列为**可选**（不像
        // `hkrpg` 段列为必填），且这个值恒为 '0'，读了没有信息量——落这一列
        // 不会让任何下游判断变得更准。卡池期次归属仍然完全交给 bannerId
        // （gacha_type 类别码）+ 外部 banner 元数据推导，不依赖 gacha_id。
        // ⚠️ 不要把 "恒为 '0'" 当成能依赖的断言去写校验逻辑：HoYo.Gacha
        // `crates/url_scraper/src/types.rs:97-102` 对这个字段用的是"容忍空
        // 字符串"的反序列化（`gacha_log_empty_string_number_into`），说明真实
        // 响应里这个字段可能是空串，不永远是字面量 "0"。
      };
    },
  },

  // 卡池类别码与显示名，双来源确认一致：真实存档 `typeMap` 字段 +
  // `zzz-signal-search-export/src/main/getData.js:23-30` 的 `defaultTypeMap`，
  // 6 项逐条对上，零分歧。
  //
  // ⚠️ 跨游戏复用陷阱：id "2" 在星铁是"新手池"，在绝区零是"独家频段"
  // （角色 UP 池，等价于原神的角色活动祈愿）——同一个 id 在两个插件里语义
  // 相反，不能把某个游戏的 banner id 常量当成"跨游戏通用"去复用。
  //
  // 均不需要 endpointOverride——research/04 与本次核实的源码均未观测到绝区零
  // 存在类似星铁 21/22 的端点分流。
  banners: [
    { id: "1", displayName: { "zh-CN": "常驻频段" } },
    { id: "2", displayName: { "zh-CN": "独家频段" } },
    { id: "3", displayName: { "zh-CN": "音擎频段" } },
    { id: "5", displayName: { "zh-CN": "邦布频段" } },
    { id: "102", displayName: { "zh-CN": "独家重映" } },
    { id: "103", displayName: { "zh-CN": "音擎回响" } },
  ],

  // ============================================================
  // pityGroups：base/hardPity/guarantee 取自官方保底概率公示 JSON
  // （operation-webstatic.mihoyo.com/gacha_info/nap/prod_gf_cn/<id>/zh-cn.json，
  // 一手数据）；start/step 是社区推算，非官方，见上方 EXCLUSIVE_CURVE /
  // W_ENGINE_CURVE 声明旁的说明。本轮只声明 S 级（rarity.pityTarget 对应档）
  // 保底组，不声明 A 级组——基线 `plugins/genshin/manifest.ts` 同样只有一个
  // pityGroup，保持可比，A 级保底本轮未覆盖。
  // ============================================================
  pityGroups: [
    {
      key: "exclusiveChannel",
      members: ["2"],
      hardPity: 90,
      curve: EXCLUSIVE_CURVE,
      // 独家频段：S 级 50% 概率直接是 UP 角色，歪一次后下一次必定 UP。
      guarantee: { kind: "fiftyFifty" },
    },
    {
      key: "wEngineChannel",
      members: ["3"],
      hardPity: 80,
      curve: W_ENGINE_CURVE,
      // 音擎频段：75% 直接 UP（不是 50%），公示 JSON 原文
      // up_prob 对应这一档，用 weighted 而不是 fiftyFifty 表达非对称比例。
      guarantee: { kind: "weighted", rateUpChance: 0.75 },
    },
    {
      key: "standardChannel",
      members: ["1"],
      hardPity: 90,
      curve: EXCLUSIVE_CURVE,
      // 常驻频段：没有 UP 角色的概念，抽到 S 级就是抽到 S 级，不存在"歪"。
      guarantee: { kind: "none" },
    },
    {
      key: "bangbooChannel",
      members: ["5"],
      hardPity: 80,
      curve: W_ENGINE_CURVE,
      // 邦布频段：玩家预先指定目标邦布，触发 S 级时官方公示 up_prob 是
      // "100.000%"——没有"歪"的概念，用 alwaysRateUp 而不是 weighted:1
      // 更准确地表达"这个池子结构上不存在非 UP 结果"。
      guarantee: { kind: "alwaysRateUp" },
    },
    {
      // ⚠️ 102（独家重映）与 2（独家频段）是否共享保底计数——**未确证**。
      // 官方概率公示页用的是另一套内部编号，与抽卡记录 API 的 gacha_type
      // 对不上，无法直接比对；第三方 wiki 称独立但没有官方确认。这里按
      // "独立保底组"处理，是保守选择而非已验证结论——若后续证实 102 与 2
      // 实际共享保底计数，需要把这里合并成同一个 PityGroup（改 members:
      // ["2", "102"]），现在先分开建组，避免编造一个未经验证的合并关系。
      key: "exclusiveChannelRerun",
      members: ["102"],
      hardPity: 90,
      curve: EXCLUSIVE_CURVE,
      guarantee: { kind: "fiftyFifty" },
    },
    {
      // 同上：103（音擎回响）与 3（音擎频段）的保底共享关系同样未确证，
      // 独立建组，理由与 102 完全一致。
      key: "wEngineChannelEcho",
      members: ["103"],
      hardPity: 80,
      curve: W_ENGINE_CURVE,
      guarantee: { kind: "weighted", rateUpChance: 0.75 },
    },
  ],

  // ★ 本插件最重要的验证点：稀有度阶梯是 2/3/4，不是 3/4/5——真实存档全量
  // 记录实测 rank_type 只出现这三个值，最高档是 4（S 级）不是 5。宿主查询
  // 保底命中必须走 `WHERE rarity = :pity_target`，不能有任何 "= 5" 字面量。
  // 档位文案 B/A/S——绝区零官方术语，不是"2星/3星/4星"（那套说法在这个
  // 游戏里根本不存在，见 RaritySpec.tierLabels 字段文档）。
  rarity: {
    ladder: ["2", "3", "4"],
    pityTarget: "4",
    tierLabels: {
      "2": { "zh-CN": "B" },
      "3": { "zh-CN": "A" },
      "4": { "zh-CN": "S" },
    },
  },

  time: {
    // 直连官方 API 得到的是服务器本地时间，不经过任何第三方工具的二次
    // 本地化处理——已用 `zzz-signal-search-export/src/main/getData.js:460-474`
    // 源码核实：该工具会把 `item.time` 从 `region_time_zone` 换算到
    // `localTimeZone`（多账号合并场景下两者可能不同）；但本插件不经过这层
    // 工具处理，直连 API 拿到的就是原始服务器本地时间字符串，不适用这条
    // 换算风险。
    rawTimeConvention: "serverLocal",
    // 差异点：时区来源是 region 字段 + 客户端静态表，不是 apiField——
    // API 只返回 region（如 "prod_gf_cn"），不返回任何形式的 UTC 偏移量，
    // 换算表由客户端维护。
    timezoneSource: {
      kind: "staticTable",
      field: "region",
      // 五条区服码到 UTC 偏移量的完整映射，双来源逐项核对一致，零分歧：
      //   `zzz-signal-search-export/src/main/getData.js:33-39`（serverTimeZone）
      //   `HoYo.Gacha/crates/game_biz/src/lib.rs:145-149`（区服码字符串常量）
      //     与 `:200-204`（NAP_CN/NAP_GLOBAL_JP/EU/US/SG 五个变体绑定的偏移量）
      // ⚠️ prod_gf_jp 名字像日服，实际是亚服——HoYo.Gacha 源码在这一行的
      // 行尾注释直书 "// Asia"（lib.rs:201），不要按字面名误判成日本时区。
      table: {
        prod_gf_cn: 8,
        prod_gf_jp: 8,
        prod_gf_us: -5,
        prod_gf_eu: 1,
        prod_gf_sg: 8,
      },
    },
    // rawFormat 不声明——响应 time 字段是空格分隔的 "YYYY-MM-DD HH:mm:ss"
    // （真实存档实测一致），正好是 L1 范式层的缺省值 spaceSeparated，不需要
    // 显式覆盖。
  },

  // 与原神一致的范式 A 通用基线策略，非绝区零专属差异点：分页响应能拿到的
  // 只是「这一页有没有更多」，官方也没有另外的权威聚合统计接口，因此用
  // inGamePageCount（零成本、全覆盖、无额外凭据风险），不是绝区零特有决策。
  baseline: { kind: "inGamePageCount" },

  retention: {
    displayText: { "zh-CN": "6 个月" },
    conservativeDays: 6 * 28,
  },

  // itemIdSource 不声明，缺省 "native"——见上方 extractRecord 里 itemId
  // 旁的说明：绝区零 API 直接返回 item_id，不是原神那种"本地化物品名"特例。

  // preconditions / metadata 均不声明——原神那条"游戏至少运行过一次，缓存
  // 目录才会被创建"的前置条件机制上对绝区零同样成立（同一套 chromiumCache
  // 凭据获取机制），但本次任务的资料范围（research/01、03、04 +
  // 上面列出的源码引用）没有覆盖绝区零专属的前置条件差异，不额外编造，
  // 判断与 `drills/zzz/manifest.ts` 一致。
} satisfies PluginManifest;
