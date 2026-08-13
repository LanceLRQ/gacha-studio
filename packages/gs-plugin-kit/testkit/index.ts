/**
 * fixture 契约测试助手 + 静态契约检查。
 *
 * 完整流程（`assertPluginFixture`）：每个插件在 `fixtures/<game>/` 下提供
 * 脱敏样本，跑一遍完整流程：按 `<bannerId>_page_<n>[_后缀].json` 的约定解析
 * `raw_response/` 下的样本文件名、按卡池分组 → 卡池内按页序依次跑插件的
 * `collect.params.extractList` / `fields.extractRecord` / 各 `hooks.*` →
 * 过 `../schema` 的 `unifiedRecordFieldsSchema` 运行时校验 → 对比
 * `fixtures/<game>/expected/normalized.json`（插件 SDK 文档第 6.3 节）。
 *
 * ⚠️ **按「单卡池单页」调用 `hooks.deriveRecordKeys`，不合批**——这是对齐
 * 宿主真实行为（`crates/paradigms/gs-p-authkey/src/pipeline.rs` 的
 * `collect_banner`/`derive_record_keys_for_page`）的硬约束：宿主一次只采集
 * 一个卡池，卡池内部逐页处理，每页各调一次 `deriveRecordKeys`，从不跨页、
 * 更不跨卡池合批。早先的实现把 `raw_response/` 下全部文件不分卡池拼成一批
 * 只调一次，对「序位参与 record_key」的插件（鸣潮）算出的批次分组与生产
 * 环境不等价，验证的是一个生产中不会出现的批次形态。
 *
 * 本文件是 `package.json` 对外导出的契约入口（`"./testkit"`），插件作者会
 * import 它，因此刻意不做任何 IO——`assertPluginFixture` 需要读文件，但读取
 * 动作通过注入的 `FixtureReader` 完成，本文件只认这个接口，不关心它背后是
 * Node 的 `fs` 还是别的什么。真正的 Node 实现在同目录的 `node-reader.ts`
 * （对外导出路径 `"gs-plugin-kit/testkit/node"`），该文件不在本文件的导出链
 * 上，插件侧不会被动拉进任何 `fs` 相关类型。
 *
 * 插件 SDK 文档反复强调「要在 fixture 契约测试阶段报错，而不是留到运行时
 * 静默出错」的三条契约，其实**不依赖任何 fixture 文件**，只需要检查
 * manifest 与 hooks 的静态声明是否自洽：
 *
 * 1. `manifest.time?.timezoneSource.kind === "computed"` 却没有 `hooks.resolveTimezone`
 * 2. `manifest.drawCounting?.kind === "custom"` 却没有 `hooks.countDraws`
 * 3. 既没有 `hooks.deriveRecordKey`，也无法证实 `UnifiedRecordFields.stableId`
 *    会被填充
 *
 * 前两条不需要样本数据，`assertPluginFixture` 在触碰任何 fixture 文件之前就
 * 先跑；第三条需要「样本记录是否都填充了 stableId」这个运行时事实，因此延后
 * 到读完样本、跑过 `extractRecord` 之后再判定——用例覆盖在同目录的
 * `self-check.ts`（`node --experimental-strip-types testkit/self-check.ts`
 * 运行，不引入新的测试运行器依赖）。自检刻意不写在本文件里，理由同上。
 */

import type { PluginHooks, PluginManifest, TimezoneContext, TransformContext } from "../manifest.ts";
import type { UnifiedRecordFields } from "../types/index.ts";
// 值导入（非 type-only）在 `node --experimental-strip-types` 下会保留成真实的
// ESM import 语句，Node 的模块解析既不做目录索引解析也不补全扩展名，必须写
// 显式的 "index.ts" 文件名，否则只在 tsc 类型检查阶段能过、实际运行会报
// ERR_UNSUPPORTED_DIR_IMPORT。
import { unifiedRecordFieldsSchema } from "../schema/index.ts";

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
 * 契约检查 3/4：`hooks.deriveRecordKey`/`hooks.deriveRecordKeys` 都缺省时，
 * record_key 生成会退化为直接使用 `UnifiedRecordFields.stableId`；但
 * 「`extractRecord` 是否真的会填充 `stableId`」是一个**运行时事实**，只有
 * 跑过 fixture、检查过样本记录才能证实。
 *
 * 保守处理：两个 hook 都缺省时一律视为未满足契约，避免插件作者误以为
 * 「不写 hook 也行」，直到跑 fixture 才发现 `stableId` 从未被填充过、
 * record_key 早已在运行时静默退化。
 *
 * @param sampleHasStableId 可选。调用方若已经证实（例如跑过 fixture 后
 *   统计得出）`extractRecord` 对所有样本记录都填充了 `stableId`，可传 `true`
 *   放行。`assertPluginFixture` 会在跑完样本后用真实统计结果调用本函数。
 */
export function checkDeriveRecordKeyContract(hooks: PluginHooks | undefined, sampleHasStableId = false): void {
  if (hooks?.deriveRecordKey) return;
  if (hooks?.deriveRecordKeys) return;
  if (sampleHasStableId) return;
  throw new Error(
    "插件既未提供 hooks.deriveRecordKey / hooks.deriveRecordKeys，也未证实 UnifiedRecordFields.stableId 会被填充" +
      "——按契约三者必须满足其一，否则 record_key 在运行时可能退化为不稳定或直接缺失。" +
      "米哈游三游这类服务端雪花 ID 场景尤其禁止仅靠 stableId：跨端点（如星铁联动池 " +
      "getLdGachaLog）会与常规卡池的雪花 ID 撞键，必须实现 deriveRecordKey 把卡池维度" +
      "并进去，否则撞键记录会被 INSERT OR IGNORE 静默丢弃。",
  );
}

/**
 * 契约检查 4/4：`hooks.deriveRecordKey` 与 `hooks.deriveRecordKeys` 互斥，
 * 不能同时声明——二者只能二选一，宿主不会替插件猜该信哪一个（与
 * `crates/paradigms/gs-p-authkey/src/pipeline.rs` 的
 * `validate_derive_record_key_hooks_not_both_declared` 是同一条约束，
 * 这里在 fixture 测试阶段就先拦一次，不必等到真正跑采集才发现）。
 */
export function checkDeriveRecordKeyHooksAreMutuallyExclusive(hooks: PluginHooks | undefined): void {
  if (hooks?.deriveRecordKey && hooks?.deriveRecordKeys) {
    throw new Error(
      "插件同时提供了 hooks.deriveRecordKey 与 hooks.deriveRecordKeys——二者只能二选一。" +
        "前者逐条计算，后者批量计算（一次拿到整批记录），两者语义不兼容，" +
        "宿主不会替插件决定该信哪一个的产出。",
    );
  }
}

/** 依次跑完四条静态契约检查，任一不满足即抛出对应错误。 */
export function runStaticContractChecks(plugin: PluginUnderTest, sampleHasStableId = false): void {
  checkResolveTimezoneContract(plugin.manifest, plugin.hooks);
  checkCountDrawsContract(plugin.manifest, plugin.hooks);
  checkDeriveRecordKeyHooksAreMutuallyExclusive(plugin.hooks);
  checkDeriveRecordKeyContract(plugin.hooks, sampleHasStableId);
}

// ============================================================
// fixture 契约测试：真实流程
// ============================================================

/** 注入式文件读取器，`assertPluginFixture` 本身不做任何 IO，只认这个接口。 */
export interface FixtureReader {
  /** 读取一个文本文件，`relativePath` 相对仓库根目录（如 "fixtures/genshin/meta.toml"）。 */
  readText(relativePath: string): Promise<string>;
  /** 列出一个目录下的文件名（不含路径前缀），`relativeDir` 同样相对仓库根目录。 */
  list(relativeDir: string): Promise<string[]>;
}

/** `expected/normalized.json` 里单条记录的形状。 */
interface NormalizedFixtureRecord {
  /** `extractRecord`（可能再经 `hooks.transformRecord` 处理）之后的最终字段。 */
  fields: UnifiedRecordFields;
  /** `hooks.deriveRecordKey` 的输出，缺省时退化为 `fields.stableId`。 */
  recordKey: string;
  /** 仅当 `manifest.time?.timezoneSource.kind === "computed"` 时存在。 */
  timezoneOffsetHours?: number;
}

interface NormalizedFixture {
  records: NormalizedFixtureRecord[];
}

interface FixtureMeta {
  account?: { uid?: string; region?: string };
}

/**
 * `meta.toml` 的极简子集解析：只认 `[section]` 与 `key = "value"` 两种写法，
 * 不支持数组、内联表、多行字符串——`meta.toml` 里其余字段（游戏版本、采集
 * 日期、脱敏说明等）只是给人看的展示信息，`assertPluginFixture` 真正需要
 * 程序读取的只有 `[account]` 小节（用来构造 `hooks.resolveTimezone` 的
 * `TimezoneContext`）。
 */
function parseFixtureMeta(text: string): FixtureMeta {
  const meta: FixtureMeta = {};
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      continue;
    }
    const kv = /^([\w.-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2]?.trim() ?? "";
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (section === "account" && key) {
      meta.account ??= {};
      if (key === "uid") meta.account.uid = value;
      if (key === "region") meta.account.region = value;
    }
  }
  return meta;
}

/**
 * 结构相等比较：对象按键集合比较（缺失键与显式 `undefined` 视为等价——
 * JSON 里没有 `undefined`，手写的 `expected/normalized.json` 会直接省略
 * 可选字段，而运行时算出来的记录对象往往会显式带上 `key: undefined`），
 * 数组按下标顺序比较，其余按 `Object.is`。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  const aUndef = a === undefined;
  const bUndef = b === undefined;
  if (aUndef || bUndef) return aUndef === bUndef;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)]);
    for (const key of keys) {
      if (!deepEqual(aRecord[key], bRecord[key])) return false;
    }
    return true;
  }
  return a === b;
}

/**
 * 批量算出一组样本记录的 record_key，三选一（与 `runStaticContractChecks`
 * 已经保证的互斥性一致）：
 * 1. `hooks.deriveRecordKeys`——整批一次调用，返回值长度必须与输入一致；
 * 2. `hooks.deriveRecordKey`——逐条调用；
 * 3. 都未声明——退化到每条记录自己的 `stableId`。
 *
 * 与 `crates/paradigms/gs-p-authkey/src/pipeline.rs` 的
 * `derive_record_keys_for_page` 是同一套优先级，两处独立实现是因为
 * 一个跑在 TS 侧（fixture 测试），一个跑在 Rust 侧（真实采集），但语义
 * 必须一致——fixture 测出来"对"的批处理逻辑，采集时不能得出不同结果。
 */
function deriveFixtureRecordKeys(hooks: PluginHooks | undefined, allFields: UnifiedRecordFields[]): string[] {
  if (hooks?.deriveRecordKeys) {
    const keys = hooks.deriveRecordKeys(allFields);
    if (keys.length !== allFields.length) {
      throw new Error(
        `hooks.deriveRecordKeys 返回了 ${keys.length} 个 key，但输入了 ${allFields.length} 条记录，长度必须一致`,
      );
    }
    return keys;
  }

  return allFields.map((fields) => {
    const recordKey = hooks?.deriveRecordKey ? hooks.deriveRecordKey(fields) : fields.stableId;
    if (!recordKey) {
      throw new Error(
        `记录既没有 hooks.deriveRecordKey 也没有 stableId，无法得到 record_key（itemId="${fields.itemId}"）`,
      );
    }
    return recordKey;
  });
}

/** `raw_response/` 下单个样本文件按约定格式解析出的卡池归属与页序。 */
interface ParsedResponseFileName {
  fileName: string;
  bannerId: string;
  pageIndex: number;
}

/**
 * `raw_response/<bannerId>_page_<n>[_后缀].json`——如 `"301_page_1.json"`、
 * `"301_page_3_empty.json"`、`"1_page_1.json"`。后缀（下划线之后、`.json`
 * 之前的部分）纯粹是给人看的展示信息（如 genshin 用 `_empty` 标记空页
 * fixture），不参与解析。
 */
const RESPONSE_FILE_NAME_PATTERN = /^([A-Za-z0-9]+)_page_(\d+)(?:_[A-Za-z0-9]+)?\.json$/;

/**
 * 解析响应样本文件名，取出该文件属于哪个卡池、是第几页——`assertPluginFixture`
 * 要按「单卡池单页」调用 `deriveRecordKeys`（见本文件头部说明），就必须先知道
 * 这两件事，而它们通常不在响应体本身里（鸣潮的响应元素甚至不携带可还原的
 * 卡池 id，见 `plugins/wuwa/manifest.ts` 的 `fields.extractRecord` 注释），
 * 只能靠文件名约定表达。
 *
 * 解析失败直接抛错、附上期望格式，**不静默回退成"当作一批处理"**——静默
 * 回退等于这层校验从未存在过，是本项目反复记录的失效模式（门通过是因为它
 * 什么都没检查），早先"全部文件合成一批"的实现正是这个模式的实例。
 */
function parseResponseFileName(fileName: string): ParsedResponseFileName {
  const match = RESPONSE_FILE_NAME_PATTERN.exec(fileName);
  if (!match) {
    throw new Error(
      `响应样本文件名 "${fileName}" 不符合约定格式 "<bannerId>_page_<n>[_后缀].json"` +
        `（如 "301_page_1.json"、"301_page_3_empty.json"）——assertPluginFixture 需要从` +
        "文件名解析出所属卡池与页序，才能模拟宿主 collect_banner「单卡池单页」调用 " +
        "hooks.deriveRecordKeys 的真实行为，不能静默当成一批处理。",
    );
  }
  const [, bannerId, pageIndexText] = match;
  if (bannerId === undefined || pageIndexText === undefined) {
    // 不应发生：两个捕获组都是正则里非可选的部分，`match` 成立即保证两者存在。
    throw new Error(`内部错误：文件名 "${fileName}" 匹配成功但捕获组缺失`);
  }
  return { fileName, bannerId, pageIndex: Number(pageIndexText) };
}

/**
 * 对指定插件跑一遍 fixture 契约测试。
 *
 * 流程：
 * 1. 先跑 `checkResolveTimezoneContract` / `checkCountDrawsContract`——这两条
 *    不需要样本数据，manifest/hooks 声明本身有问题应当最先暴露。
 * 2. 读取 `fixtureDir/meta.toml`（取 `[account]` 小节）与
 *    `fixtureDir/raw_response/*.json`，按 `parseResponseFileName` 解析出的
 *    卡池 id 分组、组内按页序排序——对齐宿主 `collect_banner` 一次只采集
 *    一个卡池、卡池内部逐页处理的调用形状。
 * 3. 按「卡池 → 页」顺序处理每个响应文件：跑 `collect.params.extractList`
 *    取出本页记录数组，对每条记录跑 `fields.extractRecord` → schema 校验 →
 *    可选的 `hooks.transformRecord` → 再次校验 → 若 manifest 声明了
 *    `collect.params.bannerIdentity === "query"`，把 `bannerId` 覆盖成本页
 *    所属的卡池 id（时机对齐宿主 `build_records`：在 `extractRecord`/
 *    `transformRecord` 之后、`deriveRecordKeys` 之前，见该覆盖分支旁的
 *    注释）。
 * 4. **每页各自**批量算出这一页的 `recordKey`：`hooks.deriveRecordKeys`
 *    （整批一次调用，输入只是这一页的记录）优先，其次 `hooks.deriveRecordKey`
 *    （逐条调用），都未声明则退化到各自的 `stableId`——**不能逐条算**，
 *    `deriveRecordKeys` 需要同时看到"这一页里的其余记录"才能算出序位，理由
 *    见 `PluginHooks.deriveRecordKeys` 的文档。再算（若时区来源是
 *    `computed`）`hooks.resolveTimezone`。
 * 5. 用全部页面汇总出的「样本是否全部有 stableId」调用
 *    `checkDeriveRecordKeyContract`——这一条必须等样本跑完才有意义。
 * 6. 读取 `fixtureDir/expected/normalized.json`，与第 4 步按「卡池 → 页 →
 *    页内原始顺序」拼接的结果逐条深比较。
 *
 * 本 Stage 只支持声明了 `collect.params.extractList` 的范式（目前唯一实现
 * 是 `credentialedApi`）——按**能力**（是否有 `extractList` 可跑）判断，
 * 不写死具体的 `paradigm` 字符串，这样未来任何新范式只要复用同一套
 * `extractList`/`extractRecord` 流程就能直接被本函数支持，不需要在这里
 * 逐个加白名单。`packetCapture`/`ocr` 目前仍是 0 样本占位骨架，params 里
 * 没有 `extractList`，会被明确拒绝，而不是假装能测。
 *
 * @param plugin 待测试的插件（manifest + 可选 hooks）
 * @param fixtureDir fixture 目录路径，相对仓库根目录，如 "fixtures/genshin"
 * @param reader 文件读取器，仓库内测试脚本用 `gs-plugin-kit/testkit/node` 的 `nodeFixtureReader`
 */
export async function assertPluginFixture(
  plugin: PluginUnderTest,
  fixtureDir: string,
  reader: FixtureReader,
): Promise<void> {
  checkResolveTimezoneContract(plugin.manifest, plugin.hooks);
  checkCountDrawsContract(plugin.manifest, plugin.hooks);
  checkDeriveRecordKeyHooksAreMutuallyExclusive(plugin.hooks);

  if (!("extractList" in plugin.manifest.collect.params)) {
    throw new Error(
      `assertPluginFixture 目前只支持声明了 collect.params.extractList 的范式（当前唯一实现是 ` +
        `credentialedApi）——插件 "${plugin.manifest.id}" 声明的 paradigm 是 ` +
        `"${plugin.manifest.collect.paradigm}"，packetCapture/ocr 范式仍是 0 样本占位骨架，` +
        "尚无可运行的 fixture 契约测试实现。",
    );
  }
  const { extractList, bannerIdentity } = plugin.manifest.collect.params;
  const { extractRecord } = plugin.manifest.fields;

  const metaText = await reader.readText(`${fixtureDir}/meta.toml`);
  const meta = parseFixtureMeta(metaText);
  const timezoneCtx: TimezoneContext = {
    uid: meta.account?.uid ?? "",
    region: meta.account?.region,
  };

  const responseFileNames = (await reader.list(`${fixtureDir}/raw_response`))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (responseFileNames.length === 0) {
    throw new Error(`fixture 目录 "${fixtureDir}/raw_response" 下没有任何样本响应文件`);
  }

  // 按 <bannerId>_page_<n>[_后缀].json 解析文件名、按卡池分组，组内按页序
  // 排序——见 parseResponseFileName 与本文件头部对齐宿主行为的说明。解析
  // 失败在这里直接抛出，不会往下走到任何一次 extractList/extractRecord。
  const parsedFileNames = responseFileNames.map(parseResponseFileName);
  const pagesByBanner = new Map<string, ParsedResponseFileName[]>();
  for (const parsed of parsedFileNames) {
    const pages = pagesByBanner.get(parsed.bannerId) ?? [];
    pages.push(parsed);
    pagesByBanner.set(parsed.bannerId, pages);
  }
  for (const pages of pagesByBanner.values()) {
    pages.sort((a, b) => a.pageIndex - b.pageIndex);
  }
  const bannerIds = [...pagesByBanner.keys()].sort();

  // 第一阶段：按「卡池 → 页」的顺序跑完 extractList/extractRecord/
  // transformRecord/bannerIdentity 覆盖，按页分组收集 fields——
  // deriveRecordKeys（批处理钩子）需要同一页的整批数据一起传给插件，
  // 不能逐条调用，也不能跨页/跨卡池合批（本文件头部说明）。
  const timezoneRequired = plugin.manifest.time?.timezoneSource?.kind === "computed";
  const pageBatches: Array<{ fileName: string; fields: UnifiedRecordFields[] }> = [];
  const allFields: UnifiedRecordFields[] = [];

  for (const bannerId of bannerIds) {
    const pages = pagesByBanner.get(bannerId);
    if (!pages) {
      // 不应发生：bannerIds 就是从 pagesByBanner 的 key 集合取出的。
      throw new Error(`内部错误：卡池 "${bannerId}" 的分组在 pagesByBanner 中丢失`);
    }
    for (const { fileName } of pages) {
      const rawText = await reader.readText(`${fixtureDir}/raw_response/${fileName}`);
      let response: unknown;
      try {
        response = JSON.parse(rawText);
      } catch (error) {
        throw new Error(`解析样本响应 "${fileName}" 失败：${String(error)}`);
      }

      const list = extractList(response);
      if (!Array.isArray(list)) {
        throw new Error(`插件 "${plugin.manifest.id}" 的 extractList 在样本 "${fileName}" 上没有返回数组`);
      }

      const pageFields: UnifiedRecordFields[] = [];
      for (const rawRecord of list) {
        let fields = extractRecord(rawRecord);
        const parsed = unifiedRecordFieldsSchema.safeParse(fields);
        if (!parsed.success) {
          throw new Error(
            `样本 "${fileName}" 中的一条记录未通过 unifiedRecordFieldsSchema 校验：${parsed.error.message}`,
          );
        }
        fields = parsed.data as UnifiedRecordFields;

        if (plugin.hooks?.transformRecord) {
          const transformCtx: TransformContext = { bannerId: fields.bannerId };
          fields = plugin.hooks.transformRecord(fields, transformCtx);
          const reparsed = unifiedRecordFieldsSchema.safeParse(fields);
          if (!reparsed.success) {
            throw new Error(
              `样本 "${fileName}" 的记录经 hooks.transformRecord 处理后未通过校验：${reparsed.error.message}`,
            );
          }
          fields = reparsed.data as UnifiedRecordFields;
        }

        // bannerIdentity: "query" 时，在 extractRecord（及可能的
        // transformRecord）之后、deriveRecordKeys 之前，把 bannerId 换成
        // 本页文件名解析出的卡池 id——时机对齐宿主 build_records（见该方法
        // 文档："提前到这里之后……deriveRecordKeys/banner_key/pity_group
        // 三处天然一致"）：晚一步（比如落库前才覆盖）会让 deriveRecordKeys
        // 读到与卡池无关的占位值，record_key 就少了卡池这一维。未声明或
        // 声明 "response" 时不覆盖——原神会混池、必须信响应，现有行为不变。
        if (bannerIdentity === "query") {
          fields = { ...fields, bannerId };
        }

        pageFields.push(fields);
        allFields.push(fields);
      }

      pageBatches.push({ fileName, fields: pageFields });
    }
  }

  const sampleCount = allFields.length;
  const sampleWithStableId = allFields.filter((fields) => Boolean(fields.stableId)).length;
  checkDeriveRecordKeyContract(plugin.hooks, sampleCount > 0 && sampleWithStableId === sampleCount);

  // 第二阶段：**每页各自**算出这一页的 record_key，不跨页/跨卡池合批——
  // 与宿主 derive_record_keys_for_page 的调用形状一致，再拼上（若需要）
  // 时区偏移。
  const normalizedRecords: NormalizedFixtureRecord[] = [];
  for (const { fileName, fields: pageFields } of pageBatches) {
    const pageRecordKeys = deriveFixtureRecordKeys(plugin.hooks, pageFields);
    for (let i = 0; i < pageFields.length; i++) {
      const fields = pageFields[i];
      const recordKey = pageRecordKeys[i];
      if (fields === undefined || recordKey === undefined) {
        // 不应发生：deriveFixtureRecordKeys 已经保证返回值与 pageFields 等长；
        // 这里只是让 noUncheckedIndexedAccess 下标访问的类型收窄成立，同时
        // 留一道防线，而不是用非空断言假装"肯定不会错"。
        throw new Error(`内部错误：样本 "${fileName}" 第 ${i + 1} 条记录或其 record_key 缺失`);
      }
      const normalized: NormalizedFixtureRecord = { fields, recordKey };
      if (timezoneRequired) {
        // 上面的 checkResolveTimezoneContract 已经保证 hooks.resolveTimezone 存在。
        normalized.timezoneOffsetHours = plugin.hooks?.resolveTimezone?.(fields, timezoneCtx);
      }
      normalizedRecords.push(normalized);
    }
  }

  const expectedText = await reader.readText(`${fixtureDir}/expected/normalized.json`);
  let expected: NormalizedFixture;
  try {
    expected = JSON.parse(expectedText) as NormalizedFixture;
  } catch (error) {
    throw new Error(`解析 "${fixtureDir}/expected/normalized.json" 失败：${String(error)}`);
  }

  if (!Array.isArray(expected.records)) {
    throw new Error(`"${fixtureDir}/expected/normalized.json" 缺少 records 数组`);
  }
  if (expected.records.length !== normalizedRecords.length) {
    throw new Error(
      `记录数不一致：expected/normalized.json 有 ${expected.records.length} 条，实际跑出 ${normalizedRecords.length} 条`,
    );
  }
  for (let i = 0; i < expected.records.length; i++) {
    const exp = expected.records[i];
    const act = normalizedRecords[i];
    if (!deepEqual(exp, act)) {
      throw new Error(
        `第 ${i + 1} 条记录与期望不一致：\n期望 ${JSON.stringify(exp)}\n实际 ${JSON.stringify(act)}`,
      );
    }
  }
}
