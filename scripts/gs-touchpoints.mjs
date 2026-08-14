#!/usr/bin/env node
// pnpm gs:touchpoints <baseRef> [headRef]
//
// M3 验收：**触点数 = 2，且 Rust 侧零改动**——「同范式的第 N+1 个游戏接入，
// 应当只是配置工作」这条设计目标的机械判据（`milestones/00-实施总览.md` §8.2）。
// 外部对照物：HoYo.Gacha 接入同范式新游戏（星布谷地）改了 8 文件 41 处，全在
// 主程序（`research/05` §七）。本门要验证的收益是 41 → 2。
//
// 用法：
//   pnpm gs:touchpoints <M2 完成点>            # head 默认 HEAD
//   pnpm gs:touchpoints <base> <head>
//
// ## 为什么需要一个脚本，而不是直接跑那两行 git diff
//
// `04-M3-星铁与绝区零.md` §五 给的是这两行：
//
//   git diff --name-only <base>..HEAD -- . ':!plugins/starrail/**' ':!plugins/zzz/**' ':!plugins/index.ts'
//   git diff --name-only <base>..HEAD -- crates/          # 期望空输出
//
// 实测这两行**都会假失败**：
//   1. 第一行漏了 `fixtures/<game>/**`（§7.11 正文的白名单是三条路径，§五 的
//      命令只排除了两条），fixture 文件会被判成触点超标；
//   2. 第二行必然非空——新增一个插件一定会改
//      `crates/gs-plugin-runtime/generated/plugins.bundle.js` 与
//      `plugins.manifest.json`。它们在 `crates/` 下，但不是人写的 Rust，
//      是 `gs-bundle-plugins.mjs` 的产物。
//
// ## 豁免必须被证明，不能被声明 ★
//
// 最省事的修法是把 `crates/gs-plugin-runtime/generated/**` 整个加进白名单。
// **本脚本刻意不这么做。** 那等于给后来者留一条"手改 bundle 也不报警"的路，
// 而本项目反复记录的失效模式正是「门之所以通过，是因为它什么都没检查」。
//
// 改为：允许这两个文件出现在 diff 里，但必须**同时**证明它们确实只是重新
// 生成的产物——直接复用 HC-3（`checks/codegen-diff.mjs`），它会重跑
// codegen/bundle 再与已提交内容逐字节比对。HC-3 绿 = 已提交的产物等于此刻
// 重新生成的结果 = 没有人手改过。HC-3 红时本脚本一并判失败，不做任何兜底。
//
// ⚠️ 变异验证状态（2026-08-14 更新，如实记录，不要当成"已全部验证"）：
//   已证伪 · head != HEAD 时拒绝豁免
//   已证伪 · 工作区不干净时拒绝豁免
//   已证伪 · 白名单外的 Rust 源文件被判超标（用历史提交 cf8143d..f2c656b 实跑，
//            4 个生产文件全部抓出并给出越界行号）
//   已证伪 · crates/ 纯测试代码改动被放行（临时 worktree 造提交实跑：
//            `#[cfg(test)] mod` 区内插行 + 新建 `tests/*.rs` 整份文件，
//            判定「生产代码 0 处」、判据成立）
//   已证伪 · 同一文件内测试区 + 生产区混合改动逐行判别（同上 worktree，
//            在 rarity.rs 生产区插一行 → 精确报出"越界位置：21-21 行"，
//            同文件的测试区改动仍被放行）。这条专门排除"按文件放行"的
//            粗糙实现——文件里只要有测试区就整份放行是本门最容易写错的
//            形状，也是本项目反复踩的"门看起来在检查、实际什么都没检查"。
//   **未证伪** · HC-3 红时拒绝豁免——构造它需要"手改生成产物并提交"，
//               而那要求一个干净工作区，当时不具备。补证之前，这条分支只是
//               "写了"，不是"证明有效"。
//
// 同理，`pnpm-lock.yaml` 的豁免也被收紧到可验证的形状：新增一个插件在
// lockfile 里的真实影响是**纯新增一个 importers 条目**（实测 M2-S4 的
// wuwa：+10 / -0）。因此规则是"零删除，且新增行必须全部落在新插件的
// importers 块里"，而不是"lockfile 随便怎么改都放行"。
//
// ## 与伙伴工具同步互不干扰
//
// 触点数只约束「新增游戏插件」这件事本身。伙伴工具持续同步会合理引入 Rust
// 改动（`sync_source` 表、`notify` 监听），按 §4.6 不计入统计——**做法是让
// 两类改动落在不同的提交里**，本脚本按提交范围判定，交叉提交请先拆分。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from './gs-check/lib/repo-root.mjs';
import { renderResult, renderSummary } from './gs-check/lib/report.mjs';
import { run as runCodegenDiff } from './gs-check/checks/codegen-diff.mjs';
import { findCfgTestModuleRegions } from './gs-check/checks/rust-fixture-flow.mjs';

const TITLE = 'M3 触点数验收（新增同范式游戏只应触及插件目录 + 注册表一行）';

const PLUGIN_REGISTRY = 'plugins/index.ts';
const LOCKFILE = 'pnpm-lock.yaml';
const GENERATED_ARTIFACTS = [
  'crates/gs-plugin-runtime/generated/plugins.bundle.js',
  'crates/gs-plugin-runtime/generated/plugins.manifest.json',
];

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败：${result.stderr.trim()}`);
  }
  return result.stdout;
}

function changedPaths(repoRoot, base, head) {
  return git(repoRoot, ['diff', '--name-only', `${base}..${head}`])
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * base 时点已存在的插件 id 集合。用它来判定 diff 里出现的 `plugins/<id>/`
 * 到底是"本次新增的游戏"（白名单内）还是"改了一个已有插件"（触点超标——
 * 那说明为了接新游戏去动了别人的声明，正是本门要抓的事）。
 */
function pluginIdsAt(repoRoot, ref) {
  const listed = git(repoRoot, ['ls-tree', '--name-only', `${ref}`, 'plugins/']);
  return new Set(
    listed
      .split('\n')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter((s) => s.startsWith('plugins/') && s !== PLUGIN_REGISTRY)
      .map((s) => s.slice('plugins/'.length))
      .filter((s) => s.length > 0),
  );
}

/** 从 diff 里出现的 `plugins/<id>/...` 路径推断本次新增了哪些插件。 */
function newPluginIds(paths, existing) {
  const ids = new Set();
  for (const p of paths) {
    const m = /^plugins\/([^/]+)\//.exec(p);
    if (m && !existing.has(m[1])) ids.add(m[1]);
  }
  return ids;
}

function classify(paths, newIds, existing) {
  const buckets = {
    pluginDirs: new Map(), // id → 该插件目录下改动的文件
    fixtureDirs: new Map(),
    registry: [],
    generated: [],
    lockfile: [],
    // crates/ 下非生成产物的改动。不直接判超标——按细化后的判据，落在测试区
    // 内的改动是允许且必需的（FIXRS 门就要求它），由
    // checkCratesChangesAreTestOnly 逐文件判定。
    cratesOther: [],
    violations: [],
  };

  for (const p of paths) {
    if (p === PLUGIN_REGISTRY) {
      buckets.registry.push(p);
      continue;
    }
    if (p === LOCKFILE) {
      buckets.lockfile.push(p);
      continue;
    }
    if (GENERATED_ARTIFACTS.includes(p)) {
      buckets.generated.push(p);
      continue;
    }
    if (p.startsWith('crates/')) {
      buckets.cratesOther.push(p);
      continue;
    }
    const plugin = /^plugins\/([^/]+)\//.exec(p);
    if (plugin && newIds.has(plugin[1])) {
      const list = buckets.pluginDirs.get(plugin[1]) ?? [];
      list.push(p);
      buckets.pluginDirs.set(plugin[1], list);
      continue;
    }
    const fixture = /^fixtures\/([^/]+)\//.exec(p);
    if (fixture && newIds.has(fixture[1])) {
      const list = buckets.fixtureDirs.get(fixture[1]) ?? [];
      list.push(p);
      buckets.fixtureDirs.set(fixture[1], list);
      continue;
    }
    // 走到这里的都是超标。对"改了已有插件"这种情况给一句更具体的说明，
    // 因为它与"改了主程序"性质不同，但同样违反判据。
    const touchedExisting = plugin && existing.has(plugin[1]);
    buckets.violations.push({
      path: p,
      why: touchedExisting
        ? `改动了已有插件 "${plugin[1]}" 的声明——接入新游戏不该需要修改别的游戏`
        : '不在白名单内（plugins/<新游戏>/**、fixtures/<新游戏>/**、plugins/index.ts）',
    });
  }

  return buckets;
}

/** 取某个文件在 diff 范围内的增删行（不含 diff 头与上下文行）。 */
function diffLines(repoRoot, base, head, file) {
  const patch = git(repoRoot, ['diff', '--unified=0', `${base}..${head}`, '--', file]);
  const added = [];
  const removed = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/**
 * 注册表必须是"每个新插件恰好一行 import 追加"，不能有删除、不能改动已有行。
 * 这一行是刻意保留的人工审查锚点（`discussion/2026-08-10-插件实现语言与能力分层.md`
 * §1.2）——它必须在 PR diff 里一眼可见，所以形态也要被约束住。
 */
function checkRegistry(repoRoot, base, head, newIds, findings) {
  if (newIds.size === 0) return;
  const { added, removed } = diffLines(repoRoot, base, head, PLUGIN_REGISTRY);
  const meaningfulRemoved = removed.filter((l) => l.trim().length > 0);
  if (meaningfulRemoved.length > 0) {
    findings.push({
      file: PLUGIN_REGISTRY,
      line: 0,
      column: 0,
      reason: `注册表出现 ${meaningfulRemoved.length} 行删除——接入新游戏只应追加，不应改动或移除已有注册`,
      snippet: meaningfulRemoved.join('\n'),
    });
  }

  const importLines = added.filter((l) => l.includes('import('));
  const expected = [...newIds].map((id) => `() => import("./${id}/manifest.ts"),`);
  const normalized = importLines.map((l) => l.trim());
  for (const want of expected) {
    if (!normalized.includes(want)) {
      findings.push({
        file: PLUGIN_REGISTRY,
        line: 0,
        column: 0,
        reason: `未找到新插件的注册行 \`${want}\`——注册表是唯一的人工审查锚点，形态必须一致`,
      });
    }
  }
  if (normalized.length > newIds.size) {
    findings.push({
      file: PLUGIN_REGISTRY,
      line: 0,
      column: 0,
      reason: `注册表新增了 ${normalized.length} 行 import，但本次只新增了 ${newIds.size} 个插件`,
      snippet: normalized.join('\n'),
    });
  }
}

/**
 * lockfile 只允许"纯新增新插件的 importers 条目"。实测形态（M2-S4 的 wuwa）：
 * 以 `  plugins/<id>:` 开头的 10 行块，零删除。任何删除、或落在别处的新增，
 * 都意味着这次改动顺带动了依赖解析，不属于"接入即配置"。
 */
function checkLockfile(repoRoot, base, head, newIds, findings) {
  const { added, removed } = diffLines(repoRoot, base, head, LOCKFILE);
  const meaningfulRemoved = removed.filter((l) => l.trim().length > 0);
  if (meaningfulRemoved.length > 0) {
    findings.push({
      file: LOCKFILE,
      line: 0,
      column: 0,
      reason:
        `lockfile 出现 ${meaningfulRemoved.length} 行删除——新增插件对 lockfile 的影响应当是纯追加` +
        '一个 importers 条目；有删除说明顺带改了依赖解析',
      snippet: meaningfulRemoved.slice(0, 10).join('\n'),
    });
  }

  // 新增行必须全部处在某个新插件的 importers 块内：块以 `  plugins/<id>:`
  // 开始，到下一个同级键（两空格缩进的非空行）为止。
  let currentBlockOwner;
  for (const line of added) {
    const header = /^ {2}plugins\/([^/:]+):\s*$/.exec(line);
    if (header) {
      currentBlockOwner = header[1];
      if (!newIds.has(currentBlockOwner)) {
        findings.push({
          file: LOCKFILE,
          line: 0,
          column: 0,
          reason: `lockfile 新增了 importers 条目 "plugins/${currentBlockOwner}"，但它不是本次新增的插件`,
        });
      }
      continue;
    }
    if (line.trim().length === 0) continue;
    // 缩进比 4 空格浅的非空行 = 离开了 importers 条目块
    if (!/^ {4}/.test(line)) currentBlockOwner = undefined;
    if (!currentBlockOwner) {
      findings.push({
        file: LOCKFILE,
        line: 0,
        column: 0,
        reason: 'lockfile 的新增行落在新插件的 importers 条目之外——不属于"接入新游戏"的必要影响',
        snippet: line,
      });
    }
  }
}

/**
 * 解析 `git diff --unified=0` 的 hunk 头，取出改动行区间。
 *
 * hunk 头形如 `@@ -12,3 +12,5 @@`，两侧的 `,n` 在 n===1 时会被省略。
 * 返回旧文件被删/改的行区间与新文件新增/改的行区间——两侧都要，因为
 * 「在生产代码里删掉几行」同样是生产代码改动，只看新增行会漏掉它。
 */
function changedLineRanges(repoRoot, base, head, file) {
  const patch = git(repoRoot, ['diff', '--unified=0', `${base}..${head}`, '--', file]);
  const oldRanges = [];
  const newRanges = [];
  for (const line of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const oldStart = Number(m[1]);
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    if (oldCount > 0) oldRanges.push([oldStart, oldStart + oldCount - 1]);
    if (newCount > 0) newRanges.push([newStart, newStart + newCount - 1]);
  }
  return { oldRanges, newRanges };
}

/** 把 `findCfgTestModuleRegions` 返回的字符偏移区间换算成行号区间（1 起）。 */
function cfgTestLineRegions(source) {
  const lineStartOffsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') lineStartOffsets.push(i + 1);
  }
  const offsetToLine = (offset) => {
    let lo = 0;
    let hi = lineStartOffsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStartOffsets[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  return findCfgTestModuleRegions(source).map((r) => [offsetToLine(r.start), offsetToLine(r.end)]);
}

function fileAtRef(repoRoot, ref, file) {
  const result = spawnSync('git', ['show', `${ref}:${file}`], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : undefined;
}

const WHOLE_FILE_TEST_PATH = /(^|\/)tests\/[^/]*\.rs$/;

/**
 * 「Rust 侧零**生产代码**改动」的机械校验 ★ 2026-08-14 裁定
 *
 * 原判据写的是「Rust 侧零改动」，机械形式是 `git diff --name-only -- crates/`
 * 期望空输出。实测这条与本项目自己的 FIXRS 门直接冲突：FIXRS 要求
 * `plugins/index.ts` 注册的每个插件都必须有 Rust 测试引用它的真实 fixture
 * （理由是 M2-S6 的真实故障——鸣潮 ISO 时间解析在 Rust 侧全挂，因为那批数据
 * 只有 TS 侧跑过）。于是新增任何插件都必然要往 `crates/` 加测试，
 * 「零改动」永远不可能满足。
 *
 * 两条规则各自都对，冲突出在判据的机械表述把「不改宿主逻辑」和「crates/ 下
 * 零文件变动」当成了同一件事。用户裁定细化为「零生产代码改动」：测试新增
 * 允许且必需，生产代码一行都不许动。
 *
 * 判定方式（不靠人看，机械可验）：
 *   - `crates/<crate>/tests/*.rs`（含 `crates/paradigms/<crate>/tests/*.rs`）
 *     整个文件都是测试代码，新增/修改一律放行
 *   - 其余 `crates/**` 下的 `.rs`：改动行必须全部落在 `#[cfg(test)] mod` 区间内。
 *     新增行按 head 版本判定，删除行按 base 版本判定——只看新增会漏掉
 *     「在生产代码里删了几行」这种改动
 *   - `crates/**` 下的非 `.rs` 文件（Cargo.toml、迁移 SQL 等）一律判超标
 *
 * 「什么算测试区」的定义与 FIXRS 门共用同一份实现（`findCfgTestModuleRegions`），
 * 不各写一份。
 *
 * ⚠️ 已知边界（实测确认，不是猜测）：`findCfgTestModuleRegions` 只识别
 * `#[cfg(test)] mod ... { }`，**不识别 `#[cfg(test)]` 直接标在 fn / impl 上**的
 * 写法。本仓库里就有一个这样的实例——`crates/gs-analysis/src/pity.rs:351` 的
 * `#[cfg(test)] fn genshin_soft_pity_test_curve()`（它刻意放在模块作用域，
 * 因为两个测试子模块都要用）。改动这类符号会被本函数误判成生产代码改动。
 *
 * 这个方向是**保守失败**：误报会让验收变红、逼人来看一眼，而不是把真的生产
 * 代码改动放过去。真撞上时的正解是把那个测试辅助函数挪进某个
 * `#[cfg(test)] mod` 里，而不是放宽这里的判定——放宽会同时放宽 FIXRS 对
 * 「fixture 引用是否在测试代码里」的判定，那是安全方向相反的改动。
 */
function checkCratesChangesAreTestOnly(repoRoot, base, head, cratesFiles, findings) {
  const testOnly = [];
  for (const file of cratesFiles) {
    if (WHOLE_FILE_TEST_PATH.test(file)) {
      testOnly.push(file);
      continue;
    }
    if (!file.endsWith('.rs')) {
      findings.push({
        file,
        line: 0,
        column: 0,
        reason:
          'crates/ 下的非 .rs 文件被改动（Cargo.toml / 迁移脚本等）——这不是测试代码，' +
          '违反「Rust 侧零生产代码改动」判据',
      });
      continue;
    }

    const { oldRanges, newRanges } = changedLineRanges(repoRoot, base, head, file);
    const headSource = fileAtRef(repoRoot, head, file);
    const baseSource = fileAtRef(repoRoot, base, file);
    const headRegions = headSource === undefined ? [] : cfgTestLineRegions(headSource);
    const baseRegions = baseSource === undefined ? [] : cfgTestLineRegions(baseSource);
    const inside = (regions, [from, to]) => regions.some(([s, e]) => from >= s && to <= e);

    const outside = [
      ...newRanges.filter((r) => !inside(headRegions, r)).map((r) => `新增/修改 ${r[0]}-${r[1]} 行`),
      ...oldRanges.filter((r) => !inside(baseRegions, r)).map((r) => `删除/修改 ${r[0]}-${r[1]} 行（base 侧）`),
    ];
    if (outside.length > 0) {
      findings.push({
        file,
        line: 0,
        column: 0,
        reason:
          `改动落在 #[cfg(test)] 区间之外，属生产代码改动——接入同范式新游戏不该需要改宿主逻辑。` +
          `越界位置：${outside.join('；')}`,
      });
    } else {
      testOnly.push(file);
    }
  }
  return testOnly;
}

export async function run(base, head) {
  const repoRoot = findRepoRoot();
  const findings = [];
  const notes = [];

  const paths = changedPaths(repoRoot, base, head);
  const existing = pluginIdsAt(repoRoot, base);
  const newIds = newPluginIds(paths, existing);

  if (newIds.size === 0) {
    return {
      id: 'TOUCH',
      title: TITLE,
      status: 'fail',
      findings: [
        {
          file: '.',
          line: 0,
          column: 0,
          reason:
            `${base}..${head} 之间没有发现任何新增插件目录——本门是"新增游戏"的验收判据，` +
            '请确认比较范围是否正确（伙伴工具同步等横切改动应当落在不同的提交里，见 §4.6）',
        },
      ],
      notes: [],
    };
  }

  const buckets = classify(paths, newIds, existing);

  for (const v of buckets.violations) {
    findings.push({ file: v.path, line: 0, column: 0, reason: v.why });
  }

  const cratesTestOnly = checkCratesChangesAreTestOnly(repoRoot, base, head, buckets.cratesOther, findings);
  // 被判成生产代码改动的，并进 violations 桶，让结论行统计得到它们。
  for (const f of findings.filter((f) => f.file.startsWith('crates/'))) {
    if (!buckets.violations.some((v) => v.path === f.file)) {
      buckets.violations.push({ path: f.file, why: f.reason });
    }
  }

  checkRegistry(repoRoot, base, head, newIds, findings);
  if (buckets.lockfile.length > 0) checkLockfile(repoRoot, base, head, newIds, findings);

  // 生成产物的条件豁免：必须由 HC-3 证明"已提交内容 == 此刻重新生成的结果"。
  //
  // ⚠️ HC-3 判定的对象是**当前工作区相对 HEAD** 的状态：它重跑 codegen/bundle，
  // 再看产物是否与已提交内容一致。因此它的结论只对 HEAD 成立——如果本脚本被
  // 要求判定一个不是 HEAD 的区间终点，HC-3 通过并不能证明那个终点上的产物是
  // 干净的。第一版漏了这条，在 head != HEAD 时会打印一句对被判区间并不成立的
  // "豁免依据"。这里显式拦住，宁可要求调用方先 checkout，也不给一个听起来
  // 合理但无效的证明。
  if (buckets.generated.length > 0) {
    const headSha = git(repoRoot, ['rev-parse', head]).trim();
    const currentSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    const dirty = git(repoRoot, ['status', '--porcelain']).trim();
    if (headSha !== currentSha) {
      findings.push({
        file: buckets.generated.join(' / '),
        line: 0,
        column: 0,
        reason:
          `生成产物出现在改动里，但判定终点 ${head}（${headSha.slice(0, 7)}）不是当前 HEAD` +
          `（${currentSha.slice(0, 7)}）——证明豁免要靠重跑 codegen 与该提交的产物比对，` +
          '只能在 checkout 到该提交后进行。请先 checkout，或把 head 设为 HEAD。',
      });
    } else if (dirty.length > 0) {
      findings.push({
        file: buckets.generated.join(' / '),
        line: 0,
        column: 0,
        reason:
          '生成产物出现在改动里，但工作区不干净——重跑 codegen 会把未提交的插件改动也算进去，' +
          '比对结果无法归因到被判定的提交。请先提交或暂存工作区改动。',
        snippet: dirty.split('\n').slice(0, 10).join('\n'),
      });
    }
  }
  if (buckets.generated.length > 0 && findings.every((f) => !f.reason.startsWith('生成产物出现在改动里'))) {
    const codegen = await runCodegenDiff();
    if (codegen.status !== 'pass') {
      findings.push({
        file: buckets.generated.join(' / '),
        line: 0,
        column: 0,
        reason:
          '生成产物出现在改动里，但 HC-3（codegen 一致性）未通过——豁免这两个文件的前提是' +
          '"它们只是重新生成的结果"，该前提当前不成立，可能是有人手改了产物，或忘了重跑生成。' +
          '本门不对未经证明的生成产物放行。',
      });
    } else {
      notes.push(
        `生成产物 ${buckets.generated.length} 个已豁免，豁免依据是 HC-3 现场通过` +
          '（重跑 codegen/bundle 后与已提交内容逐字节一致），不是白名单放行。',
      );
    }
  }
  for (const artifact of GENERATED_ARTIFACTS) {
    if (!existsSync(path.join(repoRoot, artifact))) {
      findings.push({
        file: artifact,
        line: 0,
        column: 0,
        reason: '生成产物路径不存在——本脚本的豁免清单已与仓库实际结构脱节，请同步更新',
      });
    }
  }

  // 触点数按 §8.2 的定义计数：新建 plugins/<game>/ 目录（每个游戏 1 个）
  // + plugins/index.ts（1 个），fixtures/ 是插件自带产物不单独计。
  const touchpointsPerGame = 1 + (buckets.registry.length > 0 ? 1 : 0);
  notes.push(
    `本次新增插件：${[...newIds].join(' / ')}（${newIds.size} 个）；` +
      `每个游戏的触点 = plugins/<game>/ 目录 + plugins/index.ts 一行 = ${touchpointsPerGame}`,
  );
  for (const [id, files] of buckets.pluginDirs) {
    const fixtures = buckets.fixtureDirs.get(id) ?? [];
    notes.push(`  ${id}：plugins/${id}/ ${files.length} 文件，fixtures/${id}/ ${fixtures.length} 文件`);
  }
  // ⚠️ 这行结论必须把超标桶里的 crates/ 文件也算进来。第一版只统计
  // `buckets.generated`，于是在 4 个 Rust 源文件被判超标的同一次运行里，
  // 仍然打印"人写代码 0 处"——报告本身成了一句假陈述。门可以红，但门说的话
  // 不能是假的。
  const productionRustChanges = buckets.violations.filter((v) => v.path.startsWith('crates/'));
  notes.push(
    `Rust 侧（crates/）改动：生成产物 ${buckets.generated.length} 个 + ` +
      `测试代码 ${cratesTestOnly.length} 个 + 生产代码 ${productionRustChanges.length} 处` +
      (productionRustChanges.length > 0
        ? `（${productionRustChanges.map((v) => v.path).join('、')}）——「Rust 侧零生产代码改动」判据**不成立**`
        : '——「Rust 侧零生产代码改动」判据成立'),
  );
  if (cratesTestOnly.length > 0) {
    notes.push(
      `  测试代码改动（允许且被 FIXRS 门要求）：${cratesTestOnly.join('、')}` +
        '——判据已于 2026-08-14 细化为「零生产代码改动」，理由见本文件 ' +
        'checkCratesChangesAreTestOnly 的文档注释。',
    );
  }

  return {
    id: 'TOUCH',
    title: TITLE,
    status: findings.length > 0 ? 'fail' : 'pass',
    findings,
    notes,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  if (!base) {
    console.error('用法：pnpm gs:touchpoints <baseRef> [headRef]');
    console.error('例：  pnpm gs:touchpoints 01411fb            # M2 完成点到 HEAD');
    process.exitCode = 1;
  } else {
    const result = await run(base, head);
    renderResult(result);
    console.log('');
    renderSummary([result]);
    process.exitCode = result.status === 'fail' ? 1 : 0;
  }
}
