//! 按任意已注册插件 id 读取 manifest 声明的展示名 / 稀有度阶梯 / 保底组 /
//! 卡池 / 保留期策略——全部从 `gs-manifest-data` 暴露的纯数据 JSON 直接
//! 反序列化。
//!
//! ## 与 `banner_meta_seed.rs` 的分工
//!
//! [`crate::banner_meta_seed`] 已经有一份读同一份 JSON 的实现，但**刻意只服务
//! genshin**（种子数据生成器，见该文件顶部说明）。`list_games`/保底进度这类
//! 界面需求天然要覆盖全部已注册插件（原神/星铁/鸣潮/绝区零），不能只服务
//! 一个游戏，因此本模块把"从 manifest JSON 反序列化出 gs_core 领域类型"这部分
//! 收敛成按 `plugin_id` 参数化的通用版本。`banner_meta_seed.rs` 里
//! `genshin_pity_groups`/`genshin_rarity_spec`/`genshin_banners` 三个已发布的
//! 公共函数保留不动（`pity.rs`/`rarity.rs`/`rare_event.rs` 的测试与集成测试
//! 都在用），内部实现改为调用本模块，避免两份反序列化逻辑漂移。

use gs_core::{BannerSpec, LocalizedText, PityGroup, RaritySpec, RetentionPolicy};

/// 取某个插件 manifest 的纯数据根节点，找不到就 panic——manifest 纯数据
/// 缺失意味着没跑过 `node scripts/gs-bundle-plugins.mjs`，属于开发期配置
/// 错误，不是运行时应当优雅处理的情况（与 `banner_meta_seed::genshin_manifest`
/// 对同一场景的处理方式一致）。
pub(crate) fn manifest_root(plugin_id: &str) -> &'static serde_json::Value {
    gs_manifest_data::plugin_manifest_data(plugin_id).unwrap_or_else(|| {
        panic!(
            "插件 \"{plugin_id}\" 的 manifest 纯数据未找到——先跑一次 \
             `node scripts/gs-bundle-plugins.mjs` 生成 \
             crates/gs-plugin-runtime/generated/plugins.manifest.json"
        )
    })
}

/// 把 `value` 反序列化成 `T`，失败时 panic 并带上插件 id 与字段名——理由与
/// `banner_meta_seed::deserialize_or_panic` 一致：manifest JSON 由打包脚本
/// 按 `gs_core` 的领域类型约束生成，反序列化失败说明两侧契约脱节。
pub(crate) fn deserialize_or_panic<T: serde::de::DeserializeOwned>(
    plugin_id: &str,
    field: &str,
    value: &serde_json::Value,
) -> T {
    serde_json::from_value(value.clone()).unwrap_or_else(|err| {
        panic!(
            "插件 \"{plugin_id}\" manifest 的 \"{field}\" 字段解析失败：{err}——\
             这份 JSON 由 scripts/gs-bundle-plugins.mjs 生成，不应手改；\
             若 gs_core 的领域类型改过字段，需要重新打包"
        )
    })
}

/// `plugin_id` 声明的全部保底组，直接来自 manifest `pityGroups` 字段。
pub fn pity_groups_for(plugin_id: &str) -> Vec<PityGroup> {
    let root = manifest_root(plugin_id);
    deserialize_or_panic(plugin_id, "pityGroups", &root["pityGroups"])
}

/// `plugin_id` 的稀有度阶梯声明，直接来自 manifest `rarity` 字段——不假设
/// 长度或具体取值（绝区零是 `["2","3","4"]`，米哈游三游是 `["3","4","5"]`）。
pub fn rarity_spec_for(plugin_id: &str) -> RaritySpec {
    let root = manifest_root(plugin_id);
    deserialize_or_panic(plugin_id, "rarity", &root["rarity"])
}

/// `plugin_id` 声明的全部卡池，直接来自 manifest `banners` 字段。
pub fn banners_for(plugin_id: &str) -> Vec<BannerSpec> {
    let root = manifest_root(plugin_id);
    deserialize_or_panic(plugin_id, "banners", &root["banners"])
}

/// `plugin_id` 的本地化展示名，解析成单个字符串供界面直接展示。
///
/// 取值优先级：`"zh-CN"` → `LocalizedText` 里的第一个条目（`BTreeMap` 保证
/// 遍历顺序确定）→ `plugin_id` 自身。前两级已经是本项目当前的展示语言约定
/// （`gs-analysis::banner_meta_seed::zh_cn_name` 同款：M1 阶段只有中文一种
/// 展示语言，manifest 目前也只声明了这一个 locale）；第三级回落纯粹是防御性
/// 兜底——`LocalizedText` 的 schema（`packages/gs-plugin-kit/schema/index.ts`
/// 的 `localizedTextSchema = z.record(z.string(), z.string())`）不强制要求
/// 非空或必须含 `"zh-CN"` 键，一旦真的撞上空 map，`list_games` 不该直接 panic
/// 让整个游戏列表读不出来，用 `plugin_id` 兜底好过界面上出现一个空白游戏名。
pub fn display_name_for(plugin_id: &str) -> String {
    let root = manifest_root(plugin_id);
    let display_name: LocalizedText =
        deserialize_or_panic(plugin_id, "displayName", &root["displayName"]);
    display_name
        .0
        .get("zh-CN")
        .cloned()
        .or_else(|| display_name.0.values().next().cloned())
        .unwrap_or_else(|| plugin_id.to_string())
}

/// `plugin_id` 声明的保留期策略，直接来自 manifest `retention` 字段。
///
/// 与 [`pity_groups_for`]/[`rarity_spec_for`]/[`banners_for`] 不同，
/// `retention` 在 `PluginManifest` 里是**可选字段**（省略表示这个游戏不做
/// 保留期监测——鸣潮就是真实的例子，`plugins/wuwa/manifest.ts` 明确注释了
/// "没有任何来源给出鸣潮官方记录保留期，不跨游戏挪用米哈游三游『6 个月』
/// 的说法"，宁可不声明也不编造一个数字）。因此这里不能像那几个
/// 必填字段一样对缺失 panic——`retention` 键本身可能在 manifest JSON 里
/// 整个不存在（`JSON.stringify` 会丢弃值为 `undefined` 的可选键），用
/// `Value::get` 返回 `Option` 而不是 `manifest_root` 那种"找不到就 panic"
/// 的处理方式，调用方（`gs-host` 的建账号/风险评估逻辑）必须显式处理
/// "这个游戏没有保留期基准"这个真实存在的情况，不能假设它总有值。
pub fn retention_policy_for(plugin_id: &str) -> Option<RetentionPolicy> {
    let root = manifest_root(plugin_id);
    let value = root.get("retention")?;
    if value.is_null() {
        return None;
    }
    Some(deserialize_or_panic(plugin_id, "retention", value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_policy_for_reads_genshin_conservative_days_and_display_text() {
        let policy = retention_policy_for("genshin").expect("genshin manifest 已声明 retention");
        assert_eq!(policy.conservative_days, 168); // 6 * 28
        assert_eq!(
            policy.display_text.0.get("zh-CN").map(String::as_str),
            Some("6 个月")
        );
    }

    #[test]
    fn retention_policy_for_returns_none_when_plugin_does_not_declare_it() {
        // 鸣潮真实场景：manifest 明确不声明 retention（没有可靠来源给出保留
        // 期天数），这里必须老实返回 None，不能编出一个数字冒充有依据。
        assert_eq!(retention_policy_for("wuwa"), None);
    }

    #[test]
    fn rarity_spec_for_reads_non_standard_ladder_for_zzz() {
        // 绝区零形态：最高档是 4，不是米哈游三游习惯的 5——用它验证本函数
        // 不是只在 genshin 上测过就假装"通用"。
        let spec = rarity_spec_for("zzz");
        assert_eq!(spec.ladder, vec!["2", "3", "4"]);
        assert_eq!(spec.pity_target, "4");
    }

    #[test]
    fn rarity_spec_for_reads_genshin_standard_ladder() {
        let spec = rarity_spec_for("genshin");
        assert_eq!(spec.ladder, vec!["3", "4", "5"]);
        assert_eq!(spec.pity_target, "5");
    }

    #[test]
    fn pity_groups_for_reads_multiple_groups_declared_by_zzz() {
        // 绝区零声明了 6 个保底组（独家/音擎/常驻/邦布频段 + 两个重映组），
        // 用它验证本函数不假设"每个插件只有一个保底组"（genshin 恰好只有一个，
        // 若只用 genshin 测会漏掉这条假设）。
        let groups = pity_groups_for("zzz");
        let mut keys: Vec<&str> = groups.iter().map(|g| g.key.as_str()).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "bangbooChannel",
                "exclusiveChannel",
                "exclusiveChannelRerun",
                "standardChannel",
                "wEngineChannel",
                "wEngineChannelEcho",
            ]
        );
    }

    #[test]
    fn banners_for_reads_pool_set_declared_by_starrail() {
        let banners = banners_for("starrail");
        let mut ids: Vec<&str> = banners.iter().map(|b| b.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["1", "11", "12", "2", "21", "22"]);
    }

    #[test]
    fn display_name_for_takes_zh_cn_entry_for_every_registered_plugin() {
        assert_eq!(display_name_for("genshin"), "原神");
        assert_eq!(display_name_for("starrail"), "崩坏：星穹铁道");
        assert_eq!(display_name_for("wuwa"), "鸣潮");
        assert_eq!(display_name_for("zzz"), "绝区零");
    }

    #[test]
    #[should_panic(expected = "的 manifest 纯数据未找到")]
    fn manifest_root_panics_on_unregistered_plugin_id() {
        // 开发期配置错误应当在这里就暴露，不是让调用方拿到一堆空数据后
        // 才在别处困惑——理由同 banner_meta_seed::genshin_manifest。
        let _ = pity_groups_for("does-not-exist");
    }
}
