/**
 * 原神插件 manifest。
 *
 * 采集范式：authkey（`gs-p-authkey`），凭据来源是游戏内置 Chromium 组件的
 * 磁盘缓存——玩家打开祈愿记录页时，客户端会以 webview 加载记录页面，其中一次
 * 请求会命中官方 `getGachaLog` 接口并带上 `authkey`，这个请求 URL 会被写入
 * `webCaches` 目录下某个版本号子目录内的 `Cache/Cache_Data/data_2` 缓存索引文件
 * （注意：JSDoc 注释里不能出现字面量 "星号+斜杠"，故此处不写通配符形式的路径）。
 *
 * 字段形状与真实行为已对照以下资料校准，避免重蹈 `CLAUDE.local.md` 记录过的
 * 「未校准就写实现」的错误（鸣潮凭据路径三处推翻的教训）：
 * - docs/_internal/research/03-真实导出数据格式实测.md §一、§二
 * - docs/_internal/research/04-同族工具三方源码对比.md §4.1～§4.9
 * - docs/example-projects/genshin-wish-export/src/main/getData.js（分页/合并/限速实现）
 * - docs/example-projects/HoYo.Gacha/crates/url_scraper/src/types.rs（`GachaLog` 字段定义，
 *   确认原神 API 响应里没有 `item_id` 字段——与星铁/绝区零不同）
 * - docs/example-projects/HoYo.Gacha/crates/url_finder/src/lib.rs（`REGEX_GACHA_URL`，
 *   确认缓存里命中的是 `.../gacha_info/api/getGachaLog?...authkey=...` 这条真实请求 URL）
 */
import type { PluginManifest } from "gs-plugin-kit";

export { hooks } from "./hooks.ts";

/**
 * 从 `getGachaLog` 响应体里取出本页记录数组。
 *
 * 真实响应形态是 `{ retcode, message, data: { list: [...], region } }`
 * （HoYo.Gacha `MihoyoResponse<GachaLogs>` / genshin-wish-export
 * `getGachaLog` 里的 `res.data.list`）。防御式解析：任何一层形状不对就返回
 * 空数组而不是抛异常——分页引擎会把空数组当作 `emptyPage` 终止条件处理，
 * 这比让一次偶发的畸形响应中断整条采集流程更安全。
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

export const manifest = {
  id: "genshin",
  displayName: { "zh-CN": "原神" },
  sdkVersion: "1.0.0",
  platforms: ["windows"],
  maintainers: ["gacha-studio"],
  exchangeFormats: ["uigf-v4"],

  collect: {
    paradigm: "credentialedApi",
    params: {
      credential: {
        kind: "chromiumCache",
        // ⚠️ 相对片段，不是绝对路径——绝对安装目录来自用户配置，由 Rust 侧拼接。
        gameDir: "YuanShen_Data/webCaches",
        urlPattern: /https:\/\/.+?getGachaLog[^"]+/,
      },
      request: {
        url: "{{credential}}&page={{page}}&gacha_type={{gachaType}}&size={{pageSize}}&end_id=0",
      },
      extractList: extractGachaLogList,
    },
  },

  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("原神 extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;

      const name = toNonEmptyString(record.name);
      const stableId = toNonEmptyString(record.id);
      // ⚠️ 原神 API 不返回 item_id——已用源码核实：HoYo.Gacha 的
      // `crates/url_scraper/src/types.rs:150` 是 `item_id: Option<u32>`，
      // 且 `has_item_id()` 的 doc comment 直书 "Except for 'Genshin Impact'"。
      //
      // 因此这里的 itemId 是**临时值：本地化物品名**，不是真正的物品标识。
      // 后果必须说清楚，否则下一个读这段代码的人会以为它已经对了：
      //   ① item_catalog 主键是 (plugin_id, item_id, lang)。itemId 若是本地化名，
      //      同一个角色在 zh-cn 与 en-us 下会产出两个不同的 item_id，跨语言聚合失效；
      //   ② `gacha_record.lang` 这一列的设计意图（research/05 §2.2）正是
      //      「name→item_id 反查依赖 locale，字典更新后要能重放校正」——
      //      而反查这一步现在根本没发生；
      //   ③ 更要命的是 name 与 rarity 都有值，归一化层按现有规则会把这类记录标成
      //      meta_state='complete'，于是 idx_record_meta_pending 那条部分索引
      //      永远扫不到它们——**错的数据被标记为完整，没有任何机制会来纠正**。
      //
      // 不在本 Stage 编造 metadata.parseResponse（UIGF 字典 API 的响应形状尚未
      // 用真实实现校准，硬约束禁止未校准就写实现）。但这个缺口不能停在注释里：
      // 已列为 M1-S3 归一化层与 M1-S5 元数据消费的阻塞项，见
      // `milestones/02-M1-原神插件全链路.md` S3、S5 的 checklist。
      const itemId = name ?? stableId;
      if (!itemId) {
        throw new Error("原神 extractRecord：记录既无 name 也无 id，无法确定 itemId");
      }

      return {
        itemId,
        time: toNonEmptyString(record.time) ?? "",
        // 保留每条记录自己的原始 gacha_type（而不是本次查询用的池子 id）——
        // 301 分组里混有 gacha_type: "400" 的记录是原神的真实行为
        // （research/03 §2.2，6170 条组内混有两种取值），必须原样保留才能让
        // pityGroups 的 301/400 合并生效，也是留底、可重放的前提。
        bannerId: toNonEmptyString(record.gacha_type) ?? "",
        count: toCount(record.count),
        name,
        itemType: toNonEmptyString(record.item_type),
        rarity: toNonEmptyString(record.rank_type),
        stableId,
      };
    },
  },

  banners: [
    { id: "301", displayName: { "zh-CN": "角色活动祈愿" } },
    { id: "302", displayName: { "zh-CN": "武器活动祈愿" } },
    { id: "200", displayName: { "zh-CN": "常驻祈愿" } },
    { id: "500", displayName: { "zh-CN": "集录祈愿" } },
    { id: "100", displayName: { "zh-CN": "新手祈愿" } },
    // 400 不是一个可单独查询的池子（不会以 400 作为卡池取值发起请求），
    // 但它是 301 响应里真实出现的 gacha_type 取值，必须声明为独立 BannerSpec，
    // pityGroups[].members 才能合法引用它——否则 bannerId="400" 的记录会指向
    // 一个不存在的 BannerSpec，见本文件末尾「偏差与发现」说明。
    { id: "400", displayName: { "zh-CN": "角色活动祈愿（400 子类型，随 301 一并返回）" } },
  ],

  pityGroups: [
    {
      key: "characterEventWish",
      members: ["301", "400"],
      hardPity: 90,
      // base/start 取自公开的祈愿概率说明；74 抽起线性提升、86 抽外基本封顶，
      // 90 抽必出——step 采用同人社区广泛引用的「74 抽起每抽 +6%」口径。
      curve: { kind: "softPity", base: 0.006, start: 74, step: 0.06 },
      guarantee: { kind: "fiftyFifty" },
    },
  ],

  rarity: { ladder: ["3", "4", "5"], pityTarget: "5" },

  time: { timezoneSource: { kind: "computed" } },

  preconditions: [
    {
      id: "genshin.credential.cacheDirExists",
      capability: "credential",
      level: "required",
      describe: {
        "zh-CN": "自动获取抽卡链接要求游戏客户端至少运行过一次，缓存目录才会被创建",
      },
      // HostEnv 目前只有 gameClientSize / installedDependencies 两个字段，未携带
      // 「credential.gameDir 声明的缓存目录是否已被观测到」这一事实——这正是
      // fixture 契约测试阶段就能发现的契约缺口，不是运行时才暴露。见文件末尾
      // 「偏差与发现」，留给 gs-host 扩展 HostEnv 时补上。
      check: () => ({ kind: "unknown" }),
      remedy: { "zh-CN": "请先启动游戏并打开一次抽卡记录页，再回到本应用重试" },
    },
  ],

  baseline: { kind: "inGamePageCount" },

  retention: {
    displayText: { "zh-CN": "6 个月" },
    conservativeDays: 6 * 28,
  },

  // ⚠️ 原神 API 不返回 item_id，extractRecord 的 itemId 是本地化物品名
  // （见上方 extractRecord 内的详细说明与 M1-S3 阻塞项引用）。声明这个信号
  // 后，宿主的归一化层会把这类记录标成 meta_state='pending'，而不是因为
  // name/rarity 都有值就误判成 complete——错的 item_id 不该被标记为完整。
  itemIdSource: "displayName",

  // metadata 字段本 Stage 刻意不声明，理由见文件末尾「偏差与发现」。
} satisfies PluginManifest;
