/**
 * TODO：__GAME_ID__ 插件 manifest。
 *
 * 本文件由 `pnpm gs:new-plugin __GAME_ID__ --paradigm authkey` 生成，是一个
 * "开箱即可跑通测试" 的最小骨架——`pnpm --filter __GAME_ID__ test` 现在就能
 * 通过，因为示例 fixture（`fixtures/__GAME_ID__/`）与下面的字段映射是互相
 *匹配的占位实现。开始接入真实游戏时，请按下面的 TODO 逐项替换，并同步更新
 * fixture 让测试始终反映真实字段形状。
 *
 * 撰写前必读：
 *   - packages/gs-plugin-kit/manifest.ts（完整契约，含每个字段的设计依据）
 *   - docs/_internal/design/2026-08-10-插件SDK与贡献者模型.md 第三、四节
 *   - plugins/genshin/manifest.ts（已接入真实游戏的参考实现）
 */
import type { PluginManifest } from "gs-plugin-kit";

export { hooks } from "./hooks.ts";

/**
 * TODO：从响应体里取出本页记录数组。
 * 这里假设响应形如 `{ list: [...] }`，请按你的游戏真实响应结构调整，
 * 并保持防御式解析——任何一层形状不对就返回空数组，不要抛异常。
 */
function extractRecordList(response: unknown): unknown[] {
  if (typeof response !== "object" || response === null) return [];
  const list = (response as { list?: unknown }).list;
  return Array.isArray(list) ? list : [];
}

export const manifest = {
  // TODO：稳定标识，一旦发布不可更改，会写入数据库与用户配置。
  id: "__GAME_ID__",
  displayName: { "zh-CN": "TODO：游戏中文名" },
  sdkVersion: "1.0.0",
  // TODO：如实声明支持的平台，缺失的采集能力对应字段留空。
  platforms: ["windows"],
  // TODO：填写你的名字或 GitHub 用户名。
  maintainers: ["TODO"],

  collect: {
    paradigm: "authkey",
    params: {
      credential: {
        kind: "chromiumCache",
        // TODO：相对片段，不是绝对路径，如 "YuanShen_Data/webCaches"。
        gameDir: "TODO_GAME_DATA_DIR/webCaches",
        // TODO：从缓存内容里捞出凭据 URL 的正则，按你的游戏真实接口调整。
        urlPattern: /https:\/\/.+?TODO_API_ENDPOINT[^"]+/,
      },
      request: {
        // TODO：分页请求模板，"{{credential}}" 是凭据占位符。
        url: "{{credential}}&page={{page}}",
      },
      // TODO：卡池类型参数名，如原神/星铁 "gacha_type"、绝区零 "real_gacha_type"。
      typeParam: "TODO_TYPE_PARAM",
      extractList: extractRecordList,
    },
  },

  fields: {
    extractRecord: (raw) => {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("__GAME_ID__ extractRecord 收到非对象形态的原始记录");
      }
      const record = raw as Record<string, unknown>;
      // TODO：按真实字段名调整下面的映射，缺失字段一律返回 undefined 而不是空串。
      const name = typeof record.name === "string" && record.name.length > 0 ? record.name : undefined;
      const stableId = typeof record.id === "string" && record.id.length > 0 ? record.id : undefined;
      const itemId = name ?? stableId;
      if (!itemId) {
        throw new Error("__GAME_ID__ extractRecord：记录既无 name 也无 id，无法确定 itemId");
      }
      return {
        itemId,
        time: typeof record.time === "string" ? record.time : "",
        // TODO：归属卡池，取值需要对应下面 banners 里声明的某个 id。
        bannerId: "default",
        count: 1,
        name,
        stableId,
      };
    },
  },

  // TODO：至少声明一个卡池，id 需要与 fields.extractRecord 产出的 bannerId 对应。
  banners: [{ id: "default", displayName: { "zh-CN": "TODO：卡池名称" } }],

  // TODO：稀有度阶梯不可省略，按真实游戏的取值调整（绝区零是 2/3/4，不是 3/4/5）。
  rarity: { ladder: ["3", "4", "5"], pityTarget: "5" },

  // TODO：若 API 不返回任何时区信息，改成 { timezoneSource: { kind: "computed" } }
  // 并在 hooks.ts 里实现 resolveTimezone（参考 plugins/genshin/hooks.ts）。
} satisfies PluginManifest;
