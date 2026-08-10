//! Tauri 宿主壳层的运行时入口。
//!
//! 本阶段只做最小验证：确认 `gs-host` 能在 Tauri 运行时环境里正常初始化。
//! 具体的 IPC 窄口命令（`scanGameCache` / `callGameApi` 等，参见插件 SDK
//! 设计文档第二节）留待 M1 结合 SDK 校准结果实现；在那之前不预先注册
//! 任何通用能力接口。

use gs_host::HostRuntime;

/// 骨架阶段的探针命令：验证宿主运行时（存储 + 分析）能在 Tauri 环境下启动。
/// 不暴露任何文件系统 / 网络能力，只返回布尔结果，符合能力窄口原则。
#[tauri::command]
fn host_runtime_ready() -> bool {
    HostRuntime::bootstrap_in_memory().is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![host_runtime_ready])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_runtime_bootstraps_successfully() {
        assert!(host_runtime_ready());
    }
}
