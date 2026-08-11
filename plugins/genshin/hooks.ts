/**
 * 原神插件的逃生舱 hooks。
 *
 * 两个 hook 均不可省略：
 *
 * - `resolveTimezone`：米哈游 `getGachaLog` 响应不带任何时区字段（既无 `region`
 *   也无 `region_time_zone`），只能按 UID 首位数字推断服务器所在时区。
 *   参考实现已用三方工具源码核实：`uid[0]==='6'→-5, '7'→1, else 8`
 *   （docs/_internal/research/04-同族工具三方源码对比.md §4.4）。
 * - `deriveRecordKey`：服务端雪花 ID 不含卡池维度。参考实现 HoYo.Gacha 上线时
 *   主键是 `(business, uid, id)`，一年后为星铁联动池 `getLdGachaLog` 补了一次
 *   整表重建迁移，改成 `(business, uid, id, gacha_type)`——SQLite 改不了主键，
 *   这个代价不该留到以后才补。米哈游三游一律按同一规则实现本 hook，即使原神
 *   目前只有单一端点、尚未观测到跨端点雪花 ID 碰撞，也不例外
 *   （packages/gs-plugin-kit/manifest.ts 的 `PluginHooks.deriveRecordKey` 文档）。
 */
import type { PluginHooks } from "gs-plugin-kit";

export const hooks: PluginHooks = {
  resolveTimezone: (_record, ctx) => {
    const firstDigit = ctx.uid.trim().charAt(0);
    if (firstDigit === "6") return -5; // 美服
    if (firstDigit === "7") return 1; // 欧服
    return 8; // 国服 / 亚服等其余区服，含未知区服的保守默认值
  },

  deriveRecordKey: (record) => {
    if (!record.stableId) {
      throw new Error(
        `原神记录缺少 stableId（服务端雪花 ID），无法生成稳定的 record_key：itemId="${record.itemId}"`,
      );
    }
    // 原始 gacha_type（可能是 "400" 这类不可单独查询的合并子类型）+ 服务端雪花 ID，
    // 把卡池维度并进去，避免跨端点场景下裸雪花 ID 撞键后被 INSERT OR IGNORE 静默丢弃。
    return `${record.bannerId}:${record.stableId}`;
  },
};
