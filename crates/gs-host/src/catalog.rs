//! 插件展示元数据编排：把 manifest 纯数据（displayName / rarity / banners）
//! 按已注册插件 id 逐个投影成 [`GameView`]。
//!
//! 前端拿不到插件 manifest 本身——manifest 打包进
//! `crates/gs-plugin-runtime/generated/plugins.bundle.js` 只给 QuickJS 用，
//! `web/` 的 tsconfig 只 `include` 了 `src`。游戏展示名/稀有度档位/卡池展示名
//! 因此必须从 Rust 侧透出，这个模块就是那道投影，详细理由见 [`GameView`] 的
//! 文档。
//!
//! 与 [`crate::archive`] 同样的纪律：不碰 Tauri，数据源是
//! `gs_manifest_data::plugin_manifest_data` 直接 `include_str!` 进二进制的
//! 静态 JSON，不碰文件系统、不碰网络，可以直接单元测试。

use crate::views::GameView;

/// 列出全部已注册插件的展示元数据，顺序见
/// [`gs_analysis::registered_plugin_ids`]（按插件 id 字母序，稳定顺序，不随
/// `plugins/index.ts` 里的注册顺序或 `serde_json` 内部实现细节变化）。
pub fn list_games() -> Vec<GameView> {
    gs_analysis::registered_plugin_ids()
        .into_iter()
        .map(|plugin_id| GameView {
            plugin_id: plugin_id.to_string(),
            display_name: gs_analysis::display_name_for(plugin_id),
            rarity: gs_analysis::rarity_spec_for(plugin_id),
            banners: gs_analysis::banners_for(plugin_id),
            supports_current_platform: gs_analysis::supports_current_platform(plugin_id),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_all_four_currently_registered_games_in_alphabetical_order() {
        let games = list_games();
        let plugin_ids: Vec<&str> = games.iter().map(|g| g.plugin_id.as_str()).collect();
        // 钉住当前已注册插件集合，理由同 `gs-manifest-data` 里同款测试：
        // 新增插件时这条测试会红，是有意的确认点，不是"动态比对不会红"。
        assert_eq!(plugin_ids, vec!["genshin", "starrail", "wuwa", "zzz"]);
    }

    #[test]
    fn genshin_view_carries_display_name_ladder_and_banner_labels() {
        let games = list_games();
        let genshin = games
            .iter()
            .find(|g| g.plugin_id == "genshin")
            .expect("应当包含 genshin");

        assert_eq!(genshin.display_name, "原神");
        assert_eq!(genshin.rarity.ladder, vec!["3", "4", "5"]);
        assert_eq!(genshin.rarity.pity_target, "5");
        assert!(genshin.banners.iter().any(|b| b.id == "301"
            && b.display_name.0.get("zh-CN").map(String::as_str) == Some("角色活动祈愿")));
    }

    #[test]
    fn all_games_share_the_same_supports_current_platform_value_since_they_all_declare_windows_only()
     {
        // 不断言具体的 true/false（取决于跑测试的机器是 Windows 还是
        // macOS），只断言"四个插件既然声明了同一份 platforms: ["windows"]，
        // 在同一台机器上跑就应当得到同一个判定结果"——这条关系与运行测试的
        // 操作系统无关，可以放心跑在任何 CI/开发机上。
        let games = list_games();
        let values: std::collections::HashSet<bool> =
            games.iter().map(|g| g.supports_current_platform).collect();
        assert_eq!(
            values.len(),
            1,
            "四个插件都声明 platforms: [\"windows\"]，理应得到同一个判定结果，实际：{games:?}"
        );
    }

    #[test]
    fn zzz_view_exposes_its_own_two_three_four_ladder_not_three_four_five() {
        // 本函数最重要的验证点：绝区零是 2/3/4 档，不是米哈游三游习惯的
        // 3/4/5——任何把"最高档"硬编码成 "5" 的实现都会在这里露馅。
        let games = list_games();
        let zzz = games
            .iter()
            .find(|g| g.plugin_id == "zzz")
            .expect("应当包含 zzz");

        assert_eq!(zzz.rarity.ladder, vec!["2", "3", "4"]);
        assert_eq!(zzz.rarity.pity_target, "4");
        assert_eq!(zzz.display_name, "绝区零");
        // 绝区零声明了 6 个卡池，用它验证 banners 没有被截断成"只取第一个"。
        assert_eq!(zzz.banners.len(), 6);
    }
}
