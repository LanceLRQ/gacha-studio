#!/usr/bin/env node
// HC-5 · 模板可用性（scaffold 生成的插件必须能类型检查 **且** 跑通自带测试）
//
// 起因：`templates/plugin/<paradigm>/` 是 `pnpm gs:new-plugin` 的生成源，
// 但 `pnpm-workspace.yaml` 的 packages 列表（web / packages/* / plugins /
// plugins/* / drills）不包含 `templates/`——模板文件从未被 `pnpm typecheck`
// 真正检查过。后果：契约类型变更（如 M2-S2 的 paradigm 改名）如果没同步
// 更新模板，不会有任何门变红，直到某个贡献者用坏掉的模板生成插件才会发现
// ——而那正是新贡献者第一次接触本仓库的时刻，体验最差的地方。
//
// ## 为什么这道门要跑测试，而不是只跑 tsc（2026-08-13 扩围）
//
// 本门的第一版只跑 `tsc --noEmit`，而模板宣称的是"开箱能跑通测试"
// （`templates/plugin/<paradigm>/fixture.test.ts` 的文件头原话）。两者之间
// 的缝隙被一次真实回归证实了：M2-S7 把契约测试的响应样本文件名收紧成
// `<bannerId>_page_<n>.json` 并让解析失败直接抛错，但模板里的样本仍叫
// `page_1.json`——**模板照样通过类型检查，照模板生成的插件却在第一次
// `pnpm --filter <game> test` 就抛错**。门是绿的，因为它检查的不是它声称
// 保证的那件事。
//
// 修法不是给文件名加一条正则校验（那只是把同一个断层挪了个位置），而是让
// 这道门执行模板真正承诺的动作：**生成一份，然后跑它自己的 fixture.test.ts**。
//
// ## 为什么探针落在仓库内，而不是临时目录
//
// 第一版把探针生成到 `os.tmpdir()`，这对 tsc 够用，但跑不了 fixture 测试：
// `nodeFixtureReader` 的仓库根定位（`packages/gs-plugin-kit/testkit/node-reader.ts`
// 的 `findRepoRoot`）是从 **node-reader.ts 自身所在位置**向上找
// `pnpm-workspace.yaml`，与调用方的 cwd 无关；Node 默认解析符号链接，所以
// 即使通过 symlink 引入，它拿到的仍是真实仓库路径，于是会去
// `<repo>/fixtures/<probe>/` 找样本——临时目录里的那份根本不会被读到。
//
// 改成在仓库内生成 `plugins/<probe>/` 与 `fixtures/<probe>/` 后：
//   - fixture 测试能按真实路径读到样本（本门要检查的正是这条路径）
//   - `tsconfig.json` 的相对 `extends: ../../tsconfig.base.json` 天然正确，
//     第一版为临时目录深度不定而做的"绝对路径重写"hack 可以整个删掉
//   - 探针与贡献者真实拿到的产物**逐字节相同**，不再有"生成逻辑等价但布局
//     不同"这层需要说服自己的推理
//
// 代价是这道门运行期间会在工作区里短暂写入两个目录。已做两重防护：
//   1. 生成前先清理同名残留（上一次异常中断留下的），本门自愈
//   2. 生成后的清理放在 finally 里，无论断言结果如何都执行
// 万一仍有残留，`gs:check` 的门是**串行**执行的（`scripts/gs-check/index.mjs`），
// 残留只会在下一次运行时被 HC-1 的"plugins/ 目录 vs plugins/index.ts 注册表
// 双向一致"检查大声报出来，不会静默通过——这是可接受的失败形态。
//
// 仍然保留的一点故意偏差（如实记录，不假装完全一致）：
//   `node_modules/gs-plugin-kit` 用手写 symlink 指向 `packages/gs-plugin-kit`，
//   不跑 `pnpm install`。探针是临时包，pnpm 不会为它链接依赖；手写 symlink
//   达到的解析效果与 pnpm 链接等价（都是"node_modules/gs-plugin-kit 指向同一个
//   真实目录"），但跳过了 pnpm 本身的开销，让这道门能在秒级跑完。

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';
import { collectFilesRelative, copyTemplateFile, SUPPORTED_PARADIGMS } from '../../gs-new-plugin.mjs';

const GATE_TITLE = 'HC-5 模板可用性（生成的插件必须能类型检查且跑通自带测试）';
const TEMPLATES_DIR = 'templates/plugin';
// 合法游戏 id：与 gs-new-plugin.mjs 的 GAME_ID_PATTERN 一致，取一个不会与
// 真实游戏撞车的固定值。固定而非随机，是为了让异常中断后的残留能被下一次
// 运行的清理逻辑准确识别并删除。
const PROBE_GAME_ID = 'gscheckprobe';
const FIXTURE_TEMPLATE_PREFIX = path.join('fixtures', '__game__');

function joinOutput(result) {
  return [result.stdout, result.stderr].filter((s) => s && s.trim().length > 0).join('\n');
}

function probePaths(repoRoot) {
  return {
    pluginDir: path.join(repoRoot, 'plugins', PROBE_GAME_ID),
    fixtureDir: path.join(repoRoot, 'fixtures', PROBE_GAME_ID),
  };
}

function removeProbe(repoRoot) {
  const { pluginDir, fixtureDir } = probePaths(repoRoot);
  rmSync(pluginDir, { recursive: true, force: true });
  rmSync(fixtureDir, { recursive: true, force: true });
}

/**
 * 按 gs-new-plugin.mjs 的分流规则，把模板目录下的每个文件复制到探针位置
 * ——`fixtures/__game__/` 子树去 `fixtures/<probe>/`，其余去
 * `plugins/<probe>/`。这与真实 `pnpm gs:new-plugin` 的落点完全一致，复用的
 * 也是它导出的 `collectFilesRelative` / `copyTemplateFile`，不各自维护一份
 * 复制逻辑、不会悄悄漂移。
 */
function generateProbe(templateDir, repoRoot) {
  const { pluginDir, fixtureDir } = probePaths(repoRoot);

  for (const relPath of collectFilesRelative(templateDir)) {
    const srcFile = path.join(templateDir, relPath);
    const destFile =
      relPath.startsWith(FIXTURE_TEMPLATE_PREFIX + path.sep) || relPath === FIXTURE_TEMPLATE_PREFIX
        ? path.join(fixtureDir, relPath.slice(FIXTURE_TEMPLATE_PREFIX.length + 1))
        : path.join(pluginDir, relPath);
    copyTemplateFile(srcFile, destFile, PROBE_GAME_ID);
  }

  return pluginDir;
}

/** node_modules/gs-plugin-kit → packages/gs-plugin-kit 的手写 symlink，理由见文件头。 */
function linkPluginKit(pluginDir, repoRoot) {
  const nodeModulesDir = path.join(pluginDir, 'node_modules');
  mkdirSync(nodeModulesDir, { recursive: true });
  symlinkSync(
    path.join(repoRoot, 'packages', 'gs-plugin-kit'),
    path.join(nodeModulesDir, 'gs-plugin-kit'),
    'junction',
  );
}

function resolveTscBinary(repoRoot) {
  return path.join(repoRoot, 'packages', 'gs-plugin-kit', 'node_modules', '.bin', 'tsc');
}

/**
 * 把探针的绝对路径换回模板源路径，让报错能直接定位到该改
 * `templates/plugin/<paradigm>/` 下的哪个文件——探针目录名对读的人没有意义。
 */
function rewritePaths(text, pluginDir, fixtureDir, paradigm) {
  return text
    .split(pluginDir)
    .join(`${TEMPLATES_DIR}/${paradigm}`)
    .split(fixtureDir)
    .join(`${TEMPLATES_DIR}/${paradigm}/fixtures/__game__`)
    // fixture 测试的报错里出现的是仓库相对路径（nodeFixtureReader 按仓库根
    // 解释路径），不是绝对路径，单独再换一次。
    .split(`fixtures/${PROBE_GAME_ID}`)
    .join(`${TEMPLATES_DIR}/${paradigm}/fixtures/__game__`);
}

function checkParadigm(repoRoot, paradigmDir, paradigm) {
  // 先清理上一次异常中断可能留下的残留，让本门自愈。
  removeProbe(repoRoot);

  const { pluginDir, fixtureDir } = probePaths(repoRoot);
  try {
    generateProbe(paradigmDir, repoRoot);
    linkPluginKit(pluginDir, repoRoot);

    const fail = (reason, snippet) => [
      { file: `${TEMPLATES_DIR}/${paradigm}`, line: 0, column: 0, reason, snippet },
    ];

    // ① 类型检查
    const tsc = spawnSync(resolveTscBinary(repoRoot), ['--noEmit'], { cwd: pluginDir, encoding: 'utf8' });
    if (tsc.error) {
      return fail(`无法执行 tsc：${tsc.error.message}`);
    }
    if (tsc.status !== 0) {
      return fail(
        `模板生成后无法通过 tsc --noEmit（退出码 ${tsc.status}）——见下方原始输出`,
        rewritePaths(joinOutput(tsc), pluginDir, fixtureDir, paradigm),
      );
    }

    // ② 跑生成插件自带的 fixture 契约测试。这是模板对贡献者的明面承诺
    //    （"开箱状态下这个测试应该直接通过"），只跑 tsc 检查不到它。
    const testEntry = path.join(pluginDir, 'fixture.test.ts');
    if (!existsSync(testEntry)) {
      return fail('模板缺少 fixture.test.ts——生成的插件没有可执行的开箱测试');
    }
    const test = spawnSync(process.execPath, ['--experimental-strip-types', 'fixture.test.ts'], {
      cwd: pluginDir,
      encoding: 'utf8',
    });
    if (test.error) {
      return fail(`无法执行生成插件的 fixture.test.ts：${test.error.message}`);
    }
    if (test.status !== 0) {
      return fail(
        `模板生成后 fixture 契约测试不通过（退出码 ${test.status}）——模板声称"开箱能跑通测试"，` +
          '这条承诺当前是假的，见下方原始输出',
        rewritePaths(joinOutput(test), pluginDir, fixtureDir, paradigm),
      );
    }

    return [];
  } finally {
    removeProbe(repoRoot);
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
        `各生成一份探针插件到 plugins/${PROBE_GAME_ID}/ 与 fixtures/${PROBE_GAME_ID}/，` +
        '依次跑 tsc --noEmit 与生成插件自带的 fixture.test.ts，验证完成后已删除探针目录。',
      '本门跑的是"生成之后的产物"而不是模板文件本身——贡献者遇到的就是生成之后的文件；' +
        '只跑 tsc 会漏掉"类型对但测试跑不起来"这一类问题（2026-08-13 的响应样本文件名回归即属此类）。',
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
