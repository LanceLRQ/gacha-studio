//! `gs-p-uigf`：UIGF v4.x 交换格式适配器。
//!
//! 与采集流程无关，独立于 pipeline 概念（参见插件 SDK 设计文档 1.3 节的
//! workspace 结构说明：它和 `gs-p-authkey` 同级，但不是一条 `CollectConfig`
//! 流程）。具体字段映射需要用 `HoYo.Gacha` 的真实实现校准后再落地，本阶段
//! 先固化版本号的支持范围判定。

/// 本适配器当前只承接的 UIGF 主版本号。
pub const SUPPORTED_MAJOR_VERSION: &str = "v4";

/// 判断给定的 UIGF 版本号字符串是否落在本适配器支持的范围内（当前仅 v4.x）。
pub fn is_supported_version(version: &str) -> bool {
    version.starts_with("v4.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_v4_versions() {
        assert!(is_supported_version("v4.0"));
        assert!(is_supported_version("v4.2"));
    }

    #[test]
    fn rejects_non_v4_versions() {
        assert!(!is_supported_version("v2.0"));
        assert!(!is_supported_version(""));
    }
}
