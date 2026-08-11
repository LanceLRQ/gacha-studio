#!/usr/bin/env node
// HC-2 · 能力窄口（IPC 表面收窄，凭据不过 IPC）
//
// 本 Stage 只落地两条能真实跑起来的检查，其余留 TODO（见下）：
//
//   1. Tauri capabilities 白名单：src-tauri/capabilities/*.json 里的
//      permissions 必须严格等于 ["core:default"]，不允许任何其它值。
//      这是「未注册任何文件系统/网络/shell/dialog 类插件」这一当前状态的
//      机械防线——防止有人在没有走窄口设计评审的情况下悄悄放宽权限。
//   2. 插件目录 IO 类依赖扫描：plugins/*/package.json 的 dependencies
//      不允许出现能绕过宿主直接做文件 IO / 网络请求的包，因为那等价于
//      绕开 HC-2 的窄口约束直接拿到系统能力。
//
// TODO（留待 M1-S7）：
//   - IPC 命令清单人工审计文档
//   - 凭据类型不可序列化的编译期验证

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE = 'HC-2 能力窄口（IPC 表面收窄）';

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

export async function run() {
  const repoRoot = findRepoRoot();

  const capabilitiesCheck = checkCapabilities(repoRoot);
  const dependenciesCheck = checkPluginDependencies(repoRoot);

  const findings = [...capabilitiesCheck.findings, ...dependenciesCheck.findings];

  const notes = [
    `已扫描 src-tauri/capabilities/*.json 共 ${capabilitiesCheck.scannedFiles} 个文件`,
    `已扫描 plugins/*/package.json 共 ${dependenciesCheck.scannedDirs} 个插件目录` +
      (dependenciesCheck.scannedDirs === 0 ? '（当前 plugins/ 下还没有任何游戏子目录，0 命中视为通过）' : ''),
    'TODO：IPC 命令清单人工审计文档 —— 留待 M1-S7',
    'TODO：凭据类型不可序列化的编译期验证 —— 留待 M1-S7',
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
