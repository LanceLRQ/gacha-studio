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

    /// 暴露底层存储，供后续 IPC 命令实现直接使用。
    pub fn storage(&self) -> &Storage {
        &self.storage
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
}
