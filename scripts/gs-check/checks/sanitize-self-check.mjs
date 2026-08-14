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

// ★ 2026-08-14 起本门多做一件事：**真的扫一遍 `fixtures/`**，命中数必须为 0。
//
// 在此之前本门只跑纯函数级自检用例——工具自己是对的，但没有任何一道门去看
// 仓库里真实的 fixture 有没有泄露。之所以此前做不到，是因为扫描模式当时对
// 任何已脱敏目录都不归零（9 条规则里 7 条会重新命中自己写出的占位值，
// starrail 报 98 处、genshin 报 35 处），拿它当门禁只会得到一道永远红的门。
// 那个缺陷修掉、并让工具认得 fixture 的合成 ID 约定之后，`fixtures/` 才真正
// 能扫到 0，这道门也才第一次名副其实——`CLAUDE.local.md`「贡献者要求」承诺的
// 「CI 做密钥扫描」到这里才算兑现，而不再只是一个待办。
//
// 覆盖范围如实说明：只扫 `fixtures/`。凭据泄露的高危面是插件 PR 附带的样本
// 数据，那正是 `fixtures/`；`crates/` 与 `plugins/` 里的内联测试字面量不在
// 扫描范围内（它们由 code review 把关，且不是贡献者提交的批量数据）。

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';
import { runCases } from '../../gs-sanitize.self-check.mjs';
import { collectFiles, scanText, readFileText } from '../../gs-sanitize.mjs';

const GATE_TITLE = 'SANI fixture 脱敏工具自检 + fixtures/ 真实扫描';
const SELF_CHECK_REL_PATH = 'scripts/gs-sanitize.self-check.mjs';
const FIXTURES_DIR = 'fixtures';

/** 扫描 `fixtures/` 全目录，返回每一处命中的定位信息。 */
function scanFixtures(repoRoot) {
  const absDir = path.join(repoRoot, FIXTURES_DIR);
  if (!existsSync(absDir)) return { scannedFiles: 0, hits: [] };

  const hits = [];
  const files = collectFiles(absDir);
  let scannedFiles = 0;
  for (const absPath of files) {
    const text = readFileText(absPath);
    if (text === null) continue; // 二进制，跳过（判定见 gs-sanitize 的 isProbablyText）
    scannedFiles += 1;
    for (const finding of scanText(text)) {
      hits.push({
        file: path.relative(repoRoot, absPath),
        line: finding.line,
        ruleId: finding.rule.id,
        reason: finding.rule.reason,
        matchedText: finding.matchedText,
      });
    }
  }
  return { scannedFiles, hits };
}

export async function run() {
  const repoRoot = findRepoRoot();
  const results = await runCases();
  const findings = results
    .filter((r) => !r.pass)
    .map((r) => ({
      file: SELF_CHECK_REL_PATH,
      line: 0,
      column: 0,
      reason: `自检用例失败："${r.name}" —— ${r.error}`,
    }));

  const { scannedFiles, hits } = scanFixtures(repoRoot);
  for (const hit of hits) {
    findings.push({
      file: hit.file,
      line: hit.line,
      column: 0,
      // 刻意**不回显 matchedText 的完整内容**：如果它真的是一条泄露的凭据，
      // 门禁输出会进 CI 日志，等于把凭据再抄一份到另一个地方。只给规则名与
      // 长度，定位靠 文件:行号。
      reason:
        `[${hit.ruleId}] ${hit.reason}——fixture 里不得出现真实凭据。` +
        `命中内容长度 ${hit.matchedText.length} 字符，已刻意不回显（避免把疑似凭据抄进 CI 日志），` +
        `请按 文件:行号 自行查看。若确认是脱敏后的合成值而工具没认出来，` +
        `说明合成值不符合约定形态（见 gs-sanitize.mjs 的 SYNTHETIC_LONG_ID_RE），` +
        `请改用约定形态或跑 \`pnpm gs:sanitize ${FIXTURES_DIR}/<game> --write\`。`,
    });
  }

  return {
    id: 'SANI',
    title: GATE_TITLE,
    status: findings.length > 0 ? 'fail' : 'pass',
    findings,
    notes: [
      `已跑 ${results.length} 条 gs-sanitize 自检用例（含每条新规则的"不加会漏/加了会命中/不误伤"三组反例与幂等性测试）`,
      `已实扫 ${FIXTURES_DIR}/ 下 ${scannedFiles} 个文本文件，命中 ${hits.length} 处` +
        (hits.length === 0 ? '——无疑似凭据' : ''),
      '⚠️ 扫描范围只含 fixtures/：凭据泄露的高危面是插件 PR 附带的样本数据。' +
        'crates/ 与 plugins/ 里的内联测试字面量由 code review 把关，不在本门范围内。',
    ],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run();
  renderResult(result);
  console.log('');
  renderSummary([result]);
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
