#!/usr/bin/env node
// HC-4 · 声明必被消费
//
// 起因：M1-S7 纸面填表演练发现 packages/gs-plugin-kit 契约里声明的三个字段
// （TimezoneSource.apiField/staticTable、BannerSpec.endpointOverride、
// TimeConfig.rawTimeConvention）在 L1（crates/paradigms）执行链路里，要么被
// `#[allow(dead_code)]` 解析出来后直接弃置，要么干脆没有对应的 Rust 镜像
// 字段——类型检查、原有 gs:check 三道门、代码 review 全部亮绿灯，运行时却
// 静默不生效。这是比字段缺失更坏的失败模式：缺失会报错，这个不会。
//
// 本门机械断言：CONTRACT_SECTIONS 里登记的每个契约类型，每个字段都要满足
// 三条（`rustStruct` 镜像结构体模式，多数区块走这条）：
//   ② 在对应的 Rust `*Json` 镜像结构体里能找到同名字段——不满足说明契约
//      字段完全没有 Rust 镜像，serde 会静默忽略未知字段（不报错）。
//   ① 找到的镜像字段没有标 `#[allow(dead_code)]`——标了说明作者已经承认
//      解析出来之后没有代码路径读取它。
//   ③ 在声明它的文件之外，`crates/**/*.rs` 里至少有一处非测试代码读取过
//      这个字段的 Rust 标识符——找不到说明"解析了、结构体里有，但全文没有
//      任何读取处"。
//
// 第二种登记方式（`consumption: 'literalRead'`，M2-S7 新增，见 Precondition
// 区块）：字段没有具名 Rust 镜像结构体可找——典型场景是走
// `serde_json::Value::get("字段名")` 动态取值，或按路径字符串调用宿主运行时
// 里的函数，JSON 反序列化根本不经过一个"结构体"。这类字段不跑上面①②③，
// 换成单一判定：`crates/**/*.rs` 里能不能找到形如 `.get("字段名")` 的字面量
// 读取文本。两种模式共用同一份"消费扫描语料库"，见 buildConsumptionCorpus。
//
// 扫描范围原先只有 `crates/paradigms/**/*.rs`——M1 阶段登记的五个区块（见下）
// 消费点确实都落在这里，但这只是偶然：契约字段的真实消费点不必然落在
// paradigm 层，也可能在 `crates/gs-analysis`（分析引擎读保底/欧非规则）、
// `crates/gs-exchange`（交换适配器）、`crates/gs-host`（宿主运行时）。
// M2-S7 把扫描根目录扩到整个 `crates`，显式排除
// `crates/gs-plugin-runtime/generated/`（插件构建产物目录，理由见
// EXCLUDED_RUST_SCAN_DIRS 的注释）。
//
// 覆盖范围是显式登记制，不是自动扫描 PluginManifest 的全部字段——
// `displayName`/`iconUrl`/`maintainers` 这类纯展示字段，本来就不该有 L1
// Rust 消费点，硬要求它们"被消费"只会制造一个要么永远为红、要么被迫塞满
// 摆设白名单的门。只登记"契约上明确要求驱动 L1 执行行为"的字段区块，新增
// 区块时在 CONTRACT_SECTIONS 里追加一项即可。
//
// 白名单（knownUnconsumed）用于登记"已确认无需消费"的具体字段，必须带理由，
// 且理由会打印进本门的输出——不能静默豁免，让人看不见有字段进了白名单。
//
// 修复记录（M2-S7 之后）：countWholeWordOccurrences 原先直接在"剥了测试
// 模块、其余原样保留"的全文上数标识符出现次数，两类"形状像消费、实则不是
// 消费"的文本足以顶替真实消费点——① 非测试区的文档注释提到了字段名（如
// `pity.rs` 解释 `hard_pity` 语义的一句话）；② 字段名以"标识符紧跟冒号"的
// 形状出现在别处，包括不相关类型的同名字段声明（`PityGroupReport` 与本门
// 实际校验的 `PityGroup` 恰好都有 `hard_pity` 字段）与结构体字面量的初始化
// 标签（把 `hard_pity: group.hard_pity` 改坏成 `hard_pity: 0` 但不动标签）。
// 现在用 `stripComments`（逐字符状态机剥注释，跳过字符串/字符/原始字符串
// 字面量内容，避免把 URL 模板 `"https://..."` 这类字符串误当注释删掉制造
// 假阴性）与 `countWholeWordOccurrences` 里的 `(?!\s*:)` 负向先行断言
// （排除"标识符紧跟冒号"这个declaration/字面量标签/解构重命名共享的形状）
// 堵住了这两类。堵住之后如实查出一个此前被文档注释掩盖的真实缺口——
// `CredentialSource.gameDir`，见该字段登记处的注释，没有加白名单掩盖。
//
// 已知局限（如实记录，不假装覆盖一切）：
//   - 字段名提取靠正则匹配 ts-rs 输出的固定形状（`export type X = { a: T,
//     b?: U, } | ...;`），不处理字段类型本身是内联对象字面量的情况——
//     ts-rs 目前的输出里没有这种形状（嵌套结构总是被 factor 成独立命名
//     类型），因此不在本检查覆盖范围内。`interface` 语法（`extractTsInterface
//     Fields`）同理，只认成员级别的字段，不下钻内联对象字面量。
//   - "消费"判定仍然是标识符出现次数的启发式匹配，不是真正的数据流分析——
//     例如把字段读出来又立刻丢弃（`let _ = x.foo;`）会被误判为"已消费"；
//     解构时重命名成不同名字的绑定（`{ game_dir: dir, .. }` 之后只用
//     `dir`）会被 `(?!\s*:)` 正确地不算进"标签"，但如果那份重命名后的
//     绑定就是全部消费点、原字段名再没出现过，也会被判成"未消费"——这类
//     情况留给代码 review，机械检查只兜底"完全没人碰过"这个更容易被忽视的
//     失败模式。
//   - `stripComments` 的原始字符串处理做了简化：只认标准的 `r"..."`/
//     `r#"..."#`/`br"..."`（不认 2024 edition 的 `c"..."`/`cr"..."`），且
//     字符字面量对占多个 UTF-16 代码单元的字符（生僻字/emoji）不生效，
//     具体边界见 `matchRawStringStart`/`matchCharLiteral` 的文档注释。
//   - `(?!\s*:)` 只是文本形状排除，不是语法分析——字段名如果以字符串字面量
//     形式出现在某个不相关的属性里（如 `#[serde(alias = "hard_pity")]`，
//     本仓库当前没有这种写法），不会被这条规则挡住，因为它不是"标识符紧跟
//     冒号"的形状，仍会被误判成"已消费"。
//   - `literalRead` 模式的判定是纯文本匹配 `.get("字段名")`，如果扫描范围内
//     某处代码恰好因为完全无关的原因写了同名字面量（比如解析另一个毫不相干
//     的 JSON 对象时也用了 `.get("id")`），会被误判成"已消费"。这类假阳性
//     同样留给代码 review，机械检查只兜底"整个扫描范围完全没出现过这个读取
//     模式"这个更容易被忽视的失败模式——和上面标识符匹配的局限是同一个
//     写法基调，不重复展开。

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE = 'HC-4 声明必被消费（契约字段必须能在 L1 找到真实消费点）';

const RUST_SCAN_ROOT_DIR = 'crates';

/**
 * 扫描根目录下需要显式排除的子目录，按仓库相对路径精确匹配（不用裸目录名
 * `'generated'` 做排除——万一将来别处也出现一个叫 `generated` 但含义不同
 * 的目录，裸名匹配会误伤，按完整相对路径匹配更安全）。
 *
 * `crates/gs-plugin-runtime/generated/` 是插件构建产物目录（内容是
 * `plugins.bundle.js`/`plugins.manifest.json`，运行时被
 * `crates/gs-manifest-data` 用 `include_str!` 读入）。这个目录目前没有任何
 * `.rs` 文件，`collectRustFiles` 只收 `.rs` 后缀，天生就扫不到它——但这是
 * "这个目录里恰好只有 .js/.json，凑巧没被后缀过滤器捡到"这个脆弱的隐式
 * 前提带来的免疫，不是设计上的排除。显式列在这里是防御性的：万一将来这个
 * 目录被塞进一个 build.rs 生成的 `.rs` 胶水文件、原样带着整份 manifest
 * JSON 的字面量文本，任何字段查字面量都会"命中"——尤其是新增的 literalRead
 * 模式（见下方 checkLiteralReadSection），本门就会对着生成产物里的字面量
 * 误判"已消费"，这道门就成了摆设。
 */
const EXCLUDED_RUST_SCAN_DIRS = ['crates/gs-plugin-runtime/generated'];

/**
 * 显式登记制：只登记"契约上明确要求驱动 L1 执行行为"的类型区块。
 *
 * 默认（不写 `tsKind`/`consumption`）是 M1 阶段的原始判定方式：
 * `rustStruct` 按本仓库既有命名约定——`Xxx`（TS 契约类型）↔ `XxxJson`
 * （Rust 镜像结构体/枚举），见 crates/paradigms/gs-p-authkey/src/pipeline.rs
 * 里 ManifestDataJson/TimeConfigJson/TimezoneSourceJson/BannerSpecJson 等，
 * 字段来源是 `export type X = {...}`（ts-rs 生成或手写的类型别名）。
 *
 * 两个可选字段用来登记 M2-S7 新增的场景：
 *   - `tsKind: 'interface'`：字段来源是 `export interface X {...}`
 *     （TS interface 语法），不是类型别名——见 Precondition 区块。
 *   - `consumption: 'literalRead'`：没有具名 Rust 镜像结构体，靠字面量
 *     `.get("字段名")` 判定消费——见下方 checkLiteralReadSection。
 *
 * 第三个可选字段 `onlyFields`（2026-08-17 新增，见 PluginManifest 区块）：
 * 把本区块实际检查的字段范围缩小到这个数组列出的子集，其余从 TS 类型里
 * 提取出的字段完全不检查（既不要求消费，也不出现在输出里）。
 *
 * 存在动机：`PluginManifest` 是一个近 20 字段的大接口，多数字段本来就不该
 * 由本门判定——要么已经通过它们各自的具名类型（`BannerSpec`/`TimeConfig`/
 * `PityGroup`/`RetentionPolicy`/…）单独登记过，要么是 `id`/`displayName`/
 * `collect`/`fields` 这类字段，真实消费点用的是 `root["字段名"]` 下标语法
 * （`crates/gs-analysis/src/manifest_lookup.rs` 的
 * `pity_groups_for`/`rarity_spec_for`/`banners_for`/`display_name_for`
 * 等），不是 `literalRead` 模式认的 `.get("字段名")` 字面量形状——把整个
 * `PluginManifest` 登记成一个区块会把这批字段一起拖进来，制造与登记动机
 * 无关的假阳性。`onlyFields` 让一次登记只精确覆盖真正要新增判定的字段，
 * 其余交给各自已有的登记路径或"本来就不该登记"的既定原则（文件头部
 * "覆盖范围是显式登记制"一节），不重复判定。
 *
 * 若 `onlyFields` 列出的字段在源码里实际提取不出来（比如字段改名、类型改
 * 写法），本门会在这里报一条 finding 提示登记已过期，不会静默漏检——见
 * `checkSection` 里对 `onlyFields` 子集的校验。
 */
const CONTRACT_SECTIONS = [
  {
    tsType: 'TimeConfig',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'TimeConfigJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
    knownUnconsumed: [
      {
        field: 'rawTimeConvention',
        reason:
          'M1 阶段没有 clientLocalized 场景的消费点（要等"导入第三方已换算存档"这条路径落地）——' +
          '已解析并存进 AuthkeyApiPipeline.raw_time_convention 字段、有专门的单元测试验证解析正确性，' +
          '只是刻意不接执行逻辑，见该字段的文档注释与 AUDIT-2026-08-11-S7纸面填表演练.md §2.3。',
      },
    ],
  },
  {
    tsType: 'TimezoneSource',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'TimezoneSourceJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
  },
  {
    tsType: 'BannerSpec',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'BannerSpecJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
    knownUnconsumed: [
      {
        field: 'displayName',
        reason:
          '展示字段，L1 采集流水线不需要它（本区块盯的 BannerSpecJson 是 gs-p-authkey ' +
          '的采集侧镜像，它只关心怎么把卡池拉下来，不关心卡池叫什么）。' +
          '⚠️ 但它**不是没人消费**：gs-host/src/catalog.rs 读 gs_core::BannerSpec 的 ' +
          'display_name 并经 list_games 命令送给前端，有测试断言（catalog.rs ' +
          '“genshin_view_carries_display_name_ladder_and_banner_labels”）。' +
          '本白名单豁免的只是“L1 采集侧镜像不消费”这一条，不代表该字段是死字段。' +
          '（2026-08-17 更正：此处原写“前端直接读 manifest bundle 原始 JSON 渲染”，' +
          '那是错的——插件打包进 crates/gs-plugin-runtime/generated/plugins.bundle.js ' +
          '给 QuickJS 用，web/tsconfig.json 只 include src，前端根本读不到它。' +
          'list_games 命令存在的全部理由就是这个。）',
      },
    ],
  },
  {
    // CredentialSource 是手写契约类型（含 RegExp 字段，ts-rs 无法生成），
    // 定义在 manifest.ts 而不是 types/generated.ts——这也是新增本区块前
    // 必须先修 extractTsTypeFields/findTypeAliasEnd 的原因，见两个函数的
    // 文档注释。
    //
    // M2-S3：logPath 字段原有的 knownUnconsumed 白名单条目已移除——该白名单
    // 存在的唯一理由是"真实读取实现（鸣潮 Client.log 异或解混淆）还没落地"，
    // 这个理由到 M2-S3 已经不成立，登记时就写明了"接上真实读取逻辑后必须
    // 移除本条白名单"。若本门此刻仍对 logPath 报红，说明 Rust 侧
    // CredentialJson::LogFile 的消费点尚未接上，应等 Rust 侧落地后转绿，
    // 不应该把白名单加回来糊弄过去。
    //
    // ⚠️ **本门抓到过的第一个真缺口，留档**（M2-S7，2026-08-13）：
    // 把消费判定改成"排除注释与声明标签"之后，`gameDir` 立刻报红。查证
    // 确认不是假阳性——`crates/` 里除声明本身与测试代码外，找不到任何读取
    // 它的非测试代码：生产路径唯一调用 `scan_game_cache` 的地方是
    // `cache_scan.rs` 自己的单元测试，`CredentialSource` 判别联合的两个
    // 分支只有 `logFile` 接进了 pipeline（`resolve_log_credential`），
    // `chromiumCache` 没有对称方法。此前它一直"绿"，是因为
    // `cache_scan.rs` 有两处文档注释提到 `game_dir`，把注释算成了消费。
    //
    // 处理方式是**补上缺失的对称方法** `AuthkeyApiPipeline::
    // resolve_cache_credential`，不是加白名单——加白名单等于用一句听起来
    // 合理的理由把红灯解释掉，而这道门存在的全部意义就是不让那种事发生。
    // 现已转绿，且是真绿。
    tsType: 'CredentialSource',
    tsFile: 'packages/gs-plugin-kit/manifest.ts',
    rustStruct: 'CredentialJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
  },
  {
    // ★ HC-4 CONTRACT_SECTIONS 漏登记的第二个实例，登记本身怎么漏掉的：
    // CONTRACT_SECTIONS 是手工维护的清单，新增一个契约类型（如
    // RequestTemplate）时如果忘了同步在这里补一项，门禁完全看不见它——
    // 不会报错、不会有任何提示，因为检查逻辑只遍历这个数组里显式登记的
    // 条目，不会自动扫描 manifest.ts / types/generated.ts 里声明过的全部
    // 类型。第一次发生在 `CredentialSource`（本区块，见上方历史注释）；
    // 这是第二次——`RequestTemplate` 早在 M1 就已经生成进
    // types/generated.ts，但从未被登记进本数组，门禁对它形同虚设了整个
    // M1 阶段。
    //
    // 本次登记顺带发现的真实漏洞：generated.ts 的 RequestTemplate 有
    // `url`/`method`/`headers`/`body` 四个字段，但 pipeline.rs 的
    // RequestTemplateJson 只镜像了 url 与 body，method/headers 在
    // crates/paradigms 里零消费（`request.method`/`request.headers` 声明了
    // 却从未被读取过）——本门就是为了拦这类"声明了但没消费"的字段，加上
    // 这项登记后会如实报红，不应该为了变绿而追加白名单。
    tsType: 'RequestTemplate',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'RequestTemplateJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
  },
  {
    // M2-S7：扫描范围扩到整个 crates/ 之前，PityGroup 的 hardPity/curve/
    // guarantee/pityTarget 四个字段没法登记——这四个字段按设计根本不在
    // paradigm 层消费，而是在 crates/gs-analysis 的通用分析引擎里消费（保底
    // 命中判定、概率曲线求值属于"跨游戏同构算法"，见项目 CLAUDE.local.md
    // 「核心设计要点」），旧的 PARADIGMS_RELATIVE_DIR 扫描范围看不到它们，
    // 硬登记只会产生结构性假阳性（即使真消费了也报红）。
    //
    // 镜像结构体不在 crates/paradigms/ 里，注意甄别：
    // crates/paradigms/gs-p-authkey/src/pipeline.rs 里也有一个
    // `struct PityGroupJson { key: String, members: Vec<String> }`，但那只是
    // paradigm 层为了路由需要摘的一个残缺子集（只要 key/members 判断卡池
    // 属于哪个保底组，不需要 hardPity 等分析用字段），拿它当镜像会漏掉
    // hardPity/curve/guarantee/pityTarget 四个字段的消费检查。真正完整的
    // 镜像是 crates/gs-core/src/pity.rs 里的 `pub struct PityGroup`——它本身
    // 就带 `#[derive(..., Serialize, Deserialize, TS)]`，ts-rs 直接从它生成
    // types/generated.ts 里的 PityGroup 类型，是自己镜像自己，不是另找了个
    // `*Json` 后缀的副本，所以这里 rustStruct 直接写 'PityGroup'。
    tsType: 'PityGroup',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'PityGroup',
    rustFile: 'crates/gs-core/src/pity.rs',
  },
  {
    // M2-S7：Precondition 走 serde_json::Value::get("id"/"capability"/
    // "level"/"remedy") 动态取值（crates/paradigms/gs-p-authkey/src/
    // pipeline.rs 的 check_preconditions 方法），不经具名 struct 反序列化——
    // findRustTypeBody 靠正则找 struct/enum X，这种模式根本没有对应的镜像
    // struct 可找，旧版检查会直接报"完全没有 Rust 镜像结构体"，但这四个
    // 字段其实都被真实消费了，是检测机制对"动态 Value 读取"的盲区，不是
    // 真缺口。换用 consumption: 'literalRead'，判定标准改成"扫描范围内能否
    // 找到 .get("字段名") 这样的字面量读取"。
    //
    // Precondition 还是本仓库第一个用 `export interface` 声明（而非
    // `export type X =` 类型别名）的契约类型，因此同时登记 tsKind:
    // 'interface'，走 extractTsInterfaceFields 而不是 extractTsTypeFields。
    // rustFile 在 literalRead 模式下只作人工定位用的元信息（checkLiteral
    // ReadSection 不会拿它做消费扫描或掩码），指向 check_preconditions 所在
    // 文件方便 review 时跳转。
    tsType: 'Precondition',
    tsFile: 'packages/gs-plugin-kit/manifest.ts',
    tsKind: 'interface',
    consumption: 'literalRead',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
    knownUnconsumed: [
      {
        field: 'describe',
        reason:
          '展示字段（前置条件的说明文案），Rust 侧确无消费点。但**不是无人把关**：' +
          'REQWORD 门（checks/precondition-wording.mjs）从 plugins.manifest.json 读它，' +
          '机械检查 level 为 required 的文案里不得出现「建议/推荐/最好」——' +
          '措辞与代码行为不一致比不写更有害，那道门就是为它建的。' +
          '⚠️ 呈现侧尚未落地：前端 grep "precondition" 零命中，SDK §3.8 要求的三个呈现时机' +
          '（入口渲染 / 触发前禁用 / 失败补救）一个都没做，随 S3 采集接线一并补。' +
          '（2026-08-17 更正：此处原写“前端/UI 直接读原始 manifest JSON 渲染”，' +
          '那是错的——前端读不到 manifest bundle，理由同 BannerSpec.displayName 那条白名单。）',
      },
      {
        field: 'check',
        reason:
          '函数字段，manifest 序列化成纯数据 JSON 时函数值本身不会被序列化进去，Rust 侧不是按字段名读它，' +
          '而是通过 self.plugin_runtime.call(&self.plugin_id, &format!("manifest.preconditions.{index}.check"), ...) ' +
          '按路径字符串调用 QuickJS 里的实际函数（见 pipeline.rs check_preconditions 方法），不适用' +
          '"字段名对应 Rust 消费"这个判定框架，无论是 rustStruct 模式还是 literalRead 模式都测不出来。',
      },
    ],
  },
  {
    // 「数据保留期提醒」功能补的登记：manifest 的 retention 字段声明了三个月
    // （从 M1-S1 落地到 2026-08-17）都没有被 Rust 侧读过——`conservativeDays`
    // 一直只是从 JSON 反序列化出来又立刻被丢弃，`account.retention_days`
    // 这一列因此从建库起就恒为 NULL，本门当时还没登记这个区块，看不见这个
    // 缺口。这次补上消费点（`crates/gs-host/src/archive.rs` 建账号时写入、
    // `crates/gs-host/src/retention.rs` 补写历史空洞的账号）之后，顺带把
    // 登记也补上，避免同一类"声明了没人读"的缺口再次不被发现。
    //
    // 自己镜像自己，理由与上面 PityGroup 完全一致：`RetentionPolicy` 定义
    // 在 crates/gs-core/src/record.rs，本身就带
    // `#[derive(..., Serialize, Deserialize, TS)]`，ts-rs 直接从它生成
    // types/generated.ts 里的 RetentionPolicy 类型，不是另找了个 `*Json`
    // 后缀的副本，所以 rustStruct 直接写 'RetentionPolicy'。
    tsType: 'RetentionPolicy',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'RetentionPolicy',
    rustFile: 'crates/gs-core/src/record.rs',
    knownUnconsumed: [
      {
        field: 'displayText',
        reason:
          '保留期的展示文案（如"6 个月"）。本轮任务范围只覆盖 conservativeDays 驱动的风险计算与建账号补写' +
          '（crates/gs-host/src/archive.rs、crates/gs-host/src/retention.rs），displayText 尚无 Rust 消费点——' +
          '不像 BannerSpec.displayName 那样有可以类比的"前端读原始 JSON"路径（`web/` 的 tsconfig 不 include ' +
          '插件 manifest bundle，见 crates/gs-host/src/views.rs 模块文档），如果后续要在界面上展示这段文案，' +
          '需要与 conservativeDays 一样通过 IPC 视图透出，届时应在这里移除本条白名单，不是继续加理由续期。',
      },
    ],
  },
  {
    // 2026-08-17：扫描 PluginManifest 全部顶层字段（19 个）发现登记制留下的
    // 盲区——platforms/sdkVersion 是两个"承重"字段（真正驱动 L1 执行行为），
    // 却从未被登记过，也从未被消费过；iconUrl/metadata/drawCounting/
    // maintainers/exchangeFormats 五个字段同样从未登记，但逐个核实后确认
    // 是"暂时确无消费点，但理由各不相同"的白名单，不是遗漏。
    //
    // 只用 onlyFields 登记这 7 个字段，不登记整个 PluginManifest——理由见
    // CONTRACT_SECTIONS 顶部关于 onlyFields 的说明，这里不重复。
    tsType: 'PluginManifest',
    tsFile: 'packages/gs-plugin-kit/manifest.ts',
    tsKind: 'interface',
    consumption: 'literalRead',
    onlyFields: [
      'platforms',
      'sdkVersion',
      'iconUrl',
      'metadata',
      'drawCounting',
      'maintainers',
      'exchangeFormats',
    ],
    // 两个真消费点分别落在 gs-analysis（platforms_for，crates/gs-analysis/
    // src/manifest_lookup.rs）与 gs-plugin-runtime（sdkVersion 校验，
    // crates/gs-plugin-runtime/src/lib.rs），不在同一个文件——literalRead
    // 模式下 rustFile 只是人工定位用的元信息，不参与实际扫描（扫描范围本就
    // 是整个 crates/**/*.rs），这里指向前者。
    rustFile: 'crates/gs-analysis/src/manifest_lookup.rs',
    knownUnconsumed: [
      {
        field: 'iconUrl',
        reason:
          '图标下载/缓存管线尚未实现——manifest.ts 对本字段的文档已经写清楚落地形态（限 https、由宿主下载' +
          '缓存、不提供通用 fetchAsset 窄口、落盘前按 content-type + magic bytes 校验、不按扩展名判断），' +
          '但当前四个插件全部省略这个可选字段（0/4 声明），Rust 侧自然没有消费点——没有值可读，谈不上' +
          '"声明了没消费"。前端已经有"游戏名首字 + 游戏色圆底"的兜底渲染（web/src/lib/game-icon.ts 等），' +
          '缺省路径完整可用，不是被卡住的功能。移除条件：任意插件真的声明 iconUrl 且宿主落地了' +
          '下载/缓存/校验管线（iconUrl 从 manifest 纯数据 JSON 被读出、下载、按 content-type + magic bytes ' +
          '校验后落盘）之后。',
      },
      {
        field: 'metadata',
        reason:
          'MetadataProviderConfig 声明的元数据 Provider（online/builtin 两种）尚无 Rust 消费点，且当前 0/4 ' +
          '插件声明它。它对应的能力是"把 itemIdSource: displayName 标记为 meta_state: pending 的记录，' +
          '反查回真正的 itemId"——标记侧已经实现（crates/paradigms/gs-p-authkey/src/pipeline.rs 的 ' +
          'determine_meta_state，itemIdSource === "displayName" 时打 MetaState::Pending），回填侧（真正调用 ' +
          'metadata Provider 把 pending 记录解析成 complete）从未实现，crates/ 里对 "回填"/"backfill" 唯一的 ' +
          '命中是保留期的 backfill_missing_retention_days，与元数据无关。移除条件：任意一个消费 metadata ' +
          '字段、把 pending 记录解析出真实 itemId 的回填实现落地之后。',
      },
      {
        field: 'drawCounting',
        reason:
          'DrawCountingConfig 类型本身已经导出（crates/gs-core/src/record.rs 的 PerRecord/Custom 判别联合，' +
          'gs-codegen 里已登记），但那只是类型定义——manifest 顶层的 drawCounting 字段本身没有任何 Rust ' +
          '代码读取过，0/4 插件声明它（全部隐式落在 perRecord 默认值）。crates/gs-host/src/views.rs 的 ' +
          'OverviewStatsView.total_draws 文档注释已经明写"尚未消费 DrawCountingConfig，若日后有插件声明 ' +
          'custom 计数口径，这里会需要改成走该插件的 hooks.countDraws"——这是写在代码里的已知 TODO，不是本次' +
          '扫描第一次发现的缺口。移除条件：total_draws（或任何抽数统计路径）真正按 drawCounting.kind 分支，' +
          'custom 时改走插件 hooks.countDraws 之后。',
      },
      {
        field: 'maintainers',
        reason:
          '纯展示字段（插件维护者名单），4/4 插件都声明了（均为 ["gacha-studio"]），但目前没有任何界面展示' +
          '"这个插件谁在维护"，Rust 侧因此没有消费点——性质与 BannerSpec.displayName/Precondition.describe ' +
          '那两条白名单一致（展示字段），区别是这次连一个"插件详情/关于面板"式的展示入口都还没做，不像 ' +
          'displayName 好歹已经有 list_games 命令把它送到前端。移除条件：出现任何把 maintainers 送到界面的 ' +
          'IPC 视图字段之后。',
      },
      {
        field: 'exchangeFormats',
        reason:
          '声明"这个插件支持导出到哪些交换格式"，1/4 插件声明了（genshin: ["uigf-v4"]），但 ' +
          'crates/gs-exchange/src/uigf.rs 的 FORMAT_ID = "uigf-v4" 是独立硬编码的常量，源码注释只是说明两处 ' +
          '取值"对齐"，从未真正读取这个字段做门控（比如"某插件没声明 uigf-v4 就拒绝对它执行 uigf 导入/导出"' +
          '这类校验完全不存在）。移除条件：导入/导出流程真正读取某插件的 exchangeFormats 来决定是否允许对它' +
          '执行某种交换格式之后。',
      },
    ],
  },
];

/**
 * 递归收集 `dir` 下所有 `.rs` 文件，跳过 `target`/`node_modules`（构建产物与
 * 依赖，本来就不该出现在源码扫描范围里），以及 `excludedAbsoluteDirs` 里按
 * 绝对路径精确匹配到的目录（见 EXCLUDED_RUST_SCAN_DIRS 的用途说明）。
 */
function collectRustFiles(dir, excludedAbsoluteDirs = []) {
  const results = [];
  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'target' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (excludedAbsoluteDirs.includes(path.resolve(full))) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.rs')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function camelToSnakeCase(name) {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * 从类型别名 `=` 之后的位置开始，找到该类型声明在**顶层**（花括号已完全
 * 平衡）结束的位置——即第一个不在任何 `{}` 内部的 `;`。
 *
 * 扫描前先把 `/** ... *\/` 形态的块注释替换成等长空白：JSDoc 里常见的
 * `{@link Foo}`／`` `"{{credential}}"` `` 会包含花括号，不处理会打乱这里的
 * 深度计数（好在这类写法本身总是成对出现，实测不会破坏平衡，但仍按最坏
 * 情况防御）。只是为了给深度计数腾地方，不影响返回结果——调用方会在
 * 原文（未替换注释）上再跑一次自己的注释剥离来提取字段。
 */
function findTypeAliasEnd(source, bodyStart) {
  const masked = source.slice(bodyStart).replace(/\/\*\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ';' && depth === 0) return bodyStart + i;
  }
  return null;
}

/**
 * 从某个 TS 源文件里抠出某个类型别名的字段名集合。
 *
 * 覆盖两种写法：
 * - `types/generated.ts`（ts-rs 输出）：单行、字段用逗号分隔，如
 *   `export type Foo = { a: T, b: U, };`。
 * - `packages/gs-plugin-kit/manifest.ts`（手写契约）：多行、判别联合的每个
 *   分支各自用**分号**分隔字段（TS 对象类型字面量的合法写法之一），如
 *   `export type CredentialSource =\n  | { kind: "x"; a: T }\n  | { ... };`。
 *   旧版实现假设「下一个 `export type` 就是边界」且只认逗号分隔，两条假设
 *   对 ts-rs 输出成立，但套在手写契约上会失败——`export type X =` 后面
 *   直接换行、不带尾随空格，`indexOf` 精确匹配不到；分号分隔的字段也不会
 *   被逗号版的正则捕获到。改用 [`findTypeAliasEnd`] 的花括号深度计数
 *   定位真正的类型别名结束点，字段正则同时接受 `{`/`,`/`;` 三种前导字符。
 */
function extractTsTypeFields(tsSource, typeName) {
  const startPattern = new RegExp(`export type ${typeName}\\s*=\\s*`);
  const startMatch = startPattern.exec(tsSource);
  if (!startMatch) return null;
  const bodyStart = startMatch.index + startMatch[0].length;
  const bodyEnd = findTypeAliasEnd(tsSource, bodyStart);
  const block = bodyEnd === null ? tsSource.slice(bodyStart) : tsSource.slice(bodyStart, bodyEnd);
  const withoutDocComments = block.replace(/\/\*\*[\s\S]*?\*\//g, ' ');

  const fields = new Set();
  for (const m of withoutDocComments.matchAll(/[{,;]\s*([A-Za-z_][A-Za-z0-9_]*)\??:\s/g)) {
    fields.add(m[1]);
  }
  fields.delete('kind'); // 判别键由 serde(tag = "kind") 机制本身消费，不需要单独找镜像字段。
  return [...fields];
}

/** 定位源码中一个平衡的花括号块（`braceStartIndex` 指向起始 `{`）。 */
function extractBraceBlock(source, braceStartIndex) {
  let depth = 0;
  for (let i = braceStartIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(braceStartIndex, i + 1), endIndex: i + 1 };
    }
  }
  return null;
}

/**
 * 从某个 TS 源文件里抠出某个 `export interface X { ... }` 声明的字段名集合。
 *
 * 和 [`extractTsTypeFields`] 的区别只在起点：那个函数认的是类型别名
 * `export type X = {...}`，右侧花括号之后可能还有联合类型的其余分支，需要
 * 靠 [`findTypeAliasEnd`] 的花括号深度计数另找一个"顶层分号"才能确定声明
 * 真正结束的位置。`interface` 语法没有这个问题——`export interface X {`
 * 后面紧跟的花括号本身就是完整的声明体，不会再有联合分支，直接用
 * [`extractBraceBlock`] 定位一次平衡花括号块即可拿到整个 interface 体，不
 * 需要 findTypeAliasEnd 那一套。
 *
 * 字段名提取（剥 JSDoc 块注释、`[{,;]` 前导字符 + 标识符 + 可选 `?` + `:`
 * 的正则）与 extractTsTypeFields 共用同一套约定——interface 成员既可能用
 * 分号也可能用逗号分隔（两者都是合法 TS 语法），正则本身两种都接受。
 */
function extractTsInterfaceFields(tsSource, typeName) {
  const startPattern = new RegExp(`export interface ${typeName}\\s*\\{`);
  const startMatch = startPattern.exec(tsSource);
  if (!startMatch) return null;
  const braceStart = startMatch.index + startMatch[0].length - 1;
  const block = extractBraceBlock(tsSource, braceStart);
  if (block === null) return null;
  const withoutDocComments = block.text.replace(/\/\*\*[\s\S]*?\*\//g, ' ');

  const fields = new Set();
  for (const m of withoutDocComments.matchAll(/[{,;]\s*([A-Za-z_][A-Za-z0-9_]*)\??:\s/g)) {
    fields.add(m[1]);
  }
  fields.delete('kind'); // 与 extractTsTypeFields 一致：判别键不需要单独找镜像字段。
  return [...fields];
}

/** 找到 `struct Foo { ... }` 或 `enum Foo { ... }` 的完整花括号块。 */
function findRustTypeBody(source, structName) {
  const pattern = new RegExp(`\\b(?:struct|enum)\\s+${structName}\\b[^{;]*\\{`);
  const match = pattern.exec(source);
  if (!match) return null;
  const braceStart = match.index + match[0].length - 1;
  return extractBraceBlock(source, braceStart);
}

/**
 * 判断 `source[i]` 处是不是原始字符串字面量的起点（`r"..."`/`r#"..."#`/
 * `br"..."`/`br#"..."#`，`#` 的个数不限），命中则返回 hash 个数与内容起始
 * 下标，否则返回 `null`。
 *
 * 简化边界：只认标准的 `r`/`br` 前缀（区分大小写，与 Rust 语法一致），不认
 * 2024 edition 新增的 `c"..."`/`cr"..."`（C 字符串字面量）——本仓库当前
 * 没有用到这类字面量；真出现时会被后面的普通字符串/标识符分支接住，不会
 * 崩溃，只是不会被当"原始"处理（字面量内部若含反斜杠会被误当转义符），
 * 这是本次没有覆盖到的已知局限，不是新引入的问题。
 *
 * 起点判定只看"前一个字符是不是标识符字符"，不是完整词法分析——对能编译的
 * Rust 源码这已经足够：`r"`/`br"` 前缀不可能紧跟在标识符字符后面还合法
 * （`xr"foo"` 只会被真正的词法分析器读成标识符 `xr` 后面跟一个不合法的
 * 裸字符串起点，本来就编译不过），真实源码不会把这个简化判定引向误判。
 */
function matchRawStringStart(source, i) {
  const prevChar = i > 0 ? source[i - 1] : '';
  if (/[A-Za-z0-9_]/.test(prevChar)) return null;
  let j = i;
  if (source[j] === 'b') j++;
  if (source[j] !== 'r') return null;
  j++;
  let hashCount = 0;
  while (source[j] === '#') {
    hashCount++;
    j++;
  }
  if (source[j] !== '"') return null;
  return { hashCount, contentStart: j + 1 };
}

/**
 * 判断 `source[i]`（指向一个 `'`）是不是字符字面量的起点，命中则返回字面量
 * 结束位置（闭合引号之后一个下标），否则返回 `null`——`null` 意味着这其实
 * 是生命周期标注（如 `'a`/`'static`），调用方应当只把这一个引号当普通代码
 * 字符处理，紧跟的标识符留给正常扫描，不能当成"未闭合的字符串"一路吞到
 * 后面，否则会把中间真实的注释、真实的消费点全部错误吞掉。
 *
 * 覆盖：单字符（`'x'`）、常见转义（`\n`/`\t`/`\r`/`\\`/`\0`/`\'`/`\"`）、
 * `\xNN`（两位十六进制）、`\u{...}`（1~6 位十六进制）。已知局限：占多个
 * UTF-16 代码单元的字符字面量（生僻字、emoji）不在覆盖范围——JS 字符串按
 * UTF-16 code unit 索引，`source[i+1]` 在这种输入下会读到半个代理对，导致
 * 误判成生命周期；本仓库 Rust 源码里没有出现过这类字符字面量。
 */
function matchCharLiteral(source, i) {
  if (source[i + 1] === '\\') {
    let j = i + 2;
    if (source[j] === 'x') {
      j += 3; // \xNN：反斜杠转义符之后是 x 加两位十六进制，共 3 个字符
    } else if (source[j] === 'u' && source[j + 1] === '{') {
      j += 2;
      while (j < source.length && source[j] !== '}') j++;
      j++; // 跳过 }
    } else {
      j += 1; // 单字符转义（\n/\t/\r/\\/\0/\'/\" 等）
    }
    return source[j] === "'" ? { end: j + 1 } : null;
  }
  if (source[i + 1] !== undefined && source[i + 1] !== "'" && source[i + 2] === "'") {
    return { end: i + 3 };
  }
  return null;
}

/**
 * 剥掉 Rust 源码里的注释（行注释 `//`/`///`/`//!`，块注释形如 "斜杠星号 ...
 * 星号斜杠"，支持嵌套），替换成等长空白，其余内容（含字符串/字符字面量、
 * 代码本身）原样保留。
 *
 * 不能用正则一把梭剥注释：字符串字面量内容可能包含 `//`（如 URL 模板
 * `"https://example.com"`），正则如果分不清"在字符串里"和"在代码里"，会把
 * 字符串内容误当成注释起点删掉——这不是"漏删注释"，而是反过来"删掉了不该
 * 删的代码"，会把真实消费点从语料库里错误抹掉，制造假阴性（门本来该绿却
 * 报红）。改用逐字符状态机，扫描时区分代码/行注释/块注释/字符串/字符/
 * 原始字符串几种状态，只有确认落在注释状态才替换成空白。
 *
 * 引入动机见文件头部"已知局限"一节：countWholeWordOccurrences 原先直接在
 * 含注释的全文上数标识符出现次数，导致"字段名只在文档注释里被提过、从没
 * 被真正读取"这种情况被误判成"已消费"，是 HC-4 在最典型的回归场景（删掉
 * 读取代码、忘了同步删注释）下形同虚设的根因之一。与下面的
 * stripTestModules 放在同一层处理：两者都是"替换成等长空白"，互相之间没有
 * 顺序依赖；另一类"标识符紧跟冒号"（类型声明字段/字面量初始化标签）的
 * 干扰不是靠剥语料解决，见 countWholeWordOccurrences 的负向先行断言。
 */
function stripComments(source) {
  let result = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      let j = i;
      while (j < n && source[j] !== '\n') j++;
      result += ' '.repeat(j - i);
      i = j;
      continue;
    }

    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (source[j] === '/' && source[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (source[j] === '*' && source[j + 1] === '/') {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      result += ' '.repeat(j - i);
      i = j;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      result += source.slice(i, j);
      i = j;
      continue;
    }

    if (ch === 'r' || ch === 'b') {
      const rawStart = matchRawStringStart(source, i);
      if (rawStart) {
        const closer = '"' + '#'.repeat(rawStart.hashCount);
        const closeIdx = source.indexOf(closer, rawStart.contentStart);
        const end = closeIdx === -1 ? n : closeIdx + closer.length;
        result += source.slice(i, end);
        i = end;
        continue;
      }
    }

    if (ch === "'") {
      const charLit = matchCharLiteral(source, i);
      if (charLit) {
        result += source.slice(i, charLit.end);
        i = charLit.end;
        continue;
      }
      result += ch;
      i++;
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}

/** 剥掉 `#[cfg(test)] mod tests { ... }` 整块——测试内的读取不算真实消费。 */
function stripTestModules(source) {
  let result = source;
  const pattern = /#\[cfg\(test\)\]\s*mod\s+tests\b[^{]*\{/g;
  let match = pattern.exec(result);
  while (match) {
    const braceStart = match.index + match[0].length - 1;
    const block = extractBraceBlock(result, braceStart);
    if (!block) break;
    result = result.slice(0, match.index) + ' '.repeat(block.endIndex - match.index) + result.slice(block.endIndex);
    pattern.lastIndex = 0;
    match = pattern.exec(result);
  }
  return result;
}

/**
 * 数 `word` 在 `text` 里作为独立标识符出现的次数，但排除"标识符后面紧跟
 * 冒号"这一种形状（可以隔着空白，如 `field :`）。
 *
 * 排除动机：`identifier: 后面接点什么` 这个形状同时是三种完全不同语法
 * 结构的写法——struct/enum 字段声明（`pub hard_pity: u32,`）、结构体字面量
 * 初始化的标签（`PityGroupReport { hard_pity: 0, .. }`）、解构时的重命名
 * 绑定（`{ game_dir: dir, .. }`）——三者共同点是冒号前的标识符只是"这个
 * 位置叫什么"，不代表值真的被读取过；真实消费（点访问 `x.hard_pity`、
 * 解构出的裸绑定被继续使用、作为函数实参传入等）没有这个"紧跟冒号"的
 * 形状。原先没有这条排除时，`PityGroupReport` 与本门实际校验的
 * `PityGroup` 恰好都声明了 `hard_pity` 字段——前者的声明行会顶替掉真实
 * 消费点，把"字段声明撞名"误判成"已消费"；即使换成"挖掉整个类型声明体"
 * 的思路堵住了声明撞名，结构体字面量初始化标签（如把
 * `hard_pity: group.hard_pity` 改成 `hard_pity: 0` 这种改坏读取但不动标签
 * 的写法）依然会独立地让计数保持非零——因为字面量初始化表达式不带
 * `struct`/`enum` 关键字，根本不在"类型声明体"的范围内，挖类型声明体这条
 * 路堵不住它。两种情况形状相同（都是"标识符 + 冒号"），用同一条排除规则
 * 一并处理，比分别写"识别类型声明体"与"识别结构体字面量初始化表达式"两个
 * 独立的解析器轻量得多，覆盖也更准。
 *
 * 残留的已知局限：字段名如果以字符串字面量形式出现（如 `#[serde(alias =
 * "hard_pity")]`——本仓库当前未出现这种写法，但理论上可能出现），不会被
 * 这条排除规则挡住，因为它不是"标识符紧跟冒号"的形状。这与文件头部
 * "已知局限"一节列出的其他启发式局限是同一类问题，交给代码 review。
 */
function countWholeWordOccurrences(text, word) {
  const pattern = new RegExp(`\\b${word}\\b(?!\\s*:)`, 'g');
  return [...text.matchAll(pattern)].length;
}

/**
 * 构建"消费扫描语料库"：递归收集 RUST_SCAN_ROOT_DIR 下所有 `.rs` 文件（排除
 * EXCLUDED_RUST_SCAN_DIRS）拼成一份大文本，剥掉注释（stripComments，形状像
 * 消费、实则只是文档提及一句字段名）与测试模块（stripTestModules，测试里
 * 的读取不算真实消费）。声明/字面量标签这一类"形状像消费"的干扰交给调用方
 * 的 countWholeWordOccurrences 用"标识符是否紧跟冒号"排除，不在这里处理——
 * 那条排除规则是逐次匹配时的局部判断，不需要（也没办法用"替换成空白"的
 * 方式）预先烘焙进语料库本身。
 *
 * 两种登记方式（`rustStruct`/`literalRead`）共用同一份构建逻辑（原来只有
 * rustStruct 模式用到一次，写在 checkSection 内联；新增 literalRead 模式后
 * 有了第二个调用方，提成独立函数避免复制粘贴两份）——不再需要按目标类型
 * 单独掩码目标结构体自己的声明体（历史上的 `maskFile`/`maskText` 参数已
 * 随 countWholeWordOccurrences 的冒号排除规则一并移除，那条规则本身就能
 * 排除掉任意类型的字段声明，不需要再单独指认"这次登记的是哪个类型"），
 * 两种模式现在传参完全一致。
 */
function buildConsumptionCorpus(repoRoot) {
  const excludedAbsoluteDirs = EXCLUDED_RUST_SCAN_DIRS.map((rel) => path.resolve(repoRoot, rel));
  const rustFiles = collectRustFiles(path.join(repoRoot, RUST_SCAN_ROOT_DIR), excludedAbsoluteDirs);
  return rustFiles
    .map((filePath) => stripTestModules(stripComments(readFileSync(filePath, 'utf8'))))
    .join('\n');
}

/**
 * `rustStruct` 模式：字段有具名 Rust 镜像结构体（`section.rustStruct`），
 * 走原有三条判定——镜像字段存在、没标 `#[allow(dead_code)]`、扫描范围内有
 * 非测试代码读取过。这是 M1 阶段登记的原始判定方式，多数区块仍走这条。
 */
function checkRustStructSection(repoRoot, section, tsFields, knownUnconsumed) {
  const rustPath = path.join(repoRoot, section.rustFile);
  const findings = [];
  const notes = [];

  let rustSource;
  try {
    rustSource = readFileSync(rustPath, 'utf8');
  } catch (err) {
    return { findings: [{ file: section.rustFile, line: 0, column: 0, reason: `读取 Rust 镜像文件失败：${err.message}` }], notes };
  }

  const rustBody = findRustTypeBody(rustSource, section.rustStruct);
  if (rustBody === null) {
    return {
      findings: [
        {
          file: section.rustFile,
          line: 0,
          column: 0,
          reason: `未能在文件里找到 struct/enum ${section.rustStruct}——契约类型 "${section.tsType}" 在 L1 完全没有 Rust 镜像结构体`,
        },
      ],
      notes,
    };
  }

  const consumptionCorpus = buildConsumptionCorpus(repoRoot);

  for (const tsField of tsFields) {
    if (knownUnconsumed.has(tsField)) {
      notes.push(`${section.tsType}.${tsField} 已登记白名单，跳过消费检查——理由：${knownUnconsumed.get(tsField)}`);
      continue;
    }

    const rustFieldName = camelToSnakeCase(tsField);
    const declarationPattern = new RegExp(`(#\\[allow\\(dead_code\\)\\]\\s*)?\\b${rustFieldName}\\s*:`, 'g');
    const declarations = [...rustBody.text.matchAll(declarationPattern)];

    if (declarations.length === 0) {
      findings.push({
        file: section.rustFile,
        line: 0,
        column: 0,
        reason: `契约字段 "${section.tsType}.${tsField}" 在 ${section.rustStruct} 里找不到对应字段 "${rustFieldName}"——serde 会静默忽略未知字段，不会报错`,
      });
      continue;
    }

    const markedDeadCode = declarations.some((m) => Boolean(m[1]));
    if (markedDeadCode) {
      findings.push({
        file: section.rustFile,
        line: 0,
        column: 0,
        reason: `契约字段 "${section.tsType}.${tsField}" 对应的 Rust 字段 "${rustFieldName}" 标了 #[allow(dead_code)]——解析出来后被明确弃置，不是消费`,
      });
      continue;
    }

    const consumptionCount = countWholeWordOccurrences(consumptionCorpus, rustFieldName);
    if (consumptionCount === 0) {
      findings.push({
        file: section.rustFile,
        line: 0,
        column: 0,
        reason: `契约字段 "${section.tsType}.${tsField}" 对应的 Rust 字段 "${rustFieldName}" 已声明，但整个 ${RUST_SCAN_ROOT_DIR}/ 除声明本身外没有任何非测试代码读取过它`,
      });
    }
  }

  return { findings, notes };
}

/**
 * `literalRead` 模式：字段没有具名 Rust 镜像结构体可找（典型场景是
 * `serde_json::Value::get("字段名")` 这类动态取值，或按路径字符串调用宿主
 * 运行时函数），因此不跑 findRustTypeBody/`#[allow(dead_code)]` 那一套——
 * 判定标准换成"扫描范围内能否找到对这个字段名的字面量读取"，即形如
 * `.get("字段名")` 的 Rust 源码文本是否出现过。
 *
 * 字段名一律来自上面 extractTsTypeFields/extractTsInterfaceFields 的合法
 * 标识符正则（`[A-Za-z_][A-Za-z0-9_]*`），拼进正则字面量不需要转义——值来自
 * 受控的字段名提取正则，不是外部输入。
 */
function checkLiteralReadSection(repoRoot, section, tsFields, knownUnconsumed) {
  const findings = [];
  const notes = [];
  const consumptionCorpus = buildConsumptionCorpus(repoRoot);

  for (const tsField of tsFields) {
    if (knownUnconsumed.has(tsField)) {
      notes.push(`${section.tsType}.${tsField} 已登记白名单，跳过消费检查——理由：${knownUnconsumed.get(tsField)}`);
      continue;
    }

    const literalPattern = new RegExp(`\\.get\\(\\s*"${tsField}"\\s*\\)`);
    if (!literalPattern.test(consumptionCorpus)) {
      findings.push({
        file: section.rustFile,
        line: 0,
        column: 0,
        reason:
          `契约字段 "${section.tsType}.${tsField}" 没有 Rust 镜像结构体，只能靠动态 Value::get 读取证明被消费，` +
          `但整个 ${RUST_SCAN_ROOT_DIR}/ 里找不到 .get("${tsField}") 这样的字面量读取`,
      });
    }
  }

  return { findings, notes };
}

/** 校验单个契约区块，返回该区块产生的 findings/notes。 */
function checkSection(repoRoot, section) {
  const tsPath = path.join(repoRoot, section.tsFile);
  const notes = [];

  let tsSource;
  try {
    tsSource = readFileSync(tsPath, 'utf8');
  } catch (err) {
    return { findings: [{ file: section.tsFile, line: 0, column: 0, reason: `读取契约类型文件失败：${err.message}` }], notes };
  }

  const extractedFields =
    section.tsKind === 'interface'
      ? extractTsInterfaceFields(tsSource, section.tsType)
      : extractTsTypeFields(tsSource, section.tsType);

  if (extractedFields === null) {
    const reason =
      section.tsKind === 'interface'
        ? `未能在文件里找到 "export interface ${section.tsType} {"——契约类型可能已改名、删除或语法有变，CONTRACT_SECTIONS 需要同步更新`
        : `未能在文件里找到 "export type ${section.tsType} = "——契约类型可能已改名或删除，CONTRACT_SECTIONS 需要同步更新`;
    return { findings: [{ file: section.tsFile, line: 0, column: 0, reason }], notes };
  }

  // `onlyFields`：把本区块实际检查的字段范围缩小到登记时列出的子集，见
  // CONTRACT_SECTIONS 上方的文档。先校验子集本身没有过期（列出的字段名在
  // 源码里确实提取得到），过期的登记本身就是一个应该报出来的问题，不能
  // 悄悄跳过不检查。
  let tsFields = extractedFields;
  if (section.onlyFields) {
    const extractedSet = new Set(extractedFields);
    const stale = section.onlyFields.filter((field) => !extractedSet.has(field));
    if (stale.length > 0) {
      return {
        findings: [
          {
            file: section.tsFile,
            line: 0,
            column: 0,
            reason:
              `${section.tsType} 的 onlyFields 登记了 ${stale.join(', ')}，但在 ${section.tsType} ` +
              `里提取不到这些字段——登记可能已经过期（字段改名/删除），CONTRACT_SECTIONS 需要同步更新`,
          },
        ],
        notes,
      };
    }
    tsFields = section.onlyFields;
  }

  const knownUnconsumed = new Map((section.knownUnconsumed ?? []).map((entry) => [entry.field, entry.reason]));

  return section.consumption === 'literalRead'
    ? checkLiteralReadSection(repoRoot, section, tsFields, knownUnconsumed)
    : checkRustStructSection(repoRoot, section, tsFields, knownUnconsumed);
}

export async function run() {
  const repoRoot = findRepoRoot();
  const findings = [];
  const notes = [`已登记 ${CONTRACT_SECTIONS.length} 个契约区块：${CONTRACT_SECTIONS.map((s) => s.tsType).join(' / ')}`];

  for (const section of CONTRACT_SECTIONS) {
    const result = checkSection(repoRoot, section);
    findings.push(...result.findings);
    notes.push(...result.notes);
  }

  return {
    id: 'HC-4',
    title: GATE_TITLE,
    status: findings.length > 0 ? 'fail' : 'pass',
    findings,
    notes,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run();
  renderResult(result);
  console.log('');
  renderSummary([result]);
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
