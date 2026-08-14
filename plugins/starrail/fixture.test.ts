/**
 * starrail 插件的 fixture 契约测试入口。
 *
 * `pnpm --filter starrail test` 跑的就是本文件。开箱状态下这个测试应该
 * 直接通过——`fixtures/starrail/` 下的示例样本与 manifest.ts 的占位实现
 * 是互相匹配的。接入真实游戏字段后，记得同步更新 fixture，让测试始终反映
 * 真实数据形状，而不是让它永远停留在"能跑通"这一最低要求上。
 *
 * 运行方式：
 *   node --experimental-strip-types fixture.test.ts
 */
import { manifest, hooks } from "./manifest.ts";
import { assertPluginFixture } from "gs-plugin-kit/testkit";
import { nodeFixtureReader } from "gs-plugin-kit/testkit/node";

declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
declare const process: { exitCode?: number };

try {
  await assertPluginFixture({ manifest, hooks }, "fixtures/starrail", nodeFixtureReader);
  console.log(`starrail 插件 fixture 契约测试：通过（${manifest.id}）`);
} catch (error) {
  console.error(`starrail 插件 fixture 契约测试：失败（${manifest.id}）`);
  console.error(error);
  process.exitCode = 1;
}
