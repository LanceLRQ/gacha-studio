/**
 * 通用格式化助手：日期、数字。全站数字展示统一走这里，
 * 保证 tabular-nums 场景（抽数、天数、概率）的呈现口径一致。
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `2026-08-01` 形式，仅日期。 */
export function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `2026-08-01 21:34` 形式，日期 + 分钟精度时间。 */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${formatDate(epochMs)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 千分位分隔，如 1247 -> "1,247"。 */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** UID 脱敏展示：保留首尾各若干位，中段用 * 遮蔽（与设计稿 `1****8432` 一致）。 */
export function maskUid(uid: string): string {
  if (uid.length <= 6) return uid;
  const head = uid.slice(0, 1);
  const tail = uid.slice(-4);
  return `${head}${"*".repeat(uid.length - 5)}${tail}`;
}

/** 两个时间戳相差的整数天数（向下取整，正值表示 a 晚于 b）。 */
export function diffInDays(laterMs: number, earlierMs: number): number {
  return Math.floor((laterMs - earlierMs) / 86_400_000);
}
