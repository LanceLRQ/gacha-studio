//! 宿主支持的插件 SDK 版本基准，及与插件声明版本的兼容性判定。
//!
//! ## 为什么宿主要自己再维护一份基准，而不是只信任 TS 侧已经检查过
//!
//! `packages/gs-plugin-kit/manifest.ts` 的 `CURRENT_SDK_VERSION` 是给
//! **当前仓库内**的 TS 插件作者用的编译期字面量类型——插件 manifest 里
//! `sdkVersion` 字段填错版本号，`tsc` 直接报错，把契约不兼容挡在构建期。
//! 但这道防线只在"插件与它所依赖的 `gs-plugin-kit` 版本完全同步"这个前提下
//! 成立：本仓库当前四个插件确实与 `gs-plugin-kit` 同版本编译，前提永远成立；
//! 但 `CLAUDE.local.md`「贡献者要求」预告的外部贡献者场景不是这样——他们可能
//! 依赖一份已发布到某个包仓库的旧版 `gs-plugin-kit`，本地 `tsc` 检查用的是
//! **那份旧包里**的 `SdkVersion` 字面量类型，编译期能过，但产出的 manifest
//! JSON 被**这个宿主**（可能已经升级过 SDK 契约）加载时，两侧早已不同步——
//! TS 端的编译期防线管不到这种"跨发布版本"的脱节，只有宿主自己在加载时独立
//! 校验一遍才挡得住。这正是 HC-4「声明必被消费」要防的同一类问题：字段
//! 声明了、也过了自己那一侧的检查，运行时却静默不生效。因此这里必须是宿主
//! （Rust）自己独立维护的一份基准，不能假设 TS 侧检查过就万事大吉。
//!
//! ## 为什么放在 gs-core
//!
//! 真正的校验发生在插件加载路径（`gs-plugin-runtime::PluginRuntime::new`），
//! 但版本基准本身是纯数据 + 纯函数，不需要 QuickJS。`gs-core` 是"领域模型与
//! 错误类型基础层，供 L1 范式层与宿主运行时共享"（见其 `Cargo.toml`
//! `description`），本身零重量级依赖，`gs-plugin-runtime` 加一条指向它的
//! 依赖边，比反过来把这份基准塞进 `gs-plugin-runtime`（将来出现第二个消费者
//! 时又要重复一份）更便宜；与 `Platform`/`RaritySpec` 这类"多个上层 crate
//! 都要认识的领域概念"归在同一层，是同一个理由。
//!
//! ## 只比较 major：为什么，以及会在什么情况下误判
//!
//! 采用语义化版本的常见约定：major 变更代表破坏性变更，minor/patch 代表
//! 向后兼容的新增/修复，这与 `CURRENT_SDK_VERSION` 自己的文档一致——
//! 「破坏性变更时提升该常量」。只要没有破坏性变更，宿主没有理由拒绝一个
//! 声明了旧 minor/patch 版本号的插件，否则宿主每发布一次补丁版本都会让全部
//! 存量插件同时失效，这与「新游戏只改插件」的目标背道而驰。
//!
//! ⚠️ 已知的误判场景：这条规则假设"同一个 major 内，宿主永远是新特性的
//! 超集"——但如果宿主自己的版本落后于插件（如插件声明 `"1.3.0"`，宿主此刻
//! 只发布到 `"1.0.0"`），本函数仍然会判定为兼容（major 都是 1），实际上宿主
//! 可能压根不认识插件在 1.1~1.3 之间新增声明的字段。这类"宿主落后于插件"的
//! 脱节不会在这道版本门被拦下，会在别处（`serde_json` 反序列化缺字段、或
//! HC-4 这类字段消费检查）以另一种失败模式暴露出来——这与 semver 本身的
//! 约定一致：向后兼容（新宿主认旧插件）是这条规则能担保的范围，向前兼容
//! （旧宿主认新插件）不是，也不该假装是。

use thiserror::Error;

/// 宿主当前支持的插件 SDK 版本基准。与
/// `packages/gs-plugin-kit/manifest.ts` 的 `CURRENT_SDK_VERSION` 是同一个
/// 版本号在两侧各自的落点，理由见本模块文档；宿主发布破坏性变更时两处常量
/// 必须在同一次提交里一起提升。
///
/// **这条同步由 `pnpm gs:check` 的 HC-3 ④ 机械把关**
/// （`scripts/gs-check/checks/codegen-diff.mjs` 的 `checkSdkVersionSync`），
/// 不是靠这条注释。原因是漏改一处的后果恰好是「看起来一致」——宿主会拿旧
/// 基准去校验按新契约写的插件，而 `is_sdk_version_compatible` **仍然返回
/// 通过**（major 相等），这类静默通过正是本仓库门禁体系要拦的形状，
/// 不能只写一句「必须手动保持同步」了事。
pub const HOST_SDK_VERSION: &str = "1.0.0";

/// 解析/比较 SDK 版本号失败。
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SdkVersionError {
    /// `version` 不是形如 `"1.0.0"` 的合法版本号——至少要能取出一个非空的
    /// 数字主版本号段。
    #[error("SDK 版本号 \"{0}\" 不是合法的版本号（形如 \"1.0.0\"，取不出数字主版本号段）")]
    Malformed(String),
}

/// 判断插件声明的 SDK 版本 `declared` 是否与 [`HOST_SDK_VERSION`] 兼容。
///
/// 比较规则、理由与已知误判场景见本模块文档。`declared` 无法解析出主版本号
/// 时返回 `Err`——解析失败本身也是一种"不兼容"，调用方不应把它当成"暂时
/// 跳过检查"处理，必须与判定为 `false` 时一样响亮地拒绝。
pub fn is_sdk_version_compatible(declared: &str) -> Result<bool, SdkVersionError> {
    let declared_major = parse_major(declared)?;
    let host_major = parse_major(HOST_SDK_VERSION)
        .expect("HOST_SDK_VERSION 是本模块自己维护的编译期常量，必须是合法版本号");
    Ok(declared_major == host_major)
}

/// 取版本号字符串的主版本号段（第一个 `.` 之前的部分），要求是非空的十进制
/// 整数。不处理 `v` 前缀、预发布标签（`-rc.1`）、构建元数据（`+build.1`）等
/// 完整 semver 语法——`CURRENT_SDK_VERSION`/`HOST_SDK_VERSION` 目前都只用最
/// 简单的 `MAJOR.MINOR.PATCH` 形式，不需要为没出现过的写法预先兼容。
fn parse_major(version: &str) -> Result<u32, SdkVersionError> {
    version
        .split('.')
        .next()
        .filter(|segment| !segment.is_empty())
        .and_then(|segment| segment.parse::<u32>().ok())
        .ok_or_else(|| SdkVersionError::Malformed(version.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_version_is_compatible() {
        assert_eq!(is_sdk_version_compatible(HOST_SDK_VERSION), Ok(true));
    }

    #[test]
    fn same_major_different_minor_patch_is_still_compatible() {
        // 破坏性变更才提升 major；minor/patch 差异按 semver 约定应当向后兼容，
        // 这正是本模块文档「只比较 major」一节要验证的规则本身。
        assert_eq!(is_sdk_version_compatible("1.9.3"), Ok(true));
    }

    #[test]
    fn different_major_version_is_incompatible() {
        assert_eq!(is_sdk_version_compatible("2.0.0"), Ok(false));
        assert_eq!(is_sdk_version_compatible("0.9.0"), Ok(false));
    }

    #[test]
    fn malformed_version_string_is_rejected_not_silently_passed() {
        let err = is_sdk_version_compatible("not-a-version").unwrap_err();
        assert_eq!(err, SdkVersionError::Malformed("not-a-version".to_string()));
    }

    #[test]
    fn empty_string_is_rejected() {
        assert!(is_sdk_version_compatible("").is_err());
    }

    #[test]
    fn leading_dot_is_rejected_as_empty_major_segment() {
        // ".0.0" 的第一段是空字符串，不能被 `parse::<u32>` 悄悄当成 0 处理——
        // 空段与合法的 "0" 段是两回事，必须一并拒绝，不能放过。
        assert!(is_sdk_version_compatible(".0.0").is_err());
    }
}
