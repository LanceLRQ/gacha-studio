# 第三方声明

本文件登记 Gacha Studio 项目对第三方代码、设计思路与运行时下载组件的使用情况，
是 M0 里程碑验收要求的一部分（`docs/_internal/milestones/01-M0-工程骨架.md` §四）。

Gacha Studio 本身以 **MIT 许可证** 发布，见根目录 [`LICENSE`](./LICENSE)。
本文件不改变该许可证的效力，只是把「用了别人东西的地方」集中记录下来，方便使用者、
贡献者与审计者一次性看清楚，不用去翻散落在源码注释里的引用。

登记范围会随开发进度持续增长，本次（M0）只建立文件骨架并完成一次全库核查，
不代表登记工作已经完结——见 `01-M0-工程骨架.md` §七。

---

## 一、参考项目清单

本项目在 `docs/example-projects/`（已 `.gitignore`，不入库）收录了六个同类工具作为
架构与协议实现的参考，覆盖抓包、日志扫描、authkey 三种采集范式。下表逐一列出
许可证与「实际关系」——关系一栏是本次核查后的结论，不是模板套话。

| 参考项目 | 技术栈 | 许可证 | 实际关系 |
|---|---|---|---|
| HoYo.Gacha | Rust + Tauri + React + SQLite | MIT OR Apache-2.0（本项目取 **MIT** 分支） | 参考思路 + 事实核实。存储层五个要点、`record_key` 设计教训（裸用雪花 ID 曾导致整表重建迁移）、UIGF 转换器字段定义、原神/星铁/绝区零 API 路径与响应字段，均以「读源码核实某个事实结论」的方式引用，未见整段代码复制 |
| genshin-wish-export | JavaScript（Electron） | MIT | 参考思路。`data_2` 缓存扫描取值策略（数组最后一个匹配而非 `timestamp=` 参数比较）、限速重试的固定间隔参数、`page % 10 === 0` 批量停顿逻辑，均是读实现推断行为规律后用 Rust 独立重写，未见代码复制 |
| star-rail-warp-export | JavaScript（Electron） | MIT | 参考思路，用法同上；另作为与 genshin-wish-export 的对比样本，用于判断三个同族工具之间哪些行为是共识、哪些是各自分叉后的行为漂移（详见 `docs/_internal/research/04-同族工具三方源码对比.md`） |
| zzz-signal-search-export | JavaScript（Electron） | MIT | 参考思路，用法同上；绝区零插件的域名、端点路径、响应字段核实均来自此项目源码 |
| WWGachaExport | C# / WPF | MIT | 参考思路 + 结构对齐。鸣潮凭据来源（`Client.log`，异或混淆，密钥 `0xA5`/`0xEF`）与本地存档 JSON 结构（PascalCase 字段：`UID`/`ServerID`/`GachaPoolData` 等）均以读源码方式核实。其中交换适配器 `gs-exchange::wwgacha`（`crates/gs-exchange/src/wwgacha.rs`）用 Rust **独立实现**了一个与该存档格式兼容的读写器——字段名称与其保持一致是为了保证文件级互操作性（这类似于任何两个程序要互相读懂同一份文件格式时都需要的字段对齐），不是移植其 C# 代码 |
| NTE_Gacha_Exporter | Rust | MIT | 参考思路。WinDivert 运行时下载（不打包二进制、下载 → 校验 hash 与大小上限 → 解压落盘 LICENSE）这套四步流程的**设计**值得借鉴，已记录为本项目的约定（见下方「三、WinDivert」一节）；截至本次核查，该流程本身**尚未在代码库中实现**（`grep -rni windivert` 全库无命中），是规划在 M4（异环插件，封包捕获范式）落地的工作，现在只是把约定写下来，不是已经复制了它的 `install.rs` |

**没有 GPL/AGPL/LGPL 项目**，与 `docs/_internal/reference/参考项目与依赖许可合规清单.md`
§一的结论一致。

### 代码复用查证过程

核查方法：在 `crates/`、`plugins/`、`packages/`、`web/`、`src-tauri/` 全库范围内，
对六个参考项目名称、其作者署名（`biuuu`、`QChan`）逐一 `grep`，并额外搜索本项目
许可合规清单里规定的复制代码应有的标记文本 `Portions adapted from`。

结果：

- `Portions adapted from` —— **2026-08-17 起有 1 处命中**（此前一直是零命中）：
  `crates/paradigms/gs-p-authkey/src/locale.rs`，转引自 **HoYo.Gacha**
  （MIT OR Apache-2.0）的语言代码别名表 `LOCALE_ALIASES`
  （`crates/metadata/src/def.rs`）。
  **转引的只是表项数据本身**——哪些 ISO 639-1 短码映射到哪个长码，以及
  `zh-sg`/`zh-hk`/`zh-mo` 三个地区变体的归并方向（新加坡归简体、港澳归繁体）；
  该表在参考实现里附带两个真实用户反馈的出处（`lgou2w/HoYo.Gacha#89`、`#118`）。
  Rust 实现本身（`LazyLock`/`HashMap` 结构、「先小写再查表」的归一化顺序、
  表外取值原样保留的策略）是本项目自己的写法，不是移植。
  > 为什么给它打标记：本项目 fixtures 只实测到 `zh-cn` 一种取值，这张表的
  > **选取范围**（收哪些、地区变体往哪归）来自参考实现追溯到的真实 issue，
  > 比「单个常量取值」更接近数据集转引。可以争论它是否构成「复制代码」，
  > 但打标记的成本只有几行，而争论会留给后来人——**判断可以有分歧，标记不会**。
  > 许可兼容性：HoYo.Gacha 为 MIT OR Apache-2.0 双许可，与本项目 MIT 兼容。
- 全部命中都落在 doc comment（`///` `//!`）或行内注释里，语言模式统一是
  「校准依据」「参考实现」「已用源码核实」「事实引用」，指向的是**某个具体行为/
  数据结构的事实结论**（例如某个域名、某个 JSON 字段是否存在、某个重试间隔的经验值），
  而不是被复制粘贴的代码文本本身。抽样细读了引用密度最高的几个文件（
  `crates/paradigms/gs-p-authkey/src/cache_scan.rs`、`rate_limit.rs`、`pipeline.rs`，
  `crates/gs-exchange/src/wwgacha.rs`）确认：这些文件里的 Rust 实现（类型定义、
  控制流、错误处理）是本项目自己的写法，引用参考项目的地方限于常量取值（如
  `DEFAULT_PER_PAGE_DELAY_MS = 300`）和字段命名对齐（如 `wwgacha.rs` 里为兼容
  `WWGachaExport` 存档格式而使用的 PascalCase 字段名），符合本项目 `CLAUDE.md`
  「参考设计思路而非直接复制代码」的既定原则。
- 结论：**登记一条「数据转引」条目**（`locale.rs` 的别名表，见上）。除此之外
  上表「实际关系」一栏如实标注为「参考思路」或「参考思路 + 结构对齐」，
  没有为凑齐模板而虚构复制记录。
- 后续如果贡献者从参考项目复制了代码片段，按合规清单的规范，必须在文件头加
  `// Portions adapted from <项目名> (MIT)` 并在本节补登记一行——上面的
  `grep` 命令可以直接复用作为门禁自查手段。

---

## 二、Rust 依赖许可概况

Cargo 工作区当前解析出 **495 个 package**（`Cargo.lock`，2026-08-14），
逐一列出许可证不现实也没有意义——机械保证交给根目录 [`deny.toml`](./deny.toml) +
`cargo deny check licenses`：允许清单模型，只放行 MIT / Apache-2.0 系与其他已核实
的宽松许可证，GPL / AGPL / LGPL 未出现在允许清单中即视为拒绝（`deny.toml` 顶部注释
记录了 cargo-deny 0.16 起的 schema 变化，此处不重复）。

本次核查用 `cargo metadata` 逐包核对 `license` 字段，得到 33 种唯一许可证表达式，
无一包含独立触发的 GPL / AGPL / LGPL 义务。**唯一值得单独一提的边界情况**：
`r-efi`（`getrandom` 在 `cfg(target_os = "uefi")` 下的可选依赖，本项目不构建 UEFI
目标）声明的许可证是 `MIT OR Apache-2.0 OR LGPL-2.1-or-later`——三选一的 `OR`
关系，取用方选择权在我们，选 MIT/Apache-2.0 分支即不触发 LGPL 义务，`deny.toml`
里对此有专门注释。

已实测通过（`cargo-deny 0.20.2`，2026-08-14）：

```
$ cargo deny check licenses
licenses ok
```

零警告、零错误。

### 另一侧：安全公告检查当前不通过（如实记录）

许可证这一项是绿的，但**同一个工具的另一项检查不是**：

```
$ cargo deny check advisories
advisories FAILED     # 19 条 error
```

其中 3 条是 vulnerability 而非 unmaintained：`quick-xml 0.38.4`
（RUSTSEC-2026-0194 / 0195）与 `time 0.3.45`（RUSTSEC-2026-0009），
均经 `plist` / `cookie` 由 **Tauri 传递引入**，本项目无法在自己这侧修复。
其余 16 条为 unmaintained（gtk-rs GTK3 绑定、`unic-*` 系列、`proc-macro-error`）。

`deny.toml` **有意不加 `ignore` 掩盖**，理由与可达性分析写在该文件
`[advisories]` 一节的注释里。把这件事写进本文件，是因为「许可合规」与
「依赖安全」常被一并理解为「cargo-deny 过了就没事」——这里没有，
只过了其中一半。

---

## 三、前端依赖概况

`web/`、`packages/gs-plugin-kit/` 与各 `plugins/<game>/` 的依赖集中声明在
`pnpm-workspace.yaml` 的 catalog 里，均为 npm 生态中广泛使用、许可证公开且宽松的包：
React 生态（`react`、`react-dom`、`react-router-dom`）、Radix UI、Tailwind CSS
生态、`zod`、`lucide-react`、`class-variance-authority` 等，未见 GPL 系依赖。

**已知的例外类别**：`@fontsource/ibm-plex-sans`、`@fontsource/jetbrains-mono`
这两个包本身遵循 MIT，但**打包进其中的字体文件**另循字体出品方各自的
开源字体许可（IBM Plex 与 JetBrains Mono 均为 SIL Open Font License），
与代码依赖的 MIT/Apache 系许可分属不同类别——字体许可允许免费嵌入商业与开源
产品，但对字体文件本身的再分发有其自己的条款（如不能仅出售字体文件本身），
不影响本项目以 MIT 分发代码。

**机械保证（2026-08-18 起，不再是缺口）**：前端侧现有等价于 `cargo deny` 的
机械化许可扫描——`pnpm gs:check` 的 **FLIC** 门（`scripts/gs-check/checks/
frontend-license.mjs`），跑 `pnpm licenses list --json` 对照允许清单：
清单内放行，清单外硬失败，不设"未知许可 warn 一下就放行"的中间态。
上述许可证信息不再是仅凭各包公开发行信息人工整理的结果，而是这道门每次
`pnpm gs:check` 都会重新核对一遍的机械结论（当前实测 130 个包全部在清单内）。

**清单由两部分组成，刻意分开声明**：

1. `FRONTEND_LICENSE_ALLOWLIST` —— 与 `deny.toml` `[licenses].allow`
   **逐条对应的同一份清单**。即使其中某些标识符（`CDLA-Permissive-2.0`、
   `Unicode-3.0`）在 npm 依赖树里从未出现过也原样保留，因为"对齐"要求两侧
   用同一份判断基准，而不是各自按当前扫描结果反推一份刚好让门变绿的清单。
2. `FRONTEND_ONLY_ADDITIONS` —— 前端相对 Rust 基线**额外**认可的许可，
   当前只有 `OFL-1.1` 一条。**deny.toml 没有它不是疏漏，是 Rust 依赖树里
   根本没有字体包**——两侧依赖树构成不同，强求同一份清单反而是错的对齐方式。
   收它的依据不是门自己现造的判断，而是本节上方那段**早于这道门存在**的
   既有结论：这两个包本身是 MIT，打包进去的字体文件另循 OFL，该许可允许
   免费嵌入商业与开源产品。本条只是把一个已经做过并记录在案的决定补登记进
   机械门。

两个数组不合并成一个，是为了让「与 deny.toml 逐字一致」这个性质保持字面为真、
可机械核对，同时让前端多认了什么一眼可见——把 `OFL-1.1` 混进第一个数组会让
它的注释变成假话，而"注释声称的与代码实际做的不一致"正是本项目反复付过代价的
那类问题。`FRONTEND_ONLY_ADDITIONS` 的每一条都必须附理由，不写理由的条目
等同于用 ignore 掩盖。

⚠️ **OFL 放行的前提有边界**：该许可对**字体文件本身的再分发**另有条款
（例如不得单独出售字体文件）。本项目只做嵌入式使用、不单独分发字体，
这条边界一旦变化（比如日后提供"下载字体包"之类的功能），放行前提即不再成立，
须重新评估。

---

## 四、WinDivert 运行时下载与 LICENSE 落盘约定

WinDivert 是 **LGPLv3 / GPLv2 双许可**（另有商业许可）的 Windows 抓包驱动，
计划用于 M4（异环插件，封包捕获范式）。核查结论见
`docs/_internal/reference/参考项目与依赖许可合规清单.md` §2.1：

- 仓库**不包含**任何 WinDivert 的 `.dll` / `.sys` 二进制文件，`deny.toml` 与
  `Cargo.lock` 里也不会出现 WinDivert 依赖——它不是一个 Rust crate。
- 应用**运行时**从 WinDivert 官方发布地址下载压缩包。
- 下载后**校验哈希与文件大小上限**，防止中间人篡改或异常大文件占满磁盘。
- **解压时把 WinDivert 的 `LICENSE` 文件一并落盘到安装目录**，与
  `WinDivert.dll` / `WinDivert64.sys` 放在一起——这一步是关键，不能省略：
  它让「WinDivert 的许可义务」直接建立在用户与 WinDivert 之间，而不是由本项目
  以分发者身份承担 LGPL 的「随附协议全文 + 保证用户可替换库」义务（`WinDivert64.sys`
  是签名内核驱动，用户实际上无法自行替换重签，这条义务如果落在我们头上会很难满足）。

这套四步流程参考了 `NTE_Gacha_Exporter` 的做法（见上方「一、参考项目清单」表内
该行的说明），是**设计层面的借鉴**，不是代码复制。

⚠️ **当前状态**：这是为 M4 预先记录的约定，本次核查确认代码库中尚未实现
（全库 `grep -rni windivert` 无命中）。M4 落地时的实现必须遵守这里写的四步，
不得因为「重新实现一遍」就悄悄漏掉第四步的 LICENSE 落盘。

---

## 五、Npcap 排除结论

Npcap 是 Windows 上另一个常见的抓包后端，但**不是开源许可**——免费版明确禁止
随第三方软件分发，商业分发需要购买 Npcap OEM 许可。

**结论：本项目不引入 Npcap。** 抓包后端只使用：

- `pktmon`（Windows 内置，`pktmon` crate v0.6.2 为 MIT 许可，无分发限制）
- WinDivert（见上节，运行时下载，不打包）

依据 `docs/_internal/reference/参考项目与依赖许可合规清单.md` §2.2：参考项目
`NTE_Gacha_Exporter` 的一个 fork（`Golumpa/nte-exporter`）走的是 libpcap/Npcap
路线，它的抓包实现**不能**直接借鉴到本项目的分发包里，本次核查再次确认
代码库中没有任何 Npcap 相关代码或依赖。

---

## 六、游戏资源版权

许可证条款管的是代码，游戏内容（角色/物品名称、图标、UI 美术资源）的版权归属
各游戏厂商所有，是独立于上述软件许可证的另一层问题：

> **图像类资源的三条不变量**（2026-08-18 提炼。此前本节把「从厂商自有域名加载」
> 写成了规则，那其实只是**某一类资源的来源偏好**，不是规则本身——真正必须守住的
> 是下面三条，任何图像类资源都适用）：
>
> 1. **不在仓库内分发任何图片**。仓库里只允许存地址或拼接规则，不存字节。
> 2. **地址必须是声明式数据，可换源**。写死在代码里的地址等于把来源焊死，
>    一旦某个来源不可用或需要更换，就变成改代码而不是改配置。
> 3. **取不到必须能优雅缺席**。任何图片都不得成为功能可用性的前提——
>    失败时静默回落到不依赖网络的兜底表现，不报错、不白屏。
>
> 来源选谁，是在满足这三条之后的取舍题，按类别分别判断，见下。

- **角色 / 物品名称**：风险低，属事实性描述，与百科类站点的通行做法一致，可以使用。
- **角色 / 物品图标**：风险高，**绝不打包进仓库**。运行时按 URL 拼接加载，仓库里
  只存拼接规则。**这一类优先取游戏厂商自己的静态资源域名**（例如异环走
  `webstatic.tajiduo.com`）——因为这类图标本来就是游戏客户端/官方网页自己在用的
  资源，照其公开地址取用最接近原本的用途。
- **游戏应用图标**（2026-08-17 新增的独立类别，与上一条不是一回事）：同样
  **绝不打包进仓库**——仓库里只有各插件 manifest 里的一个 `iconUrl` 字符串，
  宿主在运行时下载、校验、缓存到应用数据目录（`crates/gs-host/src/icon_cache.rs`）。
  **来源取 TapTap CDN**（`img-tc.tapimg.com`），理由见
  `docs/_internal/design/2026-08-10-界面设计方向.md` §6.2：它是唯一覆盖全部目标
  游戏、且图标规格统一的来源，四条地址均实测无防盗链、无需 referer。换成四家厂商
  各自的官网域名意味着四条地址各找各的、稳定性与规格也各不相同。
  ⚠️ **如实记录这个取舍的代价，不粉饰**：TapTap 是应用分发平台，不是游戏厂商本身，
  所以这里既消耗了分发平台的带宽，展示的又是第三方的商标——比「厂商自己公开托管、
  我们照其公开地址取用」多了一层。**运行时加载不改变商标归属**，它规避的只是
  仓库内分发这一件事。这是一个已经权衡过的选择，不是「无风险」。
  三条不变量均已满足：不入库；`iconUrl` 是插件 manifest 里的纯数据，换源改一行
  随版本发布；下载失败或校验不通过一律静默回落到「游戏名首字 + 游戏色圆底」。
- **OCR 模板图**（如涉及模板匹配识别数字/文字）：不预置从游戏截图裁出的模板图，
  改为在用户本地首次运行时从其自己的截图生成，既规避版权问题，也天然适配
  用户自己的分辨率。

对外发布时，公开 `CLAUDE.md` 的免责声明需要说明：本项目是非官方工具，
与米哈游、库洛游戏、腾讯等游戏厂商无关，所有游戏名称与商标归各自权利人所有。
