//! Tauri 宿主壳层的运行时入口。
//!
//! 具体的 IPC 窄口命令（`scanGameCache` / `callGameApi` 等，参见插件 SDK
//! 设计文档第二节）留待 M1 结合 SDK 校准结果实现；在那之前不预先注册
//! 任何通用能力接口。
//!
//! 本文件目前承担的是"落盘"这一件事：数据库文件路径只有 Tauri 的
//! `PathResolver` 才知道怎么算（不同平台的应用数据目录规则不同），
//! `gs-host` 本身不依赖 tauri，所以路径解析放在这里完成，算好之后以
//! `&Path` 形式注入 `HostRuntime::bootstrap`——`gs-host` 只接收结果，
//! 不反向依赖平台 API。这是 Rust 侧内部能力，不经过前端 IPC，因此不需要
//! 在 `capabilities/default.json` 里额外声明任何权限
//! （capabilities 管的是"前端能调用哪些命令"，不是"Rust 后端能不能读写
//! 自己的应用数据目录"）。

mod commands;

use gs_host::HostRuntime;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// 计算生产环境的数据库文件路径：`<app_data_dir>/gacha-studio.sqlite3`。
/// `app_data_dir` 不存在时一并创建——`rusqlite::Connection::open` 不会自动
/// 建父目录，首次启动时这个目录必然不存在。
fn resolve_db_path(app: &tauri::App) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法解析应用数据目录: {err}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|err| format!("创建应用数据目录失败: {err}"))?;
    Ok(app_data_dir.join("gacha-studio.sqlite3"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db_path = resolve_db_path(app)?;
            let runtime = HostRuntime::bootstrap(&db_path).map_err(|err| err.to_string())?;
            // `HostRuntime` 内部的 `rusqlite::Connection` 只实现了 `Send`，
            // 没有实现 `Sync`（SQLite 连接本身不是无锁并发安全的），而
            // Tauri 的 `manage` 要求托管状态 `Send + Sync`。用 `Mutex`
            // 包一层是 Tauri 处理"非 Sync 资源"的标准做法：以后每个访问
            // 该状态的 IPC 命令都要先 `lock()`，同一时刻只有一个命令能
            // 摸到这个连接，天然避免多线程下的未定义行为。
            app.manage(Mutex::new(runtime));
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::host_runtime_ready,
            commands::list_accounts,
            commands::list_records,
            commands::import_archive_via_picker,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn host_runtime_bootstraps_successfully() {
        assert!(crate::commands::host_runtime_ready());
    }
}
