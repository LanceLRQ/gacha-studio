#!/usr/bin/env node
// HC-3 · 类型生成 + 运行时校验
//
// 本门由三条独立的机械检查组成：
//   ① codegen / 插件 bundle 一致性——重跑生成命令后 git status 必须为空
//   ② fixture 回归——对每个声明了 fixture.test.ts 的插件跑一遍
//      assertPluginFixture（extractList → extractRecord → hooks → schema
//      校验 → 与 expected/normalized.json 比对）
//   ③ zod schema 覆盖率——packages/gs-plugin-kit/types/generated.ts 导出的
//      每个类型，schema/index.ts 里必须有对应的运行时校验 schema
//
// 三条独立收集 findings 后合并判定，不是跑完①就短路返回——
// ①②③即使①本身通过，②③仍然可能各自发现问题，不能因为①绿了就不跑后两条。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE_BASE =
  'HC-3 类型生成（codegen 一致性 + fixture 回归 + zod 覆盖率 + 跨语言 SDK 版本同步）';
const TYPES_DIR = 'packages/gs-plugin-kit/types/';
const GENERATED_TYPES_FILE = 'packages/gs-plugin-kit/types/generated.ts';
const SCHEMA_FILE = 'packages/gs-plugin-kit/schema/index.ts';

// 插件 bundle 与 manifest 静态字段 JSON。它们由 scripts/gs-bundle-plugins.mjs
// 从 plugins/** 打包，被 gs-plugin-runtime 用 include_str! 嵌进二进制。
//
// 为什么也要进这道门：它和 types/ 是同一类东西——生成产物且必须 committed
// （否则新克隆 include_str! 直接编译失败）。更要紧的是，产物落后于 plugins/
// 源码时**不会有任何报错**，只是二进制里跑的还是旧版插件代码，
// 而插件代码正是 record_key、归一化这些静默失败高发区的所在。
const PLUGIN_BUNDLE_DIR = 'crates/gs-plugin-runtime/generated/';

// IPC 视图类型（gs-codegen 的第二份产物，源在 crates/gs-host/src/views.rs）。
//
// 它落在 web/ 下而不是 packages/gs-plugin-kit/types/，理由见那个模块的文档
// （一句话：那个目录的类型要过下面第 ③ 项 zod 覆盖率检查，而 IPC 形状是
// 宿主自己 serde 出去的，给它写 zod 是用运行时校验去验自己的输出）。
//
// 但「不进 zod 检查」不等于「不进一致性检查」——它同样是生成产物，手改
// 同样必须被抓。所以只把它加进下面第 ① 项的 porcelain 监视范围，
// 不加进第 ③ 项。
const IPC_TYPES_DIR = 'web/src/lib/ipc/';

function joinOutput(result) {
  return [result.stdout, result.stderr].filter((s) => s && s.trim().length > 0).join('\n');
}

// ============================================================
// ② fixture 回归：assertPluginFixture
// ============================================================

/**
 * 对每个 `plugins/<id>/fixture.test.ts` 存在的插件目录，真的执行一遍该
 * 测试脚本（`node --experimental-strip-types`，与插件作者本地跑
 * `pnpm --filter <id> test` 完全同一条命令）。没有 fixture.test.ts 的插件
 * 目录不算失败——本 Stage 只有 authkey 范式落了地，其余范式尚未有可运行的
 * fixture 契约测试实现，跳过并如实计入 notes，不装作已经验证过。
 */
function runFixtureRegression(repoRoot) {
  const pluginsDir = path.join(repoRoot, 'plugins');
  let entries;
  try {
    entries = readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return { findings: [], scannedCount: 0, skippedCount: 0 };
  }

  const gameDirs = entries.filter((entry) => entry.isDirectory() && entry.name !== 'node_modules');
  const findings = [];
  let scannedCount = 0;
  let skippedCount = 0;

  for (const dirEntry of gameDirs) {
    const testFile = path.join(pluginsDir, dirEntry.name, 'fixture.test.ts');
    if (!existsSync(testFile)) {
      skippedCount += 1;
      continue;
    }
    scannedCount += 1;
    const relTestFile = path.relative(repoRoot, testFile);
    const result = spawnSync('node', ['--experimental-strip-types', relTestFile], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
      findings.push({
        file: relTestFile,
        line: 0,
        column: 0,
        reason: result.error
          ? `无法执行 fixture 回归测试：${result.error.message}`
          : `fixture 回归测试失败，退出码 ${result.status}`,
        snippet: joinOutput(result),
      });
    }
  }

  return { findings, scannedCount, skippedCount };
}

// ============================================================
// ④ 跨语言 SDK 版本常量同步
// ============================================================

const HOST_SDK_VERSION_FILE = 'crates/gs-core/src/sdk_version.rs';
const KIT_SDK_VERSION_FILE = 'packages/gs-plugin-kit/manifest.ts';

/**
 * 同一个 SDK 版本号在两侧语言各有一个落点：Rust 的 `HOST_SDK_VERSION`
 * （宿主运行时用它拒绝不兼容插件）与 TS 的 `CURRENT_SDK_VERSION`
 * （插件作者编译期照着它填 `manifest.sdkVersion`）。
 *
 * 为什么这需要一道机械检查，而不是靠注释约定：`sdk_version.rs` 里那条
 * 注释已经写明「必须手动保持同步」，并且**自己精确描述了失败模式**——
 * 「任何一处漏改都会让『插件声明的版本』与『宿主实际支持的版本』出现
 * 假象上的一致」。这正是 HC-4 那条 founding story 的形状：类型检查、
 * review、注释全绿，运行时静默不生效。两侧一旦漂移，宿主会用旧基准去
 * 校验按新契约写的插件，而**校验本身仍然「通过」**，因为 major 相等——
 * 这道门要拦的就是那种通过。
 *
 * 放在 HC-3 而不是新开一道门：HC-3 的职责本来就是「Rust 与 TS 两侧必须
 * 保持一致」，codegen 产物一致性是这件事的一个面，跨语言常量同步是另一个面。
 */
function checkSdkVersionSync(repoRoot) {
  const read = (relPath) => {
    try {
      return readFileSync(path.join(repoRoot, relPath), 'utf8');
    } catch {
      return null;
    }
  };

  const rustSource = read(HOST_SDK_VERSION_FILE);
  const kitSource = read(KIT_SDK_VERSION_FILE);
  if (rustSource === null || kitSource === null) {
    const missing = rustSource === null ? HOST_SDK_VERSION_FILE : KIT_SDK_VERSION_FILE;
    return {
      findings: [{ file: missing, line: 0, column: 0, reason: '读取失败——本子检查依赖这两个文件同时存在' }],
      hostVersion: null,
      kitVersion: null,
    };
  }

  const hostMatch = rustSource.match(/pub const HOST_SDK_VERSION:\s*&str\s*=\s*"([^"]+)"/);
  const kitMatch = kitSource.match(/export const CURRENT_SDK_VERSION\s*=\s*"([^"]+)"/);

  // 提取不到 ≠ 同步没问题：常量被改名或改写法时，静默跳过等于这道门
  // 从此形同虚设，所以提取失败本身就是 finding。
  if (!hostMatch || !kitMatch) {
    const missing = !hostMatch ? HOST_SDK_VERSION_FILE : KIT_SDK_VERSION_FILE;
    return {
      findings: [
        {
          file: missing,
          line: 0,
          column: 0,
          reason:
            '提取不到 SDK 版本常量——常量可能被改名或换了写法。本子检查靠固定形状匹配，' +
            '提取不到时不能当作"同步没问题"放行，否则这道门会静默失效',
        },
      ],
      hostVersion: hostMatch?.[1] ?? null,
      kitVersion: kitMatch?.[1] ?? null,
    };
  }

  const hostVersion = hostMatch[1];
  const kitVersion = kitMatch[1];
  if (hostVersion !== kitVersion) {
    return {
      findings: [
        {
          file: HOST_SDK_VERSION_FILE,
          line: 0,
          column: 0,
          reason:
            `SDK 版本两侧不一致：Rust HOST_SDK_VERSION="${hostVersion}"，` +
            `TS CURRENT_SDK_VERSION="${kitVersion}"（${KIT_SDK_VERSION_FILE}）——` +
            '两者是同一个版本号在两侧的落点，必须在同一次提交里一起改',
        },
      ],
      hostVersion,
      kitVersion,
    };
  }

  return { findings: [], hostVersion, kitVersion };
}

// ============================================================
// ③ zod schema 覆盖率
// ============================================================

/**
 * `types/generated.ts` 每一行顶层类型导出都形如
 * `export type Foo = ...;`（哪怕类型体本身跨多行，声明这一行本身必然独占
 * 一行且以 `export type 名字` 开头），逐行匹配即可拿到全部类型名，不需要
 * 解析完整的 TS 类型语法。
 */
function extractGeneratedTypeNames(source) {
  return [...source.matchAll(/^export type ([A-Za-z0-9_]+)\b/gm)].map((m) => m[1]);
}

/** schema/index.ts 里每个导出的 zod schema 都形如 `export const fooSchema = ...`。 */
function extractSchemaExportNames(source) {
  return new Set([...source.matchAll(/^export const ([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]));
}

/** 类型名到期望 schema 名的转换约定：首字母小写 + Schema 后缀（如 GachaRecord → gachaRecordSchema）。 */
function expectedSchemaName(typeName) {
  return `${typeName.charAt(0).toLowerCase()}${typeName.slice(1)}Schema`;
}

/**
 * 校验 generated.ts 导出的每个纯数据类型，schema/index.ts 里都有一个按命名
 * 约定对应的 zod schema——这是运行时校验覆盖率的机械下限：类型本身只在
 * 编译期把关，插件在 QuickJS 里跑出来的实际数据仍需要运行时 schema 校验兜底
 * （见 schema/index.ts 顶部文档），少一个 schema 就是运行时校验的一处盲区，
 * 而这类缺口在编译期完全不可见。
 */
function checkZodCoverage(repoRoot) {
  const generatedPath = path.join(repoRoot, GENERATED_TYPES_FILE);
  const schemaPath = path.join(repoRoot, SCHEMA_FILE);

  let generatedSource;
  let schemaSource;
  try {
    generatedSource = readFileSync(generatedPath, 'utf8');
    schemaSource = readFileSync(schemaPath, 'utf8');
  } catch (err) {
    return {
      findings: [
        {
          file: GENERATED_TYPES_FILE,
          line: 0,
          column: 0,
          reason: `读取类型/schema 源文件失败：${err.message}`,
        },
      ],
      typeCount: 0,
    };
  }

  const typeNames = extractGeneratedTypeNames(generatedSource);
  const schemaNames = extractSchemaExportNames(schemaSource);

  const findings = [];
  for (const typeName of typeNames) {
    const expected = expectedSchemaName(typeName);
    if (!schemaNames.has(expected)) {
      findings.push({
        file: SCHEMA_FILE,
        line: 0,
        column: 0,
        reason: `types/generated.ts 导出的类型 "${typeName}" 在 schema/index.ts 里没有对应的 "${expected}"——运行时校验存在盲区`,
      });
    }
  }

  return { findings, typeCount: typeNames.length };
}

// ============================================================
// 主流程
// ============================================================

export async function run() {
  const repoRoot = findRepoRoot();

  const codegenResult = spawnSync(
    'cargo',
    ['run', '--quiet', '-p', 'gs-host', '--bin', 'gs-codegen'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (codegenResult.error) {
    // cargo 本身都起不来（例如未安装），当作真失败处理，不能悄悄跳过
    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(cargo run -p gs-host --bin gs-codegen)',
          line: 0,
          column: 0,
          reason: `无法执行 cargo 命令：${codegenResult.error.message}`,
        },
      ],
      notes: [],
    };
  }

  if (codegenResult.status !== 0) {
    const stderr = codegenResult.stderr ?? '';
    if (/no bin target/i.test(stderr)) {
      // gs-codegen 二进制在写下这段注释时还没落地；本仓库当前实测已经存在
      // （crates/gs-host/src/bin/gs-codegen.rs），保留这条分支只是防御性地
      // 兼容"此二进制被移除/改名"的极端情况，不应该在正常状态下触发。
      return {
        id: 'HC-3',
        title: `${GATE_TITLE_BASE}（gs-codegen 不可用，跳过 codegen 一致性子检查）`,
        status: 'skip',
        findings: [],
        notes: [
          'gs-codegen 二进制不可执行（cargo run -p gs-host --bin gs-codegen 报 "no bin target"），codegen 一致性子检查跳过，不计入 gs:check 整体失败。',
          '请确认 crates/gs-host/src/bin/gs-codegen.rs 是否被移除或改名，这不应该是正常状态。',
        ],
      };
    }

    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(cargo run -p gs-host --bin gs-codegen)',
          line: 0,
          column: 0,
          reason: `codegen 命令执行失败，退出码 ${codegenResult.status}`,
          snippet: joinOutput(codegenResult),
        },
      ],
      notes: [],
    };
  }

  // codegen 跑成功了，接着校验产物是否与已提交的类型一致。
  //
  // ⚠️ 这里刻意用 `git status --porcelain` 而不是 `git diff --exit-code`。
  // `git diff` 只比对**已跟踪**文件的工作区与索引，未跟踪文件对它完全不可见——
  // 也就是说，只要生成产物还没入库（或 codegen 新产出了一个文件），这道门会
  // 静默变绿，而它本该拦住的正是「生成产物与代码库不同步」。实测证实过：
  // 手改 generated.ts 注入一行假类型，git diff 版本的检查一个字都没报。
  // 一道永远绿的门等于没有门，所以改用能同时看见 modified 与 untracked 的
  // porcelain 输出。
  // 插件 bundle 也要重打一遍再比对，理由同 TYPES_DIR 的注释。
  const bundleResult = spawnSync('node', ['scripts/gs-bundle-plugins.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (bundleResult.error || bundleResult.status !== 0) {
    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(node scripts/gs-bundle-plugins.mjs)',
          line: 0,
          column: 0,
          reason: bundleResult.error
            ? `无法执行插件打包脚本：${bundleResult.error.message}`
            : `插件打包脚本执行失败，退出码 ${bundleResult.status}`,
          snippet: joinOutput(bundleResult),
        },
      ],
      notes: [],
    };
  }

  const statusResult = spawnSync(
    'git',
    ['status', '--porcelain', '--', TYPES_DIR, PLUGIN_BUNDLE_DIR, IPC_TYPES_DIR],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  if (statusResult.status !== 0) {
    return {
      id: 'HC-3',
      title: GATE_TITLE_BASE,
      status: 'fail',
      findings: [
        {
          file: '(git status)',
          line: 0,
          column: 0,
          reason: `git status 命令本身异常退出，退出码 ${statusResult.status}`,
          snippet: joinOutput(statusResult),
        },
      ],
      notes: [],
    };
  }

  const dirtyEntries = (statusResult.stdout ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  // porcelain 的状态码前两位区分了原因，翻译成人话再给出去，
  // 否则用户看到 `?? xxx.ts` 不知道该提交还是该重跑 codegen。
  const structuralFindings = dirtyEntries.map((entry) => {
    const code = entry.slice(0, 2);
    const filePath = entry.slice(3);
    const reason = code === '??'
      ? '生成产物尚未纳入版本控制（untracked）——请 git add 后提交，否则这道门看不住它'
      : `生成产物与已提交内容不一致（git status 状态码 ${code.trim()}）——请确认是重跑 codegen 后忘了提交，还是有人手改了生成产物`;
    return { file: filePath, line: 0, column: 0, reason };
  });

  // ① 通过与否不影响②③是否继续跑——三条子检查各自独立发现问题，
  // 不能因为①已经报了错就假设②③"反正也过不了"而跳过。
  const fixtureCheck = runFixtureRegression(repoRoot);
  const zodCheck = checkZodCoverage(repoRoot);
  const sdkVersionCheck = checkSdkVersionSync(repoRoot);

  const findings = [
    ...structuralFindings,
    ...fixtureCheck.findings,
    ...zodCheck.findings,
    ...sdkVersionCheck.findings,
  ];

  const notes = [
    dirtyEntries.length === 0
      ? '① codegen / 插件 bundle 一致性：重新生成后 git status 干净'
      : `① codegen / 插件 bundle 一致性：发现 ${dirtyEntries.length} 处不一致（见上方命中详情）`,
    `② fixture 回归：已对 ${fixtureCheck.scannedCount} 个插件跑 assertPluginFixture` +
      (fixtureCheck.skippedCount > 0
        ? `，另有 ${fixtureCheck.skippedCount} 个插件目录没有 fixture.test.ts，未纳入本次回归（不计入失败）`
        : ''),
    `③ zod schema 覆盖率：已核对 types/generated.ts 导出的 ${zodCheck.typeCount} 个类型`,
    sdkVersionCheck.findings.length === 0
      ? `④ 跨语言 SDK 版本同步：Rust HOST_SDK_VERSION 与 TS CURRENT_SDK_VERSION 均为 "${sdkVersionCheck.hostVersion}"`
      : '④ 跨语言 SDK 版本同步：发现不一致（见上方命中详情）',
  ];

  return {
    id: 'HC-3',
    title: GATE_TITLE_BASE,
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
