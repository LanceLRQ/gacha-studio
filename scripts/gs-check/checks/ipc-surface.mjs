#!/usr/bin/env node
// HC-2 · 能力窄口
//
// ⚠️ 口径变更说明（2026-08-11，M1-S7 复核时改写）：
// 本文件顶部与下方 notes 里曾经写的 TODO 是「IPC 命令清单人工审计文档 +
// 凭据类型不可序列化的编译期验证」，那是在 §6.7 裁定插件执行位置之前的口径。
// `docs/_internal/milestones/00-实施总览.md` §6.7 裁定：插件 TS 纯函数跑在
// Rust 内嵌的 QuickJS 引擎里，不跑在前端 webview——插件代码物理上摸不到
// Tauri IPC，`invoke` 在 QuickJS 里根本不存在。同一份文档 §8.1 因此明确写
// 「本节裁定连带改写了 §8.1 的 HC-2 验收方式（『IPC 命令清单人工审计』→
// 『JS 引擎暴露面审计』）」。所以本门的验证重心已经从"审计 Tauri IPC 命令"
// 改写为"审计 QuickJS 里实际暴露了什么"——这不是漏做了 IPC 审计，是审计对象
// 本身变了。Tauri IPC 命令清单仍然要审计（前端 webview 与 Rust 之间那条边界
// 依然存在，只是与插件无关），已经落在人工审计文档里，见下方 notes。
//
// 本门落地四条检查，前两条延续 M1-S1 的既有实现，未丢：
//
//   1. Tauri capabilities 白名单：src-tauri/capabilities/*.json 里的
//      permissions 必须严格等于 ["core:default"]，不允许任何其它值。
//      这是「未注册任何文件系统/网络/shell/dialog 类插件」这一当前状态的
//      机械防线——防止有人在没有走窄口设计评审的情况下悄悄放宽权限。
//   2. 插件目录 IO 类依赖扫描：plugins/*/package.json 的 dependencies
//      不允许出现能绕过宿主直接做文件 IO / 网络请求的包，因为那等价于
//      绕开 HC-2 的窄口约束直接拿到系统能力。
//   3. ★ JS 引擎暴露面审计（新增）：驱动 `cargo test -p gs-plugin-runtime
//      --lib` 真实跑一遍 QuickJS——`crates/gs-plugin-runtime/src/lib.rs`
//      里已有 `injected_globals_list_is_empty`（断言 INJECTED_GLOBALS 清单
//      为空）与 `forbidden_globals_are_absent`（在真实 QuickJS Context 里
//      逐个断言 invoke/fetch/fs/require/process/XMLHttpRequest 确实是
//      undefined）两个测试，本 Stage 之前没有任何机械门禁去跑它们——
//      测试写了但从未被 gs:check 调用，等于名义上有门、实际没人推门。
//      这里选择"驱动真实 Rust 测试"而不是"用正则解析 Rust 源码里的常量数组"：
//      后者只能证明"常量声明是这样写的"，前者证明"QuickJS 运行时实际表现
//      如此"——常量声明与运行时行为之间还隔着 rquickjs 版本升级、
//      Context::full 注册内容变化等本可能悄悄漂移的环节，只有真的跑一遍
//      才能盖住这段距离。不改动 gs-plugin-runtime 的生产代码，两个测试本来
//      就在那里，本门只是第一次真正去调用它们。
//   4. Tauri IPC 命令清单——留给人工审计文档（见下方 notes 的文档路径），
//      理由：命令清单目前只有 1 条（`host_runtime_ready`，无参数、返回
//      布尔），机械检查"数一下 tauri::command 的数量"意义不大，真正有价值
//      的是"每条命令最坏情况下能做什么"这个判断本身不可机械化，必须人工
//      逐条写清楚，机械检查在这里只会制造一种"看起来被检查过"的假象。
//
// 仍然只能靠人工、本门未覆盖的部分：
//   - 凭据类型不可序列化的编译期验证——`crates/paradigms/gs-p-authkey` 里
//     凭据 URL 目前就是裸 `String`（见 `cache_scan.rs` 的
//     `extract_credential_url`/`scan_game_cache` 返回类型），没有一个
//     "不可序列化"的包装类型能在编译期拦住"不小心把凭据塞进某个会被
//     serde::Serialize 的结构体"这类错误。这件事需要修改
//     `crates/paradigms/gs-p-authkey`，超出本次改动范围（范围限定
//     scripts/ + docs/ + 必要时 crates/gs-plugin-runtime 的测试），如实
//     记录为未完成，不在此打勾充数。

import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE = 'HC-2 能力窄口（JS 引擎暴露面审计 + capabilities/依赖白名单）';

// 严格白名单：当前阶段唯一允许的权限标识符。
// 不是只挡 fs:/shell:/http:/dialog: 前缀，而是严格等于——这条线不能被“悄悄放宽”。
const ALLOWED_PERMISSION = 'core:default';

// 能绕开宿主直接拿到文件 IO / 网络能力的依赖包，插件里一律不允许出现。
const FORBIDDEN_DEPENDENCIES = ['fs-extra', 'axios', 'node-fetch', 'got', 'undici', 'execa'];

/**
 * 列出目录下（不递归）匹配后缀的文件名。
 */
function listFilesWithExt(dir, ext) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name);
}

/**
 * 检查 1：src-tauri/capabilities/*.json 的 permissions 严格白名单。
 */
function checkCapabilities(repoRoot) {
  const capabilitiesDir = path.join(repoRoot, 'src-tauri', 'capabilities');
  const files = listFilesWithExt(capabilitiesDir, '.json');
  const findings = [];

  for (const fileName of files) {
    const filePath = path.join(capabilitiesDir, fileName);
    const relPath = path.relative(repoRoot, filePath);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      findings.push({
        file: relPath,
        line: 0,
        column: 0,
        reason: `JSON 解析失败：${err.message}`,
      });
      continue;
    }

    const permissions = Array.isArray(parsed.permissions) ? parsed.permissions : [];
    for (const [index, entry] of permissions.entries()) {
      const identifier = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? entry.identifier : undefined;
      if (identifier !== ALLOWED_PERMISSION) {
        findings.push({
          file: relPath,
          line: 0,
          column: 0,
          reason: `permissions[${index}] = ${JSON.stringify(entry)}，不在严格白名单内（仅允许 "${ALLOWED_PERMISSION}"）`,
        });
      }
    }
  }

  return { findings, scannedFiles: files.length };
}

/**
 * 检查 2：plugins/<game>/package.json 的 dependencies 不允许出现 IO 类依赖。
 * 注意 plugins/package.json 自身（插件层 workspace 根）不算在扫描范围内，
 * 只看 plugins/ 下每个直接子目录里的 package.json。
 */
function checkPluginDependencies(repoRoot) {
  const pluginsDir = path.join(repoRoot, 'plugins');
  let entries;
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return { findings: [], scannedDirs: 0 };
  }

  const gameDirs = entries.filter((e) => e.isDirectory() && e.name !== 'node_modules');
  const findings = [];

  for (const dirEntry of gameDirs) {
    const pkgPath = path.join(pluginsDir, dirEntry.name, 'package.json');
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      continue; // 该插件目录下没有 package.json，不在本检查范围内
    }

    const relPath = path.relative(repoRoot, pkgPath);
    const deps = parsed.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {};
    for (const depName of Object.keys(deps)) {
      if (FORBIDDEN_DEPENDENCIES.includes(depName)) {
        findings.push({
          file: relPath,
          line: 0,
          column: 0,
          reason: `dependencies 中出现禁止的 IO 类依赖 "${depName}"，插件不得绕过宿主直接做文件/网络 IO`,
        });
      }
    }
  }

  return { findings, scannedDirs: gameDirs.length };
}

function joinOutput(result) {
  return [result.stdout, result.stderr].filter((s) => s && s.trim().length > 0).join('\n');
}

/**
 * 从 `crates/gs-plugin-runtime/src/lib.rs` 里抠出 INJECTED_GLOBALS /
 * FORBIDDEN_GLOBALS 两个常量数组的字面量内容，仅用于在 gs:check 的输出里
 * 直接展示当前暴露面清单，方便复核者不用去翻 Rust 源码——**不是**本检查的
 * 真实验证手段，真实验证靠下面 runJsEngineExposureAudit 里跑的 cargo test。
 * 解析失败（比如常量改了名字/格式）不影响本门整体判定，只是展示信息缺省。
 */
function extractGlobalsListLiteral(repoRoot, constName) {
  const libPath = path.join(repoRoot, 'crates', 'gs-plugin-runtime', 'src', 'lib.rs');
  let source;
  try {
    source = readFileSync(libPath, 'utf8');
  } catch {
    return null;
  }
  const pattern = new RegExp(`pub const ${constName}: &\\[&str\\] = &(\\[[^\\]]*\\]);`);
  const match = pattern.exec(source);
  return match ? match[1] : null;
}

/**
 * 本门赖以成立的两个 Rust 测试。名字写死在这里，是因为下面要断言它们
 * **确实跑过并通过**，而不只是"整包测试退出码为 0"。
 */
const REQUIRED_RUNTIME_TESTS = ['forbidden_globals_are_absent', 'injected_globals_list_is_empty'];

/**
 * HC-2 的核心机械验证：驱动 `cargo test -p gs-plugin-runtime --lib` 真实跑
 * 一遍 QuickJS，而不是只解析 Rust 源码里的常量声明。跑整个 crate 的 lib
 * 测试（秒级完成）而不是精确过滤到那两个目标测试——cargo test 对多个测试名
 * 过滤器的语义不直观，跑全量更简单可靠。
 *
 * ⚠️ **只看退出码是不够的**，这里必须逐条确认目标测试出现在输出里且状态为
 * `ok`。实测过：给这两个测试加上 `#[ignore]`（等价于有人把它们停掉或删掉），
 * `cargo test` 依然退出 0，本门直接变绿，还照常打印"断言在 QuickJS 里确实是
 * undefined"——而此刻根本没有任何东西断言过它。这与 HC-3 早期用
 * `git diff --exit-code`（看不见未跟踪文件）导致门永远为绿是同一类错误：
 * **门之所以通过，是因为它什么都没检查**。一道永远绿的门等于没有门。
 */
function runJsEngineExposureAudit(repoRoot) {
  const result = spawnSync('cargo', ['test', '-p', 'gs-plugin-runtime', '--lib'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  const injectedLiteral = extractGlobalsListLiteral(repoRoot, 'INJECTED_GLOBALS');
  const forbiddenLiteral = extractGlobalsListLiteral(repoRoot, 'FORBIDDEN_GLOBALS');
  const literalNotes = [
    injectedLiteral
      ? `当前 INJECTED_GLOBALS = ${injectedLiteral}（宿主向 QuickJS 注入的全局量清单）`
      : '未能从源码解析出 INJECTED_GLOBALS 字面量（仅影响展示，不影响本门判定）',
    forbiddenLiteral
      ? `当前 FORBIDDEN_GLOBALS = ${forbiddenLiteral}（断言在 QuickJS 里确实是 undefined）`
      : '未能从源码解析出 FORBIDDEN_GLOBALS 字面量（仅影响展示，不影响本门判定）',
  ];

  if (result.error) {
    return {
      findings: [
        {
          file: '(cargo test -p gs-plugin-runtime --lib)',
          line: 0,
          column: 0,
          reason: `无法执行 cargo 命令：${result.error.message}`,
        },
      ],
      notes: literalNotes,
    };
  }

  if (result.status !== 0) {
    return {
      findings: [
        {
          file: 'crates/gs-plugin-runtime/src/lib.rs',
          line: 0,
          column: 0,
          reason:
            'JS 引擎暴露面审计失败：cargo test -p gs-plugin-runtime --lib 未全部通过——' +
            'injected_globals_list_is_empty / forbidden_globals_are_absent 中至少一项没有满足，' +
            '意味着 QuickJS 里的实际暴露面已经偏离了 HC-2 的约束',
          snippet: joinOutput(result),
        },
      ],
      notes: literalNotes,
    };
  }

  // 退出码为 0 只说明"没有测试失败"，不说明"该跑的测试跑了"。逐条确认。
  // cargo 的测试结果行形如 `test tests::forbidden_globals_are_absent ... ok`，
  // 被 #[ignore] 时则是 `... ignored`，被删除时整行不存在——两种情况都要拦。
  const output = joinOutput(result);
  const missing = REQUIRED_RUNTIME_TESTS.filter(
    (name) => !new RegExp(`^test .*\\b${name}\\b \\.\\.\\. ok$`, 'm').test(output),
  );

  if (missing.length > 0) {
    return {
      findings: missing.map((name) => ({
        file: 'crates/gs-plugin-runtime/src/lib.rs',
        line: 0,
        column: 0,
        reason:
          `JS 引擎暴露面审计失效：测试 \`${name}\` 没有以 ok 的状态出现在 ` +
          'cargo test 输出里（被删除、被 #[ignore]、或改了名）。本门的全部保证都来自这个测试，' +
          '它不跑，这道门就只是在确认"其余测试没失败"，与 HC-2 约束无关',
        snippet: output,
      })),
      notes: literalNotes,
    };
  }

  return {
    findings: [],
    notes: [
      ...literalNotes,
      `已确认下列测试真实跑过并通过：${REQUIRED_RUNTIME_TESTS.join(' / ')}`,
    ],
  };
}

export async function run() {
  const repoRoot = findRepoRoot();

  const capabilitiesCheck = checkCapabilities(repoRoot);
  const dependenciesCheck = checkPluginDependencies(repoRoot);
  const jsExposureCheck = runJsEngineExposureAudit(repoRoot);

  const findings = [
    ...capabilitiesCheck.findings,
    ...dependenciesCheck.findings,
    ...jsExposureCheck.findings,
  ];

  const notes = [
    `已扫描 src-tauri/capabilities/*.json 共 ${capabilitiesCheck.scannedFiles} 个文件`,
    `已扫描 plugins/*/package.json 共 ${dependenciesCheck.scannedDirs} 个插件目录` +
      (dependenciesCheck.scannedDirs === 0 ? '（当前 plugins/ 下还没有任何游戏子目录，0 命中视为通过）' : ''),
    ...jsExposureCheck.notes,
    '人工审计（非机械）：docs/_internal/audit/AUDIT-2026-08-11-HC2能力窄口审计.md —— 逐条列出 Tauri IPC 命令与 JS 全局，回答"最坏情况能做什么"',
    'TODO（仍未完成，超出本次改动范围）：凭据类型不可序列化的编译期验证——见本文件头部说明',
  ];

  return {
    id: 'HC-2',
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
