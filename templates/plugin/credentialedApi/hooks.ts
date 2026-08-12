/**
 * TODO：__GAME_ID__ 插件的逃生舱 hooks。
 *
 * `deriveRecordKey` 是本模板唯一预先实现的 hook，因为 fixture 契约测试的
 * 静态检查（`checkDeriveRecordKeyContract`）要求：要么这个 hook 存在，要么
 * 能证实 `stableId` 一定会被填充。默认实现只是把 `bannerId` 与 `stableId`
 * 拼起来，多数游戏可以直接沿用；但如果你的游戏是米哈游三游这类服务端雪花 ID
 * 场景，请对照 `plugins/genshin/hooks.ts` 顶部的说明确认这个默认实现是否够用。
 *
 * 其余 hook（`resolveTimezone` / `transformRecord` / `countDraws`）按需添加：
 * 只有当 manifest 里声明了对应的触发条件（`time.timezoneSource.kind ===
 * "computed"` / `drawCounting.kind === "custom"`）时才是必填，参考
 * `packages/gs-plugin-kit/manifest.ts` 的 `PluginHooks` 文档。
 */
import type { PluginHooks } from "gs-plugin-kit";

export const hooks: PluginHooks = {
  deriveRecordKey: (record) => {
    if (!record.stableId) {
      throw new Error(`__GAME_ID__ 记录缺少 stableId，无法生成稳定的 record_key：itemId="${record.itemId}"`);
    }
    return `${record.bannerId}:${record.stableId}`;
  },

  // TODO：仅当 manifest.time.timezoneSource.kind === "computed" 时才需要实现。
  // resolveTimezone: (record, ctx) => 8,

  // TODO：仅当 manifest.drawCounting.kind === "custom" 时才需要实现。
  // countDraws: (records) => records.length,
};
