//! `raw_payload` 入库前的凭据防线。
//!
//! 这是最后一道机械防线：即使 L0/L1 已经在采集时剥离过凭据，这里也不单点
//! 信任——凭据永不入库是本项目的红线约束（存储数据模型设计文档 §七.5、
//! `milestones/00-实施总览.md` §8.3 的贯穿性正确性断言）。命中即拒绝写入，
//! 不做"脱敏后放行"，因为脱敏规则本身也可能有遗漏，拒绝写入才能让调用方
//! 在开发期就发现"L0/L1 剥离得不干净"，而不是让残留凭据悄悄落盘。

/// 命中即拒绝写入的特征模式，全部小写——匹配前统一把报文小写化比较，
/// 因为现实中凭据字段名的大小写写法千差万别（`AuthKey=`、`ACCESSTOKEN`
/// 均是参考项目里出现过的真实写法），只按这几种模式的原始大小写匹配会漏掉变体。
const FORBIDDEN_PATTERNS: &[&str] = &["authkey=", "accesstoken", "authorization"];

/// 检查报文是否命中禁止入库的凭据特征模式，命中则返回匹配到的模式（供错误信息定位）。
///
/// 用 [`String::from_utf8_lossy`] 而非要求严格 UTF-8：`payload` 是 BLOB，
/// 可能是某种二进制协议报文（如抓包范式的原始包体），但凭据特征串
/// （URL 查询参数、HTTP 请求头）通常是 ASCII 文本，lossy 转换不影响这部分
/// 子串的可匹配性，同时不会因为报文含非 UTF-8 字节就直接放弃检查。
pub(crate) fn find_forbidden_pattern(payload: &[u8]) -> Option<&'static str> {
    let haystack = String::from_utf8_lossy(payload).to_lowercase();
    FORBIDDEN_PATTERNS
        .iter()
        .find(|pattern| haystack.contains(**pattern))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_authkey_query_parameter() {
        let payload = b"https://example.com/gacha?authkey=abcdef123&other=1";
        assert_eq!(find_forbidden_pattern(payload), Some("authkey="));
    }

    #[test]
    fn detects_access_token_case_insensitively() {
        let payload = br#"{"AccessToken":"secret-value"}"#;
        assert_eq!(find_forbidden_pattern(payload), Some("accesstoken"));
    }

    #[test]
    fn detects_authorization_header() {
        let payload = b"Authorization: Bearer secret-token";
        assert_eq!(find_forbidden_pattern(payload), Some("authorization"));
    }

    #[test]
    fn allows_clean_payload() {
        let payload = br#"{"gacha_type":"301","id":"snowflake_123"}"#;
        assert_eq!(find_forbidden_pattern(payload), None);
    }

    #[test]
    fn allows_non_utf8_payload_without_credential_pattern() {
        // 抓包范式的原始报文可能不是合法 UTF-8；lossy 转换不应导致误报或 panic。
        let payload: &[u8] = &[0xFF, 0xFE, 0x00, 0x01, 0x02];
        assert_eq!(find_forbidden_pattern(payload), None);
    }
}
