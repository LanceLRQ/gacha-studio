/**
 * 原神插件的 fixture 契约测试入口。
 *
 * `pnpm --filter genshin test`（根 package.json 也暴露了 `gs:test:genshin`
 * 作为等价的快捷方式）跑的就是本文件：读取 `fixtures/genshin/` 下的脱敏样本，
 * 完整跑一遍 `assertPluginFixture`（extractList → extractRecord → hooks →
 * schema 校验 → 与 expected/normalized.json 比对）。
 *
 * 用 `gs-plugin-kit/testkit/node` 的 `nodeFixtureReader` 做真实磁盘读取——
 * 这是本包里唯一允许出现 `node:fs` 的地方，见该文件顶部说明。
 *
 * 运行方式：
 *   node --experimental-strip-types plugins/genshin/fixture.test.ts
 */
import { manifest, hooks } from "./manifest.ts";
import { assertPluginFixture } from "gs-plugin-kit/testkit";
import { nodeFixtureReader } from "gs-plugin-kit/testkit/node";

declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
declare const process: { exitCode?: number };

try {
  await assertPluginFixture({ manifest, hooks }, "fixtures/genshin", nodeFixtureReader);
  console.log(`原神插件 fixture 契约测试：通过（${manifest.id}）`);
} catch (error) {
  console.error(`原神插件 fixture 契约测试：失败（${manifest.id}）`);
  console.error(error);
  process.exitCode = 1;
}
