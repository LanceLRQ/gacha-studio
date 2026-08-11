/**
 * 与 `../types/generated`（Rust 生成的纯数据类型）以及 `../manifest`
 * （手写、含函数字段的类型）对应的运行时校验 schema（zod v4）。
 *
 * 插件产出的记录在写入存储层之前必须经过这里的 schema 校验——类型只在编译期
 * 把关，插件返回的实际数据仍需运行时校验兜底（插件 SDK 文档第六节 HC-3）。
 *
 * 覆盖范围：
 * - `../types/generated` 里的全部纯数据类型，逐一对应一个 schema。
 * - `../manifest` 里 `PluginManifest` **可序列化的子集**：`collect` /
 *   `fields` / `metadata` / `preconditions` / `baseline`
 *   这五个字段刻意不校验——它们都含函数字段（`extractList` /
 *   `extractRecord` / `parseResponse` / `check` 等），zod 校验函数本身
 *   没有意义；这些字段的正确性由 TypeScript 类型检查 + fixture 契约测试
 *   （`../testkit`）兜底，不在本文件覆盖范围内。
 *
 * 本文件与 `../types/generated`、`../manifest` 手动保持同步，两者字段是否
 * 一致目前没有自动派生机制，此处不做自动派生。
 */

import { z } from "zod";

// ============================================================
// 基础类型
// ============================================================

export const localizedTextSchema = z.record(z.string(), z.string());

export const platformSchema = z.enum(["windows", "macos"]);

export const httpMethodSchema = z.enum(["GET", "POST"]);

export const requestTemplateSchema = z.object({
  url: z.string(),
  method: httpMethodSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

/**
 * 可选但不接受空串的字符串字段。用于 `name` / `itemType` / `rarity` /
 * `stableId` 这类「元数据可能缺失」的字段。
 *
 * 依据：星铁真实存档 5372 条记录里有 1 条 `item_id` 有值但 `name` /
 * `item_type` / `rank_type` 全为空字符串（新角色上线当日官方字典未同步）。
 * 若允许空串通过校验，「没有值」与「空字符串」会被误认为等价，消费方无法
 * 区分；用 `.optional()` 表达「可能没有」，用 `.min(1)` 拒绝伪装成
 * 「有值」的空串——空串必须被判定为校验失败，而不是一路穿过校验。
 */
function optionalNonEmptyString() {
  return z.string().min(1).optional();
}

/** 对应 MetadataEntry。字段语义与 UnifiedRecordFields 的同名字段一致，见上方 {@link optionalNonEmptyString}。 */
export const metadataEntrySchema = z.object({
  name: optionalNonEmptyString(),
  itemType: optionalNonEmptyString(),
  rarity: optionalNonEmptyString(),
});

export const rareEventRefSchema = z.object({
  time: z.string(),
  itemId: z.string(),
});

export const bannerBaselineSchema = z.object({
  bannerKey: z.string(),
  drawCount: z.number().optional(),
  rareEvents: z.array(rareEventRefSchema),
  pityMax: z.number().optional(),
});

// ============================================================
// 记录相关：TzOrigin / MetaState / RecordSource / RecordKey / GachaRecord
// ============================================================

export const tzOriginSchema = z.enum(["source", "region", "user", "assumed"]);

export const metaStateSchema = z.enum(["complete", "pending", "unresolvable"]);

export const recordSourceSchema = z.enum(["packet", "ocr", "officialApi", "import"]);

export const recordKeySchema = z.string();

/** 对应 GachaRecord——宿主归一化 + 入库后的记录形态，非插件直接产出的数据。 */
export const gachaRecordSchema = z.object({
  id: z.number(),
  accountId: z.number(),
  bannerKey: z.string(),
  pityGroup: z.string(),
  recordKey: recordKeySchema,
  lang: z.string().optional(),
  occurredAt: z.number(),
  occurredRaw: z.string(),
  tzOrigin: tzOriginSchema,
  tzOffsetMin: z.number().optional(),
  seqInBatch: z.number().optional(),
  itemId: z.string(),
  itemType: optionalNonEmptyString(),
  rarity: optionalNonEmptyString(),
  qty: z.number(),
  metaState: metaStateSchema,
  source: recordSourceSchema,
  capturedAt: z.number(),
  rawRef: z.number().optional(),
  extra: z.string().optional(),
});

/**
 * 对应 UnifiedRecordFields —— 插件 `fields.extractRecord` 与各 hook 返回值的
 * 运行时校验 schema，是本文件**最重要**的一个。
 *
 * 按插件 SDK 文档 §6.2：这些函数的返回值在写入存储层之前必须过这道校验；
 * 校验失败的记录会被拒绝写入并计入诊断报告，而不是带着错误数据静默入库。
 *
 * 两条口径务必对齐文档，不能写错：
 * 1. `name` / `itemType` / `rarity` / `stableId` 用 {@link optionalNonEmptyString}：
 *    可选但不接受空串，理由见该函数的注释。
 * 2. `rarity` 是稀有度码字符串，**不**约束为固定枚举——绝区零实测取值是
 *    `["2","3","4"]`，最高档是 4 不是 5。不同游戏的稀有度阶梯由
 *    `manifest.rarity`（`RaritySpec`）声明，不是这里的静态枚举能表达的。
 */
export const unifiedRecordFieldsSchema = z.object({
  itemId: z.string(),
  time: z.string(),
  bannerId: z.string(),
  count: z.number(),
  name: optionalNonEmptyString(),
  itemType: optionalNonEmptyString(),
  rarity: optionalNonEmptyString(),
  stableId: optionalNonEmptyString(),
});

// ============================================================
// 保底：ProbabilityCurve / GuaranteeRule / PityGroup
// ============================================================

export const probabilityCurveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flat"), base: z.number() }),
  z.object({ kind: z.literal("softPity"), base: z.number(), start: z.number(), step: z.number() }),
  z.object({
    kind: z.literal("progressive"),
    base: z.number(),
    start: z.number(),
    table: z.array(z.number()),
  }),
  z.object({ kind: z.literal("custom"), id: z.string() }),
]);

export const guaranteeRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fiftyFifty") }),
  z.object({ kind: z.literal("alwaysRateUp") }),
  z.object({ kind: z.literal("weighted"), rateUpChance: z.number() }),
  z.object({ kind: z.literal("none") }),
]);

export const pityGroupSchema = z.object({
  key: z.string(),
  members: z.array(z.string()),
  hardPity: z.number(),
  curve: probabilityCurveSchema,
  guarantee: guaranteeRuleSchema,
});

// ============================================================
// 限速 / 重试 / 错误语义 / 停止条件
// ============================================================

export const backoffKindSchema = z.enum(["fixed", "exponential"]);

export const retryConfigSchema = z.object({
  maxAttempts: z.number().optional(),
  backoff: backoffKindSchema.optional(),
  delayMs: z.number().optional(),
});

export const rateLimitConfigSchema = z.object({
  perPageDelayMs: z.number().optional(),
  batchSize: z.number().optional(),
  batchDelayMs: z.number().optional(),
  retry: retryConfigSchema.optional(),
});

export const errorSemanticSchema = z.enum(["authkeyExpired", "rateLimited", "unknown"]);

export const stopConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("emptyPage") }),
  z.object({ kind: z.literal("cursorExhausted") }),
  z.object({ kind: z.literal("reachedKnown") }),
]);

// ============================================================
// 时区策略
// ============================================================

export const rawTimeConventionSchema = z.enum(["serverLocal", "clientLocalized"]);

export const timezoneSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("apiField"), field: z.string() }),
  z.object({ kind: z.literal("staticTable"), table: z.record(z.string(), z.number()) }),
  z.object({ kind: z.literal("computed") }),
]);

export const timeConfigSchema = z.object({
  rawTimeConvention: rawTimeConventionSchema.optional(),
  timezoneSource: timezoneSourceSchema.optional(),
});

// ============================================================
// Precondition 相关的纯数据部分
// ============================================================

export const preconditionLevelSchema = z.enum(["required", "recommended"]);

export const preconditionStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("satisfied") }),
  z.object({ kind: z.literal("unsatisfied"), actual: z.string() }),
  z.object({ kind: z.literal("unknown") }),
]);

export const gameClientSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});

export const hostEnvSchema = z.object({
  gameClientSize: gameClientSizeSchema.optional(),
  installedDependencies: z.array(z.string()),
});

// ============================================================
// 结构化错误：AcquireError 与相关细分类型
// ============================================================

export const dependencySchema = z.object({
  id: z.string(),
  displayName: localizedTextSchema,
  installHint: localizedTextSchema.optional(),
});

export const networkErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("timeout") }),
  z.object({ kind: z.literal("dns") }),
  z.object({ kind: z.literal("connectionRefused") }),
  z.object({ kind: z.literal("other"), detail: z.string() }),
]);

export const noCredentialReasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("notFound") }),
  z.object({ kind: z.literal("expired") }),
  z.object({ kind: z.literal("malformed"), detail: z.string() }),
]);

export const acquireErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("gameNotInstalled"), searched: z.array(z.string()) }),
  z.object({ kind: z.literal("gameNotRunning") }),
  z.object({ kind: z.literal("cacheFound"), path: z.string(), reason: noCredentialReasonSchema }),
  z.object({ kind: z.literal("credentialExpired"), expiredAt: z.string().optional() }),
  z.object({ kind: z.literal("missingDependency"), dependency: dependencySchema }),
  z.object({ kind: z.literal("elevationRequired") }),
  z.object({ kind: z.literal("upstream"), status: z.number(), bodyExcerpt: z.string() }),
  z.object({ kind: z.literal("network"), detail: networkErrorSchema }),
]);

// ============================================================
// PluginManifest 可序列化子集用到的其余纯数据类型
// ============================================================

export const raritySpecSchema = z.object({
  ladder: z.array(z.string()),
  pityTarget: z.string(),
});

export const retentionPolicySchema = z.object({
  displayText: localizedTextSchema,
  conservativeDays: z.number(),
});

export const drawCountingConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("perRecord") }),
  z.object({ kind: z.literal("custom") }),
]);

/** 对应 `PluginManifest.itemIdSource`，见该字段的文档注释。 */
export const itemIdSourceSchema = z.enum(["native", "displayName"]);

export const bannerSpecSchema = z.object({
  id: z.string(),
  displayName: localizedTextSchema,
  endpointOverride: z.string().optional(),
});

// ============================================================
// PluginManifest（可序列化子集）
// ============================================================

/**
 * 对应 `../manifest` 的 `PluginManifest`，但**只校验可序列化字段**。
 *
 * 刻意不校验的字段：`collect`、`fields`、`metadata`、`preconditions`、
 * `baseline`——它们都含函数字段，zod 无法也不应该对函数本身做校验，
 * 这些字段的正确性交给 TypeScript 类型检查（编译期）与 fixture 契约测试
 * （`../testkit`，运行期，跑过样本数据才能验证函数行为）分别兜底。
 *
 * `sdkVersion` 这里只按普通字符串校验：真正的「版本号是否匹配当前 SDK」
 * 由 TypeScript 的字面量类型 {@link SdkVersion} 在编译期把关，运行时没有
 * 必要重复这条更强的约束。
 */
export const pluginManifestSchema = z.object({
  id: z.string(),
  displayName: localizedTextSchema,
  sdkVersion: z.string(),
  platforms: z.array(platformSchema),
  maintainers: z.array(z.string()),
  exchangeFormats: z.array(z.string()).optional(),
  iconUrl: z.string().optional(),
  banners: z.array(bannerSpecSchema),
  pityGroups: z.array(pityGroupSchema).optional(),
  rarity: raritySpecSchema,
  time: timeConfigSchema.optional(),
  retention: retentionPolicySchema.optional(),
  drawCounting: drawCountingConfigSchema.optional(),
  itemIdSource: itemIdSourceSchema.optional(),
});
