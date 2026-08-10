//! `gs-p-authkey`：L1 范式层，authkey 采集流程
//! （data_2 缓存扫描 + 分页拉取，对应插件 manifest 里
//! `collect.paradigm == "authkey"` 的 `AuthkeyPipelineParams`）。
//!
//! 完整流程（凭据扫描、HTTP 分页、限速重试、错误码语义映射）需要结合
//! 参考项目的真实响应校准字段与时序，本阶段先固化设计文档已定案、无需
//! 校准的默认参数与判定逻辑，供后续实现直接复用，避免返工。

use gs_core::GsError;

/// 默认每页条数（插件 manifest 未声明 `pageSize` 时使用）。
pub const DEFAULT_PAGE_SIZE: u32 = 20;

/// 默认每页请求之间的等待时间（毫秒）。
pub const DEFAULT_PER_PAGE_DELAY_MS: u64 = 300;

/// 默认最大重试次数。
pub const DEFAULT_RETRY_MAX_ATTEMPTS: u32 = 5;

/// 默认重试等待时间（毫秒）。
pub const DEFAULT_RETRY_DELAY_MS: u64 = 5000;

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
