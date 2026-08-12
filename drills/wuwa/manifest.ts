/**
 * 鸣潮 manifest 纸面填表演练草稿 —— S2 契约改动后的**二次填表**。
 *
 * ⚠️ **这不是可运行插件**：没有 `hooks.ts`、没有接入 `plugins/index.ts`、
 * 没有 fixture 契约测试。唯一目的是用 M2-S2 改过的插件契约类型
 * （`packages/gs-plugin-kit`）再填一次鸣潮已实测的真实差异点，验证「S2 的
 * 契约改动是否真的够用了」，见
 * `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表演练.md` §七
 * （主进程裁定）与 §八（本次二次填表结论）。
 *
 * **本文件是第二版**，第一版（对应旧契约：`paradigm: "logScan"` +
 * `LogScanPipelineParams.logPathPattern`/`extractUrl`）记录在同一份审计
 * 文档 §一～§六。旧契约已在 S2 删除（`logScan` 分支与 `LogScanPipelineParams`
 * 类型均不复存在），本文件改用 S2 定的新形态：
 * `paradigm: "credentialedApi"` + `credential: { kind: "logFile", ... }`——
 * 鸣潮拿到凭据（gachaLink）之后的流程与原神同构，不再需要一整套并行的
 * "日志扫描"范式。
 *
 * 数据来源（严格限定，不凭训练记忆编造字段名/数值，与第一版完全一致，
 * 本次二次填表不重新推导任何数值）：
 * - 任务下达时给出的鸣潮实测事实清单（已用 `WWGachaExport` 源码校准，
 *   源码定位：`UpdateGachaDataDialogViewModel.cs:66-138`
 *   `Services/ConfigService.cs:29-43` `Models/GachaAPI.cs`），本文件内联
 *   注释凡引用这份清单的具体条目，标注为「任务事实清单」。
 * - docs/_internal/milestones/03-M2-鸣潮插件与抽象证伪.md §4.1～§4.7
 * - docs/_internal/research/03-真实导出数据格式实测.md §三（本地存档格式，
 *   与本文件面向的 API 响应字段名不同，仅作交叉参考）
 * - packages/gs-plugin-kit/manifest.ts、packages/gs-plugin-kit/types/generated.ts
 *   （S2 之后的契约类型定义原文，本文件所有"填不下"的结论均落到具体行号，
 *   行号以本次重新读取的结果为准，第一版审计里的旧行号已随 S2 改动漂移）
 * - crates/paradigms/gs-p-authkey/src/pipeline.rs（核实 S2 新增字段在 L1
 *   是否已有真实执行链路——本次核实发现：**类型层已就绪，执行层大多仍
 *   显式标注"M2-S3 落地"**，详见下方各处注释与审计文档 §八）
 * - crates/scripts/gs-check/checks/declaration-consumption.mjs（HC-4 白名单，
 *   `CredentialSource.logPath` 已登记为"M2-S2 只登记契约，执行留到 M2-S3"）
 * - plugins/genshin/manifest.ts（唯一真实插件，S2 后已改用
 *   `paradigm: "credentialedApi"`，写法对齐）
 *
 * 未在上述来源中找到直接依据的字段/数值，注释里标「研究未覆盖，需要实测」，
 * 不凭训练记忆编造——尤其是鸣潮的软保底/渐进概率具体数值、POST body 里
 * 无法用占位符表达的字段的真实取值，本文件全程没有一处编号或杜撰。
 *
 * 二次填表结论汇总见 `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表
 * 演练.md` §八，本文件内的注释只记录「为什么这么填 / 为什么填不下」，
 * 不重复整篇结论。
 */
import type { PluginManifest } from "gs-plugin-kit";

/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 鸣潮 API 响应的 `resourceId`/`qualityLevel` 是 JSON number（任务事实清单：
 * `Models/GachaAPI.cs` 的 `resourceId: int`、`qualityLevel: int`），与米哈游
 * 三游"数字字符串"不同，需要单独一个转换函数，不能直接复用 `toNonEmptyString`。
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
 * `count: int`（任务事实清单）。对照本地存档格式的同名字段恒为 `'1'`
 * （research/03 §3.2④），但那是 WWGachaExport **自己的存档**，不是 API
 * 响应本身——任务事实清单没有单独确认 API 响应的 `count` 是否也恒为 1，
 * 这里按"很可能同构"处理，不当作已核实事实，防御式转换 + 异常兜底为 1。
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
 * ⚠️ **响应外层信封形态本身研究未覆盖**：任务事实清单给出的是单条记录的
 * DTO 字段（`Models/GachaAPI.cs`），没有给出响应外层信封的完整 JSON 形态；
 * research/03 §三描述的是本地存档格式，不是 API 响应，不能直接挪用。这里
 * 防御式兼容米哈游三游同族插件常见的两种信封（`{ data: [...] }` 与
 * `{ data: { list: [...] } }`），两者都是**类比**，不是已核实事实，如实
 * 标注，不当作确定结论使用。
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
 * 13 项 `PoolType` 表，逐字段直接取自任务事实清单给出的
 * `Services/ConfigService.cs:29-43` 原样表格：
 *   `(PoolType, 名称, 是否新手池, 5★硬保底, 4★硬保底, 保底是否继承)`
 *
 * ⚠️ 本表只保留本文件真正用得上的三列（id / displayName / hardPity5Star）。
 * 4★ 硬保底恒为 10（见下方 `WUWA_4STAR_HARD_PITY`），不再需要逐行区分。
 * 「是否新手池」「保底是否继承」两列仍然没有对应字段可以承载，见下方
 * `pityGroups` 一节与审计文档 §二 C 类第 6 条（S2 未处理，维持原判）。
 */
const WUWA_POOL_TYPES = [
  { id: "1", name: "角色活动唤取", hardPity5Star: 80 },
  { id: "2", name: "武器活动唤取", hardPity5Star: 80 },
  { id: "3", name: "角色常驻唤取", hardPity5Star: 80 },
  { id: "4", name: "武器常驻唤取", hardPity5Star: 80 },
  { id: "5", name: "新手唤取", hardPity5Star: 50 },
  { id: "6", name: "新手自选唤取", hardPity5Star: 80 },
  { id: "7", name: "新手自选唤取（感恩定向唤取）", hardPity5Star: 1 },
  { id: "8", name: "角色新旅唤取", hardPity5Star: 80 },
  { id: "9", name: "武器新旅唤取", hardPity5Star: 80 },
  { id: "10", name: "角色联动唤取", hardPity5Star: 80 },
  { id: "11", name: "武器联动唤取", hardPity5Star: 80 },
  { id: "12", name: "角色忆旅唤取", hardPity5Star: 80 },
  { id: "13", name: "武器忆旅唤取", hardPity5Star: 80 },
] as const;

/**
 * 4★ 硬保底，任务事实清单表格第 5 列对全部 13 项 PoolType 给出同一个值
 * （"全部恒为 10"），不是逐行独立数值，因此不放进 `WUWA_POOL_TYPES` 表内，
 * 单列一个常量更准确地表达"这是一个跨全部卡池成立的常数"这件事。
 *
 * ✅ **S2 之前这一档完全没有字段可以承载**（第一版审计 B 类第 1 条）。
 * S2 给 `PityGroup` 加了可选的 `pityTarget?: string`（`types/generated.ts:102`，
 * 缺省回落 `rarity.pityTarget`），审计文档 §7.4 已把这条从 B 类改判 A 类
 * 并确认填得下，本文件在下方 `pityGroups` 一节据此为每个 PoolType 声明
 * 第二个 `PityGroup`（`pityTarget: "4"`），验证结论：**填得下**。
 */
const WUWA_4STAR_HARD_PITY = 10;

/**
 * 从日志行提取的 gachaLink 正则，逐字取自任务事实清单：
 *   `(https?.* /aki/gacha/index\.html#/record[\?=&\w\-]+)`
 * （原文里 `.*` 与 `/aki` 之间插入了一个空格避免提前闭合本段 JSDoc 注释，
 * 下方 `urlPattern` 字段的字面量本身没有这个空格）。
 *
 * ⚠️ **与第一版的关键差异**：第一版这里是插件自己声明的 TS 函数
 * `extractGachaLinkFromLine(line: string): string | undefined`，类型签名
 * 携带不了"必须倒序调用、命中第一个即停"这个约定（第一版审计已指出这一点）。
 * S2 之后，`CredentialSource.logFile` 的字段是裸 `RegExp`
 * （`packages/gs-plugin-kit/manifest.ts:299-305`），不再是插件自己写的函数
 * ——扫描方向、停止时机现在**完全**是 Rust L1 的实现细节，插件侧的类型
 * 签名不会、也不需要声明这件事。这不是因为 Rust 侧已经实现了倒序扫描
 * （见下方 credential 字段的说明，这段执行逻辑本身还不存在），而是"由谁
 * 负责表达调用约定"这个问题本身随字段形态改变而不再需要 TS 侧操心
 * ——是本次二次填表发现的一处**结构性简化**，记录在审计文档 §八。
 */
const WUWA_GACHA_LINK_PATTERN = /(https?.*\/aki\/gacha\/index\.html#\/record[\?=&\w\-]+)/;

/**
 * POST body 里除 `cardPoolType` 之外的字段，均无法用现有占位符表达，
 * 详见下方 `request.body` 字段上方的大段说明与审计文档 §八 C 类第 7 条
 * （本次二次填表新发现，第一版未覆盖到这一层）。用统一的哨兵字符串
 * 代替空串——空串会被误读成"已确认取值为空"，哨兵字符串能让任何真的
 * 尝试运行这份草稿的人一眼看出这是未完成状态，而不是一个安静的错误取值。
 */
const UNFILLABLE_BODY_FIELD = "__UNFILLABLE__（见 request.body 字段上方注释）";

export const manifest = {
  id: "wuwa",
  displayName: { "zh-CN": "鸣潮" },
  sdkVersion: "1.0.0",
  platforms: ["windows"],
  maintainers: ["gacha-studio"],
  // exchangeFormats 不声明，结论与第一版一致，S2 未触及这一层——
  // `exchangeFormats?: string[]`（packages/gs-plugin-kit/manifest.ts:92）
  // 仍然只是一份 id 字符串列表，不携带 schema/字段映射声明；"交换格式/
  // 伙伴工具同步"这一整片能力域在 `packages/gs-plugin-kit` 里仍然不存在，
  // 见审计文档 §二 C 类第 4 条（S2 执行清单 7.5 的 9 项均未涉及这一条）。

  // ============================================================
  // collect：paradigm 从 "logScan" 改为 "credentialedApi"
  // ============================================================
  collect: {
    paradigm: "credentialedApi",
    params: {
      credential: {
        kind: "logFile",
        // 官方启动器路径（任务事实清单：
        //   `UpdateGachaDataDialogViewModel.cs:66-67`
        //   官方启动器: {游戏目录}/Wuthering Waves Game/Client/Saved/Logs/Client.log
        //   WeGame 启动器: {游戏目录}/Client/Saved/Logs/Client.log ）
        //
        // ⚠️ **仍然只填得下一条路径**——`logPath: string`
        // （packages/gs-plugin-kit/manifest.ts:301-302）依旧是单个字符串
        // 字段，与第一版的结论不变（第一版审计 A 类第 1 条，S2 执行清单
        // 7.5 的 9 项没有一条涉及"多候选路径"）。WeGame 启动器变体依旧
        // 缺字段承载，只填官方启动器这一条更具体的路径。
        logPath: "Wuthering Waves Game/Client/Saved/Logs/Client.log",
        urlPattern: WUWA_GACHA_LINK_PATTERN,
      },

      /**
       * ⚠️ **以下内容依旧全部没有字段可以承载**（S2 未处理，与第一版结论
       * 完全一致，只是判别标签从 `CollectConfig.paradigm: "logScan"` 换成了
       * `credential.kind: "logFile"`，位置变了，空白本身没变）：
       *
       * ① 字节级解混淆参数（跳过前 3 字节；此后逐字节按"该字节自身的值"
       *    奇偶分别异或 `0xA5`/`0xEF`）：`CredentialSource.logFile`
       *    （manifest.ts:299-305）只有 `logPath`/`urlPattern` 两个字段，
       *    没有任何"字节变换参数"的位置。milestones/03-M2 §4.7 的分工表
       *    早就预判了这组参数**应该**归 TS 声明，但契约类型至今没有跟上
       *    ——S2 的 9 项执行清单里也没有这一条，是一条**跨两轮演练都未
       *    处理**的遗留 A 类缺口。
       * ② 按行**倒序**扫描、命中第一个即停——见上方 `WUWA_GACHA_LINK_PATTERN`
       *    的说明：这件事现在完全是 Rust L1 的实现细节，TS 侧不需要（也
       *    不能）声明它，这是字段形态变化带来的结构性简化，不是"填得下"
       *    也不是"填不下"，是这个问题本身不再需要 TS 契约回答。
       *
       * ③④⑤⑥ 见下方 `request` 字段与其上方的大段说明——S2 已经把"完全
       * 没有字段"变成了"有字段，但可用的占位符种类不够"，性质发生了变化，
       * 不再原样成立，因此不在这里重复，改到 `request` 字段旁边详细说明。
       */

      /**
       * ✅ **`RequestTemplate` 现在有 `method`/`body` 两个字段可用了**
       * （`packages/gs-plugin-kit/types/generated.ts:18-29`），第一版审计
       * A 类第 2 条指出的"完全没有 body 字段"这条空白已被 S2 填平。
       *
       * ⚠️ **但填平"有没有字段"不等于填平"填不填得下"——本次二次填表
       * 发现了一个第一版没有触及的新问题**（第一版从未写到"有 body 字段"
       * 这一步，因此没有机会发现）：
       *
       * `RequestTemplate.body` 的占位符替换规则与 `url` **完全共用同一套**
       * （`types/generated.ts:20-27` 的字段文档原话），而这套规则是**固定
       * 的四个**——`crates/paradigms/gs-p-authkey/src/pipeline.rs:822-834`
       * 的 `substitute_placeholders` 只认 `{{credential}}`/`{{page}}`/
       * `{{gachaType}}`/`{{pageSize}}`，`{{credential}}` 替换成的是
       * **整个** `urlPattern` 匹配到的字符串（本文件里就是完整的
       * gachaLink URL），不支持从这个字符串里再拆出某个子字段单独占位。
       *
       * 鸣潮 POST body 需要的是 `{ cardPoolId, cardPoolType, languageCode,
       * playerId, recordId, serverId }` 六个**离散**字段（任务事实清单），
       * 其中只有 `cardPoolType` 明确"随卡池变化"（`types/generated.ts:24-26`
       * 的字段文档原话，与 `{{gachaType}}` 逐字对应，能填）；其余五个
       * （`cardPoolId`/`languageCode`/`playerId`/`recordId`/`serverId`）
       * 全部需要从 gachaLink 的 query 参数里单独解析出来，分别填进 body
       * 的不同键——但 `{{credential}}` 只能整体替换成同一个字符串，没有
       * 任何机制能把它拆成"第几个 query 参数"分别填进不同位置。
       *
       * 这不是"body 字段不够大"，是**"credential 的替换粒度是整个字符串，
       * 不是字段"**——与 `RequestTemplate` 本身是否有 body 字段无关，即使
       * body 字段再早加进来，这个问题依然成立。真正需要的是类似"具名捕获组
       * → 具名占位符"（如 `{{credential.playerId}}`）的新机制，`request.url`
       * 侧同样没有这个能力（原神/星铁/绝区零不需要，是因为它们的 `url`
       * 模板直接把 `{{credential}}` 整体拼接使用，不需要拆分）。
       *
       * 归类：**新发现，划入 C 类**（需要新窄口——具名捕获组解析属于新
       * L1 执行能力，不是加一个可选字段就能解决），详见审计文档 §八 C 类
       * 第 7 条。本文件不编造这五个字段的取值，用统一哨兵
       * `UNFILLABLE_BODY_FIELD` 显式标注，不用空串（空串会被误读成"已确认
       * 为空"）。
       *
       * 补充：`svr_area` 决定走 `.net` 还是 `.com`——依旧没有"整体切换根
       * 域名"的表达方式，与第一版结论一致（S2 未处理）；`url` 这里固定
       * 写 `.com`，同一条空白未消失，只是不在 body 里，写在这条注释末尾
       * 避免和上面的六字段问题混在一起。
       */
      request: {
        url: "https://gmserver-api.aki-game2.com/gacha/record/query",
        method: "POST",
        body: JSON.stringify({
          cardPoolId: UNFILLABLE_BODY_FIELD,
          cardPoolType: "{{gachaType}}",
          languageCode: UNFILLABLE_BODY_FIELD,
          playerId: UNFILLABLE_BODY_FIELD,
          recordId: UNFILLABLE_BODY_FIELD,
          serverId: UNFILLABLE_BODY_FIELD,
        }),
      },

      // 两个 host 都要收录：上面 request.url 固定写死 .com（见其上方注释
      // "svr_area 决定走 .net 还是 .com——依旧没有整体切换根域名的表达
      // 方式"），但那条空白只影响"请求发去哪一个"，不代表 .net 这个域名
      // 不存在——真实存在的两个候选都要出现在白名单里，否则国际服玩家的
      // 请求会被误判为投毒而拒绝，与 plugins/genshin/manifest.ts 处理
      // 国服/国际服 host 的方式同理。
      allowedHosts: ["gmserver-api.aki-game2.com", "gmserver-api.aki-game2.net"],

      extractList: extractGachaRecordList,

      /**
       * ✅ **`StopCondition` 现在有 `singleRequest` 变体了**
       * （`packages/gs-plugin-kit/types/generated.ts:107`），第一版审计
       * A 类第 3 条指出的空白已被 S2 填平——类型层面完全能表达"一次请求
       * 取完，不分页"这个语义，本文件据此声明。
       *
       * ⚠️ **类型能声明 ≠ 已经生效**：`crates/paradigms/gs-p-authkey/src/
       * pipeline.rs:204-209` 的 `StopConditionJson::SingleRequest` 定义
       * 原话是"镜像 `gs_core::StopCondition::SingleRequest`——只是为了让
       * 声明了这个变体的 manifest（如未来的鸣潮插件）能被正常反序列化，
       * 不落入 unknown variant 报错。**本 Stage 没有消费点**：
       * `collect_banner` 的分页循环行为不变，鸣潮真正的一次性请求流程在
       * M2-S3 落地时再接线"。也就是说：这份草稿现在可以诚实地声明
       * `singleRequest`，但如果真的接入 `plugins/` 跑起来，当前唯一的
       * 执行器（`AuthkeyApiPipeline::collect_banner`）仍然会按分页循环
       * 处理，并不会因为声明了这个变体就真的只发一次请求——执行侧空白
       * 是**已知且被明确记录的**（代码注释自己写了"M2-S3 落地时再接线"），
       * 不是本次演练的意外发现。
       */
      stopCondition: { kind: "singleRequest" },
    },
  },

  // ============================================================
  // fields：响应记录 → 统一字段，这一段与第一版完全一致，未受 S2 影响
  // ============================================================
  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("鸣潮 extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;

      // 任务事实清单「响应记录字段（API DTO，Models/GachaAPI.cs）」：
      //   cardPoolType: string   resourceId: int      qualityLevel: int
      //   resourceType: string   name: string         count: int
      //   time: DateTime
      // 没有任何形式的记录 ID（无 id/uuid/index），与本地存档格式实测结论
      // 一致（research/03 §3.2①）——因此 stableId 不填，deriveRecordKeys
      // 必须实现（见下方大段注释），不能依赖宿主兜底用 stableId。
      const itemId = numericToString(record.resourceId);
      if (!itemId) {
        throw new Error("鸣潮 extractRecord：记录缺少 resourceId，无法确定 itemId");
      }

      return {
        itemId,
        time: toNonEmptyString(record.time) ?? "",
        // ⚠️ bannerId 取值是**推断**，不是任务事实清单直接证实的结论：
        // 事实清单只说"请求体的 cardPoolType 字段"用来指定查询哪个池
        // （多半是 PoolType 数字），没有单独说明"响应记录里的 cardPoolType
        // 字段"是不是回显同一个数字。本文件按这条推测处理，把
        // record.cardPoolType 原样当数字字符串读取，与 WUWA_POOL_TYPES
        // 表的 id 对齐；如果实测证明 API 原始响应给的确实是中文名，这里
        // 需要改成查一张"中文名 → PoolType"的反向映射表。与第一版结论
        // 完全一致，S2 未触及这一层。
        bannerId: toNonEmptyString(record.cardPoolType) ?? "",
        count: toCount(record.count),
        name: toNonEmptyString(record.name),
        itemType: toNonEmptyString(record.resourceType),
        rarity: numericToString(record.qualityLevel),
        // stableId 留空：见上方注释，API 响应没有任何记录 ID 字段。
      };
    },
  },

  // 卡池表：13 个 PoolType 槽位，id/displayName 直接取自 WUWA_POOL_TYPES
  // （来源见该常量上方注释）。与第一版完全一致，未受 S2 影响。
  //
  // 没有任何一条声明 `endpointOverride`——13 个池共用同一个端点，区别完全
  // 在 POST body 的 `cardPoolType` 字段值，这一点第一版与本版结论一致。
  banners: WUWA_POOL_TYPES.map((pool) => ({
    id: pool.id,
    displayName: { "zh-CN": pool.name },
  })),

  // ============================================================
  // pityGroups：5★/4★ 双档保底 —— 本次二次填表最主要的"填平"项
  // ============================================================
  //
  // ✅ **S2 之前 5★/4★ 双档保底完全填不下**（第一版审计判为 B 类第 1 条：
  // "RaritySpec.pityTarget 单值 + PityGroup.hardPity 单值，无法同时追踪
  // 5★ 与 4★ 两档保底"）。S2 给 `PityGroup` 加了可选的
  // `pityTarget?: string`（`types/generated.ts:88-102`），缺省回落
  // `rarity.pityTarget`；主进程裁定（审计文档 §7.4）把这条从 B 类改判
  // A 类——"给 PityGroup 加可选字段"是纯新增，`analyze_pity_group` 签名
  // 不变，`plugins/genshin/manifest.ts` 不受影响。
  //
  // 验证结论：**填得下**。每个 PoolType 现在声明两个 `PityGroup`，
  // `members` 都指向同一个卡池 id：
  //   - 5★ 那份不填 `pityTarget`，回落 `rarity.pityTarget = "5"`；
  //   - 4★ 那份显式 `pityTarget: "4"`，`hardPity` 取
  //     `WUWA_4STAR_HARD_PITY`（任务事实清单："4★ 保底 10"）。
  //
  // ⚠️ **但审计文档 §7.6.1 记录的隐式语义在这里真实存在，不是理论风险**：
  // `pity_group_for()`（`pipeline.rs:797-803`）落库时取"声明顺序第一个"
  // 作为写入 `GachaRecord.pity_group` 单值列的那一个，`pity_groups_for()`
  // （`pipeline.rs:811-816`）虽然完整保留了全部分组，但**本 Stage 没有
  // 任何调用方**会用它去对同一条记录分别跑两遍 `analyze_pity_group`——
  // 也就是说，即使这份草稿真的接入插件运行，4★ 那一档保底统计目前也
  // 不会被分析引擎实际计算，只是数据不会像 S2 之前那样被 `HashMap`
  // 单值覆盖静默丢失。本文件把 5★ 分组排在每个 PoolType 的第一位（数组
  // `flatMap` 顺序），让"谁是主组"这件事符合 `rarity.pityTarget` 的
  // manifest 级默认值，不依赖偶然的声明顺序。
  //
  // 「保底是否继承」（联动池 10/11 传 false，其余默认 true）依旧没有字段，
  // 与第一版结论一致（S2 未处理，见审计文档 §二 C 类第 6 条，且该条本身
  // 标注"即使投入新窄口也可能解决不了"，不是单纯的字段缺失）。
  //
  // curve 处理方式（与第一版完全一致，S2 未把 `curve` 改为可选字段——
  // 第一版审计 A 类第 6 条提出的方案未被列入 S2 执行清单 7.5 的 9 项，
  // 是一条**跨两轮演练都未处理**的遗留缺口）：
  // - PoolType 7 的 5★ 硬保底=1，数学上直接等价于"每次唤取都必出 5★"，
  //   用 `{ kind: "flat", base: 1 }`，不是编造数字。
  // - 其余 12 条 5★、以及全部 13 条 4★：均无精确的软保底/渐进概率数值，
  //   用 `{ kind: "custom", id: ... }` 占位——`curve` 是必填字段
  //   （`types/generated.ts:88`），S2 没有把它改成可选，这个占位依旧是
  //   唯一能"不编造数值又能通过类型检查"的写法。⚠️ 占位本身依旧没有执行
  //   入口（`crates/gs-analysis/src/pity.rs` 的 `evaluate_curve` 对
  //   `Custom` 分支返回 `Unsupported`，`PluginHooks` 也没有等价的"自定义
  //   曲线求值"钩子），与第一版结论一致，S2 未处理（见审计文档 §二 C 类
  //   第 5 条）。
  pityGroups: WUWA_POOL_TYPES.flatMap((pool) => {
    // 角色/武器 50/50 与必中不歪的判定依据：任务事实清单"大保底：角色
    // 50/50，武器必中不歪"，只针对 5★ 这一档；4★ 没有对应描述，见下方
    // 单独处理。
    const fiveStarGuarantee = pool.name.includes("武器")
      ? ({ kind: "alwaysRateUp" as const })
      : pool.name.includes("角色")
        ? ({ kind: "fiftyFifty" as const })
        : ({ kind: "none" as const });

    return [
      {
        key: `${pool.id}-5star`,
        members: [pool.id],
        hardPity: pool.hardPity5Star,
        curve:
          pool.id === "7"
            ? { kind: "flat" as const, base: 1 }
            : { kind: "custom" as const, id: `wuwa-unconfirmed-5star-pool-${pool.id}` },
        guarantee: fiveStarGuarantee,
        // pityTarget 不填：回落 rarity.pityTarget = "5"。
      },
      {
        key: `${pool.id}-4star`,
        members: [pool.id],
        hardPity: WUWA_4STAR_HARD_PITY,
        pityTarget: "4",
        // 4★ 软保底数值任务事实清单未给出，同样用 custom 占位，不编造。
        curve: { kind: "custom" as const, id: `wuwa-unconfirmed-4star-pool-${pool.id}` },
        // 4★ 是否有类似 5★ 的"角色/武器必中不歪"规则，任务事实清单未说明，
        // 不套用 5★ 的规则，如实标注为未知。
        guarantee: { kind: "none" as const },
      },
    ];
  }),

  rarity: { ladder: ["3", "4", "5"], pityTarget: "5" },

  time: {
    // 与第一版完全一致，S2 未触及这一层。
    rawTimeConvention: "serverLocal",
    // timezoneSource 只能声明 "computed"：鸣潮响应记录字段里没有任何时区
    // 相关字段，只能靠账号侧信息推断，与原神同构。
    //
    // ⚠️ "能声明 computed"不代表"知道怎么算"：`hooks.resolveTimezone`
    // 的签名是 `(record, ctx: TimezoneContext) => number`，
    // `TimezoneContext = { uid: string, region?: string }`
    // （packages/gs-plugin-kit/manifest.ts:393-396）。鸣潮的 gachaLink URL
    // 里有 `svr_id`/`svr_area` 两个参数，理论上是"区服"信号的候选来源，
    // 但任务事实清单没有给出这两个参数到 UTC 偏移量的真实映射表，本文件
    // 不写 hooks.ts（同星铁/绝区零两份先例），只如实记录这个 hook 是
    // 必需的，且当前没有可用的偏移量数据去实现它。
    timezoneSource: { kind: "computed" },
  },

  // baseline 不声明，结论与第一版一致，S2 未处理这一层（第一版审计 A 类
  // 第 4 条，S2 执行清单 7.5 的 9 项没有涉及）。
  // `inGamePageCount`/`authoritativeApi`（packages/gs-plugin-kit/manifest.ts:380-387）
  // 两个变体套用鸣潮"不分页、无权威聚合接口"的情况都会名不副实，本文件
  // 选择不声明，交由主进程判断是否需要第三种变体。

  // retention 不声明：任务事实清单没有给出鸣潮官方记录保留期，不跨游戏
  // 挪用米哈游三游"6 个月"的说法，与第一版一致。

  // itemIdSource 不声明，默认 "native"——resourceId 是 API 原生字段，
  // 不是本地化物品名，与星铁/绝区零同理，与第一版一致。

  // metadata 不声明：响应记录自带 name/resourceType/qualityLevel，不需要
  // 反查字典，与第一版一致。

  // drawCounting 不声明，默认 perRecord，与第一版一致（见 toCount 函数
  // 注释）。

  // ============================================================
  // deriveRecordKeys：批处理钩子——本次二次填表第二个"填平"项
  // ============================================================
  //
  // ✅ **这是本次演练"填得下"结论最扎实的一条**——不只是类型层能声明，
  // Rust L1 执行链路也**已经真实接上**（与 singleRequest/logFile 不同，
  // 这条不是"声明了但 M2-S3 才接线"）：
  //   - `PluginHooks.deriveRecordKeys?: (records: UnifiedRecordFields[])
  //     => string[]`（packages/gs-plugin-kit/manifest.ts:447-470）与旧的
  //     单记录 `deriveRecordKey` 互斥，构造期二者同时声明会被拒绝
  //     （`crates/paradigms/gs-p-authkey/src/pipeline.rs:479-505` 已有
  //     单元测试覆盖这条互斥断言）。
  //   - `AuthkeyApiPipeline::collect_banner`
  //     （`pipeline.rs:1211-1229`）已经改成"先收齐整页 `fields_values`/
  //     `fields_list`，再统一调用 `derive_record_keys_for_page`"
  //     （`pipeline.rs:1108-1153`）——`hooks.deriveRecordKeys` 拿到的是
  //     **整页**记录，不是单条，第一版审计 C 类第 3 条指出的"L1 需要从
  //     逐条调用改造成先做批次内分组"这项工作已经完成，不是占位声明。
  //
  // ⚠️ **但本文件依旧不写 hooks.ts**（与星铁/绝区零两份先例一致，见
  // `drills/README.md`"这些草稿永远不会被打包"一节）——真正的
  // `deriveRecordKeys` 实现（`hash(时间 + 物品 + 同批次内序位)`）需要落在
  // 一份真实的 `hooks.ts` 里，纸面演练的范围到"确认字段/钩子填得下"为止。
  // 如果这份草稿未来落地成真实插件，`hooks.ts` 必须：
  //   1. 实现 `deriveRecordKeys(records)`，按"同一响应批次内、相同 time
  //      的记录"分组，组内按数组顺序编号，产出
  //      `hash(bannerId, time, itemId, 组内序位)`；
  //   2. **不得**同时声明 `deriveRecordKey`（互斥，见上）；
  //   3. 必须配合 `collect.params.stopCondition: { kind: "singleRequest" }`
  //      ——序位的安全性完全建立在"一次拉取整池全量"之上（本文件已声明，
  //      见上方 collect 一节），这是 `PluginHooks.deriveRecordKeys` 文档
  //      自己写的连带要求（manifest.ts:465-468）。
  //
  // stableId 留空的后果（见上方 fields.extractRecord 注释）与
  // deriveRecordKeys 是必需品这件事，第一版与本版结论一致；变化的只是
  // "钩子存在但装不下序位"（第一版 A 类第 5 条 + C 类第 3 条）现在已经
  // 是"钩子存在、装得下序位、且执行链路已验证接上"。

  // preconditions：与第一版完全一致，S2 未触及这一层。
  preconditions: [
    {
      id: "wuwa.credential.logHasGachaLink",
      capability: "credential",
      level: "required",
      describe: {
        "zh-CN": "自动获取唤取记录要求打开过一次游戏内的唤取详情页，且需要在链接有效期内立即导出",
      },
      // 同原神 drills 先例：HostEnv 目前没有"日志文件是否已包含匹配 URL"
      // 这个信号，check 只能返回 unknown。
      check: () => ({ kind: "unknown" }),
      remedy: {
        "zh-CN": "请在游戏内打开唤取详情页后，立即回到本应用重试（链接有效期未经实测确认，按最短情况处理）",
      },
    },
  ],
} satisfies PluginManifest;
