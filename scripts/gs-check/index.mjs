#!/usr/bin/env node
// pnpm gs:check —— 插件层「改用 TypeScript 而非 Rust」这个架构决策的
// 机械验证装置。依次跑六道门：
//   HC-1 编译期打包（禁止运行时动态加载）
//   HC-2 能力窄口（IPC 表面收窄，凭据不过 IPC）
//   HC-3 类型生成（codegen + git diff 必须为空）
//   HC-4 声明必被消费（契约字段必须能在 L1 找到真实消费点）
//   HC-5 模板可用性（scaffold 模板必须能通过类型检查，见该门文件头注释——
//        templates/ 不在 pnpm workspace 范围内，pnpm typecheck 天生看不见它）
//   FMT  cargo fmt --all --check（格式化一致性，不属于 HC 编号序列）
// 任一门失守都应该退回 Rust 插件方案，所以这不是普通 lint，是持续门禁——
// CI 平台还没定不能作为暂缓的理由，本脚本就是本地可跑、真实生效的替代。

import { run as runNoDynamicImport } from './checks/no-dynamic-import.mjs';
import { run as runIpcSurface } from './checks/ipc-surface.mjs';
import { run as runCodegenDiff } from './checks/codegen-diff.mjs';
import { run as runDeclarationConsumption } from './checks/declaration-consumption.mjs';
import { run as runTemplateTypecheck } from './checks/template-typecheck.mjs';
import { run as runCargoFmt } from './checks/cargo-fmt.mjs';
import { renderResult, renderSummary } from './lib/report.mjs';

async function main() {
  console.log('gs:check —— 插件层 TypeScript 化架构决策的机械验证门禁');
  console.log('');

  const results = [];
  results.push(await runNoDynamicImport());
  results.push(await runIpcSurface());
  results.push(await runCodegenDiff());
  results.push(await runDeclarationConsumption());
  results.push(await runTemplateTypecheck());
  results.push(await runCargoFmt());

  for (const result of results) {
    renderResult(result);
    console.log('');
  }

  const failCount = renderSummary(results);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('gs:check 执行过程中发生未预期错误：');
  console.error(err);
  process.exitCode = 1;
});
