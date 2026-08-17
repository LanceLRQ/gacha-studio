//! 插件 JS 运行时桥接。
//!
//! 架构裁定见 `docs/_internal/milestones/00-实施总览.md` §6.7：插件
//! （`plugins/**`）用 TypeScript 撰写，但**跑在 Rust 内嵌的 QuickJS 引擎里**，
//! 不跑在前端 webview。采集编排全程在 Rust（`crates/paradigms/*`），插件
//! 代码只在两个时机被调用：喂给它一段已经由 Rust 完成 IO 取回的数据（如
//! `extractList(response)`），或者要它做一次同步计算（如
//! `hooks.deriveRecordKey(record)`）。
//!
//! 选 QuickJS（而非 V8/`deno_core`）的理由：
//! 1. 只有内嵌运行时能让"TS 侧物理上不提供 `fetch`/`fs`/`child_process`"这句话
//!    字面成立——QuickJS 里根本没有这些全局对象，不是靠约定不让插件调用；
//! 2. 二进制体积增量以 KB 计（本机实测见下方测试模块），不是 V8/`deno_core`
//!    那种几十 MB 级别，符合桌面应用的分发体积预算。
//!
//! ## 为什么是独立 crate，不是内聚进 `gs-host` 或 `gs-p-authkey`
//!
//! 本模块最初（M1-S3 首版实现）直接写在 `crates/gs-host/src/plugin_runtime.rs`
//! 里，`gs-p-authkey` 依赖 `gs-host` 来调用它。复核时发现这条依赖方向撞上了
//! 一个必然会发生的环，记录下来避免下一个人重蹈：
//!
//! - `src-tauri` 只依赖 `gs-host`（Tauri 外壳层不该直接认识某个具体范式）；
//! - 要让应用真的跑一次采集，必须有代码调用 `AuthkeyApiPipeline`；
//! - `gs-host` 的既定职责就是"宿主运行时、插件加载、**任务编排**"
//!   （插件 SDK 设计文档 §1.3）——编排 authkey 采集这件事迟早要落在
//!   `gs-host` 头上，也就是迟早会出现 `gs-host → gs-p-authkey`；
//! - 叠上当时 `gs-p-authkey → gs-host`（为了调用插件运行时），两条方向一凑
//!   齐，`cargo` 直接拒绝编译——这不是"风格更好"的建议，是下一步必然发生的
//!   编译错误。
//!
//! 把插件运行时拆成 `gs-plugin-runtime`、让 `gs-host` 与 `gs-p-authkey`
//! **平级依赖**它，环就不存在了：两者都指向它，它不指向任何一个消费者。
//!
//! ⚠️ **这条不违反`00-实施总览.md` §6.2「L0 不建独立 crate，先内聚进消费它的
//! L1」的裁定**——那条裁定管的是**范式专属**的原子能力（`data_2` 缓存扫描
//! 只有 authkey 用，日志读取只有未来的日志扫描范式用，各自只有一个消费者，
//! 现在拆 crate 是在为不存在的第二个消费者预先抽象）。JS 引擎从设计的第一天
//! 起就不是这种情况：它从来只有一个职责——"喂 JSON 进去、按点分路径调用插件
//! 声明的函数、把结果和错误带回来"，这件事与走哪条采集范式无关，未来的日志
//! 扫描（M2）、封包捕获（M4）范式一样要通过它调用各自插件的纯函数。换句话说，
//! 它从一开始就是"多消费者"的宿主级能力，只是本 Stage 只有 `gs-p-authkey`
//! 一个范式已经落地，看起来像"单一消费者"而已。**这里抽 crate 的直接动因是
//! 破解一个已经能证明必然发生的依赖环，不是"预先抽象以求好看"**——三次法则
//! 防的是后一种情况，本次不属于。

use std::sync::OnceLock;

use rquickjs::{CatchResultExt, CaughtError, Context, Function, Runtime};
use serde_json::Value;

/// `scripts/gs-bundle-plugins.mjs` 的产出，编译期嵌进二进制——HC-1
/// （编译期打包，禁止运行时动态加载）的字面落地：这里没有任何"读取外部脚本
/// 再执行"的代码路径，bundle 内容在 `cargo build` 时就已经固定进产物。
/// 若这两个文件不存在，先跑一遍 `node scripts/gs-bundle-plugins.mjs`。
const PLUGIN_BUNDLE_SOURCE: &str = include_str!("../generated/plugins.bundle.js");

/// 各插件 manifest 的"纯数据子集"的读取函数 [`plugin_manifest_data`] 已经
/// 拆到独立 crate `gs-manifest-data`（不需要 QuickJS 就能用，`gs-analysis`
/// 这类纯 Rust 计算 crate 不必因为要读它而被迫依赖本 crate 的 `rquickjs`），
/// 本 crate 只在下方转发它，保持既有调用方（如 `gs-p-authkey`）的调用路径
/// `gs_plugin_runtime::plugin_manifest_data(...)` 不变。理由详见
/// `crates/gs-manifest-data/src/lib.rs` 顶部说明。
pub use gs_manifest_data::plugin_manifest_data;

/// bundle 在 QuickJS 里对应的虚拟文件名，只用于 QuickJS 内部标识"当前正在
/// 跑哪段脚本"（异常栈帧会带上这个名字）。与 sourcemap 的 `sources` 字段是
///两回事——sourcemap 自己携带了到原始 `plugins/<game>/*.ts` 的完整映射，
/// 不依赖这个名字取值是什么，这里固定写死即可。
const BUNDLE_MODULE_NAME: &str = "plugins.bundle.js";

/// HC-2 审计对象之一：宿主**主动向 JS 运行时注入**的全局标识符清单。
///
/// 恒为空——[`PluginRuntime`] 不向 QuickJS 注入任何 Rust 函数或对象。调用
/// 方向是反过来的：Rust 调用 bundle 里已经定义好的 `__gs_call`/`__gs_has`
/// （这两个函数由**打包脚本**写进 bundle 源码，不是运行时注入），插件也从不
/// 主动回调 Rust。这份清单存在的意义是让"暴露面审计"有一个可枚举、可断言
/// 为空的落点，而不是一句"我们没有注入东西"的口头承诺——见
/// `tests::injected_globals_list_is_empty`。
pub const INJECTED_GLOBALS: &[&str] = &[];

/// HC-2 审计对象之二：确认在 QuickJS 里**不存在**的全局对象。
///
/// 这些是 Node/浏览器宿主环境才会提供的能力，不是 ECMAScript 标准内置对象，
/// QuickJS 本身完全不认识它们；`Context::full` 也只注册标准内置对象
/// （`Math`/`JSON`/`RegExp`/`Promise`/… ），不会额外添加这些。这份清单的
/// 价值在于**持续验证**——依赖升级可能在未来某天悄悄改变这个事实，
/// [`PluginRuntime::new`] 在启动时会主动断言一遍（而不只是写在测试里），
/// 一旦有任何一个变得可见就拒绝启动，见 `assert_forbidden_globals_absent`。
pub const FORBIDDEN_GLOBALS: &[&str] = &[
    "invoke",
    "fetch",
    "fs",
    "require",
    "process",
    "XMLHttpRequest",
];

/// 插件运行时启动失败：QuickJS 引擎/上下文创建失败，或 bundle 本身跑不通
/// （比如刚手改过生成产物导致语法错误——理论上不该发生，因为它标了"禁止
/// 手改"，但引擎层面必须能表达这种失败而不是 panic）。
#[derive(Debug)]
pub struct PluginRuntimeError(String);

impl std::fmt::Display for PluginRuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for PluginRuntimeError {}

/// 调用某个插件函数失败。三种子情形对应 QuickJS 调用可能失败的三条路径，
/// 见 [`PluginCallErrorKind`]。
#[derive(Debug)]
pub struct PluginCallError {
    pub plugin_id: String,
    pub path: String,
    pub kind: PluginCallErrorKind,
}

#[derive(Debug)]
pub enum PluginCallErrorKind {
    /// 插件代码抛出了一个 `Error`（或其子类）实例——这是插件作者手写
    /// `throw new Error(...)` 的正常路径，例如 `hooks.deriveRecordKey`
    /// 发现 `stableId` 缺失时抛出的那种。
    ///
    /// `mapped_stack` 是已经尽量映射回原始 `plugins/<game>/*.ts` 行号的
    /// 栈帧；映射不到的帧（比如打包脚本自己生成的 `__gs_call` 胶水代码，
    /// 那部分没有对应的"原始 TS 源码"）保留生成后的位置。
    Exception {
        message: String,
        mapped_stack: Vec<MappedFrame>,
    },
    /// 插件代码用 `throw` 抛出了非 `Error` 值（字符串/数字/对象字面量）。
    ThrownValue { debug: String },
    /// QuickJS 引擎内部错误（内存分配失败、栈溢出等），不是插件代码的问题。
    Engine(String),
    /// 参数或返回值的 JSON 编解码失败——多半是插件返回了不满足
    /// `UnifiedRecordFields` 之类契约的形状，或者调用方传入的参数本身不是
    /// 合法 JSON。
    Json(String),
}

/// 一条已尽量映射回原始源码的调用栈帧。
#[derive(Debug, Clone)]
pub struct MappedFrame {
    /// 原始文本："at 函数名 (plugins.bundle.js:行:列)" 这一整行，未做任何处理。
    pub generated: String,
    /// 映射成功时的原始位置；映射不到时为 `None`（`generated` 仍然保留，
    /// 调用方依然能看到"生成后的位置"，只是不知道对应哪一行原始 TS）。
    pub original: Option<OriginalLocation>,
}

#[derive(Debug, Clone)]
pub struct OriginalLocation {
    /// 相对仓库根目录的原始文件路径，如 `"plugins/genshin/hooks.ts"`。
    pub file: String,
    /// 1-based 行号，与编辑器/终端一贯的显示习惯一致。
    pub line: u32,
    /// 1-based 列号。
    pub column: u32,
    pub symbol_name: Option<String>,
}

impl std::fmt::Display for PluginCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.kind {
            PluginCallErrorKind::Exception {
                message,
                mapped_stack,
            } => {
                writeln!(
                    f,
                    "插件 \"{}\" 调用 \"{}\" 时抛出异常：{message}",
                    self.plugin_id, self.path
                )?;
                if mapped_stack.is_empty() {
                    return Ok(());
                }
                writeln!(
                    f,
                    "调用栈（已尽量映射回插件源码，映射不到的帧保留生成后位置）："
                )?;
                for frame in mapped_stack {
                    match &frame.original {
                        Some(loc) => {
                            let name = loc.symbol_name.as_deref().unwrap_or("<anonymous>");
                            writeln!(
                                f,
                                "  at {name} ({}:{}:{})  [生成位置：{}]",
                                loc.file, loc.line, loc.column, frame.generated
                            )?;
                        }
                        None => writeln!(f, "  {}（未能映射回原始源码）", frame.generated)?,
                    }
                }
                Ok(())
            }
            PluginCallErrorKind::ThrownValue { debug } => write!(
                f,
                "插件 \"{}\" 调用 \"{}\" 抛出了一个非 Error 值：{debug}",
                self.plugin_id, self.path
            ),
            PluginCallErrorKind::Engine(detail) => write!(
                f,
                "插件 \"{}\" 调用 \"{}\" 时 QuickJS 引擎内部错误：{detail}",
                self.plugin_id, self.path
            ),
            PluginCallErrorKind::Json(detail) => write!(
                f,
                "插件 \"{}\" 调用 \"{}\" 的参数或返回值 JSON 处理失败：{detail}",
                self.plugin_id, self.path
            ),
        }
    }
}

impl std::error::Error for PluginCallError {}

// ============================================================
// SDK 版本校验
// ============================================================

/// 逐个校验 [`gs_manifest_data::registered_plugin_ids`] 里每一个已注册插件
/// 声明的 `sdkVersion` 是否与宿主当前支持的版本（[`gs_core::HOST_SDK_VERSION`]）
/// 兼容，任何一个不兼容就立即拒绝，不继续检查其余插件、也不继续启动运行时。
///
/// 这是 HC-4「声明必被消费」要防的典型场景在 `sdkVersion` 这个字段上的
/// 落点：这个字段若只是从 JSON 解析出来摆在那儿从不比对，插件与宿主契约
/// 实际脱节时不会有任何信号，会一路带着不兼容的假设跑下去，直到某个具体
/// 字段在完全不相关的位置反序列化失败——那时候排查者看到的错误信息里根本
/// 不会提到"SDK 版本不兼容"这个真正的根因。
///
/// 当前四个插件全部在仓库内、随宿主同版本编译打包，`sdkVersion` 与
/// `HOST_SDK_VERSION` 恒为同一个值，这个函数今天不可能返回 `Err`——它存在的
/// 意义是 `CLAUDE.local.md`「贡献者要求」预告的外部贡献者场景：那时一个
/// 声明了不兼容 SDK 版本的插件必须在这里被拦住，而不是被静默接受。
fn assert_all_registered_plugins_support_host_sdk_version() -> Result<(), PluginRuntimeError> {
    for plugin_id in gs_manifest_data::registered_plugin_ids() {
        let manifest = gs_manifest_data::plugin_manifest_data(plugin_id).unwrap_or_else(|| {
            panic!(
                "插件 \"{plugin_id}\" 来自 registered_plugin_ids 的返回值，manifest 纯数据不应缺失\
                 ——两者共用同一份底层解析结果，见 gs-manifest-data 的实现"
            )
        });
        let declared = manifest
            .get("sdkVersion")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| {
                panic!(
                    "插件 \"{plugin_id}\" manifest 缺少必填字符串字段 \"sdkVersion\"——\
                 PluginManifest.sdkVersion 是必填字段，这份 JSON 由 scripts/gs-bundle-plugins.mjs \
                 生成，不应手改"
                )
            });
        validate_plugin_sdk_version(plugin_id, declared)?;
    }
    Ok(())
}

/// 校验单个插件声明的 SDK 版本，纯函数（不读取任何全局 manifest 状态）。
///
/// 从 [`assert_all_registered_plugins_support_host_sdk_version`] 里拆出来是
/// 为了可测试性：那个函数只能测到当前四个已注册插件（全部声明兼容版本
/// `"1.0.0"`），测不出"声明了不兼容版本会被拒绝"这个只有外部贡献者到来
/// 之后才会真实发生的场景。拆出的这个函数不依赖 `gs_manifest_data` 的全局
/// 状态，测试可以直接喂合成的 `(plugin_id, declared)` 验证拒绝行为，不需要
/// 改动真实的 `plugins.manifest.json`（那是打包脚本产出物，禁止手改）。
fn validate_plugin_sdk_version(plugin_id: &str, declared: &str) -> Result<(), PluginRuntimeError> {
    match gs_core::is_sdk_version_compatible(declared) {
        Ok(true) => Ok(()),
        Ok(false) => Err(PluginRuntimeError(format!(
            "插件 \"{plugin_id}\" 声明的 SDK 版本 \"{declared}\" 与宿主当前支持的版本 \"{}\" \
             不兼容（主版本号不同）——拒绝加载。这不是可以静默跳过的情况：HC-4「声明必被消费」的\
             立场是宁可拒绝启动，也不要带着已经脱节的契约继续跑。",
            gs_core::HOST_SDK_VERSION
        ))),
        Err(err) => Err(PluginRuntimeError(format!(
            "插件 \"{plugin_id}\" 声明的 SDK 版本 \"{declared}\" 无法解析：{err}——拒绝加载"
        ))),
    }
}

/// 插件运行时：持有一个已经加载完 bundle 的 QuickJS `Runtime` + `Context`。
///
/// 不是 `Send`/`Sync`（QuickJS 的值带生命周期绑定，rquickjs 的 `Context`
/// 本身也没有对应实现）——每条采集流程（`AuthkeyApiPipeline` 等）在自己的
/// 线程上各建一个 `PluginRuntime`，不跨线程共享同一个实例。
pub struct PluginRuntime {
    // 只是持有 Runtime 不放，QuickJS 的 GC/内存分配依赖它存活；`Context`
    // 内部持有对它的引用计数。字段本身不会被直接使用，但 drop 顺序不能反——
    // 好在 Rust 按声明顺序的逆序 drop 字段，`context` 先于 `runtime` 释放，
    // 顺序天然正确。
    _runtime: Runtime,
    context: Context,
}

impl PluginRuntime {
    /// 启动运行时：校验全部已注册插件的 SDK 版本兼容性、创建 QuickJS 引擎、
    /// 加载插件 bundle、执行 HC-2 自检。
    ///
    /// SDK 版本校验放在最前面，先于创建 QuickJS 引擎——版本不兼容是纯数据
    /// 判断，不需要引擎就能做出，把它放前面能让"契约脱节"这类错误尽快、
    /// 尽量廉价地暴露，而不是先花掉一次引擎初始化的开销才发现。
    pub fn new() -> Result<Self, PluginRuntimeError> {
        assert_all_registered_plugins_support_host_sdk_version()?;

        let runtime = Runtime::new()
            .map_err(|err| PluginRuntimeError(format!("创建 QuickJS Runtime 失败：{err}")))?;
        let context = Context::full(&runtime)
            .map_err(|err| PluginRuntimeError(format!("创建 QuickJS Context 失败：{err}")))?;

        context.with(|ctx| -> Result<(), PluginRuntimeError> {
            // `EvalOptions` 标了 `#[non_exhaustive]`，跨 crate 不能用结构体字面量
            // （哪怕带 `..Default::default()`），只能先取默认值再赋字段。
            let mut options = rquickjs::context::EvalOptions::default();
            options.filename = Some(BUNDLE_MODULE_NAME.to_string());
            ctx.eval_with_options::<(), _>(PLUGIN_BUNDLE_SOURCE, options)
                .catch(&ctx)
                .map_err(|err| {
                    PluginRuntimeError(format!("加载插件 bundle 失败：{}", describe_caught(&err)))
                })
        })?;

        let instance = Self {
            _runtime: runtime,
            context,
        };
        instance.assert_forbidden_globals_absent()?;
        Ok(instance)
    }

    /// HC-2 自检：逐个断言 [`FORBIDDEN_GLOBALS`] 里的名字在 `globalThis` 上
    /// 确实是 `undefined`。放在启动路径里而不只是测试里，是因为这是一条
    /// 安全硬约束——一旦失守就应当拒绝启动，而不是"等测试跑起来才发现"。
    fn assert_forbidden_globals_absent(&self) -> Result<(), PluginRuntimeError> {
        for name in FORBIDDEN_GLOBALS {
            let is_undefined: bool = self
                .context
                .with(|ctx| ctx.eval(format!("typeof {name} === \"undefined\"")))
                .map_err(|err| {
                    PluginRuntimeError(format!(
                        "HC-2 自检执行失败（检查全局量 \"{name}\" 时）：{err}"
                    ))
                })?;
            if !is_undefined {
                return Err(PluginRuntimeError(format!(
                    "HC-2 违反：QuickJS 运行时里 \"{name}\" 不是 undefined——\
                     插件的能力边界一旦包含它就等于整个应用的能力边界，拒绝启动"
                )));
            }
        }
        Ok(())
    }

    /// 探测某个插件的某条点分路径是否指向一个函数，不触发调用。
    ///
    /// 典型用途：`hooks.deriveRecordKey`/`hooks.resolveTimezone` 是否被
    /// 插件声明，只有跑起来才知道（它们在 manifest 静态数据 JSON 里根本
    /// 不出现，因为那份 JSON 已经把函数字段整体剥离）。
    pub fn has(&self, plugin_id: &str, path: &str) -> Result<bool, PluginCallError> {
        self.context.with(|ctx| {
            let func: Function = ctx
                .globals()
                .get("__gs_has")
                .map_err(|err| PluginCallError {
                    plugin_id: plugin_id.to_string(),
                    path: path.to_string(),
                    kind: PluginCallErrorKind::Engine(format!("取 __gs_has 失败：{err}")),
                })?;
            func.call::<_, bool>((plugin_id, path))
                .catch(&ctx)
                .map_err(|caught| self.build_call_error(plugin_id, path, caught))
        })
    }

    /// 调用插件的某个函数。`args` 是要传给该函数的参数数组（`extractRecord`
    /// 只有一个参数，`resolveTimezone` 有两个，以此类推），返回值经
    /// `JSON.parse`/`JSON.stringify` 往返，`undefined` 归一化为 `null`。
    pub fn call(
        &self,
        plugin_id: &str,
        path: &str,
        args: &[Value],
    ) -> Result<Value, PluginCallError> {
        let args_json = serde_json::to_string(args).map_err(|err| PluginCallError {
            plugin_id: plugin_id.to_string(),
            path: path.to_string(),
            kind: PluginCallErrorKind::Json(format!("序列化调用参数失败：{err}")),
        })?;

        let result_json = self.context.with(|ctx| {
            let func: Function = ctx
                .globals()
                .get("__gs_call")
                .map_err(|err| PluginCallError {
                    plugin_id: plugin_id.to_string(),
                    path: path.to_string(),
                    kind: PluginCallErrorKind::Engine(format!("取 __gs_call 失败：{err}")),
                })?;
            func.call::<_, String>((plugin_id, path, args_json.as_str()))
                .catch(&ctx)
                .map_err(|caught| self.build_call_error(plugin_id, path, caught))
        })?;

        serde_json::from_str(&result_json).map_err(|err| PluginCallError {
            plugin_id: plugin_id.to_string(),
            path: path.to_string(),
            kind: PluginCallErrorKind::Json(format!(
                "解析返回值 JSON 失败：{err}（原文：{result_json}）"
            )),
        })
    }

    /// 把 QuickJS 的 `CaughtError` 转换成带映射栈的 [`PluginCallError`]。
    fn build_call_error(
        &self,
        plugin_id: &str,
        path: &str,
        caught: CaughtError<'_>,
    ) -> PluginCallError {
        let kind = match caught {
            CaughtError::Exception(exc) => {
                let message = exc
                    .message()
                    .unwrap_or_else(|| "<没有 message 字段>".to_string());
                let mapped_stack = exc
                    .stack()
                    .map(|stack| map_stack_trace(&stack))
                    .unwrap_or_default();
                PluginCallErrorKind::Exception {
                    message,
                    mapped_stack,
                }
            }
            CaughtError::Value(value) => PluginCallErrorKind::ThrownValue {
                debug: format!("{value:?}"),
            },
            CaughtError::Error(err) => PluginCallErrorKind::Engine(err.to_string()),
        };
        PluginCallError {
            plugin_id: plugin_id.to_string(),
            path: path.to_string(),
            kind,
        }
    }
}

fn describe_caught(caught: &CaughtError<'_>) -> String {
    match caught {
        CaughtError::Exception(exc) => {
            let message = exc.message().unwrap_or_default();
            match exc.stack() {
                Some(stack) => format!("{message}\n{stack}"),
                None => message,
            }
        }
        other => other.to_string(),
    }
}

// ============================================================
// 栈帧映射
// ============================================================

/// 把 QuickJS 的 `error.stack` 文本逐行映射回原始源码位置。
///
/// QuickJS 的栈帧格式形如 `"    at functionName (plugins.bundle.js:123:45)"`
/// 或省略函数名的 `"    at plugins.bundle.js:123:45"`；不满足这个形状的行
/// （比如首行的 `"Error: message"`）原样透传，`original` 留空。
fn map_stack_trace(stack: &str) -> Vec<MappedFrame> {
    stack
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let original = parse_generated_location(line)
                .and_then(|(gen_line, gen_col)| lookup_original_location(gen_line, gen_col));
            MappedFrame {
                generated: line.trim().to_string(),
                original,
            }
        })
        .collect()
}

/// 从一行栈帧文本里抠出 `行:列`（1-based，QuickJS/V8 风格栈帧的惯例）。
/// 只认形如 `BUNDLE_MODULE_NAME:行:列` 的片段，避免把消息文本里偶然出现的
/// `数字:数字` 误判成位置。
fn parse_generated_location(line: &str) -> Option<(u32, u32)> {
    let marker = format!("{BUNDLE_MODULE_NAME}:");
    let after = line.rsplit_once(&marker)?.1;
    // after 形如 "123:45)" 或 "123:45"，先去掉可能存在的右括号等尾随字符。
    let digits_only: String = after
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == ':')
        .collect();
    let mut parts = digits_only.splitn(2, ':');
    let line_no: u32 = parts.next()?.parse().ok()?;
    let col_no: u32 = parts.next()?.parse().ok()?;
    Some((line_no, col_no))
}

fn lookup_original_location(generated_line: u32, generated_col: u32) -> Option<OriginalLocation> {
    let map = bundle_source_map()?;
    // sourcemap 规范里生成端位置是 0-based，QuickJS 栈帧给的是 1-based，
    // 因此这里各减一；两者若已经是 0（理论上不会，1-based 最小值是 1）用
    // saturating 兜底，不 panic。
    let token = map.lookup_token(
        generated_line.saturating_sub(1),
        generated_col.saturating_sub(1),
    )?;
    let file = token.get_source().map(normalize_source_path)?;
    Some(OriginalLocation {
        file,
        line: token.get_src_line() + 1,
        column: token.get_src_col() + 1,
        symbol_name: token.get_name().map(|s| s.to_string()),
    })
}

/// sourcemap 里的 `sources` 记录的是相对打包脚本运行目录的路径（形如
/// `"../plugins/genshin/hooks.ts"`），这里去掉前导的 `../`，让报错信息里
/// 看到的路径接近仓库里真实的 `plugins/genshin/hooks.ts`，不强求字节级
/// 精确匹配（不同操作系统/工作目录下这个前缀本身就可能变化）。
fn normalize_source_path(raw: &str) -> String {
    let mut path = raw.replace('\\', "/");
    while let Some(stripped) = path.strip_prefix("../") {
        path = stripped.to_string();
    }
    while let Some(stripped) = path.strip_prefix("./") {
        path = stripped.to_string();
    }
    path
}

fn bundle_source_map() -> Option<&'static sourcemap::SourceMap> {
    static MAP: OnceLock<Option<sourcemap::SourceMap>> = OnceLock::new();
    MAP.get_or_init(|| {
        let reference =
            sourcemap::locate_sourcemap_reference_slice(PLUGIN_BUNDLE_SOURCE.as_bytes()).ok()??;
        let url = reference.get_url();
        let encoded = url.rsplit_once("base64,")?.1;
        let decoded = decode_base64(encoded)?;
        sourcemap::SourceMap::from_slice(&decoded).ok()
    })
    .as_ref()
}

/// 极简 base64 解码（标准字母表，容忍 `=` 填充与空白）。不引入
/// `base64`/`data-encoding` 之类的专门 crate——inline sourcemap 只在
/// [`PluginRuntime`] 启动时解码一次，用量小到不值得为此新增一个依赖，
/// 手写实现的正确性由下方单元测试覆盖。
fn decode_base64(input: &str) -> Option<Vec<u8>> {
    fn sextet(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let sextets: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .map(sextet)
        .collect::<Option<_>>()?;

    let mut out = Vec::with_capacity(sextets.len() * 3 / 4 + 3);
    for chunk in sextets.chunks(4) {
        match chunk {
            [a, b, c, d] => {
                out.push((a << 2) | (b >> 4));
                out.push((b << 4) | (c >> 2));
                out.push((c << 6) | d);
            }
            [a, b, c] => {
                out.push((a << 2) | (b >> 4));
                out.push((b << 4) | (c >> 2));
            }
            [a, b] => {
                out.push((a << 2) | (b >> 4));
            }
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_plugin_sdk_version_accepts_same_major_version() {
        validate_plugin_sdk_version("hypothetical-plugin", gs_core::HOST_SDK_VERSION)
            .expect("宿主自己声明的版本号必须视为兼容");
    }

    #[test]
    fn validate_plugin_sdk_version_rejects_incompatible_major_version() {
        // 未来外部贡献者场景的直接证明：一个声明了不兼容 major 版本号的插件
        // 必须在这里被拒绝，不能被静默接受——这正是本函数存在的理由，见其
        // 文档注释。当前仓库内四个插件不可能触发这条路径（全部声明
        // "1.0.0"），因此必须用合成输入单独证明。
        let err = validate_plugin_sdk_version("hypothetical-plugin", "2.0.0")
            .expect_err("主版本号不同应当被拒绝");
        let message = err.to_string();
        assert!(message.contains("hypothetical-plugin"));
        assert!(message.contains("2.0.0"));
        assert!(message.contains(gs_core::HOST_SDK_VERSION));
    }

    #[test]
    fn validate_plugin_sdk_version_rejects_malformed_version_string() {
        let err = validate_plugin_sdk_version("hypothetical-plugin", "not-a-version")
            .expect_err("无法解析的版本号应当被拒绝，而不是放行");
        assert!(err.to_string().contains("无法解析"));
    }

    #[test]
    fn assert_all_registered_plugins_support_host_sdk_version_passes_for_the_real_bundle() {
        // 回归覆盖：真实的四个已注册插件全部声明 "1.0.0"，与
        // gs_core::HOST_SDK_VERSION 同一个 major，逐个校验应当全部通过。
        assert_all_registered_plugins_support_host_sdk_version()
            .expect("当前仓库内四个插件的 sdkVersion 都应当与宿主兼容");
    }

    #[test]
    fn decode_base64_round_trips_known_vectors() {
        // 标准测试向量（RFC 4648 附录）。
        assert_eq!(decode_base64("").unwrap(), b"".to_vec());
        assert_eq!(decode_base64("Zg==").unwrap(), b"f".to_vec());
        assert_eq!(decode_base64("Zm8=").unwrap(), b"fo".to_vec());
        assert_eq!(decode_base64("Zm9v").unwrap(), b"foo".to_vec());
        assert_eq!(decode_base64("Zm9vYg==").unwrap(), b"foob".to_vec());
        assert_eq!(decode_base64("Zm9vYmE=").unwrap(), b"fooba".to_vec());
        assert_eq!(decode_base64("Zm9vYmFy").unwrap(), b"foobar".to_vec());
    }

    /// `plugin_manifest_data` 本身的通用行为（能读到纯数据、未知插件返回
    /// `None`）已经在 `gs-manifest-data` 自己的测试里覆盖，不在这里重复。
    /// 这里只验证两件与本 crate 的实际消费方（`gs-p-authkey`）密切相关、
    /// `gs-manifest-data` 的测试不会去管的事：① 重导出确实能被
    /// `gs_plugin_runtime::plugin_manifest_data` 这条既有调用路径用到；
    /// ② `RegExp` 被打包脚本转换成 `{ source, flags }` 的契约仍然成立——
    /// `gs-p-authkey` 的 `CredentialJson::ChromiumCache.url_pattern` 直接
    /// 依赖这个形状，形状变了它会反序列化失败。
    #[test]
    fn reexported_plugin_manifest_data_preserves_regexp_shape_contract() {
        let manifest =
            plugin_manifest_data("genshin").expect("genshin 插件应当已被打包进 manifest JSON");
        assert!(manifest["collect"]["params"]["credential"]["urlPattern"]["source"].is_string());
    }

    /// HC-2 审计——逐个断言 [`FORBIDDEN_GLOBALS`] 在 QuickJS 里确实是
    /// `undefined`。`PluginRuntime::new` 内部已经做过一遍同样的自检
    /// （见 `assert_forbidden_globals_absent`），这里独立重跑一遍是因为
    /// brief 明确要求"写一个测试逐个断言"——测试要能在不看实现代码的情况下
    /// 单独证明这条安全属性成立，不能只依赖构造函数不 panic 这一个信号。
    #[test]
    fn forbidden_globals_are_absent() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        for name in FORBIDDEN_GLOBALS {
            let is_undefined: bool = runtime
                .context
                .with(|ctx| ctx.eval(format!("typeof {name} === \"undefined\"")))
                .unwrap_or_else(|_| panic!("检查全局量 \"{name}\" 时执行失败"));
            assert!(
                is_undefined,
                "HC-2 违反：\"{name}\" 在 QuickJS 里不是 undefined"
            );
        }
    }

    #[test]
    fn injected_globals_list_is_empty() {
        // 见 INJECTED_GLOBALS 文档注释：宿主不应向 QuickJS 注入任何全局量，
        // 这条断言把"清单为空"这件事变成一个会随代码演进而持续验证的事实，
        // 而不是文档里一句容易过时的话。
        assert!(INJECTED_GLOBALS.is_empty());
    }

    #[test]
    fn call_extract_record_returns_unified_record_fields() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let raw = serde_json::json!({
            "uid": "100000000",
            "gacha_type": "301",
            "count": "1",
            "time": "2026-06-18 21:15:32",
            "name": "测试五星角色A",
            "lang": "zh-cn",
            "item_type": "角色",
            "rank_type": "5",
            "id": "1400000000000000010",
        });
        let result = runtime
            .call("genshin", "manifest.fields.extractRecord", &[raw])
            .expect("extractRecord 应当成功");
        assert_eq!(result["itemId"], serde_json::json!("测试五星角色A"));
        assert_eq!(result["bannerId"], serde_json::json!("301"));
        assert_eq!(result["stableId"], serde_json::json!("1400000000000000010"));
    }

    #[test]
    fn call_has_reports_hooks_presence_without_invoking() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        assert!(
            runtime
                .has("genshin", "hooks.deriveRecordKey")
                .expect("has 调用不应失败")
        );
        assert!(
            runtime
                .has("genshin", "hooks.resolveTimezone")
                .expect("has 调用不应失败")
        );
        assert!(
            !runtime
                .has("genshin", "hooks.countDraws")
                .expect("has 调用不应失败")
        );
        assert!(
            !runtime
                .has("genshin", "hooks.doesNotExist")
                .expect("has 调用不应失败")
        );
    }

    /// 错误可读性是硬要求：插件函数抛错时，Rust 侧拿到的错误信息必须包含
    /// 原始 TS 文件名与行号，不能吞成一句"插件执行失败"。
    ///
    /// `plugins/genshin/hooks.ts` 的 `deriveRecordKey` 在 `record.stableId`
    /// 缺失时会 `throw new Error(...)`，这里故意不传 `stableId` 触发它。
    #[test]
    fn plugin_exception_error_message_contains_original_ts_location() {
        let runtime = PluginRuntime::new().expect("插件运行时应当能正常启动");
        let record_without_stable_id = serde_json::json!({
            "itemId": "测试四星角色D",
            "time": "2026-06-05 19:30:00",
            "bannerId": "301",
            "count": 1,
        });
        let err = runtime
            .call(
                "genshin",
                "hooks.deriveRecordKey",
                &[record_without_stable_id],
            )
            .expect_err("缺少 stableId 应当触发插件抛出异常");

        let PluginCallErrorKind::Exception {
            message,
            mapped_stack,
        } = &err.kind
        else {
            panic!("期望 Exception 变体，实际是 {err:?}");
        };
        assert!(
            message.contains("stableId"),
            "错误信息应包含插件抛出的原始 message：{message}"
        );

        let rendered = err.to_string();
        assert!(
            rendered.contains("plugins/genshin/hooks.ts"),
            "错误信息应包含原始 TS 文件名，实际输出：\n{rendered}"
        );
        assert!(
            mapped_stack.iter().any(|frame| frame.original.is_some()),
            "调用栈里应当至少有一帧被成功映射回原始源码，实际：{mapped_stack:?}"
        );
    }
}
