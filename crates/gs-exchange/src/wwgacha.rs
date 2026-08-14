//! `wwgacha`：鸣潮参考项目 `WWGachaExport`（C#/WPF）本地存档的交换适配器。
//!
//! ## 存档形状（源码级核实）
//!
//! 校准依据：`docs/example-projects/WWGachaExport/WWGachaExport/Models/`
//! 下的 `GameUser.cs` + `GachaPoolData.cs` + `GachaData.cs`。存档用
//! Newtonsoft 默认序列化，字段是 **PascalCase**：
//!
//! ```json
//! {
//!   "UID": 123456789,
//!   "ServerID": "<字符串>",
//!   "ServerArea": "<字符串>",
//!   "GachaPoolData": [
//!     {
//!       "PoolType": 1,
//!       "Data": [
//!         {
//!           "CardPoolType": "角色活动唤取",
//!           "CardPoolId": null,
//!           "ResourceId": 1102,
//!           "QualityLevel": 3,
//!           "ResourceType": "武器",
//!           "Name": "<物品名>",
//!           "Count": 1,
//!           "Time": "2099-01-01T00:00:00"
//!         }
//!       ]
//!     }
//!   ]
//! }
//! ```
//!
//! `UID` 是 C# `long`；`ResourceId`/`QualityLevel`/`Count`/`PoolType` 是
//! C# `int`（JSON 里是 number，不是数字字符串）；`Time` 是 C# `DateTime`
//! （Newtonsoft 默认输出 ISO 8601 无时区字符串）。
//!
//! 13 个 `PoolType` 槽位在真实存档里**固定存在**，但只有部分有数据——空池
//! 是空数组 `Data: []`，不是缺失键（3371 条真实记录逐字段统计已核实这一
//! 点：只有 PoolType 1/2/4/10/12 有数据，其余 8 个槽位固定存在但 `Data`
//! 为空）。解析时不得假设每个槽位非空，导入时对空槽位直接跳过，见
//! [`WwgachaAdapter::import`]。
//!
//! ## 与采集 API 响应（`KRAPIItem`）的关系
//!
//! 存档就是把 API 响应存下来的。API 响应元素是 **camelCase，共 7 个字段，
//! 没有 `cardPoolId`**：`cardPoolType` / `resourceId` / `qualityLevel` /
//! `resourceType` / `name` / `count` / `time`——这与 `plugins/wuwa/manifest.ts`
//! 里 `fields.extractRecord` 实际消费的原始记录字段完全一致。
//!
//! 参考实现拿到 API 响应后做了两件事再落盘：
//! 1. 调 `.Reverse()` 把 API 的**倒序（新→旧）**翻成**正序（旧→新）**；
//! 2. 把请求 URL 里解析出的 `resources_id`（即卡池 id）作为局部变量塞进
//!    `CardPoolId` 字段——它**不是**响应字段，来自请求参数，不是服务端。
//!
//! `import` 因此要做参考实现的逆操作：把每个卡池槽位的记录顺序**反转回
//! API 的真实倒序**，并**丢弃 `CardPoolId`**（不声明该字段，见下方结构体
//! 注释）。
//!
//! ## `CardPoolId` 为什么丢弃、且 `null` 不是错误
//!
//! 3371 条真实记录逐字段统计：`CardPoolId` 为 JSON `null` 占 93.1%
//! （3139/3371），非空的是字符串，占 232 条；全库非空取值去重后**只有
//! 1 个**——是跨池共用的同一个 hash，既不能区分卡池实例，也不能区分具体
//! 记录。把它塞进"已还原成 API 形状"的 `Value` 里，等于给
//! `fields.extractRecord` 递了一个真实 API 响应里根本不存在的字段。
//!
//! 反过来，`CardPoolId` 为 `null` 是**正常状态、绝大多数情况**，不是数据
//! 缺陷——[`WwgachaRecord`] 结构体故意不声明这个字段，serde 反序列化默认
//! 忽略未知字段，不管它在 JSON 里是 `null`、字符串还是压根不存在，都不会
//! 导致反序列化失败或记录被拒收。
//!
//! ## 顺序反转不是可有可无的兜底，是构造上的正确性
//!
//! `plugins/wuwa/hooks.ts` 的 `deriveRecordKeys` 靠"比较首尾记录时间"来
//! 判断输入数组方向、按需整体反转归一化——这是它自己的容错，用来应对
//! "数组方向不可信"这个真实存在的风险。但导入路径完全知道真实方向（存档
//! 是正序、参考实现的 `.Reverse()` 逆操作是"再反转一次"回到 API 倒序），
//! **主动把顺序精确还原成 API 真实返回顺序**，比依赖 `deriveRecordKeys`
//! 那套归一化兜底更严谨——这样"两边算出同一个 key"是构造上成立的，不是
//! "凑巧被兜底逻辑救回来"。

use serde::Deserialize;
use serde_json::Value;

use crate::{ExchangeAdapter, ImportAccount, ImportBanner, ImportBatch, ImportError, SniffResult};

/// 本适配器识别/导入的交换格式标识。
pub const FORMAT_ID: &str = "wwgacha";

/// 本适配器导入后产出的记录归属的游戏 id，对齐 `plugins/wuwa/manifest.ts`
/// 的 `id: "wuwa"`。
pub const GAME_ID: &str = "wuwa";

/// 存档顶层结构，字段名逐一对应 `GameUser.cs` 的 PascalCase 属性。
#[derive(Debug, Deserialize)]
struct WwgachaArchive {
    #[serde(rename = "UID")]
    uid: i64,
    #[serde(rename = "ServerID")]
    server_id: String,
    #[serde(rename = "ServerArea")]
    server_area: String,
    #[serde(rename = "GachaPoolData")]
    gacha_pool_data: Vec<WwgachaPoolSlot>,
}

/// 一个 `PoolType` 槽位，对应 `GachaPoolData.cs`。
#[derive(Debug, Deserialize)]
struct WwgachaPoolSlot {
    #[serde(rename = "PoolType")]
    pool_type: i64,
    #[serde(rename = "Data")]
    data: Vec<WwgachaRecord>,
}

/// 一条存档记录，对应 `GachaData.cs`。
///
/// ⚠️ **故意不声明 `CardPoolId` 字段**：serde 默认忽略输入 JSON 里未在
/// 结构体中声明的字段，不管它是 `null`、字符串还是缺失，都不影响其余字段
/// 的反序列化——这正是"丢弃该字段、且不能因为它是 `null` 而拒收记录"这两
/// 条要求最直接的实现方式，不需要额外声明一个用不上的 `Option<Value>` 字段
/// 再手动忽略。取舍理由见模块文档"`CardPoolId` 为什么丢弃"一节。
#[derive(Debug, Deserialize)]
struct WwgachaRecord {
    #[serde(rename = "CardPoolType")]
    card_pool_type: String,
    #[serde(rename = "ResourceId")]
    resource_id: i64,
    #[serde(rename = "QualityLevel")]
    quality_level: i64,
    #[serde(rename = "ResourceType")]
    resource_type: String,
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Count")]
    count: i64,
    #[serde(rename = "Time")]
    time: String,
}

/// 把一条存档记录重映射成 `KRAPIItem`（API 响应元素）形状的 JSON 值。
///
/// 数字字段原样保留为 JSON number（不转字符串）——`fields.extractRecord`
/// 用 `record.resourceId` 等字段做类型敏感的处理（见
/// `plugins/wuwa/manifest.ts` 的 `numericToString` 调用点），字符串化的
/// 数字会让它按字符串路径走，产出不同的结果。
fn record_to_api_shape(record: &WwgachaRecord) -> Value {
    serde_json::json!({
        "cardPoolType": record.card_pool_type,
        "resourceId": record.resource_id,
        "qualityLevel": record.quality_level,
        "resourceType": record.resource_type,
        "name": record.name,
        "count": record.count,
        "time": record.time,
    })
}

/// 顶层形状嗅探：`UID` 是数字、`ServerID`/`ServerArea` 是字符串、
/// `GachaPoolData` 是数组，四者同时满足才判定为 wwgacha 存档。
///
/// 只检查这四个字段的存在性与粗粒度类型，不深入校验 `GachaPoolData` 内部
/// 结构——sniff 的职责是"像不像"，不是"合不合法"，细粒度校验属于
/// [`WwgachaAdapter::import`]。
fn is_wwgacha_shape(value: &Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    obj.get("UID").is_some_and(Value::is_number)
        && obj.get("ServerID").is_some_and(Value::is_string)
        && obj.get("ServerArea").is_some_and(Value::is_string)
        && obj.get("GachaPoolData").is_some_and(Value::is_array)
}

/// 截断前缀的文本特征扫描：`head` 解析不出合法 JSON 时的降级路径。
///
/// 只找两个签名字符串——`"GachaPoolData"` 与 `"PoolType"`——同时出现。
/// 单独一个不够：`"PoolType"` 这个词本身不够独特，其它游戏的存档也可能
/// 恰好用到；两者都命中才把误判率压到可接受范围，同时不需要引入正则或
/// 完整的 JSON 词法分析器处理一段本来就不完整的前缀。
fn has_wwgacha_signature_text(head: &[u8]) -> bool {
    let text = String::from_utf8_lossy(head);
    text.contains("\"GachaPoolData\"") && text.contains("\"PoolType\"")
}

/// `WWGachaExport` 本地存档适配器。
pub struct WwgachaAdapter;

impl ExchangeAdapter for WwgachaAdapter {
    fn format_id(&self) -> &'static str {
        FORMAT_ID
    }

    fn sniff(&self, head: &[u8]) -> SniffResult {
        // 两级降级，顺序不能颠倒：先尝试把 head 当完整 JSON 解析——这是
        // `head` 恰好等于（或大于）整个文件时唯一能给出 `Confident` 的
        // 路径。解析失败不代表"不是这个格式"，只代表"head 被截断了，这是
        // 大文件下的常态而非边缘情况"（sniff 的调用契约本就允许调用方只
        // 传文件开头若干字节），此时才退化成对前缀做文本特征扫描。
        match serde_json::from_slice::<Value>(head) {
            Ok(value) => {
                if is_wwgacha_shape(&value) {
                    SniffResult::Confident {
                        format_version: None,
                    }
                } else {
                    // 解析成功但形状不对：head 已经是完整、可信的 JSON，
                    // 没有"信息不足"这回事，直接判定不是本格式，不需要
                    // 再退化到文本特征扫描——那是给"解析失败"准备的路径。
                    SniffResult::No
                }
            }
            Err(_) => {
                if has_wwgacha_signature_text(head) {
                    SniffResult::Possible
                } else {
                    SniffResult::No
                }
            }
        }
    }

    fn import(&self, data: &[u8]) -> Result<Vec<ImportBatch>, ImportError> {
        let archive: WwgachaArchive =
            serde_json::from_slice(data).map_err(|err| ImportError::Malformed {
                format_id: FORMAT_ID.to_string(),
                detail: err.to_string(),
            })?;

        let banners: Vec<ImportBanner> = archive
            .gacha_pool_data
            .iter()
            // 13 个槽位固定存在，多数为空——这是真实存档的常态。空槽位
            // 不产出 `ImportBanner`，不是异常分支。
            .filter(|slot| !slot.data.is_empty())
            .map(|slot| {
                let mut records: Vec<Value> = slot.data.iter().map(record_to_api_shape).collect();
                // 存档是参考实现 `.Reverse()` 之后的产物（正序，旧→新），
                // 这里做逆操作换回 API 真实返回的倒序（新→旧）。理由见
                // 模块文档"顺序反转不是可有可无的兜底"一节。
                records.reverse();
                ImportBanner {
                    banner_id: slot.pool_type.to_string(),
                    records,
                }
            })
            .collect();

        // 单份 wwgacha 存档只对应一个游戏一个账号——返回长度恒为 1 的
        // `Vec`，不是"这个格式将来可能支持多账号"的信号，纯粹是 trait
        // 签名统一成 `Vec<ImportBatch>`（见 crate 顶部文档"trait 已被第二个
        // 真实实现证伪并改过一次形状"一节）之后的必然写法。
        Ok(vec![ImportBatch {
            format_id: FORMAT_ID.to_string(),
            game_id: GAME_ID.to_string(),
            account: ImportAccount {
                uid: archive.uid.to_string(),
                region: Some(archive.server_area),
                server_id: Some(archive.server_id),
                // GameUser.cs 没有时区字段——wwgacha 本地存档不携带任何形式
                // 的时区信息，`None` 是诚实的表达，不是遗漏。
                tz_offset_hours: None,
            },
            banners,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一份贴近真实统计口径的样本存档：
    /// - `PoolType: 1` 槽位有 2 条记录，时间递增（存档正序），第一条
    ///   `CardPoolId` 为 `null`（对应 93.1% 的常态占比），第二条为字符串
    ///   （对应真实存档里少数非空取值）；
    /// - `PoolType: 2` 槽位 `Data` 为空数组，模拟 13 个固定槽位里未出货
    ///   的那些。
    fn sample_archive_json() -> String {
        r#"{
            "UID": 123456789,
            "ServerID": "server-01",
            "ServerArea": "area-01",
            "GachaPoolData": [
                {
                    "PoolType": 1,
                    "Data": [
                        {
                            "CardPoolType": "角色活动唤取",
                            "CardPoolId": null,
                            "ResourceId": 1101,
                            "QualityLevel": 3,
                            "ResourceType": "武器",
                            "Name": "测试武器甲",
                            "Count": 1,
                            "Time": "2026-01-01T00:00:00"
                        },
                        {
                            "CardPoolType": "角色活动唤取",
                            "CardPoolId": "somehash",
                            "ResourceId": 1102,
                            "QualityLevel": 4,
                            "ResourceType": "武器",
                            "Name": "测试武器乙",
                            "Count": 1,
                            "Time": "2026-01-02T00:00:00"
                        }
                    ]
                },
                {
                    "PoolType": 2,
                    "Data": []
                }
            ]
        }"#
        .to_string()
    }

    /// UIGF v4 形状的 JSON——顶层 `info.version` + `hk4e` 数组，
    /// 完全合法、未截断，用来验证 sniff 不会把它误判成 wwgacha。
    ///
    /// ⚠️ 字段名是 `version`，不是 `uigf_version`——源码校准依据
    /// `docs/example-projects/HoYo.Gacha/tauri/src/business/converters.rs`：
    /// `UigfInfo`（v4，1048-1054 行）的版本字段名是 `version`；
    /// `uigf_version` 是 `ClassicUigfInfo`（v2.x~v3.x 旧版，310-321 行）
    /// 的字段名，两者结构不同，不要混用。此前一版样本把两者搞混过，
    /// 错误不会被任何断言抓住（sniff 对两种写法都返回 `No`），因此这里
    /// 显式记录教训，防止 M3 真做 UIGF 适配器时把这份反例误当成已核实的
    /// UIGF v4 形状抄走。
    fn uigf_v4_shape_json() -> String {
        r#"{
            "info": { "export_timestamp": 1735689600, "version": "v4.0" },
            "hk4e": [
                { "uid": "100000000", "timezone": 8, "list": [] }
            ]
        }"#
        .to_string()
    }

    // ---------- sniff ----------

    #[test]
    fn sniff_returns_confident_for_full_valid_archive() {
        let adapter = WwgachaAdapter;
        let full = sample_archive_json();
        let result = adapter.sniff(full.as_bytes());
        assert_eq!(
            result,
            SniffResult::Confident {
                format_version: None
            }
        );
    }

    #[test]
    fn sniff_returns_possible_for_truncated_archive_prefix() {
        let adapter = WwgachaAdapter;
        let full = sample_archive_json();
        // 真实的"取前 N 字节"：截到刚过第一个 "PoolType" 签名字符串的位置，
        // 此时 JSON 结构必然不完整（连槽位对象都没闭合），解析必然失败，
        // 但签名字符串（GachaPoolData 在字符串更前面的位置，已经包含在内）
        // 已经出现，应当降级判定为 Possible。
        let cut = full.find("\"PoolType\"").expect("样本应当包含 PoolType") + 20;
        let head = &full.as_bytes()[..cut];

        // 自证前提：这份前缀确实不是合法 JSON，走的必须是文本扫描降级路径，
        // 不是侥幸解析成功。
        assert!(serde_json::from_slice::<Value>(head).is_err());

        let result = adapter.sniff(head);
        assert_eq!(result, SniffResult::Possible);
    }

    #[test]
    fn sniff_returns_no_for_uigf_v4_shape() {
        let adapter = WwgachaAdapter;
        let uigf = uigf_v4_shape_json();
        let result = adapter.sniff(uigf.as_bytes());
        assert_eq!(result, SniffResult::No);
    }

    #[test]
    fn sniff_requires_all_four_top_level_keys_not_just_gacha_pool_data() {
        // 补这条测试的直接原因：把 `is_wwgacha_shape` 砍成只检查
        // `GachaPoolData` 一个键之后，其余全部用例**依然全绿**——也就是说
        // 「四者同时满足」这句话此前只写在注释里，没有任何断言守着它。
        // 这正是本项目反复记录的那类问题（门之所以通过，是因为它什么都
        // 没检查），只是这次落在 sniff 的判据上。
        //
        // 为什么这不是吹毛求疵：账号级字段恰恰是**脱敏时最先被剥掉**的东西
        // （见 `fixtures/wuwa/meta.toml` 的脱敏记录）。一份被剥掉 UID 的
        // 存档若仍被判成 `Confident`，sniff 就撒了谎——`Confident` 的语义
        // 是「已经能确定就是这个格式」，而这种输入紧接着就会在 `import` 里
        // 因反序列化失败而报错。这类输入应当落到 `No`，而不是先被自信地
        // 认领、再在下一步失败。
        let adapter = WwgachaAdapter;
        let base: Value =
            serde_json::from_str(&sample_archive_json()).expect("样本自身应当是合法 JSON");

        // 逐个键做两种破坏：整个删掉、以及换成错误类型。
        for (key, wrong_typed) in [
            ("UID", Value::String("123456789".to_string())),
            ("ServerID", Value::from(1)),
            ("ServerArea", Value::from(1)),
            ("GachaPoolData", Value::from("not-an-array")),
        ] {
            for (case, mutated) in [
                ("删除", {
                    let mut v = base.clone();
                    v.as_object_mut().unwrap().remove(key);
                    v
                }),
                ("类型错误", {
                    let mut v = base.clone();
                    v.as_object_mut()
                        .unwrap()
                        .insert(key.to_string(), wrong_typed);
                    v
                }),
            ] {
                let bytes = serde_json::to_vec(&mutated).unwrap();
                // 前提自证：破坏后的输入仍是**完整合法**的 JSON，走的是
                // `is_wwgacha_shape` 那条判定路径，不是"解析失败降级到文本
                // 扫描"——否则这条测试测的就不是它声称测的东西。
                assert!(serde_json::from_slice::<Value>(&bytes).is_ok());
                assert_eq!(
                    adapter.sniff(&bytes),
                    SniffResult::No,
                    "{key} 被{case}后不应再判定为 wwgacha 存档"
                );
            }
        }
    }

    #[test]
    fn sniff_returns_no_for_unrelated_json_and_non_json_bytes() {
        let adapter = WwgachaAdapter;

        let unrelated_json = br#"{"foo":"bar"}"#;
        assert_eq!(adapter.sniff(unrelated_json), SniffResult::No);

        let non_json = b"this is not json at all, no braces here";
        assert_eq!(adapter.sniff(non_json), SniffResult::No);
    }

    // ---------- import ----------

    /// `import` 现在返回 `Vec<ImportBatch>`（见 crate 顶部文档"trait 已被
    /// 第二个真实实现证伪并改过一次形状"一节），但单份 wwgacha 存档永远只
    /// 对应一个游戏一个账号——这里统一断言"恰好一个"再取出，不在每条测试里
    /// 重复这段解包逻辑。
    fn import_single(adapter: &WwgachaAdapter, data: &[u8]) -> ImportBatch {
        let batches = adapter.import(data).expect("样本应当能导入成功");
        assert_eq!(
            batches.len(),
            1,
            "单份 wwgacha 存档应当恰好产出一个 ImportBatch，实际: {batches:?}"
        );
        batches.into_iter().next().unwrap()
    }

    #[test]
    fn import_remaps_fields_to_camel_case_api_shape_with_exactly_seven_keys() {
        let adapter = WwgachaAdapter;
        let full = sample_archive_json();
        let batch = import_single(&adapter, full.as_bytes());

        let banner = batch
            .banners
            .iter()
            .find(|b| b.banner_id == "1")
            .expect("PoolType 1 应当产出一个 banner");
        assert_eq!(banner.records.len(), 2);

        for record in &banner.records {
            let obj = record.as_object().expect("每条记录应当是 JSON 对象");
            assert_eq!(obj.len(), 7, "应当恰好 7 个键，实际: {obj:?}");
            for key in [
                "cardPoolType",
                "resourceId",
                "qualityLevel",
                "resourceType",
                "name",
                "count",
                "time",
            ] {
                assert!(obj.contains_key(key), "缺少键 {key}: {obj:?}");
            }
            assert!(
                !obj.contains_key("cardPoolId"),
                "cardPoolId 不应出现在还原后的 API 形状里: {obj:?}"
            );
        }
    }

    #[test]
    fn import_preserves_numeric_types_for_resource_id_quality_level_and_count() {
        let adapter = WwgachaAdapter;
        let full = sample_archive_json();
        let batch = import_single(&adapter, full.as_bytes());

        let banner = batch
            .banners
            .iter()
            .find(|b| b.banner_id == "1")
            .expect("PoolType 1 应当产出一个 banner");
        // 按 resourceId 定位记录而不是假设下标——这条测试只关心"数字字段是不是
        // JSON number"，不关心顺序（顺序由另一条测试
        // `import_reverses_pool_records_from_archive_order_to_api_order` 单独
        // 覆盖），下标假设会让两条测试在同一次改动下一起变红，掩盖问题的真实
        // 根因。
        let record = banner
            .records
            .iter()
            .find(|r| r["resourceId"].as_i64() == Some(1102))
            .expect("应当能找到 ResourceId 1102 对应的记录");

        assert!(record["resourceId"].is_number());
        assert!(record["qualityLevel"].is_number());
        assert!(record["count"].is_number());
        assert_eq!(record["qualityLevel"].as_i64(), Some(4));
        assert_eq!(record["count"].as_i64(), Some(1));
    }

    #[test]
    fn import_accepts_null_card_pool_id_without_error_or_record_loss() {
        let adapter = WwgachaAdapter;
        let full = sample_archive_json();
        let result = adapter.import(full.as_bytes());
        assert!(
            result.is_ok(),
            "CardPoolId 为 null 是正常状态，不应导致导入失败: {result:?}"
        );

        let batch = import_single(&adapter, full.as_bytes());
        let banner = batch
            .banners
            .iter()
            .find(|b| b.banner_id == "1")
            .expect("PoolType 1 应当产出一个 banner");
        // 存档里第一条记录 CardPoolId 为 null，ResourceId 1101——应当仍然
        // 出现在导入结果里，不能因为 CardPoolId 是 null 就被丢弃。
        let has_record_with_null_card_pool_id = banner
            .records
            .iter()
            .any(|r| r["resourceId"].as_i64() == Some(1101));
        assert!(
            has_record_with_null_card_pool_id,
            "CardPoolId 为 null 的记录不应丢失: {:?}",
            banner.records
        );
    }

    #[test]
    fn import_skips_pool_slots_with_empty_data_array() {
        let adapter = WwgachaAdapter;
        let full = sample_archive_json();
        let batch = import_single(&adapter, full.as_bytes());

        let banner_ids: Vec<&str> = batch.banners.iter().map(|b| b.banner_id.as_str()).collect();
        assert!(
            banner_ids.contains(&"1"),
            "非空槽位应当产出 banner: {banner_ids:?}"
        );
        assert!(
            !banner_ids.contains(&"2"),
            "空 Data 数组的槽位不应产出 banner: {banner_ids:?}"
        );
    }

    #[test]
    fn import_reverses_pool_records_from_archive_order_to_api_order() {
        let adapter = WwgachaAdapter;
        let full = sample_archive_json();
        let batch = import_single(&adapter, full.as_bytes());

        let banner = batch
            .banners
            .iter()
            .find(|b| b.banner_id == "1")
            .expect("PoolType 1 应当产出一个 banner");
        assert_eq!(banner.records.len(), 2);
        // 存档正序：1101（旧）在前、1102（新）在后。还原成 API 倒序后，
        // 1102（新）应当排在第一条，1101（旧）排在最后一条。
        assert_eq!(banner.records[0]["resourceId"].as_i64(), Some(1102));
        assert_eq!(banner.records[1]["resourceId"].as_i64(), Some(1101));
    }

    #[test]
    fn import_returns_error_when_top_level_key_is_missing() {
        let adapter = WwgachaAdapter;
        let missing_gacha_pool_data = br#"{
            "UID": 123456789,
            "ServerID": "server-01",
            "ServerArea": "area-01"
        }"#;
        let result = adapter.import(missing_gacha_pool_data);
        assert!(matches!(result, Err(ImportError::Malformed { .. })));
    }

    #[test]
    fn import_returns_error_when_uid_type_is_mismatched() {
        let adapter = WwgachaAdapter;
        let uid_as_string = br#"{
            "UID": "not-a-number",
            "ServerID": "server-01",
            "ServerArea": "area-01",
            "GachaPoolData": []
        }"#;
        let result = adapter.import(uid_as_string);
        assert!(matches!(result, Err(ImportError::Malformed { .. })));
    }
}
