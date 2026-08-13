/**
 * 鸣潮插件的 fixture 契约测试入口。
 *
 * `pnpm --filter wuwa test` 跑的是本文件 + `hooks.test.ts`（见
 * `package.json` 的 `test` 脚本，两者串联执行）。本文件读取 `fixtures/wuwa/`
 * 下的脱敏样本，完整跑一遍 `assertPluginFixture`（extractList → extractRecord
 * → hooks → schema 校验 → 与 expected/normalized.json 比对），形制对齐
 * `plugins/genshin/fixture.test.ts`。
 *
 * ⚠️ **两个已知偏差，读 expected/normalized.json 前必须先知道**：
 *
 * 1. **`bannerId` 字段不是宿主真实产出的值。** 鸣潮 manifest 声明了
 *    `collect.params.bannerIdentity: "query"`——真实采集时，宿主会在
 *    `extractRecord` 返回之后、`hooks.deriveRecordKeys` 之前，把
 *    `bannerId` 覆盖成本次查询实际使用的卡池 id（见 `manifest.ts` 里
 *    `fields.extractRecord` 对应字段的详细注释）。但 `assertPluginFixture`
 *    是纯 TS 侧实现，不经过宿主，因此这里看到的 `bannerId` 全部是
 *    `manifest.ts` 里那个占位常量
 *    `"wuwa-banner-identity-not-derivable-from-response"`——不是真实
 *    产出，不能反推成"宿主也会落这个值"。
 *
 * 2. **`pool_1_slash_time.json` 在这里没有单独验证"时间线格式无关"这条
 *    不变量。** `assertPluginFixture` 按文件名排序读取 `raw_response/` 下
 *    全部样本、拼成同一批数组后一次性调用 `hooks.deriveRecordKeys`——三个
 *    样本文件按文件名排序实际是 `pool_1.json` → `pool_10.json` →
 *    `pool_1_slash_time.json`（`"."` < `"0"` < `"_"` 的 ASCII 序），
 *    `pool_1.json` 与 `pool_1_slash_time.json` 的 17 条记录（同一批真实记录，
 *    仅 `time` 写法不同）会被当成两批**不同**记录一起送进同一次
 *    `deriveRecordKeys` 调用——而不是分别调用两次再比较两次的输出。
 *    `deriveRecordKeys` 的批次内序位是按 `(bannerId, 规范化时间)` 分组累加
 *    计数的，这两批记录的规范化时间逐条相同，混在一起会互相影响对方的序位
 *    计数，算出的 key **不会**相等（已用脚本实测验证：例如两批的第一条
 *    5 连碰撞组记录，合批后 key 分别是 `850f30bc387d6990` 与
 *    `89297a853c5d1c31`，不相等）——这不是 bug，只是"合批快照"这种测试形状
 *    与"时间线格式无关"这个不变量所需的"两次隔离调用再比较"不是同一件事。
 *    本文件的 `expected/normalized.json` 如实记录了合批快照的真实产出，
 *    仍然是一份有效的回归测试（改动 `hooks.ts`/`manifest.ts` 的 extractRecord
 *    逻辑会被这里拦下）；但"时间线格式无关"这条不变量的真正验证在
 *    `hooks.test.ts` 里用两次隔离调用单独覆盖，见该文件对应测试用例。
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
