//! MetadataProvider 回填侧 —— 对称于标记侧 `determine_meta_state`
//! （`crates/paradigms/gs-p-authkey/src/pipeline.rs`）。
//!
//! 标记侧已经把 `itemIdSource: "displayName"` 的记录（目前只有原神）标成
//! `meta_state: pending`——`fields.extractRecord` 把本地化物品名塞进了
//! `itemId`，不是真正的物品标识。本模块把这类记录反查回真正的 `itemId`，
//! 把 `meta_state` 推进到 `complete`，并把反查用到的 name 写进
//! `item_catalog`（建库以来第一个真实写入方）。
//!
//! 只实现 `MetadataProviderConfig.kind: "online"` 的执行侧；`kind:
//! "builtin"` 本轮只在类型层面保留查表机制的位置（[`resolve_from_dictionary`]
//! 对两种 kind 通用），不填任何字典数据——本仓库没有自己的物品字典，唯一
//! 一份在参考项目 `docs/example-projects/HoYo.Gacha` 里，是别人的数据，
//! 项目规矩是"参考设计思路而非直接复制"，禁止拷进来。星铁/绝区零需要一个
//! 构建期字典生成方案，属未决事项，不在本模块声称覆盖的范围内。
//!
//! ## 为什么网络下载与"解析响应"分属两个不同的调用位置
//!
//! 与 [`crate::icon_cache`] 同样的坑：生产环境的 [`ReqwestDictionaryFetcher`]
//! 用 `reqwest::blocking::Client`，它在**构造/销毁**时会自建一个 Tokio
//! 运行时；若在 Tauri 派发 async 命令所用的那个 Tokio 运行时的工作线程上
//! 直接调用它，会触发 `Cannot drop a runtime in a context where blocking is
//! not allowed` panic——必须整体丢进 `tauri::async_runtime::spawn_blocking`。
//!
//! 但本模块比图标下载多一层约束：反查响应体要交给插件的
//! `manifest.metadata.parseResponse` 解析，这一步经 `PluginRuntime`
//! 执行——`PluginRuntime` 不是 `Send`（QuickJS 的值带生命周期绑定，
//! rquickjs 的 `Context` 无法安全跨线程移动，见 `gs-plugin-runtime` 模块
//! 文档），不能被移进 `spawn_blocking` 的闭包。因此**只有"取字节"这一步**
//! （[`fetch_dictionary_bytes`]，只接受 `&str`/`&dyn DictionaryFetcher` 这类
//! `Send + 'static` 输入）设计成可以整体丢进 `spawn_blocking`；解析响应
//! （[`parse_dictionary_via_plugin`]）、读写本地缓存
//! （[`load_cached_dictionary`]/[`save_cached_dictionary`]）、落库
//! （[`apply_dictionary_to_records`]）全部是普通同步函数，由调用方
//! （`src-tauri/src/commands.rs` 的 `backfill_pending_metadata`）在
//! `spawn_blocking` **之外**、async 命令函数体自身的线程上直接调用——与
//! `commands.rs::import_archive_via_picker` 直接在 async 函数体里调用
//! `plugin_runtime.call` 是同一种已验证安全的模式。
//!
//! ## UIGF 字典 API 的语言短码约定
//!
//! `api.uigf.org/dict/{game}/{lang}.json` 的 `{lang}` 用的是它自己的短码
//! 约定（`chs`/`cht`/`en`/`de`/…），与 `gacha_record.lang` 的规范形式
//! （`zh-cn`/`en-us`/…，见 `crates/paradigms/gs-p-authkey/src/locale.rs`）
//! 不是同一套。[`uigf_lang_short_code`] 是"这个具体接口"的知识，不是游戏
//! 知识——换一个用同一个接口的游戏依然成立，因此没有放进
//! `plugins/genshin/manifest.ts`。当前只有 genshin 一个消费点，不满足
//! 三次法则的抽象阈值，先内联在本模块，不预先另开文件。表项来源已用真实
//! 实现核实：`docs/example-projects/genshin-wish-export/src/main/
//! UIGFJson.js` 的 `uigfLangMap`。
//!
//! ## 已知取舍：不做基于 MD5 的增量更新检测
//!
//! `docs/_internal/research/01-抽卡工具生态与采集范式调研.md` §3.4 记载
//! `api.uigf.org` 提供 `/md5/{game}` 端点，可用于判断本地缓存是否已经过期、
//! 避免每次都重新下载整份字典。参考实现（genshin-wish-export）用它做增量
//! 检测。本模块**没有实现**这一层优化：每次回填都会尝试重新拉取远端字典
//! （拉取失败才退回本地缓存），正确性不受影响（远端字典只会变得更全，
//! 拉到旧版本不会导致误判，无非是错过新条目、记录继续留在 pending 等下一次
//! 回填），代价只是"每次回填都重新下载一次"这个可优化但不影响正确性的
//! 效率问题。如实记录为遗留项，不假装已覆盖。

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use gs_core::{GachaRecord, GsError, HttpMethod, RequestTemplate};
use gs_plugin_runtime::PluginRuntime;
use gs_storage::{NewItemCatalogEntry, Repository};

/// 单份字典文件的大小上限：8 MB。真实样本（星铁/绝区零构建期离线字典）是
/// 151KB/103KB，原神在线字典量级相近或更小，8MB 留出充足冗余，同时仍然
/// 是一个远小于"整份响应体不设上限"的硬界限——`iconUrl` 的 2MB 上限是
/// 图片，字典是纯文本 JSON，压缩比不同，因此没有直接复用同一个常量。
const MAX_DICT_BYTES: usize = 8 * 1024 * 1024;

/// 单次下载的超时时间，覆盖从建连到读完响应体的全过程。字典可能有几十万
/// 条目，比图标大得多，超时时间比 [`crate::icon_cache::FETCH_TIMEOUT`]
/// （10s）宽松一些。
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// 重定向跳转次数上限，理由与 [`crate::icon_cache::ReqwestIconFetcher`]
/// 文档"传输层的第二道 https 防线"一节一致。
const MAX_REDIRECTS: usize = 3;

/// 失败重试之间的固定间隔。研究记录（见模块文档）显示该接口有过
/// `Failed to create dictionary` 的故障记录，短暂重试能吸收一部分瞬时故障；
/// 不用指数退避——重试次数本身就很小（生产默认 2 次），退避策略的收益
/// 微乎其微，固定间隔更简单。
const RETRY_DELAY: Duration = Duration::from_millis(200);

/// 生产环境默认的最大尝试次数（含首次请求）。
pub const DEFAULT_MAX_ATTEMPTS: u32 = 2;

/// 从 `reader` 最多读取 `cap` 字节；超过 `cap` 返回 `None`。
///
/// 与 [`crate::icon_cache::read_capped`] 同构，**刻意不合并成共享工具**：
/// 两处调用点的输入类型相同（`Box<dyn Read>`），合并的唯一收益是省几行
/// 代码，代价是给一个稳定、19 个测试全绿的文件（`icon_cache.rs`）引入不
/// 必要的改动面。当前只有两个消费点，不满足本项目自己奉行的三次法则的
/// 抽象阈值——这条理由本身就是项目里其它地方（如 `gs-p-authkey` 不单独
/// 建 `gs-collect-wuwa/`）反复用过的同一个论证，这里同样适用。
fn read_capped(reader: Box<dyn Read + '_>, cap: usize) -> Option<Vec<u8>> {
    let mut limited = reader.take(cap as u64 + 1);
    let mut buf = Vec::new();
    limited.read_to_end(&mut buf).ok()?;
    if buf.len() > cap { None } else { Some(buf) }
}

/// 一次网络下载的结果：HTTP 是否成功、响应体读取器。不需要 content-type
/// （字典接口固定返回 JSON，不像图标那样要按 magic bytes 做格式嗅探）。
pub struct FetchOutcome {
    pub success: bool,
    pub body: Box<dyn Read>,
}

/// 网络获取能力的窄口：真实实现见 [`ReqwestDictionaryFetcher`]，测试注入
/// 内存假实现，保证单测绝不联网——与 [`crate::icon_cache::IconFetcher`]
/// 同一个理由。
pub trait DictionaryFetcher {
    fn fetch(&self, url: &str) -> Result<FetchOutcome, String>;
}

/// 生产环境实现，加固标准与 [`crate::icon_cache::ReqwestIconFetcher`] 一致：
/// 响应体大小硬上限（[`read_capped`] 边读边限）、超时、`https_only(true)`
/// （reqwest 默认不阻止 https→http 重定向降级）、重定向上限。
pub struct ReqwestDictionaryFetcher;

impl DictionaryFetcher for ReqwestDictionaryFetcher {
    fn fetch(&self, url: &str) -> Result<FetchOutcome, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(FETCH_TIMEOUT)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
            .build()
            .map_err(|err| err.to_string())?;
        let response = client.get(url).send().map_err(|err| err.to_string())?;
        let success = response.status().is_success();
        Ok(FetchOutcome {
            success,
            body: Box::new(response),
        })
    }
}

/// `api.uigf.org` 自己的语言短码约定，见模块文档"UIGF 字典 API 的语言短码
/// 约定"一节。`canonical_lang` 是 `gacha_record.lang` 的规范形式（如
/// `"zh-cn"`），未收录的语言返回 `None`——fail closed：宁可这个语言暂时
/// 拿不到字典（记录继续留在 pending），也不要拼一个大概率 404 的 URL 去
/// 发请求。
fn uigf_lang_short_code(canonical_lang: &str) -> Option<&'static str> {
    match canonical_lang {
        "zh-cn" => Some("chs"),
        "zh-tw" => Some("cht"),
        "de-de" => Some("de"),
        "en-us" => Some("en"),
        "es-es" => Some("es"),
        "fr-fr" => Some("fr"),
        "id-id" => Some("id"),
        "ja-jp" => Some("jp"),
        "ko-kr" => Some("kr"),
        "pt-pt" => Some("pt"),
        "ru-ru" => Some("ru"),
        "th-th" => Some("th"),
        "vi-vn" => Some("vi"),
        _ => None,
    }
}

/// 把插件声明的 `metadata.request` 模板 + 一个规范形式的语言代码，解析成
/// 一条可以真正发出去的请求 URL。
///
/// 三种情况返回 `None`（fail closed，不猜测、不降级成"大概对"的 URL）：
/// - 模板 `url` 不是 `https://` 开头——理由与 `iconUrl` 的同款校验一致，
///   即使模板来自编译期审查过的 manifest，防御成本只有一行判断；
/// - 模板显式声明了 `method: "POST"`——本函数只支持 GET，见下方"已知范围"；
/// - `canonical_lang` 在 [`uigf_lang_short_code`] 里查不到——没有已验证的
///   短码就不知道该拼哪个 URL。
///
/// ⚠️ **已知范围：只支持 GET，不支持 POST**。`RequestTemplate.method`
/// 理论上可以是 `POST`（`credentialedApi` 范式的鸣潮就用 POST），但
/// `MetadataProviderConfig` 当前唯一的真实消费者（原神）用的是 GET，零样本
/// 支撑"元数据 Provider 需要 POST"这件事——按三次法则不预先实现，声明了
/// POST 的插件会在这里被拒绝（记录留在 pending），不是静默当 GET 处理。
fn dictionary_request_url(template: &RequestTemplate, canonical_lang: &str) -> Option<String> {
    if !template.url.starts_with("https://") {
        return None;
    }
    if matches!(template.method, Some(HttpMethod::Post)) {
        return None;
    }
    let short_code = uigf_lang_short_code(canonical_lang)?;
    Some(template.url.replace("{{lang}}", short_code))
}

/// 下载一份字典的原始字节，带重试与大小上限，网络层的一切失败（含"下载
/// 成功但超过大小上限"）统一收敛成 `None`——字典缺席是设计好的正常路径
/// （记录继续留在 pending，不冒泡成 `Err` 打断回填流程的其余部分），只有
/// `url` 本身不是 `https://` 开头这种入口校验失败才提前短路、不发起请求。
///
/// `max_attempts` 为 0 时按 1 处理（至少尝试一次）。
pub fn fetch_dictionary_bytes(
    url: &str,
    fetcher: &dyn DictionaryFetcher,
    max_attempts: u32,
) -> Option<Vec<u8>> {
    if !url.starts_with("https://") {
        return None;
    }
    let attempts = max_attempts.max(1);
    for attempt in 1..=attempts {
        let outcome = fetcher.fetch(url);
        if let Ok(outcome) = outcome
            && outcome.success
        {
            return read_capped(outcome.body, MAX_DICT_BYTES);
        }
        if attempt < attempts {
            std::thread::sleep(RETRY_DELAY);
        }
    }
    None
}

/// `plugin_id`/`lang` 是否只由路径安全字符组成——与
/// `crate::icon_cache::is_path_safe_plugin_id` 同一套字符规则（不接受本身
/// 已经通过 [`uigf_lang_short_code`] 校验的 `canonical_lang` 就一定安全这个
/// 假设：`lang` 落到这里的值来自 `gacha_record.lang`，理论上可能是"表外
/// 取值原样保留"的任意字符串——`locale.rs` 模块文档明确写了这一条，缓存
/// 文件名的安全性不能依赖上游归一化一定守规矩）。
fn is_path_safe_component(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// 字典本地缓存文件的路径：`<cache_root>/metadata/<plugin_id>-<lang>.json`。
/// `plugin_id`/`lang` 任一含非法字符时返回 `None`（fail closed，不拼一个
/// 可能逃出 `metadata/` 子目录的路径）。
fn dictionary_cache_path(cache_root: &Path, plugin_id: &str, lang: &str) -> Option<PathBuf> {
    if !is_path_safe_component(plugin_id) || !is_path_safe_component(lang) {
        return None;
    }
    Some(
        cache_root
            .join("metadata")
            .join(format!("{plugin_id}-{lang}.json")),
    )
}

/// 读取本地缓存的字典。缓存不存在、路径不安全、文件内容不是合法 JSON 一律
/// 返回 `None`——这是"接口故障时用缓存，缓存也没有时优雅失败"这条要求的
/// 后半段，调用方（`src-tauri/src/commands.rs`）据此判断"这个语言彻底没有
/// 可用字典"。
pub fn load_cached_dictionary(
    cache_root: &Path,
    plugin_id: &str,
    lang: &str,
) -> Option<HashMap<String, String>> {
    let path = dictionary_cache_path(cache_root, plugin_id, lang)?;
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// 把一份字典写入本地缓存，供下次接口故障时兜底。
pub fn save_cached_dictionary(
    cache_root: &Path,
    plugin_id: &str,
    lang: &str,
    dictionary: &HashMap<String, String>,
) -> Result<(), GsError> {
    let path = dictionary_cache_path(cache_root, plugin_id, lang).ok_or_else(|| {
        GsError::Storage(format!(
            "plugin_id \"{plugin_id}\" 或 lang \"{lang}\" 含路径不安全字符，拒绝写入字典缓存"
        ))
    })?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| GsError::Storage(format!("创建元数据缓存目录失败: {err}")))?;
    }
    let bytes = serde_json::to_vec(dictionary)
        .map_err(|err| GsError::Storage(format!("序列化字典缓存失败: {err}")))?;
    fs::write(&path, bytes).map_err(|err| GsError::Storage(format!("写入字典缓存失败: {err}")))?;
    Ok(())
}

/// 把插件 `manifest.metadata.parseResponse` 解析出的响应体转换成
/// `name -> itemId` 字典。
///
/// `response_bytes` 不是合法 JSON、插件调用失败（异常/manifest 未声明该
/// hook）、或返回值不是一个对象，一律返回 `None`——响应形状不对不应该让
/// 整个回填流程崩溃，只是这个语言这一轮拿不到新字典（调用方会退回本地
/// 缓存）。
///
/// 单个条目的值只接受非空字符串或数字（自动转字符串），其余形状（`null`/
/// 对象/数组/布尔/空串）跳过——插件侧的 `parseUigfDictResponse` 已经做过
/// 一次同样的防御式过滤，这里是宿主侧的第二道防线：不信任插件一定守规矩，
/// 一条脏数据不应该让调用方以为整份字典都不可用。
pub fn parse_dictionary_via_plugin(
    plugin_runtime: &PluginRuntime,
    plugin_id: &str,
    response_bytes: &[u8],
) -> Option<HashMap<String, String>> {
    let response_json: serde_json::Value = serde_json::from_slice(response_bytes).ok()?;
    let result = plugin_runtime
        .call(
            plugin_id,
            "manifest.metadata.parseResponse",
            std::slice::from_ref(&response_json),
        )
        .ok()?;
    let serde_json::Value::Object(map) = result else {
        return None;
    };
    let mut dictionary = HashMap::with_capacity(map.len());
    for (name, id) in map {
        match id {
            serde_json::Value::String(s) if !s.is_empty() => {
                dictionary.insert(name, s);
            }
            serde_json::Value::Number(n) => {
                dictionary.insert(name, n.to_string());
            }
            _ => {}
        }
    }
    Some(dictionary)
}

/// 一次回填的结果统计，四类互斥的记录去向。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BackfillOutcome {
    pub plugin_id: String,
    /// 成功反查、`item_id` 已替换、`meta_state` 已推进到 `complete`。
    pub resolved: u32,
    /// 有可用字典，但记录的 name 在字典里查不到——保持 `pending`，等下一次
    /// 字典更新后再试，不写入猜测值。
    pub still_pending: u32,
    /// `gacha_record.lang` 是 `NULL`——不知道该用哪个语言的字典，本轮不处理，
    /// 保持 `pending`。
    pub skipped_no_lang: u32,
    /// `lang` 有值，但这个语言完全没有可用字典（不在 UIGF 短码表里，或
    /// 远端下载与本地缓存都失败）——保持 `pending`。
    pub skipped_no_dictionary: u32,
}

impl BackfillOutcome {
    fn merge(&mut self, other: &BackfillOutcome) {
        self.resolved += other.resolved;
        self.still_pending += other.still_pending;
        self.skipped_no_lang += other.skipped_no_lang;
        self.skipped_no_dictionary += other.skipped_no_dictionary;
    }
}

/// 用一份已经拿到的字典（对应某个 `lang`）反查 `records` 里语言匹配的那些
/// 记录，写回 `repo`。不属于该 `lang` 的记录原样跳过（由调用方在下一轮用
/// 另一份字典处理，或最终归进 `skipped_no_dictionary`）。
///
/// 拆成独立函数（不内联进某个大编排循环）是为了能脱离真实网络/QuickJS，
/// 只用一份手造的小字典单独测试"给定字典 + 待处理记录，落库结果对不对"
/// 这条本模块真正有判断分支的核心业务逻辑。
///
/// `record.item_id` 目前存的是"待反查的 name"（`itemIdSource: "displayName"`
/// 场景下，`fields.extractRecord` 把本地化物品名填进了 `itemId`）——反查
/// 成功后：
/// 1. `repo.resolve_pending_record_item_id` 把它替换成真正的 `item_id`，
///    `meta_state` 推进到 `complete`；
/// 2. `repo.upsert_item_catalog` 把反查用到的那个 name（记录里原来的
///    `item_id` 值）连同记录本来就有的 `rarity`/`item_type` 一并写进
///    `item_catalog`——这两个字段米哈游 API 本身就会返回，不需要字典提供
///    （只有 `item_id` 本身是假的），见 `plugins/genshin/manifest.ts`
///    `extractRecord` 内的说明。
pub fn apply_dictionary_to_records(
    repo: &Repository<'_>,
    plugin_id: &str,
    lang: &str,
    dictionary: &HashMap<String, String>,
    records: &[GachaRecord],
    data_ver: i64,
) -> Result<BackfillOutcome, GsError> {
    let mut outcome = BackfillOutcome {
        plugin_id: plugin_id.to_string(),
        ..Default::default()
    };
    for record in records {
        if record.lang.as_deref() != Some(lang) {
            continue;
        }
        let Some(resolved_item_id) = dictionary.get(&record.item_id) else {
            outcome.still_pending += 1;
            continue;
        };
        repo.resolve_pending_record_item_id(record.id, resolved_item_id)?;
        repo.upsert_item_catalog(&NewItemCatalogEntry {
            plugin_id: plugin_id.to_string(),
            item_id: resolved_item_id.clone(),
            lang: lang.to_string(),
            name: record.item_id.clone(),
            rarity: record.rarity.clone(),
            item_type: record.item_type.clone(),
            icon_url: None,
            data_ver,
        })?;
        outcome.resolved += 1;
    }
    Ok(outcome)
}

/// `records` 里出现过的、按字典序去重排列的全部 `lang` 取值——回填编排的
/// 第一步："这批 pending 记录一共涉及哪些语言，需要为每种语言各拿一份
/// 字典"。排序只是为了让调用方（以及本模块的测试）拿到确定性的顺序，不
/// 依赖 `HashSet` 的遍历顺序。
pub fn distinct_langs(records: &[GachaRecord]) -> Vec<String> {
    let mut langs: Vec<String> = records
        .iter()
        .filter_map(|record| record.lang.clone())
        .collect();
    langs.sort_unstable();
    langs.dedup();
    langs
}

/// 组合 [`dictionary_request_url`] 与 [`uigf_lang_short_code`] 两个内部
/// 细节，供 `src-tauri/src/commands.rs` 的编排循环调用——命令层只需要知道
/// "给我这个语言的请求 URL"，不需要关心短码转换表这个实现细节。
pub fn build_dictionary_request_url(
    template: &RequestTemplate,
    canonical_lang: &str,
) -> Option<String> {
    dictionary_request_url(template, canonical_lang)
}

/// `records` 里 `lang` 为 `None` 的条数——编排循环用它累加
/// [`BackfillOutcome::skipped_no_lang`]。
pub fn count_records_without_lang(records: &[GachaRecord]) -> u32 {
    records
        .iter()
        .filter(|record| record.lang.is_none())
        .count() as u32
}

/// 把某个语言"没有可用字典"（`dictionary_request_url` 返回 `None`，或
/// 网络下载与本地缓存都失败）这一事实，累加进 `outcome.skipped_no_dictionary`
/// ——`records` 中语言匹配 `lang` 的那些记录全部计入这一桶。
pub fn account_missing_dictionary(
    outcome: &mut BackfillOutcome,
    lang: &str,
    records: &[GachaRecord],
) {
    let count = records
        .iter()
        .filter(|record| record.lang.as_deref() == Some(lang))
        .count() as u32;
    outcome.skipped_no_dictionary += count;
}

/// 把多个语言各自算出的 [`BackfillOutcome`] 合并成一份汇总，供调用方一次性
/// 拿到某个插件的整体回填结果。`skipped_no_lang` 只在合并入口累加一次
/// （见调用方），不属于任何一份按语言拆分的 outcome。
pub fn merge_outcomes(
    plugin_id: &str,
    skipped_no_lang: u32,
    per_lang: &[BackfillOutcome],
) -> BackfillOutcome {
    let mut total = BackfillOutcome {
        plugin_id: plugin_id.to_string(),
        skipped_no_lang,
        ..Default::default()
    };
    for outcome in per_lang {
        total.merge(outcome);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::Cursor;
    use std::path::PathBuf;

    fn temp_cache_root(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "gs-host-metadata-backfill-{label}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn genshin_request_template() -> RequestTemplate {
        RequestTemplate {
            url: "https://api.uigf.org/dict/genshin/{{lang}}.json".to_string(),
            method: None,
            headers: None,
            body: None,
        }
    }

    fn sample_record(id: i64, lang: Option<&str>, item_id: &str) -> GachaRecord {
        GachaRecord {
            id,
            account_id: 1,
            banner_key: "301".to_string(),
            pity_group: "characterEventWish".to_string(),
            record_key: gs_core::RecordKey::new(format!("rk-{id}")).unwrap(),
            lang: lang.map(str::to_string),
            occurred_at: 1_754_800_000_000,
            occurred_raw: "2026-08-10 12:00:00".to_string(),
            tz_origin: gs_core::TzOrigin::Assumed,
            tz_offset_min: None,
            seq_in_batch: None,
            item_id: item_id.to_string(),
            item_type: Some("weapon".to_string()),
            rarity: Some("3".to_string()),
            qty: 1,
            meta_state: gs_core::MetaState::Pending,
            source: gs_core::RecordSource::Import,
            captured_at: 1_754_800_000_000,
            raw_ref: None,
            extra: None,
            stable_id: None,
            gacha_id: None,
        }
    }

    // ---------------------------------------------------------------
    // dictionary_request_url / uigf_lang_short_code
    // ---------------------------------------------------------------

    #[test]
    fn dictionary_request_url_substitutes_uigf_short_code_for_canonical_lang() {
        let url = dictionary_request_url(&genshin_request_template(), "zh-cn")
            .expect("zh-cn 应当能映射出 URL");
        assert_eq!(url, "https://api.uigf.org/dict/genshin/chs.json");

        let url = dictionary_request_url(&genshin_request_template(), "en-us")
            .expect("en-us 应当能映射出 URL");
        assert_eq!(url, "https://api.uigf.org/dict/genshin/en.json");
    }

    #[test]
    fn dictionary_request_url_returns_none_for_unmapped_lang() {
        assert_eq!(
            dictionary_request_url(&genshin_request_template(), "klingon"),
            None,
            "UIGF 短码表里没有的语言应当 fail closed，不拼一个大概率 404 的 URL"
        );
    }

    #[test]
    fn dictionary_request_url_rejects_non_https_template() {
        let mut template = genshin_request_template();
        template.url = "http://api.uigf.org/dict/genshin/{{lang}}.json".to_string();
        assert_eq!(dictionary_request_url(&template, "zh-cn"), None);
    }

    #[test]
    fn dictionary_request_url_rejects_post_method() {
        let mut template = genshin_request_template();
        template.method = Some(HttpMethod::Post);
        assert_eq!(
            dictionary_request_url(&template, "zh-cn"),
            None,
            "本模块只支持 GET，声明 POST 的插件应当被拒绝，不是静默当 GET 处理"
        );
    }

    // ---------------------------------------------------------------
    // fetch_dictionary_bytes：假 fetcher，快速、不联网
    // ---------------------------------------------------------------

    struct FakeFetcher {
        call_count: Cell<u32>,
        outcomes: Vec<Result<(bool, Vec<u8>), String>>,
    }

    impl FakeFetcher {
        fn sequence(outcomes: Vec<Result<(bool, Vec<u8>), String>>) -> Self {
            Self {
                call_count: Cell::new(0),
                outcomes,
            }
        }

        fn always_success(bytes: Vec<u8>) -> Self {
            Self::sequence(vec![Ok((true, bytes))])
        }
    }

    impl DictionaryFetcher for FakeFetcher {
        fn fetch(&self, _url: &str) -> Result<FetchOutcome, String> {
            let index = self.call_count.get() as usize;
            self.call_count.set(self.call_count.get() + 1);
            // 序列用完后重复最后一项——重试测试只需要精确控制前几次调用。
            let entry = self
                .outcomes
                .get(index)
                .or_else(|| self.outcomes.last())
                .expect("测试序列不应为空");
            match entry {
                Ok((success, bytes)) => Ok(FetchOutcome {
                    success: *success,
                    body: Box::new(Cursor::new(bytes.clone())),
                }),
                Err(message) => Err(message.clone()),
            }
        }
    }

    #[test]
    fn fetch_dictionary_bytes_returns_body_on_first_success() {
        let fetcher = FakeFetcher::always_success(b"{\"a\":1}".to_vec());
        let bytes = fetch_dictionary_bytes("https://example.com/dict.json", &fetcher, 2);
        assert_eq!(bytes, Some(b"{\"a\":1}".to_vec()));
        assert_eq!(fetcher.call_count.get(), 1, "首次成功不应当触发重试");
    }

    #[test]
    fn fetch_dictionary_bytes_retries_after_a_failure_then_succeeds() {
        let fetcher = FakeFetcher::sequence(vec![
            Err("connection reset".to_string()),
            Ok((true, b"{\"a\":1}".to_vec())),
        ]);
        let bytes = fetch_dictionary_bytes("https://example.com/dict.json", &fetcher, 2);
        assert_eq!(bytes, Some(b"{\"a\":1}".to_vec()));
        assert_eq!(fetcher.call_count.get(), 2, "第一次失败后应当重试一次");
    }

    #[test]
    fn fetch_dictionary_bytes_gives_up_after_max_attempts_exhausted() {
        let fetcher = FakeFetcher::sequence(vec![Err("connection reset".to_string())]);
        let bytes = fetch_dictionary_bytes("https://example.com/dict.json", &fetcher, 2);
        assert_eq!(bytes, None);
        assert_eq!(fetcher.call_count.get(), 2, "耗尽重试次数后应当放弃");
    }

    #[test]
    fn fetch_dictionary_bytes_treats_http_error_status_as_failure() {
        // success=false 模拟 HTTP 4xx/5xx。
        let fetcher = FakeFetcher::sequence(vec![Ok((false, Vec::new()))]);
        let bytes = fetch_dictionary_bytes("https://example.com/dict.json", &fetcher, 1);
        assert_eq!(bytes, None);
    }

    #[test]
    fn fetch_dictionary_bytes_rejects_non_https_url_without_calling_fetcher() {
        let fetcher = FakeFetcher::always_success(b"{}".to_vec());
        let bytes = fetch_dictionary_bytes("http://example.com/dict.json", &fetcher, 2);
        assert_eq!(bytes, None);
        assert_eq!(
            fetcher.call_count.get(),
            0,
            "http 协议应当在发请求之前就被拒绝"
        );
    }

    #[test]
    fn fetch_dictionary_bytes_rejects_body_larger_than_cap() {
        let oversized = vec![b'x'; MAX_DICT_BYTES + 1];
        let fetcher = FakeFetcher::always_success(oversized);
        let bytes = fetch_dictionary_bytes("https://example.com/dict.json", &fetcher, 1);
        assert_eq!(bytes, None);
    }

    // ---------------------------------------------------------------
    // 真实 HTTP 实现：不联网也要覆盖真实代码路径（不可达地址）
    // ---------------------------------------------------------------

    #[test]
    fn reqwest_dictionary_fetcher_fails_gracefully_against_unreachable_address() {
        // 与 icon_cache 的教训一致：假 fetcher 能保证单测快速、不联网，
        // 但如果真实的 ReqwestDictionaryFetcher 从未被任何测试执行过，
        // 一个"图标功能上线即 100% 失效但测试全绿"式的缺陷可以在这里同样
        // 发生而不被发现。用 127.0.0.1:1（几乎不可能有服务监听、连接立即
        // 被拒绝）确定性地触发真实代码路径，断言"优雅失败而不是 panic"，
        // 不依赖外部网络可用性。
        let bytes = fetch_dictionary_bytes(
            "https://127.0.0.1:1/unreachable.json",
            &ReqwestDictionaryFetcher,
            1,
        );
        assert_eq!(
            bytes, None,
            "不可达地址应当优雅返回 None，不应当 panic 或挂起"
        );
    }

    // ---------------------------------------------------------------
    // 缓存读写
    // ---------------------------------------------------------------

    #[test]
    fn save_then_load_cached_dictionary_round_trips() {
        let cache_root = temp_cache_root("round-trip");
        let mut dict = HashMap::new();
        dict.insert("无锋剑".to_string(), "11101".to_string());

        save_cached_dictionary(&cache_root, "genshin", "zh-cn", &dict).expect("写入应当成功");
        let loaded = load_cached_dictionary(&cache_root, "genshin", "zh-cn").expect("应当命中缓存");
        assert_eq!(loaded, dict);

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn load_cached_dictionary_returns_none_when_cache_file_absent() {
        let cache_root = temp_cache_root("missing");
        assert_eq!(
            load_cached_dictionary(&cache_root, "genshin", "zh-cn"),
            None
        );
    }

    #[test]
    fn load_cached_dictionary_returns_none_for_corrupted_cache_file() {
        let cache_root = temp_cache_root("corrupted");
        let dir = cache_root.join("metadata");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("genshin-zh-cn.json"), b"not json").unwrap();

        assert_eq!(
            load_cached_dictionary(&cache_root, "genshin", "zh-cn"),
            None
        );
        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn save_cached_dictionary_rejects_path_unsafe_plugin_id_or_lang() {
        let cache_root = temp_cache_root("reject-unsafe");
        let dict = HashMap::new();

        assert!(save_cached_dictionary(&cache_root, "../escape", "zh-cn", &dict).is_err());
        assert!(save_cached_dictionary(&cache_root, "genshin", "../escape", &dict).is_err());
        assert!(
            fs::read_dir(&cache_root).is_err(),
            "拒绝路径不安全的输入不应当创建任何目录"
        );
    }

    // ---------------------------------------------------------------
    // apply_dictionary_to_records：真实 Repository，内存数据库
    // ---------------------------------------------------------------

    fn setup_account(repo: &Repository<'_>, plugin_id: &str) -> i64 {
        repo.create_account(&gs_storage::NewAccount {
            plugin_id: plugin_id.to_string(),
            game_uid: "100000001".to_string(),
            region: "official".to_string(),
            display_name: None,
            retention_days: None,
            created_at: 1_754_800_000_000,
        })
        .expect("创建账号应当成功")
    }

    #[test]
    fn apply_dictionary_to_records_resolves_matching_names_and_leaves_others_pending() {
        let storage = gs_storage::Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let account_id = setup_account(&repo, "genshin");

        let mut resolvable = sample_record(1, Some("zh-cn"), "无锋剑");
        resolvable.account_id = account_id;
        let mut not_in_dict = sample_record(2, Some("zh-cn"), "查无此名");
        not_in_dict.account_id = account_id;
        let mut other_lang = sample_record(3, Some("en-us"), "Sharpshooter's Oath");
        other_lang.account_id = account_id;

        repo.insert_records(&[resolvable, not_in_dict, other_lang])
            .expect("写入应当成功");
        let pending = repo
            .find_pending_records_by_plugin("genshin")
            .expect("查询应当成功");
        assert_eq!(pending.len(), 3);

        let mut dictionary = HashMap::new();
        dictionary.insert("无锋剑".to_string(), "11101".to_string());

        let outcome =
            apply_dictionary_to_records(&repo, "genshin", "zh-cn", &dictionary, &pending, 42)
                .expect("回填应当成功");

        assert_eq!(
            outcome.resolved, 1,
            "只有 zh-cn 且在字典里命中的那一条应当被回填"
        );
        assert_eq!(
            outcome.still_pending, 1,
            "zh-cn 但字典查不到的那一条应当保持 pending 计数"
        );
        assert_eq!(
            outcome.skipped_no_lang, 0,
            "本函数不负责统计 no_lang，那是调用方的职责"
        );
        assert_eq!(outcome.skipped_no_dictionary, 0);

        let remaining_pending = repo
            .find_pending_records_by_plugin("genshin")
            .expect("查询应当成功");
        assert_eq!(
            remaining_pending.len(),
            2,
            "en-us 那条（未处理）与 zh-cn 未命中那条应当仍然是 pending"
        );

        let catalog_entry = repo
            .find_item_catalog_entry("genshin", "11101", "zh-cn")
            .expect("查询应当成功")
            .expect("应当已经写入 item_catalog");
        assert_eq!(catalog_entry.name, "无锋剑");
        assert_eq!(catalog_entry.data_ver, 42);
    }

    #[test]
    fn apply_dictionary_to_records_does_not_write_guessed_values_when_dictionary_is_empty() {
        let storage = gs_storage::Storage::open_in_memory().expect("应当能打开内存数据库");
        let repo = storage.repository();
        let account_id = setup_account(&repo, "genshin");
        let mut record = sample_record(0, Some("zh-cn"), "无锋剑");
        record.account_id = account_id;
        repo.insert_records(&[record]).expect("写入应当成功");
        let pending = repo
            .find_pending_records_by_plugin("genshin")
            .expect("查询应当成功");

        let outcome =
            apply_dictionary_to_records(&repo, "genshin", "zh-cn", &HashMap::new(), &pending, 1)
                .expect("空字典不应当报错");

        assert_eq!(outcome.resolved, 0);
        assert_eq!(outcome.still_pending, 1);
        assert_eq!(
            repo.find_pending_records_by_plugin("genshin")
                .expect("查询应当成功")
                .len(),
            1,
            "查不到就必须保持 pending，不能写入猜测值"
        );
    }

    // ---------------------------------------------------------------
    // distinct_langs / count_records_without_lang / merge_outcomes
    // ---------------------------------------------------------------

    #[test]
    fn distinct_langs_dedupes_and_sorts_ignoring_none() {
        let records = vec![
            sample_record(1, Some("zh-cn"), "a"),
            sample_record(2, None, "b"),
            sample_record(3, Some("en-us"), "c"),
            sample_record(4, Some("zh-cn"), "d"),
        ];
        assert_eq!(
            distinct_langs(&records),
            vec!["en-us".to_string(), "zh-cn".to_string()]
        );
    }

    #[test]
    fn count_records_without_lang_counts_only_none() {
        let records = vec![
            sample_record(1, Some("zh-cn"), "a"),
            sample_record(2, None, "b"),
            sample_record(3, None, "c"),
        ];
        assert_eq!(count_records_without_lang(&records), 2);
    }

    #[test]
    fn account_missing_dictionary_counts_only_records_matching_that_lang() {
        let records = vec![
            sample_record(1, Some("zh-cn"), "a"),
            sample_record(2, Some("en-us"), "b"),
            sample_record(3, Some("zh-cn"), "c"),
        ];
        let mut outcome = BackfillOutcome::default();
        account_missing_dictionary(&mut outcome, "zh-cn", &records);
        assert_eq!(outcome.skipped_no_dictionary, 2);
    }

    #[test]
    fn merge_outcomes_sums_every_bucket_across_languages_and_adds_no_lang_once() {
        let zh = BackfillOutcome {
            plugin_id: "genshin".to_string(),
            resolved: 3,
            still_pending: 1,
            skipped_no_lang: 0,
            skipped_no_dictionary: 0,
        };
        let en = BackfillOutcome {
            plugin_id: "genshin".to_string(),
            resolved: 2,
            still_pending: 0,
            skipped_no_lang: 0,
            skipped_no_dictionary: 5,
        };
        let total = merge_outcomes("genshin", 7, &[zh, en]);
        assert_eq!(
            total,
            BackfillOutcome {
                plugin_id: "genshin".to_string(),
                resolved: 5,
                still_pending: 1,
                skipped_no_lang: 7,
                skipped_no_dictionary: 5,
            }
        );
    }

    // ---------------------------------------------------------------
    // parse_dictionary_via_plugin：真实 PluginRuntime（真正执行 genshin
    // 打包进 QuickJS 的 parseUigfDictResponse，不是测试自己模拟它的行为）
    // ---------------------------------------------------------------

    #[test]
    fn parse_dictionary_via_plugin_runs_the_real_genshin_parse_response_hook() {
        let plugin_runtime = PluginRuntime::new().expect("应当能构造 QuickJS 运行时");
        let response = r#"{"无锋剑": 11101, "胡桃": 10000046}"#.as_bytes();

        let dictionary = parse_dictionary_via_plugin(&plugin_runtime, "genshin", response)
            .expect("真实的 genshin metadata.parseResponse 应当能解析出字典");

        assert_eq!(dictionary.get("无锋剑"), Some(&"11101".to_string()));
        assert_eq!(dictionary.get("胡桃"), Some(&"10000046".to_string()));
    }

    #[test]
    fn parse_dictionary_via_plugin_returns_none_for_malformed_json() {
        let plugin_runtime = PluginRuntime::new().expect("应当能构造 QuickJS 运行时");
        assert_eq!(
            parse_dictionary_via_plugin(&plugin_runtime, "genshin", b"not json"),
            None
        );
    }

    #[test]
    fn parse_dictionary_via_plugin_returns_none_when_plugin_has_no_metadata_hook() {
        // starrail 没有声明 metadata Provider（本轮范围裁定：builtin 只做
        // 机制，不填数据，因此不在任何插件 manifest 里声明），调用它的
        // parseResponse 路径应当失败并返回 None，不是 panic。
        let plugin_runtime = PluginRuntime::new().expect("应当能构造 QuickJS 运行时");
        assert_eq!(
            parse_dictionary_via_plugin(&plugin_runtime, "starrail", b"{}"),
            None
        );
    }
}
