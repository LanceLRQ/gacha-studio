//! L0 原子能力：`data_2` Chromium 磁盘缓存扫描。
//!
//! 三步语义（`docs/_internal/research/04-同族工具三方源码对比.md` §三）：
//! 1. 按 `mtime` **降序**取**最新的一个** `data_2` 文件——不是"扫描文件内容
//!    找最新的一行"；
//! 2. 对该文件做**全文**读取，用插件声明的 `urlPattern` 做**全局**匹配；
//! 3. 取匹配数组的**最后一个元素**——不是第一个，也不是"看起来最长的那个"。
//!
//! `game_dir` 声明的是相对片段（如 `"YuanShen_Data/webCaches"`），真实的
//! Chromium 缓存目录在其下还可能再套一层版本/账号子目录，因此候选路径是：
//!
//! ```text
//! <install_root>/<game_dir_fragment>/Cache/Cache_Data/data_2
//! <install_root>/<game_dir_fragment>/*/Cache/Cache_Data/data_2   （恰好一层子目录）
//! ```
//!
//! 对应 SDK 契约里 `webCaches{/,/*/}Cache/Cache_Data/data_2` 这个 glob 写法。
//! 不引入 `glob` crate——候选形态只有这两种，`std::fs::read_dir` 手写更直接，
//! 也更容易在测试里断言"恰好考虑了这两层，不多不少"。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use regex::Regex;

/// game_id → 用户配置的游戏安装根目录。
///
/// ⚠️ **这是本 Stage 一处明确的偏差，记在这里而不是藏在实现细节里**：
/// SDK 设计原文的窄口签名是 `scanGameCache(gameId)`，隐含"game_id → 安装
/// 根目录"这层解析已经由宿主的持久化配置完成。但那份配置存储（用户在设置
/// 页选择的游戏安装目录）属于 `crates/gs-storage` 的 schema 范畴，而
/// `gs-storage/**` 不在本 Stage 的改动范围内（另有归属）。
///
/// 处理方式：把"game_id → install_root"的解析做成一个注入的 trait，而不是
/// 在这里假装有一个不存在的全局配置表可查。`scan_game_cache` 对外仍然是
/// `game_id` 优先的窄口形态（调用方给标识符，不给路径），只是"标识符怎么
/// 换成路径"这一步被显式地推给了调用方提供的实现——真正的持久化实现由
/// gs-host 落地存储配置时补上，语义不变。
///
/// 这不影响 HC-2 想防的事：插件（TS）代码永远不会拿到、也无法构造这个
/// trait 的实例或调用它——它只存在于 Rust 内部的采集编排路径上。
pub trait InstalledGameLocator {
    /// 返回 `game_id` 对应的游戏安装根目录；未配置/未找到时返回 `None`。
    fn install_root(&self, game_id: &str) -> Option<PathBuf>;
}

/// 内存实现，测试与"配置已经读进内存"的简单场景直接用。
#[derive(Debug, Default, Clone)]
pub struct StaticGameLocator(HashMap<String, PathBuf>);

impl StaticGameLocator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_install_root(
        mut self,
        game_id: impl Into<String>,
        root: impl Into<PathBuf>,
    ) -> Self {
        self.0.insert(game_id.into(), root.into());
        self
    }
}

impl InstalledGameLocator for StaticGameLocator {
    fn install_root(&self, game_id: &str) -> Option<PathBuf> {
        self.0.get(game_id).cloned()
    }
}

#[derive(Debug)]
pub enum CacheScanError {
    /// `game_id` 未在 [`InstalledGameLocator`] 里配置安装目录。
    GameNotInstalled { game_id: String },
    /// 定位到的 `data_2` 文件读取失败（权限问题、文件被游戏进程独占等）。
    Io { path: PathBuf, detail: String },
}

impl std::fmt::Display for CacheScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GameNotInstalled { game_id } => {
                write!(f, "游戏 \"{game_id}\" 尚未在宿主配置里登记安装目录")
            }
            Self::Io { path, detail } => {
                write!(f, "读取缓存文件 \"{}\" 失败：{detail}", path.display())
            }
        }
    }
}

impl std::error::Error for CacheScanError {}

/// 在 `install_root/game_dir_fragment` 下枚举全部候选 `data_2` 文件（含直接
/// 一层子目录），不做 mtime 排序——排序是下一步 [`pick_latest_data2_file`]
/// 的职责，拆开两步是为了让"按 mtime 取最新"这条语义能被单独测试断言，
/// 不必每次都连着"文件系统枚举"一起验证。
pub fn locate_data2_candidates(install_root: &Path, game_dir_fragment: &str) -> Vec<PathBuf> {
    let web_caches_dir = install_root.join(game_dir_fragment);
    let mut candidates = Vec::new();

    let direct = web_caches_dir.join("Cache/Cache_Data/data_2");
    if direct.is_file() {
        candidates.push(direct);
    }

    let Ok(entries) = fs::read_dir(&web_caches_dir) else {
        return candidates;
    };
    for entry in entries.flatten() {
        let sub_path = entry.path();
        if !sub_path.is_dir() {
            continue;
        }
        let nested = sub_path.join("Cache/Cache_Data/data_2");
        if nested.is_file() {
            candidates.push(nested);
        }
    }
    candidates
}

/// 按 `mtime` 降序取最新的一个文件；`mtime` 读取失败的候选直接跳过而不是
/// 让整次扫描失败——一个损坏的候选不该拖垮"还有其他候选可用"这件事。
pub fn pick_latest_data2_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .filter_map(|path| file_mtime(path).map(|mtime| (mtime, path.clone())))
        .max_by_key(|(mtime, _)| *mtime)
        .map(|(_, path)| path)
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

/// URL 中允许出现的字符集合（够用即可，不追求完整 RFC 3986 pchar）：
/// 字母数字 + 常见 query string 标点。用于 [`tighten_url_match`] 截断
/// 正则贪婪匹配可能吞入的垃圾字节。
fn is_url_safe_char(c: char) -> bool {
    c.is_ascii_alphanumeric()
        || matches!(
            c,
            ':' | '/' | '?' | '&' | '=' | '.' | '_' | '%' | '~' | '+' | ',' | ';' | '-' | '#' | '@'
        )
}

/// ⚠️ **`urlPattern` 边界处理**：manifest 声明的 `urlPattern` 形如
/// `https:\/\/.+?getGachaLog[^"]+`，结尾 `[^"]+` 依赖"后续存在字面引号"
/// 才会收敛。`data_2` 是二进制缓存索引，不保证 URL 后紧跟 `"`——真实场景里
/// 紧跟的可能是 NUL 字节或其他缓存条目的垃圾字节，若不处理，一次贪婪匹配
/// 会把这些字节甚至下一条 URL 一并吞进同一条匹配。
///
/// 处理方式：正则先照常执行（尊重插件声明的模式，不代替插件决定"用什么
/// 特征识别 URL"），拿到匹配结果后再做一次"取最长合法 URL 字符前缀"的收紧。
/// 这不改变匹配的起点，只收紧终点——插件的模式仍然决定"从哪里开始算一个
/// URL"，Rust 只负责不让它在没有天然终止符的输入上失控。
fn tighten_url_match(raw: &str) -> &str {
    let end = raw
        .find(|c: char| !is_url_safe_char(c))
        .unwrap_or(raw.len());
    &raw[..end]
}

/// 对缓存文件的全文内容执行 `url_pattern` 的全局匹配，取**最后一个**匹配、
/// 并对其做 [`tighten_url_match`] 收紧。
///
/// ★ 决策记录（本 Stage 要求显式记录，不允许悄悄照抄三方实现却不做判断）：
/// **取值方式：取全局匹配数组的最后一个元素，不改用 `timestamp=` 参数比较
/// 取最大。**
///
/// 三个参考实现（genshin-wish-export / star-rail-warp-export /
/// zzz-signal-search-export）都留了一段"改用 URL 里 `timestamp=` 参数比较
/// 取最大"的注释代码，但从未启用——`star-rail-warp-export/src/main/
/// getData.js:128-142` 的函数体主逻辑就是 `list[list.length - 1]`，下面
/// 11 行整段注释掉。三家共享同一份代码血缘，都写了这段备选逻辑又都没启用，
/// 说明作者判断"数组最后一个"已经够用，或者权衡后放弃了更复杂的方案（`data_2`
/// 缓存索引的条目是**按写入顺序追加**的，最后一个正则匹配命中的 URL 就是
/// 最近一次实际发起的请求，不需要再解析 `timestamp=` 参数比较大小）。
///
/// 本实现**维持"取最后一个匹配"**：
/// - 与三方实测行为一致，不引入三方自己都没敢用的复杂度；
/// - `timestamp=` 是查询参数之一，值本身还要再做一次字符串→数值解析和比较，
///   多一次可能失败的转换，却没有实证证明它比"数组顺序"更可靠；
/// - 若未来某个游戏的缓存条目不保证按写入顺序排列（本 Stage 没有观测到这类
///   反例），再针对那个具体游戏引入 `timestamp=` 比较，而不是现在为假设中的
///   问题预先复杂化所有游戏共用的这段范式代码。
pub fn extract_credential_url(content: &str, url_pattern: &Regex) -> Option<String> {
    // `regex::Matches` 不是 `DoubleEndedIterator`（匹配的产出方式决定了它
    // 只能顺序前进），用 `Iterator::last()` 取最后一个匹配——单次线性扫描，
    // 不需要先收集成 `Vec` 再倒着取。
    let last_match = url_pattern.find_iter(content).last()?;
    let tightened = tighten_url_match(last_match.as_str());
    if tightened.is_empty() {
        None
    } else {
        Some(tightened.to_string())
    }
}

/// 组合三步语义的窄口入口。
///
/// ⚠️ 参数是 `game_id`，不是路径——窄口的参数必须是标识符，传路径就等于
/// `readFile(anyPath)` 的变体，窄口形同虚设。绝对路径由 `locator` 解析
/// （见 [`InstalledGameLocator`] 文档关于本 Stage 偏差的说明），`game_dir`
/// 与 `url_pattern` 来自插件 manifest 的纯数据声明（`credential.gameDir` /
/// `credential.urlPattern`），插件全程不会看到、也无法构造 `install_root`。
pub fn scan_game_cache(
    game_id: &str,
    game_dir_fragment: &str,
    url_pattern: &Regex,
    locator: &dyn InstalledGameLocator,
) -> Result<Option<String>, CacheScanError> {
    let Some(install_root) = locator.install_root(game_id) else {
        return Err(CacheScanError::GameNotInstalled {
            game_id: game_id.to_string(),
        });
    };

    let candidates = locate_data2_candidates(&install_root, game_dir_fragment);
    let Some(latest_file) = pick_latest_data2_file(&candidates) else {
        return Ok(None);
    };

    let content = fs::read_to_string(&latest_file).map_err(|err| CacheScanError::Io {
        path: latest_file.clone(),
        detail: err.to_string(),
    })?;

    Ok(extract_credential_url(&content, url_pattern))
}

/// 从凭据 URL 的查询字符串里取出某个参数的值。用于 `lang`——
/// `gacha_record.lang` 不来自插件产出的字段，而应由宿主从采集会话上下文
/// （authkey URL 本身带的 `&lang=zh-cn`）取得，见 `pipeline.rs`。
///
/// 只做最基础的 `key=value`（以 `&`/`?` 分隔）解析，不处理百分号解码——
/// `lang` 这类枚举值实测不会出现需要解码的字符，硬上一个 URL 解码器换不来
/// 实际价值。
pub fn extract_query_param(url: &str, key: &str) -> Option<String> {
    let query_start = url.find('?').map(|idx| idx + 1).unwrap_or(0);
    url[query_start..].split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then(|| v.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{Duration, SystemTime};

    fn touch_with_mtime(path: &Path, mtime: SystemTime) {
        fs::create_dir_all(path.parent().unwrap()).expect("创建父目录应当成功");
        fs::write(path, b"placeholder").expect("写入占位内容应当成功");
        set_file_mtime(path, mtime);
    }

    // 不引入 `filetime` crate——`std::fs::File::set_modified`（1.75 起稳定）
    // 已经足够设置测试用的 mtime。
    fn set_file_mtime(path: &Path, mtime: SystemTime) {
        let file = fs::File::options()
            .write(true)
            .open(path)
            .expect("应当能重新打开文件");
        file.set_modified(mtime).expect("应当能设置 mtime");
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "gs-p-authkey-test-{label}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            path.push(unique);
            fs::create_dir_all(&path).expect("创建临时目录应当成功");
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn locates_direct_and_one_level_nested_candidates() {
        let dir = TempDir::new("locate");
        let direct = dir.path().join("webCaches/Cache/Cache_Data/data_2");
        let nested = dir
            .path()
            .join("webCaches/2.3.0_abcdef/Cache/Cache_Data/data_2");
        let too_deep = dir
            .path()
            .join("webCaches/2.3.0/extra/Cache/Cache_Data/data_2");
        touch_with_mtime(&direct, SystemTime::now());
        touch_with_mtime(&nested, SystemTime::now());
        touch_with_mtime(&too_deep, SystemTime::now());

        let candidates = locate_data2_candidates(dir.path(), "webCaches");
        assert!(candidates.contains(&direct), "应当发现直接一层的 data_2");
        assert!(
            candidates.contains(&nested),
            "应当发现恰好一层子目录下的 data_2"
        );
        assert!(
            !candidates.contains(&too_deep),
            "两层子目录的 data_2 超出契约声明的 glob 形态，不应被发现"
        );
    }

    #[test]
    fn picks_latest_file_by_mtime_not_by_content() {
        let dir = TempDir::new("mtime");
        let older = dir.path().join("a/Cache/Cache_Data/data_2");
        let newer = dir.path().join("b/Cache/Cache_Data/data_2");
        let now = SystemTime::now();
        // 内容故意反过来：更旧的文件内容"看起来更新"，验证选择依据是 mtime
        // 而不是内容里的某种启发式。
        fs::create_dir_all(older.parent().unwrap()).unwrap();
        fs::write(&older, b"zzzz-looks-newer-but-is-not").unwrap();
        fs::create_dir_all(newer.parent().unwrap()).unwrap();
        fs::write(&newer, b"aaaa").unwrap();
        set_file_mtime(&older, now - Duration::from_secs(3600));
        set_file_mtime(&newer, now);

        let picked = pick_latest_data2_file(&[older.clone(), newer.clone()]);
        assert_eq!(picked, Some(newer));
    }

    fn genshin_url_pattern() -> Regex {
        Regex::new(r#"https://.+?getGachaLog[^"]+"#).expect("测试用正则应当合法")
    }

    #[test]
    fn extracts_last_match_when_quote_terminates_url() {
        let pattern = genshin_url_pattern();
        let content = concat!(
            "garbage\"https://a.example.com/getGachaLog?page=1\"garbage",
            "more\"https://a.example.com/getGachaLog?page=2\"tail",
        );
        let url = extract_credential_url(content, &pattern).expect("应当匹配到 URL");
        assert_eq!(url, "https://a.example.com/getGachaLog?page=2");
    }

    /// ⚠️ 边界回归：`[^"]+` 在没有终止引号时会贪婪吃到文件末尾。真实
    /// `data_2` 是二进制缓存索引，不保证 URL 后紧跟引号——这条用例故意
    /// 不给任何引号，且在"URL 结束"之后接一段包含空格与控制字符的垃圾，
    /// 验证 Rust 侧的收紧逻辑能在没有引号的输入上仍然收敛到合法 URL。
    #[test]
    fn tightens_greedy_match_when_no_closing_quote_exists() {
        let pattern = genshin_url_pattern();
        let mut content = String::from("prefix https://a.example.com/getGachaLog?page=1&size=6");
        content.push(' '); // 空格不是合法 URL 字符，应当在此截断
        content.push_str("binary garbage \0\0\0 more garbage until EOF, no quote anywhere");

        let url = extract_credential_url(&content, &pattern).expect("应当匹配到 URL");
        assert_eq!(url, "https://a.example.com/getGachaLog?page=1&size=6");
    }

    #[test]
    fn returns_none_when_pattern_does_not_match() {
        let pattern = genshin_url_pattern();
        assert_eq!(extract_credential_url("no url here at all", &pattern), None);
    }

    #[test]
    fn scan_game_cache_reports_not_installed_for_unknown_game_id() {
        let locator = StaticGameLocator::new();
        let pattern = genshin_url_pattern();
        let result = scan_game_cache("genshin", "webCaches", &pattern, &locator);
        assert!(matches!(
            result,
            Err(CacheScanError::GameNotInstalled { .. })
        ));
    }

    #[test]
    fn scan_game_cache_end_to_end_with_fixture_style_content() {
        let dir = TempDir::new("e2e");
        let data2 = dir.path().join("webCaches/Cache/Cache_Data/data_2");
        fs::create_dir_all(data2.parent().unwrap()).unwrap();
        fs::write(
            &data2,
            "\"https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=FAKE&lang=zh-cn&page=1\"",
        )
        .unwrap();

        let locator = StaticGameLocator::new().with_install_root("genshin", dir.path());
        let pattern = genshin_url_pattern();
        let url = scan_game_cache("genshin", "webCaches", &pattern, &locator)
            .expect("扫描不应报错")
            .expect("应当能取到凭据 URL");
        assert!(url.contains("authkey=FAKE"));
        assert_eq!(extract_query_param(&url, "lang"), Some("zh-cn".to_string()));
    }

    #[test]
    fn extract_query_param_finds_value_among_multiple_params() {
        let url = "https://x/y?authkey=abc&lang=zh-cn&page=1";
        assert_eq!(extract_query_param(url, "lang"), Some("zh-cn".to_string()));
        assert_eq!(extract_query_param(url, "page"), Some("1".to_string()));
        assert_eq!(extract_query_param(url, "missing"), None);
    }
}
