// 仓库根目录定位。
//
// gs:check 系列脚本可能被以任意 cwd 调用（例如 `cd src-tauri && node
// ../scripts/gs-check/index.mjs`），因此不能假设 process.cwd() 就是仓库根。
// 判定依据：从本文件所在目录开始向上查找，第一个包含 pnpm-workspace.yaml
// 的目录即为仓库根。

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 从本模块位置向上查找仓库根目录。
 * @returns {string} 仓库根目录的绝对路径
 */
export function findRepoRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `未能定位仓库根目录：从 ${fileURLToPath(import.meta.url)} 向上查找不到 pnpm-workspace.yaml`,
      );
    }
    dir = parent;
  }
}
