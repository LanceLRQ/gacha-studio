/**
 * 鸣潮插件 `hooks.deriveRecordKeys` 的单元测试。
 *
 * ⚠️ 只测这一个 hook，不是完整的 fixture 契约测试（`fixture.test.ts`，参照
 * `plugins/genshin/fixture.test.ts`）——前四个用例手写字面量记录，直接测
 * `deriveRecordKeys` 本身，不依赖 `fixtures/wuwa/` 下的样本数据。
 *
 * 覆盖点对应 `./hooks.ts` 文件头文档的两个设计难点，外加六条基础/回归性质：
 * 1. 时间线格式无关（字面量版）——同一批记录，`time` 分别用 ISO 与斜杠两种
 *    线格式书写同一时刻，产出的 key 数组必须逐项相同。
 * 2. 数组方向无关——同一批记录整体反转顺序，每条记录算出的 key 不应改变。
 * 3. 无法识别的时间格式必须报错，不能静默通过。
 * 4. 同一时间戳分组内的记录，key 必须互不相同（否则批次内序位没有生效）。
 * 5. 时间线格式无关（真实样本版）——用例 1 是手写的 3 条记录，本用例改用
 *    `fixtures/wuwa/raw_response/1_page_1.json` 与
 *    `fixtures/wuwa/variants/pool_1_slash_time.json`
 *    这两份真实脱敏样本（17 条，含 5 连碰撞组与十连组）**分别独立调用一次**
 *    `deriveRecordKeys`，比较两次调用各自的输出。之所以必须放在本文件而不是
 *    `fixture.test.ts`：`pool_1_slash_time.json` 与 `1_page_1.json` 是同一个
 *    卡池（PoolType=1）的同一批记录，若放进 `raw_response/` 让
 *    `assertPluginFixture` 一起处理，会被当成卡池 1 的另一页与
 *    `1_page_1.json` 合并调用同一次 `deriveRecordKeys`，混在同一批里会互相
 *    干扰彼此的批次内序位计数，测不出"时间线格式无关"这条不变量（详见
 *    `fixtures/wuwa/meta.toml` 里 `variants/pool_1_slash_time.json` 样本条目
 *    的说明）——本用例用两次隔离调用才是这条不变量的真正验证，因此该文件
 *    继续放在 `variants/`，不参与 `assertPluginFixture` 的文件名约定。
 * 6. ★ 增长稳定性（pool1 真实样本）——早先一次采集算出的 key，必须与后来一次
 *    包含它的更大采集里对应记录的 key 完全相同。鸣潮是整池全量拉取
 *    （`stopCondition: singleRequest`），"早先的采集" = 完整记录数组的一个
 *    后缀（数组倒序、越老的记录越靠后）。用真实样本里现算出的碰撞组/十连组
 *    位置定位关键切点，不硬编码下标。
 * 7. ★ 增长稳定性（pool10 真实样本）——整批记录同秒但物品互不相同、组内没有
 *    任何"逐字段完全相同"的重复子组时，用例 6/8 里"允许组内互换"的例外不
 *    成立，任意切点下都必须逐位严格相等，作为用例 8 的干净对照组。
 * 8. ★ 增长稳定性退化场景（pool1 真实的十连组）——整批记录恰好共享同一秒
 *    时间戳时，`hooks.ts` 比较首尾判断方向的逻辑判不出方向（首 == 尾），这
 *    正是历史 bug 的真实触发条件。
 *
 * 用例 6/7/8 常驻化的是 `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §1.9 记载的
 * "增长稳定性"回归：`deriveRecordKeys` 第一版的分组键漏了 `itemId`，在 3371
 * 条真实记录上产出 20 处增长稳定性违例——**这是历史上唯一真正伤到用户的那类
 * bug**（整池全量拉取下，后一次采集记录变多，让方向判定从"判不出"翻转成
 * "判得出"，早先那批记录的序位整体反转、key 全变，被当成新记录重复入库）。
 * 但那次回归验证是审计当时"一次性"跑的，3371 条数据不在仓库里，且 §1.9 明确
 * 写了"这个 bug 没有被任何单元测试抓到"——用例 1-5 在 bug 存在时全部通过，
 * 它们守的是"表示无关性"（线格式/方向/序位互异），没有一条守"增长稳定性"
 * 本身。用例 6/7/8 用两份 17/6 条的脱敏样本里天然存在的"十连组"（同秒多条、
 * 物品各异）与"碰撞组"（同秒同物品）结构，把这条回归缩小到能常驻跑的规模。
 *
 * 用例 8 额外验证了一层容忍边界：即使是修复后的实现，若"早先的采集"恰好整批
 * 共享同一秒时间戳（十连组本身就是这种情形），组内彼此逐字段完全相同、连
 * "谁在前谁在后"都无意义的记录之间允许互换 key（AUDIT §1.9 对修复后残留的
 * 2 处"方向违例"给出的结论：记录本身不可区分，key 多重集不变，去重结果完全
 * 等价）——但互换不能跑出组外，也不能是集合本身变了。用例 8 把这条边界当成
 * 显式断言，而不是放过一切不一致。
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

const pool1Records = await loadFixtureRecords("fixtures/wuwa/raw_response/1_page_1.json");
const pool1SlashTimeRecords = await loadFixtureRecords("fixtures/wuwa/variants/pool_1_slash_time.json");
// 用例 7/8：pool10（6 条，PoolType=10，整批同一秒时间戳、resourceId 互不相同）
// 是"整批同时间戳"退化场景的干净对照组，见 fixtures/wuwa/meta.toml 该样本条目。
const pool10Records = await loadFixtureRecords("fixtures/wuwa/raw_response/10_page_1.json");

// ============================================================
// 用例 6/7/8 共用：从真实样本里现算"十连组""碰撞组"的位置，不硬编码下标
// （样本换一批，这些位置会变，写死下标会悄悄测不到东西——任务要求见
// docs/_internal/audit/AUDIT-2026-08-12-M2鸣潮真实存档实测.md §1.9 的教训）。
// ============================================================

/** 只在给定下标子集内、按 keyFn 分组，返回 Map<key, 下标数组>。 */
function groupIndicesWithin(
  records: UnifiedRecordFields[],
  indices: number[],
  keyFn: (entry: UnifiedRecordFields) => string,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const index of indices) {
    const entry = records[index];
    if (entry === undefined) {
      throw new Error(`groupIndicesWithin 内部错误：下标 ${index} 处的记录缺失`);
    }
    const key = keyFn(entry);
    const bucket = groups.get(key);
    if (bucket) bucket.push(index);
    else groups.set(key, [index]);
  }
  return groups;
}

/** 对整个数组分组（"子集限定为全部下标"的特例，用于在最外层找"十连组""碰撞组"）。 */
function groupIndicesBy(records: UnifiedRecordFields[], keyFn: (entry: UnifiedRecordFields) => string): Map<string, number[]> {
  const allIndices = records.map((_, index) => index);
  return groupIndicesWithin(records, allIndices, keyFn);
}

/** 分组结果里成员数最多的那一组："十连组" = 最大同秒桶，"碰撞组" = 最大同秒同物品组。 */
function largestGroup(groups: Map<string, number[]>): number[] {
  let largest: number[] = [];
  for (const indices of groups.values()) {
    if (indices.length > largest.length) largest = indices;
  }
  return largest;
}

/**
 * 断言 records.slice(k) 算出的 key，逐位对应 records 完整数组里下标 k+i 处的
 * key——这就是"增长稳定性"的形式化定义（见文件头用例 6 说明）。失败时打印
 * 切点、下标、两边的 key 值，能直接定位，不只是"不相等"。
 *
 * 写成箭头函数表达式（而不是 `function` 声明）：`deriveRecordKeys` 是顶层
 * `if (!deriveRecordKeys) throw` 判空后的 const，TS 的控制流窄化不会跨越
 * 被提升（hoisted）的 `function` 声明边界，写成箭头函数表达式才能保留窄化后
 * 的非空类型，不需要再引入非空断言。
 */
const assertSliceMatchesSuffix = (records: UnifiedRecordFields[], fullKeys: string[], k: number, label: string): void => {
  const sliceKeys = deriveRecordKeys(records.slice(k));
  for (let i = 0; i < sliceKeys.length; i += 1) {
    const originalIndex = k + i;
    if (sliceKeys[i] !== fullKeys[originalIndex]) {
      throw new Error(
        `${label} 增长稳定性违例：切点 k=${k}，子数组下标 ${i}（对应完整数组下标 ${originalIndex}）` +
          ` key 不一致：早先采集算出 "${sliceKeys[i]}"，完整采集算出 "${fullKeys[originalIndex]}"`,
      );
    }
  }
};

// 十连组 = pool1Records 里最大的同秒桶（不区分物品）。
const pool1TimeBuckets = groupIndicesBy(pool1Records, (entry) => entry.time);
const tenPullGroup = largestGroup(pool1TimeBuckets);
if (tenPullGroup.length < 2) {
  throw new Error("样本结构假设不成立：pool1Records 里找不到同秒多条的十连组，增长稳定性用例 6/8 测不了关键切点");
}
const tenPullStart = Math.min(...tenPullGroup);
const tenPullMaxIndex = Math.max(...tenPullGroup);

// 碰撞组 = pool1Records 里最大的同秒同物品组。
const pool1CollisionGroups = groupIndicesBy(pool1Records, (entry) => `${entry.time}|${entry.itemId}`);
const biggestCollisionGroup = largestGroup(pool1CollisionGroups);
if (biggestCollisionGroup.length < 2) {
  throw new Error("样本结构假设不成立：pool1Records 里找不到同秒同物品的碰撞组，增长稳定性用例 6 测不了关键切点");
}
// 把最大碰撞组从中间断开——切点只依赖"组内第几个成员"，不依赖具体下标数值。
const collisionSplitK = biggestCollisionGroup[Math.floor(biggestCollisionGroup.length / 2)];
if (collisionSplitK === undefined) {
  throw new Error("样本结构假设不成立：biggestCollisionGroup 为空，算不出碰撞组内部切点");
}

// 十连组内部，按"同秒同物品"再分一次组：成员数 >= 2 的，是彼此逐字段完全
// 相同、连"谁在前谁在后"都无意义的记录（对应 hooks.ts 分组键 (bannerId,
// normalizedTime, itemId) 的定义）。当"早先的采集"恰好整批只剩这一秒时间戳
// 时，这类子组内部的相对顺序判不出来，key 允许在组内互换（用例 8 单独验证
// 这条边界），但这不意味着"随便怎样都行"——组外、或者集合本身变化，都不在
// 容忍范围内。
const duplicateSubgroupsInTenPull = [...groupIndicesWithin(pool1Records, tenPullGroup, (entry) => `${entry.time}|${entry.itemId}`).values()].filter(
  (group) => group.length > 1,
);
// 只要切点 k 落在 [tenPullStart, tenPullAmbiguousEnd] 闭区间内，就会把至少
// 一个重复子组整批留在"早先的采集"里，触发上面说的方向判不出来的歧义——
// 这个区间之外的切点不存在这层歧义，用例 6 可以对它们要求逐位严格相等。
const tenPullAmbiguousEnd =
  duplicateSubgroupsInTenPull.length > 0 ? Math.max(...duplicateSubgroupsInTenPull.map((group) => Math.min(...group))) : tenPullStart - 1;
// 歧义区间之外、离十连组最近的一个安全切点——用它覆盖"k 落在十连组内部"这
// 条要求（十连组本身就是同秒批次，任何切点都触碰得到方向判定逻辑）。
const tenPullSafeInternalSplit = tenPullAmbiguousEnd + 1;
if (tenPullSafeInternalSplit > tenPullMaxIndex) {
  throw new Error(
    "样本结构假设不成立：十连组内部找不到绕开歧义区间的安全切点（歧义区间吞掉了整个十连组），" +
      "需要用例 8 的容忍逻辑单独覆盖，用例 6 无法再测'十连组内部'这一类切点",
  );
}

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
    name: "线格式无关（真实样本）：1_page_1.json 与 pool_1_slash_time.json 独立调用产出相同 key 数组",
    run: () => {
      // 先确认两份样本本身对齐（同为 17 条），否则下面的比较哪怕通过也没有
      // 意义——fixture 被意外截断成两个空数组时，arraysEqual([], []) 会
      // 悄悄放行，因此长度检查必须在比较 key 之前单独做。
      if (pool1Records.length === 0 || pool1Records.length !== pool1SlashTimeRecords.length) {
        throw new Error(
          `样本记录数不对齐：1_page_1.json=${pool1Records.length} 条，` +
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
  {
    name: "增长稳定性（pool1 真实样本）：早先的后缀切片与完整数组对应位置 key 逐位一致，覆盖碰撞组内部/十连组内部/k=0/k=n-1",
    run: () => {
      const total = pool1Records.length;
      const fullKeys = deriveRecordKeys(pool1Records);

      // ★ 这条不变量就是 AUDIT §1.8 硬约束的机械验证：鸣潮插件禁止增量采集，
      // "早先的一次采集"必须等价于完整数组的一个后缀（数组倒序、越老的记录
      // 越靠后），后一次采集记录变多，不能让早先那批记录的 key 跟着变——变了
      // 就会被当成新记录重复入库，这是历史上唯一真正伤到用户的那条性质
      // （§1.9 ②，3371 条真实数据上 20 处违例，见文件头说明）。
      //
      // 对每个安全切点（不落在下面 tenPullAmbiguousEnd 圈出的歧义区间内）都
      // 要求逐位严格相等；歧义区间内的切点由用例 8 用容忍组内互换的逻辑单独
      // 验证，这里不测，避免把一条"已知且有据可查"的例外误判成失败。
      for (let k = 0; k < total; k += 1) {
        if (k >= tenPullStart && k <= tenPullAmbiguousEnd) continue;
        assertSliceMatchesSuffix(pool1Records, fullKeys, k, "pool1");
      }

      // 显式确认四个关键切点确实被上面的循环覆盖到了，而不是被歧义区间的
      // 计算悄悄吞掉——tenPullAmbiguousEnd 的推导依赖样本数据形状，样本换一批
      // 后这个区间可能扩大，必须主动检查，不能假设"不出错"。
      const keyCutPoints: Array<[string, number]> = [
        ["k=0（完整集合自身）", 0],
        ["碰撞组内部切点", collisionSplitK],
        ["十连组内部安全切点", tenPullSafeInternalSplit],
        ["k=n-1（只剩最后一条）", total - 1],
      ];
      for (const [label, k] of keyCutPoints) {
        if (k >= tenPullStart && k <= tenPullAmbiguousEnd) {
          throw new Error(`关键切点 ${label}（k=${k}）落进了十连组的歧义区间，用例设计需要重新核对`);
        }
      }
    },
  },
  {
    name: "增长稳定性（pool10 真实样本）：整批同秒但物品互不相同，任意切点下 key 严格逐位一致",
    run: () => {
      // pool10 的 6 条记录全部共享同一秒时间戳、resourceId 却各不相同（见
      // fixtures/wuwa/meta.toml 该样本条目）——这是"整批同时间戳"退化场景的
      // 干净对照组：组内没有任何"逐字段完全相同"的重复子组，因此不存在用例 8
      // 里"判不出先后、允许互换"的借口，任意切点下都必须逐位严格相等。
      const collisionFree = groupIndicesBy(pool10Records, (entry) => `${entry.time}|${entry.itemId}`);
      for (const indices of collisionFree.values()) {
        if (indices.length > 1) {
          throw new Error(
            "样本结构假设不成立：pool10Records 里出现了同秒同物品的重复子组，本用例假设的" +
              "无歧义对照组不再成立，需要换一份没有重复子组的样本",
          );
        }
      }

      const fullKeys = deriveRecordKeys(pool10Records);
      for (let k = 0; k < pool10Records.length; k += 1) {
        assertSliceMatchesSuffix(pool10Records, fullKeys, k, "pool10");
      }
    },
  },
  {
    name: "增长稳定性退化场景（pool1 真实的十连组）：整批记录共享同一秒时间戳导致方向判不出来时，除组内彼此逐字段完全相同、无法区分先后的记录允许互换 key 外，其余位置必须逐位一致",
    run: () => {
      if (duplicateSubgroupsInTenPull.length === 0) {
        throw new Error(
          "样本结构假设不成立：pool1Records 的十连组里找不到同秒同物品的重复子组，本用例的退化场景测不到关键情形",
        );
      }

      // 把完整的同秒批次单独取出来当"早先的采集"：首尾时间相等，hooks.ts
      // 比较首尾判断方向的逻辑判不出方向（既不是"首 > 尾"，也无法确认已经
      // 是正序），这正是 AUDIT §1.9 记载的真实触发条件。
      const k = tenPullStart;
      const fullKeys = deriveRecordKeys(pool1Records);
      const sliceKeys = deriveRecordKeys(pool1Records.slice(k));

      const mismatches: number[] = [];
      for (let i = 0; i < sliceKeys.length; i += 1) {
        const originalIndex = k + i;
        if (sliceKeys[i] !== fullKeys[originalIndex]) mismatches.push(originalIndex);
      }
      if (mismatches.length === 0) {
        // 理论上不应该发生（这正是历史 bug 的触发条件），但如果实现变得更强、
        // 这个退化场景不再有歧义了，那是好事，不应该让测试因此报红。
        return;
      }

      // 逐一验证：每个不一致位置都能在同一个重复子组内找到"唯一伙伴"，两者
      // 的 key 是彻底换位（不是算出了别的什么值），换位也没有跑出组外。
      const explained = new Set<number>();
      for (const group of duplicateSubgroupsInTenPull) {
        const groupMismatches = group.filter((index) => mismatches.includes(index));
        if (groupMismatches.length === 0) continue;
        if (groupMismatches.length !== group.length) {
          throw new Error(
            `k=${k}：重复子组 ${JSON.stringify(group)} 只有部分成员（${JSON.stringify(groupMismatches)}）` +
              `的 key 变了——这不是组内互换，是真正的增长稳定性违例`,
          );
        }
        const sliceSide = groupMismatches.map((index) => sliceKeys[index - k]).sort();
        const fullSide = groupMismatches.map((index) => fullKeys[index]).sort();
        if (JSON.stringify(sliceSide) !== JSON.stringify(fullSide)) {
          throw new Error(
            `k=${k}：重复子组 ${JSON.stringify(group)} 的 key 集合前后不一致，不是单纯互换位置：` +
              `早先采集侧=${JSON.stringify(sliceSide)}，完整采集侧=${JSON.stringify(fullSide)}`,
          );
        }
        groupMismatches.forEach((index) => explained.add(index));
      }

      const unexplained = mismatches.filter((index) => !explained.has(index));
      if (unexplained.length > 0) {
        const details = unexplained
          .map((index) => `下标${index}（早先采集侧="${sliceKeys[index - k]}"，完整采集侧="${fullKeys[index]}"）`)
          .join("；");
        throw new Error(`k=${k}：出现了无法用"同一重复子组内部互换"解释的增长稳定性违例：${details}`);
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
