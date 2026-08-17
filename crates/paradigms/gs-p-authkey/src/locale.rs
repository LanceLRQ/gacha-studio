//! 语言代码别名归一化：把来源各异的 `lang` 取值收敛成统一的规范形式。
//!
//! ## 为什么需要
//!
//! `gacha_record.lang` 记录一条抽卡记录的来源语言，`item_catalog` 的主键
//! `(plugin_id, item_id, lang)` 以它为其中一维。同一账号可能从不同来源
//! 拿到语言标签：
//! - authkey API 采集：从凭据 URL 的 `&lang=` 查询参数原样取出（见
//!   `pipeline.rs` 的 `AuthkeyApiPipeline::build_records` 调用点）；
//! - 第三方工具存档：不同工具对同一语言的书写习惯不统一——本项目
//!   fixtures 里实测到的是完整的 `language-REGION`（`zh-cn`），但不能假设
//!   所有来源都遵守这个写法，大小写（`zh-CN`/`ZH-CN`）与两位短码（`en`）
//!   都是真实出现过的变体（见下方"别名表来源"）。
//!
//! 不做归一化的后果：`en` 与 `en-us` 会被当成两种语言，同一件物品在
//! `item_catalog` 里按语言分裂成两条记录。
//!
//! ## 规范形式：小写连字符全称
//!
//! 取 `language-REGION` 全称、全部小写（如 `zh-cn`、`en-us`），三条证据
//! 一致：
//! - 原神抽卡 URL 的 `lang` 查询参数实测就是这个形态；
//! - `fixtures/` 里实际出现的取值同上；
//! - 参考实现（见下）的别名映射方向也是"短码 → 长码"，映射目标同样是
//!   这个形态。
//!
//! ⚠️ 不要与 `LocalizedText` 的 key（如 `{ "zh-CN": "原神" }`，插件文案表
//! 的键）混为一谈——那是完全独立的另一套约定，大小写不受本规则约束。
//!
//! ## 归一化顺序：先小写，再查别名表
//!
//! 大小写差异（`zh-CN` vs `zh-cn`）比 `en` → `en-us` 这类短码别名更常见，
//! 且两条规则相互独立——别名表的 key 本身已经全部是小写，若不先统一大小
//! 写，混合大小写的短码（如 `EN`、`En`）就查不中表，会被误判成"表外取值"
//! 而原样保留成一个从未真正出现过的形态（如 `"En"`）。反过来"先查表再
//! 小写"同样能覆盖大小写差异，但查表命中率会取决于表里是否顺带收录了
//! 每一种大小写变体，把"忽略大小写"这件事悄悄耦合进别名表的维护成本
//! 里；固定"先小写"能让别名表只需要维护小写 key，两条规则互不干扰。
//!
//! ## 别名表来源
//!
//! 本项目 fixtures 目前只实测到 `zh-cn` 一种取值，没有第二个真实短码样本
//! 可供独立归纳。下表转引自参考实现 HoYo.Gacha
//! （`docs/example-projects/HoYo.Gacha/crates/metadata/src/def.rs` 的
//! `LOCALE_ALIASES`，技术栈与本项目完全一致，是本项目文档定级最高的参考
//! 实现）——该表附带两个真实用户反馈的出处（GitHub issue
//! `lgou2w/HoYo.Gacha#89`、`#118`）。如实标注：这是**转引自参考实现的实测
//! 记录**，不是本项目独立验证过的样本。
//!
//! 收录的 12 个 ISO 639-1 短码 → 长码，对应米哈游三游客户端支持的 14 种
//! 语言（`en-us`/`zh-cn`/`zh-tw`/`de-de`/`es-es`/`fr-fr`/`id-id`/`ja-jp`/
//! `ko-kr`/`pt-pt`/`ru-ru`/`th-th`/`tr-tr`/`vi-vn`）；额外的 `zh`/`zh-sg`/
//! `zh-hk`/`zh-mo` 4 项是参考实现记录的地区变体别名——新加坡地区码归简体、
//! 港澳地区码归繁体。
//!
//! ## 表外取值：原样保留（仅小写化），不丢弃、不报错
//!
//! 语言代码空间是开放的。`allowedHosts`/`endpointOverride` 那类窄口因为
//! 对应真实的安全边界而 fail-closed 是对的，但 `lang` 只是归一化溯源
//! 字段，既不参与 `record_key` 去重，也不影响写入成败。遇到表外取值就
//! 丢弃或报错，换来的不是更安全，而是白白丢失一条记录本可以携带的溯源
//! 信息——这与本项目对 `raw_ref`/`occurred_raw` 这类字段"宁可保留原始
//! 信息、不要提前吃掉"的一贯态度是同一条原则。

// Portions adapted from HoYo.Gacha (MIT OR Apache-2.0)
//
// 具体范围：仅下方 `LOCALE_ALIASES` 的**表项数据**（哪些短码映射到哪个长码、
// 以及 zh-sg/zh-hk/zh-mo 三个地区变体的归并方向），转引自
// `docs/example-projects/HoYo.Gacha/crates/metadata/src/def.rs`。
// Rust 实现本身（LazyLock/HashMap 结构、归一化顺序、表外取值策略）是本项目
// 自己的写法，不是移植。
//
// 按 `THIRD-PARTY-NOTICES.md` §一 的约定，凡从参考项目转引的内容都要在文件头
// 打这个标记并在该文件补登记一行——本项目此前一直是「零命中」，这是第一条。
// 打标记而不是靠「这只是事实数据、不构成复制」的自我判断：判断可以有分歧，
// 标记不会，而标记的成本只有这几行。

use std::collections::HashMap;
use std::sync::LazyLock;

/// 短码 → 规范全称的别名表，收录范围见模块文档"别名表来源"一节。
static LOCALE_ALIASES: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    HashMap::from([
        ("de", "de-de"),
        ("en", "en-us"),
        ("es", "es-es"),
        ("fr", "fr-fr"),
        ("id", "id-id"),
        ("ja", "ja-jp"),
        ("ko", "ko-kr"),
        ("pt", "pt-pt"),
        ("ru", "ru-ru"),
        ("th", "th-th"),
        ("tr", "tr-tr"),
        ("vi", "vi-vn"),
        ("zh", "zh-cn"),
        ("zh-sg", "zh-cn"),
        ("zh-hk", "zh-tw"),
        ("zh-mo", "zh-tw"),
    ])
});

/// 把语言代码归一化成规范形式：先小写，再查别名表——命中则换成表里声明
/// 的规范全称，否则原样保留（仅小写化）。规则顺序与表外取值的处理理由见
/// 模块文档。
///
/// 幂等：`normalize_lang_alias(&normalize_lang_alias(x)) ==
/// normalize_lang_alias(x)`——别名表的 key 集合与 value 集合不相交（表里
/// 任何一个 value 都不会同时是某个 key），归一化一次产出的值必然查不中
/// 表里的任何一条别名，第二次调用只会落进"表外取值原样保留"分支，原样
/// 收回同一个值。`is_idempotent_for_every_table_entry_and_common_inputs`
/// 用穷举全部表项 + 若干表外样本的方式验证这条不变量，不只是靠"表结构上
/// 看起来不会有环"这个论证本身。
pub fn normalize_lang_alias(raw: &str) -> String {
    let lowered = raw.to_ascii_lowercase();
    match LOCALE_ALIASES.get(lowered.as_str()) {
        Some(canonical) => canonical.to_string(),
        None => lowered,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercases_without_touching_already_canonical_value() {
        assert_eq!(normalize_lang_alias("zh-cn"), "zh-cn");
        assert_eq!(normalize_lang_alias("ZH-CN"), "zh-cn");
        assert_eq!(normalize_lang_alias("Zh-Cn"), "zh-cn");
    }

    #[test]
    fn maps_short_code_alias_to_canonical_full_form() {
        assert_eq!(normalize_lang_alias("en"), "en-us");
        assert_eq!(normalize_lang_alias("EN"), "en-us");
        assert_eq!(normalize_lang_alias("zh"), "zh-cn");
        assert_eq!(normalize_lang_alias("ja"), "ja-jp");
    }

    #[test]
    fn maps_region_variant_alias_regardless_of_case() {
        // 新加坡地区码归简体、港澳地区码归繁体——这两条不是"短码补全"，是
        // 地区变体折叠，验证别名表不是只处理"两位短码"这一种形状。
        assert_eq!(normalize_lang_alias("zh-SG"), "zh-cn");
        assert_eq!(normalize_lang_alias("zh-hk"), "zh-tw");
        assert_eq!(normalize_lang_alias("ZH-MO"), "zh-tw");
    }

    #[test]
    fn preserves_unknown_value_lowercased_instead_of_dropping_it() {
        // "fr-ca"（加拿大法语）不在别名表里——遇到表外取值应当原样保留
        // （只做大小写归一），不丢弃、不报错，见模块文档"表外取值"一节。
        assert_eq!(normalize_lang_alias("fr-CA"), "fr-ca");
        assert_eq!(normalize_lang_alias("klingon"), "klingon");
    }

    #[test]
    fn empty_string_stays_empty_and_does_not_panic() {
        // 空串在这一层不特殊处理——下游 gs_storage::repository::normalize_empty
        // 统一把 lang/item_type/rarity 的空串转 NULL，这里不重复这条规则，
        // 只需要保证不会因为空串输入而 panic。
        assert_eq!(normalize_lang_alias(""), "");
    }

    #[test]
    fn is_idempotent_for_every_table_entry_and_common_inputs() {
        let samples = [
            "zh-cn", "ZH-CN", "en", "EN", "zh", "zh-sg", "zh-hk", "zh-mo", "de", "es", "fr", "id",
            "ja", "ko", "pt", "ru", "th", "tr", "vi", "fr-ca", "klingon", "",
        ];
        for raw in samples {
            let once = normalize_lang_alias(raw);
            let twice = normalize_lang_alias(&once);
            assert_eq!(
                once, twice,
                "归一化必须幂等：raw={raw:?} 第一次={once:?} 第二次={twice:?}"
            );
        }
    }
}
