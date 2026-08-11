#!/usr/bin/env node
// pnpm gs:sanitize <目录> [--write]
//
// fixture 脱敏工具。插件 PR 必须附带脱敏 fixture（插件 SDK 文档 §7.3），但指望
// 贡献者人工 review 抓住每一处泄漏是不现实的——必须有自动化工具兜底。
//
// 默认 dry-run：只报告命中位置（文件:行号），不改任何文件。加 `--write` 才会
// 真的落盘替换——脱敏工具本身如果误伤了别人精心构造的样本数据，这个损失是
// 不可逆的，所以默认必须是"只报告"。
//
// 扫描并替换：
//   - authkey=<值>            → authkey=FAKE_AUTHKEY_FOR_FIXTURE_ONLY
//   - authkey_ver=<值>        → authkey_ver=1
//   - sign_type=<值>          → sign_type=2
//   - 19 位及以上纯数字串     → 固定占位值（覆盖雪花 ID / 长数字 UID 等）
//   - accessToken 字段        → 占位值
//   - Authorization 头        → 占位值
//   - cookie 字段             → 占位值
//
// 零新增 npm 依赖，只用 node:fs / node:path，风格照 scripts/gs-check/ ：
// 全中文输出、命中位置精确到「文件:行号」。

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 每条规则：`pattern` 必须恰好一个捕获组，捕获「要保留的前缀」（键名 + 分隔符），
 * 真正敏感的部分是紧跟在捕获组之后、被规则整体匹配但未被捕获的部分——
 * 替换时只需要拼回前缀 + 占位值，不需要理解原始敏感值的具体格式。
 */
const RULES = [
  {
    id: 'authkey',
    pattern: /(authkey=)(?!FAKE_AUTHKEY_FOR_FIXTURE_ONLY\b)[^&"'\s]+/g,
    reason: '命中 authkey 参数，等价于临时账号凭证',
    placeholder: 'FAKE_AUTHKEY_FOR_FIXTURE_ONLY',
  },
  {
    id: 'authkey_ver',
    pattern: /(authkey_ver=)[^&"'\s]+/g,
    reason: '命中 authkey_ver 参数',
    placeholder: '1',
  },
  {
    id: 'sign_type',
    pattern: /(sign_type=)[^&"'\s]+/g,
    reason: '命中 sign_type 参数',
    placeholder: '2',
  },
  {
    id: 'long-numeric-id',
    // 19 位及以上纯数字：覆盖服务端雪花 ID，以及贡献者可能误粘进来的长数字 UID。
    // 排除掉已经等于占位值本身的情况，保证对已脱敏文件重复运行是幂等的。
    pattern: /(?<=^|[^\d])(?!1000000000000000000(?:$|[^\d]))(\d{19,})(?=$|[^\d])/g,
    reason: '命中 19 位及以上纯数字串（疑似雪花 ID / 长数字 UID）',
    placeholder: '1000000000000000000',
    // 这条规则的“前缀捕获组”语义与其它规则不同：整个数字串本身就是敏感内容，
    // 没有需要保留的前缀，替换时直接整体替换（见 applyRule 的特殊处理）。
    wholeMatchIsSensitive: true,
  },
  {
    // JSON 里的键名通常自己也带引号（如 `"accessToken": "xxx"`），键名与冒号
    // 之间可能夹一个闭合引号，因此前缀允许 `"?` 出现在 `[:=]` 两侧。
    //
    // ⚠️ 这三条刻意不加“已是占位值就跳过”的负向先行断言：前缀里的 `"?` 是
    // 可选的，负向断言在这种有回溯空间的前缀上并不可靠——实测会在断言失败后
    // 回溯掉前缀里的可选引号，把断言检查点挪到一个不再匹配占位值字面量的
    // 位置，最终匹配到一个只含空白的“伪命中”，`--write` 时会把占位值和原有
    // 引号拆开重新拼接，破坏 JSON 结构。反复对已脱敏内容跑 `--write`
    // 仍然安全且输出不变（前缀 + 占位值会精确复现已有文本），只是 dry-run
    // 报告会一直把这三个字段列为命中——这是可接受的噪音，不是数据损坏。
    id: 'access-token',
    pattern: /((?:access[_-]?token)"?\s*[:=]\s*"?)[^"'\r\n,}]+/gi,
    reason: '命中 accessToken 字段',
    placeholder: 'FAKE_TOKEN_FOR_FIXTURE_ONLY',
  },
  {
    id: 'authorization-header',
    pattern: /(Authorization"?\s*[:=]\s*"?)[^"'\r\n,}]+/gi,
    reason: '命中 Authorization 头',
    placeholder: 'FAKE_AUTHORIZATION_FOR_FIXTURE_ONLY',
  },
  {
    id: 'cookie',
    pattern: /(Cookie"?\s*[:=]\s*"?)[^"'\r\n,}]+/gi,
    reason: '命中 cookie 字段',
    placeholder: 'FAKE_COOKIE_FOR_FIXTURE_ONLY',
  },
];

/** 把字符偏移量换算成 1-based 行号。 */
function offsetToLine(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * 扫描单个文件的文本内容，返回命中列表（不修改内容）。
 * 每条命中：{ rule, index, line, matchedText }
 */
function scanText(text) {
  const findings = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      findings.push({
        rule,
        index: m.index,
        line: offsetToLine(text, m.index),
        matchedText: m[0],
      });
    }
  }
  findings.sort((a, b) => a.index - b.index);
  return findings;
}

/** 对文本应用全部规则的替换，返回替换后的文本。 */
function applyRules(text) {
  let result = text;
  for (const rule of RULES) {
    if (rule.wholeMatchIsSensitive) {
      result = result.replace(rule.pattern, () => rule.placeholder);
    } else {
      result = result.replace(rule.pattern, (full, prefix) => `${prefix}${rule.placeholder}`);
    }
  }
  return result;
}

/** 递归收集目录下所有普通文件的绝对路径。 */
function collectFiles(dir) {
  const results = [];
  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function isProbablyText(buffer) {
  // 简单启发式：出现 NUL 字节就当二进制处理，跳过（fixture 目录理论上不该有
  // 二进制文件，但防御一下比因为读取失败中断整个扫描更安全）。
  return !buffer.includes(0);
}

function main(argv) {
  const args = argv.slice(2);
  const write = args.includes('--write');
  const targetArg = args.find((a) => !a.startsWith('--'));

  if (!targetArg) {
    console.error('用法：pnpm gs:sanitize <目录> [--write]');
    process.exitCode = 1;
    return;
  }

  const targetDir = path.resolve(process.cwd(), targetArg);
  let stat;
  try {
    stat = statSync(targetDir);
  } catch {
    console.error(`目录不存在："${targetArg}"`);
    process.exitCode = 1;
    return;
  }
  if (!stat.isDirectory()) {
    console.error(`不是目录："${targetArg}"`);
    process.exitCode = 1;
    return;
  }

  console.log(`gs:sanitize —— 扫描 "${targetArg}"${write ? '（--write：命中即落盘替换）' : '（dry-run，不修改任何文件）'}`);
  console.log('');

  const files = collectFiles(targetDir);
  let totalFindings = 0;
  let changedFiles = 0;

  for (const filePath of files) {
    const buffer = readFileSync(filePath);
    if (!isProbablyText(buffer)) continue;
    const text = buffer.toString('utf8');
    const findings = scanText(text);
    if (findings.length === 0) continue;

    const relPath = path.relative(process.cwd(), filePath);
    totalFindings += findings.length;
    console.log(`${relPath}`);
    for (const finding of findings) {
      const preview =
        finding.matchedText.length > 60 ? `${finding.matchedText.slice(0, 57)}...` : finding.matchedText;
      console.log(`  行 ${finding.line}  [${finding.rule.id}]  ${finding.rule.reason}`);
      console.log(`    命中内容：${preview}`);
    }

    if (write) {
      const sanitized = applyRules(text);
      if (sanitized !== text) {
        writeFileSync(filePath, sanitized, 'utf8');
        changedFiles += 1;
        console.log('    已写回脱敏后的内容');
      }
    }
    console.log('');
  }

  console.log(`已扫描 ${files.length} 个文件，命中 ${totalFindings} 处。`);
  if (write) {
    console.log(`已写回 ${changedFiles} 个文件。`);
  } else if (totalFindings > 0) {
    console.log('当前为 dry-run，未修改任何文件。确认无误后加 --write 参数真正替换。');
  }

  process.exitCode = totalFindings > 0 && !write ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}

export { scanText, applyRules, RULES };
