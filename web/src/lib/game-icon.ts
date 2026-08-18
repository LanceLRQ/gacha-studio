/**
 * 游戏图标机制——界面设计方向 §6。
 *
 * 完整职责划分（§6.1）：插件在 manifest 里只声明 `iconUrl`，真正发起下载、
 * 校验（content-type + magic bytes）、落盘缓存全部是宿主（Rust 侧）职责，
 * 通过 `ensure_game_icon` 这一条 IPC 命令暴露给前端（见
 * `lib/ipc-client.ts`），前端从头到尾不发起任何网络请求——这是对
 * `downloadAndVerifyIcon` 这个早期实现的纠正：那版本在前端 `fetch()`，
 * 违背了「插件/前端不拥有网络能力」的设计边界，产出的 `URL.createObjectURL`
 * 临时地址还会随页面刷新失效、从不落盘。
 *
 * 本文件现在只剩一件事：图标缺席时的 fallback 计算（§6.4）。
 */

/** fallback：游戏名首字（§6.4），用 Array.from 取第一个 Unicode 码位，避免代理对截断成半个字符。 */
export function fallbackIconGlyph(displayName: string): string {
  return Array.from(displayName)[0] ?? "?";
}
