//! 应用设置的宿主侧编排。
//!
//! [`gs_storage::Repository::get_setting`]/[`gs_storage::Repository::set_setting`]
//! 操作的是不透明字符串（存储层不理解任何具体设置项的取值语义，见
//! `gs_storage::repository` 里 `SettingKey`/`app_setting` 表上的注释）。本模块
//! 把这条通用 kv 读写收窄成"每个设置项各自一个强类型读写函数"——字符串与
//! 领域值之间的转换只在这里做一次，调用方（IPC 命令）不需要、也不应该自己
//! 再解析一遍字符串。
//!
//! 当前唯一消费者是主题偏好（`web/src/pages/Settings.tsx`"通用"tab）。

use gs_core::GsError;
use gs_storage::{Repository, SettingKey};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 界面主题偏好，三态与 `web/src/lib/theme-provider.tsx` 的 `ThemePreference`
/// 一一对应。序列化成小写字符串（`"light"`/`"dark"`/`"system"`）——跨 IPC
/// 边界与前端 `localStorage` 里已经在用的取值保持字面一致，前端不需要为了
/// 对接这条新命令再做一层字符串映射。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum ThemePreference {
    Light,
    Dark,
    System,
}

impl ThemePreference {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
            Self::System => "system",
        }
    }

    fn from_sql(value: &str) -> Option<Self> {
        match value {
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            "system" => Some(Self::System),
            _ => None,
        }
    }
}

/// 读取已持久化的主题偏好。`None` 表示"从未设置过"——调用方（IPC 命令 /
/// 前端）据此决定是否要回退到本地缓存值，或者用当前生效值反向回填一次。
///
/// 存储里出现无法识别的字符串时同样返回 `None` 而不是报错——正常情况下
/// 只有 [`set_theme_preference`] 会写这一列，不该出现脏数据；即使真的出现了
/// （比如未来某次手动改库），把"读不懂"当成"没设置过"处理，也比让一条脏
/// 数据打断整个设置页更合理，理由与 `gs_storage::repository` 里
/// `enum_from_sql` 那类严格校验的路径不同——那些字段一旦解析失败就说明数据
/// 本身已经违反契约，值得让调用方感知失败；这里的字符串只是一个界面偏好，
/// 容错本身不会污染任何业务数据。
pub fn get_theme_preference(repo: &Repository<'_>) -> Result<Option<ThemePreference>, GsError> {
    let raw = repo.get_setting(SettingKey::ThemePreference)?;
    Ok(raw.and_then(|value| ThemePreference::from_sql(&value)))
}

/// 写入主题偏好。语义是"覆盖当前值"，理由见
/// [`gs_storage::Repository::set_setting`] 的文档。
pub fn set_theme_preference(
    repo: &Repository<'_>,
    preference: ThemePreference,
) -> Result<(), GsError> {
    repo.set_setting(SettingKey::ThemePreference, preference.as_sql())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gs_storage::Storage;

    #[test]
    fn get_theme_preference_returns_none_when_never_set() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        assert_eq!(
            get_theme_preference(&repo).expect("查询应当成功"),
            None,
            "未设置过时应当返回 None，供调用方回退到本地默认值，而不是报错"
        );
    }

    #[test]
    fn set_then_get_theme_preference_round_trips() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        set_theme_preference(&repo, ThemePreference::Dark).expect("写入应当成功");
        assert_eq!(
            get_theme_preference(&repo).expect("查询应当成功"),
            Some(ThemePreference::Dark)
        );
    }

    #[test]
    fn set_theme_preference_overwrites_previous_value() {
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        set_theme_preference(&repo, ThemePreference::Dark).expect("首次写入应当成功");
        set_theme_preference(&repo, ThemePreference::Light).expect("覆盖写入应当成功");
        assert_eq!(
            get_theme_preference(&repo).expect("查询应当成功"),
            Some(ThemePreference::Light),
            "覆盖写入后应读到新值"
        );
    }

    #[test]
    fn get_theme_preference_treats_unrecognized_stored_value_as_none() {
        // 正常路径只有 set_theme_preference 会写这一列，不该出现脏数据；
        // 这里直接绕过强类型入口写一个非法字符串，模拟"脏数据已经在库里"的
        // 场景，验证读取路径确实 fail-soft 而不是把 GsError 冒泡出去打断
        // 整个设置页。
        let storage = Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        repo.set_setting(SettingKey::ThemePreference, "not-a-real-theme")
            .expect("直接写入原始字符串应当成功（存储层不理解取值语义）");
        assert_eq!(
            get_theme_preference(&repo).expect("查询本身不应报错"),
            None,
            "无法识别的取值应当被当成未设置处理，而不是让 GsError 冒泡"
        );
    }
}
