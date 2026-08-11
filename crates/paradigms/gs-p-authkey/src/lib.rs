//! `gs-p-authkey`：L1 范式层，authkey 采集流程
//! （data_2 缓存扫描 + 分页拉取，对应插件 manifest 里
//! `collect.paradigm == "authkey"` 的 `AuthkeyPipelineParams`）。
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
pub mod pipeline;
pub mod rate_limit;

pub use cache_scan::{InstalledGameLocator, StaticGameLocator, scan_game_cache};
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
