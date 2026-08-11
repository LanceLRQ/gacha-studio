//! `raw_payload` 入库前的凭据防线：命中 `authkey=` 等特征模式即拒绝写入。
//!
//! 这是最后一道机械防线，即使 L0/L1 已经在采集时剥离过凭据，这里也不
//! 单点信任——凭据永不入库是本项目的红线约束。

mod common;

use common::create_test_account;
use gs_storage::{NewCollectSession, NewRawPayload, Storage};

fn create_test_session(storage: &Storage) -> i64 {
    // raw_payload → collect_session → account 这条溯源链上每一环都有外键，
    // 所以要从账号建起：insert_raw_payload 报的错必须是「命中凭据模式」，
    // 而不是「外键失败」——否则这个测试看起来在验证凭据防线，实际什么都没验。
    let account_id = create_test_account(&storage.repository(), "genshin");
    storage
        .repository()
        .create_collect_session(&NewCollectSession {
            account_id,
            started_at: 1_754_800_000_000,
            ended_at: None,
            method: "official_api".to_string(),
            status: "ok".to_string(),
            records_new: 0,
            diagnostics: None,
        })
        .expect("创建采集会话应当成功")
}

#[test]
fn rejects_payload_containing_authkey_query_parameter() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let session_id = create_test_session(&storage);

    let result = storage.repository().insert_raw_payload(&NewRawPayload {
        session_id,
        seq: 1,
        payload: b"https://example.com/gacha?authkey=abcdef123&other=1".to_vec(),
        encoding: Some("utf-8".to_string()),
        created_at: 1_754_800_001_000,
    });

    assert!(
        result.is_err(),
        "含 authkey= 的报文必须被拒绝写入，不能静默脱敏后放行"
    );
}

#[test]
fn rejects_payload_containing_authorization_header() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let session_id = create_test_session(&storage);

    let result = storage.repository().insert_raw_payload(&NewRawPayload {
        session_id,
        seq: 1,
        payload: b"Authorization: Bearer secret-token".to_vec(),
        encoding: Some("utf-8".to_string()),
        created_at: 1_754_800_001_000,
    });

    assert!(result.is_err(), "含 Authorization 头的报文必须被拒绝写入");
}

#[test]
fn accepts_payload_without_credential_patterns() {
    let storage = Storage::open_in_memory().expect("应当成功打开内存数据库");
    let session_id = create_test_session(&storage);

    let result = storage.repository().insert_raw_payload(&NewRawPayload {
        session_id,
        seq: 1,
        payload: br#"{"gacha_type":"301","id":"123"}"#.to_vec(),
        encoding: Some("utf-8".to_string()),
        created_at: 1_754_800_001_000,
    });

    assert!(result.is_ok(), "不含凭据特征的报文应当正常写入");
}
