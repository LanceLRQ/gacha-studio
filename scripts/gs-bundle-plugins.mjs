#!/usr/bin/env node
/**
 * 插件构建期打包脚本。
 *
 * 架构依据：`docs/_internal/milestones/00-实施总览.md` §6.7——插件 TS 纯函数
 * 跑在 Rust 内嵌的 JS 引擎里（QuickJS/`rquickjs`），因此需要一份【构建期产出、
 * 提交入库】的 JS bundle，供 `crates/gs-plugin-runtime` 用 `include_str!` 直接嵌入二进制。
 * 这正是 HC-1（编译期打包，禁止运行时动态加载）的机械落点之一：产物在这里
 * 一次性生成，运行时宿主不做任何读取外部脚本再执行的动作。
 *
 * 产出两份【必须 committed】的确定性产物（见 `crates/gs-plugin-runtime/generated/`）：
 *
 * 1. `plugins.bundle.js`
 *    `plugins/*∕manifest.ts` 打包成的单文件 IIFE，向 `globalThis.__gs_plugins`
 *    注册每个插件的 `{ manifest, hooks }`；不压缩、保留函数名与行号（bundle
 *    嵌进二进制里没有体积压力，可读性优先）；附带两个调用桥接函数
 *    `__gs_call` / `__gs_has`（供 `crates/gs-plugin-runtime/src/lib.rs`
 *    以 JSON 字符串为界调用插件函数）；文件末尾带 inline sourcemap，映射回
 *    原始 `plugins/<game>/*.ts` 的行号，供 Rust 捕获异常时把栈里的
 *    `plugins.bundle.js:行:列` 换算回插件作者能看懂的原始位置。
 *
 * 2. `plugins.manifest.json`
 *    对每个插件的 `manifest` 取"纯数据子集"——递归丢弃全部函数字段，
 *    `RegExp` 转成 `{ source, flags }`，其余原样保留。存在的意义：
 *    `crates/paradigms/gs-p-authkey` 与后续分析引擎需要 `banners` /
 *    `rarity` / `pityGroups` / `retention` / `request` /
 *    `credential.gameDir` / `itemIdSource` 这些纯数据时，直接读这份 JSON，
 *    不必在 Rust 里手抄一遍——那正是"新增卡池只改单一数据源"这条 M1 验收
 *    标准的反例（现状：M1-S5 被迫抄了一遍原神卡池声明当种子数据，见
 *    `00-实施总览.md` §6.7 结尾一段，本脚本负责解掉这个缺口，S5 那边的
 *    消费方式由后续 Stage 统一，本脚本只负责产出）。
 *
 * ## 关于打包工具的偏差说明
 *
 * brief 原文写"esbuild，Vite 已带"，但实测本仓库 `web/` 依赖的 Vite 是
 * 8.x（`rolldown-vite`），其打包后端是 **rolldown**，不是 esbuild——
 * `node_modules/.pnpm` 下 vite 的依赖目录里没有独立的 `esbuild` 包，只有
 * `rolldown`。改用 rolldown 不影响任何验收标准（TS 剥离、单文件产出、
 * 不压缩、inline sourcemap 均支持），因此直接采用，不追加新依赖——
 * 复用 `web/` 已经拉取的 Vite 间接依赖，不往根 `package.json` / 各
 * `package.json` 引入任何新包（本脚本的运行范围限制里也明确不让碰
 * 根 `package.json`）。用 `createRequire` 沿 `web/package.json → vite →
 * rolldown` 这条真实的 node_modules 解析链路取得 `rolldown` 模块，
 * 不硬编码 pnpm store 里的哈希路径。
 *
 * ## 两份产物为什么来自同一次编译
 *
 * 若"打包成 JS"与"提取纯数据 JSON"分别用两套转换逻辑（比如一套用 rolldown、
 * 一套用正则抠 manifest.ts 源码），两者迟早会因为其中一套没跟上另一套的改动
 * 而悄悄漂移。这里改为单一数据源：rolldown 编译一次，产出的 bundle 代码字符串
 * 在 Node `vm` 沙箱里执行一遍拿到真实的 `manifest` 对象，两份产物的"数据部分"
 * 保证互相一致——不可能出现"JS 里的卡池表"和"JSON 里的卡池表"对不上的情况。
 *
 * ## 确定性
 *
 * HC-3 的门是"重跑后 `git diff` 必须为空"。本脚本不依赖任何非确定性来源：
 * 插件目录按名称字典序排序后再进入打包；rolldown 未启用 minify（因此没有
 * 变量名混淆的哈希/计数器差异）；JSON 序列化时对象键顺序取自
 * `Object.keys()`，对纯字面量对象等价于源码里的书写顺序，不额外排序。
 * 已实测连续两次运行字节级一致（`node scripts/gs-bundle-plugins.mjs` 两次，
 * 对比 `plugins.bundle.js` / `plugins.manifest.json` 的 md5）。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/gs-bundle-plugins.mjs
 * ```
 *
 * 没有走 `pnpm gs:bundle-plugins` 这样的脚本别名——根 `package.json` 不在本次
 * 改动范围内，建议后续由维护者加一行：
 * `"gs:bundle-plugins": "node scripts/gs-bundle-plugins.mjs"`。
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
const OUTPUT_DIR = path.join(REPO_ROOT, "crates/gs-plugin-runtime/generated");
const BUNDLE_FILE = path.join(OUTPUT_DIR, "plugins.bundle.js");
const MANIFEST_FILE = path.join(OUTPUT_DIR, "plugins.manifest.json");

/**
 * 沿真实的 node_modules 解析链路取得 rolldown：`web/package.json` 声明了对
 * `vite` 的依赖，而这份 `vite`（8.x，即 rolldown-vite）自己依赖 `rolldown`。
 * 用 `createRequire` 两次接力解析，不硬编码 pnpm store 里带哈希的路径片段
 * （那类路径会随依赖版本变化而失效，`createRequire` 走的是 Node 原生解析
 * 算法，只要 `web/` 还依赖 `vite`、`vite` 还依赖 `rolldown`，就总能找到）。
 */
async function loadRolldown() {
  const requireFromWeb = createRequire(path.join(REPO_ROOT, "web/package.json"));
  const vitePkgPath = requireFromWeb.resolve("vite/package.json");
  const requireFromVite = createRequire(vitePkgPath);
  const rolldownEntry = requireFromVite.resolve("rolldown");
  const mod = await import(pathToFileURL(rolldownEntry).href);
  return mod.rolldown;
}

/**
 * 发现全部插件：`plugins/<id>/manifest.ts` 存在即视为一个插件。按目录名
 * 字典序排序——这是本脚本确定性的来源之一，不依赖文件系统的目录遍历顺序
 * （不同操作系统/文件系统对 `readdir` 的返回顺序没有统一保证）。
 *
 * 不读取 `plugins/index.ts` 的注册表：那份文件用的是"按需动态 import"的
 * loader 数组（供前端展示插件列表时按需加载），语义是"UI 懒加载"，与本脚本
 * "构建期把全部插件打进一个文件"的目的不同，两者刻意不复用同一份清单。
 */
function discoverPluginIds() {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        return statSync(path.join(PLUGINS_DIR, name, "manifest.ts")).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * 调用桥接函数，随 bundle 一起打包进同一个文件（因此也被同一份 inline
 * sourcemap 覆盖，虽然这两个函数本身没有对应的原始 TS 文件可映射）。
 *
 * `__gs_call`：`crates/gs-plugin-runtime/src/lib.rs` 的唯一入口——按
 * `pluginId` 找到插件、按点分路径（如 `"fields.extractRecord"`）解析到具体
 * 函数、用 `JSON.parse` 还原参数数组、调用后把结果 `JSON.stringify` 回去。
 * 参数与返回值全程走 JSON 字符串，Rust 侧不持有任何 JS 值的跨调用生命周期
 * （brief §二的硬要求）。
 *
 * `__gs_has`：探测某个 hook 路径是否存在而不触发调用——`hooks.deriveRecordKey`
 * /`hooks.resolveTimezone` 等钩子是否声明只有跑起来才知道，Rust 侧需要一个
 * 不执行函数体就能问"这个钩子存在吗"的手段。
 */
const RUNTIME_HARNESS = `
globalThis.__gs_resolvePath = function (pluginId, pathStr) {
  const plugin = globalThis.__gs_plugins && globalThis.__gs_plugins[pluginId];
  if (!plugin) {
    throw new Error("插件 \\"" + pluginId + "\\" 未注册（globalThis.__gs_plugins 中不存在）");
  }
  const segments = pathStr.split(".");
  let target = plugin;
  let parent = null;
  for (const seg of segments) {
    if (target === null || target === undefined) {
      throw new Error(
        "路径 \\"" + pathStr + "\\" 在插件 \\"" + pluginId + "\\" 上不存在（在段 \\"" + seg + "\\" 处中断）",
      );
    }
    parent = target;
    target = target[seg];
  }
  return { value: target, thisArg: parent };
};

globalThis.__gs_has = function (pluginId, pathStr) {
  try {
    const resolved = globalThis.__gs_resolvePath(pluginId, pathStr);
    return typeof resolved.value === "function";
  } catch (err) {
    return false;
  }
};

globalThis.__gs_call = function (pluginId, pathStr, argsJson) {
  const resolved = globalThis.__gs_resolvePath(pluginId, pathStr);
  if (typeof resolved.value !== "function") {
    throw new Error(
      "路径 \\"" + pathStr + "\\" 未指向一个函数（实际类型 " + typeof resolved.value + "）",
    );
  }
  const args = JSON.parse(argsJson);
  const result = resolved.value.apply(resolved.thisArg, args);
  return JSON.stringify(result === undefined ? null : result);
};
`.trim();

/** 生成打包入口的虚拟模块源码：逐个 import 插件 manifest，注册进全局表。 */
function buildEntrySource(pluginIds) {
  const lines = [];
  pluginIds.forEach((id, index) => {
    const absPath = path.join(PLUGINS_DIR, id, "manifest.ts");
    lines.push(`import * as __gs_plugin_${index} from ${JSON.stringify(absPath)};`);
  });
  lines.push("");
  lines.push("globalThis.__gs_plugins = globalThis.__gs_plugins || {};");
  pluginIds.forEach((id, index) => {
    lines.push(
      `globalThis.__gs_plugins[__gs_plugin_${index}.manifest.id] = ` +
        `{ manifest: __gs_plugin_${index}.manifest, hooks: __gs_plugin_${index}.hooks };`,
    );
  });
  lines.push("");
  lines.push(RUNTIME_HARNESS);
  return lines.join("\n") + "\n";
}

/** 用 rolldown 打包虚拟入口，不落地任何临时文件（resolveId/load 钩子直接喂源码）。 */
async function bundlePlugins(rolldown, entrySource) {
  const virtualEntryId = "\0gs-plugins-entry";
  const virtualEntryPlugin = {
    name: "gs-plugins-virtual-entry",
    resolveId(id) {
      if (id === "gs-plugins-entry") return virtualEntryId;
      return null;
    },
    load(id) {
      if (id === virtualEntryId) return entrySource;
      return null;
    },
  };

  const bundle = await rolldown({
    input: "gs-plugins-entry",
    plugins: [virtualEntryPlugin],
    platform: "neutral",
    resolve: { extensions: [".ts", ".js"] },
  });
  try {
    const { output } = await bundle.generate({
      format: "iife",
      sourcemap: "inline",
      minify: false,
    });
    if (output.length !== 1) {
      throw new Error(`期望 rolldown 产出单个 chunk，实际产出 ${output.length} 个`);
    }
    return output[0].code;
  } finally {
    await bundle.close();
  }
}

/**
 * 递归取"纯数据子集"：函数整体丢弃（对象里表现为该键消失，数组里表现为
 * 该元素被过滤掉——manifest 里目前没有"数组里混函数"的用例，这条分支只是
 * 让行为在这种输入下也保持良定义，不是专门为某个字段写的）；`RegExp` 转成
 * `{ source, flags }`；其余原样递归。
 *
 * 用 `Object.prototype.toString.call` 而不是 `instanceof RegExp` 判断正则：
 * bundle 是在 `vm` 沙箱的独立 realm 里跑的，沙箱里的 `RegExp` 构造函数与
 * 本脚本主 realm 的 `RegExp` 不是同一个对象，跨 realm `instanceof` 恒为
 * `false`；`Object.prototype.toString.call` 读的是内部 `[[Class]]`/
 * `Symbol.toStringTag`，跨 realm 也成立。
 */
function toPureData(value) {
  if (typeof value === "function") return undefined;
  if (Object.prototype.toString.call(value) === "[object RegExp]") {
    return { source: value.source, flags: value.flags };
  }
  if (Array.isArray(value)) {
    return value.map(toPureData).filter((item) => item !== undefined);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      const converted = toPureData(value[key]);
      if (converted !== undefined) out[key] = converted;
    }
    return out;
  }
  return value;
}

/**
 * 在一个只给了 `console` 的沙箱 realm 里执行 bundle，取回
 * `globalThis.__gs_plugins`。这一步只用来"读数据"，不代表生产环境的
 * QuickJS 沙箱策略——生产沙箱的暴露面审计见
 * `crates/gs-plugin-runtime/src/lib.rs`；这里给 `console` 纯粹是防止插件
 * 顶层代码里若有调试用的 `console.log` 时把整个脚本跑挂，不放宽 Rust 侧
 * 的任何约束。
 */
function executeBundle(code) {
  const context = vm.createContext({ console });
  vm.runInContext(code, context, { filename: "plugins.bundle.js" });
  return context.__gs_plugins ?? {};
}

async function main() {
  const rolldown = await loadRolldown();
  const pluginIds = discoverPluginIds();
  if (pluginIds.length === 0) {
    throw new Error(`"${PLUGINS_DIR}" 下没有发现任何声明了 manifest.ts 的插件目录`);
  }

  const entrySource = buildEntrySource(pluginIds);
  const bundleCode = await bundlePlugins(rolldown, entrySource);

  const registered = executeBundle(bundleCode);
  const missing = pluginIds.filter((id) => !(id in registered));
  if (missing.length > 0) {
    throw new Error(
      `以下插件目录存在 manifest.ts，但打包执行后未出现在 globalThis.__gs_plugins：${missing.join(", ")}` +
        "——多半是 manifest.id 与目录名不一致，或 manifest.ts 顶层代码抛出了异常",
    );
  }

  const pureManifests = { _generatedBy: "scripts/gs-bundle-plugins.mjs —— 禁止手改" };
  for (const [id, entry] of Object.entries(registered)) {
    pureManifests[id] = toPureData(entry.manifest);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const bundleHeader =
    "// 本文件由 scripts/gs-bundle-plugins.mjs 生成，禁止手改。\n" +
    "// 修改请改动 plugins/<game>/manifest.ts 或 hooks.ts 后重跑该脚本。\n" +
    "// 不压缩、保留函数名与行号，文件末尾的 inline sourcemap 映射回原始 .ts 行号。\n";
  writeFileSync(BUNDLE_FILE, bundleHeader + bundleCode, "utf8");
  writeFileSync(MANIFEST_FILE, JSON.stringify(pureManifests, null, 2) + "\n", "utf8");

  console.log(`已生成 ${path.relative(REPO_ROOT, BUNDLE_FILE)}（${bundleCode.length} 字节 bundle 正文）`);
  console.log(`已生成 ${path.relative(REPO_ROOT, MANIFEST_FILE)}`);
  console.log(`插件清单：${pluginIds.join(", ")}`);
}

main().catch((err) => {
  console.error("插件打包失败：", err);
  process.exitCode = 1;
});
