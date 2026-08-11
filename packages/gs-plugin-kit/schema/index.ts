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

/**
 * 概率分数字段：取值域 `[0, 1]`。
 *
 * 依据 `crates/gs-core/src/pity.rs` 里 `ProbabilityCurve::SoftPity` 文档注释
 * 记录的真实事故——`step` 曾被写成整数百分点（如 `6` 表示 6%），而 `base`
 * 是概率分数（如 `0.006`），两者单位不一致；Rust 侧已经改成统一用 `f64`
 * 分数修正，但生成的 TS 类型两者都只是裸 `number`，**类型本身没有能力
 * 区分「0.06」和「6」哪个对**，插件作者两种写法都能通过编译期检查。
 * 这正是"HC-3 结构检查的盲区，只能靠 schema 兜"的典型案例，因此这里补上
 * 取值域约束——概率不可能小于 0 或大于 1，`6` 这种百分点整数写法会被拒绝。
 */
function probabilityFraction() {
  return z.number().min(0).max(1);
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
  // drawCount / pityMax 都是"抽数"，语义上不可能是负数或分数。
  drawCount: z.number().int().nonnegative().optional(),
  rareEvents: z.array(rareEventRefSchema),
  pityMax: z.number().int().nonnegative().optional(),
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
  // id / accountId 是数据库主键与外键，恒为正整数。
  id: z.number().int().positive(),
  accountId: z.number().int().positive(),
  bannerKey: z.string(),
  pityGroup: z.string(),
  recordKey: recordKeySchema,
  lang: z.string().optional(),
  // occurredAt / capturedAt 是 UTC 毫秒时间戳，恒为非负整数。
  occurredAt: z.number().int().nonnegative(),
  occurredRaw: z.string(),
  tzOrigin: tzOriginSchema,
  // 时区偏移分钟数——刻意不加 nonnegative：西半球时区偏移是负数
  // （如美服 UTC-5 对应 -300），这与 drawCount 之类"抽数"字段不同。
  tzOffsetMin: z.number().int().optional(),
  seqInBatch: z.number().int().nonnegative().optional(),
  itemId: z.string(),
  itemType: optionalNonEmptyString(),
  rarity: optionalNonEmptyString(),
  // qty 是"数量"不是"抽数"，业务默认值为 1，但字段注释明确写"避免把未提供
  // 数量和显式 0 混为一谈"，因此只约束非负整数，不额外要求 positive。
  qty: z.number().int().nonnegative(),
  metaState: metaStateSchema,
  source: recordSourceSchema,
  capturedAt: z.number().int().nonnegative(),
  // rawRef 指向 raw_payload 表的行 id，若存在必为正整数。
  rawRef: z.number().int().positive().optional(),
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
  // count 是"本条获得的物品数量"，米哈游三游恒为 1，异环可为 1/4/5/16/30/50——
  // 无论哪个游戏，都不可能是负数或分数，因此约束为正整数。
  count: z.number().int().positive(),
  name: optionalNonEmptyString(),
  itemType: optionalNonEmptyString(),
  rarity: optionalNonEmptyString(),
  stableId: optionalNonEmptyString(),
});

// ============================================================
// 保底：ProbabilityCurve / GuaranteeRule / PityGroup
// ============================================================

// base / step / table 均为概率分数（见 probabilityFraction 文档注释的
// SoftPity 单位事故）；start 是"第几抽起"，恒为非负整数。
export const probabilityCurveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flat"), base: probabilityFraction() }),
  z.object({
    kind: z.literal("softPity"),
    base: probabilityFraction(),
    start: z.number().int().nonnegative(),
    step: probabilityFraction(),
  }),
  z.object({
    kind: z.literal("progressive"),
    base: probabilityFraction(),
    start: z.number().int().nonnegative(),
    table: z.array(probabilityFraction()),
  }),
  z.object({ kind: z.literal("custom"), id: z.string() }),
]);

export const guaranteeRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fiftyFifty") }),
  z.object({ kind: z.literal("alwaysRateUp") }),
  // rateUpChance 同样是概率分数，同一单位约束。
  z.object({ kind: z.literal("weighted"), rateUpChance: probabilityFraction() }),
  z.object({ kind: z.literal("none") }),
]);

export const pityGroupSchema = z.object({
  key: z.string(),
  members: z.array(z.string()),
  // hardPity 是"多少抽内必出"，恒为正整数（0 抽保底没有意义）。
  hardPity: z.number().int().positive(),
  curve: probabilityCurveSchema,
  guarantee: guaranteeRuleSchema,
});

// ============================================================
// 限速 / 重试 / 错误语义 / 停止条件
// ============================================================

export const backoffKindSchema = z.enum(["fixed", "exponential"]);

export const retryConfigSchema = z.object({
  maxAttempts: z.number().int().positive().optional(),
  backoff: backoffKindSchema.optional(),
  delayMs: z.number().int().nonnegative().optional(),
});

export const rateLimitConfigSchema = z.object({
  perPageDelayMs: z.number().int().nonnegative().optional(),
  batchSize: z.number().int().positive().optional(),
  batchDelayMs: z.number().int().nonnegative().optional(),
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
  z.object({ kind: z.literal("staticTable"), field: z.string(), table: z.record(z.string(), z.number()) }),
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
  width: z.number().int().positive(),
  height: z.number().int().positive(),
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
  // status 是 HTTP 状态码，取值域被协议本身限定在 100~599。
  z.object({
    kind: z.literal("upstream"),
    status: z.number().int().min(100).max(599),
    bodyExcerpt: z.string(),
  }),
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
  // 保留期天数，恒为非负整数。
  conservativeDays: z.number().int().nonnegative(),
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
