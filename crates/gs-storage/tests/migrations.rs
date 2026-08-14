//! 迁移机制在 `Storage` 入口处的集成验证：空库能跑到最新版本，
//! 重复打开同一个文件数据库不报错（幂等，不会尝试重复建表）。

mod common;

use gs_storage::Storage;
use std::fs;

#[test]
fn opens_a_fresh_file_database_and_reaches_latest_schema_version() {
    let path = common::temp_db_path("migration");
    let _ = fs::remove_file(&path);
    let path_str = path.to_str().expect("临时路径应当是合法 UTF-8");

    let version_after_first_open = {
        let storage = Storage::open(path_str).expect("首次打开应当成功建库");
        storage.schema_version().expect("应当能读取版本")
    };
    assert!(version_after_first_open > 0, "首次打开应当应用至少一条迁移");

    // 重新打开同一个文件：迁移必须是幂等的——不应报错，也不应重复建表
    // （重复执行 CREATE TABLE 本身就会因表已存在而报错，能跑通就证明
    // `skip(current_version)` 生效，没有重新执行已应用过的迁移）。
    let version_after_second_open = {
        let storage = Storage::open(path_str).expect("二次打开不应报错");
        storage.schema_version().expect("应当能读取版本")
    };
    assert_eq!(
        version_after_first_open, version_after_second_open,
        "已是最新版本的库重新打开不应改变版本号"
    );

    let _ = fs::remove_file(&path);
}
