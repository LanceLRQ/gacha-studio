/**
 * 鸣潮插件 `hooks.deriveRecordKeys` 的单元测试。
 *
 * ⚠️ 只测这一个 hook，不是完整的 fixture 契约测试（`fixture.test.ts`，参照
 * `plugins/genshin/fixture.test.ts`）——前四个用例手写字面量记录，直接测
 * `deriveRecordKeys` 本身，不依赖 `fixtures/wuwa/` 下的样本数据。
 *
 * 覆盖点对应 `./hooks.ts` 文件头文档的两个设计难点，外加三条基础性质：
 * 1. 时间线格式无关（字面量版）——同一批记录，`time` 分别用 ISO 与斜杠两种
 *    线格式书写同一时刻，产出的 key 数组必须逐项相同。
 * 2. 数组方向无关——同一批记录整体反转顺序，每条记录算出的 key 不应改变。
 * 3. 无法识别的时间格式必须报错，不能静默通过。
 * 4. 同一时间戳分组内的记录，key 必须互不相同（否则批次内序位没有生效）。
 * 5. 时间线格式无关（真实样本版）——用例 1 是手写的 3 条记录，本用例改用
 *    `fixtures/wuwa/raw_response/pool_1.json` 与 `pool_1_slash_time.json`
 *    这两份真实脱敏样本（17 条，含 5 连碰撞组与十连组）**分别独立调用一次**
 *    `deriveRecordKeys`，比较两次调用各自的输出。之所以必须放在本文件而不是
 *    `fixture.test.ts`：`assertPluginFixture` 会把 `raw_response/` 下全部
 *    样本文件拼成同一批数组后只调用一次 `deriveRecordKeys`，`pool_1.json`
 *    与 `pool_1_slash_time.json` 混在同一批里会互相干扰彼此的批次内序位计数，
 *    测不出"时间线格式无关"这条不变量（详见 `fixture.test.ts` 文件头的
 *    「已知偏差 2」）——本用例用两次隔离调用才是这条不变量的真正验证。
 *
 * 运行方式：
 *   node --experimental-strip-types plugins/wuwa/hooks.test.ts
 */
import { hooks, manifest } from "./manifest.ts";
import { nodeFixtureReader } from "gs-plugin-kit/testkit/node";
import type { UnifiedRecordFields } from "gs-plugin-kit";

declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
declare const process: { exitCode?: number };

const deriveRecordKeys = hooks.deriveRecordKeys;
if (!deriveRecordKeys) {
  throw new Error("鸣潮 hooks.deriveRecordKeys 未声明，测试无法进行");
}

/** 补齐 UnifiedRecordFields 的必填字段，测试里只关心 itemId/time/bannerId。 */
function record(fields: { itemId: string; time: string; bannerId?: string }): UnifiedRecordFields {
  return { bannerId: "1", count: 1, ...fields };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// ============================================================
// 用例 5 的真实样本数据：提前读取 + 跑 extractList/extractRecord，
// 两份文件各自独立处理成一份 UnifiedRecordFields[]，互不掺杂。
// ============================================================

const { extractList } = manifest.collect.params;
const { extractRecord } = manifest.fields;

async function loadFixtureRecords(relativePath: string): Promise<UnifiedRecordFields[]> {
  const rawText = await nodeFixtureReader.readText(relativePath);
  const response: unknown = JSON.parse(rawText);
  return extractList(response).map((raw) => extractRecord(raw));
}

const pool1Records = await loadFixtureRecords("fixtures/wuwa/raw_response/pool_1.json");
const pool1SlashTimeRecords = await loadFixtureRecords("fixtures/wuwa/variants/pool_1_slash_time.json");

interface TestCase {
  name: string;
  run: () => void;
}

const cases: TestCase[] = [
  {
    name: "线格式无关：ISO 与斜杠两种写法产出相同的 key 数组",
    run: () => {
      // 模拟一次十连中的两条同秒记录 + 一条稍晚的单抽，覆盖"同批次内序位"
      // 与"跨秒不冲突"两种情形。
      const iso: UnifiedRecordFields[] = [
        record({ itemId: "1101", time: "2024-06-06T10:23:48" }),
        record({ itemId: "1102", time: "2024-06-06T10:23:48" }),
        record({ itemId: "1103", time: "2024-06-06T10:23:50" }),
      ];
      const slash: UnifiedRecordFields[] = [
        record({ itemId: "1101", time: "2024/06/06 10:23:48" }),
        record({ itemId: "1102", time: "2024/06/06 10:23:48" }),
        record({ itemId: "1103", time: "2024/06/06 10:23:50" }),
      ];
      const isoKeys = deriveRecordKeys(iso);
      const slashKeys = deriveRecordKeys(slash);
      if (!arraysEqual(isoKeys, slashKeys)) {
        throw new Error(`两种线格式产出的 key 不一致：ISO=${JSON.stringify(isoKeys)} 斜杠=${JSON.stringify(slashKeys)}`);
      }
    },
  },
  {
    name: "方向无关：整批反转数组顺序，每条记录的 key 不变",
    run: () => {
      const ascending: UnifiedRecordFields[] = [
        record({ itemId: "2001", time: "2024-06-06T10:00:00" }),
        record({ itemId: "2002", time: "2024-06-06T10:00:05" }),
        record({ itemId: "2003", time: "2024-06-06T10:00:05" }),
        record({ itemId: "2004", time: "2024-06-06T10:00:10" }),
      ];
      const descending = [...ascending].reverse();

      const ascendingKeys = deriveRecordKeys(ascending);
      const descendingKeys = deriveRecordKeys(descending);

      // descendingKeys[i] 对应 ascending 数组里下标 (n-1-i) 的那条记录，
      // 反转回来后应当与 ascendingKeys 逐项相同。
      const realigned = [...descendingKeys].reverse();
      if (!arraysEqual(realigned, ascendingKeys)) {
        throw new Error(
          `反转数组后 key 未对齐：正序=${JSON.stringify(ascendingKeys)} 倒序还原后=${JSON.stringify(realigned)}`,
        );
      }
    },
  },
  {
    name: "无法识别的时间格式必须报错，不能静默通过",
    run: () => {
      let threw = false;
      try {
        deriveRecordKeys([record({ itemId: "9999", time: "not-a-time" })]);
      } catch {
        threw = true;
      }
      if (!threw) {
        throw new Error("期望 deriveRecordKeys 对无法识别的时间格式抛错，但没有抛出");
      }
    },
  },
  {
    name: "同一时间戳分组内，key 按批次内序位互不相同",
    run: () => {
      const records: UnifiedRecordFields[] = [
        record({ itemId: "3001", time: "2024-06-06T10:00:00" }),
        record({ itemId: "3002", time: "2024-06-06T10:00:00" }),
      ];
      const keys = deriveRecordKeys(records);
      if (keys[0] === keys[1]) {
        throw new Error(`同一时间戳分组内两条不同记录算出了相同的 key："${keys[0]}"`);
      }
    },
  },
  {
    name: "线格式无关（真实样本）：pool_1.json 与 pool_1_slash_time.json 独立调用产出相同 key 数组",
    run: () => {
      // 先确认两份样本本身对齐（同为 17 条），否则下面的比较哪怕通过也没有
      // 意义——fixture 被意外截断成两个空数组时，arraysEqual([], []) 会
      // 悄悄放行，因此长度检查必须在比较 key 之前单独做。
      if (pool1Records.length === 0 || pool1Records.length !== pool1SlashTimeRecords.length) {
        throw new Error(
          `样本记录数不对齐：pool_1.json=${pool1Records.length} 条，` +
            `pool_1_slash_time.json=${pool1SlashTimeRecords.length} 条`,
        );
      }
      // 两次独立调用（不合批）——这是与 fixture.test.ts 里"合批快照"不同的
      // 地方，也是这条不变量唯一能被正确验证的方式，见文件头注释用例 5。
      const isoKeys = deriveRecordKeys(pool1Records);
      const slashKeys = deriveRecordKeys(pool1SlashTimeRecords);
      if (!arraysEqual(isoKeys, slashKeys)) {
        throw new Error(
          `真实样本两种线格式独立调用产出的 key 不一致：\nISO=${JSON.stringify(isoKeys)}\n斜杠=${JSON.stringify(slashKeys)}`,
        );
      }
    },
  },
];

let failed = 0;
for (const testCase of cases) {
  try {
    testCase.run();
    console.log(`  通过  ${testCase.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  失败  ${testCase.name}`);
    console.error(`        ${String(error)}`);
  }
}
console.log(`\n鸣潮 hooks.deriveRecordKeys 单元测试：${cases.length - failed}/${cases.length} 通过`);
if (failed > 0) {
  process.exitCode = 1;
}
