#!/usr/bin/env node
// REQWORD · Required 前置条件描述文案禁止软化措辞
//
// 起因：`packages/gs-plugin-kit/manifest.ts` 的 `Precondition.describe` 字段
// 文档注释里写着一段真实案例——某异环导出工具硬性要求 16:9 客户端，用户是
// 21:9 带鱼屏，功能直接不可用；限制写在 README 里，但措辞是「建议使用
// 16:9」，代码行为却是硬拒绝，UI 上没有任何提示。用户长期以为是「自动翻页
// 不稳定」，从未想到是分辨率问题——**措辞与行为不一致，比不写更有害**：
// 它排除了正确的排查方向。那条注释末尾写着「后续会加 lint 机械检查本条」，
// 本文件就是兑现这句承诺。
//
// 约束本身：`level: "required"` 的前置条件，其 `describe` 文案不得出现
// 「建议」「推荐」「最好」这类暗示"不满足也无所谓"的软化措辞——因为
// `Required` 的代码语义就是硬拒绝（`crates/gs-core/src/collect.rs` 的
// `PreconditionLevel::Required` doc comment：「不满足就无法采集，必须阻断
// 流程」），措辞如果听起来像"可选"，用户排查方向会被文案本身带偏，重演上面
// 那个真实案例。`Recommended` 级别恰恰相反——它的语义就是"不满足可以继续"，
// 使用「建议/推荐/最好」这类措辞是准确描述，不在本门管辖范围内，见下方
// `collectRequiredDescribeTexts` 的范围过滤。
//
// ## 数据源：为什么读 plugins.manifest.json 而不是正则扫 manifest.ts 源码
//
// `Precondition.describe` 是 `LocalizedText`（`Record<string, string>`），
// 在 manifest.ts 源码里可能写成多行、带插值模板、带尾随逗号等任意 TS 合法
// 形态，正则硬猜字符串边界容易在这类结构上出错（HC-4 文件头注释记录过至少
// 两类"形状像消费、实则不是"的正则陷阱，同理适用于"形状像字符串字面量、
// 实则边界找错"）。`scripts/gs-bundle-plugins.mjs` 已经把每个插件的 manifest
// 打包执行一遍，产出纯数据 JSON（`toPureData` 递归丢弃函数字段，`describe`
// 不是函数，原样保留），实测确认 `crates/gs-plugin-runtime/generated/
// plugins.manifest.json` 里三个插件的 `preconditions[].describe` 字段都在——
// 用已经被 JS 引擎求值过的结构化数据判断"文案内容是什么"，比自己重新解析一遍
// TS 语法可靠得多。manifest.ts 源码只在定位"文件:行号"时才被读取（见下方
// `locateInManifestSource`），不参与"是否违规"这个判断本身。
//
// ⚠️ 新鲜度依赖（如实记录，不是本门自己的盲区）：`plugins.manifest.json` 是
// 提交入库的生成产物，其"是否与当前 manifest.ts 源码一致"由 HC-3
// （`codegen-diff.mjs`）单独把关——那道门会重新执行打包脚本并要求 git status
// 干净。完整跑 `pnpm gs:check` 时 HC-3 排在本门之前，本门读到的 JSON 保证是
// 重新生成过的新鲜数据；但如果只单独跑
// `node scripts/gs-check/checks/precondition-wording.mjs`，且 manifest.ts
// 刚改过 describe 文案还没重新打包，本门看到的是磁盘上上一次打包结果，
// 可能是旧数据——这是本门与 HC-3 的分工边界，不是重复造轮子去自己打包一遍
// （自己打包会往 `crates/gs-plugin-runtime/generated/` 写文件，那个目录不在
// 本次改动的允许范围内，也会与该目录上正在并发进行的其它改动冲突）。
//
// ## 禁用词表：为什么恰好是这三个词，不多不少
//
// 三个词全部来自 `packages/gs-plugin-kit/manifest.ts` 里 `Precondition.
// describe` 字段本身的警告注释——那条注释已经先于本门存在，等于是仓库自己
// 对外承诺过"以后会查这三个词"。近义的软化词（"尽量"「酌情」「如果可能」
// 「最佳」「宜」等）刻意不收录：不是因为它们语义上不够软，而是收录它们意味着
// 本门的检查范围单方面超出了那条注释已经写死的承诺——文档说查三个词，代码却
// 查更多，属于检查表比文档更严的"文档漂移"，与 HC-1~HC-4 反复强调的"文档与
// 实际状态脱节"是同一类问题的镜像版本。真要扩展，应该先去改
// `Precondition.describe` 字段上的那条警告注释，让文档与检查表始终对齐同一个
// 口径，而不是本门自己悄悄加严。
//
// 反过来，"推荐配置"这类看起来含"推荐"二字、但描述的是客观规格分级术语
// （如"最低配置 / 推荐配置"这种成对使用的行业惯用语）的说法，本门**刻意不
// 豁免**——不是没考虑到，是考虑过后否决了这个豁免。理由：`describe` 字段的
// 唯一职责就是回答"这个 Required 前置条件不满足会怎样"，在这个字段里出现
// "推荐配置"，读者的自然理解仍然是"没达到也就是体验打折"，与"不满足就阻断
// 流程"矛盾——这正是本门要拦的那种歧义，不是本门该放过的例外。如果某个插件
// 确实需要用"最低配置 / 推荐配置"这类术语向用户解释硬件规格，那属于
// `remedy`（补救步骤）该表达的内容，不该塞进 `describe`。
//
// ## 字段边界：为什么只查 describe，不查 remedy
//
// `remedy` 是"不满足时的补救步骤"，语义天然就是建议性的行动指引——
// "建议您检查网络连接后重试"这种写法在 `remedy` 里是准确的，因为它建议的是
// "用户接下来该做什么"，不是在暗示"这个前置条件是不是真的必须满足"。两个
// 字段回答的是完全不同的问题，不能用同一条禁用词规则套用，见下方
// `collectRequiredDescribeTexts` 只读 `describe`、不碰 `remedy`。
//
// ## 发现即失败，不是警告
//
// 本仓库全部检查（HC-1~HC-5/SANI/FIXRS/FMT）在命中问题时一律判定为 fail，
// 没有"警告但放行"这个中间态——`renderResult` 依赖的状态集合本来就只有
// pass/fail/skip 三种（见 `lib/report.mjs`）。本门延续这个一致性，而不是
// 自己发明一种新的"软失败"语义：这条约束存在的唯一理由就是防止"文案说建议、
// 代码却硬拒绝"这类落差被 review 漏看，警告可以被忽略，fail 不能——真实案例
// 里那条"建议使用 16:9"的措辞就是写在文档里、没人真去核对代码行为的典型
// 后果，机械门禁如果退化成"发现了但不拦"，等于把同一个失败模式又演一遍。
//
// ## 反例自检
//
// 见下方 `SELF_CHECK_CASES`：分两组——① 词表匹配本身（`scanTextForSoftening
// Words`，命中/不误伤纯字符串层面）；② 范围过滤（`collectRequiredDescribeTexts`
// ，验证"只挑 required 级、只挑 describe 字段"这条边界没有被意外放宽或收窄）。
// 真实扫描与自检共用同一个 `collectRequiredDescribeTexts`/
// `scanTextForSofteningWords`，不是各写一份——避免自检测的是一套逻辑、真正
// 生效的是另一套，两者悄悄漂移。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../lib/repo-root.mjs';
import { renderResult, renderSummary } from '../lib/report.mjs';

const GATE_TITLE = 'REQWORD Required 前置条件描述文案禁止软化措辞';
const PLUGIN_MANIFEST_JSON_REL = 'crates/gs-plugin-runtime/generated/plugins.manifest.json';

/**
 * 禁用词表。每个词的收录理由见文件头注释"禁用词表"一节；三个词均逐字取自
 * `packages/gs-plugin-kit/manifest.ts` 里 `Precondition.describe` 字段自身
 * 的警告注释，不是本门凭空发明的判据。
 */
const FORBIDDEN_SOFTENING_WORDS = [
  {
    word: '建议',
    reason: '"建议"字面意思就是"这不是必须的、听不听由你"，与 Required 语义（不满足就阻断流程）直接矛盾',
  },
  {
    word: '推荐',
    reason: '"推荐"暗示"有更优选项、但不选也能用"，与 Required 语义矛盾',
  },
  {
    word: '最好',
    reason: '"最好"是比较级软化措辞，暗示"退而求其次也可以接受"，与 Required 语义矛盾',
  },
];

/**
 * 在一段文本里查找禁用词的全部出现位置，不去重、不提前 return——同一句话
 * 里出现两次同一个禁用词，两处都要各自定位报告，理由同 HC-1 对 eval(/
 * require( 的处理：每一处命中都是一个独立的、需要人工确认的位置。
 *
 * @param {string} text
 * @returns {Array<{ word: string, index: number, reason: string }>}
 */
function scanTextForSofteningWords(text) {
  const hits = [];
  for (const rule of FORBIDDEN_SOFTENING_WORDS) {
    let idx = text.indexOf(rule.word);
    while (idx !== -1) {
      hits.push({ word: rule.word, index: idx, reason: rule.reason });
      idx = text.indexOf(rule.word, idx + rule.word.length);
    }
  }
  return hits;
}

/**
 * 从一份（已经过 toPureData 丢弃函数字段的）插件 manifest 纯数据对象里，
 * 抽取本门规则实际管辖的 (preconditionId, locale, text) 列表——
 * 即 `level === "required"` 的 `preconditions[].describe` 各 locale 取值。
 *
 * 这个函数本身就是范围边界的唯一定义：
 *   - `level !== "required"`（含 "recommended" 与任何非法/缺失取值）的
 *     前置条件整体跳过——Recommended 级别用软化措辞是准确描述，不是本门
 *     管辖对象；非法取值交给别处的 schema 校验（不在本门重复判断）。
 *   - 只读 `describe`，不读 `remedy`——两个字段回答不同的问题，理由见
 *     文件头注释"字段边界"一节。
 *   - `describe` 的全部 locale key 都会被纳入（不只挑 "zh-CN"）——
 *     禁用词本身是中文，扫描非中文 locale 不会产生额外噪音，反而能兜住
 *     "手滑把中文文案复制进了另一个 locale key"这类意外。
 *
 * 真实扫描与自检共用本函数，见文件头注释"反例自检"一节。
 *
 * @param {unknown} manifest
 * @returns {Array<{ preconditionId: string, locale: string, text: string }>}
 */
function collectRequiredDescribeTexts(manifest) {
  const items = [];
  const preconditions = Array.isArray(manifest?.preconditions) ? manifest.preconditions : [];
  for (const precondition of preconditions) {
    if (!precondition || precondition.level !== 'required') continue;
    const describe = precondition.describe;
    if (!describe || typeof describe !== 'object') continue;
    for (const [locale, text] of Object.entries(describe)) {
      if (typeof text === 'string') {
        items.push({ preconditionId: String(precondition.id ?? '(无 id)'), locale, text });
      }
    }
  }
  return items;
}

/** 把字符偏移量换算成 1-based 的行号与列号（与 HC-1 的同名工具函数逻辑一致，未共享进 lib——两处各自独立、体量小，见 repo 既有惯例）。 */
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

/**
 * 在 `plugins/<pluginId>/manifest.ts` 源码里定位某处违规文案，供报告
 * "文件:行号:列号"。判断"是否违规"完全依赖 plugins.manifest.json（见文件头
 * 注释），这里只是为了给人一个可以直接跳转的位置，找不到时退化为只报文件名
 * （line: 0），不影响本门的通过/失败判定。
 *
 * 定位策略：先按前置条件 `id` 字符串字面量（双引号或单引号）缩小到该前置
 * 条件声明块的起始位置，再从那之后查找违规词本身——先定位 id 是为了避免
 * 违规词恰好在文件别处（另一条前置条件、注释）先出现而定位错行；这是启发式
 * 缩小范围，不是真正的花括号平衡解析，已知局限：如果同一个 id 字符串在文件
 * 里出现了不止一次（比如被注释提到过一次），会用第一次出现的位置。
 *
 * @param {string} repoRoot
 * @param {string} pluginId
 * @param {string} preconditionId
 * @param {string} matchedWord
 */
function locateInManifestSource(repoRoot, pluginId, preconditionId, matchedWord) {
  const relPath = `plugins/${pluginId}/manifest.ts`;
  const absPath = path.join(repoRoot, relPath);
  let source;
  try {
    source = readFileSync(absPath, 'utf8');
  } catch {
    return { file: relPath, line: 0, column: 0 };
  }

  const doubleQuoted = `"${preconditionId}"`;
  const singleQuoted = `'${preconditionId}'`;
  const doubleIdx = source.indexOf(doubleQuoted);
  const blockStart = doubleIdx !== -1 ? doubleIdx : source.indexOf(singleQuoted);
  if (blockStart === -1) {
    return { file: relPath, line: 0, column: 0 };
  }

  const wordIdx = source.indexOf(matchedWord, blockStart);
  const target = wordIdx !== -1 ? wordIdx : blockStart;
  const { line, column } = offsetToLineCol(source, target);
  return { file: relPath, line, column };
}

// ============================================================
// 反例自检：证明①违规文案确实会被抓到，②合规/超出范围的文案不会被误伤。
// 纯函数级断言，不落盘、不起子进程，风格照 scripts/gs-sanitize.self-check.mjs
// 的 cases 数组写法。
// ============================================================

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  期望：${JSON.stringify(expected)}\n  实际：${JSON.stringify(actual)}`);
  }
}

const SELF_CHECK_CASES = [
  // ------------------------------------------------------------
  // ① 词表匹配本身：scanTextForSofteningWords
  // ------------------------------------------------------------
  {
    name: '违规命中：单句含"建议"应被命中',
    run: () => {
      const hits = scanTextForSofteningWords('自动获取抽卡链接建议游戏客户端至少运行过一次');
      expect(
        hits.some((h) => h.word === '建议'),
        '含"建议"的文案应被 scanTextForSofteningWords 命中',
      );
    },
  },
  {
    name: '违规命中：单句含"推荐"应被命中',
    run: () => {
      const hits = scanTextForSofteningWords('推荐在游戏客户端运行过一次后再使用本功能');
      expect(
        hits.some((h) => h.word === '推荐'),
        '含"推荐"的文案应被 scanTextForSofteningWords 命中',
      );
    },
  },
  {
    name: '违规命中：单句含"最好"应被命中',
    run: () => {
      const hits = scanTextForSofteningWords('最好先启动游戏一次再使用本功能');
      expect(
        hits.some((h) => h.word === '最好'),
        '含"最好"的文案应被 scanTextForSofteningWords 命中',
      );
    },
  },
  {
    name: '违规命中：同一句里出现两次同一禁用词，两处都要各自命中，不去重',
    run: () => {
      const hits = scanTextForSofteningWords('建议先启动游戏，之后建议打开一次记录页');
      const jianyiHits = hits.filter((h) => h.word === '建议');
      expectEqual(jianyiHits.length, 2, '同一句里出现两次"建议"应产生两条独立命中，而不是去重成一条');
      expect(jianyiHits[0].index < jianyiHits[1].index, '两条命中的 index 应该是递增的两个不同位置');
    },
  },
  {
    name: '不误伤：不含任何禁用词的合规文案（真实项目当前使用的措辞风格）应零命中',
    run: () => {
      const hits = scanTextForSofteningWords(
        '自动获取抽卡链接要求游戏客户端至少运行过一次，缓存目录才会被创建',
      );
      expectEqual(hits.length, 0, '不含"建议/推荐/最好"的文案不应产生任何命中');
    },
  },
  {
    name: '不误伤：三个禁用词互不误伤彼此——"最好"命中不应连带报出"建议"或"推荐"',
    run: () => {
      const hits = scanTextForSofteningWords('最好先启动游戏一次');
      expectEqual(hits.length, 1, '本句只含"最好"一个禁用词，应恰好命中 1 处');
      expectEqual(hits[0].word, '最好', '命中的应是"最好"本身');
    },
  },

  // ------------------------------------------------------------
  // ② 范围过滤：collectRequiredDescribeTexts
  // ------------------------------------------------------------
  {
    name: '不误伤：level 为 recommended 时，即使 describe 含禁用词也不进入检查范围',
    run: () => {
      const manifest = {
        preconditions: [
          {
            id: 'demo.recommended.example',
            level: 'recommended',
            describe: { 'zh-CN': '建议客户端分辨率为 16:9，体验更佳，但不满足也能继续使用' },
          },
        ],
      };
      const items = collectRequiredDescribeTexts(manifest);
      expectEqual(items.length, 0, 'Recommended 级别的 describe 不应出现在 collectRequiredDescribeTexts 的结果里——软化措辞在这个级别是准确描述');
    },
  },
  {
    name: '违规命中（范围过滤 + 词表匹配串联）：level 为 required 时，describe 含禁用词必须进入检查范围并被命中',
    run: () => {
      const manifest = {
        preconditions: [
          {
            id: 'demo.required.example',
            level: 'required',
            describe: { 'zh-CN': '建议先启动游戏客户端一次' },
          },
        ],
      };
      const items = collectRequiredDescribeTexts(manifest);
      expectEqual(items.length, 1, 'Required 级别的 describe 应该恰好产出 1 条待检查文本');
      const hits = scanTextForSofteningWords(items[0].text);
      expect(hits.length > 0, '串联到词表匹配后应产生命中——这是本门最终会报错的真实路径');
    },
  },
  {
    name: '不误伤：remedy 字段含禁用词不应被扫描，即使同一条前置条件是 required 级别',
    run: () => {
      const manifest = {
        preconditions: [
          {
            id: 'demo.required.remedy-only',
            level: 'required',
            describe: { 'zh-CN': '自动获取要求游戏客户端至少运行过一次' },
            remedy: { 'zh-CN': '建议您先启动游戏并打开一次相关页面，再回到本应用重试' },
          },
        ],
      };
      const items = collectRequiredDescribeTexts(manifest);
      expectEqual(items.length, 1, '应只收 describe 一条，remedy 不计入');
      expectEqual(items[0].text, '自动获取要求游戏客户端至少运行过一次', 'collectRequiredDescribeTexts 不应把 remedy 的文本当成 describe 返回');
      const hits = scanTextForSofteningWords(items[0].text);
      expectEqual(hits.length, 0, 'describe 本身合规，即使同条前置条件的 remedy 含"建议"也不应导致这里报违规');
    },
  },
  {
    name: '边界安全：manifest 没有 preconditions 字段（如 zzz 插件）时返回空数组，不抛异常',
    run: () => {
      const items = collectRequiredDescribeTexts({ id: 'zzz' });
      expectEqual(items.length, 0, '缺失 preconditions 字段应被当作空前置条件处理，不应抛异常也不应产生任何待检查项');
    },
  },
  {
    name: '边界安全：level 为非法/缺失取值时该条前置条件被跳过，不误判为 required',
    run: () => {
      const manifest = {
        preconditions: [
          { id: 'demo.typo-level', level: 'requierd', describe: { 'zh-CN': '建议先启动游戏' } },
          { id: 'demo.no-level', describe: { 'zh-CN': '建议先启动游戏' } },
        ],
      };
      const items = collectRequiredDescribeTexts(manifest);
      expectEqual(items.length, 0, 'level 拼错或缺失的前置条件不应被当作 required 纳入检查——非法取值交给别处的 schema 校验，不在本门重复判断');
    },
  },
  {
    name: '多 locale：同一条 required 前置条件的 describe 有多个 locale 时，每个 locale 都单独纳入检查',
    run: () => {
      const manifest = {
        preconditions: [
          {
            id: 'demo.required.multi-locale',
            level: 'required',
            describe: {
              'zh-CN': '建议先启动游戏客户端一次',
              en: 'Requires the game client to have run at least once',
            },
          },
        ],
      };
      const items = collectRequiredDescribeTexts(manifest);
      expectEqual(items.length, 2, '两个 locale 应各自产出一条待检查文本');
      const zhItem = items.find((i) => i.locale === 'zh-CN');
      const enItem = items.find((i) => i.locale === 'en');
      expect(scanTextForSofteningWords(zhItem.text).length > 0, 'zh-CN 文案含"建议"应被命中');
      expectEqual(scanTextForSofteningWords(enItem.text).length, 0, '英文文案不含中文禁用词，不应产生命中');
    },
  },
];

function runSelfCheckCases() {
  const results = [];
  for (const testCase of SELF_CHECK_CASES) {
    try {
      testCase.run();
      results.push({ name: testCase.name, pass: true });
    } catch (error) {
      results.push({
        name: testCase.name,
        pass: false,
        error: String(error && error.message ? error.message : error),
      });
    }
  }
  return results;
}

// ============================================================
// 真实扫描：plugins.manifest.json 里全部插件的 Required 前置条件
// ============================================================

function scanRealManifests(repoRoot) {
  const manifestRelPath = PLUGIN_MANIFEST_JSON_REL;
  const manifestAbsPath = path.join(repoRoot, manifestRelPath);

  let raw;
  try {
    raw = readFileSync(manifestAbsPath, 'utf8');
  } catch (err) {
    return {
      findings: [
        {
          file: manifestRelPath,
          line: 0,
          column: 0,
          reason:
            `读取插件打包产物失败：${err.message}——本门依赖 scripts/gs-bundle-plugins.mjs 的产物判断 ` +
            '前置条件文案内容，正常情况下该文件已提交入库；若缺失，请先跑 `node scripts/gs-bundle-plugins.mjs` 重新生成',
        },
      ],
      scannedItems: [],
      requiredCount: 0,
    };
  }

  let manifests;
  try {
    manifests = JSON.parse(raw);
  } catch (err) {
    return {
      findings: [{ file: manifestRelPath, line: 0, column: 0, reason: `JSON 解析失败：${err.message}` }],
      scannedItems: [],
      requiredCount: 0,
    };
  }

  const findings = [];
  const scannedItems = [];
  let requiredCount = 0;

  for (const [pluginId, manifest] of Object.entries(manifests)) {
    if (pluginId === '_generatedBy') continue; // 元信息字段，不是插件

    const items = collectRequiredDescribeTexts(manifest);
    // 按 preconditionId 分组，方便汇总"这一条前置条件命中了几处"，而不是把
    // 同一条的多 locale 命中拆散成互不相关的多行摘要。
    const byPrecondition = new Map();
    for (const item of items) {
      if (!byPrecondition.has(item.preconditionId)) byPrecondition.set(item.preconditionId, []);
      byPrecondition.get(item.preconditionId).push(item);
    }

    for (const [preconditionId, localeItems] of byPrecondition) {
      requiredCount += 1;
      let hitCount = 0;
      for (const { locale, text } of localeItems) {
        const hits = scanTextForSofteningWords(text);
        for (const hit of hits) {
          hitCount += 1;
          const location = locateInManifestSource(repoRoot, pluginId, preconditionId, hit.word);
          findings.push({
            file: location.file,
            line: location.line,
            column: location.column,
            reason:
              `插件 "${pluginId}" 的 Required 前置条件 "${preconditionId}"（describe.${locale}）` +
              `命中禁用软化词 "${hit.word}"——${hit.reason}。Required 的代码行为是硬拒绝，文案不能暗示"可选"`,
            snippet: text,
          });
        }
      }
      scannedItems.push(
        `${pluginId} :: ${preconditionId}（locale: ${localeItems.map((i) => i.locale).join(', ')}）` +
          (hitCount > 0 ? ` → 命中 ${hitCount} 处` : ' → 合规'),
      );
    }
  }

  return { findings, scannedItems, requiredCount };
}

export async function run() {
  const repoRoot = findRepoRoot();

  const selfCheckResults = runSelfCheckCases();
  const selfCheckFailures = selfCheckResults.filter((r) => !r.pass);
  const selfCheckFindings = selfCheckFailures.map((r) => ({
    file: '(self-check: precondition-wording.mjs)',
    line: 0,
    column: 0,
    reason: `自检回归："${r.name}" —— ${r.error}`,
  }));

  const realScan = scanRealManifests(repoRoot);

  const findings = [...selfCheckFindings, ...realScan.findings];

  const notes = [
    `已跑 ${selfCheckResults.length} 条反例自检用例（词表匹配 + 范围过滤两组，含"不加会漏/加了会命中/不误伤"）`,
    `数据源：${PLUGIN_MANIFEST_JSON_REL}（新鲜度依赖 HC-3 codegen-diff，见文件头注释）`,
    `已扫描 Required 前置条件 ${realScan.requiredCount} 条：`,
    ...realScan.scannedItems.map((line) => `  - ${line}`),
    '范围边界：只查 preconditions[].describe 且 level === "required"；remedy 字段与 Recommended 级别不在管辖范围内（理由见文件头注释）',
  ];

  return {
    id: 'REQWORD',
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
