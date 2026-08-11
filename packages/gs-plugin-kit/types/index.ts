// gs-plugin-kit 类型导出入口。
//
// 本目录下只放 gs-codegen 从 crates/gs-core 生成的产物（generated.ts），
// 生成文件禁止手改——HC-3 门禁靠「types/ 目录 = 100% 生成产物」这个前提
// 才能机械判定「有没有人手改生成产物」，目录里混进手写文件会让这个前提
// 失效。带函数字段、无法由 Rust 生成的类型（如 PluginManifest、
// PluginHooks）写在上一级的 ../manifest.ts。
export * from "./generated";
