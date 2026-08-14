//! 交换格式适配器框架。
//!
//! 现有的第三方抽卡记录工具会把采集结果导出成各自的本地存档文件（例如鸣潮
//! 参考项目 `WWGachaExport` 的本地 JSON 存档，见 [`wwgacha`] 模块）。本 crate
//! 的职责只有两步：**识别**（sniff）出一个文件是不是某种已知存档格式，
//! **导入**（import）成本项目能消费的中间形状——让用户能把已有的第三方导出
//! 存档一键导入进来，不用重新走一遍采集流程。
//!
//! **已接线（M2-S6）**：`gs-host` 的 `import` 模块依赖本 crate，把
//! [`ExchangeAdapter::import`] 产出的每个 [`ImportBatch`] 交给采集用的同一条
//! `AuthkeyApiPipeline::build_records` 通路落库——理由与实现见
//! `crates/gs-host/src/import.rs` 模块文档，裁定原文见
//! `docs/_internal/milestones/03-M2-鸣潮插件与抽象证伪.md` §4.6.3。本 crate
//! 自身仍然只负责"识别 + 导入成中间形状"这一层，不知道、也不依赖任何调用方
//! 怎么处理这份中间形状。
//!
//! ## trait 已被第二个真实实现证伪并改过一次形状
//!
//! [`ExchangeAdapter`] 现在有两个真实实现：[`wwgacha::WwgachaAdapter`] 与
//! [`uigf::UigfAdapter`]。UIGF v4 落地时证伪了 `import` 最初"一次导入恰好
//! 产出一个 [`ImportBatch`]"的假设——一份 UIGF v4 文件的粒度是"N 个游戏 ×
//! M 个账号"（`info` + 最多 4 个游戏键，每个游戏键下是一个账号数组），而
//! `ImportBatch` 是"1 个游戏 × 1 个账号"，`import` 一次只能返回一个，这是
//! 返回类型级的不匹配，不是可以在 wwgacha 的返回值外面包一层就绕过去的
//! 问题。因此 `import` 的签名改成了 `Result<Vec<ImportBatch>, ImportError>`
//! ——wwgacha 的实现不受影响（它对应的仍然是"单文件=单账号"，只是把唯一的
//! 那个 `ImportBatch` 包进一个长度恒为 1 的 `Vec`）。
//!
//! 同一次改动里，`fn game_id(&self) -> &'static str` 从 trait 上删除：
//! 排查发现这个方法除了 [`wwgacha::WwgachaAdapter`] 自己的实现之外零消费点
//! ——真正被下游读取的是 [`ImportBatch::game_id`]（每个 batch 各自携带自己
//! 的游戏归属，UIGF 一次导入可能同时产出 genshin/starrail/zzz 三个游戏的
//! batch，适配器级别的单一 `game_id()` 本来就装不下这个语义）。wwgacha 保留
//! 了模块内的 `GAME_ID` 常量供自己构造 `ImportBatch` 时使用，只是不再是
//! trait 契约的一部分。
//!
//! 这次改动本身是"trait 形状随时可能要改"这条声明的兑现，不是失败——crate
//! 顶部文档过去一直提醒这一点，UIGF 落地把它变成了已经发生的事实。

use serde_json::Value;

pub mod uigf;
pub mod wwgacha;

/// 对存档文件做格式识别（sniff）的判定结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SniffResult {
    /// 明确匹配——`head` 已经包含足够信息，可以确定就是这个格式。
    ///
    /// `format_version` 是 `Option<String>`，不是 `String`：不是每种交换
    /// 格式的存档结构里都有版本字段。wwgacha 存档就没有——源码级确认见
    /// [`wwgacha`] 模块文档引用的 `GameUser.cs`。为了让这个字段"看起来
    /// 有值"而编造一个版本号，比老实填 `None` 更有害：一旦消费方真的拿这个
    /// 编造值去做版本兼容判断，产出的结论比"没有版本信息"更具误导性。
    Confident { format_version: Option<String> },
    /// 疑似匹配，但当前掌握的信息不足以下明确结论。
    ///
    /// 这个分支不是为了凑满三态枚举而加的——它是 [`ExchangeAdapter::sniff`]
    /// 参数契约（"`head` 只是文件开头若干字节，不保证是完整文件"）的直接
    /// 后果：调用方识别一个可能有几十 MB 的存档时，不该把它整个读进内存才能
    /// 判断格式；因此 `sniff` 常态性地只能看到被截断的前缀。截断的前缀走不
    /// 到"解析成合法 JSON、逐字段类型校验"这条确定性路径，但如果前缀里已经
    /// 出现了目标格式独有的特征字符串，也不该武断地判为"不是"——这种情况下
    /// `Possible` 才是诚实的答案，`Confident`/`No` 都会撒谎。
    Possible,
    /// 明确不匹配。
    No,
}

/// 交换格式适配器：把某种"第三方工具产出的存档"识别并导入成 [`ImportBatch`]。
///
/// 完整的诚实状态声明见本 crate 顶部文档。
pub trait ExchangeAdapter {
    /// 本适配器识别/导入的交换格式标识，如 `"wwgacha"`、`"uigf-v4"`。
    fn format_id(&self) -> &'static str;

    /// 判断 `head` 是否匹配本适配器负责的格式。
    ///
    /// `head` 是文件**开头若干字节**，不保证是完整文件——调用方识别一个
    /// 可能几十 MB 的存档时，不该把它整个读进内存才能判断格式属于哪个
    /// 适配器；只有真正决定要导入时才会读取全部内容传给
    /// [`ExchangeAdapter::import`]。
    fn sniff(&self, head: &[u8]) -> SniffResult;

    /// 把完整的存档字节导入成一批 [`ImportBatch`]。
    ///
    /// 返回 `Vec` 而不是单个值——这是 UIGF v4 落地时证伪掉的第一版假设，见
    /// crate 顶部"trait 已被第二个真实实现证伪并改过一次形状"一节。一份
    /// 存档可能同时携带多个游戏、每个游戏下又有多个账号（UIGF v4 就是这样：
    /// `info` + 最多 4 个游戏键，每个游戏键下是一个账号数组），`ImportBatch`
    /// 固定是"1 个游戏 × 1 个账号"的粒度，因此一次 `import` 调用要能产出
    /// 0 到多个 batch。wwgacha 这类"单文件=单账号"的格式，返回值就是一个
    /// 长度恒为 1 的 `Vec`。
    ///
    /// 与 `sniff` 不同，`data` 必须是完整文件——字段映射与结构校验都需要
    /// 完整数据才能可靠进行；截断的输入应当在读取阶段就被调用方过滤掉，
    /// 不指望这里能优雅处理不完整的字节。
    fn import(&self, data: &[u8]) -> Result<Vec<ImportBatch>, ImportError>;
}

/// 一次成功导入的结果，尚未落库——落库、去重、写入 `GachaRecord` 是未来
/// 调用方（宿主）的职责，本 crate 只产出这一层中间形状。
#[derive(Debug, Clone, PartialEq)]
pub struct ImportBatch {
    pub format_id: String,
    pub game_id: String,
    pub account: ImportAccount,
    pub banners: Vec<ImportBanner>,
}

/// 导入识别出的账号信息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportAccount {
    pub uid: String,
    /// 对应存档的区服信息（如 wwgacha 的 `ServerArea`）。
    ///
    /// 用 `Option` 是因为这是框架级类型，不是所有交换格式的存档都携带区服
    /// 信息；wwgacha 的实现总能填出 `Some`，不代表未来其它适配器也一定能。
    pub region: Option<String>,
    /// 对应存档的服务器标识（如 wwgacha 的 `ServerID`）。语义同上。
    pub server_id: Option<String>,
    /// 存档自身声明的时区偏移小时数（UTC 偏移，正数表示东区）。
    ///
    /// UIGF v4 的 `UigfProject.timezone` 落在这里——放在 `ImportAccount`
    /// 而不是 `ImportBatch`：UIGF 里 `timezone` 是 project 级（= 每游戏每
    /// 账号）属性，语义上属于账号，不属于整份文件（一份 UIGF 文件可能包含
    /// 多个游戏、每个游戏又有多个账号，各自的 `timezone` 互不相同）。
    ///
    /// 不携带时区信息的交换格式（如 wwgacha 本地存档，`GameUser.cs` 没有
    /// 这个字段）填 `None`，是诚实地表达"确实没有"，不是编造一个默认时区。
    ///
    /// 消费点见 `gs_host::import::import_batch`：用这个值替代过去硬编码
    /// 传给 `AuthkeyApiPipeline::build_records` 的 `page_tz_offset_hours`
    /// 参数（`None`），也用它来放宽 `timezone_source_requires_page_response`
    /// 那条 fail-closed 检查——插件声明的 `timezoneSource: apiField`/
    /// `staticTable` 本来要读页级 API 响应体才能算出时区，但如果导入路径
    /// 的存档本身已经带着这个偏移量，效果上等价，不需要再假装"没有响应体
    /// 就一定拿不到时区"。
    pub tz_offset_hours: Option<i32>,
}

/// 一个卡池维度的导入结果。
#[derive(Debug, Clone, PartialEq)]
pub struct ImportBanner {
    /// 卡池稳定标识。wwgacha 用 `PoolType` 转字符串，与
    /// `plugins/wuwa/manifest.ts` 的 `banners[].id` 天然对齐，理由见
    /// [`wwgacha`] 模块文档。
    pub banner_id: String,
    /// **已经还原成采集 API 原始响应元素形状**的记录，顺序也已还原成 API
    /// 真实返回时的顺序（对 wwgacha 而言是"倒序，新→旧"，见 [`wwgacha`]
    /// 模块文档）。
    ///
    /// 为什么是 `serde_json::Value` 而不是 `UnifiedRecordFields`：导入路径
    /// 必须复用与采集**完全相同**的字段映射与 key 派生逻辑（TS 侧
    /// `plugins/<game>/manifest.ts` 的 `fields.extractRecord` 与
    /// `hooks.ts` 的 `deriveRecordKeys`），才能保证同一条实际记录——不管是
    /// 当场采集来的，还是从存档导入的——两边算出同一个 `record_key`。若
    /// 这里的 Rust 适配器自己把字段映射成 `UnifiedRecordFields`，字段映射
    /// 逻辑就会在 TS 的 `extractRecord` 和这个 Rust 适配器里各存一份、改一
    /// 处漏一处——这正是本项目反复踩过的 bug 类型：HoYo.Gacha 就是因为
    /// `record_key` 设计不到位（裸用服务端雪花 ID）付出过一次整表重建
    /// 迁移的代价，是同一类"两处各存一份、改一处漏一处"问题的另一个实例
    /// （详见 `gs_core::RecordKey` 模块文档）。把导入结果保持在"未经
    /// Rust 侧二次解释的 API 原始形状"，才能让它安全地喂给未来接线时会
    /// 调用的同一套 TS 管线，而不是绕开它另起一套。
    pub records: Vec<Value>,
}

/// [`ExchangeAdapter::import`] 失败原因。
///
/// 只放真正会被产出的变体，不为"将来可能"预留占位分支——按
/// `crates/paradigms/gs-p-authkey/src/log_scan.rs` 里 `LogScanError` 的
/// 写法惯例（手写 `Display` + `impl std::error::Error`，不引入 thiserror：
/// 本 crate 唯一的错误类型只有一个变体，宏生成的样板代码比手写更冗余）。
#[derive(Debug)]
pub enum ImportError {
    /// `data` 不是合法 JSON，或反序列化到目标格式的强类型结构失败（顶层
    /// 键缺失 / 类型不符）。
    ///
    /// 单条记录里的可选字段为 `null`（如 wwgacha 的 `CardPoolId`）不属于
    /// 这一类——那是真实存档里的正常状态，不是数据缺陷；各适配器自己的
    /// 强类型结构会把这类字段声明为可选甚至完全不声明，不会走到这个变体。
    Malformed { format_id: String, detail: String },
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed { format_id, detail } => {
                write!(f, "导入格式 \"{format_id}\" 失败：{detail}")
            }
        }
    }
}

impl std::error::Error for ImportError {}

/// 归并进跨层统一错误类型。
///
/// `gs_core::GsError` 的文档明确写着"各 crate 在需要更细粒度的错误分类时，
/// 应在自己的模块内定义专属错误类型，并归并到这里"——本 crate 尚未接入任何
/// 调用方，没有现成的归并调用点，但错误类型本身提前满足这份契约，未来接线
/// 时调用方不需要重新为 `ImportError` 写一遍到 `GsError` 的映射。归到
/// `Validation` 而不是 `Storage`：导入失败的原因是"输入数据不满足领域
/// 约束"（存档结构不对），不是存储介质本身出了问题。
impl From<ImportError> for gs_core::GsError {
    fn from(err: ImportError) -> Self {
        gs_core::GsError::Validation(err.to_string())
    }
}

/// 已注册适配器的集合，供调用方对一个未知存档做格式识别。
///
/// 只提供"注册 + 按 head 分类嗅探"两个方法——不预先加"用户选择哪个"、
/// "按优先级排序"这类还没有消费点的东西：当前唯一的真实调用场景只有单个
/// wwgacha 适配器，多适配器场景下如果真的出现"多个 Confident 同时命中"，
/// 排序/仲裁策略要等那个真实场景出现时再设计，不替一个假想的将来预先决定
/// 接口形状。
#[derive(Default)]
pub struct AdapterRegistry {
    adapters: Vec<Box<dyn ExchangeAdapter>>,
}

/// 一次 [`AdapterRegistry::sniff`] 调用的分类结果。`No` 的适配器不出现在
/// 任何一个列表里——调用方不需要关心"确认不是"的那些。
pub struct SniffMatches<'a> {
    pub confident: Vec<&'a dyn ExchangeAdapter>,
    pub possible: Vec<&'a dyn ExchangeAdapter>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, adapter: Box<dyn ExchangeAdapter>) {
        self.adapters.push(adapter);
    }

    /// 对全部已注册适配器跑一遍 [`ExchangeAdapter::sniff`]，按结果分类。
    pub fn sniff(&self, head: &[u8]) -> SniffMatches<'_> {
        let mut confident = Vec::new();
        let mut possible = Vec::new();
        for adapter in &self.adapters {
            match adapter.sniff(head) {
                SniffResult::Confident { .. } => confident.push(adapter.as_ref()),
                SniffResult::Possible => possible.push(adapter.as_ref()),
                SniffResult::No => {}
            }
        }
        SniffMatches {
            confident,
            possible,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wwgacha::WwgachaAdapter;

    #[test]
    fn import_error_display_includes_format_id_and_detail() {
        let err = ImportError::Malformed {
            format_id: "wwgacha".to_string(),
            detail: "缺少 GachaPoolData".to_string(),
        };
        let message = err.to_string();
        assert!(message.contains("wwgacha"));
        assert!(message.contains("缺少 GachaPoolData"));
    }

    #[test]
    fn import_error_converts_into_gs_core_validation_error() {
        let err = ImportError::Malformed {
            format_id: "wwgacha".to_string(),
            detail: "缺少 GachaPoolData".to_string(),
        };
        let converted: gs_core::GsError = err.into();
        assert!(matches!(converted, gs_core::GsError::Validation(_)));
    }

    #[test]
    fn registry_classifies_confident_match_from_registered_adapter() {
        let mut registry = AdapterRegistry::new();
        registry.register(Box::new(WwgachaAdapter));

        let head = br#"{"UID":1,"ServerID":"s","ServerArea":"a","GachaPoolData":[]}"#;
        let matches = registry.sniff(head);

        assert_eq!(matches.confident.len(), 1);
        assert_eq!(matches.confident[0].format_id(), "wwgacha");
        assert!(matches.possible.is_empty());
    }

    #[test]
    fn registry_returns_no_matches_for_unrelated_bytes() {
        let mut registry = AdapterRegistry::new();
        registry.register(Box::new(WwgachaAdapter));

        let matches = registry.sniff(b"not a gacha archive at all");

        assert!(matches.confident.is_empty());
        assert!(matches.possible.is_empty());
    }
}
