//! `gs-core`：领域模型与错误类型的基础层。
//!
//! 本 crate 不属于插件实现语言与能力分层讨论中定义的 L0/L1/L2 分层本身，
//! 而是被 L1 范式层（`crates/paradigms/*`）与宿主运行时（`gs-host`）共同
//! 依赖的词汇表：统一错误类型、去重契约里的记录标识等跨层稳定概念。
//!
//! 具体的领域模型（`PityGroup` / `ProbabilityCurve` / `UnifiedRecordFields`
//! 等，参见插件 SDK 设计文档第三节）需要先用参考项目的真实实现校准字段
//! 语义，本阶段只落地已经定案、无需校准的基础类型。

mod error;
mod record_key;

pub use error::GsError;
pub use record_key::RecordKey;
