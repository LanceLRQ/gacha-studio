#!/usr/bin/env node
// FLIC · 前端依赖许可扫描（pnpm licenses list，纯允许清单，对齐 deny.toml）
//
// 起因：`docs/_internal/TASKS.md` 记录的已知缺口——前端侧此前没有等价于
// `cargo deny` 的机械化许可扫描，`THIRD-PARTY-NOTICES.md` §三的前端许可信息
// 来自各包公开发行信息，不是工具逐包验证的结果，与 Rust 侧不是同一可信度
// 级别。本门补上这一块。
//
// 判据模型与 deny.toml 完全对齐（同一份哲学，不是同一份工具）：**纯允许
// 清单**——清单内放行，清单外一律硬失败，没有"未知许可 warn 一下就放行"的
// 中间态。下面的 FRONTEND_LICENSE_ALLOWLIST 直接照抄 deny.toml `[licenses]`
// 的 `allow` 数组（同一份标识符清单，不是另起一份看起来差不多的清单）——
// 即使其中某些标识符（如 CDLA-Permissive-2.0、Unicode-3.0）从未在 npm 依赖树
// 里出现过也保留，理由是"对齐"要求两侧用的是同一份判断基准，而不是各自
// 按当前扫描结果反推一份刚好让门变绿的清单。
//
// ⚠️ 不做的事：不因为扫描出清单外的许可就把它塞进上面那份"照抄 deny.toml"
// 的清单让门变绿。前端确实需要一条 Rust 侧没有的许可（见下方
// FRONTEND_ONLY_ADDITIONS），但它**单独成一个数组**，不混进 baseline——
// 混进去会让上一段"逐条照抄"的说明变成假话，而"注释声称的与代码实际做的
// 不一致"正是本仓库反复付过代价的那类问题（HC-4 白名单理由写错、
// `ensure_icon` 声称限 https 却不拦降级，都是同一形状）。分成两个数组，
// "对齐 deny.toml"这个性质就仍然是字面为真、可机械核对的，而前端相对
// Rust 基线多认了什么，一眼可见。
//
// 也不做另一件事：因为门红了就给它加 ignore/例外。那会得到一道永远绿的
// 假门。但同样要避免的是**一道永远红的门**——消不掉的告警会训练人忽略它，
// 与假绿是同一种病的两个方向（2026-08-18 在保留期告警上刚撞见过：那个
// 指标一旦亮红，用户无论怎么勤快采集都消不掉）。所以清单外许可的正确处置
// 是"逐条判定并记录理由"，不是"挂着红等以后再说"。
//
// 判定规则：pnpm 返回的许可证键可能是 SPDX 复合表达式（如
// "Apache-2.0 OR MIT"）。解析规则与 cargo-deny 对 r-efi 的处理方式一致
// （见 deny.toml `[licenses].exceptions` 上方注释）：AND 连接的每一段都必须
// 各自被满足，每一段内 OR 连接的多个候选只需命中其一。
//
// 扫描范围：`pnpm licenses list --json` 默认覆盖整个已安装依赖树
// （dependencies + devDependencies + optionalDependencies），不加 `--prod`
// 过滤——与 deny.toml 检查整个 `Cargo.lock` 依赖树（不区分 dep kind）保持
// 同一宽严尺度。

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_ID = 'FLIC';
const GATE_TITLE = 'FLIC 前端依赖许可扫描（pnpm licenses list，纯允许清单，对齐 deny.toml）';

// 与 deny.toml `[licenses].allow` 逐一对应的同一份清单，逐条理由见该文件。
const FRONTEND_LICENSE_ALLOWLIST = [
  'MIT',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-3-Clause',
  'ISC',
  'Zlib',
  '0BSD',
  'Unlicense',
  'MIT-0',
  'CC0-1.0',
  'CDLA-Permissive-2.0',
  'Unicode-3.0',
  'MPL-2.0',
];

/**
 * 前端相对 Rust 基线**额外**认可的许可，逐条附理由。刻意与上面的 baseline
 * 分开，理由见文件头——上面那份的性质是"与 deny.toml 逐字一致"，可机械核对；
 * 本数组是有意识的偏离，每一条都要说清为什么 deny.toml 没有它、以及凭什么
 * 前端可以收。**新增条目必须写理由**，不写理由的条目等同于 ignore 掩盖。
 *
 * - `OFL-1.1`（SIL Open Font License）：字体文件的惯常许可。
 *   **deny.toml 没有它不是疏漏，是 Rust 依赖树里根本没有字体包**——两侧
 *   依赖树的构成不同，强求同一份清单反而是错的对齐方式。
 *   前端收它的依据不是本文件现造的判断，而是 `THIRD-PARTY-NOTICES.md` §三
 *   在建这道门**之前**就已经写明的既有结论：这两个字体包本身是 MIT，
 *   打包进去的字体文件另循 OFL，该许可允许免费嵌入商业与开源产品。
 *   本条只是把那个已经做过并记录在案的决定补登记进机械门，
 *   不是替项目所有者新做一个判断。
 *   ⚠️ OFL 对**字体文件本身的再分发**另有条款（例如不得单独出售字体文件），
 *   本项目只做嵌入式使用，不单独分发字体——这条边界一旦变化（比如日后提供
 *   "下载字体包"之类的功能），本条放行的前提就不再成立，须重新评估。
 */
const FRONTEND_ONLY_ADDITIONS = ['OFL-1.1'];

/** 实际判定用的合集。分开声明、合并使用，两个数组各自的性质都不被稀释。 */
const EFFECTIVE_ALLOWLIST = [...FRONTEND_LICENSE_ALLOWLIST, ...FRONTEND_ONLY_ADDITIONS];

/**
 * 把 pnpm 返回的 SPDX 复合表达式解析成 AND 段的数组，每段内部是可选的 OR
 * 候选数组。例如 "Apache-2.0 OR MIT" → [["Apache-2.0", "MIT"]]（一段，段内
 * 二选一）；"MIT AND CC-BY-4.0" → [["MIT"], ["CC-BY-4.0"]]（两段，都要满足）。
 *
 * 只做去括号 + 顶层 AND/OR 拆分，不处理嵌套优先级——本仓库依赖树实测过的
 * 表达式全部是单段 OR（如 "Apache-2.0 OR MIT"）或单一标识符，没有出现过
 * 需要嵌套优先级的复合表达式。
 */
function parseLicenseExpression(expression) {
  const cleaned = expression.replace(/[()]/g, ' ').trim();
  if (cleaned.length === 0) return [];
  return cleaned
    .split(/\s+AND\s+/)
    .map((segment) =>
      segment
        .split(/\s+OR\s+/)
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    )
    .filter((segment) => segment.length > 0);
}

function isExpressionAllowed(expression) {
  const andSegments = parseLicenseExpression(expression);
  if (andSegments.length === 0) return false; // 空表达式（含 UNKNOWN 场景）一律拒绝
  return andSegments.every((orAlternatives) =>
    orAlternatives.some((id) => EFFECTIVE_ALLOWLIST.includes(id)),
  );
}

export async function run() {
  const repoRoot = findRepoRoot();

  const result = spawnSync('pnpm', ['licenses', 'list', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    return {
      id: GATE_ID,
      title: GATE_TITLE,
      status: 'fail',
      findings: [
        {
          file: '(pnpm licenses list --json)',
          line: 0,
          column: 0,
          reason: `无法执行 pnpm licenses list：${result.error.message}`,
        },
      ],
      notes: [],
    };
  }

  if (result.status !== 0) {
    return {
      id: GATE_ID,
      title: GATE_TITLE,
      status: 'fail',
      findings: [
        {
          file: '(pnpm licenses list --json)',
          line: 0,
          column: 0,
          reason: `pnpm licenses list 退出码非 0（${result.status}）`,
          snippet: [result.stdout, result.stderr].filter(Boolean).join('\n'),
        },
      ],
      notes: [],
    };
  }

  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch (err) {
    return {
      id: GATE_ID,
      title: GATE_TITLE,
      status: 'fail',
      findings: [
        {
          file: '(pnpm licenses list --json)',
          line: 0,
          column: 0,
          reason: `无法解析 pnpm licenses list 的 JSON 输出：${err.message}`,
        },
      ],
      notes: [],
    };
  }

  const findings = [];
  let allowedPackageCount = 0;
  let scannedLicenseExpressions = 0;

  for (const [licenseExpression, packages] of Object.entries(data)) {
    scannedLicenseExpressions += 1;
    const allowed = isExpressionAllowed(licenseExpression);

    for (const pkg of packages) {
      if (allowed) {
        allowedPackageCount += 1;
        continue;
      }
      const versionLabel = Array.isArray(pkg.versions) ? pkg.versions.join(', ') : '?';
      const relPath =
        Array.isArray(pkg.paths) && pkg.paths.length > 0
          ? path.relative(repoRoot, pkg.paths[0])
          : `${pkg.name}@${versionLabel}`;
      findings.push({
        file: relPath,
        line: 0,
        column: 0,
        reason:
          `${pkg.name}@${versionLabel} 许可证 "${licenseExpression}" 不在前端允许清单内` +
          `（运行 \`pnpm why ${pkg.name}\` 定位引入路径；清单见本文件 FRONTEND_LICENSE_ALLOWLIST）`,
      });
    }
  }

  const status = findings.length > 0 ? 'fail' : 'pass';

  return {
    id: GATE_ID,
    title: GATE_TITLE,
    status,
    findings,
    notes: [
      `已扫描 ${scannedLicenseExpressions} 种许可证表达式，${allowedPackageCount} 个包在允许清单内`,
      ...(findings.length > 0
        ? [
            `${findings.length} 个包命中清单外许可，是否收入允许清单需项目所有者决定，本门不自动放行`,
          ]
        : []),
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
