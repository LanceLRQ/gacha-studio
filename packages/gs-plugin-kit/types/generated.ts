// 本文件由 gs-codegen 生成，禁止手改。修改请改 crates/gs-core 后重跑 `cargo run -p gs-host --bin gs-codegen`。

export type LocalizedText = Record<string, string>;
export type Platform = "windows" | "macos";
export type RaritySpec = { ladder: Array<string>, pityTarget: string, };
export type RetentionPolicy = { displayText: LocalizedText, conservativeDays: number, };
export type DrawCountingConfig = { "kind": "perRecord", } | { "kind": "custom", };
export type BannerSpec = { 
/**
 * 稳定标识，一旦发布不可更改；会被写入数据库与用户配置。
 */
id: string, displayName: LocalizedText, 
/**
 * 该卡池若不走插件的默认请求端点，在这里覆盖。多数卡池不需要填。
 */
endpointOverride?: string, };
export type HttpMethod = "GET" | "POST";
export type RequestTemplate = { url: string, method?: HttpMethod, headers?: Record<string, string>, };
export type MetadataEntry = { name?: string, itemType?: string, rarity?: string, };
export type RareEventRef = { time: string, itemId: string, };
export type BannerBaseline = { bannerKey: string, drawCount?: number, rareEvents: Array<RareEventRef>, pityMax?: number, };
export type UnifiedRecordFields = { 
/**
 * 物品在游戏内的稳定标识，唯一保证非空的字段。
 */
itemId: string, 
/**
 * 原始时间字符串，未做任何时区换算。
 */
time: string, 
/**
 * 归属卡池，取值对应 [`BannerSpec::id`]。
 */
bannerId: string, 
/**
 * 本条获得的物品数量，语义是「数量」不是「抽数」；米哈游三游恒为 1。
 */
count: number, name?: string, itemType?: string, rarity?: string, stableId?: string, };
export type TzOrigin = "source" | "region" | "user" | "assumed";
export type MetaState = "complete" | "pending" | "unresolvable";
export type RecordSource = "packet" | "ocr" | "officialApi" | "import";
export type RecordKey = string;
export type GachaRecord = { id: number, accountId: number, bannerKey: string, pityGroup: string, recordKey: RecordKey, lang?: string, 
/**
 * 归一化后的 UTC 毫秒时间戳。是否可信取决于 `tz_origin`。
 */
occurredAt: number, 
/**
 * 换算前的原始时间字符串，来源即插件产出的 [`UnifiedRecordFields::time`]。
 */
occurredRaw: string, tzOrigin: TzOrigin, tzOffsetMin?: number, 
/**
 * 同一原始时间戳内的批次序位，用于鸣潮/异环这类同秒可能有多条记录的场景。
 */
seqInBatch?: number, itemId: string, itemType?: string, rarity?: string, 
/**
 * 获得数量，业务默认值为 1（由构造方填充）；序列化层不做隐式默认，
 * 避免消费方把「未提供数量」和「显式为 0」混为一谈。
 */
qty: number, metaState: MetaState, source: RecordSource, 
/**
 * 本地采集完成时刻（UTC 毫秒），与 `occurred_at`（记录在游戏内的发生
 * 时刻）是两个不同的时间轴，不要合并。
 */
capturedAt: number, 
/**
 * 指向原始报文存档表的行 id，供归一化逻辑修 bug 后重放重建；
 * 尚未接入原始报文存储时为 `None`。
 */
rawRef?: number, 
/**
 * 游戏专属附加字段的 JSON 文本，宿主不解析其结构。
 */
extra?: string, };
export type ProbabilityCurve = { "kind": "flat", base: number, } | { "kind": "softPity", base: number, start: number, step: number, } | { "kind": "progressive", base: number, start: number, table: Array<number>, } | { "kind": "custom", id: string, };
export type GuaranteeRule = { "kind": "fiftyFifty", } | { "kind": "alwaysRateUp", } | { "kind": "weighted", rateUpChance: number, } | { "kind": "none", };
export type PityGroup = { key: string, members: Array<string>, hardPity: number, curve: ProbabilityCurve, guarantee: GuaranteeRule, };
export type RateLimitConfig = { perPageDelayMs?: number, batchSize?: number, batchDelayMs?: number, retry?: RetryConfig, };
export type RetryConfig = { maxAttempts?: number, backoff?: BackoffKind, delayMs?: number, };
export type BackoffKind = "fixed" | "exponential";
export type ErrorSemantic = "authkeyExpired" | "rateLimited" | "unknown";
export type StopCondition = { "kind": "emptyPage", } | { "kind": "cursorExhausted", } | { "kind": "reachedKnown", };
export type TimeConfig = { rawTimeConvention?: RawTimeConvention, timezoneSource?: TimezoneSource, };
export type RawTimeConvention = "serverLocal" | "clientLocalized";
export type TimezoneSource = { "kind": "apiField", field: string, } | { "kind": "staticTable", table: Record<string, number>, } | { "kind": "computed", };
export type PreconditionLevel = "required" | "recommended";
export type PreconditionStatus = { "kind": "satisfied", } | { "kind": "unsatisfied", actual: string, } | { "kind": "unknown", };
export type HostEnv = { gameClientSize?: GameClientSize, installedDependencies: Array<string>, };
export type GameClientSize = { width: number, height: number, };
export type AcquireError = { "kind": "gameNotInstalled", searched: Array<string>, } | { "kind": "gameNotRunning", } | { "kind": "cacheFound", path: string, reason: NoCredentialReason, } | { "kind": "credentialExpired", expiredAt?: string, } | { "kind": "missingDependency", dependency: Dependency, } | { "kind": "elevationRequired", } | { "kind": "upstream", status: number, bodyExcerpt: string, } | { "kind": "network", detail: NetworkError, };
export type Dependency = { 
/**
 * 稳定标识，供宿主判断「这个依赖装好了没」。
 */
id: string, displayName: LocalizedText, installHint?: LocalizedText, };
export type NetworkError = { "kind": "timeout", } | { "kind": "dns", } | { "kind": "connectionRefused", } | { "kind": "other", detail: string, };
export type NoCredentialReason = { "kind": "notFound", } | { "kind": "expired", } | { "kind": "malformed", detail: string, };
