/**
 * `testkit/` 的自检脚本。
 *
 * 为什么单独一个文件、而不是塞在 `index.ts` 底部：`testkit/index.ts` 是
 * `package.json` 里对外导出的契约入口（`"./testkit"`），插件作者会 import 它。
 * 契约入口里不该带测试用例——测试数据会在每次 import 时被构造，更要紧的是
 * 自检需要 `process` / `console` / `import.meta` 这些本包没有类型的全局量，
 * 为它们写的 ambient 声明里 `declare global` 是**全局增强**，会污染整个类型
 * 程序（`declare const` 只是模块作用域，不外泄，但 `declare global` 会）。
 * 拆到这个文件后，它不被 `index.ts` 引用、也不在 package.json 的 exports 里，
 * 插件侧永远不会把它拉进类型程序。
 *
 * 本文件只验证 `assertPluginFixture` 的**流程行为**（静态检查优先、
 * in-memory fixture 能跑通、比对逻辑能发现不一致），不代表任何真实插件的
 * fixture 契约测试——那部分由各插件自己的测试脚本负责（如
 * `plugins/genshin/fixture.test.ts`，用 `gs-plugin-kit/testkit/node` 的
 * `nodeFixtureReader` 真的读磁盘）。这里用一个纯 in-memory 的 `FixtureReader`
 * 实现，保持本文件不需要任何 IO 类型。
 *
 * 测试运行器尚未选型（留待与更多插件一起沉淀公共模式后再定），这里不假装有
 * 一套框架，写成「跑一个函数、断言抛/不抛」的最简自检列表。
 *
 * 运行方式：
 *   node --experimental-strip-types packages/gs-plugin-kit/testkit/self-check.ts
 */

import type { PluginHooks, PluginManifest } from "../manifest";
import {
  assertPluginFixture,
  checkCountDrawsContract,
  checkDeriveRecordKeyContract,
  checkResolveTimezoneContract,
  type FixtureReader,
} from "./index.ts";

/**
 * 本包没有 `@types/node` 依赖，下面的 ambient 声明只覆盖本脚本实际用到的
 * 最小接口。刻意**不用** `declare global`——那是全局增强，会外泄到整个类型
 * 程序；`declare const` 在模块里是模块作用域的，止步于本文件。
 */
declare const process: { argv: string[]; exitCode?: number };
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

interface SelfCheckCase {
  name: string;
  run: () => void | Promise<void>;
}

const baseManifest: PluginManifest = {
  id: "self-test-plugin",
  displayName: { "zh-CN": "自检插件" },
  sdkVersion: "1.0.0" as PluginManifest["sdkVersion"],
  platforms: ["windows"],
  maintainers: ["nobody"],
  collect: {
    paradigm: "authkey",
    params: {
      credential: { kind: "manual" },
      request: { url: "https://example.invalid/{{credential}}" },
      typeParam: "gacha_type",
      extractList: () => [],
    },
  },
  fields: {
    extractRecord: () => ({ itemId: "1", time: "2026-01-01 00:00:00", bannerId: "301", count: 1 }),
  },
  banners: [],
  rarity: { ladder: ["3", "4", "5"], pityTarget: "5" },
};

async function expectThrows(fn: () => unknown, messageContains?: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (messageContains && !(error instanceof Error && error.message.includes(messageContains))) {
      throw new Error(`抛出了错误，但不包含期望的片段 "${messageContains}"：${String(error)}`);
    }
    return;
  }
  throw new Error("期望抛出错误，但没有抛出");
}

async function expectNotThrows(fn: () => unknown): Promise<void> {
  await fn();
}

/** 一个只会抛错的 FixtureReader：用来证明某条检查在触碰任何 fixture 文件之前就已经失败。 */
const explodingReader: FixtureReader = {
  readText: () => {
    throw new Error("不应该在静态契约检查失败之前尝试读取 fixture 文件");
  },
  list: () => {
    throw new Error("不应该在静态契约检查失败之前尝试读取 fixture 文件");
  },
};

/** 纯 in-memory 的 FixtureReader：`files` 的 key 是「相对仓库根目录」的完整路径。 */
function makeInMemoryReader(files: Record<string, string>): FixtureReader {
  return {
    readText: async (relativePath) => {
      const content = files[relativePath];
      if (content === undefined) {
        throw new Error(`in-memory fixture 缺少文件："${relativePath}"`);
      }
      return content;
    },
    list: async (relativeDir) => {
      const prefix = `${relativeDir}/`;
      return Object.keys(files)
        .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map((path) => path.slice(prefix.length));
    },
  };
}

/** 一个能被 `assertPluginFixture` 真正跑通的最小插件：manifest + hooks + 对应的 in-memory fixture 文件。 */
const minimalFixturePlugin = {
  manifest: {
    ...baseManifest,
    collect: {
      paradigm: "authkey" as const,
      params: {
        credential: { kind: "manual" as const },
        request: { url: "https://example.invalid/{{credential}}" },
        typeParam: "gacha_type",
        extractList: (response: unknown) => (response as { list: unknown[] }).list,
      },
    },
    fields: {
      extractRecord: (raw: unknown) => {
        const record = raw as { id: string; name: string };
        return { itemId: record.name, time: "2026-01-01 00:00:00", bannerId: "301", count: 1, stableId: record.id };
      },
    },
  },
  hooks: {
    deriveRecordKey: (record) => `301:${record.stableId}`,
  } satisfies PluginHooks,
};

const minimalFixtureFiles = {
  "fixtures/self-test/meta.toml": '[account]\nuid = "100000000"\n',
  "fixtures/self-test/raw_response/page_1.json": '{"list":[{"id":"1","name":"测试物品"}]}',
  "fixtures/self-test/expected/normalized.json": JSON.stringify({
    records: [
      {
        fields: { itemId: "测试物品", time: "2026-01-01 00:00:00", bannerId: "301", count: 1, stableId: "1" },
        recordKey: "301:1",
      },
    ],
  }),
};

const selfCheckCases: SelfCheckCase[] = [
  {
    name: "resolveTimezone 契约：computed 时区缺 hook 应报错",
    run: async () => {
      const manifest: PluginManifest = { ...baseManifest, time: { timezoneSource: { kind: "computed" } } };
      await expectThrows(() => checkResolveTimezoneContract(manifest, undefined), "resolveTimezone");
      await expectNotThrows(() => checkResolveTimezoneContract(manifest, { resolveTimezone: () => 8 }));
    },
  },
  {
    name: "resolveTimezone 契约：非 computed 时区不要求 hook",
    run: async () => {
      const manifest: PluginManifest = {
        ...baseManifest,
        time: { timezoneSource: { kind: "apiField", field: "x" } },
      };
      await expectNotThrows(() => checkResolveTimezoneContract(manifest, undefined));
    },
  },
  {
    name: "countDraws 契约：custom 计数缺 hook 应报错",
    run: async () => {
      const manifest: PluginManifest = { ...baseManifest, drawCounting: { kind: "custom" } };
      await expectThrows(() => checkCountDrawsContract(manifest, undefined), "countDraws");
      await expectNotThrows(() => checkCountDrawsContract(manifest, { countDraws: () => 0 }));
    },
  },
  {
    name: "countDraws 契约：perRecord 不要求 hook",
    run: async () => {
      const manifest: PluginManifest = { ...baseManifest, drawCounting: { kind: "perRecord" } };
      await expectNotThrows(() => checkCountDrawsContract(manifest, undefined));
    },
  },
  {
    name: "deriveRecordKey 契约：缺 hook 且未证实 stableId 应报错",
    run: async () => {
      await expectThrows(() => checkDeriveRecordKeyContract(undefined), "deriveRecordKey");
      await expectThrows(() => checkDeriveRecordKeyContract({}), "deriveRecordKey");
    },
  },
  {
    name: "deriveRecordKey 契约：提供 hook 即放行",
    run: async () => {
      await expectNotThrows(() => checkDeriveRecordKeyContract({ deriveRecordKey: (r) => r.itemId }));
    },
  },
  {
    name: "deriveRecordKey 契约：显式证实 stableId 也放行（供 assertPluginFixture 内部使用）",
    run: async () => {
      await expectNotThrows(() => checkDeriveRecordKeyContract(undefined, true));
    },
  },
  {
    name: "assertPluginFixture：静态检查不通过时优先报出该错误，且不会触碰任何 fixture 文件",
    run: async () => {
      const manifest: PluginManifest = { ...baseManifest, drawCounting: { kind: "custom" } };
      await expectThrows(
        () => assertPluginFixture({ manifest }, "fixtures/self-test", explodingReader),
        "countDraws",
      );
    },
  },
  {
    name: "assertPluginFixture：能在一份最小 in-memory fixture 上完整跑通",
    run: async () => {
      const reader = makeInMemoryReader(minimalFixtureFiles);
      await expectNotThrows(() => assertPluginFixture(minimalFixturePlugin, "fixtures/self-test", reader));
    },
  },
  {
    name: "assertPluginFixture：expected/normalized.json 与实际结果不一致时应报错",
    run: async () => {
      const brokenFiles = {
        ...minimalFixtureFiles,
        "fixtures/self-test/expected/normalized.json": JSON.stringify({
          records: [
            {
              fields: { itemId: "错误的物品名", time: "2026-01-01 00:00:00", bannerId: "301", count: 1, stableId: "1" },
              recordKey: "301:1",
            },
          ],
        }),
      };
      const reader = makeInMemoryReader(brokenFiles);
      await expectThrows(
        () => assertPluginFixture(minimalFixturePlugin, "fixtures/self-test", reader),
        "不一致",
      );
    },
  },
];

let failed = 0;
for (const testCase of selfCheckCases) {
  try {
    await testCase.run();
    console.log(`  通过  ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  失败  ${testCase.name}`);
    console.error(`        ${String(error)}`);
  }
}
console.log(`\ntestkit 自检：${selfCheckCases.length - failed}/${selfCheckCases.length} 通过`);
if (failed > 0) {
  process.exitCode = 1;
}
