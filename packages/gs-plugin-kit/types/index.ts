/**
 * 与 Rust 侧结构一一对应的类型定义。
 *
 * 未来由 gs-host 通过 codegen 工具（如 specta / ts-rs）生成到此目录，生成后禁止手改
 * （见 docs/_internal/design/2026-08-10-插件SDK与贡献者模型.md 第六节 HC-3）。
 * 当前处于工程骨架阶段，gs-host 尚未落地，此文件是手写占位版本，仅收录已定案且
 * 短期内不会再变的部分；`PluginManifest` 的采集配置、字段映射、卡池表等复杂结构
 * 留给 M1 插件 SDK 实现时再补全，此处不预先猜测形状。
 */

/** 本地化文本，key 为语言标签，如 "zh-CN" / "en-US" */
export type LocalizedText = Record<string, string>;

/** 插件声明自己支持在哪些平台上运行 */
export type Platform = "windows" | "macos";

/**
 * 插件 Manifest 的顶层身份字段（占位版本，仅覆盖已定案的部分）。
 * 完整契约见插件 SDK 文档第三章，随 M1 插件 SDK 实现时补全。
 */
export interface PluginManifest {
  /** 稳定标识，一旦发布不可更改；会被写入数据库与用户配置 */
  id: string;
  displayName: LocalizedText;
  platforms: Platform[];
  maintainers: string[];
}

/**
 * 采集响应归一化后的统一记录字段。
 * 对应插件 SDK 文档第 3.3 节，该结构已在设计阶段定案。
 */
export interface UnifiedRecordFields {
  /** 物品在游戏内的稳定标识 */
  itemId: string;
  /** 原始时间字符串，未做任何时区换算 */
  time: string;
  /** 归属卡池，取值对应 BannerSpec.id */
  bannerId: string;
  /** 本条记录获得的物品数量，语义是"数量"而非"抽数"；米哈游三游恒为 1 */
  count: number;
  /** 物品元数据可能缺失，一律用可选字段表达，不得用空字符串冒充有值 */
  name?: string;
  itemType?: string;
  rarity?: string;
  /** 若 API 直接提供稳定 ID（如雪花 ID），填在这里 */
  stableId?: string;
}
