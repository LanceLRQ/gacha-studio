/**
 * fixture 契约测试助手。
 *
 * 每个插件在 fixtures/<game>/ 下提供脱敏样本，CI 用这里的 assertPluginFixture
 * 跑一遍完整流程：取样本响应 → 跑插件的 extractList / fields.extractRecord / hooks.* →
 * 运行时校验 → 对比 fixtures/<game>/expected/normalized.json（见插件 SDK 文档第 6.3 节）。
 * 骨架阶段只落地签名与最简实现，具体流程随插件 SDK（M1）落地时补全。
 */

import type { PluginManifest } from "../types";

/** 待校验的插件产出，形状与真实用法 `import { manifest, hooks } from "../manifest"` 对应 */
export interface PluginUnderTest {
  manifest: PluginManifest;
  /** hooks 的具体签名随插件 SDK 落地时补全，骨架阶段先放宽为未知结构 */
  hooks?: Record<string, unknown>;
}

/**
 * 对指定插件跑一遍 fixture 契约测试。
 *
 * @param plugin 待测试的插件（manifest + 可选 hooks）
 * @param fixtureDir fixture 目录路径，如 "fixtures/genshin"
 */
export async function assertPluginFixture(
  plugin: PluginUnderTest,
  fixtureDir: string,
): Promise<void> {
  throw new Error(
    `assertPluginFixture 尚未实现，随插件 SDK（M1）落地时补全（插件 ${plugin.manifest.id}，fixture ${fixtureDir}）`,
  );
}
