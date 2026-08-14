/**
 * 星铁插件的逃生舱 hooks。
 *
 * 只需要 `deriveRecordKey` 一个 hook：
 * - `resolveTimezone` 不需要——`manifest.ts` 的 `time.timezoneSource.kind` 是
 *   `"apiField"`，不是 `"computed"`，宿主直接从响应体页级字段
 *   `region_time_zone` 读取偏移量，不经过本插件的任何函数（见 `manifest.ts`
 *   `time` 字段旁的注释）。
 * - `deriveRecordKey` 必须实现，不能省略：星铁联动池（21/22）走独立端点
 *   `getLdGachaLog`，服务端雪花 ID 的命名空间在跨端点场景下不保证隔离——
 *   裸用 `stableId` 会撞键，写入层 `INSERT OR IGNORE` 会把撞键记录**静默
 *   丢弃**，用户只会发现「少了一条」，且无法定位是哪一条。做法与
 *   `plugins/genshin/hooks.ts` 完全一致（同样是米哈游服务端雪花 ID 场景，
 *   `packages/gs-plugin-kit/manifest.ts` 的 `PluginHooks.deriveRecordKey`
 *   文档明确点名"米哈游三游不得缺省本 hook"）：`` `${bannerId}:${stableId}` ``，
 *   把卡池维度并进复合键，参考实现 HoYo.Gacha 上线一年后为星铁联动池的这个
 *   问题付出过一次整表重建迁移，本插件从第一天就按复合键实现，不留同样的坑。
 */
import type { PluginHooks } from "gs-plugin-kit";

export const hooks: PluginHooks = {
  deriveRecordKey: (record) => {
    if (!record.stableId) {
      throw new Error(`星铁记录缺少 stableId（服务端雪花 ID），无法生成稳定的 record_key：itemId="${record.itemId}"`);
    }
    return `${record.bannerId}:${record.stableId}`;
  },
};
