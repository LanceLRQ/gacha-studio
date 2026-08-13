#!/usr/bin/env node
// HC-4 · 声明必被消费
//
// 起因：M1-S7 纸面填表演练发现 packages/gs-plugin-kit 契约里声明的三个字段
// （TimezoneSource.apiField/staticTable、BannerSpec.endpointOverride、
// TimeConfig.rawTimeConvention）在 L1（crates/paradigms）执行链路里，要么被
// `#[allow(dead_code)]` 解析出来后直接弃置，要么干脆没有对应的 Rust 镜像
// 字段——类型检查、原有 gs:check 三道门、代码 review 全部亮绿灯，运行时却
// 静默不生效。这是比字段缺失更坏的失败模式：缺失会报错，这个不会。
//
// 本门机械断言：CONTRACT_SECTIONS 里登记的每个契约类型，每个字段都要满足
// 三条：
//   ② 在对应的 Rust `*Json` 镜像结构体里能找到同名字段——不满足说明契约
//      字段完全没有 Rust 镜像，serde 会静默忽略未知字段（不报错）。
//   ① 找到的镜像字段没有标 `#[allow(dead_code)]`——标了说明作者已经承认
//      解析出来之后没有代码路径读取它。
//   ③ 在声明它的文件之外，`crates/paradigms/**/*.rs` 里至少有一处非测试
//      代码读取过这个字段的 Rust 标识符——找不到说明"解析了、结构体里有，
//      但全文没有任何读取处"。
//
// 覆盖范围是显式登记制，不是自动扫描 PluginManifest 的全部字段——
// `displayName`/`iconUrl`/`maintainers` 这类纯展示字段，本来就不该有 L1
// Rust 消费点，硬要求它们"被消费"只会制造一个要么永远为红、要么被迫塞满
// 摆设白名单的门。只登记"契约上明确要求驱动 L1 执行行为"的字段区块，新增
// 区块时在 CONTRACT_SECTIONS 里追加一项即可。
//
// 白名单（knownUnconsumed）用于登记"已确认无需消费"的具体字段，必须带理由，
// 且理由会打印进本门的输出——不能静默豁免，让人看不见有字段进了白名单。
//
// 已知局限（如实记录，不假装覆盖一切）：
//   - 字段名提取靠正则匹配 ts-rs 输出的固定形状（`export type X = { a: T,
//     b?: U, } | ...;`），不处理字段类型本身是内联对象字面量的情况——
//     ts-rs 目前的输出里没有这种形状（嵌套结构总是被 factor 成独立命名
//     类型），因此不在本检查覆盖范围内。
//   - "消费"判定是"标识符在测试之外的正文里至少出现一次"的启发式匹配，
//     不是真正的数据流分析——例如把字段读出来又立刻丢弃（`let _ = x.foo;`）
//     会被误判为"已消费"。这类情况留给代码 review，机械检查只兜底"完全
//     没人碰过"这个更容易被忽视的失败模式。

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE = 'HC-4 声明必被消费（契约字段必须能在 L1 找到真实消费点）';

const PARADIGMS_RELATIVE_DIR = 'crates/paradigms';

/**
 * 显式登记制：只登记"契约上明确要求驱动 L1 执行行为"的类型区块。
 * `rustStruct` 按本仓库既有命名约定——`Xxx`（TS 契约类型）↔ `XxxJson`
 * （Rust 镜像结构体/枚举），见 crates/paradigms/gs-p-authkey/src/pipeline.rs
 * 里 ManifestDataJson/TimeConfigJson/TimezoneSourceJson/BannerSpecJson 等。
 */
const CONTRACT_SECTIONS = [
  {
    tsType: 'TimeConfig',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'TimeConfigJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
    knownUnconsumed: [
      {
        field: 'rawTimeConvention',
        reason:
          'M1 阶段没有 clientLocalized 场景的消费点（要等"导入第三方已换算存档"这条路径落地）——' +
          '已解析并存进 AuthkeyApiPipeline.raw_time_convention 字段、有专门的单元测试验证解析正确性，' +
          '只是刻意不接执行逻辑，见该字段的文档注释与 AUDIT-2026-08-11-S7纸面填表演练.md §2.3。',
      },
    ],
  },
  {
    tsType: 'TimezoneSource',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'TimezoneSourceJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
  },
  {
    tsType: 'BannerSpec',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'BannerSpecJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
    knownUnconsumed: [
      {
        field: 'displayName',
        reason: '纯展示字段，前端直接读 manifest bundle 原始 JSON 渲染，L1 执行逻辑不需要它。',
      },
    ],
  },
  {
    // CredentialSource 是手写契约类型（含 RegExp 字段，ts-rs 无法生成），
    // 定义在 manifest.ts 而不是 types/generated.ts——这也是新增本区块前
    // 必须先修 extractTsTypeFields/findTypeAliasEnd 的原因，见两个函数的
    // 文档注释。
    //
    // M2-S3：logPath 字段原有的 knownUnconsumed 白名单条目已移除——该白名单
    // 存在的唯一理由是"真实读取实现（鸣潮 Client.log 异或解混淆）还没落地"，
    // 这个理由到 M2-S3 已经不成立，登记时就写明了"接上真实读取逻辑后必须
    // 移除本条白名单"。若本门此刻仍对 logPath 报红，说明 Rust 侧
    // CredentialJson::LogFile 的消费点尚未接上，应等 Rust 侧落地后转绿，
    // 不应该把白名单加回来糊弄过去。
    tsType: 'CredentialSource',
    tsFile: 'packages/gs-plugin-kit/manifest.ts',
    rustStruct: 'CredentialJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
  },
  {
    // ★ HC-4 CONTRACT_SECTIONS 漏登记的第二个实例，登记本身怎么漏掉的：
    // CONTRACT_SECTIONS 是手工维护的清单，新增一个契约类型（如
    // RequestTemplate）时如果忘了同步在这里补一项，门禁完全看不见它——
    // 不会报错、不会有任何提示，因为检查逻辑只遍历这个数组里显式登记的
    // 条目，不会自动扫描 manifest.ts / types/generated.ts 里声明过的全部
    // 类型。第一次发生在 `CredentialSource`（本区块，见上方历史注释）；
    // 这是第二次——`RequestTemplate` 早在 M1 就已经生成进
    // types/generated.ts，但从未被登记进本数组，门禁对它形同虚设了整个
    // M1 阶段。
    //
    // 本次登记顺带发现的真实漏洞：generated.ts 的 RequestTemplate 有
    // `url`/`method`/`headers`/`body` 四个字段，但 pipeline.rs 的
    // RequestTemplateJson 只镜像了 url 与 body，method/headers 在
    // crates/paradigms 里零消费（`request.method`/`request.headers` 声明了
    // 却从未被读取过）——本门就是为了拦这类"声明了但没消费"的字段，加上
    // 这项登记后会如实报红，不应该为了变绿而追加白名单。
    tsType: 'RequestTemplate',
    tsFile: 'packages/gs-plugin-kit/types/generated.ts',
    rustStruct: 'RequestTemplateJson',
    rustFile: 'crates/paradigms/gs-p-authkey/src/pipeline.rs',
  },
];

function collectRustFiles(dir) {
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
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.rs')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

function camelToSnakeCase(name) {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * 从类型别名 `=` 之后的位置开始，找到该类型声明在**顶层**（花括号已完全
 * 平衡）结束的位置——即第一个不在任何 `{}` 内部的 `;`。
 *
 * 扫描前先把 `/** ... *\/` 形态的块注释替换成等长空白：JSDoc 里常见的
 * `{@link Foo}`／`` `"{{credential}}"` `` 会包含花括号，不处理会打乱这里的
 * 深度计数（好在这类写法本身总是成对出现，实测不会破坏平衡，但仍按最坏
 * 情况防御）。只是为了给深度计数腾地方，不影响返回结果——调用方会在
 * 原文（未替换注释）上再跑一次自己的注释剥离来提取字段。
 */
function findTypeAliasEnd(source, bodyStart) {
  const masked = source.slice(bodyStart).replace(/\/\*\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === ';' && depth === 0) return bodyStart + i;
  }
  return null;
}

/**
 * 从某个 TS 源文件里抠出某个类型别名的字段名集合。
 *
 * 覆盖两种写法：
 * - `types/generated.ts`（ts-rs 输出）：单行、字段用逗号分隔，如
 *   `export type Foo = { a: T, b: U, };`。
 * - `packages/gs-plugin-kit/manifest.ts`（手写契约）：多行、判别联合的每个
 *   分支各自用**分号**分隔字段（TS 对象类型字面量的合法写法之一），如
 *   `export type CredentialSource =\n  | { kind: "x"; a: T }\n  | { ... };`。
 *   旧版实现假设「下一个 `export type` 就是边界」且只认逗号分隔，两条假设
 *   对 ts-rs 输出成立，但套在手写契约上会失败——`export type X =` 后面
 *   直接换行、不带尾随空格，`indexOf` 精确匹配不到；分号分隔的字段也不会
 *   被逗号版的正则捕获到。改用 [`findTypeAliasEnd`] 的花括号深度计数
 *   定位真正的类型别名结束点，字段正则同时接受 `{`/`,`/`;` 三种前导字符。
 */
function extractTsTypeFields(tsSource, typeName) {
  const startPattern = new RegExp(`export type ${typeName}\\s*=\\s*`);
  const startMatch = startPattern.exec(tsSource);
  if (!startMatch) return null;
  const bodyStart = startMatch.index + startMatch[0].length;
  const bodyEnd = findTypeAliasEnd(tsSource, bodyStart);
  const block = bodyEnd === null ? tsSource.slice(bodyStart) : tsSource.slice(bodyStart, bodyEnd);
  const withoutDocComments = block.replace(/\/\*\*[\s\S]*?\*\//g, ' ');

  const fields = new Set();
  for (const m of withoutDocComments.matchAll(/[{,;]\s*([A-Za-z_][A-Za-z0-9_]*)\??:\s/g)) {
    fields.add(m[1]);
  }
  fields.delete('kind'); // 判别键由 serde(tag = "kind") 机制本身消费，不需要单独找镜像字段。
  return [...fields];
}

/** 定位源码中一个平衡的花括号块（`braceStartIndex` 指向起始 `{`）。 */
function extractBraceBlock(source, braceStartIndex) {
  let depth = 0;
  for (let i = braceStartIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(braceStartIndex, i + 1), endIndex: i + 1 };
    }
  }
  return null;
}

/** 找到 `struct Foo { ... }` 或 `enum Foo { ... }` 的完整花括号块。 */
function findRustTypeBody(source, structName) {
  const pattern = new RegExp(`\\b(?:struct|enum)\\s+${structName}\\b[^{;]*\\{`);
  const match = pattern.exec(source);
  if (!match) return null;
  const braceStart = match.index + match[0].length - 1;
  return extractBraceBlock(source, braceStart);
}

/** 剥掉 `#[cfg(test)] mod tests { ... }` 整块——测试内的读取不算真实消费。 */
function stripTestModules(source) {
  let result = source;
  const pattern = /#\[cfg\(test\)\]\s*mod\s+tests\b[^{]*\{/g;
  let match = pattern.exec(result);
  while (match) {
    const braceStart = match.index + match[0].length - 1;
    const block = extractBraceBlock(result, braceStart);
    if (!block) break;
    result = result.slice(0, match.index) + ' '.repeat(block.endIndex - match.index) + result.slice(block.endIndex);
    pattern.lastIndex = 0;
    match = pattern.exec(result);
  }
  return result;
}

function countWholeWordOccurrences(text, word) {
  const pattern = new RegExp(`\\b${word}\\b`, 'g');
  return [...text.matchAll(pattern)].length;
}

/** 校验单个契约区块，返回该区块产生的 findings/notes。 */
function checkSection(repoRoot, section) {
  const tsPath = path.join(repoRoot, section.tsFile);
  const rustPath = path.join(repoRoot, section.rustFile);
  const findings = [];
  const notes = [];

  let tsSource;
  let rustSource;
  try {
    tsSource = readFileSync(tsPath, 'utf8');
  } catch (err) {
    return { findings: [{ file: section.tsFile, line: 0, column: 0, reason: `读取契约类型文件失败：${err.message}` }], notes };
  }
  try {
    rustSource = readFileSync(rustPath, 'utf8');
  } catch (err) {
    return { findings: [{ file: section.rustFile, line: 0, column: 0, reason: `读取 Rust 镜像文件失败：${err.message}` }], notes };
  }

  const tsFields = extractTsTypeFields(tsSource, section.tsType);
  if (tsFields === null) {
    return {
      findings: [
        {
          file: section.tsFile,
          line: 0,
          column: 0,
          reason: `未能在文件里找到 "export type ${section.tsType} = "——契约类型可能已改名或删除，CONTRACT_SECTIONS 需要同步更新`,
        },
      ],
      notes,
    };
  }

  const rustBody = findRustTypeBody(rustSource, section.rustStruct);
  if (rustBody === null) {
    return {
      findings: [
        {
          file: section.rustFile,
          line: 0,
          column: 0,
          reason: `未能在文件里找到 struct/enum ${section.rustStruct}——契约类型 "${section.tsType}" 在 L1 完全没有 Rust 镜像结构体`,
        },
      ],
      notes,
    };
  }

  // 消费扫描范围：整个 crates/paradigms/**/*.rs，剥掉各文件的测试模块，
  // 再额外剥掉本区块自己的声明块本身（避免"声明这一行"被误判成"消费一次"）。
  const rustFiles = collectRustFiles(path.join(repoRoot, PARADIGMS_RELATIVE_DIR));
  const consumptionCorpus = rustFiles
    .map((filePath) => {
      let text = stripTestModules(readFileSync(filePath, 'utf8'));
      if (path.resolve(filePath) === path.resolve(rustPath)) {
        text = text.replace(rustBody.text, ' '.repeat(rustBody.text.length));
      }
      return text;
    })
    .join('\n');

  const knownUnconsumed = new Map((section.knownUnconsumed ?? []).map((entry) => [entry.field, entry.reason]));

  for (const tsField of tsFields) {
    if (knownUnconsumed.has(tsField)) {
      notes.push(`${section.tsType}.${tsField} 已登记白名单，跳过消费检查——理由：${knownUnconsumed.get(tsField)}`);
      continue;
    }

    const rustFieldName = camelToSnakeCase(tsField);
    const declarationPattern = new RegExp(`(#\\[allow\\(dead_code\\)\\]\\s*)?\\b${rustFieldName}\\s*:`, 'g');
    const declarations = [...rustBody.text.matchAll(declarationPattern)];

    if (declarations.length === 0) {
      findings.push({
        file: section.rustFile,
        line: 0,
        column: 0,
        reason: `契约字段 "${section.tsType}.${tsField}" 在 ${section.rustStruct} 里找不到对应字段 "${rustFieldName}"——serde 会静默忽略未知字段，不会报错`,
      });
      continue;
    }

    const markedDeadCode = declarations.some((m) => Boolean(m[1]));
    if (markedDeadCode) {
      findings.push({
        file: section.rustFile,
        line: 0,
        column: 0,
        reason: `契约字段 "${section.tsType}.${tsField}" 对应的 Rust 字段 "${rustFieldName}" 标了 #[allow(dead_code)]——解析出来后被明确弃置，不是消费`,
      });
      continue;
    }

    const consumptionCount = countWholeWordOccurrences(consumptionCorpus, rustFieldName);
    if (consumptionCount === 0) {
      findings.push({
        file: section.rustFile,
        line: 0,
        column: 0,
        reason: `契约字段 "${section.tsType}.${tsField}" 对应的 Rust 字段 "${rustFieldName}" 已声明，但整个 ${PARADIGMS_RELATIVE_DIR}/ 除声明本身外没有任何非测试代码读取过它`,
      });
    }
  }

  return { findings, notes };
}

export async function run() {
  const repoRoot = findRepoRoot();
  const findings = [];
  const notes = [`已登记 ${CONTRACT_SECTIONS.length} 个契约区块：${CONTRACT_SECTIONS.map((s) => s.tsType).join(' / ')}`];

  for (const section of CONTRACT_SECTIONS) {
    const result = checkSection(repoRoot, section);
    findings.push(...result.findings);
    notes.push(...result.notes);
  }

  return {
    id: 'HC-4',
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
