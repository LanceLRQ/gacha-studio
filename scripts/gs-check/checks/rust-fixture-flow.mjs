#!/usr/bin/env node
// FIXRS · 插件真实 fixture 必须流过 Rust 侧（跨语言覆盖率下限）
//
// 起因（M2-S6 联调实测）：`crates/paradigms/gs-p-authkey/src/pipeline.rs`
// 的记录时间解析硬编码了米哈游三游的空格分隔格式，鸣潮的 ISO 格式全部解析
// 失败——但这个 bug 活到 S6 才被撞见，因为 S3/S4 之后 pipeline.rs 里 9 处
// "wuwa" 全是合成测试数据里的字符串字面量（插件 id、保底组名），没有一处
// 真实记录喂进过 Rust 侧计算，跑过 `fixtures/wuwa/raw_response/` 的只有 TS
// 侧的 `assertPluginFixture`。而 `occurred_at`/`tz_origin`/`meta_state`
// 这几个字段只在 Rust 侧计算——两侧覆盖率不对称，缺口就落在没人看的缝里：
// TS 全绿、Rust 全绿，合起来仍有整条路径没人真正走过。
//
// 本门做什么：对 `plugins/index.ts` 里注册的每个插件 id，在 `crates/` 的
// 测试代码（`#[cfg(test)]` 模块，或 `<crate>/tests/` 集成测试目录）里必须
// 能找到至少一处对 `fixtures/<id>/raw_response` 的引用——证明"确实有一条
// Rust 测试碰过这个插件的真实数据"。
//
// ⚠️ 已知局限（如实写明，不假装比实际严格——本项目反复踩过"门看起来在
// 检查、实际什么都没检查"这个坑，一道诚实的粗门比一道假装严格的门更有
// 价值）：
//   - 这是一道**粗粒度下限**：只证明"有 Rust 测试引用了真实 fixture
//     路径"，不证明"这批数据真的流过了每一段计算"。`occurred_at` 算得对
//     不对、`meta_state` 是否落到确定取值，本门完全不检查——字段级正确性
//     是该测试自己的断言责任，机械正则兜不到这一层，硬做只会制造假绿灯。
//   - "引用"是字面量子串匹配，不是数据流分析：只要
//     `fixtures/<id>/raw_response` 这串文本出现在测试代码区域内就算数，
//     哪怕它其实只出现在一句没人执行到的注释里。
//   - "是不是测试代码"用两条启发式判定：文件路径含 `tests/` 目录段
//     （Rust 集成测试目录约定，`cargo` 不会把它链进正常构建），或代码落在
//     `#[cfg(test)] mod ... { }` 块内。不处理挂在单个函数上的
//     `#[cfg(test)]`（本仓库目前全部是整块 `mod` 声明，见交付时的实测
//     grep，没有这种写法）。
//   - 反过来，"引用出现在文件里但不在测试区域"会被正确排除——例如
//     `crates/gs-core/src/collect.rs` 顶部文档注释提到
//     `fixtures/wuwa/raw_response/*.json` 只是举例说明数据形状，不算
//     覆盖，本门不会因为这类注释而误判通过。

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';
import { stripComments } from '../lib/strip-comments.mjs';

const GATE_TITLE = 'FIXRS 插件真实 fixture 必须流过 Rust 侧（跨语言覆盖率下限）';
const RUST_SCAN_ROOT_DIR = 'crates';
const PLUGIN_REGISTRY_PATH = 'plugins/index.ts';

// 插件构建产物目录，没有 .rs 文件，排除只是与 declaration-consumption.mjs
// 保持同一份约定，防御性对齐，不影响本门的实际扫描结果。
const EXCLUDED_RUST_SCAN_DIRS = ['crates/gs-plugin-runtime/generated'];

/**
 * 递归收集 `dir` 下所有 `.rs` 文件，跳过 `target`/`node_modules` 与
 * `excludedAbsoluteDirs` 按绝对路径精确匹配到的目录。
 */
function collectRustFiles(dir, excludedAbsoluteDirs) {
  const results = [];
  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'target' || entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (excludedAbsoluteDirs.includes(path.resolve(full))) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.rs')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function lineAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

/**
 * 从 `plugins/index.ts` 注册表里抠出每个插件 id 及其注册所在行号。
 * 用 stripComments 剥离注释后再匹配——该文件顶部 JSDoc 就写着
 * `() => import("./genshin/manifest")` 作为使用范例，不剥离会把示例文字
 * 误判成一条真实注册项（与 HC-1 的 extractRegistryIds 同一处理由）。
 */
function extractRegistryEntries(repoRoot) {
  const indexPath = path.join(repoRoot, PLUGIN_REGISTRY_PATH);
  let raw;
  try {
    raw = readFileSync(indexPath, 'utf8');
  } catch {
    return null;
  }
  const stripped = stripComments(raw);
  const entries = [];
  const pattern = /import\(\s*["']\.\/([A-Za-z0-9_-]+)\/manifest(?:\.ts)?["']\s*\)/g;
  let match = pattern.exec(stripped);
  while (match) {
    entries.push({ id: match[1], line: lineAt(raw, match.index) });
    match = pattern.exec(stripped);
  }
  return entries;
}

/** 定位源码中一个平衡的花括号块（`braceStartIndex` 指向起始 `{`）。 */
function extractBraceBlock(source, braceStartIndex) {
  let depth = 0;
  for (let i = braceStartIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { endIndex: i + 1 };
    }
  }
  return null;
}

/** 文件是否整份都算测试代码：路径里含 `tests` 目录段（Rust 集成测试约定）。 */
function isIntegrationTestFile(relPath) {
  return relPath.split(path.sep).includes('tests');
}

/** 从源码里找出所有 `#[cfg(test)] mod ... { }` 块的字符偏移区间。 */
function findCfgTestModuleRegions(source) {
  const regions = [];
  const pattern = /#\[cfg\(test\)\]\s*mod\s+\w+\b[^{]*\{/g;
  let match = pattern.exec(source);
  while (match) {
    const braceStart = match.index + match[0].length - 1;
    const block = extractBraceBlock(source, braceStart);
    if (!block) break;
    regions.push({ start: match.index, end: block.endIndex });
    pattern.lastIndex = block.endIndex;
    match = pattern.exec(source);
  }
  return regions;
}

/**
 * 在一个 Rust 文件的测试代码区域里找 `needle` 子串。命中返回真实行号
 * （相对完整源码，不是区域内的相对行号），未命中返回 null。
 */
function findReferenceInFile(source, relPath, needle) {
  if (isIntegrationTestFile(relPath)) {
    const idx = source.indexOf(needle);
    return idx === -1 ? null : { line: lineAt(source, idx) };
  }
  for (const region of findCfgTestModuleRegions(source)) {
    const localIdx = source.slice(region.start, region.end).indexOf(needle);
    if (localIdx !== -1) {
      return { line: lineAt(source, region.start + localIdx) };
    }
  }
  return null;
}

export async function run() {
  const repoRoot = findRepoRoot();
  const registry = extractRegistryEntries(repoRoot);

  if (registry === null) {
    return {
      id: 'FIXRS',
      title: GATE_TITLE,
      status: 'fail',
      findings: [
        {
          file: PLUGIN_REGISTRY_PATH,
          line: 0,
          column: 0,
          reason: '插件显式注册表文件不存在，无法校验跨语言 fixture 覆盖率',
        },
      ],
      notes: [],
    };
  }

  const excludedAbsoluteDirs = EXCLUDED_RUST_SCAN_DIRS.map((rel) => path.resolve(repoRoot, rel));
  const rustFiles = collectRustFiles(path.join(repoRoot, RUST_SCAN_ROOT_DIR), excludedAbsoluteDirs);
  const fileSources = rustFiles.map((absPath) => {
    const relPath = path.relative(repoRoot, absPath);
    return { relPath, source: readFileSync(absPath, 'utf8') };
  });

  const findings = [];
  const covered = [];

  for (const entry of registry) {
    const needle = `fixtures/${entry.id}/raw_response`;
    let hit = null;
    let hitFile = null;
    for (const file of fileSources) {
      hit = findReferenceInFile(file.source, file.relPath, needle);
      if (hit) {
        hitFile = file.relPath;
        break;
      }
    }
    if (hit) {
      covered.push(`${entry.id} → ${hitFile}:${hit.line}`);
      continue;
    }
    findings.push({
      file: PLUGIN_REGISTRY_PATH,
      line: entry.line,
      column: 0,
      reason:
        `插件 "${entry.id}" 在 crates/ 的测试代码（#[cfg(test)] 模块或 <crate>/tests/ 目录）里找不到任何对 ` +
        `"${needle}" 的引用。M2-S6 已经证明这个盲区会导致真实故障——鸣潮 ISO 时间格式解析全挂，直到联调才发现，` +
        '因为此前只有 TS 侧的 fixture 契约测试跑过这批数据，occurred_at/tz_origin/meta_state 这些只在 Rust 侧' +
        `计算的字段完全没人验证过。请在 crates/paradigms/gs-p-authkey/src/pipeline.rs（或新增一份 crates/gs-host/tests/*.rs）` +
        `补一条测试：读 fixtures/${entry.id}/raw_response/ 的真实记录，喂进 AuthkeyApiPipeline::build_records（或经由 ` +
        'collect_banner），断言不报错、且 occurred_at/record_key/item_id/meta_state 等关键字段成形。',
    });
  }

  const notes = [
    `已扫描 crates/**/*.rs 共 ${fileSources.length} 个文件（排除 target/node_modules 与插件构建产物目录）`,
    `plugins/index.ts 注册 ${registry.length} 个插件：${registry.map((e) => e.id).join('、') || '（空）'}`,
    covered.length > 0
      ? `已确认有真实 fixture 引用：${covered.join('；')}`
      : '未发现任何插件的真实 fixture 引用',
    '⚠️ 本门是粗粒度下限：只证明"有 Rust 测试引用了真实 fixture 路径"，不证明数据真的流过了每一段计算——' +
      '字段级正确性仍需该测试自己断言，机械检查兜不到这一层，详见本文件头部注释。',
  ];

  return {
    id: 'FIXRS',
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
