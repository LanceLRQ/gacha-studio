/**
 * 插件显式注册表。
 *
 * 选择显式注册而非自动收集：新增一行 import 必须在 PR diff 里一眼可见，
 * 这是 code review 作为唯一安全防线的前提（见插件 SDK 文档第一节）。
 *
 * 新增插件时，在 plugins/<game>/ 下建目录，然后在此追加一行，例如：
 *   () => import("./genshin/manifest"),
 */
export const plugins: Array<() => Promise<unknown>> = [
  // 新插件在此追加一行
];
