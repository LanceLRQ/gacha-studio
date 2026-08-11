# drills/ —— 纸面填表演练草稿

本目录是 `docs/_internal/milestones/02-M1-原神插件全链路.md` S7「验收」阶段
的产物：用崩坏：星穹铁道与绝区零两款游戏，各写一份 `manifest.ts` 草稿，
验证 M1 定下的插件契约类型（`packages/gs-plugin-kit`）填不填得下这两款游戏
已实测的真实差异点。

## 为什么不放在 `plugins/` 下

`scripts/gs-bundle-plugins.mjs` 用 `discoverPluginIds()`
（该文件第 101～122 行）**扫描目录**发现插件：任何 `plugins/<id>/manifest.ts`
存在即被视为一个真插件，会被打进 `crates/gs-plugin-runtime/generated/` 下的
构建产物、编译进最终二进制。这两份草稿从未经过 fixture 契约测试、从未接入
`plugins/index.ts` 显式注册表，也没有 `hooks.ts`——把它们放进 `plugins/`
会被误当成"已经可用的插件"打包发布，因此必须放在扫描范围之外。

## 这些草稿永远不会被打包

- 不接入 `plugins/index.ts`
- 没有 `hooks.ts`（`resolveTimezone` / `deriveRecordKey` 等逃生舱钩子只在
  注释里提及应该怎么写，不提供可执行实现）
- 没有 `fixture.test.ts` / `fixtures/`
- `pnpm-workspace.yaml` 把 `drills`、`drills/*` 声明为独立于 `plugins*`
  的 workspace 包，`gs-bundle-plugins.mjs` 只扫 `plugins/` 目录，本目录
  物理上不在它的发现范围内

存在的唯一价值是**被 `pnpm typecheck` 真实类型检查过**——这也是为什么要
真正接入 pnpm workspace，而不是把草稿写成一段贴在文档里的代码块。

## 结论产出

演练结论（逐条差异点是否填得下、勉强填进去但别扭的地方、发现的契约/实现
缺口）记录在
`docs/_internal/audit/AUDIT-2026-08-11-S7纸面填表演练.md`，不在本目录重复。

## 数据来源

两份草稿里引用的字段名、参数名、稀有度阶梯等具体数据，全部来自：

- `docs/_internal/research/03-真实导出数据格式实测.md`
- `docs/_internal/research/04-同族工具三方源码对比.md`
- `docs/_internal/research/01-抽卡工具生态与采集范式调研.md`（仅用于
  `credential.gameDir` 的目录片段，这是范式 A 的通用结论，非游戏专属差异点）

未在上述文档中找到直接依据的字段，注释里明确标注「research 未覆盖，需实测」，
不凭训练记忆编造。
