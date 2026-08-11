/**
 * fixture 契约测试助手 + 静态契约检查。
 *
 * 完整流程（`assertPluginFixture`）：每个插件在 `fixtures/<game>/` 下提供
 * 脱敏样本，CI 用这里的 `assertPluginFixture` 跑一遍完整流程：取样本响应 →
 * 跑插件的 `extractList` / `fields.extractRecord` / `hooks.*` → 运行时校验 →
 * 对比 `fixtures/<game>/expected/normalized.json`（见插件 SDK 文档第 6.3 节）。
 * `fixtures/` 目录本身要到 M1-S4 才建立，因此本 Stage 不实现这条真实流程，
 * 调用 `assertPluginFixture` 会抛出「尚未实现」错误。
 *
 * 但插件 SDK 文档反复强调「要在 fixture 契约测试阶段报错，而不是留到运行时
 * 静默出错」的三条契约，其实**不依赖任何 fixture 文件**，只需要检查
 * manifest 与 hooks 的静态声明是否自洽，现在就能实现、现在就能跑：
 *
 * 1. `manifest.time?.timezoneSource.kind === "computed"` 却没有 `hooks.resolveTimezone`
 * 2. `manifest.drawCounting?.kind === "custom"` 却没有 `hooks.countDraws`
 * 3. 既没有 `hooks.deriveRecordKey`，也无法静态证实 `UnifiedRecordFields.stableId`
 *    会被填充
 *
 * 这三个检查函数已经落地在本文件里，用例覆盖在同目录的 `self-check.ts`
 * （`node --experimental-strip-types testkit/self-check.ts` 运行，不引入新的
 * 测试运行器依赖）。自检刻意不写在本文件里：本文件是 `package.json` 对外导出的
 * 契约入口，插件作者会 import 它，不该夹带测试用例与全局类型声明。
 *
 * `assertPluginFixture` 在抛出「尚未实现」之前会先跑这三条，让调用方即使在
 * fixture 尚未落地时也能拿到有意义的报错，而不是永远看到同一句「尚未实现」。
 */

import type { PluginHooks, PluginManifest } from "../manifest";

/** 待校验的插件产出，形状与真实用法 `import { manifest, hooks } from "../manifest"` 对应 */
export interface PluginUnderTest {
  manifest: PluginManifest;
  /** 可选——并非所有插件都需要逃生舱 hook。 */
  hooks?: PluginHooks;
}

// ============================================================
// 静态契约检查（不依赖 fixture 文件，现在就能跑）
// ============================================================

/**
 * 契约检查 1/3：`time.timezoneSource.kind === "computed"` 时，
 * `hooks.resolveTimezone` 视为必填。
 *
 * 典型场景：原神——API 不返回任何时区信息，只能按 UID 首位数字推断，
 * 缺少这个 hook 时区就没法算，归一化后的 `occurredAt` 会失真。
 */
export function checkResolveTimezoneContract(manifest: PluginManifest, hooks: PluginHooks | undefined): void {
  if (manifest.time?.timezoneSource?.kind !== "computed") return;
  if (hooks?.resolveTimezone) return;
  throw new Error(
    `插件 "${manifest.id}" 声明 time.timezoneSource.kind === "computed"，` +
      "但未提供 hooks.resolveTimezone——该时区来源意味着 API 不返回任何时区信息，" +
      "缺少这个 hook 会导致归一化后的记录时间无法换算为可信的 UTC 时间戳。",
  );
}

/**
 * 契约检查 2/3：`drawCounting.kind === "custom"` 时，
 * `hooks.countDraws` 视为必填。
 *
 * 典型场景：异环是掷骰玩法，`count` 字段取值 1/4/5/16/30/50，语义是
 * 「物品数量」而非「抽数」，默认的 `perRecord`（每条记录算一抽）规则不适用，
 * 必须由插件自行实现换算逻辑。
 */
export function checkCountDrawsContract(manifest: PluginManifest, hooks: PluginHooks | undefined): void {
  if (manifest.drawCounting?.kind !== "custom") return;
  if (hooks?.countDraws) return;
  throw new Error(
    `插件 "${manifest.id}" 声明 drawCounting.kind === "custom"，` +
      "但未提供 hooks.countDraws——自定义抽数计算逻辑缺失，宿主无法得知" +
      "「这些记录一共该算多少抽」。",
  );
}

/**
 * 契约检查 3/3：`hooks.deriveRecordKey` 缺省时，record_key 生成会退化为
 * 直接使用 `UnifiedRecordFields.stableId`；但「`extractRecord` 是否真的会
 * 填充 `stableId`」是一个**运行时事实**，只有跑过 fixture、检查过样本记录
 * 才能证实（见文件顶部说明，完整版留待 `assertPluginFixture` 在 M1-S4 落地）。
 *
 * 在 fixture 落地之前，本函数保守处理：缺少 `hooks.deriveRecordKey` 一律
 * 视为未满足契约，避免插件作者误以为「不写这个 hook 也行」，直到跑 fixture
 * 才发现 `stableId` 从未被填充过、record_key 早已在运行时静默退化。
 *
 * @param sampleHasStableId 可选。调用方若已经证实（例如跑过 fixture 后
 *   统计得出）`extractRecord` 对所有样本记录都填充了 `stableId`，可传 `true`
 *   放行。fixture 落地前留空即可，本函数按「未证实」处理——这个参数是为
 *   `assertPluginFixture` 的完整版本预留的接口，现在恒定按保守路径求值。
 */
export function checkDeriveRecordKeyContract(hooks: PluginHooks | undefined, sampleHasStableId = false): void {
  if (hooks?.deriveRecordKey) return;
  if (sampleHasStableId) return;
  throw new Error(
    "插件既未提供 hooks.deriveRecordKey，也未证实 UnifiedRecordFields.stableId 会被填充" +
      "——按契约二者必须满足其一，否则 record_key 在运行时可能退化为不稳定或直接缺失。" +
      "米哈游三游这类服务端雪花 ID 场景尤其禁止仅靠 stableId：跨端点（如星铁联动池 " +
      "getLdGachaLog）会与常规卡池的雪花 ID 撞键，必须实现 deriveRecordKey 把卡池维度" +
      "并进去，否则撞键记录会被 INSERT OR IGNORE 静默丢弃。",
  );
}

/** 依次跑完三条静态契约检查，任一不满足即抛出对应错误。 */
export function runStaticContractChecks(plugin: PluginUnderTest, sampleHasStableId = false): void {
  checkResolveTimezoneContract(plugin.manifest, plugin.hooks);
  checkCountDrawsContract(plugin.manifest, plugin.hooks);
  checkDeriveRecordKeyContract(plugin.hooks, sampleHasStableId);
}

// ============================================================
// fixture 契约测试（骨架，真实流程留待 M1-S4）
// ============================================================

/**
 * 对指定插件跑一遍 fixture 契约测试。
 *
 * 本 Stage（M1-S1）只落地签名与静态契约检查，`fixtures/<game>/` 目录本身
 * 要到 M1-S4 才建立。调用本函数会先跑三条静态契约检查（不需要 fixture），
 * 全部通过后才抛出「真实流程尚未实现」错误——这样调用方在 fixture 落地前
 * 也能及时发现 manifest/hooks 声明本身的问题，而不是永远只看到同一句提示。
 *
 * 待 M1-S4 落地后，这里要补全的真实流程：
 * 1. 读取 `fixtureDir` 下 `raw_response/` 里的样本响应
 * 2. 依次跑插件的 `collect.params.extractList` → `fields.extractRecord` → 各 `hooks.*`
 * 3. 用 `../schema` 的 `unifiedRecordFieldsSchema` 做运行时校验
 * 4. 对比 `fixtureDir` 下 `expected/normalized.json`，逐字段断言一致
 *
 * @param plugin 待测试的插件（manifest + 可选 hooks）
 * @param fixtureDir fixture 目录路径，如 "fixtures/genshin"
 */
export async function assertPluginFixture(plugin: PluginUnderTest, fixtureDir: string): Promise<void> {
  runStaticContractChecks(plugin);
  throw new Error(
    `assertPluginFixture 的 fixture 回归流程尚未实现，随 M1-S4（fixtures/ 目录落地时）补全` +
      `（插件 "${plugin.manifest.id}"，fixture 目录 "${fixtureDir}"）。` +
      "本次调用已经跑过静态契约检查（resolveTimezone / countDraws / deriveRecordKey）且全部通过。",
  );
}
