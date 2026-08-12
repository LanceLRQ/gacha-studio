#!/usr/bin/env node
// SANI · fixture 脱敏工具自检（gs-sanitize 规则反例测试）
//
// 起因：AUDIT-2026-08-12-M2鸣潮真实存档实测.md §四——`gs-sanitize.mjs` 的
// `long-numeric-id` 规则只覆盖 19 位及以上纯数字，完全漏掉了米哈游/库洛的
// 9 位玩家 UID 与鸣潮 ServerID 这类 32 位十六进制标识符，合成样本实测
// 「已扫描 1 个文件，命中 0 处」——完全放行。§4.4 第 2 条要求：新增规则必须
// 各自构造反例，照 HC-2/HC-4 的做法把反例固化成测试，不靠人记得跑。
//
// 不归进 HC 编号序列：HC-1~HC-5 验证的是"插件层改用 TypeScript 而非 Rust"
// 这一个架构决策的具体前提，gs-sanitize 是通用的 fixture 安全工具，与该决策
// 无关——这与 FMT 门（cargo fmt 一致性，同样不属于 HC 编号序列但仍是
// gs:check 的一道门）是同一种归类判断。
//
// 本门做什么：直接复用 scripts/gs-sanitize.self-check.mjs 导出的
// `runCases()`，把"每条新规则的反例测试是否全部通过"接进 gs:check 的常规
// 六道门流程里——贡献者跑一次 `pnpm gs:check` 就能看到，不需要单独记得跑
// `node scripts/gs-sanitize.self-check.mjs`。两个入口共用同一份测试用例
// 定义（不复制一份），避免自检脚本本身与门禁悄悄漂移。
//
// 找不到具体的"文件:行号"来定位失败——自检用例是纯函数级断言，不是扫描
// 源码文件产生的命中，因此 findings 里的 file 统一写自检脚本路径，
// reason 就是失败的用例名 + 断言错误信息。

import { pathToFileURL } from 'node:url';
import { renderResult, renderSummary } from '../lib/report.mjs';
import { runCases } from '../../gs-sanitize.self-check.mjs';

const GATE_TITLE = 'SANI fixture 脱敏工具自检（gs-sanitize 规则反例测试）';
const SELF_CHECK_REL_PATH = 'scripts/gs-sanitize.self-check.mjs';

export async function run() {
  // 本门不需要扫描仓库文件，测试用例都是纯函数级断言，因此不像其它
  // checks/*.mjs 那样需要 findRepoRoot() 来解析绝对路径。
  const results = await runCases();
  const findings = results
    .filter((r) => !r.pass)
    .map((r) => ({
      file: SELF_CHECK_REL_PATH,
      line: 0,
      column: 0,
      reason: `自检用例失败："${r.name}" —— ${r.error}`,
    }));

  return {
    id: 'SANI',
    title: GATE_TITLE,
    status: findings.length > 0 ? 'fail' : 'pass',
    findings,
    notes: [`已跑 ${results.length} 条 gs-sanitize 自检用例（含每条新规则的"不加会漏/加了会命中/不误伤"三组反例与幂等性测试）`],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run();
  renderResult(result);
  console.log('');
  renderSummary([result]);
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
