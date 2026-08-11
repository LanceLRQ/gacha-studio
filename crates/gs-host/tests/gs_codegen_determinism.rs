//! `gs-codegen` 确定性集成测试。
//!
//! HC-3 门禁的验收方式是「重跑 `cargo run -p gs-host --bin gs-codegen` 后
//! `git diff` 必须为空」；这个测试把同样的动作自动化：连续跑两次二进制，
//! 断言产物字节完全一致。放在 `tests/` 而不是 `src/bin/gs-codegen.rs` 内部的
//! `#[cfg(test)]`，是因为 `CARGO_BIN_EXE_gs-codegen` 这个环境变量对「同一个
//! bin target 的自身单元测试」不可用（`env!()` 编译期还不知道自己最终产物的
//! 路径），集成测试作为独立编译目标就没有这个问题。

use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// 生成文件相对仓库根的路径，须与 `src/bin/gs-codegen.rs` 里的
/// `OUTPUT_RELATIVE_PATH` 保持一致。
const OUTPUT_RELATIVE_PATH: &str = "packages/gs-plugin-kit/types/generated.ts";

#[test]
fn codegen_binary_output_is_deterministic_across_two_runs() {
    let output_path = repo_root().join(OUTPUT_RELATIVE_PATH);

    run_codegen_binary();
    let first_run = fs::read(&output_path).expect("第一次运行后应当能读到生成文件");

    run_codegen_binary();
    let second_run = fs::read(&output_path).expect("第二次运行后应当能读到生成文件");

    assert_eq!(
        first_run, second_run,
        "两次运行 gs-codegen 的产物字节不一致，确定性被破坏"
    );
}

fn run_codegen_binary() {
    let status = Command::new(env!("CARGO_BIN_EXE_gs-codegen"))
        .status()
        .expect("应当能执行 gs-codegen 二进制");
    assert!(status.success(), "gs-codegen 二进制执行失败: {status:?}");
}

/// 从当前测试二进制所在 crate 的 `CARGO_MANIFEST_DIR`
/// （`<repo>/crates/gs-host`）回推仓库根目录，逻辑与
/// `src/bin/gs-codegen.rs::repo_root` 一致但各自独立——集成测试不能访问
/// bin target 的私有函数。
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("gs-host 的 CARGO_MANIFEST_DIR 应当位于 <repo>/crates/gs-host")
        .to_path_buf()
}
