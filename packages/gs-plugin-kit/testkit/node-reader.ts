/**
 * `FixtureReader` 的 Node 实现，供仓库内的插件测试脚本使用
 * （如 `plugins/genshin/fixture.test.ts`）。
 *
 * `testkit/index.ts` 是对外导出的契约入口，插件作者会 import 它，因此本包
 * 刻意不依赖 `@types/node`——这堵墙不是疏忽，是 HC-2 想让插件作者在编译期
 * 就撞上的边界（见 `testkit/index.ts` 顶部说明与 `testkit/self-check.ts` 的
 * 同款注释）。真正需要碰文件系统的实现只能放在本文件，且本文件不能用
 * `import fs from "node:fs"` 这种静态导入——`packages/gs-plugin-kit/tsconfig.json`
 * 的 `include` 把 `testkit/` 整个目录纳入同一个 tsc 编译单元，静态导入会让
 * `node:fs` 的模块类型对同一编译单元里的其它文件（包括未来任何插件测试脚本
 * 若被这个程序间接纳入）可见，等于把墙凿开一个洞。
 *
 * 绕开方式：TypeScript 对动态 `import(...)` 的模块解析只在参数是「字符串字面量
 * 语法」时才生效；参数是变量时，整个表达式退化为 `Promise<any>`，不做任何模块
 * 解析，也就不会引入 `node:fs` 的类型声明，也不会报 "Cannot find module"。
 * 已用 `tsc --noEmit` 与 `node --experimental-strip-types` 双向验证过这个行为
 * （变量写法两者都通过；直接写字面量 `import("node:fs/promises")` 会在没有
 * `@types/node` 时被 tsc 拒绝）。拿到的 `any` 立刻窄化为下面这几个最小接口，
 * 不在别处扩散。
 *
 * 同样的手法用来定位仓库根目录（`findRepoRoot`），逻辑照抄
 * `scripts/gs-check/lib/repo-root.mjs`：从本文件所在位置向上找
 * `pnpm-workspace.yaml`。这样 `readText` / `list` 接收的 `relativePath` 统一按
 * 「相对仓库根目录」解释，不受调用方实际 `process.cwd()`（例如 `pnpm --filter
 * genshin test` 会把 cwd 切到 `plugins/genshin/`）影响。
 */

import type { FixtureReader } from "./index.ts";

interface NodeFsPromisesLike {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
}

interface NodeFsSyncLike {
  existsSync: (path: string) => boolean;
}

interface NodePathLike {
  join: (...segments: string[]) => string;
  dirname: (p: string) => string;
}

// `import.meta` 在本包的 tsconfig 下（无 dom / 无 node 类型库）没有任何已知
// 成员，同样只能整体转一次型——转法与上面动态 import 的道理一致：先转
// unknown 再转目标形状，不是 `as any` 糊过检查，是给一个本来就没有类型声明
// 的宿主表达式补一个最小接口。
const importMeta = import.meta as unknown as { dirname: string };

let cachedFsPromises: NodeFsPromisesLike | undefined;
async function loadFsPromises(): Promise<NodeFsPromisesLike> {
  const specifier = "node:fs/promises";
  cachedFsPromises ??= (await import(specifier)) as NodeFsPromisesLike;
  return cachedFsPromises;
}

let cachedFsSync: NodeFsSyncLike | undefined;
async function loadFsSync(): Promise<NodeFsSyncLike> {
  const specifier = "node:fs";
  cachedFsSync ??= (await import(specifier)) as NodeFsSyncLike;
  return cachedFsSync;
}

let cachedPath: NodePathLike | undefined;
async function loadPath(): Promise<NodePathLike> {
  const specifier = "node:path";
  cachedPath ??= (await import(specifier)) as NodePathLike;
  return cachedPath;
}

let cachedRepoRoot: string | undefined;

/** 从本文件所在目录向上查找仓库根目录，判定依据同 scripts/gs-check/lib/repo-root.mjs。 */
async function findRepoRoot(): Promise<string> {
  if (cachedRepoRoot) return cachedRepoRoot;
  const fsSync = await loadFsSync();
  const path = await loadPath();

  let dir = importMeta.dirname;
  for (;;) {
    if (fsSync.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      cachedRepoRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("未能定位仓库根目录：从 node-reader.ts 所在位置向上查找不到 pnpm-workspace.yaml");
    }
    dir = parent;
  }
}

export const nodeFixtureReader: FixtureReader = {
  async readText(relativePath) {
    const [fs, path, root] = await Promise.all([loadFsPromises(), loadPath(), findRepoRoot()]);
    return fs.readFile(path.join(root, relativePath), "utf8");
  },
  async list(relativeDir) {
    const [fs, path, root] = await Promise.all([loadFsPromises(), loadPath(), findRepoRoot()]);
    return fs.readdir(path.join(root, relativeDir));
  },
};
