/**
 * 鸣潮插件的 fixture 契约测试入口。
 *
 * `pnpm --filter wuwa test` 跑的是本文件 + `hooks.test.ts`（见
 * `package.json` 的 `test` 脚本，两者串联执行）。本文件读取 `fixtures/wuwa/`
 * 下的脱敏样本，完整跑一遍 `assertPluginFixture`（按 `<bannerId>_page_<n>
 * [_后缀].json` 解析文件名分组 → extractList → extractRecord → bannerIdentity
 * 覆盖 → hooks → schema 校验 → 与 expected/normalized.json 比对），形制对齐
 * `plugins/genshin/fixture.test.ts`。
 *
 * `raw_response/` 下有两个样本文件，对应鸣潮的两个卡池：
 *   - `1_page_1.json`（PoolType=1，17 条，原名 pool_1.json）
 *   - `10_page_1.json`（PoolType=10，6 条，原名 pool_10.json）
 * `assertPluginFixture` 按卡池分组、组内逐页调用 `hooks.deriveRecordKeys`
 * （鸣潮 `stopCondition: singleRequest`，一个卡池只有一页），因此这里跑出的
 * `bannerId` 与 `recordKey` 现在与宿主真实采集一致：`bannerId` 是
 * `collect.params.bannerIdentity: "query"` 覆盖后的真实卡池 id（"1"/"10"），
 * `recordKey` 是"单卡池单页"批次内序位算出的哈希，不再是合批快照。
 *
 * `variants/pool_1_slash_time.json`（与 `1_page_1.json` 同一批记录，只把
 * `time` 换成斜杠写法）刻意不放进 `raw_response/`——放进去会被当成卡池 1 的
 * 另一页，与 `1_page_1.json` 合并调用同一次 `deriveRecordKeys`，测不出"时间
 * 线格式无关"这条不变量。这条不变量的验证在 `hooks.test.ts` 里用两次隔离
 * 调用单独覆盖，理由见 `fixtures/wuwa/meta.toml` 里该样本条目的说明。
 *
 * 运行方式：
 *   node --experimental-strip-types plugins/wuwa/fixture.test.ts
 */
import { manifest, hooks } from "./manifest.ts";
import { assertPluginFixture } from "gs-plugin-kit/testkit";
import { nodeFixtureReader } from "gs-plugin-kit/testkit/node";

declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
declare const process: { exitCode?: number };

try {
  await assertPluginFixture({ manifest, hooks }, "fixtures/wuwa", nodeFixtureReader);
  console.log(`鸣潮插件 fixture 契约测试：通过（${manifest.id}）`);
} catch (error) {
  console.error(`鸣潮插件 fixture 契约测试：失败（${manifest.id}）`);
  console.error(error);
  process.exitCode = 1;
}
