#!/usr/bin/env node
// HC-3 · 类型生成 + 运行时校验（codegen 一致性）
//
// 约束：packages/gs-plugin-kit/types/ 下的 TS 类型由 gs-host 生成（HC-3
// 硬约束之一，禁止手改生成产物）。本门重跑一遍 codegen 命令，再对生成目录
// 跑 git diff，diff 必须为空，否则说明代码库里已提交的类型和当前 Rust
// 定义不一致（要么忘了重新生成，要么有人手改了生成产物）。
//
// gs-codegen 这个二进制目前由另一个 agent 实现中，本 Stage 尚未落地。
// 命令跑不起来时（cargo 报 "no bin target"）不能算失败，只能算“尚未到跑
// 这道门的阶段”，因此显式识别这种情况并跳过，同时在输出里说清楚，避免
// 被误读成“门通过了实际检查”。
//
// TODO（留待 M1-S4）：
//   - fixture 回归 assertPluginFixture
//   - zod schema 覆盖率检查

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE_BASE = 'HC-3 类型生成（codegen 一致性）';
const TYPES_DIR = 'packages/gs-plugin-kit/types/';

// 插件 bundle 与 manifest 静态字段 JSON。它们由 scripts/gs-bundle-plugins.mjs
// 从 plugins/** 打包，被 gs-plugin-runtime 用 include_str! 嵌进二进制。
//
// 为什么也要进这道门：它和 types/ 是同一类东西——生成产物且必须 committed
// （否则新克隆 include_str! 直接编译失败）。更要紧的是，产物落后于 plugins/
// 源码时**不会有任何报错**，只是二进制里跑的还是旧版插件代码，
// 而插件代码正是 record_key、归一化这些静默失败高发区的所在。
const PLUGIN_BUNDLE_DIR = 'crates/gs-plugin-runtime/generated/';

const TODO_NOTES = [
  'TODO：fixture 回归 assertPluginFixture —— 留待 M1-S4',
  'TODO：zod schema 覆盖率检查 —— 留待 M1-S4',
];

function joinOutput(result) {
  return [result.stdout, result.stderr].filter((s) => s && s.trim().length > 0).join('\n');
}

export async function run() {
  const repoRoot = findRepoRoot();

  const codegenResult = spawnSync(
    'cargo',
    ['run', '--quiet', '-p', 'gs-host', '--bin', 'gs-codegen'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (codegenResult.error) {
    // cargo 本身都起不来（例如未安装），当作真失败处理，不能悄悄跳过
    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(cargo run -p gs-host --bin gs-codegen)',
          line: 0,
          column: 0,
          reason: `无法执行 cargo 命令：${codegenResult.error.message}`,
        },
      ],
      notes: TODO_NOTES,
    };
  }

  if (codegenResult.status !== 0) {
    const stderr = codegenResult.stderr ?? '';
    if (/no bin target/i.test(stderr)) {
      return {
        id: 'HC-3',
        title: `${GATE_TITLE_BASE}（gs-codegen 尚未落地，跳过本门）`,
        status: 'skip',
        findings: [],
        notes: [
          'gs-codegen 二进制尚未实现（cargo run -p gs-host --bin gs-codegen 报 "no bin target"），本门跳过，不计入 gs:check 整体失败。',
          '待 gs-host 落地该二进制后，请重新确认本门是否真的转为通过/失败，不要一直停在跳过状态。',
          ...TODO_NOTES,
        ],
      };
    }

    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(cargo run -p gs-host --bin gs-codegen)',
          line: 0,
          column: 0,
          reason: `codegen 命令执行失败，退出码 ${codegenResult.status}`,
          snippet: joinOutput(codegenResult),
        },
      ],
      notes: TODO_NOTES,
    };
  }

  // codegen 跑成功了，接着校验产物是否与已提交的类型一致。
  //
  // ⚠️ 这里刻意用 `git status --porcelain` 而不是 `git diff --exit-code`。
  // `git diff` 只比对**已跟踪**文件的工作区与索引，未跟踪文件对它完全不可见——
  // 也就是说，只要生成产物还没入库（或 codegen 新产出了一个文件），这道门会
  // 静默变绿，而它本该拦住的正是「生成产物与代码库不同步」。实测证实过：
  // 手改 generated.ts 注入一行假类型，git diff 版本的检查一个字都没报。
  // 一道永远绿的门等于没有门，所以改用能同时看见 modified 与 untracked 的
  // porcelain 输出。
  // 插件 bundle 也要重打一遍再比对，理由同 TYPES_DIR 的注释。
  const bundleResult = spawnSync('node', ['scripts/gs-bundle-plugins.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (bundleResult.error || bundleResult.status !== 0) {
    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(node scripts/gs-bundle-plugins.mjs)',
          line: 0,
          column: 0,
          reason: bundleResult.error
            ? `无法执行插件打包脚本：${bundleResult.error.message}`
            : `插件打包脚本执行失败，退出码 ${bundleResult.status}`,
          snippet: joinOutput(bundleResult),
        },
      ],
      notes: TODO_NOTES,
    };
  }

  const statusResult = spawnSync(
    'git',
    ['status', '--porcelain', '--', TYPES_DIR, PLUGIN_BUNDLE_DIR],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (statusResult.status !== 0) {
    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(git status)',
          line: 0,
          column: 0,
          reason: `git status 命令本身异常退出，退出码 ${statusResult.status}`,
          snippet: joinOutput(statusResult),
        },
      ],
      notes: TODO_NOTES,
    };
  }

  const dirtyEntries = (statusResult.stdout ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (dirtyEntries.length === 0) {
    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'pass',
      findings: [],
      notes: TODO_NOTES,
    };
  }

  // porcelain 的状态码前两位区分了原因，翻译成人话再给出去，
  // 否则用户看到 `?? xxx.ts` 不知道该提交还是该重跑 codegen。
  const findings = dirtyEntries.map((entry) => {
    const code = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const reason = code === '??'
      ? '生成产物尚未纳入版本控制（untracked）——请 git add 后提交，否则这道门看不住它'
      : `生成产物与已提交内容不一致（git status 状态码 ${code.trim()}）——请确认是重跑 codegen 后忘了提交，还是有人手改了生成产物`;
    return { file: filePath, line: 0, column: 0, reason };
  });

  return {
    id: 'HC-3',
    title: GATE_TITLE_BASE,
    status: 'fail',
    findings,
    notes: TODO_NOTES,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run();
  renderResult(result);
  console.log('');
  renderSummary([result]);
  process.exitCode = result.status === 'fail' ? 1 : 0;
}
