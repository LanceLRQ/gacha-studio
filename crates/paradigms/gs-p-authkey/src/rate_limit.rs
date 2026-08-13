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
/// 默认"每翻 N 页额外停顿一次"的页数间隔。
pub const DEFAULT_BATCH_PAUSE_EVERY_N_PAGES: u32 = 10;
/// 默认额外停顿时长（毫秒）。
pub const DEFAULT_BATCH_PAUSE_DELAY_MS: u64 = 1000;

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
                let multiplier = 1u32
                    .checked_shl(attempt.saturating_sub(1))
                    .unwrap_or(u32::MAX);
                self.delay.saturating_mul(multiplier)
            }
        }
    }
}

/// "每翻 N 页额外停顿一次"的批处理限速，独立于逐页固定延迟
/// （`RateLimitPolicy::per_page_delay`）。
///
/// 证据来自三方源码实测（`research/04-同族工具三方源码对比.md` §4.8，
/// 已用 `docs/example-projects/*/src/main/getData.js` 源码逐行核实）：
/// genshin-wish-export（`getData.js:224-227`）与
/// zzz-signal-search-export（`getData.js:231-234`）都在 `page % 10 === 0`
/// 时于本次请求发出**之前**额外 `sleep(1)`；只有
/// star-rail-warp-export（`getData.js:219-222`）把这三行整体注释掉，且
/// 代码里**没有留下任何移除原因**。三份实现同源分叉（研究文档 §一），这段
/// 逻辑在分叉起点就已存在，star-rail 的静默移除既可能是刻意简化也可能是
/// 遗漏——没有证据支持"更正确"这个假设，因此默认沿用有实证参数支撑的
/// 多数行为（2/3），而不是假设少数派的省略才是对的。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchPausePolicy {
    /// 每翻多少页触发一次额外停顿，构造期已保证非零——见 `pipeline.rs` 的
    /// `validate_declared_batch_size`。取值为 0 会让采集循环里的
    /// `page % every_n_pages` 除零 panic，因此这个不变量从声明解析阶段就
    /// 开始强制，运行时不再重复判断。
    pub every_n_pages: u32,
    pub delay: Duration,
}

impl Default for BatchPausePolicy {
    fn default() -> Self {
        Self {
            every_n_pages: DEFAULT_BATCH_PAUSE_EVERY_N_PAGES,
            delay: Duration::from_millis(DEFAULT_BATCH_PAUSE_DELAY_MS),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateLimitPolicy {
    pub per_page_delay: Duration,
    pub retry: RetryPolicy,
    pub batch_pause: BatchPausePolicy,
}

impl Default for RateLimitPolicy {
    fn default() -> Self {
        Self {
            per_page_delay: Duration::from_millis(DEFAULT_PER_PAGE_DELAY_MS),
            retry: RetryPolicy::default(),
            batch_pause: BatchPausePolicy::default(),
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
            batch_pause: BatchPausePolicy {
                every_n_pages: DEFAULT_BATCH_PAUSE_EVERY_N_PAGES,
                delay: Duration::ZERO,
            },
        }
    }

    /// 按"逐字段取更温和者"合并注入策略（`self`，宿主本次会话的策略）与
    /// 插件声明（`declared`，manifest `collect.params.rateLimit`）。
    ///
    /// 口径（主进程裁定）：manifest 声明的是"这个游戏的 API 能受多少"
    /// （游戏知识，插件作者比宿主清楚），注入值是宿主本次会话的策略
    /// （用户设置/全局默认）。两边都在表达"别比我更激进"——任何一方都不该
    /// 能把另一方放松，放松的代价是用户账号被限流，抽卡凭据等价于临时
    /// 账号凭证，这是安全轴不是偏好轴。逐字段规则：
    ///
    /// - `per_page_delay` / `retry.delay` / `batch_pause.delay`：取 **max**
    ///   ——等得久 = 对服务端更温和。
    /// - `retry.max_attempts`：取 **min** ——重试少 = 打到服务端的请求少。
    /// - `retry.backoff`：任一方是 `Exponential` 就取 `Exponential`
    ///   ——指数退避比固定间隔对服务端更温和。
    /// - `batch_pause.every_n_pages`：取 **min** ——间隔越短、停顿越频繁，
    ///   越温和。
    ///
    /// `declared` 的每个字段独立是 `Option`：未声明就沿用注入值，不参与
    /// 取值比较——`None` 不等于"声明了最激进的值"，比如 `retry.delay_ms`
    /// 缺省不等于声明了 0ms。`declared` 整体为 `None`（manifest 完全没有
    /// `rateLimit` 键）等价于所有子字段都未声明，直接原样返回注入值。
    pub fn merged_with_declared(&self, declared: Option<&gs_core::RateLimitConfig>) -> Self {
        let Some(declared) = declared else {
            return *self;
        };

        let per_page_delay = match declared.per_page_delay_ms {
            Some(ms) => self.per_page_delay.max(Duration::from_millis(ms)),
            None => self.per_page_delay,
        };

        let retry = match &declared.retry {
            Some(declared_retry) => RetryPolicy {
                max_attempts: match declared_retry.max_attempts {
                    Some(declared_max) => self.retry.max_attempts.min(declared_max),
                    None => self.retry.max_attempts,
                },
                delay: match declared_retry.delay_ms {
                    Some(ms) => self.retry.delay.max(Duration::from_millis(ms)),
                    None => self.retry.delay,
                },
                // 任一方是 Exponential 就取 Exponential：declared 显式声明
                // Fixed 不能把已经是 Exponential 的注入值拉回 Fixed（那是
                // "放松"，不是"未声明沿用"）。
                backoff: if self.retry.backoff == BackoffKind::Exponential
                    || declared_retry.backoff == Some(gs_core::BackoffKind::Exponential)
                {
                    BackoffKind::Exponential
                } else {
                    self.retry.backoff
                },
            },
            None => self.retry,
        };

        let batch_pause = BatchPausePolicy {
            every_n_pages: match declared.batch_size {
                Some(declared_n) => self.batch_pause.every_n_pages.min(declared_n),
                None => self.batch_pause.every_n_pages,
            },
            delay: match declared.batch_delay_ms {
                Some(ms) => self.batch_pause.delay.max(Duration::from_millis(ms)),
                None => self.batch_pause.delay,
            },
        };

        Self {
            per_page_delay,
            retry,
            batch_pause,
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

    // ============================================================
    // merged_with_declared：逐字段取更温和者
    // ============================================================
    //
    // 固定用 `RateLimitPolicy::default()`（300ms / 5 次 / 5000ms / 每 10 页
    // 停 1000ms）当注入基线——它既不是 0 也不是极大值，"声明更长/更短"两个
    // 方向才都有意义（若用 `zero_delay_for_tests()` 当基线，delay 类字段已经
    // 是下界，"声明更短"这个方向永远不可能被观测到）。

    /// 一个所有字段都未声明的 `RateLimitConfig`——用来表达"manifest 里有
    /// `rateLimit` 键，但内容是空对象"，与整个 `Option` 是 `None`（manifest
    /// 里压根没有这个键）是两种不同的构造路径，都应该等价于"沿用注入值"。
    fn empty_declared() -> gs_core::RateLimitConfig {
        gs_core::RateLimitConfig {
            per_page_delay_ms: None,
            batch_size: None,
            batch_delay_ms: None,
            retry: None,
        }
    }

    #[test]
    fn undeclared_rate_limit_keeps_injected_policy_unchanged() {
        // 场景 1：插件完全没有 collect.params.rateLimit 键——整个 Option
        // 是 None。历史行为不变，genshin 场景零影响。
        let injected = RateLimitPolicy::default();
        let merged = injected.merged_with_declared(None);
        assert_eq!(merged, injected);
    }

    #[test]
    fn declared_with_all_fields_absent_keeps_injected_policy_unchanged() {
        // 与上一条的区别：manifest 里确实有 `rateLimit: {}` 这个键，但内容
        // 全部缺省。不能把"键存在但字段为空"误判成"声明了 0"。
        let injected = RateLimitPolicy::default();
        let merged = injected.merged_with_declared(Some(&empty_declared()));
        assert_eq!(merged, injected);
    }

    #[test]
    fn declared_longer_per_page_delay_wins() {
        // 场景 2：插件声明的延迟比注入值更长——插件更了解这个游戏的 API
        // 有多敏感，应当采纳。
        let injected = RateLimitPolicy::default(); // 300ms
        let declared = gs_core::RateLimitConfig {
            per_page_delay_ms: Some(5000),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.per_page_delay, Duration::from_millis(5000));
    }

    #[test]
    fn declared_shorter_per_page_delay_keeps_injected() {
        // 场景 3（本任务的核心）：插件声明的延迟比注入值更短——插件不能把
        // 宿主本次会话的策略放松，放松的代价是用户账号被限流。
        let injected = RateLimitPolicy::default(); // 300ms
        let declared = gs_core::RateLimitConfig {
            per_page_delay_ms: Some(50),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.per_page_delay, Duration::from_millis(300));
    }

    #[test]
    fn declared_smaller_max_attempts_wins() {
        // 场景 4：重试次数取 min——插件声明更少的重试次数，代表这个游戏的
        // API 更容易被打死，应当采纳更保守（更少请求）的一方。
        let injected = RateLimitPolicy::default(); // max_attempts = 5
        let declared = gs_core::RateLimitConfig {
            retry: Some(gs_core::RetryConfig {
                max_attempts: Some(2),
                backoff: None,
                delay_ms: None,
            }),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.retry.max_attempts, 2);
    }

    #[test]
    fn declared_larger_max_attempts_keeps_injected() {
        // 场景 5：插件声明的重试次数比注入值更多——不能采纳，重试次数取
        // min，"更多重试"等价于"对服务端更激进"。
        let injected = RateLimitPolicy::default(); // max_attempts = 5
        let declared = gs_core::RateLimitConfig {
            retry: Some(gs_core::RetryConfig {
                max_attempts: Some(10),
                backoff: None,
                delay_ms: None,
            }),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.retry.max_attempts, 5);
    }

    #[test]
    fn declared_exponential_backoff_overrides_injected_fixed() {
        // 场景 6a：注入 Fixed，声明 Exponential——取 Exponential。
        let injected = RateLimitPolicy::default(); // backoff = Fixed
        let declared = gs_core::RateLimitConfig {
            retry: Some(gs_core::RetryConfig {
                max_attempts: None,
                backoff: Some(gs_core::BackoffKind::Exponential),
                delay_ms: None,
            }),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.retry.backoff, BackoffKind::Exponential);
    }

    #[test]
    fn declared_fixed_backoff_cannot_relax_injected_exponential() {
        // 场景 6b（反向）：注入已经是 Exponential，插件声明 Fixed——不能把
        // 宿主放松回 Fixed，仍然取 Exponential。
        let injected = RateLimitPolicy {
            retry: RetryPolicy {
                backoff: BackoffKind::Exponential,
                ..RetryPolicy::default()
            },
            ..RateLimitPolicy::default()
        };
        let declared = gs_core::RateLimitConfig {
            retry: Some(gs_core::RetryConfig {
                max_attempts: None,
                backoff: Some(gs_core::BackoffKind::Fixed),
                delay_ms: None,
            }),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.retry.backoff, BackoffKind::Exponential);
    }

    #[test]
    fn partially_declared_fields_fall_back_to_injected_not_zero() {
        // 场景 7：只声明 per_page_delay_ms，retry 整个子对象缺省——缺省的
        // 字段必须原样沿用注入值，不能被当成"声明了 0"（0 会被 max() 判定
        // 为"更短"从而被注入值挡住，表面上看起来"恰好正确"，但那是巧合，
        // 不是真的沿用；用 retry.max_attempts 更能戳穿这个巧合——如果缺省
        // 被误当成 0，min(5, 0) = 0，重试次数会被腰斩到 0，采集会直接失败）。
        let injected = RateLimitPolicy::default(); // max_attempts = 5, delay = 5000ms
        let declared = gs_core::RateLimitConfig {
            per_page_delay_ms: Some(9000),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.per_page_delay, Duration::from_millis(9000));
        assert_eq!(merged.retry.max_attempts, 5);
        assert_eq!(merged.retry.delay, Duration::from_millis(5000));
        assert_eq!(merged.retry.backoff, BackoffKind::Fixed);
    }

    #[test]
    fn declared_shorter_batch_interval_wins() {
        // batch_pause.every_n_pages 取 min——间隔越短，停顿越频繁，越温和。
        let injected = RateLimitPolicy::default(); // every_n_pages = 10
        let declared = gs_core::RateLimitConfig {
            batch_size: Some(3),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.batch_pause.every_n_pages, 3);
    }

    #[test]
    fn declared_longer_batch_interval_keeps_injected() {
        let injected = RateLimitPolicy::default(); // every_n_pages = 10
        let declared = gs_core::RateLimitConfig {
            batch_size: Some(50),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.batch_pause.every_n_pages, 10);
    }

    #[test]
    fn declared_longer_batch_delay_wins() {
        // batch_pause.delay 取 max——同 per_page_delay/retry.delay 的理由。
        let injected = RateLimitPolicy::default(); // delay = 1000ms
        let declared = gs_core::RateLimitConfig {
            batch_delay_ms: Some(3000),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.batch_pause.delay, Duration::from_millis(3000));
    }

    #[test]
    fn declared_shorter_batch_delay_keeps_injected() {
        let injected = RateLimitPolicy::default(); // delay = 1000ms
        let declared = gs_core::RateLimitConfig {
            batch_delay_ms: Some(200),
            ..empty_declared()
        };
        let merged = injected.merged_with_declared(Some(&declared));
        assert_eq!(merged.batch_pause.delay, Duration::from_millis(1000));
    }
}
