//! 游戏图标下载与缓存 —— 宿主侧实现（HC-2 能力窄口的落地点之一）。
//!
//! 插件 manifest 只声明 `iconUrl`（可选字段，`packages/gs-plugin-kit/manifest.ts`），
//! 真正发起网络请求、落盘、按 content-type + magic bytes 双重校验，是宿主
//! 独占的能力——插件从头到尾拿不到 `fetch`。前端已经在
//! `web/src/lib/game-icon.ts` 里做过一版纯浏览器端校验（那时落盘缓存还没
//! 接通，产出的 object URL 随刷新失效），本模块是"落地版"：真正把字节
//! 写进磁盘，下次直接读盘、不再发请求。两侧的 magic bytes 判断逐字节
//! 一致——不是共享代码（Rust 与 TS 编译期打包之间没有共享通道），是各自
//! 独立实现同一份契约，任何一侧改判断都要同步改另一侧。
//!
//! ## 网络访问为什么过一层 trait
//!
//! 单测不能联网。真实实现 [`ReqwestIconFetcher`] 用 `reqwest::blocking`；
//! 测试注入内存假实现——与 `gs-p-authkey::GameApiTransport` 是同一个理由。

use gs_core::GsError;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::Duration;

/// 单个图标缓存文件的大小上限：2 MB。`iconUrl` 只来自编译期审查过的插件
/// manifest，不是运行时可变的用户输入，但校验的防御成本只有几行判断——
/// 不因为"理论上可信"就放弃它。
const MAX_ICON_BYTES: usize = 2 * 1024 * 1024;

/// 单次下载的超时时间，覆盖从建连到读完响应体的全过程（见
/// [`ReqwestIconFetcher`] 的说明）。
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// 已知图片格式的文件头签名（magic bytes），与
/// `web/src/lib/game-icon.ts` 的 `IMAGE_SIGNATURES` 逐字节对应。
fn sniff_image_content_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes[0..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some("image/jpeg");
    }
    if bytes.len() >= 4 && bytes[0..4] == [0x47, 0x49, 0x46, 0x38] {
        return Some("image/gif");
    }
    if bytes.len() >= 12
        && bytes[0..4] == [0x52, 0x49, 0x46, 0x46]
        && bytes[8..12] == [0x57, 0x45, 0x42, 0x50]
    {
        return Some("image/webp");
    }
    None
}

/// `plugin_id` 是否只由路径安全字符组成。它来自编译期打包进二进制的插件
/// manifest（不是运行时用户输入），但用它拼缓存文件名之前仍然校验一次
/// ——防御成本只有几行，换来"缓存文件名不可能逃出 `icons/` 子目录"的
/// 确定性，不依赖"上游一定守规矩"这个假设。
fn is_path_safe_plugin_id(plugin_id: &str) -> bool {
    !plugin_id.is_empty()
        && plugin_id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

/// 缓存文件名：`<plugin_id>-<url 的 sha256 前 16 个 hex 字符>.png`。
///
/// URL 变了，hash 自然变，自然落到一个新文件——不需要额外的失效逻辑；
/// 旧文件不会被主动清理，但 M1 阶段游戏数量个位数、图标各几十 KB，暂不是
/// 需要处理的问题。
fn cache_file_name(plugin_id: &str, url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    let hash_prefix: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("{plugin_id}-{hash_prefix}.png")
}

/// 从 `reader` 最多读取 `cap` 字节；超过 `cap` 返回 `None`。
///
/// **不会**先把整个响应体读进内存再判断长度——`Read::take(cap + 1)` 把
/// 底层读取器包一层，读取动作本身在拉到 `cap + 1` 字节时就停止，即使
/// 原始响应体有几个 GB，也只会从中拉取 `cap + 1` 字节，不会继续往后读。
fn read_capped(reader: Box<dyn Read + '_>, cap: usize) -> Option<Vec<u8>> {
    let mut limited = reader.take(cap as u64 + 1);
    let mut buf = Vec::new();
    limited.read_to_end(&mut buf).ok()?;
    if buf.len() > cap { None } else { Some(buf) }
}

/// 一次网络下载的结果：HTTP 是否成功、声明的 content-type（可能没有）、
/// 响应体读取器。`body` 用 `Box<dyn Read>` 而不是提前读好的 `Vec<u8>`——
/// 这样"2MB 上限在读取过程中生效"这条要求能在 [`ensure_icon`] 里统一实现
/// 并被测试覆盖，真实实现（reqwest）与测试用的内存假实现共用同一段读取
/// 逻辑，不需要在 trait 两侧分别实现一遍上限检查。
pub struct FetchOutcome {
    pub success: bool,
    pub content_type: Option<String>,
    pub body: Box<dyn Read>,
}

/// 网络获取能力的窄口：真实实现见 [`ReqwestIconFetcher`]，测试注入内存
/// 假实现，保证单测绝不联网。
pub trait IconFetcher {
    fn fetch(&self, url: &str) -> Result<FetchOutcome, String>;
}

/// 生产环境实现：`reqwest::blocking`，[`FETCH_TIMEOUT`] 覆盖建连到读完
/// 响应体的全过程。不携带 cookie——依赖声明（`Cargo.toml`）里没有开
/// reqwest 的 `cookies` feature，这是编译期就不具备的能力，不是一个可能
/// 被漏配的运行时开关；不主动设置 `Referer`，reqwest 默认也不会替我们
/// 加一个。
///
/// ## 传输层的第二道 https 防线：`.https_only(true)`
///
/// [`ensure_icon`] 里 `url.starts_with("https://")` 校验的是**插件声明的
/// 初始地址**——那个地址来自编译期审查过的 manifest，是可信输入。但
/// reqwest 的默认重定向策略（`Policy::limited(10)`）会跟随任意协议的
/// 跳转，`https_only` 默认是 `false`（opt-in，不是"默认拒绝、显式放开"）；
/// CDN 返回一个指向 `http://...` 的 302，实际请求就会明文发出，而
/// `ensure_icon` 的入口校验对这一跳完全看不见——这不是"重定向目标一样
/// 可信所以风险可控"的问题，是"文档和代码都在声称限了 https，但检查的
/// 范围根本没覆盖到重定向"这个更基础的契约缺口：初始 URL 归插件作者
/// 审查负责，重定向目标之后指向哪，编译期 review 管不到。设 `.https_only`
/// 在 client 上，是让"限 https"这句话在协议层面上对**全部**跳转都成立，
/// 不只是对第一跳成立。同时把重定向次数上限从默认 10 收紧到
/// [`MAX_REDIRECTS`]——四个真实 TapTap 地址实测都是直接 200、零跳转，
/// 10 次没有任何现实需要，上限越小、可探测的地址面越小。
///
/// **这一层没有单元测试覆盖**：`https_only`/重定向策略是 `ClientBuilder`
/// 上一次性消费掉的配置，reqwest 不提供读回接口去断言"这个 client 确实
/// 设置了 https_only"；真正验证"https→http 降级会被拒绝"需要起一个真
/// TLS 的本地服务器让它 302 到明文地址，本仓库没有这类集成测试基础设施，
/// 也不打算为这一条单独引入。这与 [`ensure_icon`] 里
/// `ensure_icon_rejects_non_https_url_without_calling_fetch` 那条**有**
/// 测试覆盖的入口校验是两道独立防线，分工不同：入口校验管"插件声明的
/// 地址本身"，这里管"实际发生的每一跳网络请求"，覆盖面互补，不是重复。
pub struct ReqwestIconFetcher;

/// 重定向跳转次数上限，见 [`ReqwestIconFetcher`] 文档"传输层的第二道 https
/// 防线"一节。
const MAX_REDIRECTS: usize = 3;

impl IconFetcher for ReqwestIconFetcher {
    fn fetch(&self, url: &str) -> Result<FetchOutcome, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(FETCH_TIMEOUT)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
            .build()
            .map_err(|err| err.to_string())?;
        let response = client.get(url).send().map_err(|err| err.to_string())?;
        let success = response.status().is_success();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        Ok(FetchOutcome {
            success,
            content_type,
            body: Box::new(response),
        })
    }
}

/// 下载/缓存命中得到的图标：字节 + 已通过双重校验确认的内容类型。
pub struct CachedIcon {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

/// 确保 `plugin_id` 对应的图标已经缓存在 `<cache_root>/icons/` 下，返回
/// 缓存命中或新下载得到的字节。
///
/// 任何一步校验不通过、网络失败、超限，一律返回 `Ok(None)`——图标缺席是
/// 设计好的正常路径（界面走"游戏名首字 + 游戏色圆底" fallback），不应该
/// 冒泡成 `Err` 打断渲染。只有"缓存目录建不出来/写不进去"这类真正的本地
/// 故障才返回 `Err`。
pub fn ensure_icon(
    cache_root: &Path,
    plugin_id: &str,
    url: &str,
    fetch: &dyn IconFetcher,
) -> Result<Option<CachedIcon>, GsError> {
    if !is_path_safe_plugin_id(plugin_id) || !url.starts_with("https://") {
        return Ok(None);
    }

    let icons_dir = cache_root.join("icons");
    let cache_path = icons_dir.join(cache_file_name(plugin_id, url));

    if let Ok(cached_bytes) = fs::read(&cache_path) {
        if let Some(content_type) = sniff_image_content_type(&cached_bytes) {
            return Ok(Some(CachedIcon {
                bytes: cached_bytes,
                content_type: content_type.to_string(),
            }));
        }
        // 缓存文件存在但已经不是合法图片（被外部改过/损坏），当作未命中，
        // 往下走重新下载，成功后会用新内容覆盖这个文件。
    }

    let outcome = match fetch.fetch(url) {
        Ok(outcome) => outcome,
        Err(_) => return Ok(None),
    };
    if !outcome.success {
        return Ok(None);
    }

    let Some(bytes) = read_capped(outcome.body, MAX_ICON_BYTES) else {
        return Ok(None);
    };

    let Some(sniffed) = sniff_image_content_type(&bytes) else {
        return Ok(None);
    };

    // content-type 允许缺失（部分 CDN 不返回），但若返回了就必须与嗅探
    // 结果一致——不信任 content-type 单独说了算，也不按 URL 扩展名判断
    // （TapTap 的图标地址以 `.jpg` 结尾、内容却是 PNG，是实测过的坑）。
    if let Some(declared) = &outcome.content_type
        && !declared.to_lowercase().starts_with(sniffed)
    {
        return Ok(None);
    }

    fs::create_dir_all(&icons_dir)
        .map_err(|err| GsError::Storage(format!("创建图标缓存目录失败: {err}")))?;
    fs::write(&cache_path, &bytes)
        .map_err(|err| GsError::Storage(format!("写入图标缓存文件失败: {err}")))?;

    Ok(Some(CachedIcon {
        bytes,
        content_type: sniffed.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io::Cursor;
    use std::path::PathBuf;

    // ---- 测试数据：与 sniff_image_content_type 逐一对应的最小合法字节 ----

    const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    fn sample_png() -> Vec<u8> {
        let mut bytes = PNG_MAGIC.to_vec();
        bytes.extend_from_slice(b"not a real png body, only magic bytes matter here");
        bytes
    }

    fn sample_jpeg() -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8, 0xff];
        bytes.extend_from_slice(b"jpeg body placeholder");
        bytes
    }

    fn sample_gif() -> Vec<u8> {
        let mut bytes = b"GIF8".to_vec();
        bytes.extend_from_slice(b"9a placeholder tail");
        bytes
    }

    fn sample_webp() -> Vec<u8> {
        let mut bytes = vec![0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
        bytes.extend_from_slice(b"tail");
        bytes
    }

    /// 与 `crates/gs-host/src/lib.rs` 测试同款手写临时目录，不引入
    /// `tempfile` crate——本仓库现有惯例。
    fn temp_cache_root(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "gs-host-icon-cache-{label}-{}-{nanos}",
            std::process::id()
        ))
    }

    /// 假 fetcher：固定返回预先构造好的结果，同时记录是否真的被调用过——
    /// 用来证明 https-only / plugin_id 校验在"发请求之前"就短路了。
    struct FakeFetcher {
        called: Cell<bool>,
        outcome: Result<(bool, Option<String>, Vec<u8>), String>,
    }

    impl FakeFetcher {
        fn success(content_type: Option<&str>, bytes: Vec<u8>) -> Self {
            Self {
                called: Cell::new(false),
                outcome: Ok((true, content_type.map(str::to_string), bytes)),
            }
        }

        fn http_failure() -> Self {
            Self {
                called: Cell::new(false),
                outcome: Ok((false, None, Vec::new())),
            }
        }

        fn network_error() -> Self {
            Self {
                called: Cell::new(false),
                outcome: Err("connection reset".to_string()),
            }
        }
    }

    impl IconFetcher for FakeFetcher {
        fn fetch(&self, _url: &str) -> Result<FetchOutcome, String> {
            self.called.set(true);
            match &self.outcome {
                Ok((success, content_type, bytes)) => Ok(FetchOutcome {
                    success: *success,
                    content_type: content_type.clone(),
                    body: Box::new(Cursor::new(bytes.clone())),
                }),
                Err(message) => Err(message.clone()),
            }
        }
    }

    /// 按需产出字节的假读取器，源长度远大于测试用的 cap，用来验证
    /// [`read_capped`] 确实"边读边限"，而不是先把整个响应体读进内存再
    /// 判断长度。
    struct CountingReader<'a> {
        remaining: usize,
        pulled: &'a Cell<usize>,
    }

    impl Read for CountingReader<'_> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.remaining == 0 {
                return Ok(0);
            }
            let chunk = buf.len().min(self.remaining).min(4096);
            buf[..chunk].fill(0x41);
            self.remaining -= chunk;
            self.pulled.set(self.pulled.get() + chunk);
            Ok(chunk)
        }
    }

    #[test]
    fn read_capped_stops_pulling_bytes_once_cap_is_exceeded() {
        // 源比上限大得多（20 倍）：若实现先 read_to_end 整个源再判断长度，
        // pulled 会跑到接近源的总长度；真正"边读边限"的实现只会比 cap
        // 多拉一点点（用于判定"确实超限"），断言把两者区分开。
        let cap = 1024usize;
        let source_len = cap * 20;
        let pulled = Cell::new(0usize);
        let reader = CountingReader {
            remaining: source_len,
            pulled: &pulled,
        };

        let result = read_capped(Box::new(reader), cap);

        assert_eq!(result, None, "超过上限应当返回 None");
        assert!(
            pulled.get() <= cap + 4096,
            "应当在略超 cap 处就停止读取，实际拉取了 {} 字节（源总长度 {}）",
            pulled.get(),
            source_len
        );
    }

    #[test]
    fn read_capped_returns_all_bytes_when_within_cap() {
        let bytes = b"within the limit".to_vec();
        let result = read_capped(Box::new(Cursor::new(bytes.clone())), 1024);
        assert_eq!(result, Some(bytes));
    }

    #[test]
    fn sniff_image_content_type_recognizes_all_four_supported_formats() {
        assert_eq!(sniff_image_content_type(&sample_png()), Some("image/png"));
        assert_eq!(sniff_image_content_type(&sample_jpeg()), Some("image/jpeg"));
        assert_eq!(sniff_image_content_type(&sample_gif()), Some("image/gif"));
        assert_eq!(sniff_image_content_type(&sample_webp()), Some("image/webp"));
    }

    #[test]
    fn sniff_image_content_type_rejects_bytes_that_match_no_known_signature() {
        assert_eq!(sniff_image_content_type(b"not an image at all"), None);
        assert_eq!(sniff_image_content_type(b""), None);
    }

    #[test]
    fn is_path_safe_plugin_id_accepts_lowercase_digits_underscore_hyphen() {
        assert!(is_path_safe_plugin_id("genshin"));
        assert!(is_path_safe_plugin_id("star_rail-2"));
    }

    #[test]
    fn is_path_safe_plugin_id_rejects_path_traversal_and_uppercase() {
        assert!(!is_path_safe_plugin_id("../etc"));
        assert!(!is_path_safe_plugin_id("Genshin"));
        assert!(!is_path_safe_plugin_id("has/slash"));
        assert!(!is_path_safe_plugin_id(""));
    }

    #[test]
    fn ensure_icon_downloads_verifies_and_writes_cache_file_on_first_call() {
        let cache_root = temp_cache_root("fresh-download");
        let fetcher = FakeFetcher::success(Some("image/png"), sample_png());

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        let icon = result.expect("合法 PNG 应当被接受");
        assert_eq!(icon.content_type, "image/png");
        assert_eq!(icon.bytes, sample_png());
        assert!(fetcher.called.get());

        let cache_path = cache_root
            .join("icons")
            .join(cache_file_name("genshin", "https://example.com/icon.png"));
        assert_eq!(fs::read(&cache_path).unwrap(), sample_png(), "应当已经落盘");

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_reads_from_disk_without_calling_fetch_on_cache_hit() {
        let cache_root = temp_cache_root("cache-hit");
        let icons_dir = cache_root.join("icons");
        fs::create_dir_all(&icons_dir).unwrap();
        let cache_path = icons_dir.join(cache_file_name("genshin", "https://example.com/icon.png"));
        fs::write(&cache_path, sample_jpeg()).unwrap();

        // 只要被调用就 panic——证明缓存命中路径完全不碰网络。
        struct PanicIfCalled;
        impl IconFetcher for PanicIfCalled {
            fn fetch(&self, _url: &str) -> Result<FetchOutcome, String> {
                panic!("缓存命中时不应当发起网络请求");
            }
        }

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &PanicIfCalled,
        )
        .expect("不应当返回 Err");

        let icon = result.expect("应当命中缓存");
        assert_eq!(icon.content_type, "image/jpeg");
        assert_eq!(icon.bytes, sample_jpeg());

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_rejects_non_https_url_without_calling_fetch() {
        let cache_root = temp_cache_root("reject-http");
        let fetcher = FakeFetcher::success(Some("image/png"), sample_png());

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "http://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        assert!(result.is_none());
        assert!(!fetcher.called.get(), "http 协议应当在发请求之前就被拒绝");

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_rejects_unsafe_plugin_id_without_calling_fetch() {
        let cache_root = temp_cache_root("reject-plugin-id");
        let fetcher = FakeFetcher::success(Some("image/png"), sample_png());

        let result = ensure_icon(
            &cache_root,
            "../escape",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        assert!(result.is_none());
        assert!(!fetcher.called.get());

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_rejects_bytes_that_do_not_match_any_known_image_signature() {
        let cache_root = temp_cache_root("reject-garbage");
        let fetcher = FakeFetcher::success(None, b"just some plain text, not an image".to_vec());

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        assert!(result.is_none());
        assert!(
            fs::read(
                cache_root
                    .join("icons")
                    .join(cache_file_name("genshin", "https://example.com/icon.png"))
            )
            .is_err(),
            "校验不通过不应当落盘"
        );

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_rejects_content_type_header_mismatched_with_sniffed_bytes() {
        let cache_root = temp_cache_root("reject-mismatch");
        // 字节确实是 PNG，但服务端声明的 content-type 是 jpeg——TapTap 那种
        // "扩展名/声明类型撒谎"的镜像场景，双重校验要求两者一致才通过。
        let fetcher = FakeFetcher::success(Some("image/jpeg"), sample_png());

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        assert!(result.is_none());

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_accepts_when_content_type_header_is_absent() {
        // 部分 CDN 不返回 content-type，允许缺失，只要 magic bytes 能嗅探出来。
        let cache_root = temp_cache_root("accept-missing-content-type");
        let fetcher = FakeFetcher::success(None, sample_webp());

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        let icon = result.expect("content-type 缺失时应当仍然接受合法图片字节");
        assert_eq!(icon.content_type, "image/webp");

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_rejects_body_larger_than_two_megabyte_cap_and_does_not_write_cache() {
        let cache_root = temp_cache_root("reject-oversized");
        let mut oversized = PNG_MAGIC.to_vec();
        oversized.resize(MAX_ICON_BYTES + 1, 0);
        let fetcher = FakeFetcher::success(Some("image/png"), oversized);

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        assert!(result.is_none());
        assert!(
            fs::read(
                cache_root
                    .join("icons")
                    .join(cache_file_name("genshin", "https://example.com/icon.png"))
            )
            .is_err(),
            "超限不应当落盘"
        );

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_treats_http_error_status_as_ok_none() {
        let cache_root = temp_cache_root("http-error-status");
        let fetcher = FakeFetcher::http_failure();

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        assert!(result.is_none());

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_treats_network_error_as_ok_none_not_err() {
        let cache_root = temp_cache_root("network-error");
        let fetcher = FakeFetcher::network_error();

        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        );

        assert!(
            matches!(result, Ok(None)),
            "下载失败必须是 Ok(None)（图标缺席是正常路径），不能是 Err（那会打断界面渲染）"
        );

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_returns_err_when_cache_directory_cannot_be_created() {
        // 用一个"同名但是普通文件"的路径挡住 icons/ 子目录的创建位置，
        // 制造一次真正的本地故障（而不是下载失败），验证这类情况会冒泡成
        // Err，不会被静默吞成 Ok(None)。
        let cache_root = temp_cache_root("mkdir-blocked");
        fs::create_dir_all(&cache_root).unwrap();
        fs::write(cache_root.join("icons"), b"blocking file").unwrap();

        let fetcher = FakeFetcher::success(Some("image/png"), sample_png());
        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        );

        assert!(result.is_err(), "缓存目录建不出来应当是 Err，不是 Ok(None)");

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn ensure_icon_redownloads_when_cached_file_is_corrupted() {
        let cache_root = temp_cache_root("corrupted-cache");
        let icons_dir = cache_root.join("icons");
        fs::create_dir_all(&icons_dir).unwrap();
        let cache_path = icons_dir.join(cache_file_name("genshin", "https://example.com/icon.png"));
        fs::write(&cache_path, b"corrupted, not an image").unwrap();

        let fetcher = FakeFetcher::success(Some("image/png"), sample_png());
        let result = ensure_icon(
            &cache_root,
            "genshin",
            "https://example.com/icon.png",
            &fetcher,
        )
        .expect("不应当返回 Err");

        assert!(result.is_some(), "损坏的缓存文件应当被当作未命中，重新下载");
        assert!(fetcher.called.get());

        let _ = fs::remove_dir_all(&cache_root);
    }

    #[test]
    fn cache_file_name_changes_when_url_changes_so_stale_entries_are_naturally_bypassed() {
        let a = cache_file_name("genshin", "https://example.com/a.png");
        let b = cache_file_name("genshin", "https://example.com/b.png");
        assert_ne!(
            a, b,
            "不同 URL 应当落到不同缓存文件，天然实现\"URL 变了就重新下载\""
        );
        assert!(a.starts_with("genshin-"));
        assert!(a.ends_with(".png"));
    }
}
