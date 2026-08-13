//! L0 原子能力：鸣潮 `Client.log` 混淆日志扫描。
//!
//! 与同目录 [`crate::cache_scan`]（原神 `data_2` 缓存扫描）是姊妹实现——
//! 两者都是 `CredentialSource` 判别联合的一个分支：`cache_scan` 处理
//! Chromium 磁盘缓存这类"按写入顺序追加的结构化二进制索引"，本模块处理
//! "按行追加写的混淆文本日志"。采集范式相同（定位候选文件 → 取最新 →
//! 正则提取凭据 URL），但"取最新"的机制不同，见
//! [`extract_credential_url_from_log`] 文档里与
//! [`crate::cache_scan::extract_credential_url`] 的对比说明。
//!
//! 三步语义（源码校准依据：`docs/example-projects/WWGachaExport/
//! WWGachaExport/ViewModels/Dialogs/UpdateGachaDataDialogViewModel.cs`）：
//! 1. 按 `mtime` **降序**取最新的一个日志文件——直接复用
//!    [`crate::cache_scan::pick_latest_data2_file`]（函数名带 `data2` 是
//!    历史命名，实现本身是对 `&[PathBuf]` 的泛用排序，不是 `data_2` 专属，
//!    因此不必另写一份）；
//! 2. 对文件全部字节做 [`LogDecodeSpec`] 声明的解混淆；
//! 3. 按行**倒序**扫描解混淆后的文本，取第一个匹配 `urlPattern` 的行内匹配。
//!
//! `log_path_fragment` 声明的是相对片段（插件会声明形如
//! `"Client/Saved/Logs/Client.log"`），真实安装目录在其下还可能再套一层
//! 启动器专属子目录，因此候选路径是：
//!
//! ```text
//! <install_root>/<log_path_fragment>
//! <install_root>/*/<log_path_fragment>   （恰好一层子目录）
//! ```
//!
//! 与 `cache_scan.rs` 完全对称的理由：源码校准确认鸣潮官方启动器与 WeGame
//! 启动器的目录布局恰好相差一层子目录（`UpdateGachaDataDialogViewModel.cs:
//! 66-67`：官方启动器多套一层 `Wuthering Waves Game/`，WeGame 直接是
//! `Client/Saved/Logs/Client.log`）。**这一层子目录的名字本身是游戏/发行
//! 渠道知识，绝不能硬编码进 Rust**——那正是本项目要防的"游戏知识泄进范式
//! 层"（判断标准见 `CLAUDE.local.md`："这段逻辑换一个游戏还成立吗？"这里
//! 答案是成立：任何游戏只要存在"官方/渠道服多套一层子目录"这种布局差异，
//! 这两种候选形态都能覆盖，Rust 侧不需要知道那层子目录具体叫什么）。同样
//! 不引入 `glob` crate，理由与 `cache_scan.rs` 顶部一致：候选形态只有两种，
//! `std::fs::read_dir` 手写比引入一个通用 glob 引擎更直接，也更容易在测试
//! 里断言"恰好考虑了这两层，不多不少"。

use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::cache_scan::{InstalledGameLocator, pick_latest_data2_file};

/// 日志混淆算法的**参数**声明。
///
/// 算法框架（异或、按字节自身值的奇偶分支）是通用能力，归 Rust（范式层）；
/// 具体参数（跳过几个字节、两个掩码分别是什么）是鸣潮专属的魔数，归 TS
/// 插件声明。"跳 3 字节、`0xA5`/`0xEF`"若写死在 Rust 里，下一个用同类型
/// 混淆但参数不同的游戏就必须改 Rust 主程序，直接违反"新游戏只改插件"这条
/// 核心目标。
///
/// 单变体判别联合是有意为之：解混淆是一个方案家族，`kind` 标签本身就是
/// manifest 里的文档——下一个游戏可能是滚动异或、RC4、甚至 base64，到那
/// 时候再加一个变体。**不要为了"将来可能有"提前加第二个变体**——占位判别
/// 联合分支能过类型检查、过所有门禁、被文档引用为设计依据，却永远跑不
/// 起来，比占位 crate 更阴险。
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "kind")]
pub enum LogDecodeSpec {
    /// 按字节自身值最低位分支的异或混淆。
    ///
    /// 源码校准（`UpdateGachaDataDialogViewModel.cs:115-126`）：
    /// - `skip_bytes`：跳过的字节是**丢弃不输出**，不是"原样保留只是不参与
    ///   异或"——源码 `decoded` 数组的长度是 `encrypted.Length - 3`，循环
    ///   从下标 3 开始读、写入 `decoded[i - 3]`，被跳过的前 3 个字节完全
    ///   不出现在解码结果里。
    /// - `mask_when_odd` / `mask_when_even`：分支条件是**字节自身值的奇偶
    ///   （即最低位）**，不是字节在文件中的下标——源码 `if ((b & 1) == 1)
    ///   b ^= 0xA5; else b ^= 0xEF;`，判断对象是刚读出来的字节值 `b`，与
    ///   这个字节此刻处在第几个位置无关。同一个字节值不管出现在哪个下标，
    ///   解码结果都相同——见测试 `decoding_is_independent_of_byte_position`。
    #[serde(rename = "xorByLowBit")]
    XorByLowBit {
        /// 解码前跳过的字节数；跳过的字节直接丢弃，不出现在输出里。
        #[serde(rename = "skipBytes")]
        skip_bytes: usize,
        /// 字节值为奇数（最低位为 1）时异或的掩码。
        #[serde(rename = "maskWhenOdd")]
        mask_when_odd: u8,
        /// 字节值为偶数（最低位为 0）时异或的掩码。
        #[serde(rename = "maskWhenEven")]
        mask_when_even: u8,
    },
}

/// 对整段字节执行 `spec` 声明的解混淆；`spec` 为 `None` 时原样返回——明文
/// 日志（未来某个游戏可能压根不混淆）不需要走这条分支。
pub fn decode_log_bytes(bytes: &[u8], spec: Option<&LogDecodeSpec>) -> Vec<u8> {
    let Some(spec) = spec else {
        return bytes.to_vec();
    };
    match spec {
        LogDecodeSpec::XorByLowBit {
            skip_bytes,
            mask_when_odd,
            mask_when_even,
        } => {
            // 用 `min` 夹到合法范围而不是提前判断返回：`skip_bytes` 等于
            // 或大于字节总长时，切片 `bytes[start..]` 自然产出空切片，不
            // panic；直接拿未夹紧的 `skip_bytes` 去切片才会越界 panic。
            let start = (*skip_bytes).min(bytes.len());
            bytes[start..]
                .iter()
                .map(|&b| {
                    if b & 1 == 1 {
                        b ^ *mask_when_odd
                    } else {
                        b ^ *mask_when_even
                    }
                })
                .collect()
        }
    }
}

/// 解混淆后转为文本。
///
/// **必须用 lossy 解码，不能用会返回 `Err`/panic 的严格解码**：日志是按
/// 字节流追加写的文件，读取时机若恰好落在游戏进程正在写入的中途，或者
/// `skip_bytes` 的截断点、文件本身被截断的位置恰好落在一个多字节 UTF-8
/// 字符中间，都会产出非法 UTF-8 字节序列。这种情况下"某一个字节坏了"不该
/// 让整次凭据提取失败——凭据 URL 大概率在文件更前面已经写完整的行里，
/// `from_utf8_lossy` 把坏字节序列替换成 U+FFFD 而不是整体返回 `Err`，后续
/// 按行扫描时坏字节所在的那一行至多匹配不到 URL，不影响其他行。
pub fn decode_log_text(bytes: &[u8], spec: Option<&LogDecodeSpec>) -> String {
    let decoded = decode_log_bytes(bytes, spec);
    String::from_utf8_lossy(&decoded).into_owned()
}

/// 在 `install_root` 下枚举全部候选日志文件（直接命中 + 恰好一层子目录），
/// 不做 mtime 排序——排序交给 [`crate::cache_scan::pick_latest_data2_file`]，
/// 拆开两步的理由与 `cache_scan.rs` 一致：让"按 mtime 取最新"这条语义可以
/// 脱离文件系统枚举单独测试。
pub fn locate_log_candidates(install_root: &Path, log_path_fragment: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    let direct = install_root.join(log_path_fragment);
    if direct.is_file() {
        candidates.push(direct);
    }

    let Ok(entries) = fs::read_dir(install_root) else {
        return candidates;
    };
    for entry in entries.flatten() {
        let sub_path = entry.path();
        if !sub_path.is_dir() {
            continue;
        }
        let nested = sub_path.join(log_path_fragment);
        if nested.is_file() {
            candidates.push(nested);
        }
    }
    candidates
}

/// 按行**倒序**扫描，取第一个匹配 `url_pattern` 的行内匹配。
///
/// ★ 与 [`crate::cache_scan::extract_credential_url`]（全局匹配取**最后
/// 一个**元素）语义不同、机制也不同——两者殊途同归，都是想要"取最新的那
/// 一条"，但依据的物理事实不一样，不要以为其中一个写错了：
/// - `data_2` 是 Chromium 磁盘缓存索引，条目按写入顺序追加在同一段连续
///   字节里，没有"行"这个概念，所以 `cache_scan` 对全文做一次全局匹配，
///   取匹配数组的最后一个元素；
/// - `Client.log` 是**按行**追加写的文本日志，每次打开抽卡记录页都会新增
///   一整行日志。参考源码（`UpdateGachaDataDialogViewModel.cs:129-138`）
///   按行倒序遍历、命中第一个匹配就 `break`——语义上等价于"正序遍历取
///   最后一个匹配"，但倒序 + 提前退出在真实日志（可能几万行）上不需要
///   扫描全文就能拿到结果，本实现保留同样的遍历方向。
///
/// 正则模式本身（`urlPattern`）由插件声明，这里不代替插件决定"用什么特征
/// 识别 URL"。鸣潮参考实现用的是
/// `(https?.*/aki/gacha/index\.html#/record[\?=&\w\-]+)`
/// （`UpdateGachaDataDialogViewModel.cs:132`），末尾字符类 `[\?=&\w\-]+`
/// 本身就是有界的（不含引号、空白等非 URL 特征字符），加上匹配天然被行
/// 边界（`\n`）截断，不存在 `cache_scan.rs` 里 `tighten_url_match` 要解决
/// 的"没有终止引号、贪婪吃到二进制垃圾字节"问题——`data_2` 是没有行概念的
/// 二进制缓存，`Client.log` 解混淆后是有行边界的文本，两者的失控风险不
/// 对等。因此这里**不复用** `tighten_url_match`：它是私有函数（未导出到
/// crate 内其他模块），且即便可复用，套用到一个本就有界、有天然行终止符
/// 的场景上也没有实证价值，反而会把"为什么这里也要收紧"这个问题留给后来
/// 者猜。若未来某个游戏声明的 `urlPattern` 确实会在没有终止符的情况下
/// 贪婪失控，应该在那个具体场景里针对性处理，而不是现在为假设中的问题
/// 预先复杂化这段范式代码。
pub fn extract_credential_url_from_log(text: &str, url_pattern: &Regex) -> Option<String> {
    text.lines()
        .rev()
        .find_map(|line| url_pattern.find(line).map(|m| m.as_str().to_string()))
}

/// 与 [`crate::cache_scan::CacheScanError`] 对称的本地错误类型。
///
/// `gs_core::error::GsError` 的文档明确写着"各 crate 在需要更细粒度的错误
/// 分类时，应在自己的模块内定义专属错误类型，并归并到这里，而不是让调用方
/// 直接感知内部实现细节"——日志扫描与缓存扫描的失败模式完全相同（配置
/// 缺失 vs. 文件 IO 失败是两种需要界面区别引导用户的失败），因此照搬
/// `CacheScanError` 的两个分支，不引入第三个变体，也不直接借用泛用的
/// `GsError`（它只有 `Storage`/`Validation` 两个笼统变体，无法表达"游戏
/// 未登记安装目录"这种更具体的语义）。
#[derive(Debug)]
pub enum LogScanError {
    /// `game_id` 未在 [`InstalledGameLocator`] 里配置安装目录。
    GameNotInstalled { game_id: String },
    /// 定位到的日志文件读取失败（权限问题、游戏进程独占写入等）。
    Io { path: PathBuf, detail: String },
}

impl std::fmt::Display for LogScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GameNotInstalled { game_id } => {
                write!(f, "游戏 \"{game_id}\" 尚未在宿主配置里登记安装目录")
            }
            Self::Io { path, detail } => {
                write!(f, "读取日志文件 \"{}\" 失败：{detail}", path.display())
            }
        }
    }
}

impl std::error::Error for LogScanError {}

/// 组合三步语义的窄口入口。
///
/// 参数顺序、`locator` 收尾的位置对齐 [`crate::cache_scan::scan_game_cache`]
/// （`game_id` 打头、`locator` 收尾，中间按"插件声明的静态参数在前、正则
/// 在后"分组），只在中间插入本模块特有的 `decode` 参数。
///
/// 参数是 `game_id` + 插件声明的相对片段，不是路径——窄口的参数必须是
/// 标识符，理由与 `cache_scan.rs` 一致：`scanGameLog(gameDir)` 换个名字
/// 就是 `readFile(anyPath)`，窄口形同虚设。绝对路径由 `locator` 解析。
pub fn scan_log_file(
    game_id: &str,
    log_path_fragment: &str,
    decode: Option<&LogDecodeSpec>,
    url_pattern: &Regex,
    locator: &dyn InstalledGameLocator,
) -> Result<Option<String>, LogScanError> {
    let Some(install_root) = locator.install_root(game_id) else {
        return Err(LogScanError::GameNotInstalled {
            game_id: game_id.to_string(),
        });
    };

    let candidates = locate_log_candidates(&install_root, log_path_fragment);
    let Some(latest_file) = pick_latest_data2_file(&candidates) else {
        return Ok(None);
    };

    let bytes = fs::read(&latest_file).map_err(|err| LogScanError::Io {
        path: latest_file.clone(),
        detail: err.to_string(),
    })?;

    let text = decode_log_text(&bytes, decode);
    Ok(extract_credential_url_from_log(&text, url_pattern))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache_scan::StaticGameLocator;
    use std::fs;
    use std::time::{Duration, SystemTime};

    // ---------- 解混淆 ----------

    fn symmetric_spec(mask: u8) -> LogDecodeSpec {
        LogDecodeSpec::XorByLowBit {
            skip_bytes: 0,
            mask_when_odd: mask,
            mask_when_even: mask,
        }
    }

    #[test]
    fn xor_round_trips_with_symmetric_mask() {
        // ⚠️ 刻意让 `mask_when_odd == mask_when_even`，不是鸣潮真实的
        // `0xA5`/`0xEF`：真实的两个掩码都是奇数（最低位为 1），异或奇数
        // 掩码必然翻转字节的奇偶。也就是说对同一批字节"用 decode 函数本身
        // 再解一次"时，函数看到的已经是奇偶翻转后的字节，会切到*另一个*
        // 分支——并不是任意两个不同掩码都能通过"调用两次同一个函数"抵消回
        // 原文。用相同掩码消除这个变量：此时无论走哪个分支，异或的都是
        // 同一个值，两次异或天然抵消，只单独验证"异或可逆"这一件事本身。
        // 真实掩码下两个分支各自的正确性由 `decodes_both_odd_and_even_branches`
        // 单独覆盖；真实掩码下端到端的往返由
        // `scan_log_file_end_to_end_decodes_and_extracts_latest_url` 覆盖
        // （该测试用手推的正确反函数构造 fixture，而不是简单复用 decode
        // 本身当 encode——两者并不等价，推导过程见该测试内注释）。
        let plaintext: Vec<u8> = vec![0x00, 0x01, 0x42, 0xFF, 0x7E];
        let spec = symmetric_spec(0x5A);
        let encoded = decode_log_bytes(&plaintext, Some(&spec));
        let decoded = decode_log_bytes(&encoded, Some(&spec));
        assert_eq!(decoded, plaintext);
    }

    #[test]
    fn decodes_both_odd_and_even_branches() {
        // 手算：0x01 是奇数，走 mask_when_odd；0x02 是偶数，走
        // mask_when_even。真实鸣潮参数 0xA5 / 0xEF（源码校准依据见
        // `LogDecodeSpec::XorByLowBit` 文档）。
        // 0x01 = 0000_0001, 0xA5 = 1010_0101, 异或 = 1010_0100 = 0xA4
        // 0x02 = 0000_0010, 0xEF = 1110_1111, 异或 = 1110_1101 = 0xED
        let spec = LogDecodeSpec::XorByLowBit {
            skip_bytes: 0,
            mask_when_odd: 0xA5,
            mask_when_even: 0xEF,
        };
        let decoded = decode_log_bytes(&[0x01, 0x02], Some(&spec));
        assert_eq!(decoded, vec![0xA4, 0xED]);
    }

    #[test]
    fn decoding_is_independent_of_byte_position() {
        // ★ 最容易写错的地方：分支条件是字节自身值的奇偶，不是下标的
        // 奇偶。同一个字节值 0x01 分别出现在下标 0（偶数下标）与下标 5
        // （奇数下标），解码结果必须相同——如果实现误把条件写成"看下标"，
        // 这条断言会失败。
        let spec = LogDecodeSpec::XorByLowBit {
            skip_bytes: 0,
            mask_when_odd: 0xA5,
            mask_when_even: 0xEF,
        };
        let bytes = vec![0x01, 0x00, 0x00, 0x00, 0x00, 0x01];
        let decoded = decode_log_bytes(&bytes, Some(&spec));
        assert_eq!(decoded[0], 0xA4);
        assert_eq!(decoded[5], 0xA4);
    }

    #[test]
    fn returns_original_bytes_when_spec_is_none() {
        let bytes = vec![0x01, 0x02, 0x03];
        assert_eq!(decode_log_bytes(&bytes, None), bytes);
    }

    #[test]
    fn skip_bytes_beyond_length_does_not_panic() {
        let spec = LogDecodeSpec::XorByLowBit {
            skip_bytes: 100,
            mask_when_odd: 0xA5,
            mask_when_even: 0xEF,
        };
        let decoded = decode_log_bytes(&[0x01, 0x02], Some(&spec));
        assert!(decoded.is_empty());
    }

    #[test]
    fn decode_log_text_uses_lossy_utf8_and_never_panics() {
        // 末尾追加 0xE4——一个 3 字节 UTF-8 字符的起始字节，后面没有跟够
        // 续接字节。理由见 `decode_log_text` 文档：日志可能在多字节字符
        // 中间被截断，一个坏字节不该让整次提取失败（严格解码会在这里
        // panic 或返回 Err，lossy 解码会替换成 U+FFFD 继续）。
        let mut bytes = b"abc".to_vec();
        bytes.push(0xE4);
        let text = decode_log_text(&bytes, None);
        assert!(text.starts_with("abc"));
        assert!(text.contains('\u{FFFD}'));
    }

    // ---------- 提取 ----------

    fn wuwa_url_pattern() -> Regex {
        Regex::new(r"https://[\w.-]+/aki/gacha/index\.html#/record[?=&\w-]+")
            .expect("测试用正则应当合法")
    }

    #[test]
    fn extracts_the_line_closest_to_end_of_file_when_multiple_lines_match() {
        let text = concat!(
            "2026-08-10 10:00:00 [Info] https://gmserver-api.aki-game2.com/aki/gacha/index.html#/record?a=1\n",
            "2026-08-10 10:05:00 [Info] some unrelated line\n",
            "2026-08-10 10:10:00 [Info] https://gmserver-api.aki-game2.com/aki/gacha/index.html#/record?a=2\n",
        );
        let pattern = wuwa_url_pattern();
        let url = extract_credential_url_from_log(text, &pattern).expect("应当匹配到 URL");
        assert!(
            url.ends_with("a=2"),
            "应当取靠近文件末尾的那一条，实际取到: {url}"
        );
    }

    #[test]
    fn returns_none_when_no_line_matches() {
        let pattern = wuwa_url_pattern();
        assert_eq!(
            extract_credential_url_from_log("no url here at all", &pattern),
            None
        );
    }

    // ---------- 路径定位 + 扫描（端到端）----------

    fn set_file_mtime(path: &Path, mtime: SystemTime) {
        let file = fs::File::options()
            .write(true)
            .open(path)
            .expect("应当能重新打开文件");
        file.set_modified(mtime).expect("应当能设置 mtime");
    }

    fn touch_with_mtime(path: &Path, mtime: SystemTime) {
        fs::create_dir_all(path.parent().unwrap()).expect("创建父目录应当成功");
        fs::write(path, b"placeholder").expect("写入占位内容应当成功");
        set_file_mtime(path, mtime);
    }

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let mut path = std::env::temp_dir();
            let unique = format!(
                "gs-p-authkey-log-test-{label}-{}-{}",
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

    const LOG_FRAGMENT: &str = "Client/Saved/Logs/Client.log";

    #[test]
    fn locates_direct_and_one_level_nested_candidates() {
        let dir = TempDir::new("locate");
        let direct = dir.path().join(LOG_FRAGMENT); // WeGame 布局：无额外子目录
        let nested = dir.path().join("Wuthering Waves Game").join(LOG_FRAGMENT); // 官方启动器布局
        let too_deep = dir.path().join("a/b").join(LOG_FRAGMENT);
        touch_with_mtime(&direct, SystemTime::now());
        touch_with_mtime(&nested, SystemTime::now());
        touch_with_mtime(&too_deep, SystemTime::now());

        let candidates = locate_log_candidates(dir.path(), LOG_FRAGMENT);
        assert!(
            candidates.contains(&direct),
            "应当发现直接命中的日志文件（WeGame 布局）"
        );
        assert!(
            candidates.contains(&nested),
            "应当发现恰好一层子目录下的日志文件（官方启动器布局）"
        );
        assert!(
            !candidates.contains(&too_deep),
            "两层子目录超出契约声明的候选形态，不应被发现"
        );
    }

    #[test]
    fn picks_latest_candidate_by_mtime_when_both_layouts_exist() {
        let dir = TempDir::new("mtime");
        let direct = dir.path().join(LOG_FRAGMENT);
        let nested = dir.path().join("Wuthering Waves Game").join(LOG_FRAGMENT);
        let now = SystemTime::now();
        touch_with_mtime(&direct, now - Duration::from_secs(3600));
        touch_with_mtime(&nested, now);

        let candidates = locate_log_candidates(dir.path(), LOG_FRAGMENT);
        let latest = pick_latest_data2_file(&candidates);
        assert_eq!(latest, Some(nested));
    }

    #[test]
    fn scan_log_file_reports_not_installed_for_unknown_game_id() {
        let locator = StaticGameLocator::new();
        let pattern = wuwa_url_pattern();
        let result = scan_log_file("wuthering-waves", LOG_FRAGMENT, None, &pattern, &locator);
        assert!(matches!(result, Err(LogScanError::GameNotInstalled { .. })));
    }

    #[test]
    fn scan_log_file_returns_none_when_installed_but_log_file_missing() {
        let dir = TempDir::new("missing");
        let locator = StaticGameLocator::new().with_install_root("wuthering-waves", dir.path());
        let pattern = wuwa_url_pattern();
        let result = scan_log_file("wuthering-waves", LOG_FRAGMENT, None, &pattern, &locator)
            .expect("已安装但日志缺失不应报错，应返回 Ok(None)");
        assert_eq!(result, None);
    }

    /// 测试专用的"编码"辅助：构造能被 `decode_log_bytes`（同一组
    /// `XorByLowBit` 参数）正确解码回 `plaintext` 的字节序列。
    ///
    /// ⚠️ 掩码分配与 `decode_log_bytes` **刻意相反**，不是笔误：
    /// `decode_log_bytes` 按"读到的字节自身奇偶"选掩码；鸣潮真实的两个
    /// 掩码 `0xA5`/`0xEF` 都是奇数，异或奇数掩码必然翻转字节奇偶，因此
    /// 明文字节的奇偶与编码后字节的奇偶总是相反。要让解码时"看编码后字节
    /// 的奇偶选到的掩码"与编码时实际用的掩码一致，编码步骤必须按"明文
    /// 字节的奇偶"选*另一个*掩码：明文为奇数时用 `mask_when_even`，明文
    /// 为偶数时用 `mask_when_odd`。这也是为什么 `xor_round_trips_with_
    /// symmetric_mask` 那条测试不能直接拿 `decode_log_bytes` 自身当
    /// "encode" 用两个不同的真实掩码验证往返——两者数学上不等价。
    fn encode_for_test(plaintext: &[u8], mask_when_odd: u8, mask_when_even: u8) -> Vec<u8> {
        plaintext
            .iter()
            .map(|&b| {
                if b & 1 == 1 {
                    b ^ mask_when_even
                } else {
                    b ^ mask_when_odd
                }
            })
            .collect()
    }

    #[test]
    fn scan_log_file_end_to_end_decodes_and_extracts_latest_url() {
        let dir = TempDir::new("e2e");
        let log_path = dir.path().join(LOG_FRAGMENT);
        fs::create_dir_all(log_path.parent().unwrap()).unwrap();

        let plaintext = concat!(
            "2026-08-10 10:00:00 [Info] https://gmserver-api.aki-game2.com/aki/gacha/index.html#/record?a=1\n",
            "2026-08-10 10:10:00 [Info] https://gmserver-api.aki-game2.com/aki/gacha/index.html#/record?a=2\n",
        );
        let spec = LogDecodeSpec::XorByLowBit {
            skip_bytes: 3,
            mask_when_odd: 0xA5,
            mask_when_even: 0xEF,
        };

        // 前 3 字节是任意占位（解码时会被整体丢弃，内容不重要），之后是
        // 用 `encode_for_test` 构造的、能被上面这组 spec 正确解码的密文。
        let mut encoded = vec![0u8, 0u8, 0u8];
        encoded.extend(encode_for_test(plaintext.as_bytes(), 0xA5, 0xEF));
        fs::write(&log_path, &encoded).unwrap();

        let locator = StaticGameLocator::new().with_install_root("wuthering-waves", dir.path());
        let pattern = wuwa_url_pattern();
        let url = scan_log_file(
            "wuthering-waves",
            LOG_FRAGMENT,
            Some(&spec),
            &pattern,
            &locator,
        )
        .expect("扫描不应报错")
        .expect("应当能取到凭据 URL");
        assert!(
            url.ends_with("a=2"),
            "应当取靠近文件末尾的那一条，实际取到: {url}"
        );
    }
}
