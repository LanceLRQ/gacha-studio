//! 跨层共享的错误类型。

use crate::record::LocalizedText;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

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

/// 采集流程失败时的**结构化**错误，面向界面渲染引导。
///
/// 不是 [`GsError`] 的替代品，服务的读者不同：`GsError` 是跨层的通用错误，
/// `AcquireError` 专门描述「采集这一步为什么失败、界面该引导用户做什么」。
/// 现有同类工具在这一环节的用户体验最差——统统报「获取失败」，用户不知道
/// 该重启游戏、该打开记录页、还是该装依赖，因此这里必须是结构化联合类型，
/// 不能是字符串。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum AcquireError {
    /// 没能在任何已知路径找到游戏客户端。
    GameNotInstalled { searched: Vec<String> },
    /// 找到了客户端，但游戏当前没有在运行——采集凭据往往要求游戏在跑。
    GameNotRunning {},
    /// 找到了凭据缓存文件，但内容不可用，`reason` 说明具体是哪种不可用。
    CacheFound {
        path: String,
        reason: NoCredentialReason,
    },
    /// 凭据存在但已过期。`expired_at` 若能解析出具体时间就填，解析不出就是 `None`。
    #[serde(rename_all = "camelCase")]
    #[ts(rename_all = "camelCase")]
    CredentialExpired {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        expired_at: Option<String>,
    },
    /// 缺少采集所需的外部依赖（如 WebView2 运行时）。
    MissingDependency { dependency: Dependency },
    /// 需要提权（管理员/root）才能继续，常见于抓包范式。
    ElevationRequired {},
    /// 请求发出去了，但上游返回了非成功状态码。
    #[serde(rename_all = "camelCase")]
    #[ts(rename_all = "camelCase")]
    Upstream { status: u16, body_excerpt: String },
    /// 请求没能发出去或者没能拿到响应，`detail` 区分具体的网络层原因。
    Network { detail: NetworkError },
}

/// 一个外部依赖的界面展示信息。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    /// 稳定标识，供宿主判断「这个依赖装好了没」。
    pub id: String,
    pub display_name: LocalizedText,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub install_hint: Option<LocalizedText>,
}

/// 网络层失败的具体原因。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum NetworkError {
    Timeout {},
    Dns {},
    ConnectionRefused {},
    Other { detail: String },
}

/// 凭据缓存文件存在但不可用的具体原因。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(tag = "kind", rename_all = "camelCase")]
pub enum NoCredentialReason {
    NotFound {},
    Expired {},
    Malformed { detail: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

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

    #[test]
    fn acquire_error_game_not_installed_round_trips_with_kind_tag() {
        let err = AcquireError::GameNotInstalled {
            searched: vec!["C:/Program Files/Genshin Impact".to_string()],
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "gameNotInstalled",
                "searched": ["C:/Program Files/Genshin Impact"]
            })
        );
        let round_tripped: AcquireError = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, err);
    }

    #[test]
    fn acquire_error_credential_expired_omits_absent_expired_at() {
        let err = AcquireError::CredentialExpired { expired_at: None };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "credentialExpired" }));
        let round_tripped: AcquireError = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, err);
    }

    #[test]
    fn acquire_error_upstream_round_trips_with_camel_case_body_excerpt() {
        let err = AcquireError::Upstream {
            status: 429,
            body_excerpt: "rate limited".to_string(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "upstream", "status": 429, "bodyExcerpt": "rate limited" })
        );
        let round_tripped: AcquireError = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, err);
    }

    #[test]
    fn acquire_error_missing_dependency_round_trips_with_nested_dependency() {
        let err = AcquireError::MissingDependency {
            dependency: Dependency {
                id: "webview2".to_string(),
                display_name: LocalizedText(BTreeMap::from([(
                    "zh-CN".to_string(),
                    "WebView2 运行时".to_string(),
                )])),
                install_hint: None,
            },
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], serde_json::json!("missingDependency"));
        assert!(json["dependency"].get("installHint").is_none());

        let round_tripped: AcquireError = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, err);
    }

    #[test]
    fn network_error_other_round_trips_with_detail() {
        let err = NetworkError::Other {
            detail: "unexpected EOF".to_string(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "other", "detail": "unexpected EOF" })
        );
        let round_tripped: NetworkError = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, err);
    }

    #[test]
    fn no_credential_reason_malformed_round_trips_with_detail() {
        let reason = NoCredentialReason::Malformed {
            detail: "无法解析的二进制格式".to_string(),
        };
        let json = serde_json::to_value(&reason).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "malformed", "detail": "无法解析的二进制格式" })
        );
        let round_tripped: NoCredentialReason = serde_json::from_value(json).unwrap();
        assert_eq!(round_tripped, reason);
    }
}
