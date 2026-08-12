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
//   - 19 位及以上纯数字串     → 固定占位值（覆盖雪花 ID）
//   - uid/player_id 字段的数字值（4 位及以上，不限位数）→ 固定占位值
//     （覆盖米哈游/库洛的玩家 UID；按字段名锚定，位数不设上限——见该规则
//     定义处的复核订正记录）
//   - ServerID 字段的十六进制串（16 位及以上，不限位数）→ 固定占位值
//   - accessToken 字段        → 占位值
//   - Authorization 头        → 占位值
//   - cookie 字段             → 占位值
//
// ⚠️ AUDIT-2026-08-12-M2鸣潮真实存档实测.md §四：early 版本的 long-numeric-id
// 规则下限定在 19 位，完全覆盖不到米哈游/库洛的 9 位玩家 UID 与鸣潮 ServerID
// 这类 32 位十六进制标识符——合成样本实测「已扫描 1 个文件，命中 0 处」，
// 是假阴性不是安全证明。uid-field / server-id-hex 两条规则就是补这个洞，
// 详见各自规则定义处的注释。首版曾把这两条规则的取值宽度也写死（恰好 9 位 /
// 恰好 32 位），复核指出这是同一个洞换了个数字——已改为只设下限、不设上限。
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
    id: 'uid-field',
    // 米哈游三游与库洛鸣潮的玩家 UID 均为 9 位数字（AUDIT-2026-08-12-
    // M2鸣潮真实存档实测.md §2.1、§4.1），但这条规则按**字段名**锚定
    // （uid / UID / player_id / playerId / PLAYER_ID 等大小写与下划线变体，
    // `\b` 词边界防止命中 "gameUid" 这类复合字段名的子串，也防止命中
    // "uid2" 这类后缀变体）——字段名已经把语义锁定为"玩家/账号标识"，与
    // 具体位数无关，因此取值宽度只设下限（防误伤 `"uid": 0` / `"uid": 1`
    // 这类哨兵值）、不设上限。
    //
    // ⚠️ 复核订正记录（保留过程，不静默改掉）：初版把宽度写死成"恰好 9 位"
    // （`\d{9}`），复核指出这就是本次要修的那个缺口本身换了个数字——
    // `long-numeric-id` 用宽度做判别依据是因为它没有字段名锚定，宽度是它
    // 唯一的防线；这条规则有字段名锚定，靠宽度兜底不提供任何额外保护，
    // 只会在下一个 UID 不是 9 位的游戏接入时重演"新规则静默漏掉"的原始问题。
    //
    // 同时覆盖三种真实会出现的形态：
    //   - JSON 数字形式：`"UID": 123456789`（鸣潮存档顶层实测就是 int，
    //     不是字符串——research/03 §三的字符串标注已被实测证伪）
    //   - JSON 字符串形式：`"uid": "123456789"`
    //   - TOML 无引号键形式：`uid = "123456789"`（fixture 的 meta.toml 用
    //     这种写法——贡献者最可能在这一行手填真实 UID，覆盖它比覆盖 JSON
    //     存档本身更要紧）
    //
    // 占位值沿用仓库既有约定（fixtures/genshin/meta.toml 的假 UID 就是
    // "100000000"），保持跨 fixture 一致。占位值本身是 9 位（≥ 4 位下限），
    // 对已脱敏文件重复运行时会被规则再次匹配、替换为自身，字节不变，见
    // 自检脚本的幂等性测试。
    //
    // 会漏掉什么（如实列出，不假装覆盖一切）：
    //   - 复合字段名：gameUid / roleId / openId / accountId 等不含独立
    //     "uid"/"player_id" 词边界的变体——按字段名锚定的代价就是要求字段名
    //     在贡献者登记表里，本规则登记表里没有的名字统统漏
    //   - 3 位及以下的纯数字值（下限 4 位是刻意的，见上）
    //   - 字段名与数值被换行分隔的罕见格式化风格（本规则按单行文本匹配，
    //     不做跨行结构解析）
    //
    // 不加"已是占位值就跳过"的负向先行断言：与下面 access-token /
    // authorization-header / cookie 三条规则同样的理由——前缀里的可选引号
    // `"?` 在有回溯空间时会让负向断言产生"伪命中"，那三条规则的注释已经
    // 记录了这个坑，这里不重踩。本规则对已脱敏文件重复 --write 仍然幂等
    // （前缀 + 占位值精确复现已有文本，见自检脚本的幂等性测试），只是
    // dry-run 会持续报告命中，这是可接受的噪音，不是数据损坏。
    pattern: /(\b(?:uid|player_?id)\b"?\s*[:=]\s*"?)(?<!\d)\d{4,}(?!\d)/gi,
    reason: '命中 uid/player_id 字段的数字 UID',
    placeholder: '100000000',
  },
  {
    id: 'server-id-hex',
    // 鸣潮存档的 ServerID 是 32 位十六进制字符串（research/03-真实导出数据
    // 格式实测.md §3.1），但这条规则按**字段名**锚定而非裸匹配"32 位
    // 十六进制"，因为 CardPoolId 同样是 32 位十六进制（AUDIT-2026-08-12-
    // M2鸣潮真实存档实测.md §2.2）却是跨账号共享的卡池标识（全库非空取值
    // 去重后只有 1 个），不是账号级敏感信息——裸匹配宽度会把它也替换掉，
    // 对贡献者的 fixture 造成不必要的改动。字段名已经把语义锁定为"服务器
    // 标识"，与具体位数无关，因此取值宽度只设下限（防误伤过短、明显不是
    // 标识符的 hex 片段）、不设上限，理由与 uid-field 的复核订正记录一致：
    // 有字段名锚定时，靠宽度兜底不提供额外保护，只会在长度不是 32 的实现
    // 上重演"新规则静默漏掉"。
    //
    // 会漏掉什么：
    //   - CardPoolId 等同形态但语义不同的字段（刻意不覆盖，理由见上）
    //   - 非 "ServerID" 命名的服务器标识字段（如某游戏改用 serverUid /
    //     regionId 之类，字段名登记表里没有就漏）
    //   - 15 位及以下的十六进制值（下限 16 位是刻意的，防误伤过短的
    //     hex 片段）
    //
    // 幂等性说明同 uid-field：不加负向先行断言，理由一致（前缀含可选引号）；
    // 占位值本身是 32 位十六进制（≥ 16 位下限），重复运行会被再次匹配、
    // 替换为自身，字节不变。
    pattern: /(\bserver[_-]?id\b"?\s*[:=]\s*"?)[0-9a-fA-F]{16,}(?![0-9a-fA-F])/gi,
    reason: '命中 ServerID 字段的十六进制标识符',
    placeholder: 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0',
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
 *
 * `rules` 默认取全量 RULES；自检脚本会传入过滤掉某条规则的子集，用来
 * 在当前代码里重构"如果这条规则不存在会怎样"的反例（证明"不加规则会漏"），
 * 而不需要另外维护一份历史规则集的复制品。
 */
function scanText(text, rules = RULES) {
  const findings = [];
  for (const rule of rules) {
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

/** 对文本应用全部规则的替换，返回替换后的文本。`rules` 默认取全量 RULES，理由同 scanText。 */
function applyRules(text, rules = RULES) {
  let result = text;
  for (const rule of rules) {
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

// `process.argv[1]` 在 `node -e` / `--input-type=module` 这类无脚本入口的场景下是
// undefined，`pathToFileURL(undefined)` 会抛 ERR_INVALID_ARG_TYPE——本模块被
// gs-check 门禁与自检脚本导入，也应当能被随手 `import` 进来临时验证规则行为，
// 因此守卫先判 argv[1] 存在再比对。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}

export { scanText, applyRules, RULES };
