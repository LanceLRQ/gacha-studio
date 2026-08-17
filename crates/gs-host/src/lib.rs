//! `gs-host`：宿主运行时骨架。
//!
//! 聚合存储层（[`gs_storage::Storage`]）与分析层（[`gs_analysis`]）能力，
//! 后续将承载 Tauri IPC 窄口命令背后的具体实现（如 `scanGameCache` /
//! `callGameApi`，参见插件 SDK 设计文档第二节的能力窄口设计）。
//!
//! 插件本身已迁移至 TypeScript（`plugins/index.ts`，由 L1 范式层在采集期
//! 调用其声明的纯函数），本 crate 不做插件加载与注册，也不实现具体的
//! 采集流程——那是 `crates/paradigms/*` 的职责。

use gs_analysis::PityCounter;
use gs_core::GsError;
use gs_storage::Storage;
use std::path::Path;

pub mod analysis;
pub mod archive;
pub mod catalog;
pub mod import;
pub mod retention;
pub mod views;

/// 宿主运行时：当前只承载一个存储连接，后续随 IPC 命令实现逐步扩充
/// （插件注册表、范式流程编排等）。
pub struct HostRuntime {
    storage: Storage,
}

impl HostRuntime {
    /// 以内存数据库启动宿主运行时，供测试与骨架验证使用。
    pub fn bootstrap_in_memory() -> Result<Self, GsError> {
        Ok(Self {
            storage: Storage::open_in_memory()?,
        })
    }

    /// 以磁盘上的数据库文件启动宿主运行时，用于生产环境——关掉应用之后
    /// 数据要还在，`bootstrap_in_memory` 做不到这一点。
    ///
    /// `db_path` 由调用方（`src-tauri`）解析后传入：`gs-host` 本身不依赖
    /// tauri，"应用数据目录在系统里到底在哪"是宿主壳层才知道的平台细节，
    /// 不该反向渗透进这一层。这与 `gs-p-authkey` 的 `InstalledGameLocator`
    /// 把"游戏安装路径怎么来"做成注入式窄口是同一条纪律：本层只接收结果，
    /// 不替调用方决定路径从哪来，也不假装自己有能力独立解析出这个路径。
    pub fn bootstrap(db_path: &Path) -> Result<Self, GsError> {
        let path_str = db_path.to_str().ok_or_else(|| {
            GsError::Storage(format!(
                "数据库路径包含非法 UTF-8，无法打开: {}",
                db_path.display()
            ))
        })?;
        Ok(Self {
            storage: Storage::open(path_str)?,
        })
    }

    /// 暴露底层存储，供后续 IPC 命令实现直接使用。
    pub fn storage(&self) -> &Storage {
        &self.storage
    }

    /// 暴露底层存储的可变引用，供恢复备份等需要独占访问权的操作使用
    /// （`Storage::restore_backup` 要求 `&mut self`——SQLite 的 Online Backup
    /// API 规定备份/恢复期间不允许对目标连接发起其他调用）。
    pub fn storage_mut(&mut self) -> &mut Storage {
        &mut self.storage
    }

    /// 创建一个新的保底计数器。保底统计目前无状态，每次调用独立计数；
    /// 与具体卡池的绑定关系留待存储 schema 落地后再设计。
    pub fn new_pity_counter(&self) -> PityCounter {
        PityCounter::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstraps_with_working_storage_and_analysis_wiring() {
        let runtime = HostRuntime::bootstrap_in_memory().expect("应当成功启动宿主运行时");
        assert!(
            runtime
                .storage()
                .foreign_keys_enabled()
                .expect("应当能读取 pragma")
        );

        let mut counter = runtime.new_pity_counter();
        assert_eq!(counter.record_pull(false), 1);
    }

    fn temp_path(label: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("gs-host-{label}-{}-{nanos}", std::process::id()))
    }

    fn sample_account(plugin_id: &str, game_uid: &str) -> gs_storage::NewAccount {
        gs_storage::NewAccount {
            plugin_id: plugin_id.to_string(),
            game_uid: game_uid.to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days: Some(168),
            created_at: 1_754_800_000_000,
        }
    }

    #[test]
    fn bootstraps_with_file_backed_storage_that_persists_across_restarts() {
        // 直接证明"关掉应用数据不会没"：这正是本任务的前提——落盘之前，
        // 生产路径走的是 bootstrap_in_memory，关掉应用连这条断言都无从谈起。
        let db_path = temp_path("bootstrap-persist").with_extension("sqlite3");
        let _ = std::fs::remove_file(&db_path);

        let account_id = {
            let runtime = HostRuntime::bootstrap(&db_path).expect("首次启动应当成功建库");
            runtime
                .storage()
                .repository()
                .create_account(&sample_account("genshin", "100000000"))
                .expect("创建账号应当成功")
            // `runtime` 在这里离开作用域被 drop，模拟"关掉应用"。
        };

        let runtime = HostRuntime::bootstrap(&db_path).expect("二次启动应当成功打开已有库");
        let found = runtime
            .storage()
            .repository()
            .find_account(account_id)
            .expect("查询应当成功");
        assert!(found.is_some(), "重新打开同一路径后，账号数据应当还在");

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn storage_mut_allows_restoring_a_backup_created_via_storage() {
        // 验证 storage()（&self，供建备份点）与 storage_mut()（&mut self，
        // 供恢复）这对访问器在 HostRuntime 这一层确实能接上，不只是
        // gs-storage 内部单测能跑通——两处的借用不冲突正是靠"建备份点只需
        // 要 &self，恢复才需要 &mut self"这条设计支撑的。
        let db_path = temp_path("restore").with_extension("sqlite3");
        let _ = std::fs::remove_file(&db_path);
        let backup_dir = temp_path("restore-backups");
        let _ = std::fs::remove_dir_all(&backup_dir);

        let mut runtime = HostRuntime::bootstrap(&db_path).expect("应当成功建库");
        let first_account_id = runtime
            .storage()
            .repository()
            .create_account(&sample_account("genshin", "100000000"))
            .expect("创建账号应当成功");

        let backup_path = runtime
            .storage()
            .create_backup(&backup_dir, gs_storage::BackupKind::Manual)
            .expect("建备份点应当成功");

        runtime
            .storage()
            .repository()
            .create_account(&sample_account("starrail", "200000000"))
            .expect("创建第二个账号应当成功");

        runtime
            .storage_mut()
            .restore_backup(&backup_path)
            .expect("恢复应当成功");

        let repo = runtime.storage().repository();
        assert!(
            repo.find_account(first_account_id)
                .expect("查询应当成功")
                .is_some(),
            "备份时刻已存在的账号应当还在"
        );
        assert!(
            repo.find_account_by_identity("starrail", "200000000", "official")
                .expect("查询应当成功")
                .is_none(),
            "备份之后才建的账号应当随回滚消失"
        );

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_dir_all(&backup_dir);
    }
}
