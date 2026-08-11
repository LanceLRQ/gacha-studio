//! `gs-core`：领域模型与错误类型的基础层。
//!
//! 本 crate 不属于插件实现语言与能力分层讨论中定义的 L0/L1/L2 分层本身，
//! 而是被 L1 范式层（`crates/paradigms/*`）与宿主运行时（`gs-host`）共同
//! 依赖的词汇表：统一错误类型、去重契约里的记录标识、采集记录/保底/采集流程
//! 配置等跨层稳定的领域模型。
//!
//! 本 crate 的类型不写 `#[ts(export)]`——TS 绑定由 `gs-host` 的 `gs-codegen`
//! 二进制显式列出全部导出类型并生成（见该文件顶部说明），导出清单需要能被
//! review 一眼看全，散落在各模块的 `#[ts(export)]` 做不到这点。

mod collect;
mod error;
mod pity;
mod record;
mod record_key;

pub use collect::{
    BackoffKind, ErrorSemantic, GameClientSize, HostEnv, PreconditionLevel, PreconditionStatus,
    RateLimitConfig, RawTimeConvention, RetryConfig, StopCondition, TimeConfig, TimezoneSource,
};
pub use error::{AcquireError, Dependency, GsError, NetworkError, NoCredentialReason};
pub use pity::{GuaranteeRule, PityGroup, ProbabilityCurve};
pub use record::{
    BannerBaseline, BannerSpec, DrawCountingConfig, GachaRecord, HttpMethod, LocalizedText,
    MetaState, MetadataEntry, Platform, RareEventRef, RaritySpec, RecordSource, RequestTemplate,
    RetentionPolicy, TzOrigin, UnifiedRecordFields,
};
pub use record_key::RecordKey;
