//! 插件 manifest 纯数据 JSON 的只读访问入口——不依赖任何 JS 运行时。
//!
//! ## 为什么从 `gs-plugin-runtime` 里单独拆出来
//!
//! `plugin_manifest_data` 本身是一个不需要 QuickJS 引擎的纯函数：只是
//! `serde_json::from_str` 解析一份 `include_str!` 内嵌的 JSON。但它此前
//! 寄居在 `gs-plugin-runtime` 里，而那个 crate 因为要跑 QuickJS 而依赖
//! `rquickjs`（原生绑定，编译期要链接 QuickJS）。`gs-analysis`（保底计数、
//! 稀有度分布等纯 Rust 计算，从不执行任何 JS）如果要读 `pityGroups`/
//! `rarity`/`banners` 这些声明式数据，直接依赖 `gs-plugin-runtime` 就会把
//! `rquickjs` 拖进一个完全不需要 JS 引擎的分析引擎——这是反过来的耦合
//! 方向，"分析引擎依赖 JS 运行时" 这句话本身就不对劲。
//!
//! 拆出来后 `gs-plugin-runtime` 与 `gs-analysis` 平级依赖本 crate，本 crate
//! 不反过来依赖任何一个消费者，不产生环。这与 `gs-plugin-runtime` 自己当初
//! 从 `gs-host`/`gs-p-authkey` 之间拆出来是同一个理由（详见该 crate
//! `src/lib.rs` 顶部"为什么是独立 crate"一节），只是这次要避免的不是编译期
//! 依赖环，而是不必要的重量级依赖。
//!
//! ## ⚠️ 已知的临时妥协：生成文件的物理位置
//!
//! `scripts/gs-bundle-plugins.mjs` 硬编码把 `plugins.manifest.json` 写到
//! `crates/gs-plugin-runtime/generated/`。本次拆分明确不允许改动
//! `scripts/`（另有 agent 正在那个目录下并发工作），所以生成文件的物理
//! 位置暂时没有一并搬过来。正确的长期状态应当是这份 JSON 的物理归属搬到
//! 本 crate 下（如 `crates/gs-manifest-data/generated/`），由打包脚本直接
//! 写到这里；`gs-plugin-runtime` 只消费本 crate 暴露的函数，不再关心文件
//! 物理放在哪。现在退而求其次：本 crate 用**跨 crate 的相对路径**
//! `include_str!` 直接读 `gs-plugin-runtime/generated/` 下的同一份文件——
//! 两个 crate 读的是同一份物理文件，不是两份拷贝，不会产生内容漂移，但
//! 目录归属确实别扭。**等 `scripts/` 可以改动时应当补完**：把生成目录
//! 挪到本 crate 下、改打包脚本的输出路径、把下面这行 `include_str!`
//! 换成本 crate 自己目录下的相对路径。

use serde_json::Value;
use std::sync::OnceLock;

/// 见上方"已知的临时妥协"一节：物理文件仍在 `gs-plugin-runtime` 的目录下，
/// 这里用跨 crate 相对路径读同一份文件。
const PLUGIN_MANIFEST_JSON: &str =
    include_str!("../../gs-plugin-runtime/generated/plugins.manifest.json");

/// 取某个插件 manifest 的纯数据子集（`scripts/gs-bundle-plugins.mjs` 的
/// 产出）。返回 `serde_json::Value`——不同调用方（`gs-p-authkey` 只关心
/// `collect.params`，`gs-analysis` 关心 `pityGroups`/`rarity`/`banners`）
/// 需要的子集不同，这里不定义一个大而全的结构体，由各调用方自己反序列化出
/// 只关心的那部分——这个自由度一旦收进一个公共大结构体就找不回来了。
pub fn plugin_manifest_data(plugin_id: &str) -> Option<&'static Value> {
    parsed_manifest_root().get(plugin_id)
}

/// 打包脚本写入的元信息键，标记"这份 JSON 是生成产物"，不是一个插件 id。
/// [`registered_plugin_ids`] 用它把自己排除在外——见 `scripts/gs-bundle-plugins.mjs`
/// 里 `pureManifests = { _generatedBy: ... }` 那一行，两处字面量必须一致。
const GENERATED_BY_KEY: &str = "_generatedBy";

/// 列出全部已注册插件的 id（`plugins/index.ts` 打包出的全部游戏），按字母序
/// 排列。
///
/// 排序是刻意的，不是顺手：`plugins.manifest.json` 的顶层键顺序取决于
/// `serde_json::Map` 的内部实现（本 crate 未开 `preserve_order` feature 时是
/// `BTreeMap`，本就按字母序；但这不该是调用方能依赖的隐式前提）。显式排序
/// 让 `list_games` 这类消费方（`gs-host::catalog`）拿到的游戏列表顺序不随
/// `serde_json` 内部实现细节或依赖 feature 变化而漂移。
pub fn registered_plugin_ids() -> Vec<&'static str> {
    let mut ids: Vec<&'static str> = parsed_manifest_root()
        .as_object()
        .into_iter()
        .flat_map(|obj| obj.keys())
        .filter(|key| key.as_str() != GENERATED_BY_KEY)
        .map(String::as_str)
        .collect();
    ids.sort_unstable();
    ids
}

/// 懒解析并缓存 `plugins.manifest.json` 的根节点，[`plugin_manifest_data`]
/// 与 [`registered_plugin_ids`] 共用同一份解析结果与同一个 `OnceLock`——
/// 避免两个函数各自解析一遍同一份文件。
fn parsed_manifest_root() -> &'static Value {
    static PARSED: OnceLock<Value> = OnceLock::new();
    PARSED.get_or_init(|| {
        serde_json::from_str(PLUGIN_MANIFEST_JSON).unwrap_or_else(|err| {
            panic!(
                "crates/gs-plugin-runtime/generated/plugins.manifest.json 不是合法 JSON：{err}\
                 ——这份文件禁止手改，若被手改过请重跑 node scripts/gs-bundle-plugins.mjs"
            )
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_manifest_data_exposes_genshin_pure_data_fields() {
        let manifest =
            plugin_manifest_data("genshin").expect("genshin 插件应当已被打包进 manifest JSON");
        assert_eq!(manifest["id"], serde_json::json!("genshin"));
        // 函数字段必须已被剥离——fields.extractRecord 是个函数，纯数据 JSON
        // 里 fields 应当是空对象，而不是携带一个序列化失败的占位符。
        assert_eq!(manifest["fields"], serde_json::json!({}));
        assert!(manifest["pityGroups"].is_array());
        assert!(manifest["rarity"]["ladder"].is_array());
    }

    #[test]
    fn registered_plugin_ids_lists_all_plugins_and_excludes_metadata_key() {
        let ids = registered_plugin_ids();
        // 钉住当前四个已注册插件——新增插件时这条测试会红，是有意的确认点，
        // 理由与 gs-analysis 的 banner_meta_seed 测试同款（见该文件顶部说明）。
        assert_eq!(ids, vec!["genshin", "starrail", "wuwa", "zzz"]);
        assert!(
            !ids.contains(&"_generatedBy"),
            "打包脚本写入的元信息键不是插件 id，不应该出现在这里"
        );
    }

    #[test]
    fn returns_none_for_unknown_plugin_id() {
        assert!(plugin_manifest_data("does-not-exist").is_none());
    }
}
