#!/usr/bin/env node
// HC-1 · 编译期打包（禁止运行时动态加载）
//
// 约束来源：插件层从 Rust crate 改为 TypeScript 编译期打包这个架构决策，
// 前提是插件代码不会在运行时动态求值/动态加载——否则显式注册表
// （plugins/index.ts）与 code review 作为唯一安全防线的假设就会失效。
//
// 扫描范围：plugins/**/*.ts（跳过任意 node_modules 目录）。
// 命中任一即判定违规：
//   - eval(
//   - new Function( / 裸 Function(（同一处不重复报告两次）
//   - require(
//   - vm.（Node vm 模块的迹象，启发式子串匹配，已知会对偶然叫 vm 的变量误报）
//   - child_process（纯子串匹配，故意不剥离字符串内容，因为这个关键词
//     经常就出现在 require("child_process") 这样的字符串参数里）
//   - 参数为变量/表达式的动态 import(...)（字符串字面量或无插值模板
//     字符串参数视为合法，因为那等价于静态可分析的编译期路径）

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { stripComments } from '../lib/strip-comments.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE = 'HC-1 编译期打包（禁止运行时动态加载）';

/**
 * 递归收集目录下所有 .ts 文件的绝对路径，跳过任意 node_modules 目录。
 */
function collectTsFiles(dir) {
  const results = [];

  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return; // 目录不存在时静默跳过（例如 plugins/ 下暂无插件子目录）
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * 把字符偏移量换算成 1-based 的行号与列号。
 */
function offsetToLineCol(text, offset) {
  let line = 1;
  let lastNewlineIndex = -1;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line += 1;
      lastNewlineIndex = i;
    }
  }
  return { line, column: offset - lastNewlineIndex };
}

function lineTextAt(text, line) {
  // split 只在需要展示命中行时才调用一次，不在扫描主循环里高频调用
  return text.split('\n')[line - 1] ?? '';
}

/**
 * 找出 needle 在 text 中所有出现位置（纯子串匹配，不做任何转义/剥离处理）。
 */
function findAllSubstring(text, needle) {
  const indices = [];
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    indices.push(idx);
    idx = text.indexOf(needle, idx + needle.length);
  }
  return indices;
}

/**
 * 判断 import( 左括号之后的参数是否为“纯字面量”
 * （字符串字面量，或不含插值的模板字符串）。
 *
 * @param {string} rest 从 import( 的左括号之后开始的原始源码切片
 */
export function isLiteralImportArgument(rest) {
  let i = 0;
  const len = rest.length;
  while (i < len && /\s/.test(rest[i])) i++;
  const quote = rest[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return false; // 不是字符串/模板开头 → 变量或表达式，拒绝
  let j = i + 1;
  let hasInterpolation = false;
  while (j < len) {
    const ch = rest[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && rest[j + 1] === '{') {
      hasInterpolation = true;
      j += 2;
      continue;
    }
    if (ch === quote) break;
    j++;
  }
  if (j >= len) return false; // 没有正常闭合，保守拒绝
  if (hasInterpolation) return false; // 模板里有插值 → 拒绝
  // 闭合引号之后跳过空白，必须紧跟 ')'，否则说明还有拼接表达式（例如 "./a" + x），不是纯字面量
  let k = j + 1;
  while (k < len && /\s/.test(rest[k])) k++;
  return rest[k] === ')';
}

/**
 * 扫描单个文件，返回命中列表。
 */
function scanFile(filePath, repoRoot) {
  const raw = readFileSync(filePath, 'utf8');
  const stripped = stripComments(raw);
  const relPath = path.relative(repoRoot, filePath);
  const findings = [];

  function pushFinding(offset, reason) {
    const { line, column } = offsetToLineCol(stripped, offset);
    findings.push({
      file: relPath,
      line,
      column,
      reason,
      snippet: lineTextAt(raw, line),
    });
  }

  for (const m of stripped.matchAll(/\beval\s*\(/g)) {
    pushFinding(m.index, '命中 eval(，禁止运行时求值');
  }

  // new Function( / 裸 Function( 合并为一条正则，可选的 "new " 前缀
  // 天然避免了同一处被两条正则各报一次的问题：命中 "new Function(" 时
  // 匹配串已经把 "new " 一起吃掉，游标不会再退回去单独匹配 "Function("。
  for (const m of stripped.matchAll(/\b(new\s+)?Function\s*\(/g)) {
    const reason = m[1] ? '命中 new Function(，禁止运行时构造函数' : '命中 Function(，禁止运行时构造函数';
    pushFinding(m.index, reason);
  }

  for (const m of stripped.matchAll(/\brequire\s*\(/g)) {
    pushFinding(m.index, '命中 require(，禁止运行时动态加载');
  }

  for (const m of stripped.matchAll(/\bvm\s*\./g)) {
    pushFinding(m.index, '命中 vm.，疑似使用 Node vm 模块（启发式匹配，可能对同名变量误报）');
  }

  for (const idx of findAllSubstring(stripped, 'child_process')) {
    pushFinding(idx, '命中 child_process 字样，禁止子进程能力');
  }

  for (const m of stripped.matchAll(/\bimport\s*\(/g)) {
    const openParenOffset = m.index + m[0].length - 1; // m[0] 以 "(" 结尾
    // 用剥离过注释的 stripped 取切片，而非 raw：这样 import(/* 注释 */ "./x")
    // 这种括号内夹了行内注释的写法，注释会先被替换成空格，isLiteralImportArgument
    // 跳过空白后仍能看到真正的字符串字面量参数，不会把注释文字误判成非字面量。
    // 字符串/模板内容在 stripped 里原样保留，因此不会漏检真正的变量参数。
    const rest = stripped.slice(openParenOffset + 1);
    if (!isLiteralImportArgument(rest)) {
      pushFinding(m.index, '命中变量/表达式参数的动态 import(，仅允许字符串字面量或无插值模板字符串');
    }
  }

  return findings;
}

export async function run() {
  const repoRoot = findRepoRoot();
  const pluginsDir = path.join(repoRoot, 'plugins');
  const files = collectTsFiles(pluginsDir);

  const findings = [];
  for (const file of files) {
    findings.push(...scanFile(file, repoRoot));
  }

  const notes = [
    `已扫描 plugins/**/*.ts 共 ${files.length} 个文件（跳过 node_modules）`,
    'vm. 检查为启发式子串匹配，对偶然命名为 vm 的普通变量会产生误报，需要人工复核',
  ];

  return {
    id: 'HC-1',
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
