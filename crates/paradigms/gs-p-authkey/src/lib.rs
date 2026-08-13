//! `gs-p-authkey`：L1 范式层，"先取凭据、再调 API"的采集流程
//! （data_2 缓存扫描 + 分页拉取，对应插件 manifest 里
//! `collect.paradigm == "credentialedApi"` 的 `CredentialedApiPipelineParams`）。
//!
//! ⚠️ **crate 名 / 结构体名 `AuthkeyApiPipeline` 是历史遗留，不代表当前语义**。
//! M2 裁定（`docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮纸面填表演练.md`
//! §7.2）把契约层的 `paradigm` 标签从 `"authkey"` 改名为 `"credentialedApi"`
//! ——鸣潮走同一条 L1 流程但**没有 authkey**，判别标签叫 `authkey` 却用于
//! 一个没有 authkey 的游戏，直接违反防线六「类型即文档」。crate 名与结构体名
//! 本应一并改，但改名会牵动一批与本 crate 语义无关的文件（workspace 根
//! `Cargo.toml`、`gs-plugin-runtime`/`gs-manifest-data`/`gs-analysis`/
//! `gs-p-uigf` 里纯粹提及 crate 名的说明性注释、`scripts/gs-bundle-plugins.mjs`
//! 与 `scripts/gs-check/checks/ipc-surface.mjs` 的路径引用），这些改动对
//! "鸣潮 M2-S2 契约回改"这个任务没有增量价值，只有改名本身的噪音，因此保留
//! crate 名与结构体名不变。**判断这个范式到底是什么，以 `CollectConfig`
//! 判别联合里的 `"credentialedApi"` 字符串为准，不要以 crate 名为准。**
//!
//! 模块划分：
//! - [`cache_scan`]——L0 原子：`data_2` 缓存扫描三步语义
//! - [`pipeline`]——L1 流程：[`pipeline::AuthkeyApiPipeline`]
//! - [`rate_limit`]——L0 原子：限速与重试策略
//!
//! 插件 TS 函数的执行位置见独立 crate `gs-plugin-runtime`——本 crate
//! 通过它调用插件声明的纯函数，采集编排全程在这里（Rust），不在 TS 侧。
//! `gs-plugin-runtime` 不放在 `gs-host` 里、也不放在本 crate 内部，是为了
//! 避免 `gs-host`（未来的采集编排者）与 `gs-p-authkey`（编排的被调用方）
//! 互相依赖成环，详见该 crate `src/lib.rs` 顶部说明。

use gs_core::GsError;

pub mod cache_scan;
pub mod log_scan;
pub mod pipeline;
pub mod rate_limit;

pub use cache_scan::{InstalledGameLocator, StaticGameLocator, scan_game_cache};
pub use log_scan::{LogDecodeSpec, scan_log_file};
pub use pipeline::{
    AuthkeyApiPipeline, CollectOutcome, GameApiTransport, PipelineError, ReqwestTransport,
    StopReason,
};
pub use rate_limit::RateLimitPolicy;

/// 默认每页条数（插件 manifest 未声明 `pageSize` 时使用）。
pub const DEFAULT_PAGE_SIZE: u32 = 20;

/// 校验分页大小：`0` 不构成合法的分页请求。
pub fn validate_page_size(page_size: u32) -> Result<u32, GsError> {
    if page_size == 0 {
        return Err(GsError::Validation("page_size 不能为 0".to_string()));
    }
    Ok(page_size)
}

/// 默认终止条件（`StopCondition::EmptyPage`）：本页记录数为零即停止翻页。
pub fn is_empty_page(record_count: usize) -> bool {
    record_count == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_page_size() {
        assert!(validate_page_size(0).is_err());
    }

    #[test]
    fn accepts_default_page_size() {
        assert_eq!(
            validate_page_size(DEFAULT_PAGE_SIZE).expect("默认页大小应当合法"),
            DEFAULT_PAGE_SIZE
        );
    }

    #[test]
    fn empty_page_stops_pagination() {
        assert!(is_empty_page(0));
        assert!(!is_empty_page(3));
    }
}
