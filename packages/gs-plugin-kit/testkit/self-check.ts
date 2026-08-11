/**
 * `testkit/` 的自检脚本。
 *
 * 为什么单独一个文件、而不是塞在 `index.ts` 底部：`testkit/index.ts` 是
 * `package.json` 里对外导出的契约入口（`"./testkit"`），插件作者会 import 它。
 * 契约入口里不该带测试用例——测试数据会在每次 import 时被构造，更要紧的是
 * 自检需要 `process` / `console` / `import.meta.url` 这些本包没有类型的全局量，
 * 为它们写的 ambient 声明里 `declare global` 是**全局增强**，会污染整个类型
 * 程序（`declare const` 只是模块作用域，不外泄，但 `declare global` 会）。
 * 拆到这个文件后，它不被 `index.ts` 引用、也不在 package.json 的 exports 里，
 * 插件侧永远不会把它拉进类型程序。
 *
 * 测试运行器尚未选型（留待 M1-S4 与 fixture 回归一起定），这里不假装有一套
 * 框架，写成「跑一个函数、断言抛/不抛」的最简自检列表。
 *
 * 运行方式：
 *   node --experimental-strip-types packages/gs-plugin-kit/testkit/self-check.ts
 */

import type { PluginManifest } from "../manifest";
import {
  assertPluginFixture,
  checkCountDrawsContract,
  checkDeriveRecordKeyContract,
  checkResolveTimezoneContract,
} from "./index.ts";

/**
 * 本包没有 `@types/node` 依赖，下面两个 ambient 声明只覆盖本脚本实际用到的
 * 最小接口。刻意**不用** `declare global`——那是全局增强，会外泄到整个类型
 * 程序；`declare const` 在模块里是模块作用域的，止步于本文件。
 *
 * 也刻意不加 `@types/node`：它会让 `import fs from "node:fs"` 在插件侧
 * 通过类型检查，而「TS 侧物理上不提供 fs / fetch / child_process」正是
 * HC-2 想让插件作者在编译期就撞上的墙。为一个自检脚本换掉这堵墙不划算。
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
    name: "deriveRecordKey 契约：显式证实 stableId 也放行（为未来 fixture 版本预留）",
    run: async () => {
      await expectNotThrows(() => checkDeriveRecordKeyContract(undefined, true));
    },
  },
  {
    name: "assertPluginFixture：静态检查全部通过后仍应因流程未实现而报错",
    run: async () => {
      // 三条静态检查要全部满足才能走到「未实现」这一步：baseManifest 本身不带
      // computed 时区、不带 custom 计数，唯独 deriveRecordKey 缺省时默认不满足
      // 第三条契约（见 checkDeriveRecordKeyContract 的保守策略），这里显式补上。
      const plugin = { manifest: baseManifest, hooks: { deriveRecordKey: (r: { itemId: string }) => r.itemId } };
      await expectThrows(() => assertPluginFixture(plugin, "fixtures/self-test"), "尚未实现");
    },
  },
  {
    name: "assertPluginFixture：静态检查不通过时优先报出该错误",
    run: async () => {
      const manifest: PluginManifest = { ...baseManifest, drawCounting: { kind: "custom" } };
      await expectThrows(() => assertPluginFixture({ manifest }, "fixtures/self-test"), "countDraws");
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
