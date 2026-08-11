#!/usr/bin/env node
// FMT · cargo fmt --all --check
//
// pnpm gs:check 之前完全没有格式检查——全仓已经积累了 84 处 `cargo fmt` 差异
// （2026-08-11 现状）。本门只负责"检测有没有格式化"，不负责"把仓库格式化"：
// 交付这道门时刻意不跑 `cargo fmt --all` 去清理现存差异，因为另有并发改动
// 正在 crates/gs-analysis、crates/gs-storage 里进行，全仓格式化会与那些改动
// 冲突。所以这道门**预期在交付时是红的**——这是正确状态，不是需要修的 bug；
// 全仓统一格式化由后续单独一次改动处理。
//
// 不加 `--check`（比对退出码）以外的额外逻辑：`cargo fmt` 差异的定位信息
// （文件名 + diff）本身就是 rustfmt 输出的，直接透传即可，不需要重新解析。

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE = 'FMT cargo fmt --all --check（格式化一致性）';

function joinOutput(result) {
  return [result.stdout, result.stderr].filter((s) => s && s.trim().length > 0).join('\n');
}

/** `cargo fmt --check` 的 diff 输出里，每个文件以 "Diff in <path>:<line>:" 开头（绝对路径）。 */
function extractDirtyFiles(output, repoRoot) {
  const files = new Set();
  for (const m of output.matchAll(/^Diff in (\S+):\d+:$/gm)) {
    files.add(path.relative(repoRoot, m[1]));
  }
  return [...files];
}

export async function run() {
  const repoRoot = findRepoRoot();

  const result = spawnSync('cargo', ['fmt', '--all', '--', '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.error) {
    return {
      id: 'FMT',
      title: GATE_TITLE,
      status: 'fail',
      findings: [
        {
          file: '(cargo fmt --all -- --check)',
          line: 0,
          column: 0,
          reason: `无法执行 cargo fmt：${result.error.message}`,
        },
      ],
      notes: [],
    };
  }

  if (result.status === 0) {
    return {
      id: 'FMT',
      title: GATE_TITLE,
      status: 'pass',
      findings: [],
      notes: ['全仓格式与 rustfmt 默认规则一致'],
    };
  }

  const output = joinOutput(result);
  const dirtyFiles = extractDirtyFiles(output, repoRoot);

  return {
    id: 'FMT',
    title: GATE_TITLE,
    status: 'fail',
    findings:
      dirtyFiles.length > 0
        ? dirtyFiles.map((file) => ({ file, line: 0, column: 0, reason: '格式与 rustfmt 默认规则不一致，运行 `cargo fmt` 后重新提交' }))
        : [{ file: '(cargo fmt --all -- --check)', line: 0, column: 0, reason: '检测到格式差异，但未能从输出解析出具体文件列表', snippet: output }],
    notes: [
      `本门预期在本次改动交付时为红——全仓已有历史格式差异，且有并发改动正在 crates/gs-analysis、` +
        'crates/gs-storage 进行，本次改动不执行全仓 `cargo fmt` 以避免冲突，留给后续单独一次改动统一处理。',
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
