//! 备份点与回滚：基于 rusqlite 官方 Online Backup API。
//!
//! **为什么不走"拷贝数据库文件"这条更简单的路**：拷文件现在看起来安全，
//! 只是因为当前连接停留在 SQLite 默认的 rollback journal（`DELETE` 模式）
//! ——只要拷贝时没有并发写入，主文件本身就是自洽的完整快照。但这个前提是
//! 隐性的：一旦将来任何人给这个连接加一行 `PRAGMA journal_mode=WAL`，数据
//! 就可能分散在主文件与 `-wal`/`-shm` 边车文件之间，拷贝主文件会**静默**
//! 产出一份缺数据的残缺快照——不报错，只在真正需要回滚的那天才会被发现。
//! Online Backup API（`Connection::backup` / `Connection::restore`，均由
//! `rusqlite` 的 `backup` feature 提供）直接调用 SQLite 自身的页级复制接口，
//! 与 journal_mode 完全无关，两种模式下都能拿到一致快照。
//!
//! 本模块的 `impl Storage` 写在这里而不是 `lib.rs`——`Storage` 是在 `lib.rs`
//! 定义的，但 inherent impl 可以分布在同一 crate 的任意子模块里；`backup`
//! 是 `lib.rs` 的子模块，按 Rust 的可见性规则能直接访问 `Storage.conn` 这个
//! 私有字段，不需要额外开放访问器，与 `repository.rs` 把 `Repository` 的定义
//! 和实现放在同一处是同一种"关联代码就近安置"的考虑，只是这里的宿主类型
//! `Storage` 定义在别处。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use gs_core::GsError;
use rusqlite::backup::Progress;

use crate::{Storage, migrations};

/// 自动备份点最多保留的份数；超出后按创建顺序删最旧的。手动备份不计入这个
/// 上限，也不参与清理——用户手动建的备份点是"我认定这个时刻值得留"的
/// 明确意图，不该被自动化机制悄悄删掉。
const AUTO_BACKUP_RETENTION: usize = 5;

const AUTO_PREFIX: &str = "auto";
const MANUAL_PREFIX: &str = "manual";

/// 进程内单调递增的计数器，与毫秒时间戳一起拼进文件名。
///
/// 只靠时间戳不够：保留策略的清理测试要在紧凑循环里连续建 N+2 个备份点，
/// 系统时钟的实际分辨率不能保证这些调用毫秒级不重复（尤其是虚拟化的 CI
/// 环境）。计数器保证同一进程内任意两次调用产出的文件名严格递增，据此排序
/// 就是真实的创建顺序，不依赖文件系统 mtime 的精度或时钟本身的分辨率。
static BACKUP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 一个备份点的来源：手动建的还是自动化流程（如未来的导入前快照）建的。
/// 两者只在文件名前缀和是否参与保留策略清理上有区别，数据格式完全一样。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupKind {
    Automatic,
    Manual,
}

impl BackupKind {
    fn prefix(self) -> &'static str {
        match self {
            BackupKind::Automatic => AUTO_PREFIX,
            BackupKind::Manual => MANUAL_PREFIX,
        }
    }
}

fn storage_err(err: impl std::fmt::Display) -> GsError {
    GsError::Storage(err.to_string())
}

/// 生成一个带时间戳、且在本进程内严格单调的备份文件名。
fn backup_file_name(kind: BackupKind) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = BACKUP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{millis}-{seq:020}.sqlite3", kind.prefix())
}

/// 从文件名尾部解析出 [`backup_file_name`] 拼入的单调序号，用于按创建顺序
/// 排序。解析失败（文件名不是本模块产出的格式）返回 `None`，调用方据此
/// 把"目录里混进来的不相干文件"排除在保留策略之外，而不是 panic 或误删。
fn sequence_from_name(file_name: &str) -> Option<u64> {
    let stem = file_name.strip_suffix(".sqlite3")?;
    let seq_str = stem.rsplit('-').next()?;
    seq_str.parse::<u64>().ok()
}

/// 列出 `dir` 下所有匹配 `kind` 前缀的备份文件，按创建顺序（旧到新）排序。
fn list_backups_ordered(dir: &Path, kind: BackupKind) -> Result<Vec<PathBuf>, GsError> {
    let prefix_with_sep = format!("{}-", kind.prefix());
    let mut entries: Vec<(u64, PathBuf)> = Vec::new();

    for entry in fs::read_dir(dir).map_err(|err| storage_err(format!("读取备份目录失败: {err}")))?
    {
        let entry = entry.map_err(|err| storage_err(format!("读取备份目录条目失败: {err}")))?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.starts_with(&prefix_with_sep) {
            continue;
        }
        if let Some(seq) = sequence_from_name(file_name) {
            entries.push((seq, path));
        }
    }

    entries.sort_by_key(|(seq, _)| *seq);
    Ok(entries.into_iter().map(|(_, path)| path).collect())
}

/// 把自动备份点数量收敛到 [`AUTO_BACKUP_RETENTION`]，超出的部分从最旧的开始删。
/// 只处理 `Automatic` 前缀的文件，手动备份不在扫描范围内，不会被误删。
fn enforce_retention(backup_dir: &Path) -> Result<(), GsError> {
    let autos = list_backups_ordered(backup_dir, BackupKind::Automatic)?;
    if autos.len() <= AUTO_BACKUP_RETENTION {
        return Ok(());
    }
    let overflow = autos.len() - AUTO_BACKUP_RETENTION;
    for stale in &autos[..overflow] {
        fs::remove_file(stale).map_err(|err| storage_err(format!("清理旧备份失败: {err}")))?;
    }
    Ok(())
}

impl Storage {
    /// 建一个备份点：把当前库完整备份到 `backup_dir` 下一个带时间戳的新文件，
    /// 返回该文件路径。`backup_dir` 不存在时会自动创建。
    ///
    /// `kind` 为 [`BackupKind::Automatic`] 时，成功后会顺带触发保留策略清理
    /// （见 [`enforce_retention`]）；`Manual` 备份不受这条约束。
    pub fn create_backup(&self, backup_dir: &Path, kind: BackupKind) -> Result<PathBuf, GsError> {
        fs::create_dir_all(backup_dir)
            .map_err(|err| storage_err(format!("创建备份目录失败: {err}")))?;
        let dest_path = backup_dir.join(backup_file_name(kind));

        self.conn
            .backup(rusqlite::MAIN_DB, &dest_path, None)
            .map_err(|err| storage_err(format!("创建备份失败: {err}")))?;

        if kind == BackupKind::Automatic {
            enforce_retention(backup_dir)?;
        }

        Ok(dest_path)
    }

    /// 从 `backup_path` 恢复到当前库，随后重新跑一遍迁移。
    ///
    /// **为什么恢复后必须重跑迁移**：备份文件的 `PRAGMA user_version` 定格
    /// 在"建这个备份点那一刻代码期望的版本"。如果用户恢复的是一个更早期的
    /// 备份（例如误操作后想回到几天前，而这几天里应用发布过新版本、新增了
    /// 迁移），恢复完成后库的 schema 就会落后于当前代码期望的版本——不重跑
    /// 迁移，任何依赖新表/新列的查询都会失败。`apply_migrations` 按
    /// `user_version` `skip` 已应用的条目，重跑是幂等操作，即使备份本来就是
    /// 最新版本也不会跑坏。
    pub fn restore_backup(&mut self, backup_path: &Path) -> Result<(), GsError> {
        // rusqlite 的 `Connection::open` 对不存在的路径会直接创建一个空库，
        // 而不是报错——如果不在这里提前拦截，从一个打错的路径"恢复"会把
        // 当前库的全部数据静默替换成空库，这比"恢复失败"更危险。
        if !backup_path.is_file() {
            return Err(GsError::Storage(format!(
                "备份文件不存在: {}",
                backup_path.display()
            )));
        }

        self.conn
            .restore(rusqlite::MAIN_DB, backup_path, None::<fn(Progress)>)
            .map_err(|err| storage_err(format!("从备份恢复失败: {err}")))?;

        migrations::apply_migrations(&mut self.conn)?;
        Ok(())
    }

    /// 便于未来"高风险写入前先兜底"的入口接线：建一个自动备份点，跑
    /// `action`；`action` 失败就自动从该备份点回滚，并把原始错误与回滚结果
    /// 一并报告。
    ///
    /// `action` 拿到的是 `&Repository`，不是 `&mut Storage`——回滚需要的
    /// `&mut self.conn` 在 `action` 返回、其借用的 `Repository` 生命周期结束
    /// 之后才会被使用，两者不会同时存在，借用检查器天然保证不会冲突。
    pub fn with_auto_backup<T, E>(
        &mut self,
        backup_dir: &Path,
        action: impl FnOnce(&crate::Repository<'_>) -> Result<T, E>,
    ) -> Result<T, GsError>
    where
        E: std::fmt::Display,
    {
        let backup_path = self.create_backup(backup_dir, BackupKind::Automatic)?;
        let outcome = action(&self.repository());

        match outcome {
            Ok(value) => Ok(value),
            Err(err) => match self.restore_backup(&backup_path) {
                Ok(()) => Err(GsError::Storage(format!(
                    "操作失败，已回滚到备份点 {}: {err}",
                    backup_path.display()
                ))),
                Err(restore_err) => Err(GsError::Storage(format!(
                    "操作失败（{err}），且回滚到备份点 {} 也失败: {restore_err}",
                    backup_path.display()
                ))),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequence_from_name_parses_well_formed_backup_file_name() {
        let name = backup_file_name(BackupKind::Automatic);
        assert!(sequence_from_name(&name).is_some());
    }

    #[test]
    fn sequence_from_name_rejects_unrelated_file_name() {
        assert_eq!(sequence_from_name("readme.txt"), None);
        assert_eq!(sequence_from_name("auto-not-a-number.sqlite3"), None);
    }

    #[test]
    fn backup_file_names_are_strictly_increasing_within_a_process() {
        let first = backup_file_name(BackupKind::Manual);
        let second = backup_file_name(BackupKind::Manual);
        assert!(sequence_from_name(&first).unwrap() < sequence_from_name(&second).unwrap());
    }
}
