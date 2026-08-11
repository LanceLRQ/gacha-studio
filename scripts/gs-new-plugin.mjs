#!/usr/bin/env node
// pnpm gs:new-plugin <game> --paradigm authkey
//
// 插件脚手架：生成一个"开箱能跑通测试的最小可用插件"——带 TODO 注释、带示例
// fixture、带一个必定通过的测试。贡献者从"能跑的东西"开始改，比从空文件
// 开始强得多（插件 SDK 文档 §7.4）。
//
// 模板按范式分档，本 Stage 只有 authkey 一档（templates/plugin/authkey/）。
//
// 生成物分两处：
//   - templates/plugin/<paradigm>/ 下除 fixtures/__game__/ 之外的文件
//     → plugins/<game>/
//   - templates/plugin/<paradigm>/fixtures/__game__/ 的内容
//     → fixtures/<game>/（仓库根目录下，与 plugins/<game>/ 平级——
//       这是本仓库的 fixture 约定，见 plugins/genshin/ 与 fixtures/genshin/）
//
// 所有复制的文件内容里，字面量 "__GAME_ID__" 会被替换成实际游戏 id。
//
// 零新增 npm 依赖，只用 node:fs / node:path。

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from './gs-check/lib/repo-root.mjs';

const SUPPORTED_PARADIGMS = ['authkey'];
const GAME_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const gameId = positional[0];

  let paradigm = 'authkey';
  const paradigmFlagIndex = args.indexOf('--paradigm');
  if (paradigmFlagIndex !== -1) {
    paradigm = args[paradigmFlagIndex + 1];
  }

  return { gameId, paradigm };
}

/** 递归收集目录下所有文件的相对路径（相对 `baseDir`）。 */
function collectFilesRelative(baseDir) {
  const results = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(path.relative(baseDir, full));
      }
    }
  }
  walk(baseDir);
  return results;
}

function replaceGameId(content, gameId) {
  return content.split('__GAME_ID__').join(gameId);
}

function copyTemplateFile(srcFile, destFile, gameId) {
  mkdirSync(path.dirname(destFile), { recursive: true });
  const content = readFileSync(srcFile, 'utf8');
  writeFileSync(destFile, replaceGameId(content, gameId), 'utf8');
}

function main(argv) {
  const { gameId, paradigm } = parseArgs(argv);

  if (!gameId) {
    console.error('用法：pnpm gs:new-plugin <game> --paradigm authkey');
    process.exitCode = 1;
    return;
  }
  if (!GAME_ID_PATTERN.test(gameId)) {
    console.error(`游戏 id "${gameId}" 不合法：只允许小写字母、数字、连字符，且必须以字母开头`);
    process.exitCode = 1;
    return;
  }
  if (!SUPPORTED_PARADIGMS.includes(paradigm)) {
    console.error(`不支持的范式 "${paradigm}"，当前只有 authkey 一档模板（其余范式样本不足，见三次法则）`);
    process.exitCode = 1;
    return;
  }

  const repoRoot = findRepoRoot();
  const templateDir = path.join(repoRoot, 'templates', 'plugin', paradigm);
  if (!existsSync(templateDir)) {
    console.error(`模板目录不存在："${path.relative(repoRoot, templateDir)}"`);
    process.exitCode = 1;
    return;
  }

  const pluginDir = path.join(repoRoot, 'plugins', gameId);
  const fixtureDir = path.join(repoRoot, 'fixtures', gameId);
  if (existsSync(pluginDir)) {
    console.error(`插件目录已存在："plugins/${gameId}"，请换一个游戏 id 或先移除旧目录`);
    process.exitCode = 1;
    return;
  }

  const fixtureTemplatePrefix = path.join('fixtures', '__game__');
  const templateFiles = collectFilesRelative(templateDir);

  const written = [];
  for (const relPath of templateFiles) {
    const srcFile = path.join(templateDir, relPath);
    let destFile;
    if (relPath.startsWith(fixtureTemplatePrefix + path.sep) || relPath === fixtureTemplatePrefix) {
      const tail = relPath.slice(fixtureTemplatePrefix.length + 1);
      destFile = path.join(fixtureDir, tail);
    } else {
      destFile = path.join(pluginDir, relPath);
    }
    copyTemplateFile(srcFile, destFile, gameId);
    written.push(path.relative(repoRoot, destFile));
  }

  console.log(`已生成插件骨架 "${gameId}"（范式：${paradigm}）：`);
  for (const file of written.sort()) {
    console.log(`  ${file}`);
  }
  console.log('');
  console.log('接下来：');
  console.log(`  1. 在 plugins/index.ts 追加一行注册：`);
  console.log(`       () => import("./${gameId}/manifest.ts"),`);
  console.log(`  2. 运行 \`pnpm install\` 让 plugins/${gameId}/package.json 的依赖生效`);
  console.log(`  3. 按 plugins/${gameId}/manifest.ts 与 hooks.ts 里的 TODO 注释接入真实游戏字段`);
  console.log(`  4. 同步更新 fixtures/${gameId}/ 下的样本，让测试反映真实数据形状`);
  console.log(`  5. 运行 \`pnpm --filter ${gameId} test\` 验证 fixture 契约测试通过`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}

export { parseArgs, replaceGameId };
