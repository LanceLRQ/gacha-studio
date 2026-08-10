/**
 * 与 ../types 逐字段对应的运行时校验 schema（zod）。
 *
 * 插件产出的记录在写入存储层之前必须经过这里的 schema 校验——类型只在编译期把关，
 * 插件返回的实际数据仍需运行时校验兜底（见插件 SDK 文档第六节 HC-3）。
 * 本文件与 ../types 手动保持同步，两者字段是否一致由 CI 门禁保障，此处不做自动派生。
 */

import { z } from "zod";

export const localizedTextSchema = z.record(z.string(), z.string());

export const platformSchema = z.enum(["windows", "macos"]);

/** 对应 types.PluginManifest 的占位版本，仅校验已定案的顶层身份字段 */
export const pluginManifestSchema = z.object({
  id: z.string(),
  displayName: localizedTextSchema,
  platforms: z.array(platformSchema),
  maintainers: z.array(z.string()),
});

/** 对应 types.UnifiedRecordFields */
export const unifiedRecordFieldsSchema = z.object({
  itemId: z.string(),
  time: z.string(),
  bannerId: z.string(),
  count: z.number(),
  name: z.string().optional(),
  itemType: z.string().optional(),
  rarity: z.string().optional(),
  stableId: z.string().optional(),
});
