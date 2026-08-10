//! 跨层共享的错误类型。

use thiserror::Error;

/// 贯穿存储、分析、宿主运行时的统一错误类型。
///
/// 各 crate 在需要更细粒度的错误分类时，应在自己的模块内定义专属错误类型，
/// 并归并到这里，而不是让调用方直接感知内部实现细节。
#[derive(Debug, Error)]
pub enum GsError {
    /// 存储层操作失败，`String` 携带底层错误的可读描述。
    #[error("存储错误: {0}")]
    Storage(String),

    /// 输入不满足领域约束（如空的 record_key）。
    #[error("参数校验失败: {0}")]
    Validation(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_error_carries_message_in_display() {
        let err = GsError::Validation("record_key 不能为空".to_string());
        assert_eq!(err.to_string(), "参数校验失败: record_key 不能为空");
    }

    #[test]
    fn storage_error_carries_message_in_display() {
        let err = GsError::Storage("连接已关闭".to_string());
        assert_eq!(err.to_string(), "存储错误: 连接已关闭");
    }
}
