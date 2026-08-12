/**
 * gacha-studio 插件契约（手写部分）。
 *
 * 插件作者只需要阅读这一份文件：与 Rust 结构一一对应的纯数据类型全部来自
 * `./types/generated`（由 gs-codegen 生成，禁止在本文件重新定义同名类型——
 * 重复定义会让两边悄悄漂移，正是 HC-3 契约保障要防的事）。带函数字段的类型
 * （Rust 导不出函数，如 `CollectConfig`、`FieldMapping`、`Precondition`、
 * `PluginHooks`）Rust 侧无法生成，因此手写在这里。
 *
 * 完整设计依据见 `docs/_internal/design/2026-08-10-插件SDK与贡献者模型.md`
 * 第三、四节，以下两条防线是撰写本文件时必须遵守的约束，同时也是插件作者
 * 撰写自己的 manifest 时应当参照的标准。
 *
 * ## 防线一 · 禁止中间形态
 *
 * 差异的表达是三级递进，**能用 P1 不用 P2，能用 P2 不用 P3**：
 *
 * | 级别 | 形态 | 适用 | 例子 |
 * |------|------|------|------|
 * | P1 值 | 字面量常量 | 差异是一个值 | `pageSize: 20` |
 * | P2 表 | 映射表 / 枚举表 | 差异是有限枚举的分支 | `errorMap: { "-101": "authkeyExpired" }` |
 * | P3 函数 | TypeScript 纯函数 | 差异是计算 | `hooks.resolveTimezone` |
 *
 * 真正被禁止的不是复杂度，而是**中间形态**——一段用字符串编码的小语言，
 * 既没有 P1 的简单，也没有 P3 的工具支持：无补全、无跳转、无断点、无类型检查。
 * 反例：`cursorPath: "$.data.list[*].id"`、`stopWhen: "page > 0 && list.length"`、
 * `transform: "trim|lowercase|parseInt"`。判别方法：字段文档里如果出现
 * 「支持…语法」「格式为…」「以…分隔」这类措辞，说明该字段该改成函数。
 *
 * ## 防线六 · 类型即文档
 *
 * 用判别联合而非可选字段堆砌，天然消除「选了 `logFile` 却填了 `gameDir`」
 * 这类非法组合，这是 JSON Schema 难以表达的。插件作者撰写 manifest 时用
 * `satisfies PluginManifest` 而**不是** `as`——保留字面量类型的同时完成校验：
 *
 * ```ts
 * export const manifest = {
 *   // ...
 * } satisfies PluginManifest;
 * ```
 */

import type {
  LocalizedText,
  Platform,
  RaritySpec,
  RetentionPolicy,
  DrawCountingConfig,
  BannerSpec,
  RequestTemplate,
  MetadataEntry,
  BannerBaseline,
  UnifiedRecordFields,
  PityGroup,
  RateLimitConfig,
  ErrorSemantic,
  StopCondition,
  TimeConfig,
  PreconditionLevel,
  PreconditionStatus,
  HostEnv,
} from "./types/generated";

// ============================================================
// SDK 版本
// ============================================================

/** 当前 SDK 版本。破坏性变更时提升该常量，所有插件需要同步迁移。 */
export const CURRENT_SDK_VERSION = "1.0.0" as const;

/**
 * 编译期常量字面量类型。插件 manifest 里的 `sdkVersion` 字段填错版本号会
 * 导致 `tsc` 类型检查直接失败并指向迁移文档，而不是留到运行时才发现——
 * 这是编译期插件模型延续「接口不兼容必须在构建期暴露」这条设计目标的方式，
 * 只是把 Rust 方案里 `cargo build` 失败的落点换成了 `tsc`。
 */
export type SdkVersion = typeof CURRENT_SDK_VERSION;

// ============================================================
// 顶层结构：PluginManifest
// ============================================================

export interface PluginManifest {
  /** 稳定标识，一旦发布不可更改；会被写入数据库与用户配置。 */
  id: string;
  displayName: LocalizedText;
  /** 编译期常量字面量类型，填错版本号 `tsc` 就失败，见上方 {@link SdkVersion}。 */
  sdkVersion: SdkVersion;
  platforms: Platform[];
  maintainers: string[];
  /** 如 `["uigf-v4"]`，未声明表示不支持任何交换格式导出。 */
  exchangeFormats?: string[];
  /**
   * 游戏图标地址。**可选**——缺省时宿主走「游戏名首字 + 游戏色圆底」fallback
   * （界面设计方向 §6.4），强制必填会让找不到稳定图标源的贡献者无法提交插件。
   *
   * - 限 `https`。
   * - 由宿主下载并缓存，**不提供**通用 `fetchAsset` 窄口——插件不能自己发起
   *   任意下载，这是 HC-2 能力窄口约束在图标场景的落点。
   * - 落盘前按 content-type + magic bytes 校验，**不得按扩展名判断**
   *   （实测 TapTap 的 `.jpg` 结尾文件实际 content-type 是 `image/png`，
   *   按扩展名判断会把它当成 JPEG 解析，直接失败或产出损坏图片）。
   */
  iconUrl?: string;

  /** 用哪条 L1 采集流程 + 该流程的参数，见 {@link CollectConfig}。 */
  collect: CollectConfig;
  /** 响应 → 统一记录，见 {@link FieldMapping}。 */
  fields: FieldMapping;
  /** 卡池表。 */
  banners: BannerSpec[];
  /** 共享保底的卡池分组，异环这类没有传统保底的玩法可以整体省略。 */
  pityGroups?: PityGroup[];
  /**
   * 稀有度阶梯，**不可省略**——绝区零实测 `rank_type` 取值是
   * `["2","3","4"]`、最高档是 4 星而非 5 星，任何硬编码假设都会在这类游戏上
   * 静默算错保底与欧非统计，因此稀有度体系必须由每个插件显式声明。
   */
  rarity: RaritySpec;
  /** 时区策略，省略表示按服务器本地时间处理，不做换算。 */
  time?: TimeConfig;
  /** 元数据 Provider，星铁一类物品字典可能缺失的游戏建议提供。 */
  metadata?: MetadataProviderConfig;
  /** 各能力的环境前置条件，见 {@link Precondition}。 */
  preconditions?: Precondition[];
  /** 聚合统计校验基准，异环之外的游戏通常留空。 */
  baseline?: BaselineProviderConfig;
  /** 官方记录保留期。省略表示该游戏不做保留期监测。 */
  retention?: RetentionPolicy;
  /** 抽数计算方式，省略默认 `perRecord`（米哈游三游适用）。 */
  drawCounting?: DrawCountingConfig;
  /**
   * `itemId` 的性质。`displayName` 表示 `fields.extractRecord` 产出的
   * `itemId` 实际上是本地化物品名，不是真正的物品标识，需经 metadata
   * 反查才能得到——宿主据此把这类记录的 `meta_state` 标成 `pending`，
   * 而不是按"有 name/rarity 就是 complete"的默认规则误判成已完整。
   *
   * 典型场景：米哈游 `getGachaLog` 系接口不返回 `item_id`
   * （`HoYo.Gacha/crates/url_scraper/src/types.rs:150` 的 doc comment 直书
   * `Except for 'Genshin Impact'`），`extractRecord` 只能把本地化物品名
   * 填进 `itemId`；`name`/`rarity` 却仍然都有值，若不显式声明这个信号，
   * `idx_record_meta_pending` 那条部分索引永远扫不到这类记录——错的值
   * 被标记为完整，没有任何机制会来纠正。
   *
   * 省略默认 `native`（`itemId` 本身就是稳定标识，米哈游三游之外的多数
   * 游戏适用）。
   */
  itemIdSource?: "native" | "displayName";
}

// ============================================================
// 采集配置：L1 流程与参数
// ============================================================

/**
 * `paradigm` 决定走哪条 L1 采集流程，`params` 是该流程接受的参数。
 *
 * 范式 A（`credentialedApi`：先取凭据、再调 API）现在就抽象，因为已有
 * HoYo.Gacha / genshin-wish-export / star-rail-warp-export 三个参考实现 +
 * 五份真实存档支撑，字段写全；范式 C/D 各自样本不足（1 个或 0 个），只保留
 * 判别联合的占位分支，详见各自类型定义上的说明。
 *
 * ⚠️ **本判别联合曾经还有第四个分支 `{ paradigm: "logScan"; params:
 * LogScanPipelineParams }`，M2-S2 已删除**（同批把 `"authkey"` 改名为
 * `"credentialedApi"`，详见下方 `CredentialedApiPipelineParams` 的说明）。
 * 删除理由：M2 用鸣潮做纸面填表演练后发现，「日志扫描」描述的是**凭据从
 * 哪来**，不是采集流程本身——鸣潮拿到凭据之后的分页拉取、归一化、去重
 * 流程与原神完全同构，`credentialedApi` 直接可用。`logScan` 分支与
 * {@link CredentialSource} 的 `kind: "logFile"` 是两套**从未互相引用、
 * 也从未被任何代码路径跑过**的重复扩展点——M1 在样本不足时凭猜测同时留了
 * 两个入口。保留 `logScan` 等于把卡池遍历/请求/解析/归一化/去重整套逻辑
 * 在第二个分支里再实现一遍，是「N 个独立工具塞进一个壳」的退化路径，因此
 * 直接删除，凭据来源统一收敛到 {@link CredentialSource} 的判别联合里。
 * 完整裁定见
 * `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表演练.md` §七
 * 7.1～7.2。`LogScanPipelineParams` 类型本身也已一并删除，不留占位骨架。
 */
export type CollectConfig =
  | { paradigm: "credentialedApi"; params: CredentialedApiPipelineParams }
  | { paradigm: "packetCapture"; params: PacketCapturePipelineParams }
  | { paradigm: "ocr"; params: OcrPipelineParams };

/**
 * `credentialedApi`（先取凭据、再调 API）范式的采集参数。已有 HoYo.Gacha /
 * genshin-wish-export / star-rail-warp-export 三个参考实现 + 五份真实存档
 * 支撑，字段视为稳定。
 *
 * ⚠️ **本类型曾叫 `AuthkeyPipelineParams`，判别标签曾叫 `"authkey"`**，
 * M2-S2 改名——鸣潮走同一条 L1 流程但**没有 authkey**，判别标签叫
 * `authkey` 却用于一个没有 authkey 的游戏，直接违反防线六「类型即文档」。
 * `credentialedApi` 准确描述了该范式的结构：先取凭据（来源可变，见
 * {@link CredentialSource}），再调 API。理由与代价见
 * `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表演练.md` §7.2。
 */
export interface CredentialedApiPipelineParams {
  /** 凭据来源，见 {@link CredentialSource}。 */
  credential: CredentialSource;
  /** 分页请求模板，凭据位置用 `"{{credential}}"` 占位。 */
  request: RequestTemplate;
  /**
   * 每页条数，默认 20。填进 `request.url` 的 `{{pageSize}}` 占位符。
   *
   * > 这里曾有 `typeParam` / `pageParam` 两个字段（声明「卡池类型参数叫什么名」
   * > 「分页参数叫什么名」）。M1-S3 实现后实测确认它们**从未被任何代码路径读取**：
   * > 参数名已经由 `request.url` 模板自己写死（`&gacha_type=`、`&page=`），
   * > 这两个声明只是把同一件事重复了一遍。注意与本字段的区别——`pageSize` 是
   * > **值**，真的被消费；那两个是**参数名**，是死字段，已删除。
   * > 绝区零的 `real_gacha_type` 差异照样只改自己那一行模板，不需要额外声明。
   */
  pageSize?: number;
  /** 从响应体里取出本页记录数组；纯函数，不做 IO。 */
  extractList: (response: unknown) => unknown[];
  /** 从响应体与已提取的列表里推导下一页游标；不提供则按页码递增翻页。 */
  extractCursor?: (response: unknown, list: unknown[]) => string | undefined;
  /**
   * 限速策略，默认 `{ perPageDelayMs: 300, retry: { maxAttempts: 5, delayMs: 5000 } }`。
   * 类型定义见 `./types/generated` 的 {@link RateLimitConfig}（纯数据，宿主执行）。
   */
  rateLimit?: RateLimitConfig;
  /** 错误码 → 语义枚举映射表，未覆盖的错误码按通用重试处理。 */
  errorMap?: Record<string, ErrorSemantic>;
  /** 终止条件，默认 `{ kind: "emptyPage" }`。 */
  stopCondition?: StopCondition;
}

/**
 * ⚠️ **`LogScanPipelineParams`（日志扫描范式的采集参数）已于 M2-S2 删除。**
 *
 * 原设计：鸣潮之外还没有第二个同范式样本时，为它单独留一个 `CollectConfig`
 * 判别联合分支（`{ paradigm: "logScan"; params: LogScanPipelineParams }`，
 * 字段是 `logPathPattern` + `extractUrl`）。M2 纸面填表演练发现，这套字段
 * 与 {@link CredentialSource} 的 `kind: "logFile"`（字段是 `logPath` +
 * `urlPattern`）描述的是**同一件事**——凭据从日志文件里读——只是分别在
 * 两个互不知情的地方各猜了一次，从未被任何代码路径统一或跑通过。删除
 * `logScan` 分支后，鸣潮改用 `{ paradigm: "credentialedApi", params: {
 * credential: { kind: "logFile", ... }, ... } }`：凭据来源单独用
 * {@link CredentialSource} 表达，拿到凭据之后的采集流程与原神共用同一条
 * `credentialedApi` 流水线，不再需要一整套并行的日志扫描流程。
 * 完整裁定见
 * `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表演练.md` §七 7.1～7.2。
 */

/**
 * 封包捕获范式的采集参数。
 *
 * ⚠️ **占位骨架**：异环之外还没有第二个同范式样本，字段随时可能变化——
 * 三次法则的直接应用，范式 C 只有 1 个真实样本，样本不足时抽象正是
 * 三次法则要防的事，因此这里不追求「设计得漂亮」，只保证类型层面能表达
 * 异环这一个实例，等第二个封包捕获类游戏出现再补全成稳定契约。
 */
export interface PacketCapturePipelineParams {
  paradigmId: string;
}

/**
 * OCR 范式的采集参数。
 *
 * ⚠️ **样本数为 0**，暂不设计具体字段，本类型仅保证 {@link CollectConfig}
 * 判别联合的穷尽性——预留分支不代表这个范式已经过实证验证。
 */
export interface OcrPipelineParams {
  paradigmId: string;
}

// ============================================================
// 凭据来源
// ============================================================

/**
 * 凭据从哪来。判别联合天然消除「选了 `logFile` 却填了 `gameDir`」这类
 * 非法组合，是防线六「类型即文档」的直接应用。
 *
 * 凭据本身**永远不会作为参数传给插件代码**——插件只在
 * {@link CredentialedApiPipelineParams.request} 的 `url` / `headers` 里用
 * `"{{credential}}"` 占位符引用它，真正的替换发生在 Rust 侧，插件代码
 * 执行期间永远看不到占位符被替换后的明文。这是 HC-2「凭据不过 IPC」在
 * manifest 层的具体落地。
 */
export type CredentialSource =
  | {
      kind: "chromiumCache";
      /**
       * ⚠️ **相对片段，不是绝对路径**，如 `"YuanShen_Data/webCaches"`。
       *
       * 绝对路径来自用户在设置里选的游戏安装目录，存在宿主配置里。Rust 侧凭
       * `gameId` 取出用户配置的安装目录，再拼上这里声明的相对片段——插件全程
       * 碰不到、也无法指定绝对路径。
       *
       * 这是 HC-2「窄口的参数必须是标识符，不是路径」在 manifest 层的落点，
       * 也是整条约束**最容易被破掉、且破掉之后看起来仍然像窄口**的一处：
       * 一旦这里能填绝对路径，`scanGameCache` 就等于 `readFile(anyPath)`
       * 换了个名字，插件的能力边界即等于整个应用的能力边界，
       * 「代码审查是唯一防线」这条前提随之被架空。
       */
      gameDir: string;
      /** 从缓存内容里捞出凭据 URL 的正则。执行发生在 Rust 侧，插件只声明模式。 */
      urlPattern: RegExp;
    }
  | {
      kind: "logFile";
      /** ⚠️ 同 `gameDir`：相对片段，不是绝对路径。理由见上。 */
      logPath: string;
      /** 从日志行里捞出凭据 URL 的正则。执行发生在 Rust 侧。 */
      urlPattern: RegExp;
    }
  | { kind: "manual" };

// ============================================================
// 字段映射：响应 → 统一记录
// ============================================================

export interface FieldMapping {
  /**
   * 把响应 list 数组里的一个原始元素转换为统一字段。纯函数，不做 IO。
   *
   * `raw` 的具体形状因游戏而异——米哈游三游是键值对象，但同族第三方工具里
   * 出现过位置数组的先例。插件必须**自行判断形状**，不能假设字段一定存在，
   * 也不能盲信数组下标；返回值在写入存储层之前会经过
   * `../schema` 的 `unifiedRecordFieldsSchema` 运行时校验，校验失败的记录
   * 会被拒绝写入并计入诊断报告，而不是带着错误数据静默入库。
   */
  extractRecord: (raw: unknown) => UnifiedRecordFields;
}

// ============================================================
// 元数据 Provider
// ============================================================

export type MetadataProviderConfig =
  | {
      kind: "online";
      /** 查询方向：原神是 name → itemId，因为米哈游 API 本身不返回 item_id，导出交换格式时才需要反查。 */
      direction: "nameToId" | "idToDetail";
      /** 请求模板，机制与 {@link CredentialedApiPipelineParams.request} 一致；纯查询场景通常不需要凭据占位符。 */
      request: RequestTemplate;
      /** 纯函数，解析宿主已经取回的响应体，不做 IO。 */
      parseResponse: (response: unknown) => MetadataEntry | undefined;
    }
  | {
      kind: "builtin";
      /** 星铁 / 绝区零走这条：item_id → 详情，构建期随插件打包。 */
      direction: "idToDetail";
      /** 静态字典，必须是可序列化的字面量，禁止函数值。 */
      dictionary: Record<string, MetadataEntry>;
    };

// ============================================================
// Precondition：能力前置条件
// ============================================================

/** 保留 `string & {}` 以维持字面量自动补全，同时允许插件声明未预置的能力域标识。 */
export type CapabilityId = "credential" | "recordFetch" | "autoPage" | "ocr" | (string & {});

export interface Precondition {
  id: string;
  /** 关联的能力域，决定在哪个功能入口展示。 */
  capability: CapabilityId;
  level: PreconditionLevel;
  /**
   * ⚠️ `level: "required"` 时，文案**禁止**出现「建议 / 推荐 / 最好」等
   * 弱化措辞（后续会加 lint 机械检查本条）。
   *
   * 来历：实测某工具的自动翻页硬性要求 16:9 客户端，用户是 21:9 带鱼屏，
   * 功能完全不可用；限制写在 README 里，但措辞是「建议使用 16:9」，代码
   * 行为却是直接拒绝——UI 上没有任何提示，失败时抛出的是英文原始错误串。
   * 用户的实际体感是「这软件不稳定」，一直手动点下一页，从未想到是分辨率
   * 问题。**措辞与行为不一致，比不写更有害**——它排除了正确的排查方向。
   */
  describe: LocalizedText;
  /** 纯函数，宿主传入环境快照；只读判断，不做 IO。 */
  check: (env: HostEnv) => PreconditionStatus;
  /** 不满足时的补救步骤，尽量可执行。 */
  remedy?: LocalizedText;
}

// ============================================================
// BaselineProvider：聚合统计校验基准（可选）
// ============================================================

export type BaselineProviderConfig =
  | { kind: "inGamePageCount" } // 首选：分页响应自带总页数/总条数，零成本、全覆盖、无凭据风险
  | {
      kind: "authoritativeApi"; // 备选：如塔吉多类聚合统计接口，需要额外凭据
      request: RequestTemplate;
      /** 纯函数，解析宿主已经取回的响应体，不做 IO。 */
      parseResponse: (response: unknown) => BannerBaseline[];
    };

// ============================================================
// Hooks：逃生舱
// ============================================================

export interface TimezoneContext {
  uid: string;
  region?: string;
}

export interface TransformContext {
  bannerId: string;
}

export interface PluginHooks {
  /**
   * 计算记录的时区偏移（UTC 小时数）。
   *
   * 仅当 `manifest.time?.timezoneSource.kind === "computed"` 时视为必填，
   * 例如原神：API 不返回任何时区信息，只能按 UID 首位数字推断。缺失应在
   * fixture 契约测试阶段报错，而不是留到运行时才发现换算不出时区。
   */
  resolveTimezone?: (record: UnifiedRecordFields, ctx: TimezoneContext) => number;

  /**
   * 生成账号内稳定唯一的记录标识。
   *
   * 稳定性要求：对同一条实际抽卡记录，任意时间、任意次采集，都必须产出
   * 相同的 key——这是去重契约 `UNIQUE(account_id, record_key)` 成立的前提。
   *
   * 缺省行为：`UnifiedRecordFields.stableId` 有值时，宿主直接取它作为
   * record_key；两者都缺失时会在 fixture 契约测试阶段报错，而不是留到
   * 运行时才静默出错。
   *
   * ⚠️ **米哈游三游（原神/星铁/绝区零）不得缺省本 hook。** 服务端雪花 ID
   * 在跨端点场景下会重复——星铁联动池走独立端点 `getLdGachaLog`，与常规
   * 卡池的雪花 ID 不在同一命名空间隔离，裸用 `stableId` 会撞键。这类游戏
   * 必须实现本 hook，产出形如 `` `${gachaType}:${id}` `` 的复合键，把卡池
   * 维度并进去。参考实现 HoYo.Gacha 上线时主键就是 `(business, uid, id)`，
   * 一年后为此付出过一次**整表重建迁移**，改成
   * `(business, uid, id, gacha_type)`——SQLite 改不了主键，这个代价不会
   * 因为写插件时图省事而被接受，一步做对成本远低于事后迁移。
   *
   * 撞键的后果不是报错：写入层用 `INSERT OR IGNORE`，撞键记录会被**静默
   * 跳过**——不抛异常、不进日志，用户只是发现「少了一条」，且无法定位是
   * 哪一条、为什么少。
   *
   * 三种参考实现：
   * - 米哈游三游：雪花 ID + 卡池维度，`` `${gachaType}:${id}` ``
   * - 鸣潮：无稳定 ID，`hash(时间 + 物品 + 同批次内序位)`——⚠️ **本 hook 的
   *   单记录签名结构上拿不到「同批次内序位」**，鸣潮必须改用下方的
   *   {@link deriveRecordKeys}（批处理版本），不能用本 hook，见其文档。
   * - 异环：`SHA256(语义字段)`，同语义重复时用 `occurrence` 区分
   *
   * ⚠️ **与 {@link deriveRecordKeys} 互斥，不能同时声明**——宿主在插件
   * 构造期发现两者都存在会直接拒绝启动，不做"批处理优先"之类的隐式选择。
   */
  deriveRecordKey?: (record: UnifiedRecordFields) => string;

  /**
   * 批量生成账号内稳定唯一的记录标识，稳定性要求与 {@link deriveRecordKey}
   * 完全一致（同一条实际抽卡记录，任意时间、任意次采集都必须产出相同的
   * key），区别只在**一次拿到整批记录**而不是逐条调用，返回值必须与输入
   * 等长、按输入顺序一一对应。
   *
   * 新增动机：鸣潮无稳定 ID，`record_key` 策略是
   * `hash(时间 + 物品 + 同批次内序位)`——「同批次内序位」这个信息**结构上
   * 拿不到**，除非能同时看到"这一批里的其余记录"。{@link deriveRecordKey}
   * 的单记录签名 `(record) => string` 做不到这件事：真实存档实测（591 条 /
   * 17.53% 的记录）证实，用单记录签名能算出的最好结果是
   * `hash(池, 时间, 物品 ID)`，同秒内的重复记录全部撞键，被 `INSERT OR
   * IGNORE` 静默吞掉，见
   * `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §一。
   *
   * ⚠️ **与 {@link deriveRecordKey} 互斥**，见该字段文档。米哈游三游继续用
   * 单记录版本（`deriveRecordKey`），不受影响。
   *
   * ⚠️ **鸣潮插件同时必须搭配 `collect.params.stopCondition: { kind:
   * "singleRequest" }`**（禁止分页/增量采集）——序位的安全性完全建立在
   * "一次拉取整池全量"之上，见
   * `docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §1.7～1.8。
   */
  deriveRecordKeys?: (records: UnifiedRecordFields[]) => string[];

  /**
   * 归一化收尾的兜底出口，用于 `fields.extractRecord` 表达不了的收尾修正。
   * 优先考虑能否用声明式字段解决，只有确认差异是「计算」而非「值」或
   * 「有限分支」时才落到这里（防线一：能用 P1 不用 P2，能用 P2 不用 P3）。
   */
  transformRecord?: (record: UnifiedRecordFields, ctx: TransformContext) => UnifiedRecordFields;

  /**
   * 自定义抽数计算。
   *
   * 仅当 `manifest.drawCounting?.kind === "custom"` 时视为必填。典型场景：
   * 异环是掷骰玩法，`count` 字段取值为 1/4/5/16/30/50，语义是「物品数量」
   * 而非「抽数」，无法用默认的 `perRecord`（每条记录算一抽）规则计算，
   * 必须由插件自行实现换算逻辑。
   */
  countDraws?: (records: UnifiedRecordFields[]) => number;
}
