/**
 * 游戏图标机制——界面设计方向 §6。
 *
 * 完整职责划分（§6.1）：插件在 manifest 里只声明 `iconUrl`，真正发起下载、
 * 落盘、缓存是宿主（Rust 侧）的职责，插件从头到尾不拥有网络能力。
 *
 * 本文件是 M1-S6 阶段的前端实现，**只覆盖到「宿主」这一层里能在纯前端完成
 * 的部分**：URL 合法性判断、下载校验、fallback 计算。落盘持久化缓存
 * （Tauri app data 目录）需要 Rust 侧命令支撑，S3/S5 存储链路接通后才能补上
 * ——本文件已把这一缺口写清楚在下方注释里，不假装已经做完。
 *
 * 校验规则来自实测教训（§6.2）：TapTap 的图标地址以 `.jpg` 结尾，但
 * `content-type` 实际是 `image/png`。因此判断“这是不是一张图片”一律走
 * content-type + magic bytes 两道检查，**不得按扩展名判断**。
 */

/** 已知图片格式的文件头签名（magic bytes），用于落盘前校验。 */
const IMAGE_SIGNATURES: Array<{
  mimePrefix: string;
  matches: (bytes: Uint8Array) => boolean;
}> = [
  {
    mimePrefix: "image/png",
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mimePrefix: "image/jpeg",
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimePrefix: "image/gif",
    matches: (b) =>
      b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    mimePrefix: "image/webp",
    matches: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

/** 限 https，且必须是可解析的 URL——运行时输入（用户可自行修改），绕过了 manifest 的编译期审查（§6.5）。 */
export function isValidIconUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sniffImageMimePrefix(bytes: Uint8Array): string | undefined {
  return IMAGE_SIGNATURES.find((sig) => sig.matches(bytes))?.mimePrefix;
}

export type IconDownloadResult =
  | { ok: true; objectUrl: string }
  | { ok: false; reason: "invalidUrl" | "networkError" | "notAnImage" | "contentTypeMismatch" };

/**
 * 下载并校验一个图标地址。
 *
 * ⚠️ **持久化缺口**：本函数目前只做「取回 + 校验 + 生成可用于 `<img>` 的
 * object URL」，产出的 URL 随页面刷新失效，**没有写入磁盘缓存**——那一步
 * 需要 Tauri 命令把字节写进 app data 目录，S3/S5 存储链路接通后才具备条件。
 * 现在提前把「不携带凭据 + content-type/magic bytes 双重校验」这些安全相关
 * 逻辑做实，比等宿主命令就位后才补，更早暴露校验规则本身的问题。
 */
export async function downloadAndVerifyIcon(rawUrl: string): Promise<IconDownloadResult> {
  if (!isValidIconUrl(rawUrl)) {
    return { ok: false, reason: "invalidUrl" };
  }

  let response: Response;
  try {
    // credentials: "omit" —— 不携带任何 cookie / 凭据（§6.5）。
    response = await fetch(rawUrl, { credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    return { ok: false, reason: "networkError" };
  }
  if (!response.ok) {
    return { ok: false, reason: "networkError" };
  }

  const contentType = response.headers.get("content-type") ?? "";
  const buffer = new Uint8Array(await response.arrayBuffer());
  const sniffed = sniffImageMimePrefix(buffer);

  if (!sniffed) {
    return { ok: false, reason: "notAnImage" };
  }
  // content-type 允许缺失（部分 CDN 不返回），但若返回了就必须与嗅探结果一致；
  // 不信任 content-type 单独说了算，也不信任 URL 扩展名——双重校验取交集。
  if (contentType && !contentType.toLowerCase().startsWith(sniffed)) {
    return { ok: false, reason: "contentTypeMismatch" };
  }

  const blob = new Blob([buffer], { type: sniffed });
  return { ok: true, objectUrl: URL.createObjectURL(blob) };
}

/** fallback：游戏名首字（§6.4），用 Array.from 取第一个 Unicode 码位，避免代理对截断成半个字符。 */
export function fallbackIconGlyph(displayName: string): string {
  return Array.from(displayName)[0] ?? "?";
}
