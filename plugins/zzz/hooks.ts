/**
 * 绝区零插件的逃生舱 hooks。
 *
 * 只需要一个 hook：
 *
 * - `deriveRecordKey`：与原神同理，米哈游三游一律不得省略本 hook（见
 *   `packages/gs-plugin-kit/manifest.ts` 里 `PluginHooks.deriveRecordKey`
 *   文档）——服务端雪花 ID 不含卡池维度，跨端点场景下裸用 `stableId` 有
 *   撞键风险；HoYo.Gacha 为此在原神联动池上线一年后付出过一次整表重建迁移，
 *   本插件从第一天就把卡池维度并进 key，理由与 `plugins/genshin/hooks.ts`
 *   完全一致。
 * - `resolveTimezone` 不需要：`manifest.ts` 的 `time.timezoneSource.kind`
 *   是 `"staticTable"`（响应 `region` 字段查表），不是 `"computed"`，时区
 *   换算不需要插件代码参与。
 */
import type { PluginHooks } from "gs-plugin-kit";

export const hooks: PluginHooks = {
  deriveRecordKey: (record) => {
    if (!record.stableId) {
      throw new Error(
        `绝区零记录缺少 stableId（服务端雪花 ID），无法生成稳定的 record_key：itemId="${record.itemId}"`,
      );
    }
    return `${record.bannerId}:${record.stableId}`;
  },
};
