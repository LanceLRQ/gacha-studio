#!/usr/bin/env node
// HC-5 · 模板可用性（scaffold 模板必须能通过类型检查）
//
// 起因：`templates/plugin/<paradigm>/` 是 `pnpm gs:new-plugin` 的生成源，
// 但 `pnpm-workspace.yaml` 的 packages 列表（web / packages/* / plugins /
// plugins/* / drills）不包含 `templates/`——模板文件从未被 `pnpm typecheck`
// 真正检查过。后果：契约类型变更（如 M2-S2 的 paradigm 改名）如果没同步
// 更新模板，不会有任何门变红，直到某个贡献者用坏掉的模板生成插件才会发现
// ——而那正是新贡献者第一次接触本仓库的时刻，体验最差的地方。
//
// 直接把 `templates/` 加进 pnpm workspace 试过（M2-S2 收尾期间的实测）：
// 失败——`templates/plugin/<paradigm>/tsconfig.json` 的 `extends` 是相对
// 路径 `../../tsconfig.base.json`，这个相对深度是按"文件被复制到
// plugins/<game>/ 之后"计算的（2 层），模板文件本身放在
// `templates/plugin/<paradigm>/`（3 层），两个深度不一致，直接加进
// workspace 会在原地报 `TS5083: Cannot read file '.../templates/
// tsconfig.base.json'`。模板文件天生是"给别处用的源"，不是"打算被原地
// 检查的文件"，这个不一致没有干净的修法（改 tsconfig.json 的相对路径
// 会反过来破坏它被复制到 plugins/<game>/ 之后的正确性）。
//
// 因此改走本文件的方案：**真的按 `gs-new-plugin.mjs` 的生成逻辑生成一份
// 到临时目录，在生成后的正确相对深度上跑 tsc，再删除**——这与"模板能不能
// 用"这个问题在语义上完全等价（贡献者遇到的就是生成之后的文件），且复用
// `gs-new-plugin.mjs` 导出的 `collectFilesRelative`/`copyTemplateFile`，
// 保证本检查与真实生成走同一套复制逻辑，不会各自维护一份、悄悄漂移。
//
// 已知与真实生成的两点故意偏差（如实记录，不假装完全一致）：
//   1. tsconfig.json 的 `extends` 在这里用绝对路径直接指向仓库根的
//      `tsconfig.base.json`，不复用模板里那份相对路径写法——因为临时目录
//      的深度由 `os.tmpdir()` 决定，不保证正好是 2 层。绝对路径能在任何
//      深度下都解析到同一份真实文件，语义等价，只是写法不同。
//   2. `node_modules/gs-plugin-kit` 用手写 symlink 指向
//      `packages/gs-plugin-kit`，不跑 `pnpm install`——临时目录不是 pnpm
//      workspace 成员，pnpm 不会为它链接依赖；手写 symlink 达到的类型解析
//      效果与 pnpm 链接等价（都是"node_modules/gs-plugin-kit 指向同一个
//      真实目录"），但跳过了 pnpm 本身的开销，让这道门能在几百毫秒内跑完。

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';
import { collectFilesRelative, copyTemplateFile, SUPPORTED_PARADIGMS } from '../../gs-new-plugin.mjs';

const GATE_TITLE = 'HC-5 模板可用性（scaffold 模板必须能通过类型检查）';
const TEMPLATES_DIR = 'templates/plugin';
// 合法游戏 id：与 gs-new-plugin.mjs 的 GAME_ID_PATTERN 一致，取一个不会与
// 真实游戏撞车的固定值。
const PROBE_GAME_ID = 'gscheckprobe';
const FIXTURE_TEMPLATE_PREFIX = path.join('fixtures', '__game__');

function joinOutput(result) {
  return [result.stdout, result.stderr].filter((s) => s && s.trim().length > 0).join('\n');
}

/**
 * 按 gs-new-plugin.mjs 的分流规则，把模板目录下的每个文件复制到临时目录里
 * 对应的位置——`fixtures/__game__/` 子树去 `<tmp>/fixtures/<id>/`，其余去
 * `<tmp>/plugins/<id>/`，与真实生成产物的相对布局（`plugins/<id>/` 与
 * `fixtures/<id>/` 平级）保持一致，这样 tsconfig 的相对深度假设才有意义。
 */
function generateTemplateInto(templateDir, tmpRoot, gameId) {
  const pluginDir = path.join(tmpRoot, 'plugins', gameId);
  const fixtureDir = path.join(tmpRoot, 'fixtures', gameId);

  for (const relPath of collectFilesRelative(templateDir)) {
    const srcFile = path.join(templateDir, relPath);
    const destFile = relPath.startsWith(FIXTURE_TEMPLATE_PREFIX + path.sep) || relPath === FIXTURE_TEMPLATE_PREFIX
      ? path.join(fixtureDir, relPath.slice(FIXTURE_TEMPLATE_PREFIX.length + 1))
      : path.join(pluginDir, relPath);
    copyTemplateFile(srcFile, destFile, gameId);
  }

  return pluginDir;
}

/**
 * 用绝对路径重写 tsconfig.json 的 `extends`，理由见文件头注释偏差①。
 * 其余字段原样保留（模板此前声明的 compilerOptions 覆盖项、include 等）。
 */
function rewriteTsconfigExtends(pluginDir, repoRoot) {
  const tsconfigPath = path.join(pluginDir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return;
  // 模板的 tsconfig.json 是 JSONC（带注释），不能直接 JSON.parse——这里只
  // 替换 "extends" 那一行的值，其余内容（含注释）原样保留，比引入一个
  // JSONC 解析依赖更简单，也更不容易在往返序列化时意外弄丢注释。
  const original = readFileSync(tsconfigPath, 'utf8');
  const absoluteBase = JSON.stringify(path.join(repoRoot, 'tsconfig.base.json'));
  const rewritten = original.replace(/"extends"\s*:\s*"[^"]*"/, `"extends": ${absoluteBase}`);
  writeFileSync(tsconfigPath, rewritten, 'utf8');
}

/** node_modules/gs-plugin-kit → packages/gs-plugin-kit 的手写 symlink，理由见文件头偏差②。 */
function linkPluginKit(pluginDir, repoRoot) {
  const nodeModulesDir = path.join(pluginDir, 'node_modules');
  mkdirSync(nodeModulesDir, { recursive: true });
  symlinkSync(path.join(repoRoot, 'packages', 'gs-plugin-kit'), path.join(nodeModulesDir, 'gs-plugin-kit'), 'junction');
}

function resolveTscBinary(repoRoot) {
  return path.join(repoRoot, 'packages', 'gs-plugin-kit', 'node_modules', '.bin', 'tsc');
}

function checkParadigm(repoRoot, paradigmDir, paradigm) {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'gs-check-template-'));
  try {
    const pluginDir = generateTemplateInto(paradigmDir, tmpRoot, PROBE_GAME_ID);
    rewriteTsconfigExtends(pluginDir, repoRoot);
    linkPluginKit(pluginDir, repoRoot);

    const tscBinary = resolveTscBinary(repoRoot);
    const result = spawnSync(tscBinary, ['--noEmit'], { cwd: pluginDir, encoding: 'utf8' });

    if (result.error) {
      return [
        {
          file: `${TEMPLATES_DIR}/${paradigm}`,
          line: 0,
          column: 0,
          reason: `无法执行 tsc：${result.error.message}`,
        },
      ];
    }
    if (result.status !== 0) {
      // 临时目录路径对人类不可读，替换回模板源路径，方便直接定位到
      // templates/plugin/<paradigm>/ 下该修哪个文件。
      const rewritten = joinOutput(result).split(pluginDir).join(`${TEMPLATES_DIR}/${paradigm}`);
      return [
        {
          file: `${TEMPLATES_DIR}/${paradigm}`,
          line: 0,
          column: 0,
          reason: `模板生成后无法通过 tsc --noEmit（退出码 ${result.status}）——见下方原始输出`,
          snippet: rewritten,
        },
      ];
    }
    return [];
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export async function run() {
  const repoRoot = findRepoRoot();
  const templatesRoot = path.join(repoRoot, TEMPLATES_DIR);

  let paradigmDirs;
  try {
    paradigmDirs = readdirSync(templatesRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch (err) {
    return {
      id: 'HC-5',
      title: GATE_TITLE,
      status: 'fail',
      findings: [{ file: TEMPLATES_DIR, line: 0, column: 0, reason: `读取模板目录失败：${err.message}` }],
      notes: [],
    };
  }

  const findings = [];

  // 双向一致性：目录集合与 gs-new-plugin.mjs 的 SUPPORTED_PARADIGMS 登记表
  // 必须互相匹配——否则要么是"目录存在但脚手架拒绝生成"（贡献者新建了
  // 模板目录却忘了在 gs-new-plugin.mjs 里登记），要么是"登记了但目录不存在"
  // （SUPPORTED_PARADIGMS 写了个已被删除/改名的范式）。与 HC-1 的
  // plugins/ 目录 vs plugins/index.ts 注册表双向一致检查是同一种模式。
  const dirNames = new Set(paradigmDirs.map((e) => e.name));
  const registeredNames = new Set(SUPPORTED_PARADIGMS);
  for (const name of dirNames) {
    if (!registeredNames.has(name)) {
      findings.push({
        file: `${TEMPLATES_DIR}/${name}`,
        line: 0,
        column: 0,
        reason: `模板目录存在，但 scripts/gs-new-plugin.mjs 的 SUPPORTED_PARADIGMS 未登记 "${name}"——脚手架会拒绝生成这个范式`,
      });
    }
  }
  for (const name of registeredNames) {
    if (!dirNames.has(name)) {
      findings.push({
        file: 'scripts/gs-new-plugin.mjs',
        line: 0,
        column: 0,
        reason: `SUPPORTED_PARADIGMS 登记了 "${name}"，但 ${TEMPLATES_DIR}/${name}/ 目录不存在`,
      });
    }
  }

  for (const entry of paradigmDirs) {
    findings.push(...checkParadigm(repoRoot, path.join(templatesRoot, entry.name), entry.name));
  }

  return {
    id: 'HC-5',
    title: GATE_TITLE,
    status: findings.length > 0 ? 'fail' : 'pass',
    findings,
    notes: [
      `已对 ${paradigmDirs.length} 个模板范式（${paradigmDirs.map((e) => e.name).join(' / ')}）` +
        '各生成一份探针插件到临时目录并跑 tsc --noEmit，验证完成后已删除临时目录。',
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
