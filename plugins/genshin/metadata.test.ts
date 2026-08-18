/**
 * 原神插件 `metadata` Provider 的单元测试——专门测 `parseResponse` 这个纯函数，
 * 不依赖 fixture 契约测试框架（那套跑的是 extractRecord/hooks，metadata 不在
 * 它的覆盖范围内，见 `fixture.test.ts` 顶部说明）。
 *
 * 运行方式：
 *   node --experimental-strip-types plugins/genshin/metadata.test.ts
 */
import { manifest } from "./manifest.ts";

declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
declare const process: { exitCode?: number };

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}：期望 ${e}，实际 ${a}`);
  }
}

if (manifest.metadata === undefined) {
  throw new Error("manifest.metadata 未声明——本轮任务要求原神插件声明 online/nameToId 元数据 Provider");
}
if (manifest.metadata.kind !== "online" || manifest.metadata.direction !== "nameToId") {
  throw new Error(`manifest.metadata 声明形态不对：${JSON.stringify(manifest.metadata)}`);
}
const parseResponse = manifest.metadata.parseResponse;

// ---- 用例 1：真实响应形状（api.uigf.org 字典接口） ----
assertEqual(
  parseResponse({ 无锋剑: 11101, 胡桃: 10000046 }),
  { 无锋剑: "11101", 胡桃: "10000046" },
  "真实字典响应应当把数字 id 转成字符串，逐条映射",
);

// ---- 用例 2：字符串形态的 id 也接受（防御式，官方从未如此返回，但不假设永远是数字） ----
assertEqual(parseResponse({ 无锋剑: "11101" }), { 无锋剑: "11101" }, "字符串形态的 id 应当原样保留");

// ---- 用例 3：空对象——合法的空字典，不是错误 ----
assertEqual(parseResponse({}), {}, "空对象应当解析成空字典，不是 undefined");

// ---- 用例 4：整份响应形状不对——数组、null、原始类型 ----
assertEqual(parseResponse([]), undefined, "数组响应应当返回 undefined");
assertEqual(parseResponse(null), undefined, "null 响应应当返回 undefined");
assertEqual(parseResponse("not json"), undefined, "字符串响应应当返回 undefined");
assertEqual(parseResponse(42), undefined, "数字响应应当返回 undefined");

// ---- 用例 5：单条脏数据不拖垮整份字典 ----
assertEqual(
  parseResponse({ 无锋剑: 11101, 坏条目: null, 坏条目2: {}, 坏条目3: "", 胡桃: 10000046 }),
  { 无锋剑: "11101", 胡桃: "10000046" },
  "值形状不对（null/对象/空串）的条目应当被跳过，不影响其余合法条目",
);

console.log(`原神插件 metadata Provider 单元测试：通过（${manifest.id}）`);
