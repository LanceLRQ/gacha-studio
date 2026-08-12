#!/usr/bin/env node
// `gs-sanitize.mjs` 的自检脚本。
//
// 起因：AUDIT-2026-08-12-M2鸣潮真实存档实测.md §四——`long-numeric-id` 规则
// 只覆盖 19 位及以上纯数字，完全漏掉了米哈游/库洛的 9 位玩家 UID 与鸣潮
// ServerID 这类 32 位十六进制标识符，合成样本实测「已扫描 1 个文件，命中
// 0 处」，完全放行。这类"门之所以通过是因为它什么都没检查"的失效模式在本
// 项目已出现过三次（HC-3 早期用 git diff --exit-code 恒绿、HC-2 只看
// cargo test 退出码、这次的 gs-sanitize）——补规则本身不够，必须有反例测试
// 固化到自动化里，不能只靠人记得手工跑一次。
//
// 每条新规则要求证明三件事（§4.4 第 2 条）：
//   ① 不加规则会漏——用移除该规则后的子集扫描，命中数应为 0
//   ② 加了规则会命中——用全量规则扫描，命中数 > 0 且替换结果正确
//   ③ 不误伤——构造一份不该被命中的样本，确认全量规则下命中数仍为 0
// 外加幂等性：对同一份内容连续跑两次替换，第二次不应改变结果（函数级 +
// 真实 CLI `--write` 两级验证）。
//
// 风格照 packages/gs-plugin-kit/testkit/self-check.ts：不引入测试框架，
// 写成"跑一个函数、断言抛/不抛"的最简自检列表，用
//   node scripts/gs-sanitize.self-check.mjs
// 直接运行；也被 scripts/gs-check/checks/sanitize-self-check.mjs 引入，
// 接进 `pnpm gs:check` 门禁（见该文件头注释说明为什么单独开一道门）。
//
// 全部样本均为合成数据（一眼可辨的假 UID / 假 hex 串），不含任何真实凭据。

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanText, applyRules, RULES } from './gs-sanitize.mjs';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const SANITIZE_SCRIPT_PATH = path.join(SELF_DIR, 'gs-sanitize.mjs');

function withoutRule(id) {
  const filtered = RULES.filter((r) => r.id !== id);
  if (filtered.length === RULES.length) {
    throw new Error(`withoutRule("${id}")：RULES 里找不到该 id，规则可能已改名`);
  }
  return filtered;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n  期望：${JSON.stringify(expected)}\n  实际：${JSON.stringify(actual)}`);
  }
}

/**
 * 历史快照：uid-field / server-id-hex 首版把取值宽度写死成"恰好 9 位" /
 * "恰好 32 位"，复核指出这就是本次要修的缺口本身换了个数字（有字段名锚定
 * 时，宽度限制不提供额外保护，只会在下一个位数不同的游戏接入时重演同一个
 * "静默漏掉"）。这两个常量只读、仅用于在下面的宽度反例测试里重现"改之前
 * 会漏"的证据，不是当前生效的规则——当前生效的规则定义只在 gs-sanitize.mjs
 * 的 RULES 里维护一份，这里不重复维护第二份。
 *
 * 用函数返回新字面量而不是共享同一个 RegExp 实例：两条都带 `g` 标志，
 * `.test()` 会在实例上累积 `lastIndex`，多个测试用例共用同一个实例会因为
 * 上一次调用残留的 lastIndex 而产生假阴性——每次调用都拿一份新实例更安全，
 * 也不需要在每个调用点手动重置 lastIndex。
 */
const legacyUidExactWidthPattern = () => /(\b(?:uid|player_?id)\b"?\s*[:=]\s*"?)(?<!\d)\d{9}(?!\d)/gi;
const legacyServerIdExactWidthPattern = () => /(\bserver[_-]?id\b"?\s*[:=]\s*"?)[0-9a-fA-F]{32}(?![0-9a-fA-F])/gi;

/**
 * 真实调用 CLI（子进程），而不是直接调用 applyRules——用来验证"命令行
 * `--write` 两次"这个贡献者实际会做的操作序列本身是幂等的，不只是内部函数
 * 组合幂等（两者理论上应该一致，但 main() 里还有一层"sanitized !== text 才
 * writeFileSync"的判断，只有走真实 CLI 才能覆盖到这一层）。
 */
function runSanitizeCli(targetDir, extraArgs = []) {
  const result = spawnSync(process.execPath, [SANITIZE_SCRIPT_PATH, targetDir, ...extraArgs], {
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`执行 gs-sanitize.mjs 子进程失败：${result.error.message}`);
  }
  return result;
}

const cases = [
  // ============================================================
  // uid-field
  // ============================================================
  {
    name: 'uid-field 反例①不加规则会漏：JSON 数字形式 "UID": 123456789',
    run: () => {
      const sample = '{"UID": 123456789, "ServerArea": "cn"}';
      const findings = scanText(sample, withoutRule('uid-field'));
      expectEqual(findings.length, 0, '移除 uid-field 规则后，其余规则集不应命中 9 位数字 UID（这正是修复前的缺口）');
    },
  },
  {
    name: 'uid-field 反例①不加规则会漏：JSON 字符串形式 "uid": "123456789"',
    run: () => {
      const sample = '{"uid": "123456789", "region": "cn_gf01"}';
      const findings = scanText(sample, withoutRule('uid-field'));
      expectEqual(findings.length, 0, '移除 uid-field 规则后不应命中字符串形式的 UID');
    },
  },
  {
    name: 'uid-field 反例①不加规则会漏：TOML 无引号键形式 uid = "123456789"',
    run: () => {
      const sample = '[account]\nuid = "123456789"\nregion = "cn_gf01"\n';
      const findings = scanText(sample, withoutRule('uid-field'));
      expectEqual(findings.length, 0, '移除 uid-field 规则后不应命中 TOML 形式的 UID（fixture 的 meta.toml 正是这个格式）');
    },
  },
  {
    name: 'uid-field 反例②加了规则会命中：三种形态全量规则下均被替换为占位值',
    run: () => {
      const numberForm = '{"UID": 123456789, "ServerArea": "cn"}';
      const stringForm = '{"uid": "123456789", "region": "cn_gf01"}';
      const tomlForm = '[account]\nuid = "123456789"\nregion = "cn_gf01"\n';

      const numberFindings = scanText(numberForm, RULES);
      expect(
        numberFindings.some((f) => f.rule.id === 'uid-field'),
        'JSON 数字形式的 UID 在全量规则下应被 uid-field 命中',
      );
      expectEqual(applyRules(numberForm, RULES), '{"UID": 100000000, "ServerArea": "cn"}', 'JSON 数字形式替换结果不符合预期');

      const stringFindings = scanText(stringForm, RULES);
      expect(
        stringFindings.some((f) => f.rule.id === 'uid-field'),
        'JSON 字符串形式的 UID 在全量规则下应被 uid-field 命中',
      );
      expectEqual(
        applyRules(stringForm, RULES),
        '{"uid": "100000000", "region": "cn_gf01"}',
        'JSON 字符串形式替换结果不符合预期',
      );

      const tomlFindings = scanText(tomlForm, RULES);
      expect(
        tomlFindings.some((f) => f.rule.id === 'uid-field'),
        'TOML 形式的 UID 在全量规则下应被 uid-field 命中',
      );
      expectEqual(
        applyRules(tomlForm, RULES),
        '[account]\nuid = "100000000"\nregion = "cn_gf01"\n',
        'TOML 形式替换结果不符合预期（region 字段不应被误伤）',
      );
    },
  },
  {
    name: 'uid-field 反例③不误伤：ResourceId / Timestamp / 普通 9 位计数字段不应被命中',
    run: () => {
      // 三个字段刻意都不叫 uid/player_id，且都恰好是 9 位数字——用来证明
      // 规则确实按字段名锚定：字段名不在登记表里，不管数值宽度多宽（哪怕
      // 恰好落在 uid 也会命中的位数区间）都不会被误伤。取值宽度放开到
      // `\d{4,}` 之后重跑本用例，结论不变。
      const sample = '{"ResourceId": 123456789, "Timestamp": 987654321, "itemCount": 111222333}';
      const findings = scanText(sample, RULES).filter((f) => f.rule.id === 'uid-field');
      expectEqual(findings.length, 0, '不含 uid/player_id 字段名的数字不应被 uid-field 命中，无论宽度');
      expectEqual(applyRules(sample, RULES), sample, '不应有任何字节被改动');
    },
  },

  // ============================================================
  // uid-field · 宽度反例（复核订正：首版把宽度写死成"恰好 9 位"，与本任务
  // 要修的原始缺口——"long-numeric-id 只认 19 位以上、9 位 UID 静默放行"
  // ——是同一种失效模式，只是换了个数字。下面证明"改之前（恰好 9 位的旧
  // 规则）会漏，改之后（4 位下限、不设上限）会命中"。）
  // ============================================================
  {
    name: 'uid-field 宽度反例：8 位 UID —— 旧的"恰好 9 位"规则会漏，当前规则命中',
    run: () => {
      const sample = '{"uid": 12345678}';
      expect(!legacyUidExactWidthPattern().test(sample), '旧的"恰好 9 位"规则不应命中 8 位 UID（用来证明宽度限制本身就是缺口）');
      const findings = scanText(sample, RULES);
      expect(
        findings.some((f) => f.rule.id === 'uid-field'),
        '当前规则（4 位下限、不设上限）应命中 8 位 UID',
      );
      expectEqual(applyRules(sample, RULES), '{"uid": 100000000}', '8 位 UID 替换结果不符合预期');
    },
  },
  {
    name: 'uid-field 宽度反例：10 位 UID —— 旧的"恰好 9 位"规则会漏，当前规则命中',
    run: () => {
      const sample = '{"uid": 1234567890}';
      expect(!legacyUidExactWidthPattern().test(sample), '旧的"恰好 9 位"规则不应命中 10 位 UID');
      const findings = scanText(sample, RULES);
      expect(
        findings.some((f) => f.rule.id === 'uid-field'),
        '当前规则应命中 10 位 UID',
      );
      expectEqual(applyRules(sample, RULES), '{"uid": 100000000}', '10 位 UID 替换结果不符合预期');
    },
  },
  {
    name: 'uid-field 宽度反例：12 位 UID —— 旧的"恰好 9 位"规则会漏，当前规则命中',
    run: () => {
      const sample = '{"uid": 123456789012}';
      expect(!legacyUidExactWidthPattern().test(sample), '旧的"恰好 9 位"规则不应命中 12 位 UID');
      const findings = scanText(sample, RULES);
      expect(
        findings.some((f) => f.rule.id === 'uid-field'),
        '当前规则应命中 12 位 UID（不设上限）',
      );
      expectEqual(applyRules(sample, RULES), '{"uid": 100000000}', '12 位 UID 替换结果不符合预期');
    },
  },
  {
    name: 'uid-field 宽度反例：带引号的 10 位 player_id —— 旧规则会漏，当前规则命中且引号保留',
    run: () => {
      const sample = '{"player_id": "1234567890"}';
      expect(
        !legacyUidExactWidthPattern().test(sample),
        '旧的"恰好 9 位"规则不应命中带引号的 10 位 player_id',
      );
      const findings = scanText(sample, RULES);
      expect(
        findings.some((f) => f.rule.id === 'uid-field'),
        '当前规则应命中带引号的 10 位 player_id',
      );
      expectEqual(applyRules(sample, RULES), '{"player_id": "100000000"}', '带引号 10 位 player_id 替换结果不符合预期（收尾引号不应被吞掉）');
    },
  },
  {
    name: 'uid-field 下限验证：3 位及以下的数字（哨兵值 0/1 等）不应被命中',
    run: () => {
      const sample = '{"uid": 0, "player_id": 1, "server_id": "abc"}';
      const findings = scanText(sample, RULES).filter((f) => f.rule.id === 'uid-field');
      expectEqual(findings.length, 0, '低于 4 位下限的哨兵值不应被 uid-field 命中');
      expectEqual(applyRules(sample, RULES), sample, '不应有任何字节被改动');
    },
  },

  // ============================================================
  // server-id-hex
  // ============================================================
  {
    name: 'server-id-hex 反例①不加规则会漏：32 位十六进制 ServerID',
    run: () => {
      const sample = '{"ServerID": "0123456789abcdef0123456789abcdef", "ServerArea": "cn"}';
      const findings = scanText(sample, withoutRule('server-id-hex'));
      expectEqual(findings.length, 0, '移除 server-id-hex 规则后，其余规则集不应命中 ServerID（这正是修复前的缺口）');
    },
  },
  {
    name: 'server-id-hex 反例②加了规则会命中：全量规则下被替换为占位值',
    run: () => {
      const sample = '{"ServerID": "0123456789abcdef0123456789abcdef", "ServerArea": "cn"}';
      const findings = scanText(sample, RULES);
      expect(
        findings.some((f) => f.rule.id === 'server-id-hex'),
        'ServerID 在全量规则下应被 server-id-hex 命中',
      );
      expectEqual(
        applyRules(sample, RULES),
        '{"ServerID": "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0", "ServerArea": "cn"}',
        'ServerID 替换结果不符合预期（ServerArea 不应被误伤）',
      );
    },
  },
  {
    name: 'server-id-hex 反例③不误伤：CardPoolId 同为十六进制但字段名不同，不应被命中',
    run: () => {
      // CardPoolId 是跨账号共享的卡池标识（AUDIT §2.2：全库非空取值去重后
      // 只有 1 个），不是账号级敏感信息，这条规则设计上刻意不覆盖它。取值
      // 宽度放开到 {16,} 之后重跑本用例，结论不变——字段名锚定与宽度无关。
      const sample = '{"CardPoolId": "c9fbcd24b02d54c175875b81513cfacc"}';
      const findings = scanText(sample, RULES).filter((f) => f.rule.id === 'server-id-hex');
      expectEqual(findings.length, 0, 'CardPoolId 不应被 server-id-hex 命中——字段名锚定就是为了排除它，无论宽度');
      expectEqual(applyRules(sample, RULES), sample, '不应有任何字节被改动');
    },
  },

  // ============================================================
  // server-id-hex · 宽度反例（复核订正，理由同 uid-field 一节）
  // ============================================================
  {
    name: 'server-id-hex 宽度反例：40 位十六进制 ServerID —— 旧的"恰好 32 位"规则会漏，当前规则命中',
    run: () => {
      const hex40 = 'deadbeef'.repeat(5); // 8 * 5 = 40 位，明显可辨的合成 hex 串，非真实数据
      const sample = `{"ServerID": "${hex40}"}`;
      expect(!legacyServerIdExactWidthPattern().test(sample), '旧的"恰好 32 位"规则不应命中 40 位 ServerID');
      const findings = scanText(sample, RULES);
      expect(
        findings.some((f) => f.rule.id === 'server-id-hex'),
        '当前规则（16 位下限、不设上限）应命中 40 位 ServerID',
      );
      expectEqual(
        applyRules(sample, RULES),
        '{"ServerID": "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"}',
        '40 位 ServerID 替换结果不符合预期',
      );
    },
  },
  {
    name: 'server-id-hex 宽度反例：64 位十六进制 ServerID —— 旧的"恰好 32 位"规则会漏，当前规则命中',
    run: () => {
      const hex64 = 'deadbeef'.repeat(8); // 8 * 8 = 64 位
      const sample = `{"ServerID": "${hex64}"}`;
      expect(!legacyServerIdExactWidthPattern().test(sample), '旧的"恰好 32 位"规则不应命中 64 位 ServerID');
      const findings = scanText(sample, RULES);
      expect(
        findings.some((f) => f.rule.id === 'server-id-hex'),
        '当前规则应命中 64 位 ServerID（不设上限）',
      );
      expectEqual(
        applyRules(sample, RULES),
        '{"ServerID": "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"}',
        '64 位 ServerID 替换结果不符合预期',
      );
    },
  },
  {
    name: 'server-id-hex 下限验证：15 位十六进制值（低于下限）不应被命中',
    run: () => {
      const sample = '{"ServerID": "deadbeefdeadbee"}'; // 15 位
      const findings = scanText(sample, RULES).filter((f) => f.rule.id === 'server-id-hex');
      expectEqual(findings.length, 0, '低于 16 位下限的十六进制值不应被 server-id-hex 命中');
      expectEqual(applyRules(sample, RULES), sample, '不应有任何字节被改动');
    },
  },

  // ============================================================
  // 复现审计文档记录的原始缺口（回归证据）
  // ============================================================
  {
    name: '回归证据：不含两条新规则时，完整鸣潮结构样本命中数为 0（复现 AUDIT §4.2 的原始现象）',
    run: () => {
      const wuwaShapedSample = JSON.stringify({
        UID: 123456789,
        ServerID: '0123456789abcdef0123456789abcdef',
        ServerArea: 'cn',
        GachaPoolData: [
          {
            PoolType: 1,
            Data: [
              {
                CardPoolType: '角色精准调谐',
                CardPoolId: 'c9fbcd24b02d54c175875b81513cfacc',
                ResourceId: 1102,
                QualityLevel: 3,
                ResourceType: '武器',
                Name: 'FAKE_WEAPON_NAME',
                Count: 1,
                Time: '2024-06-06T10:23:48',
              },
            ],
          },
        ],
      });
      const legacyRules = RULES.filter((r) => r.id !== 'uid-field' && r.id !== 'server-id-hex');
      const legacyFindings = scanText(wuwaShapedSample, legacyRules);
      expectEqual(legacyFindings.length, 0, '不含两条新规则时应完全放行（复现审计文档记录的假阴性）');

      const currentFindings = scanText(wuwaShapedSample, RULES);
      expect(currentFindings.length >= 2, `修复后应至少命中 UID 与 ServerID 两处，实际命中 ${currentFindings.length} 处`);
    },
  },

  // ============================================================
  // 幂等性
  // ============================================================
  {
    name: '幂等性：宽度放开后，占位值自身仍落在新宽度区间内，重复匹配但替换为自身，字节不变',
    run: () => {
      // 宽度从"恰好 9 位"/"恰好 32 位"放开到"4 位及以上"/"16 位及以上"后，
      // 占位值本身（UID 占位值 100000000 是 9 位、ServerID 占位值是 32 位
      // 十六进制）仍然落在新的宽度区间内，会被规则重新匹配——这是预期行为，
      // 不是回归：dry-run 会持续报告"命中"（与 access-token/authorization-
      // header/cookie 三条规则记录的噪音同类），但 --write 替换的结果就是
      // 占位值本身，字节不变。
      const uidPlaceholderSample = '{"UID": 100000000}';
      const uidFindings = scanText(uidPlaceholderSample, RULES).filter((f) => f.rule.id === 'uid-field');
      expect(uidFindings.length > 0, '占位值本身（9 位）在宽度放开后应仍被 uid-field 规则匹配到（预期噪音，非回归）');
      expectEqual(applyRules(uidPlaceholderSample, RULES), uidPlaceholderSample, 'UID 占位值应被替换为自身，字节不变');

      const serverIdPlaceholderSample = '{"ServerID": "a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0"}';
      const serverIdFindings = scanText(serverIdPlaceholderSample, RULES).filter((f) => f.rule.id === 'server-id-hex');
      expect(
        serverIdFindings.length > 0,
        '占位值本身（32 位 hex）在宽度放开后应仍被 server-id-hex 规则匹配到（预期噪音，非回归）',
      );
      expectEqual(
        applyRules(serverIdPlaceholderSample, RULES),
        serverIdPlaceholderSample,
        'ServerID 占位值应被替换为自身，字节不变',
      );
    },
  },
  {
    name: '幂等性（函数级）：对同一样本连续 applyRules 两次，结果与只跑一次相同',
    run: () => {
      const sample = JSON.stringify({
        UID: 123456789,
        ServerID: '0123456789abcdef0123456789abcdef',
        authkey: 'REAL_LOOKING_AUTHKEY_VALUE',
      });
      const once = applyRules(sample, RULES);
      const twice = applyRules(once, RULES);
      expectEqual(twice, once, '第二次 applyRules 不应再改变内容');
      expect(once !== sample, '第一次 applyRules 应当确实改动了内容（否则这个断言是空的）');
    },
  },
  {
    name: '幂等性（CLI 级）：对同一目录连续跑两次 `node gs-sanitize.mjs --write`，第二次不改变文件内容',
    run: () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'gs-sanitize-self-check-'));
      try {
        const filePath = path.join(tmpDir, 'sample.json');
        const original = JSON.stringify(
          {
            UID: 123456789,
            ServerID: '0123456789abcdef0123456789abcdef',
          },
          null,
          2,
        );
        writeFileSync(filePath, original, 'utf8');

        const firstRun = runSanitizeCli(tmpDir, ['--write']);
        const afterFirst = readFileSync(filePath, 'utf8');
        expect(afterFirst !== original, '第一次 --write 应当确实改动了文件内容（否则这个幂等性断言是空的）');
        expect(/命中 [1-9]/.test(firstRun.stdout), `第一次运行应报告命中数 > 0，实际输出：\n${firstRun.stdout}`);

        const secondRun = runSanitizeCli(tmpDir, ['--write']);
        const afterSecond = readFileSync(filePath, 'utf8');
        expectEqual(afterSecond, afterFirst, '第二次 --write 不应再改变文件内容');
        void secondRun;
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  },

  // ============================================================
  // 既有规则回归哨兵（防止本次改动意外破坏 scanText/applyRules 的签名兼容性）
  // ============================================================
  {
    name: '回归哨兵：既有 authkey 规则在默认参数（不传 rules）下仍正常工作',
    run: () => {
      const sample = 'https://example.invalid/api?authkey=REAL_LOOKING_VALUE&authkey_ver=1';
      const findings = scanText(sample);
      expect(
        findings.some((f) => f.rule.id === 'authkey'),
        'scanText 默认参数应仍能命中既有的 authkey 规则',
      );
      expectEqual(
        applyRules(sample),
        'https://example.invalid/api?authkey=FAKE_AUTHKEY_FOR_FIXTURE_ONLY&authkey_ver=1',
        'applyRules 默认参数下既有规则的替换结果不应变化',
      );
    },
  },
];

async function runCases() {
  const results = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      results.push({ name: testCase.name, pass: true });
    } catch (error) {
      results.push({ name: testCase.name, pass: false, error: String(error && error.message ? error.message : error) });
    }
  }
  return results;
}

export { runCases };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runCases();
  let failed = 0;
  for (const result of results) {
    if (result.pass) {
      console.log(`  通过  ${result.name}`);
    } else {
      failed += 1;
      console.error(`  失败  ${result.name}`);
      console.error(`        ${result.error}`);
    }
  }
  console.log(`\ngs-sanitize 自检：${results.length - failed}/${results.length} 通过`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}
