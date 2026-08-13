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
import type { UnifiedRecordFields } from "../types/index.ts";
import {
  assertPluginFixture,
  checkCountDrawsContract,
  checkDeriveRecordKeyContract,
  checkDeriveRecordKeyHooksAreMutuallyExclusive,
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
    paradigm: "credentialedApi",
    params: {
      credential: { kind: "manual" },
      request: { url: "https://example.invalid/{{credential}}" },
      allowedHosts: ["example.invalid"],
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
      paradigm: "credentialedApi" as const,
      params: {
        credential: { kind: "manual" as const },
        request: { url: "https://example.invalid/{{credential}}" },
        allowedHosts: ["example.invalid"],
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
  // 文件名按 "<bannerId>_page_<n>[_后缀].json" 约定命名——bannerId 取 "301"，
  // 与下面 extractRecord 返回的 bannerId 字面量一致（本插件未声明
  // bannerIdentity，不会被覆盖，文件名里的 bannerId 只用于 testkit 分组）。
  "fixtures/self-test/raw_response/301_page_1.json": '{"list":[{"id":"1","name":"测试物品"}]}',
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

  // ============================================================
  // M2-S2 · deriveRecordKeys（批处理钩子）与范式无关的 fixture 支持
  // ============================================================

  {
    name: "deriveRecordKey 互斥契约：同时声明 deriveRecordKey 与 deriveRecordKeys 应报错",
    run: async () => {
      const hooks: PluginHooks = {
        deriveRecordKey: (r) => r.itemId,
        deriveRecordKeys: (records) => records.map((r) => r.itemId),
      };
      await expectThrows(() => checkDeriveRecordKeyHooksAreMutuallyExclusive(hooks), "deriveRecordKeys");
    },
  },
  {
    name: "deriveRecordKey 互斥契约：只声明其一或都不声明时放行",
    run: async () => {
      await expectNotThrows(() => checkDeriveRecordKeyHooksAreMutuallyExclusive({ deriveRecordKey: (r) => r.itemId }));
      await expectNotThrows(() =>
        checkDeriveRecordKeyHooksAreMutuallyExclusive({ deriveRecordKeys: (records) => records.map((r) => r.itemId) }),
      );
      await expectNotThrows(() => checkDeriveRecordKeyHooksAreMutuallyExclusive(undefined));
    },
  },
  {
    name: "deriveRecordKey 契约：只声明批处理版本 deriveRecordKeys 也放行",
    run: async () => {
      await expectNotThrows(() =>
        checkDeriveRecordKeyContract({ deriveRecordKeys: (records) => records.map((r) => r.itemId) }),
      );
    },
  },
  {
    name: "assertPluginFixture：不支持 extractList 的范式（如 ocr）应明确报错，且不再提及已删除的 authkey 字样",
    run: async () => {
      const manifest: PluginManifest = {
        ...baseManifest,
        collect: { paradigm: "ocr", params: { paradigmId: "wuwa-ocr-v0" } },
      };
      await expectThrows(
        () => assertPluginFixture({ manifest }, "fixtures/self-test", explodingReader),
        "credentialedApi",
      );
    },
  },
  {
    name: "assertPluginFixture：deriveRecordKeys 整批调用，鸣潮同秒多条记录靠批内序位区分",
    run: async () => {
      // 模拟鸣潮真实场景的缩小版：extractRecord 产出的两条记录 time 完全
      // 相同、也没有 stableId（鸣潮没有稳定 ID），只有靠"这一批里的第几条"
      // 才能算出不同的 key——这正是本 hook 存在的理由，用单记录版本
      // deriveRecordKey 结构上做不到。
      const batchPlugin = {
        manifest: {
          ...baseManifest,
          collect: {
            paradigm: "credentialedApi" as const,
            params: {
              credential: { kind: "manual" as const },
              request: { url: "https://example.invalid/{{credential}}" },
              allowedHosts: ["example.invalid"],
              extractList: (response: unknown) => (response as { list: unknown[] }).list,
            },
          },
          fields: {
            extractRecord: (raw: unknown) => {
              const record = raw as { name: string };
              return { itemId: record.name, time: "2026-06-18 21:15:00", bannerId: "standard", count: 1 };
            },
          },
        },
        hooks: {
          deriveRecordKeys: (records) =>
            records.map((record, index) => `${record.bannerId}:${record.time}:${index}`),
        } satisfies PluginHooks,
      };

      const batchFixtureFiles = {
        "fixtures/self-test-batch/meta.toml": '[account]\nuid = "100000000"\n',
        "fixtures/self-test-batch/raw_response/standard_page_1.json": JSON.stringify({
          list: [{ name: "共鸣者A" }, { name: "共鸣者B" }],
        }),
        "fixtures/self-test-batch/expected/normalized.json": JSON.stringify({
          records: [
            {
              fields: { itemId: "共鸣者A", time: "2026-06-18 21:15:00", bannerId: "standard", count: 1 },
              recordKey: "standard:2026-06-18 21:15:00:0",
            },
            {
              fields: { itemId: "共鸣者B", time: "2026-06-18 21:15:00", bannerId: "standard", count: 1 },
              recordKey: "standard:2026-06-18 21:15:00:1",
            },
          ],
        }),
      };
      const reader = makeInMemoryReader(batchFixtureFiles);
      await expectNotThrows(() => assertPluginFixture(batchPlugin, "fixtures/self-test-batch", reader));
    },
  },
  {
    name: "assertPluginFixture：deriveRecordKeys 返回长度与记录数不一致时应报错",
    run: async () => {
      const brokenBatchPlugin = {
        manifest: {
          ...baseManifest,
          collect: {
            paradigm: "credentialedApi" as const,
            params: {
              credential: { kind: "manual" as const },
              request: { url: "https://example.invalid/{{credential}}" },
              allowedHosts: ["example.invalid"],
              extractList: (response: unknown) => (response as { list: unknown[] }).list,
            },
          },
          fields: {
            extractRecord: (raw: unknown) => {
              const record = raw as { name: string };
              return { itemId: record.name, time: "2026-06-18 21:15:00", bannerId: "standard", count: 1 };
            },
          },
        },
        hooks: {
          // 反例：漏算了一条，返回的 key 数组比输入记录数少一个。
          deriveRecordKeys: (records) => records.slice(1).map((r) => r.itemId),
        } satisfies PluginHooks,
      };
      const files = {
        "fixtures/self-test-batch-broken/meta.toml": '[account]\nuid = "100000000"\n',
        "fixtures/self-test-batch-broken/raw_response/standard_page_1.json": JSON.stringify({
          list: [{ name: "共鸣者A" }, { name: "共鸣者B" }],
        }),
      };
      const reader = makeInMemoryReader(files);
      await expectThrows(
        () => assertPluginFixture(brokenBatchPlugin, "fixtures/self-test-batch-broken", reader),
        "长度必须一致",
      );
    },
  },

  // ============================================================
  // testkit 与宿主行为对齐修复：文件名约定 + bannerIdentity 覆盖 +
  // 按「单卡池单页」调用 deriveRecordKeys（2026-08-13）
  // ============================================================

  {
    name: "assertPluginFixture：响应样本文件名不符合命名约定时应报错，并给出期望格式",
    run: async () => {
      const files = {
        "fixtures/self-test-bad-filename/meta.toml": '[account]\nuid = "100000000"\n',
        // 不带 "<bannerId>_page_<n>" 前缀——不符合约定格式，不能静默当成一批
        // 处理，必须直接报错并说明期望的命名形式。
        "fixtures/self-test-bad-filename/raw_response/response.json": '{"list":[]}',
      };
      const reader = makeInMemoryReader(files);
      await expectThrows(
        () => assertPluginFixture(minimalFixturePlugin, "fixtures/self-test-bad-filename", reader),
        "<bannerId>_page_<n>",
      );
    },
  },
  {
    name: 'assertPluginFixture：bannerIdentity: "query" 时，bannerId 被覆盖成文件名解析出的卡池 id',
    run: async () => {
      const queryBannerPlugin = {
        manifest: {
          ...baseManifest,
          collect: {
            paradigm: "credentialedApi" as const,
            params: {
              credential: { kind: "manual" as const },
              request: { url: "https://example.invalid/{{credential}}" },
              allowedHosts: ["example.invalid"],
              extractList: (response: unknown) => (response as { list: unknown[] }).list,
              bannerIdentity: "query" as const,
            },
          },
          fields: {
            extractRecord: (raw: unknown) => {
              const record = raw as { id: string };
              // 故意返回一个与真实卡池无关的占位值——模拟鸣潮响应不携带可
              // 还原卡池身份的情形，见 plugins/wuwa/manifest.ts 同款占位串
              // 旁的注释。若覆盖没有生效，下面的 expected 会因这个占位值
              // 对不上而报错。
              return {
                itemId: record.id,
                time: "2026-01-01 00:00:00",
                bannerId: "not-derivable-from-response",
                count: 1,
                stableId: record.id,
              };
            },
          },
        },
        hooks: { deriveRecordKey: (record) => `${record.bannerId}:${record.itemId}` } satisfies PluginHooks,
      };
      const files = {
        "fixtures/self-test-banner-query/meta.toml": '[account]\nuid = "100000000"\n',
        "fixtures/self-test-banner-query/raw_response/42_page_1.json": '{"list":[{"id":"1"}]}',
        "fixtures/self-test-banner-query/expected/normalized.json": JSON.stringify({
          records: [
            {
              fields: { itemId: "1", time: "2026-01-01 00:00:00", bannerId: "42", count: 1, stableId: "1" },
              recordKey: "42:1",
            },
          ],
        }),
      };
      const reader = makeInMemoryReader(files);
      await expectNotThrows(() =>
        assertPluginFixture(queryBannerPlugin, "fixtures/self-test-banner-query", reader),
      );
    },
  },
  {
    name: "assertPluginFixture：未声明 bannerIdentity（默认 response）时，bannerId 保留 extractRecord 原值，不被文件名覆盖",
    run: async () => {
      const responseBannerPlugin = {
        manifest: {
          ...baseManifest,
          collect: {
            paradigm: "credentialedApi" as const,
            params: {
              credential: { kind: "manual" as const },
              request: { url: "https://example.invalid/{{credential}}" },
              allowedHosts: ["example.invalid"],
              extractList: (response: unknown) => (response as { list: unknown[] }).list,
              // bannerIdentity 不声明——默认 "response"，原神现有行为不变。
            },
          },
          fields: {
            extractRecord: (raw: unknown) => {
              const record = raw as { id: string };
              return {
                itemId: record.id,
                time: "2026-01-01 00:00:00",
                bannerId: "raw-response-value",
                count: 1,
                stableId: record.id,
              };
            },
          },
        },
        hooks: { deriveRecordKey: (record) => `${record.bannerId}:${record.itemId}` } satisfies PluginHooks,
      };
      const files = {
        "fixtures/self-test-banner-response/meta.toml": '[account]\nuid = "100000000"\n',
        // 文件名解析出的卡池 id 是 "99"，与 extractRecord 返回的 bannerId 不
        // 同——未声明 bannerIdentity 时不应覆盖，最终应保留 "raw-response-value"。
        "fixtures/self-test-banner-response/raw_response/99_page_1.json": '{"list":[{"id":"1"}]}',
        "fixtures/self-test-banner-response/expected/normalized.json": JSON.stringify({
          records: [
            {
              fields: {
                itemId: "1",
                time: "2026-01-01 00:00:00",
                bannerId: "raw-response-value",
                count: 1,
                stableId: "1",
              },
              recordKey: "raw-response-value:1",
            },
          ],
        }),
      };
      const reader = makeInMemoryReader(files);
      await expectNotThrows(() =>
        assertPluginFixture(responseBannerPlugin, "fixtures/self-test-banner-response", reader),
      );
    },
  },
  {
    name: "assertPluginFixture：deriveRecordKeys 按卡池分别调用，不跨卡池合批",
    run: async () => {
      // 用一个会记录每次调用参数的 deriveRecordKeys，断言它被调用了两次
      // （每个卡池各一次），且每次的输入只包含该卡池自己的记录——这正是
      // 宿主 collect_banner「一次只采集一个卡池」的真实调用形状，早先"全部
      // 文件合成一批只调一次"的实现验证的是一个生产中不会出现的批次。
      const callArgs: UnifiedRecordFields[][] = [];
      const twoBannerPlugin = {
        manifest: {
          ...baseManifest,
          collect: {
            paradigm: "credentialedApi" as const,
            params: {
              credential: { kind: "manual" as const },
              request: { url: "https://example.invalid/{{credential}}" },
              allowedHosts: ["example.invalid"],
              extractList: (response: unknown) => (response as { list: unknown[] }).list,
            },
          },
          fields: {
            extractRecord: (raw: unknown) => {
              const record = raw as { id: string; bannerId: string };
              return { itemId: record.id, time: "2026-01-01 00:00:00", bannerId: record.bannerId, count: 1 };
            },
          },
        },
        hooks: {
          deriveRecordKeys: (records: UnifiedRecordFields[]): string[] => {
            callArgs.push(records);
            return records.map((record, index) => `${record.bannerId}:${index}`);
          },
        } satisfies PluginHooks,
      };
      const files = {
        "fixtures/self-test-two-banners/meta.toml": '[account]\nuid = "100000000"\n',
        "fixtures/self-test-two-banners/raw_response/1_page_1.json": JSON.stringify({
          list: [
            { id: "a", bannerId: "1" },
            { id: "b", bannerId: "1" },
          ],
        }),
        "fixtures/self-test-two-banners/raw_response/2_page_1.json": JSON.stringify({
          list: [{ id: "c", bannerId: "2" }],
        }),
        "fixtures/self-test-two-banners/expected/normalized.json": JSON.stringify({
          records: [
            { fields: { itemId: "a", time: "2026-01-01 00:00:00", bannerId: "1", count: 1 }, recordKey: "1:0" },
            { fields: { itemId: "b", time: "2026-01-01 00:00:00", bannerId: "1", count: 1 }, recordKey: "1:1" },
            { fields: { itemId: "c", time: "2026-01-01 00:00:00", bannerId: "2", count: 1 }, recordKey: "2:0" },
          ],
        }),
      };
      const reader = makeInMemoryReader(files);
      await expectNotThrows(() =>
        assertPluginFixture(twoBannerPlugin, "fixtures/self-test-two-banners", reader),
      );

      if (callArgs.length !== 2) {
        throw new Error(`期望 deriveRecordKeys 被调用 2 次（每个卡池各一次），实际调用了 ${callArgs.length} 次`);
      }
      const firstCall = callArgs[0];
      const secondCall = callArgs[1];
      if (!firstCall || !secondCall) {
        // 不应发生：上面已经断言 callArgs.length === 2。
        throw new Error(`内部错误：callArgs 缺少预期的调用记录：${JSON.stringify(callArgs)}`);
      }
      if (firstCall.length !== 2 || firstCall.some((record) => record.bannerId !== "1")) {
        throw new Error(`第一次调用应只包含卡池 "1" 的 2 条记录，实际：${JSON.stringify(firstCall)}`);
      }
      if (secondCall.length !== 1 || secondCall.some((record) => record.bannerId !== "2")) {
        throw new Error(`第二次调用应只包含卡池 "2" 的 1 条记录，实际：${JSON.stringify(secondCall)}`);
      }
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
