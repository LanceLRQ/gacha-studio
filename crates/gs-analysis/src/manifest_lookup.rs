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

use std::collections::BTreeMap;

use gs_core::{
    BannerSpec, LocalizedText, PityGroup, Platform, RaritySpec, RequestTemplate, RetentionPolicy,
};

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

/// `plugin_id` 的稀有度阶梯文案，解析成"稀有度码 → 展示字符串"，供界面
/// 直接按码取值展示——真正的本地化档位名（绝区零 `S`/`A`/`B`，米哈游三游
/// 与鸣潮"五星"/"四星"/"三星"），不是拿稀有度码硬拼"N 星"这个通用规则。
///
/// 解析优先级与 [`display_name_for`] 完全一致：`"zh-CN"` → 该码下第一个
/// 已有值 → 兜底 `"{code}星"`。兜底只在 `RaritySpec.tier_labels` 没有覆盖
/// `ladder` 里的某个码时触发——四个已注册插件当前均已为自己 `ladder`
/// 声明的每一档补齐文案，这条回落路径是防御性的，不是正常路径（理由同
/// `display_name_for` 对空 `LocalizedText` 的兜底：一旦真的缺失，界面
/// 不该因为一条数据缺口就整个报错，退回通用文案好过白屏）。
///
/// 覆盖范围只到 `spec.ladder` 列出的码——`tier_labels` 理论上可能声明了
/// `ladder` 之外的码（manifest 允许，但没有意义），这里不把它们也吐出来，
/// 保持"这个函数只回答『ladder 里每一档叫什么』"这一件事。
pub fn tier_labels_for(plugin_id: &str) -> BTreeMap<String, String> {
    let spec = rarity_spec_for(plugin_id);
    spec.ladder
        .iter()
        .map(|code| {
            let label = spec
                .tier_labels
                .get(code)
                .and_then(|text| {
                    text.0
                        .get("zh-CN")
                        .cloned()
                        .or_else(|| text.0.values().next().cloned())
                })
                .unwrap_or_else(|| format!("{code}星"));
            (code.clone(), label)
        })
        .collect()
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

/// `plugin_id` 声明支持在哪些平台上运行，直接来自 manifest `platforms`
/// 字段——**必填字段**（不像 `retention`/`pityGroups` 可省略），manifest
/// JSON 里缺这个键属于打包脚本产出异常，因此用 `.get(...)` + panic 而不是
/// `Option` 返回值：`.get("platforms")` 找不到就说明契约脱节，应当在这里
/// 就暴露，不是让调用方（`supports_current_platform`）拿到一个空列表后，把
/// "manifest 缺字段"误判成"这个插件不支持任何平台"，两者含义完全不同。
pub fn platforms_for(plugin_id: &str) -> Vec<Platform> {
    let root = manifest_root(plugin_id);
    let value = root.get("platforms").unwrap_or_else(|| {
        panic!(
            "插件 \"{plugin_id}\" manifest 缺少必填字段 \"platforms\"——PluginManifest.platforms \
             是必填字段，这份 JSON 由 scripts/gs-bundle-plugins.mjs 生成，不应手改"
        )
    });
    deserialize_or_panic(plugin_id, "platforms", value)
}

/// 纯函数：`declared`（插件声明的支持平台列表）是否覆盖 `current`。
///
/// 拆成独立函数是为了可测试性——[`supports_current_platform`] 绑死了
/// `gs_core::Platform::current()`，实际编译到的目标平台是什么，测试只能
/// 覆盖那一条分支；把"覆盖判断"单独抽出来后，测试可以显式构造
/// `Platform::Windows`/`Platform::Macos` 两侧输入，不依赖测试运行所在的
/// 操作系统。详细理由见 [`gs_core::Platform::current`] 的文档。
pub fn platform_supported(declared: &[Platform], current: Platform) -> bool {
    declared.contains(&current)
}

/// `plugin_id` 是否声明支持当前实际运行的操作系统。
///
/// 消费点：`gs-host::catalog::list_games` 用它填 `GameView.supports_current_platform`
/// ——`CLAUDE.local.md`"Windows 优先，macOS 只读——采集能力需可缺省"在界面层
/// 的落点，前端据此在 macOS 上干净地禁用采集入口，而不是让用户点了才失败。
///
/// 无法识别当前操作系统时（[`gs_core::Platform::current`] 返回 `None`，如
/// Linux 开发机）按"不支持"处理——fail closed，不是 fail open：宁可界面上
/// 多禁用一个采集入口，也不要在一个未声明过的平台上假装采集能力可用。
pub fn supports_current_platform(plugin_id: &str) -> bool {
    let declared = platforms_for(plugin_id);
    match Platform::current() {
        Some(current) => platform_supported(&declared, current),
        None => false,
    }
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

/// `metadata` 字段里 `request` 子节点的最小反序列化形态——只声明本函数真正
/// 要读的字段（`kind`/`direction`/`request`），不是 `MetadataProviderConfig`
/// 判别联合的完整镜像。`kind: "builtin"` 分支没有 `request` 字段（它是
/// `dictionary` 静态字典），因此这里不建那个分支，`kind` 不是 `"online"`
/// 时直接返回 `None`——`builtin` 本轮只做查表机制，不消费这个读取函数。
#[derive(Debug, Clone, serde::Deserialize)]
struct OnlineMetadataProviderJson {
    kind: String,
    #[serde(default)]
    request: Option<RequestTemplate>,
}

/// `plugin_id` 声明的在线元数据 Provider 的请求模板，直接来自 manifest
/// `metadata` 字段——`MetadataProviderConfig` 只有一种已验证的在线方向
/// （`kind: "online"`，`direction: "nameToId"`，见 `packages/gs-plugin-kit/
/// manifest.ts` 该类型的文档），因此这里不返回 `direction` 本身，调用方
/// （`gs_host::metadata_backfill`）不需要再分支判断。
///
/// 与 [`retention_policy_for`] 同样的可选字段处理方式：`metadata` 是
/// `PluginManifest` 的可选字段，缺失（`.get` 返回 `None`）或显式
/// `null`（`JSON.stringify` 丢弃 `undefined` 值的可选键，理论上不会产生
/// 字面 `null`，但仍防御一次）都返回 `None`，不 panic——多数插件
/// （M1 阶段的 starrail/wuwa/zzz）本来就没有声明它，这是合法的正常状态。
/// `kind: "builtin"` 同样返回 `None`：本轮只有 genshin 声明 `online`，
/// `builtin` 没有 `request` 字段可读。
pub fn online_metadata_request_for(plugin_id: &str) -> Option<RequestTemplate> {
    let root = manifest_root(plugin_id);
    let value = root.get("metadata")?;
    if value.is_null() {
        return None;
    }
    let parsed: OnlineMetadataProviderJson = deserialize_or_panic(plugin_id, "metadata", value);
    if parsed.kind != "online" {
        return None;
    }
    parsed.request
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platforms_for_reads_windows_only_declaration_for_every_registered_plugin() {
        // 当前四个插件都只声明了 platforms: ["windows"]（M0/M1 阶段现实：
        // 尚无任何插件真正支持 macOS 采集），用它验证真实反序列化路径成立，
        // 而不是只靠下面 platform_supported 的纯函数测试自证。
        for plugin_id in ["genshin", "starrail", "wuwa", "zzz"] {
            assert_eq!(platforms_for(plugin_id), vec![Platform::Windows]);
        }
    }

    #[test]
    fn platform_supported_true_when_declared_list_contains_current() {
        assert!(platform_supported(&[Platform::Windows], Platform::Windows));
        assert!(platform_supported(
            &[Platform::Windows, Platform::Macos],
            Platform::Macos
        ));
    }

    #[test]
    fn platform_supported_false_when_declared_list_lacks_current() {
        assert!(!platform_supported(&[Platform::Windows], Platform::Macos));
    }

    #[test]
    fn platform_supported_false_for_empty_declared_list() {
        assert!(!platform_supported(&[], Platform::Windows));
    }

    #[test]
    fn supports_current_platform_matches_platform_supported_applied_to_declared_list() {
        // 不断言具体的 true/false（那取决于测试实际运行在哪个操作系统上），
        // 只断言"这个函数确实是 platform_supported 应用在 platforms_for 结果
        // 上"这条关系本身——用 gs_core::Platform::current() 独立算一遍期望值，
        // 与被测函数的实现路径不同源，不是同语反复。
        let expected = gs_core::Platform::current()
            .map(|current| platform_supported(&platforms_for("genshin"), current))
            .unwrap_or(false);
        assert_eq!(supports_current_platform("genshin"), expected);
    }

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
    fn tier_labels_for_resolves_zzzs_top_tier_to_s_not_four_star() {
        // 本项任务的验收样本：绝区零最高档 "4" 必须解析成 "S"，不是"4星"——
        // 这是 tier_labels_for 存在的全部理由。
        let labels = tier_labels_for("zzz");
        assert_eq!(labels.get("4").map(String::as_str), Some("S"));
        assert_eq!(labels.get("3").map(String::as_str), Some("A"));
        assert_eq!(labels.get("2").map(String::as_str), Some("B"));
    }

    #[test]
    fn tier_labels_for_resolves_genshin_standard_n_star_wording() {
        let labels = tier_labels_for("genshin");
        assert_eq!(labels.get("5").map(String::as_str), Some("五星"));
        assert_eq!(labels.get("4").map(String::as_str), Some("四星"));
        assert_eq!(labels.get("3").map(String::as_str), Some("三星"));
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

    #[test]
    fn online_metadata_request_for_reads_genshin_declared_request_template() {
        // genshin 是当前唯一声明 metadata Provider 的插件（kind: "online"，
        // direction: "nameToId"）——真实反序列化路径，不是靠构造假 JSON 自证。
        let request = online_metadata_request_for("genshin")
            .expect("genshin 应当声明 online metadata Provider");
        assert_eq!(
            request.url,
            "https://api.uigf.org/dict/genshin/{{lang}}.json"
        );
        assert_eq!(request.method, None);
    }

    #[test]
    fn online_metadata_request_for_returns_none_for_plugins_without_metadata_declaration() {
        // starrail/wuwa/zzz 当前都没有声明 metadata 字段（builtin 形态本轮只做
        // 机制、不填字典数据，因此不在任何插件 manifest 里声明），必须返回
        // None，不能 panic——metadata 是可选字段，缺失是合法状态。
        for plugin_id in ["starrail", "wuwa", "zzz"] {
            assert_eq!(
                online_metadata_request_for(plugin_id),
                None,
                "{plugin_id} 不应声明 metadata"
            );
        }
    }
}
