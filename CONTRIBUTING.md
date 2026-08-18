# 贡献指南

> **项目当前处于早期开发阶段，暂无可用版本，暂不接受功能性 Issue**（详见根目录
> [`CLAUDE.md`](./CLAUDE.md)）。本文件描述的是仓库已经落地的工程约定与门禁机制，
> 供想要提前了解「新游戏插件怎么接入」的读者参考；实际开放外部贡献的时间点以
> 仓库公告为准。

Gacha Studio 的核心命题是：**让新游戏的接入成为写插件，而不是改主程序。**
每款游戏是 `plugins/<game>/` 下的一份 TypeScript 声明（manifest + 少量纯函数），
通用的采集流程、存储、分析引擎全部沉在宿主（Rust）侧。本文件的主要读者是
**想要贡献一个新游戏插件的人**。

---

## 一、开发环境准备

### 1.1 Node.js

版本以根目录 [`.nvmrc`](./.nvmrc) 为准（当前 `22.22.1`）。用 [nvm](https://github.com/nvm-sh/nvm)：

```bash
nvm install
nvm use
```

### 1.2 pnpm

通过 [Corepack](https://nodejs.org/api/corepack.html) 启用，版本由根目录
[`package.json`](./package.json) 的 `packageManager` 字段锁定（当前
`pnpm@11.21.0`），不需要单独全局安装：

```bash
corepack enable
```

### 1.3 Rust 工具链

版本与组件由根目录 [`rust-toolchain.toml`](./rust-toolchain.toml) 声明（当前
channel `1.94.0`，含 `clippy`、`rustfmt` 组件）。装了 [rustup](https://rustup.rs/)
后，在仓库目录下运行任意 `cargo` 命令会自动拉取匹配版本，无需手动切换。

### 1.4 安装依赖并跑起来

```bash
pnpm install
pnpm tauri dev      # 开发环境，拉起窗口
```

Tauri 2 的系统级依赖（WebView 运行时等）请参照
[Tauri 官方前置条件文档](https://tauri.app/start/prerequisites/)按你的操作系统安装，
本文件不重复列出，避免与上游文档脱节。

### 1.5 常用命令

```bash
pnpm typecheck                      # 全 workspace 类型检查
pnpm gs:check                       # 见下方「三、pnpm gs:check 十道门」
cargo test --workspace              # Rust 侧全量测试
cargo clippy --workspace --all-targets -- -D warnings
pnpm gs:new-plugin <game>           # 生成插件脚手架（见下方「四、显式插件注册」）
pnpm gs:sanitize <目录> [--write]   # fixture 脱敏工具（见下方「六、fixture 脱敏」）
pnpm --filter <game> test           # 单插件 fixture 契约测试
```

---

## 二、插件贡献的两条硬性要求

新游戏插件 PR 必须满足：

1. **必须附带脱敏后的测试 fixture**——维护者不可能持有每款游戏的真实账号，
   没有样本数据就无法审阅这个插件的行为是否正确，游戏改版后也无法回归测试。
   fixture 放在仓库根目录 `fixtures/<game>/` 下，与 `plugins/<game>/` 平级。
2. **不得包含任何真实凭据**——`authkey`、抽卡链接签名、玩家 UID、设备 ID
   一律禁止入库。提交前用 `pnpm gs:sanitize` 脱敏（见下方「六」），`pnpm gs:check`
   的 SANI 门也会在真实 fixture 目录（不含合成占位值）里扫一遍确认没有遗漏。

---

## 三、`pnpm gs:check` 十道门

`pnpm gs:check`（[`scripts/gs-check/index.mjs`](./scripts/gs-check/index.mjs)）
是本地可跑、每次提交前都应该跑一遍的机械门禁。以下按实际执行顺序列出十道门，
每道门用一句话说清楚它在防什么（详细逻辑见各自源码文件头部注释）：

| 门 | 检查什么 | 在防什么 |
|----|---------|---------|
| **HC-1** 编译期打包 | `plugins/**/*.ts` 里不能出现 `eval`/`new Function`/`require`/动态 `import(变量)` 等运行时动态求值痕迹；`plugins/` 下实际存在的插件目录必须与 [`plugins/index.ts`](./plugins/index.ts) 注册的集合严格相等 | 防止插件代码绕过显式注册表在运行时被动态加载——一旦能动态加载，「PR diff 里能看见新增插件」这条 code review 防线就会失效 |
| **HC-2** 能力窄口 | `src-tauri/capabilities/*.json` 权限必须严格等于 `["core:default"]`；插件目录的 npm 依赖不能出现能绕开宿主直接做文件 IO / 网络请求的包；真实跑一遍 QuickJS 测试，断言 `invoke`/`fetch`/`fs`/`require`/`process`/`XMLHttpRequest` 等全局在插件运行时里确实是 `undefined` | 插件代码跑在 Rust 内嵌的 QuickJS 引擎里，物理上摸不到系统能力——这道门验证的正是「摸不到」这件事在运行时是否真的成立，而不是只看代码声明 |
| **HC-3** 类型生成 | 重新执行 codegen / 插件打包命令后 `git status` 必须干净；对每个声明了 `fixture.test.ts` 的插件跑一遍 fixture 回归；`packages/gs-plugin-kit/types/generated.ts` 导出的每个类型在 `schema/index.ts` 里必须有对应的 zod 运行时校验；Rust 侧与 TS 侧的 SDK 版本号必须一致 | 类型定义、插件打包产物、运行时校验三者是「生成之后手动改过没有」「改了源码忘了重新生成」这类漂移的高发区，任何一处脱节都会导致「类型对但运行时炸」 |
| **HC-4** 声明必被消费 | manifest 契约里登记的字段，必须在 Rust 侧找到对应的镜像结构体字段、该字段未被 `#[allow(dead_code)]` 标记、且在声明它的文件之外确实有非测试代码读取过 | 防止「字段解析出来了、类型检查通过、代码 review 也没发现问题，但运行时压根没人用这个字段」——这种失败比字段缺失更隐蔽，因为不会报任何错 |
| **HC-5** 模板可用性 | 用 `pnpm gs:new-plugin` 的生成逻辑真实生成一份探针插件，依次跑 `tsc --noEmit` 和探针自带的 `fixture.test.ts` | 防止贡献者第一次接触仓库、用脚手架生成插件时，脚手架模板本身因为契约变更没跟着更新而生成出一个开箱即错的插件 |
| **SANI** fixture 脱敏工具自检 | 跑 `gs-sanitize` 每条脱敏规则的固定反例断言，并真实扫描 `fixtures/` 目录一遍，命中数必须为 0 | 脱敏工具自己也可能有 bug（比如某类敏感值的位数覆盖不到），这道门既验证工具本身可靠，也验证仓库里现存的 fixture 真的干净 |
| **REQWORD** 前置条件文案措辞 | `level: "required"` 的前置条件说明文案（`Precondition.describe`）里不得出现「建议」「推荐」「最好」这类暗示「不满足也无所谓」的措辞 | `Required` 的代码语义是硬拒绝，如果文案听起来像「可选」，用户会被文案带偏排查方向——措辞与行为不一致比不写更有害 |
| **FIXRS** 真实 fixture 必须流过 Rust 侧 | 对每个已注册插件，`crates/` 下的 Rust 测试代码里必须至少有一处真实引用了该插件的 `fixtures/<id>/raw_response` 数据 | 防止 TS 侧测试和 Rust 侧测试各自全绿，但两侧从未真正拿同一份真实数据联调过——字段解析在 TS 侧对了不代表传到 Rust 侧计算也对 |
| **FMT** `cargo fmt --all --check` | 全 workspace 的 Rust 代码格式是否与 `rustfmt` 默认规则一致 | 格式化一致性，避免 PR diff 里混入无关的格式改动 |
| **FLIC** 前端依赖许可扫描 | 用 `pnpm licenses list --json` 扫描前端依赖树，对照一份与 [`deny.toml`](./deny.toml)（Rust 侧许可门禁）对齐的纯允许清单——清单内放行，清单外一律失败 | Rust 侧有 `cargo deny` 做机械许可扫描，此前前端侧没有等价机制，只能靠人工核对公开发行信息；这道门把前端依赖的许可合规也纳入机械验证 |

任一门失败都应该被当作真实问题处理，而不是绕过——本项目的插件安全模型（插件用
TypeScript 而非 Rust 编写）成立的前提，正是 HC-1~HC-5 这几条硬约束持续生效。

---

## 四、显式插件注册

新插件不会被自动扫描收集，必须在 [`plugins/index.ts`](./plugins/index.ts)
里手动追加一行：

```ts
export const plugins: Array<() => Promise<unknown>> = [
  () => import("./genshin/manifest.ts"),
  () => import("./wuwa/manifest.ts"),
  () => import("./starrail/manifest.ts"),
  () => import("./zzz/manifest.ts"),
  () => import("./yourgame/manifest.ts"), // 新插件在此追加一行
];
```

选择显式注册而不是自动扫描目录，理由写在该文件自己的文档注释里：**新增一行
`import` 必须在 PR diff 里一眼可见，这是 code review 作为唯一安全防线的前提**。
如果插件是自动收集的，审阅者很容易漏看「这个 PR 其实新增了一整个插件」这件事。

用脚手架起步：

```bash
pnpm gs:new-plugin <game>
```

会在 `plugins/<game>/` 生成 manifest、可选 hooks、一份带示例数据的 fixture 契约
测试，以及在 `fixtures/<game>/` 生成对应的样本目录——一份「开箱能跑通测试」的
最小可用插件，改起来比从空文件开始容易。生成之后别忘了去
`plugins/index.ts` 手动追加注册这一行（脚手架不会替你改这个文件）。

---

## 五、Rust / TypeScript 能力边界

一句话：**Rust 做一切与操作系统打交道的事；TypeScript 只描述「这个游戏长什么样」。**
TS 侧插件运行环境（QuickJS）物理上不提供 `fetch` / `fs` / `child_process`——见上方
HC-2 门——这是限制，不是君子协定。

判断一段逻辑该写在哪一侧的测试：**「这段逻辑换一个游戏还成立吗？」**成立归 Rust
（流程/系统能力），不成立归 TS（游戏知识）。仓库里两个具体例子：

- 「按声明的格式解析一条时间字符串」这个**算法**换一个游戏依然成立，归 Rust
  （`crates/paradigms/gs-p-authkey/src/pipeline.rs`）；但「这个游戏的时间用什么
  格式书写」是**游戏知识**，由插件在 `time.rawFormat` 声明。
- 「逐字节异或解混淆」的**算法框架**（读取字节、位运算）换一个游戏依然成立，归
  Rust；但「跳过前几个字节、按字节值奇偶分别异或哪个掩码」这组**具体参数**只对
  某一款游戏成立，归 TS 声明（`packages/gs-plugin-kit/manifest.ts` 的
  `LogDecodeSpec` 一节有完整说明）。

窄口参数只能是 `gameId` / `paradigmId` 这类标识符，不能是裸路径——一个接受任意
文件路径的窄口函数，本质上就是 `readFile(anyPath)` 换了个名字，等于没有窄口。

---

## 六、fixture 脱敏

提交 fixture 前，用脱敏工具跑一遍：

```bash
pnpm gs:sanitize fixtures/<game>          # 默认 dry-run，只报告命中位置，不改文件
pnpm gs:sanitize fixtures/<game> --write  # 确认命中都对之后，再加 --write 真正落盘替换
```

默认 dry-run 是刻意设计：脱敏工具如果误伤了你精心构造的样本数据，这个损失是
不可逆的，所以先看报告、确认没有误伤，再执行 `--write`。工具目前覆盖
`authkey`/`authkey_ver`/`sign_type`、19 位及以上纯数字串（雪花 ID 一类）、
`uid`/`player_id` 字段、`ServerID` 十六进制字段、`accessToken`、`Authorization`
头、`cookie` 字段几类模式；提交前仍建议自己再通读一遍 fixture 内容，工具兜底不
代替人工审阅。

---

## 七、Commit 规范

本仓库目前没有接入 commitlint 一类的工具做强制校验，约定靠开发者自觉遵守，风格
统一为：

```
<type>: <中文描述>
```

`type` 用到过的取值（按提交历史实际统计）：`feat`（新功能/新能力）、`fix`（修
bug）、`chore`（不影响功能的杂项，如工具链配置、文档骨架）。不带 scope，冒号后
跟一个空格再接中文描述，描述用祈使/陈述语气概括改了什么，不需要在标题里堆砌
细节（细节放 commit body）。例如：

```
feat: 星铁与绝区零插件接入（M3-S1/S2）
fix: gs-sanitize 扫描模式无绿态——9 条规则里 7 条会重新命中自己的占位值
chore: 补齐 M0 合规两件套 deny.toml 与 THIRD-PARTY-NOTICES
```

---

## License

贡献即表示同意你的代码以 [MIT 许可证](./LICENSE)发布，与本项目保持一致。
