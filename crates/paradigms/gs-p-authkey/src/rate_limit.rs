//! L0 原子能力：分页拉取的限速与重试策略。
//!
//! 默认值与三方实测一致——`research/04-同族工具三方源码对比.md` §4.8：
//! 三个参考实现（genshin-wish-export/star-rail-warp-export/
//! zzz-signal-search-export）均**无指数退避**，一律固定间隔重试。这不是
//! 偷懒，是三方在真实环境里跑出来的经验值，本范式沿用同一套默认。

use std::time::Duration;

/// 默认每页请求之间的等待时间（毫秒）。
pub const DEFAULT_PER_PAGE_DELAY_MS: u64 = 300;
/// 默认最大重试次数。
pub const DEFAULT_RETRY_MAX_ATTEMPTS: u32 = 5;
/// 默认重试等待时间（毫秒）。
pub const DEFAULT_RETRY_DELAY_MS: u64 = 5000;

/// 退避策略。`Exponential` 保留判别分支给未来样本，本范式当前只用
/// `Fixed`——三方实测均无指数退避，穷尽性由类型系统保证但默认值不假设它。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackoffKind {
    Fixed,
    Exponential,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub delay: Duration,
    pub backoff: BackoffKind,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: DEFAULT_RETRY_MAX_ATTEMPTS,
            delay: Duration::from_millis(DEFAULT_RETRY_DELAY_MS),
            backoff: BackoffKind::Fixed,
        }
    }
}

impl RetryPolicy {
    /// 第 `attempt`（从 1 开始计数，即"第几次重试"）次重试前应等待的时长。
    pub fn delay_for_attempt(&self, attempt: u32) -> Duration {
        match self.backoff {
            BackoffKind::Fixed => self.delay,
            // 预留分支：当前无样本要求指数退避，实现上仍给出合理行为
            // （2^(attempt-1) 倍数，attempt 从 1 开始），而不是留空 todo!()——
            // 类型可达但语义未经证实的分支，至少不能是"编译能过但一跑就 panic"。
            BackoffKind::Exponential => {
                let multiplier = 1u32.checked_shl(attempt.saturating_sub(1)).unwrap_or(u32::MAX);
                self.delay.saturating_mul(multiplier)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimitPolicy {
    pub per_page_delay: Duration,
    pub retry: RetryPolicy,
}

impl Default for RateLimitPolicy {
    fn default() -> Self {
        Self {
            per_page_delay: Duration::from_millis(DEFAULT_PER_PAGE_DELAY_MS),
            retry: RetryPolicy::default(),
        }
    }
}

impl RateLimitPolicy {
    /// 测试专用：把所有等待时间清零，避免集成测试真的睡上几百毫秒。
    /// 不是生产默认值，因此不叫 `default()`，调用点必须显式选择。
    pub fn zero_delay_for_tests() -> Self {
        Self {
            per_page_delay: Duration::ZERO,
            retry: RetryPolicy {
                max_attempts: DEFAULT_RETRY_MAX_ATTEMPTS,
                delay: Duration::ZERO,
                backoff: BackoffKind::Fixed,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_three_party_observed_values() {
        let policy = RateLimitPolicy::default();
        assert_eq!(policy.per_page_delay, Duration::from_millis(300));
        assert_eq!(policy.retry.max_attempts, 5);
        assert_eq!(policy.retry.delay, Duration::from_millis(5000));
        assert_eq!(policy.retry.backoff, BackoffKind::Fixed);
    }

    #[test]
    fn fixed_backoff_delay_is_constant_across_attempts() {
        let retry = RetryPolicy::default();
        assert_eq!(retry.delay_for_attempt(1), retry.delay);
        assert_eq!(retry.delay_for_attempt(5), retry.delay);
    }

    #[test]
    fn exponential_backoff_doubles_each_attempt() {
        let retry = RetryPolicy {
            max_attempts: 5,
            delay: Duration::from_millis(100),
            backoff: BackoffKind::Exponential,
        };
        assert_eq!(retry.delay_for_attempt(1), Duration::from_millis(100));
        assert_eq!(retry.delay_for_attempt(2), Duration::from_millis(200));
        assert_eq!(retry.delay_for_attempt(3), Duration::from_millis(400));
    }

    #[test]
    fn zero_delay_for_tests_has_no_wait() {
        let policy = RateLimitPolicy::zero_delay_for_tests();
        assert_eq!(policy.per_page_delay, Duration::ZERO);
        assert_eq!(policy.retry.delay, Duration::ZERO);
    }
}
