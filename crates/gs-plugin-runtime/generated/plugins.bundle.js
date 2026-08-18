// 本文件由 scripts/gs-bundle-plugins.mjs 生成，禁止手改。
// 修改请改动 plugins/<game>/manifest.ts 或 hooks.ts 后重跑该脚本。
// 不压缩、保留函数名与行号，文件末尾的 inline sourcemap 映射回原始 .ts 行号。
(function() {

//#region plugins/genshin/hooks.ts
	const hooks$3 = {
		resolveTimezone: (_record, ctx) => {
			const firstDigit = ctx.uid.trim().charAt(0);
			if (firstDigit === "6") return -5;
			if (firstDigit === "7") return 1;
			return 8;
		},
		deriveRecordKey: (record) => {
			if (!record.stableId) throw new Error(`原神记录缺少 stableId（服务端雪花 ID），无法生成稳定的 record_key：itemId="${record.itemId}"`);
			return `${record.bannerId}:${record.stableId}`;
		}
	};

//#endregion
//#region plugins/genshin/manifest.ts
/**
	* 从 `getGachaLog` 响应体里取出本页记录数组。
	*
	* 真实响应形态是 `{ retcode, message, data: { list: [...], region } }`
	* （HoYo.Gacha `MihoyoResponse<GachaLogs>` / genshin-wish-export
	* `getGachaLog` 里的 `res.data.list`）。防御式解析：任何一层形状不对就返回
	* 空数组而不是抛异常——分页引擎会把空数组当作 `emptyPage` 终止条件处理，
	* 这比让一次偶发的畸形响应中断整条采集流程更安全。
	*/
	function extractGachaLogList$2(response) {
		if (typeof response !== "object" || response === null) return [];
		const data = response.data;
		if (typeof data !== "object" || data === null) return [];
		const list = data.list;
		return Array.isArray(list) ? list : [];
	}
	/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
	function toNonEmptyString$3(value) {
		if (typeof value !== "string") return void 0;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : void 0;
	}
	/** 官方响应里的 `count` 是数字字符串（如 `"1"`），防御式转换，异常输入兜底为 1。 */
	function toCount$3(value) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 1;
	}
	const manifest$3 = {
		id: "genshin",
		displayName: { "zh-CN": "原神" },
		sdkVersion: "1.0.0",
		platforms: ["windows"],
		maintainers: ["gacha-studio"],
		exchangeFormats: ["uigf-v4"],
		iconUrl: "https://img-tc.tapimg.com/market/images/4c441769b5fb3b670c8b59a6124d9ff2.png/_tap_appicon_m.jpg",
		collect: {
			paradigm: "credentialedApi",
			params: {
				credential: {
					kind: "chromiumCache",
					gameDir: "YuanShen_Data/webCaches",
					urlPattern: /https:\/\/.+?getGachaLog[^"]+/
				},
				request: { url: "{{credential}}&page={{page}}&gacha_type={{gachaType}}&size={{pageSize}}&end_id=0" },
				allowedHosts: ["public-operation-hk4e.mihoyo.com", "public-operation-hk4e-sg.hoyoverse.com"],
				extractList: extractGachaLogList$2
			}
		},
		fields: { extractRecord: (raw) => {
			if (typeof raw !== "object" || raw === null) throw new Error("原神 extractRecord 收到非对象形态的原始记录");
			const record = raw;
			const name = toNonEmptyString$3(record.name);
			const stableId = toNonEmptyString$3(record.id);
			const itemId = name ?? stableId;
			if (!itemId) throw new Error("原神 extractRecord：记录既无 name 也无 id，无法确定 itemId");
			return {
				itemId,
				time: toNonEmptyString$3(record.time) ?? "",
				bannerId: toNonEmptyString$3(record.gacha_type) ?? "",
				count: toCount$3(record.count),
				name,
				itemType: toNonEmptyString$3(record.item_type),
				rarity: toNonEmptyString$3(record.rank_type),
				stableId
			};
		} },
		banners: [
			{
				id: "301",
				displayName: { "zh-CN": "角色活动祈愿" }
			},
			{
				id: "302",
				displayName: { "zh-CN": "武器活动祈愿" }
			},
			{
				id: "200",
				displayName: { "zh-CN": "常驻祈愿" }
			},
			{
				id: "500",
				displayName: { "zh-CN": "集录祈愿" }
			},
			{
				id: "100",
				displayName: { "zh-CN": "新手祈愿" }
			},
			{
				id: "400",
				displayName: { "zh-CN": "角色活动祈愿（400 子类型，随 301 一并返回）" }
			}
		],
		pityGroups: [{
			key: "characterEventWish",
			members: ["301", "400"],
			hardPity: 90,
			curve: {
				kind: "softPity",
				base: .006,
				start: 74,
				step: .06
			},
			guarantee: { kind: "fiftyFifty" }
		}],
		rarity: {
			ladder: [
				"3",
				"4",
				"5"
			],
			pityTarget: "5"
		},
		time: { timezoneSource: { kind: "computed" } },
		preconditions: [{
			id: "genshin.credential.cacheDirExists",
			capability: "credential",
			level: "required",
			describe: { "zh-CN": "自动获取抽卡链接要求游戏客户端至少运行过一次，缓存目录才会被创建" },
			check: () => ({ kind: "unknown" }),
			remedy: { "zh-CN": "请先启动游戏并打开一次抽卡记录页，再回到本应用重试" }
		}],
		baseline: { kind: "inGamePageCount" },
		retention: {
			displayText: { "zh-CN": "6 个月" },
			conservativeDays: 168
		},
		itemIdSource: "displayName"
	};

//#endregion
//#region plugins/starrail/hooks.ts
	const hooks$2 = { deriveRecordKey: (record) => {
		if (!record.stableId) throw new Error(`星铁记录缺少 stableId（服务端雪花 ID），无法生成稳定的 record_key：itemId="${record.itemId}"`);
		return `${record.bannerId}:${record.stableId}`;
	} };

//#endregion
//#region plugins/starrail/manifest.ts
/**
	* 从 `getGachaLog`/`getLdGachaLog` 响应体里取出本页记录数组。
	*
	* 真实响应形态是 `{ retcode, message, data: { list: [...], region, region_time_zone } }`
	* ——与原神同构，`region`/`region_time_zone` 与 `list` 同级，是页级元数据，
	* 不是逐条记录字段（`research/03` §2.3；`star-rail-warp-export/src/main/
	* getData.js:226-234` 的 `const { list, uid, region, region_time_zone } =
	* await getGachaLogs(...)` 印证三者从同一个 `res?.data` 对象解构而来）。
	* 防御式解析：任何一层形状不对就返回空数组而不是抛异常——分页引擎会把空数组
	* 当作 `emptyPage` 终止条件处理，比让一次偶发的畸形响应中断整条采集流程更安全。
	*/
	function extractGachaLogList$1(response) {
		if (typeof response !== "object" || response === null) return [];
		const data = response.data;
		if (typeof data !== "object" || data === null) return [];
		const list = data.list;
		return Array.isArray(list) ? list : [];
	}
	/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
	function toNonEmptyString$2(value) {
		if (typeof value !== "string") return void 0;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : void 0;
	}
	/** 官方响应里的 `count` 是数字字符串（如 `"1"`），防御式转换，异常输入兜底为 1。 */
	function toCount$2(value) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 1;
	}
	/** 角色类池（硬保底 90）的软保底曲线：74 抽起、每抽 +6%，同人社区口径。 */
	const CHARACTER_SOFT_PITY_CURVE = {
		kind: "softPity",
		base: .006,
		start: 74,
		step: .06
	};
	/** 光锥类池（硬保底 80）的软保底曲线：按角色池口径等比例外推，65 抽起、每抽 +7%。 */
	const LIGHT_CONE_SOFT_PITY_CURVE = {
		kind: "softPity",
		base: .008,
		start: 65,
		step: .07
	};
	const manifest$2 = {
		id: "starrail",
		displayName: { "zh-CN": "崩坏：星穹铁道" },
		sdkVersion: "1.0.0",
		platforms: ["windows"],
		maintainers: ["gacha-studio"],
		iconUrl: "https://img-tc.tapimg.com/market/images/1b7385da5dbf6d5342a832e6685e2066.png/_tap_appicon_m.jpg",
		collect: {
			paradigm: "credentialedApi",
			params: {
				credential: {
					kind: "chromiumCache",
					gameDir: "StarRail_Data/webCaches",
					urlPattern: /https:\/\/.+?getGachaLog[^"]+/
				},
				request: { url: "{{credential}}&page={{page}}&gacha_type={{gachaType}}&size={{pageSize}}&end_id=0" },
				allowedHosts: ["public-operation-hkrpg.mihoyo.com", "public-operation-hkrpg-sg.hoyoverse.com"],
				extractList: extractGachaLogList$1,
				rateLimit: {
					perPageDelayMs: 300,
					batchSize: 10,
					batchDelayMs: 1e3,
					retry: {
						maxAttempts: 5,
						delayMs: 5e3
					}
				}
			}
		},
		fields: { extractRecord: (raw) => {
			if (typeof raw !== "object" || raw === null) throw new Error("星铁 extractRecord 收到非对象形态的原始记录");
			const record = raw;
			const itemId = toNonEmptyString$2(record.item_id);
			if (!itemId) throw new Error("星铁 extractRecord：记录缺少 item_id，无法确定 itemId");
			return {
				itemId,
				time: toNonEmptyString$2(record.time) ?? "",
				bannerId: toNonEmptyString$2(record.gacha_type) ?? "",
				count: toCount$2(record.count),
				name: toNonEmptyString$2(record.name),
				itemType: toNonEmptyString$2(record.item_type),
				rarity: toNonEmptyString$2(record.rank_type),
				stableId: toNonEmptyString$2(record.id)
			};
		} },
		banners: [
			{
				id: "1",
				displayName: { "zh-CN": "群星跃迁" }
			},
			{
				id: "2",
				displayName: { "zh-CN": "始发跃迁" }
			},
			{
				id: "11",
				displayName: { "zh-CN": "角色活动跃迁" }
			},
			{
				id: "12",
				displayName: { "zh-CN": "光锥活动跃迁" }
			},
			{
				id: "21",
				displayName: { "zh-CN": "角色联动跃迁" },
				endpointOverride: "getLdGachaLog"
			},
			{
				id: "22",
				displayName: { "zh-CN": "光锥联动跃迁" },
				endpointOverride: "getLdGachaLog"
			}
		],
		pityGroups: [
			{
				key: "characterEventWarp",
				members: ["11"],
				hardPity: 90,
				curve: CHARACTER_SOFT_PITY_CURVE,
				guarantee: { kind: "fiftyFifty" }
			},
			{
				key: "lightConeEventWarp",
				members: ["12"],
				hardPity: 80,
				curve: LIGHT_CONE_SOFT_PITY_CURVE,
				guarantee: {
					kind: "weighted",
					rateUpChance: .75
				}
			},
			{
				key: "stellarWarp",
				members: ["1"],
				hardPity: 90,
				curve: CHARACTER_SOFT_PITY_CURVE,
				guarantee: { kind: "none" }
			},
			{
				key: "departureWarp",
				members: ["2"],
				hardPity: 50,
				curve: {
					kind: "custom",
					id: "starrail-unconfirmed-softpity-pool-2"
				},
				guarantee: { kind: "none" }
			},
			{
				key: "characterEventWarpCollab",
				members: ["21"],
				hardPity: 90,
				curve: CHARACTER_SOFT_PITY_CURVE,
				guarantee: { kind: "fiftyFifty" }
			},
			{
				key: "lightConeEventWarpCollab",
				members: ["22"],
				hardPity: 80,
				curve: LIGHT_CONE_SOFT_PITY_CURVE,
				guarantee: {
					kind: "weighted",
					rateUpChance: .75
				}
			}
		],
		rarity: {
			ladder: [
				"3",
				"4",
				"5"
			],
			pityTarget: "5"
		},
		time: {
			rawTimeConvention: "serverLocal",
			timezoneSource: {
				kind: "apiField",
				field: "region_time_zone"
			}
		},
		preconditions: [{
			id: "starrail.credential.cacheDirExists",
			capability: "credential",
			level: "required",
			describe: { "zh-CN": "自动获取跃迁记录要求游戏客户端至少运行过一次，缓存目录才会被创建" },
			check: () => ({ kind: "unknown" }),
			remedy: { "zh-CN": "请先启动游戏并打开一次跃迁记录页，再回到本应用重试" }
		}],
		baseline: { kind: "inGamePageCount" },
		retention: {
			displayText: { "zh-CN": "6 个月" },
			conservativeDays: 168
		}
	};

//#endregion
//#region plugins/wuwa/hooks.ts
/**
	* 把 API 响应的 `time` 字段规范化成与线格式无关、可直接按字符串比较大小的
	* 形式（`YYYYMMDDHHmmss`，14 位纯数字）。
	*
	* `2024-06-06T10:23:48` 与 `2024/06/06 10:23:48` 归一后都是
	* `"20240606102348"`——用正则拆出年/月/日/时/分/秒六个数字分量再拼接，
	* 分隔符本身（`-`/`/`/`T`/空格）被正则直接吃掉、不影响归一化结果。
	*
	* ⚠️ **不用 `new Date(...)` 解析**：`Date` 构造函数对不带时区后缀的字符串
	* 按*运行环境本地时区*解释，同一个字符串在不同机器/不同时区上跑出的
	* `Date` 对象代表的绝对时刻不同——这与"纯函数、结果只取决于输入"这条硬
	* 约束直接冲突（`PluginHooks.deriveRecordKeys` 必须是纯函数，TS 运行环境
	* 物理上也不提供能替代 `Date` 本地时区行为的时区数据库）。改用正则直接拆
	* 数字分量，不经过 `Date`，规范化结果与运行环境无关。
	*
	* ⚠️ **无法识别的格式必须报错，不能静默回落到原始字符串**：静默回落等于
	* "先归一化再哈希"这层保护完全不存在——本项目已经多次抓到"看起来有防护、
	* 实际什么都没做"这一类失效模式，这里不能重蹈。
	*
	* 目前只认两种已知候选格式（ISO 的 `-`/`T` 分隔、参考实现暗示的 `/`/空格
	* 分隔）；若未来真实抓包发现第三种格式，这里需要同步扩展正则，而不是放宽
	* 到"随便什么都收"。
	*/
	function normalizeTimeForKey(time) {
		const match = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/.exec(time);
		if (!match) throw new Error(`鸣潮 deriveRecordKeys：无法识别的时间格式 "${time}"——线格式未经抓包验证，拒绝在猜测的格式上计算 record_key`);
		const [, year, month, day, hour, minute, second] = match;
		return `${year}${month}${day}${hour}${minute}${second}`;
	}
	/**
	* FNV-1a 32 位哈希，纯位运算实现，不依赖任何 Node/Web 加密 API——TS 侧运行
	* 环境物理上不提供 `crypto`，插件代码只能用语言内置能力（`charCodeAt`/
	* `Math.imul`/移位运算，ES2022 标准 JS，任何遵循规范的引擎都能跑，包括宿主
	* 内嵌的 QuickJS）。
	*
	* 只对 ASCII 字符正确：本文件唯一的调用点传入的是
	* `JSON.stringify([bannerId, normalizedTime, itemId, seqInGroup])`，四个
	* 分量分别是纯数字字符串（PoolType id、`normalizeTimeForKey` 的输出、
	* `resourceId` 转的字符串、批次内序位）加 JSON 本身的标点，逐字符都在
	* ASCII 范围内，`charCodeAt` 与字节值一一对应，不需要处理多字节字符。
	*/
	function fnv1a32(input, offsetBasis) {
		let hash = offsetBasis >>> 0;
		for (let i = 0; i < input.length; i += 1) {
			hash ^= input.charCodeAt(i);
			hash = Math.imul(hash, 16777619) >>> 0;
		}
		return hash.toString(16).padStart(8, "0");
	}
	/** 标准 FNV-1a 32 位偏移基准。 */
	const FNV_OFFSET_BASIS_A = 2166136261;
	/**
	* 第二个偏移基准，只要求与 A 不同——用来把两次独立的 32 位哈希拼成一个
	* 16 位十六进制（64 位）的复合 key，降低单独一个 32 位哈希在几千条记录
	* 规模下的生日碰撞概率（`sqrt(2^32) ≈ 65536`，一个账号的记录数量级已经
	* 够不上放心只用 32 位）。取值本身没有特殊含义，只要求是一个与 A 不同的
	* 固定常量。
	*/
	const FNV_OFFSET_BASIS_B = 2654435769;
	/**
	* 计算单条记录的 `record_key`。
	*
	* 用 `JSON.stringify` 把四个分量序列化成一个数组字符串，而不是用分隔符
	* （如 `:`）手工拼接——`normalizedTime` 内部全是数字没有歧义，但 JSON 的
	* 转义规则能保证"不同的输入元组不会拼出同一个字符串"这条性质在任何未来
	* 分量类型变化时依然成立，比手工挑一个"看起来不会出现在字段里"的分隔符
	* 更可靠。
	*/
	function hashRecordKey(bannerId, normalizedTime, itemId, seqInGroup) {
		const canonical = JSON.stringify([
			bannerId,
			normalizedTime,
			itemId,
			seqInGroup
		]);
		return `${fnv1a32(canonical, FNV_OFFSET_BASIS_A)}${fnv1a32(canonical, FNV_OFFSET_BASIS_B)}`;
	}
	const hooks$1 = { deriveRecordKeys: (records) => {
		const total = records.length;
		if (total === 0) return [];
		const normalizedTimes = records.map((record) => normalizeTimeForKey(record.time));
		const firstTime = normalizedTimes[0];
		const lastTime = normalizedTimes[total - 1];
		if (firstTime === void 0 || lastTime === void 0) throw new Error("鸣潮 deriveRecordKeys 内部错误：无法取到首/尾记录的规范化时间");
		const isDescending = total > 1 && firstTime > lastTime;
		const ascendingOrder = new Array(total);
		for (let i = 0; i < total; i += 1) ascendingOrder[i] = isDescending ? total - 1 - i : i;
		const seqByGroup = /* @__PURE__ */ new Map();
		const keys = new Array(total);
		for (const originalIndex of ascendingOrder) {
			const record = records[originalIndex];
			const normalizedTime = normalizedTimes[originalIndex];
			if (record === void 0 || normalizedTime === void 0) throw new Error(`鸣潮 deriveRecordKeys 内部错误：下标 ${originalIndex} 处的记录或规范化时间缺失`);
			const groupKey = `${record.bannerId} ${normalizedTime} ${record.itemId}`;
			const seqInGroup = seqByGroup.get(groupKey) ?? 0;
			seqByGroup.set(groupKey, seqInGroup + 1);
			keys[originalIndex] = hashRecordKey(record.bannerId, normalizedTime, record.itemId, seqInGroup);
		}
		return keys;
	} };

//#endregion
//#region plugins/wuwa/manifest.ts
/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
	function toNonEmptyString$1(value) {
		if (typeof value !== "string") return void 0;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : void 0;
	}
	/**
	* 响应记录的 `resourceId`/`qualityLevel` 是 JSON number（`Models/GachaAPI.cs`
	* 的 `resourceId: int`、`qualityLevel: int`，且已被
	* `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §2.1 的真实存档字段类型统计
	* 独立证实），与米哈游三游"数字字符串"不同，因此单独一个转换函数。
	*/
	function numericToString(value) {
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
		if (typeof value === "string") {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : void 0;
		}
	}
	/**
	* `count: int`（`Models/GachaAPI.cs`，同上已被真实存档统计独立证实恒为同一
	* 整数取值）。防御式转换 + 异常兜底为 1，容忍响应形态与本机核实的样本不完全
	* 一致的情况。
	*/
	function toCount$1(value) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 1;
	}
	/**
	* 从 `POST gmserver-api.aki-game2.com/gacha/record/query` 响应体取出该
	* PoolType 的全部记录数组。
	*
	* ⚠️ **响应外层信封形态本身研究未覆盖**：`Models/GachaAPI.cs` 给出的是单条
	* 记录的 DTO 字段，没有给出响应外层信封的完整 JSON 形态；本机没有鸣潮 API
	* 的真实抓包样本。这里防御式兼容米哈游三游同族插件常见的两种信封
	* （`{ data: [...] }` 与 `{ data: { list: [...] } }`），两者都是**类比**，
	* 不是已核实事实，任何一层形状不对就返回空数组而不是抛异常——分页引擎会把
	* 空数组当作终止条件处理，比让一次响应形态不符直接中断整条采集流程更安全。
	*/
	function extractGachaRecordList(response) {
		if (typeof response !== "object" || response === null) return [];
		const data = response.data;
		if (Array.isArray(data)) return data;
		if (typeof data === "object" && data !== null) {
			const list = data.list;
			if (Array.isArray(list)) return list;
		}
		return [];
	}
	/**
	* 13 项 `PoolType` 表，逐字段取自 `Services/ConfigService.cs:29-43` 原样表格：
	*   `(PoolType, 名称, 是否新手池, 5★硬保底, 4★硬保底, 保底是否继承)`
	*
	* 本表保留真正用得上的三列：id / displayName / hardPity5Star，外加
	* `fiveStarGuaranteeKind`（本插件自行归纳，不在 `ConfigService.cs` 原表里，
	* 见下方单独说明）。4★ 硬保底恒为 10（见下方 `WUWA_4STAR_HARD_PITY`），不再
	* 需要逐行区分。「是否新手池」「保底是否继承」两列目前的插件契约里没有对应
	* 字段可以承载，「是否继承」这一列即使有字段也无法正确实现，见下方
	* `pityGroups` 一节的"已知缺口"说明。
	*
	* `fiveStarGuaranteeKind` 取值依据（`docs/_internal/milestones/
	* 03-M2-鸣潮插件与抽象证伪.md` §4.4："角色池 50/50，武器池必中不歪"）：
	*   - 5 个「角色」池（id 1/3/8/10/12）取 `fiftyFifty`——依据是把 §4.4「角色池
	*     50/50」这条通用结论按「角色卡池」大类应用，不是对常驻/新旅/联动/忆旅
	*     这些子类型逐一单独验证过。
	*   - 5 个「武器」池（id 2/4/9/11/13）取 `alwaysRateUp`——同上，按「武器卡池」
	*     大类应用。
	*
	*   ⚠️ 严格说，只有「角色活动唤取」「武器活动唤取」（id 1/2）这两个子类型
	*   在 §4.4 里有直接对照，其余 8 个是**同类推广**。推广本身是合理的领域推断
	*   （担保规则在鸣潮里按物品大类而非按卡池子类型划分），但它没有逐池实测
	*   背书——若日后某个子类型被发现规则不同，改这一列即可，不必动任何逻辑。
	*   - 3 个「新手」池（id 5/6/7）取 `none`——**没有任何实测依据**，只是沿用
	*     此前用池名字符串匹配时的现状（池名不含"角色"也不含"武器"，匹配不上
	*     任何一支才落到 `none`），逐行标注 `// 无实测依据，沿用现状`。
	*
	* 之前是从 `pool.name` 用 `.includes("角色")`/`.includes("武器")` 现场推导
	* 这个值，这里改成显式列出——显示名是给人看的，不该承担"决定保底语义"这个
	* 职责：改一个字、或出现同时含/都不含这两个词的池名，语义会静默改变；固化
	* 成表格后每一行的取值直接可读，不用跳到别处反推。
	*/
	const WUWA_POOL_TYPES = [
		{
			id: "1",
			name: "角色活动唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "fiftyFifty"
		},
		{
			id: "2",
			name: "武器活动唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "alwaysRateUp"
		},
		{
			id: "3",
			name: "角色常驻唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "fiftyFifty"
		},
		{
			id: "4",
			name: "武器常驻唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "alwaysRateUp"
		},
		{
			id: "5",
			name: "新手唤取",
			hardPity5Star: 50,
			fiveStarGuaranteeKind: "none"
		},
		{
			id: "6",
			name: "新手自选唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "none"
		},
		{
			id: "7",
			name: "新手自选唤取（感恩定向唤取）",
			hardPity5Star: 1,
			fiveStarGuaranteeKind: "none"
		},
		{
			id: "8",
			name: "角色新旅唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "fiftyFifty"
		},
		{
			id: "9",
			name: "武器新旅唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "alwaysRateUp"
		},
		{
			id: "10",
			name: "角色联动唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "fiftyFifty"
		},
		{
			id: "11",
			name: "武器联动唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "alwaysRateUp"
		},
		{
			id: "12",
			name: "角色忆旅唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "fiftyFifty"
		},
		{
			id: "13",
			name: "武器忆旅唤取",
			hardPity5Star: 80,
			fiveStarGuaranteeKind: "alwaysRateUp"
		}
	];
	/** 4★ 硬保底，全部 13 项 PoolType 共用同一个值（`ConfigService.cs` 第 5 列恒为 10）。 */
	const WUWA_4STAR_HARD_PITY = 10;
	/** `fiveStarGuaranteeKind` → 实际 `GuaranteeRule` 字面量对象（P2 表）。 */
	const WUWA_FIVE_STAR_GUARANTEE_BY_KIND = {
		fiftyFifty: { kind: "fiftyFifty" },
		alwaysRateUp: { kind: "alwaysRateUp" },
		none: { kind: "none" }
	};
	/**
	* 从日志行提取 gachaLink 的正则，逐字取自参考实现
	* （`UpdateGachaDataDialogViewModel.cs` 的 `Regex.Match` 调用）：
	*   `(https?.*\/aki\/gacha\/index\.html#\/record[\?=&\w\-]+)`
	*
	* 按行**倒序**扫描、命中第一个即停这件事完全是 Rust L1
	* （`crate::cache_scan`）的实现细节，本正则只声明匹配模式本身，插件侧不需要
	* （也不能）声明扫描方向。
	*/
	const WUWA_GACHA_LINK_PATTERN = /(https?.*\/aki\/gacha\/index\.html#\/record[\?=&\w\-]+)/;
	/**
	* 5★ 渐进概率曲线的**粗粒度近似**，只对硬保底 80 的池子成立
	* （1/2/3/4/6/8/9/10/11/12/13——即除 5、7 之外的全部）。
	*
	* 数值直接取自 `AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §3.3（PoolType
	* 1/2/4 合并、按 10 抽分桶的真实命中率，不是逐抽拟合出来的曲线）：
	*   1~60 抽：命中率在 0.5%~1.9% 之间波动，该文档判定为小样本噪声，
	*            六个分桶均值 ≈0.93%，四舍五入取 1% 作为 base
	*   61~70 抽：6.9%（317 个样本、22 次命中）
	*   71~80 抽：48.1%（27 个样本、13 次命中，**置信区间极宽**——样本量小，
	*             这个数字本身就有很大不确定性，不要当成精确值使用）
	*
	* `crates/gs-analysis/src/pity.rs` 的 `evaluate_curve` 对 `Progressive` 的
	* 语义是「`table` 每个元素对应一抽」：`pull_index <= start` 时取 `base`，
	* `pull_index > start` 时取 `table[pull_index - start - 1]`（即 `table[0]`
	* 对应第 `start + 1` 抽），下标越界钳制到最后一个元素——这条曲线现在会被
	* 真实消费，不再是占位声明。按这个语义，下面 20 个元素是把上面两个 10 抽
	* 分桶**逐抽展开**：第 61~70 抽（`table[0..9]`）取 6.9%，第 71~80 抽
	* （`table[10..19]`）取 48.1%。
	*
	* ⚠️ **这是分段常数展开，不是逐抽标定**：桶内每一抽取同一个值是一个显式的
	* 建模选择，信息量与原始分桶数据完全相同，没有凭空编造任何新信息；但真实
	* 曲线在桶内大概率是单调上升的（越接近保底命中率越高），分段常数会让桶的
	* 前几抽概率偏高、后几抽偏低，这是已知的近似误差，不是错误数据。等有逐抽
	* 精细样本（尤其是 71~80 抽这一桶，27 个样本撑不起精确曲线）再替换。
	*/
	const WUWA_FIVE_STAR_PROGRESSIVE_CURVE = {
		kind: "progressive",
		base: .01,
		start: 60,
		table: [...Array(10).fill(.069), ...Array(10).fill(.481)]
	};
	/**
	* 按 PoolType 分派 5★ 曲线。
	*
	* - PoolType 7（新手自选唤取·感谢定向唤取）：硬保底 = 1，数学上直接等价于
	*   "每次唤取都必出 5★"，不是猜测——硬保底数值本身决定的，不依赖任何实测
	*   样本。
	* - PoolType 5（新手唤取，硬保底 50）：真实存档实测该池 **0 条记录**
	*   （`AUDIT-2026-08-12-M2鸣潮真实存档实测.md` §1.2 "空槽位"列出 5 在内），
	*   而 `WUWA_FIVE_STAR_PROGRESSIVE_CURVE` 的曲线形状是从硬保底 80 的三个池
	*   （1/2/4）实测数据里推出的——渐进曲线理应随硬保底位置本身变化（保底 50
	*   的池子不可能在第 60 抽才开始"跃升"，那已经超过硬保底本身），把 80 硬
	*   保底池子的曲线直接套到 50 硬保底的池子上是没有证据支持的外推，因此
	*   本池仍用 custom 占位，不外推。
	* - 其余全部硬保底 80 的池子：共用同一条 `WUWA_FIVE_STAR_PROGRESSIVE_CURVE`
	*   ——只有 1/2/4 三个池有真实样本，其余同硬保底池子没有独立样本，但也没有
	*   任何理由认为它们的曲线形状不同，用同一条曲线是"用仅有的证据一致地应用"，
	*   不是逐池编造出互不相同的数字。
	*/
	function fiveStarCurve(pool) {
		if (pool.hardPity5Star === 1) return {
			kind: "flat",
			base: 1
		};
		if (pool.hardPity5Star !== 80) return {
			kind: "custom",
			id: `wuwa-unconfirmed-5star-pool-${pool.id}`
		};
		return WUWA_FIVE_STAR_PROGRESSIVE_CURVE;
	}
	const manifest$1 = {
		id: "wuwa",
		displayName: { "zh-CN": "鸣潮" },
		sdkVersion: "1.0.0",
		platforms: ["windows"],
		maintainers: ["gacha-studio"],
		iconUrl: "https://img-tc.tapimg.com/market/images/a465e34f0e4afb3631e8ee5b1f02c992.png/_tap_appicon_m.jpg",
		collect: {
			paradigm: "credentialedApi",
			params: {
				credential: {
					kind: "logFile",
					logPath: "Client/Saved/Logs/Client.log",
					urlPattern: WUWA_GACHA_LINK_PATTERN,
					decode: {
						kind: "xorByLowBit",
						skipBytes: 3,
						maskWhenOdd: 165,
						maskWhenEven: 239
					}
				},
				request: {
					url: "https://gmserver-api.aki-game2.com/gacha/record/query",
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"User-Agent": "Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36"
					},
					body: "{\"cardPoolId\":\"{{credential.resources_id}}\",\"cardPoolType\":{{gachaType}},\"languageCode\":\"{{credential.lang}}\",\"playerId\":{{credential.player_id}},\"recordId\":\"{{credential.record_id}}\",\"serverId\":\"{{credential.svr_id}}\"}"
				},
				allowedHosts: ["gmserver-api.aki-game2.com"],
				extractList: extractGachaRecordList,
				stopCondition: { kind: "singleRequest" },
				bannerIdentity: "query"
			}
		},
		fields: { extractRecord: (raw) => {
			if (typeof raw !== "object" || raw === null) throw new Error("鸣潮 extractRecord 收到非对象形态的原始记录");
			const record = raw;
			const itemId = numericToString(record.resourceId);
			if (!itemId) throw new Error("鸣潮 extractRecord：记录缺少 resourceId，无法确定 itemId");
			return {
				itemId,
				time: toNonEmptyString$1(record.time) ?? "",
				bannerId: "wuwa-banner-identity-not-derivable-from-response",
				count: toCount$1(record.count),
				name: toNonEmptyString$1(record.name),
				itemType: toNonEmptyString$1(record.resourceType),
				rarity: numericToString(record.qualityLevel)
			};
		} },
		banners: WUWA_POOL_TYPES.map((pool) => ({
			id: pool.id,
			displayName: { "zh-CN": pool.name }
		})),
		pityGroups: WUWA_POOL_TYPES.flatMap((pool) => [{
			key: `${pool.id}-5star`,
			members: [pool.id],
			hardPity: pool.hardPity5Star,
			curve: fiveStarCurve(pool),
			guarantee: WUWA_FIVE_STAR_GUARANTEE_BY_KIND[pool.fiveStarGuaranteeKind]
		}, {
			key: `${pool.id}-4star`,
			members: [pool.id],
			hardPity: WUWA_4STAR_HARD_PITY,
			pityTarget: "4",
			curve: {
				kind: "custom",
				id: `wuwa-unconfirmed-4star-pool-${pool.id}`
			},
			guarantee: { kind: "none" }
		}]),
		rarity: {
			ladder: [
				"3",
				"4",
				"5"
			],
			pityTarget: "5"
		},
		time: {
			rawTimeConvention: "serverLocal",
			rawFormat: { kind: "isoLocal" }
		},
		preconditions: [{
			id: "wuwa.credential.logHasGachaLink",
			capability: "credential",
			level: "required",
			describe: { "zh-CN": "自动获取唤取记录要求打开过一次游戏内的唤取详情页，且需要在链接有效期内立即导出" },
			check: () => ({ kind: "unknown" }),
			remedy: { "zh-CN": "请在游戏内打开唤取详情页后，立即回到本应用重试（链接有效期未经实测确认，按最短情况处理）" }
		}]
	};

//#endregion
//#region plugins/zzz/hooks.ts
	const hooks = { deriveRecordKey: (record) => {
		if (!record.stableId) throw new Error(`绝区零记录缺少 stableId（服务端雪花 ID），无法生成稳定的 record_key：itemId="${record.itemId}"`);
		return `${record.bannerId}:${record.stableId}`;
	} };

//#endregion
//#region plugins/zzz/manifest.ts
/**
	* 从 `getGachaLog` 响应体里取出本页记录数组。
	*
	* 真实响应形态 `{ retcode, message, data: { list: [...], region } }` 与原神
	* 完全同构，已用 `zzz-signal-search-export/src/main/getData.js:203-204`
	* （`res?.data?.list` 判空、`res.region` 取值）核实，不是类比推断。防御式
	* 解析：任何一层形状不对就返回空数组而不是抛异常，交给分页引擎按空页处理。
	*/
	function extractGachaLogList(response) {
		if (typeof response !== "object" || response === null) return [];
		const data = response.data;
		if (typeof data !== "object" || data === null) return [];
		const list = data.list;
		return Array.isArray(list) ? list : [];
	}
	/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
	function toNonEmptyString(value) {
		if (typeof value !== "string") return void 0;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : void 0;
	}
	/** 官方响应里的 `count` 是数字字符串（真实存档实测恒为 `"1"`），防御式转换，异常输入兜底为 1。 */
	function toCount(value) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 1;
	}
	const EXCLUSIVE_CURVE = {
		kind: "softPity",
		base: .006,
		start: 74,
		step: .06
	};
	const W_ENGINE_CURVE = {
		kind: "softPity",
		base: .01,
		start: 65,
		step: .07
	};
	const manifest = {
		id: "zzz",
		displayName: { "zh-CN": "绝区零" },
		sdkVersion: "1.0.0",
		platforms: ["windows"],
		maintainers: ["gacha-studio"],
		iconUrl: "https://img-tc.tapimg.com/market/images/cca4b17d6dd9030037095c19aa9fe78a.png/_tap_appicon_m.jpg",
		collect: {
			paradigm: "credentialedApi",
			params: {
				credential: {
					kind: "chromiumCache",
					gameDir: "ZenlessZoneZero_Data/webCaches",
					urlPattern: /https:\/\/.+?getGachaLog[^"]+/
				},
				request: { url: "{{credential}}&page={{page}}&real_gacha_type={{gachaType}}&size={{pageSize}}&end_id=0" },
				allowedHosts: ["public-operation-nap.mihoyo.com", "public-operation-nap-sg.hoyoverse.com"],
				extractList: extractGachaLogList,
				rateLimit: {
					perPageDelayMs: 300,
					batchSize: 10,
					batchDelayMs: 1e3,
					retry: {
						maxAttempts: 5,
						delayMs: 5e3
					}
				}
			}
		},
		fields: { extractRecord: (raw) => {
			if (typeof raw !== "object" || raw === null) throw new Error("绝区零 extractRecord 收到非对象形态的原始记录");
			const record = raw;
			const itemId = toNonEmptyString(record.item_id);
			if (!itemId) throw new Error("绝区零 extractRecord：记录缺少 item_id，无法确定 itemId");
			return {
				itemId,
				time: toNonEmptyString(record.time) ?? "",
				bannerId: toNonEmptyString(record.gacha_type) ?? "",
				count: toCount(record.count),
				name: toNonEmptyString(record.name),
				itemType: toNonEmptyString(record.item_type),
				rarity: toNonEmptyString(record.rank_type),
				stableId: toNonEmptyString(record.id)
			};
		} },
		banners: [
			{
				id: "1",
				displayName: { "zh-CN": "常驻频段" }
			},
			{
				id: "2",
				displayName: { "zh-CN": "独家频段" }
			},
			{
				id: "3",
				displayName: { "zh-CN": "音擎频段" }
			},
			{
				id: "5",
				displayName: { "zh-CN": "邦布频段" }
			},
			{
				id: "102",
				displayName: { "zh-CN": "独家重映" }
			},
			{
				id: "103",
				displayName: { "zh-CN": "音擎回响" }
			}
		],
		pityGroups: [
			{
				key: "exclusiveChannel",
				members: ["2"],
				hardPity: 90,
				curve: EXCLUSIVE_CURVE,
				guarantee: { kind: "fiftyFifty" }
			},
			{
				key: "wEngineChannel",
				members: ["3"],
				hardPity: 80,
				curve: W_ENGINE_CURVE,
				guarantee: {
					kind: "weighted",
					rateUpChance: .75
				}
			},
			{
				key: "standardChannel",
				members: ["1"],
				hardPity: 90,
				curve: EXCLUSIVE_CURVE,
				guarantee: { kind: "none" }
			},
			{
				key: "bangbooChannel",
				members: ["5"],
				hardPity: 80,
				curve: W_ENGINE_CURVE,
				guarantee: { kind: "alwaysRateUp" }
			},
			{
				key: "exclusiveChannelRerun",
				members: ["102"],
				hardPity: 90,
				curve: EXCLUSIVE_CURVE,
				guarantee: { kind: "fiftyFifty" }
			},
			{
				key: "wEngineChannelEcho",
				members: ["103"],
				hardPity: 80,
				curve: W_ENGINE_CURVE,
				guarantee: {
					kind: "weighted",
					rateUpChance: .75
				}
			}
		],
		rarity: {
			ladder: [
				"2",
				"3",
				"4"
			],
			pityTarget: "4"
		},
		time: {
			rawTimeConvention: "serverLocal",
			timezoneSource: {
				kind: "staticTable",
				field: "region",
				table: {
					prod_gf_cn: 8,
					prod_gf_jp: 8,
					prod_gf_us: -5,
					prod_gf_eu: 1,
					prod_gf_sg: 8
				}
			}
		},
		baseline: { kind: "inGamePageCount" },
		retention: {
			displayText: { "zh-CN": "6 个月" },
			conservativeDays: 168
		}
	};

//#endregion
//#region \0gs-plugins-entry
	globalThis.__gs_plugins = globalThis.__gs_plugins || {};
	globalThis.__gs_plugins[manifest$3.id] = {
		manifest: manifest$3,
		hooks: hooks$3
	};
	globalThis.__gs_plugins[manifest$2.id] = {
		manifest: manifest$2,
		hooks: hooks$2
	};
	globalThis.__gs_plugins[manifest$1.id] = {
		manifest: manifest$1,
		hooks: hooks$1
	};
	globalThis.__gs_plugins[manifest.id] = {
		manifest,
		hooks
	};
	globalThis.__gs_resolvePath = function(pluginId, pathStr) {
		const plugin = globalThis.__gs_plugins && globalThis.__gs_plugins[pluginId];
		if (!plugin) throw new Error("插件 \"" + pluginId + "\" 未注册（globalThis.__gs_plugins 中不存在）");
		const segments = pathStr.split(".");
		let target = plugin;
		let parent = null;
		for (const seg of segments) {
			if (target === null || target === void 0) throw new Error("路径 \"" + pathStr + "\" 在插件 \"" + pluginId + "\" 上不存在（在段 \"" + seg + "\" 处中断）");
			parent = target;
			target = target[seg];
		}
		return {
			value: target,
			thisArg: parent
		};
	};
	globalThis.__gs_has = function(pluginId, pathStr) {
		try {
			return typeof globalThis.__gs_resolvePath(pluginId, pathStr).value === "function";
		} catch (err) {
			return false;
		}
	};
	globalThis.__gs_call = function(pluginId, pathStr, argsJson) {
		const resolved = globalThis.__gs_resolvePath(pluginId, pathStr);
		if (typeof resolved.value !== "function") throw new Error("路径 \"" + pathStr + "\" 未指向一个函数（实际类型 " + typeof resolved.value + "）");
		const args = JSON.parse(argsJson);
		const result = resolved.value.apply(resolved.thisArg, args);
		return JSON.stringify(result === void 0 ? null : result);
	};

//#endregion
})();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiX2dzLXBsdWdpbnMtZW50cnkuanMiLCJuYW1lcyI6WyJob29rcyIsImV4dHJhY3RHYWNoYUxvZ0xpc3QiLCJ0b05vbkVtcHR5U3RyaW5nIiwidG9Db3VudCIsIm1hbmlmZXN0IiwiaG9va3MiLCJleHRyYWN0R2FjaGFMb2dMaXN0IiwidG9Ob25FbXB0eVN0cmluZyIsInRvQ291bnQiLCJtYW5pZmVzdCIsImhvb2tzIiwidG9Ob25FbXB0eVN0cmluZyIsInRvQ291bnQiLCJtYW5pZmVzdCJdLCJzb3VyY2VzIjpbIi4uL3BsdWdpbnMvZ2Vuc2hpbi9ob29rcy50cyIsIi4uL3BsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50cyIsIi4uL3BsdWdpbnMvc3RhcnJhaWwvaG9va3MudHMiLCIuLi9wbHVnaW5zL3N0YXJyYWlsL21hbmlmZXN0LnRzIiwiLi4vcGx1Z2lucy93dXdhL2hvb2tzLnRzIiwiLi4vcGx1Z2lucy93dXdhL21hbmlmZXN0LnRzIiwiLi4vcGx1Z2lucy96enovaG9va3MudHMiLCIuLi9wbHVnaW5zL3p6ei9tYW5pZmVzdC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIOWOn+elnuaPkuS7tueahOmAg+eUn+iIsSBob29rc+OAglxuICpcbiAqIOS4pOS4qiBob29rIOWdh+S4jeWPr+ecgeeVpe+8mlxuICpcbiAqIC0gYHJlc29sdmVUaW1lem9uZWDvvJrnsbPlk4jmuLggYGdldEdhY2hhTG9nYCDlk43lupTkuI3luKbku7vkvZXml7bljLrlrZfmrrXvvIjml6Lml6AgYHJlZ2lvbmBcbiAqICAg5Lmf5pegIGByZWdpb25fdGltZV96b25lYO+8ie+8jOWPquiDveaMiSBVSUQg6aaW5L2N5pWw5a2X5o6o5pat5pyN5Yqh5Zmo5omA5Zyo5pe25Yy644CCXG4gKiAgIOWPguiAg+WunueOsOW3sueUqOS4ieaWueW3peWFt+a6kOeggeaguOWunu+8mmB1aWRbMF09PT0nNifihpItNSwgJzcn4oaSMSwgZWxzZSA4YFxuICogICDvvIhkb2NzL19pbnRlcm5hbC9yZXNlYXJjaC8wNC3lkIzml4/lt6XlhbfkuInmlrnmupDnoIHlr7nmr5QubWQgwqc0LjTvvInjgIJcbiAqIC0gYGRlcml2ZVJlY29yZEtleWDvvJrmnI3liqHnq6/pm6roirEgSUQg5LiN5ZCr5Y2h5rGg57u05bqm44CC5Y+C6ICD5a6e546wIEhvWW8uR2FjaGEg5LiK57q/5pe2XG4gKiAgIOS4u+mUruaYryBgKGJ1c2luZXNzLCB1aWQsIGlkKWDvvIzkuIDlubTlkI7kuLrmmJ/pk4HogZTliqjmsaAgYGdldExkR2FjaGFMb2dgIOihpeS6huS4gOasoVxuICogICDmlbTooajph43lu7rov4Hnp7vvvIzmlLnmiJAgYChidXNpbmVzcywgdWlkLCBpZCwgZ2FjaGFfdHlwZSlg4oCU4oCUU1FMaXRlIOaUueS4jeS6huS4u+mUru+8jFxuICogICDov5nkuKrku6Pku7fkuI3or6XnlZnliLDku6XlkI7miY3ooaXjgILnsbPlk4jmuLjkuInmuLjkuIDlvovmjInlkIzkuIDop4TliJnlrp7njrDmnKwgaG9va++8jOWNs+S9v+WOn+elnlxuICogICDnm67liY3lj6rmnInljZXkuIDnq6/ngrnjgIHlsJrmnKrop4LmtYvliLDot6jnq6/ngrnpm6roirEgSUQg56Kw5pKe77yM5Lmf5LiN5L6L5aSWXG4gKiAgIO+8iHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvbWFuaWZlc3QudHMg55qEIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlgIOaWh+aho++8ieOAglxuICovXG5pbXBvcnQgdHlwZSB7IFBsdWdpbkhvb2tzIH0gZnJvbSBcImdzLXBsdWdpbi1raXRcIjtcblxuZXhwb3J0IGNvbnN0IGhvb2tzOiBQbHVnaW5Ib29rcyA9IHtcbiAgcmVzb2x2ZVRpbWV6b25lOiAoX3JlY29yZCwgY3R4KSA9PiB7XG4gICAgY29uc3QgZmlyc3REaWdpdCA9IGN0eC51aWQudHJpbSgpLmNoYXJBdCgwKTtcbiAgICBpZiAoZmlyc3REaWdpdCA9PT0gXCI2XCIpIHJldHVybiAtNTsgLy8g576O5pyNXG4gICAgaWYgKGZpcnN0RGlnaXQgPT09IFwiN1wiKSByZXR1cm4gMTsgLy8g5qyn5pyNXG4gICAgcmV0dXJuIDg7IC8vIOWbveacjSAvIOS6muacjeetieWFtuS9meWMuuacje+8jOWQq+acquefpeWMuuacjeeahOS/neWuiOm7mOiupOWAvFxuICB9LFxuXG4gIGRlcml2ZVJlY29yZEtleTogKHJlY29yZCkgPT4ge1xuICAgIGlmICghcmVjb3JkLnN0YWJsZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGDljp/npZ7orrDlvZXnvLrlsJEgc3RhYmxlSWTvvIjmnI3liqHnq6/pm6roirEgSUTvvInvvIzml6Dms5XnlJ/miJDnqLPlrprnmoQgcmVjb3JkX2tlee+8mml0ZW1JZD1cIiR7cmVjb3JkLml0ZW1JZH1cImAsXG4gICAgICApO1xuICAgIH1cbiAgICAvLyDljp/lp4sgZ2FjaGFfdHlwZe+8iOWPr+iDveaYryBcIjQwMFwiIOi/meexu+S4jeWPr+WNleeLrOafpeivoueahOWQiOW5tuWtkOexu+Wei++8iSsg5pyN5Yqh56uv6Zuq6IqxIElE77yMXG4gICAgLy8g5oqK5Y2h5rGg57u05bqm5bm26L+b5Y6777yM6YG/5YWN6Leo56uv54K55Zy65pmv5LiL6KO46Zuq6IqxIElEIOaSnumUruWQjuiiqyBJTlNFUlQgT1IgSUdOT1JFIOmdmem7mOS4ouW8g+OAglxuICAgIHJldHVybiBgJHtyZWNvcmQuYmFubmVySWR9OiR7cmVjb3JkLnN0YWJsZUlkfWA7XG4gIH0sXG59O1xuIiwiLyoqXG4gKiDljp/npZ7mj5Lku7YgbWFuaWZlc3TjgIJcbiAqXG4gKiDph4fpm4bojIPlvI/vvJphdXRoa2V577yIYGdzLXAtYXV0aGtleWDvvInvvIzlh63mja7mnaXmupDmmK/muLjmiI/lhoXnva4gQ2hyb21pdW0g57uE5Lu255qEXG4gKiDno4Hnm5jnvJPlrZjigJTigJTnjqnlrrbmiZPlvIDnpYjmhL/orrDlvZXpobXml7bvvIzlrqLmiLfnq6/kvJrku6Ugd2VidmlldyDliqDovb3orrDlvZXpobXpnaLvvIzlhbbkuK3kuIDmrKFcbiAqIOivt+axguS8muWRveS4reWumOaWuSBgZ2V0R2FjaGFMb2dgIOaOpeWPo+W5tuW4puS4iiBgYXV0aGtleWDvvIzov5nkuKror7fmsYIgVVJMIOS8muiiq+WGmeWFpVxuICogYHdlYkNhY2hlc2Ag55uu5b2V5LiL5p+Q5Liq54mI5pys5Y+35a2Q55uu5b2V5YaF55qEIGBDYWNoZS9DYWNoZV9EYXRhL2RhdGFfMmAg57yT5a2Y57Si5byV5paH5Lu2XG4gKiDvvIjms6jmhI/vvJpKU0RvYyDms6jph4rph4zkuI3og73lh7rnjrDlrZfpnaLph48gXCLmmJ/lj7cr5pac5p2gXCLvvIzmlYXmraTlpITkuI3lhpnpgJrphY3nrKblvaLlvI/nmoTot6/lvoTvvInjgIJcbiAqXG4gKiDlrZfmrrXlvaLnirbkuI7nnJ/lrp7ooYzkuLrlt7Llr7nnhafku6XkuIvotYTmlpnmoKHlh4bvvIzpgb/lhY3ph43ouYggYENMQVVERS5sb2NhbC5tZGAg6K6w5b2V6L+H55qEXG4gKiDjgIzmnKrmoKHlh4blsLHlhpnlrp7njrDjgI3nmoTplJnor6/vvIjpuKPmva7lh63mja7ot6/lvoTkuInlpITmjqjnv7vnmoTmlZnorq3vvInvvJpcbiAqIC0gZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDMt55yf5a6e5a+85Ye65pWw5o2u5qC85byP5a6e5rWLLm1kIMKn5LiA44CBwqfkuoxcbiAqIC0gZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDQt5ZCM5peP5bel5YW35LiJ5pa55rqQ56CB5a+55q+ULm1kIMKnNC4x772ewqc0LjlcbiAqIC0gZG9jcy9leGFtcGxlLXByb2plY3RzL2dlbnNoaW4td2lzaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qc++8iOWIhumhtS/lkIjlubYv6ZmQ6YCf5a6e546w77yJXG4gKiAtIGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9Ib1lvLkdhY2hhL2NyYXRlcy91cmxfc2NyYXBlci9zcmMvdHlwZXMucnPvvIhgR2FjaGFMb2dgIOWtl+auteWumuS5ie+8jFxuICogICDnoa7orqTljp/npZ4gQVBJIOWTjeW6lOmHjOayoeaciSBgaXRlbV9pZGAg5a2X5q614oCU4oCU5LiO5pif6ZOBL+e7neWMuumbtuS4jeWQjO+8iVxuICogLSBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvdXJsX2ZpbmRlci9zcmMvbGliLnJz77yIYFJFR0VYX0dBQ0hBX1VSTGDvvIxcbiAqICAg56Gu6K6k57yT5a2Y6YeM5ZG95Lit55qE5pivIGAuLi4vZ2FjaGFfaW5mby9hcGkvZ2V0R2FjaGFMb2c/Li4uYXV0aGtleT0uLi5gIOi/meadoeecn+Wunuivt+axgiBVUkzvvIlcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqXG4gKiDku44gYGdldEdhY2hhTG9nYCDlk43lupTkvZPph4zlj5blh7rmnKzpobXorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDnnJ/lrp7lk43lupTlvaLmgIHmmK8gYHsgcmV0Y29kZSwgbWVzc2FnZSwgZGF0YTogeyBsaXN0OiBbLi4uXSwgcmVnaW9uIH0gfWBcbiAqIO+8iEhvWW8uR2FjaGEgYE1paG95b1Jlc3BvbnNlPEdhY2hhTG9ncz5gIC8gZ2Vuc2hpbi13aXNoLWV4cG9ydFxuICogYGdldEdhY2hhTG9nYCDph4znmoQgYHJlcy5kYXRhLmxpc3Rg77yJ44CC6Ziy5b6h5byP6Kej5p6Q77ya5Lu75L2V5LiA5bGC5b2i54q25LiN5a+55bCx6L+U5ZueXG4gKiDnqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjigJTigJTliIbpobXlvJXmk47kvJrmiornqbrmlbDnu4TlvZPkvZwgYGVtcHR5UGFnZWAg57uI5q2i5p2h5Lu25aSE55CG77yMXG4gKiDov5nmr5TorqnkuIDmrKHlgbblj5HnmoTnlbjlvaLlk43lupTkuK3mlq3mlbTmnaHph4fpm4bmtYHnqIvmm7TlronlhajjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhTG9nTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBkYXRhID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xufVxuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKiDlrpjmlrnlk43lupTph4znmoQgYGNvdW50YCDmmK/mlbDlrZflrZfnrKbkuLLvvIjlpoIgYFwiMVwiYO+8ie+8jOmYsuW+oeW8j+i9rOaNou+8jOW8guW4uOi+k+WFpeWFnOW6leS4uiAx44CCICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuZXhwb3J0IGNvbnN0IG1hbmlmZXN0ID0ge1xuICBpZDogXCJnZW5zaGluXCIsXG4gIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLljp/npZ5cIiB9LFxuICBzZGtWZXJzaW9uOiBcIjEuMC4wXCIsXG4gIHBsYXRmb3JtczogW1wid2luZG93c1wiXSxcbiAgbWFpbnRhaW5lcnM6IFtcImdhY2hhLXN0dWRpb1wiXSxcbiAgZXhjaGFuZ2VGb3JtYXRzOiBbXCJ1aWdmLXY0XCJdLFxuXG4gIC8vIOWbvuagh+WcsOWdgOadpeiHqiBUYXBUYXAg5bqU55So5biC5Zy66aG16Z2i77yM5bey5a6e5rWL6aqM6K+B77yISFRUUCAyMDDjgIHml6DpmLLnm5fpk74v5peg6ZyAXG4gIC8vIHJlZmVyZXLjgIFjb250ZW50LXR5cGUg5Z2H5Li6IGltYWdlL3BuZ+OAgW1hZ2ljIGJ5dGVzIDg5NTA0ZTQ344CBNTB+NzQgS0LvvInjgIJcbiAgLy8g4pqg77iPIOWcsOWdgOS7pSAuanBnIOe7k+WwvuS9huWunumZheWGheWuueaYryBQTkfigJTigJTov5nmmK8gVGFwVGFwIENETiDnmoTnnJ/lrp7ooYzkuLrvvIzkuI3mmK9cbiAgLy8g5ou85YaZ6ZSZ6K+v77yM5LiN6KaBXCLnuqDmraNcIuaJqeWxleWQje+8m+iQveebmOWJjeeahOagvOW8j+agoemqjO+8iGNvbnRlbnQtdHlwZSArIG1hZ2ljXG4gIC8vIGJ5dGVz77yM5LiN5L+h5Lu7IFVSTCDmianlsZXlkI3vvInmmK/lrr/kuLvkvqfogYzotKPvvIzop4EgYGljb25VcmxgIOWtl+auteacrOi6q+eahOaWh+aho+OAglxuICBpY29uVXJsOlxuICAgIFwiaHR0cHM6Ly9pbWctdGMudGFwaW1nLmNvbS9tYXJrZXQvaW1hZ2VzLzRjNDQxNzY5YjVmYjNiNjcwYzhiNTlhNjEyNGQ5ZmYyLnBuZy9fdGFwX2FwcGljb25fbS5qcGdcIixcblxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwiY2hyb21pdW1DYWNoZVwiLFxuICAgICAgICAvLyDimqDvuI8g55u45a+554mH5q6177yM5LiN5piv57ud5a+56Lev5b6E4oCU4oCU57ud5a+55a6J6KOF55uu5b2V5p2l6Ieq55So5oi36YWN572u77yM55SxIFJ1c3Qg5L6n5ou85o6l44CCXG4gICAgICAgIGdhbWVEaXI6IFwiWXVhblNoZW5fRGF0YS93ZWJDYWNoZXNcIixcbiAgICAgICAgdXJsUGF0dGVybjogL2h0dHBzOlxcL1xcLy4rP2dldEdhY2hhTG9nW15cIl0rLyxcbiAgICAgIH0sXG4gICAgICByZXF1ZXN0OiB7XG4gICAgICAgIHVybDogXCJ7e2NyZWRlbnRpYWx9fSZwYWdlPXt7cGFnZX19JmdhY2hhX3R5cGU9e3tnYWNoYVR5cGV9fSZzaXplPXt7cGFnZVNpemV9fSZlbmRfaWQ9MFwiLFxuICAgICAgfSxcbiAgICAgIC8vIOWbveacjSArIOWbvemZheacjeS4pOS4qiBob3N0IOmDveimgeaUtuW9le+8mnVybFBhdHRlcm7vvIjkuIrmlrnvvInmnKzouqvkuI3ljLrliIbln5/lkI3vvIxcbiAgICAgIC8vIOWPquimgSBVUkwg6YeM5Ye6546wIFwiZ2V0R2FjaGFMb2dcIiDlsLHkvJrljLnphY3igJTigJTkuZ/lsLHmmK/or7TvvIzlkIzkuIDku73mj5Lku7bml6LkvJpcbiAgICAgIC8vIOS7juWbveacjeWuouaIt+err+S5n+S8muS7juWbvemZheacjeWuouaIt+err+eahOe8k+WtmOmHjOaJq+WHuuWHreaNriBVUkzvvIzoi6Xlj6rlo7DmmI7lm73mnI1cbiAgICAgIC8vIGhvc3TvvIzlm73pmYXmnI3njqnlrrbnmoTmraPluLjor7fmsYLkvJrooqvov5nph4zmlrDliqDnmoTnmb3lkI3ljZXor6/liKTkuLrmipXmr5LogIzmi5Lnu53jgIJcbiAgICAgIC8vIOS4pOS4quWfn+WQjeW3sueUqCBIb1lvLkdhY2hhIOa6kOeggeaguOWunu+8iOmdnuacrOaPkuS7tueLrOeri+Wunua1i++8jOS7heS9nOS6i+WunuW8leeUqO+8ie+8mlxuICAgICAgLy8gZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6MzUtMzZcbiAgICAgIC8vICAgKChIazRlLCBPZmZpY2lhbCksIFN0YW5kYXJkKSAtPiBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1oazRlLm1paG95by5jb20vLi4uXCJcbiAgICAgIC8vICAgKChIazRlLCBPdmVyc2VhKSwgIFN0YW5kYXJkKSAtPiBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1oazRlLXNnLmhveW92ZXJzZS5jb20vLi4uXCJcbiAgICAgIC8vIOS4jiBmaXh0dXJlcy9nZW5zaGluL2NyZWRlbnRpYWwvZGF0YV8yLnNhbXBsZSDph4znmoTnpLrkvosgVVJM77yI5Zu95pyN77yMXG4gICAgICAvLyBwdWJsaWMtb3BlcmF0aW9uLWhrNGUubWlob3lvLmNvbe+8ieS6kuebuOWNsOivge+8jGRhdGFfMi5zYW1wbGUg5pys6Lqr5Y+qXG4gICAgICAvLyDopobnm5bkuoblm73mnI3ov5nkuIDnp43vvIzlm73pmYXmnI0gaG9zdCDooaXlhYXoh6rkuIrpnaLov5nku73mupDnoIHlvJXnlKjjgIJcbiAgICAgIGFsbG93ZWRIb3N0czogW1wicHVibGljLW9wZXJhdGlvbi1oazRlLm1paG95by5jb21cIiwgXCJwdWJsaWMtb3BlcmF0aW9uLWhrNGUtc2cuaG95b3ZlcnNlLmNvbVwiXSxcbiAgICAgIGV4dHJhY3RMaXN0OiBleHRyYWN0R2FjaGFMb2dMaXN0LFxuICAgIH0sXG4gIH0sXG5cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIuWOn+elniBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgY29uc3QgbmFtZSA9IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLm5hbWUpO1xuICAgICAgY29uc3Qgc3RhYmxlSWQgPSB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5pZCk7XG4gICAgICAvLyDimqDvuI8g5Y6f56WeIEFQSSDkuI3ov5Tlm54gaXRlbV9pZOKAlOKAlOW3sueUqOa6kOeggeaguOWunu+8mkhvWW8uR2FjaGEg55qEXG4gICAgICAvLyBgY3JhdGVzL3VybF9zY3JhcGVyL3NyYy90eXBlcy5yczoxNTBgIOaYryBgaXRlbV9pZDogT3B0aW9uPHUzMj5g77yMXG4gICAgICAvLyDkuJQgYGhhc19pdGVtX2lkKClgIOeahCBkb2MgY29tbWVudCDnm7TkuaYgXCJFeGNlcHQgZm9yICdHZW5zaGluIEltcGFjdCdcIuOAglxuICAgICAgLy9cbiAgICAgIC8vIOWboOatpOi/memHjOeahCBpdGVtSWQg5pivKirkuLTml7blgLzvvJrmnKzlnLDljJbnianlk4HlkI0qKu+8jOS4jeaYr+ecn+ato+eahOeJqeWTgeagh+ivhuOAglxuICAgICAgLy8g5ZCO5p6c5b+F6aG76K+05riF5qWa77yM5ZCm5YiZ5LiL5LiA5Liq6K+76L+Z5q615Luj56CB55qE5Lq65Lya5Lul5Li65a6D5bey57uP5a+55LqG77yaXG4gICAgICAvLyAgIOKRoCBpdGVtX2NhdGFsb2cg5Li76ZSu5pivIChwbHVnaW5faWQsIGl0ZW1faWQsIGxhbmcp44CCaXRlbUlkIOiLpeaYr+acrOWcsOWMluWQje+8jFxuICAgICAgLy8gICAgICDlkIzkuIDkuKrop5LoibLlnKggemgtY24g5LiOIGVuLXVzIOS4i+S8muS6p+WHuuS4pOS4quS4jeWQjOeahCBpdGVtX2lk77yM6Leo6K+t6KiA6IGa5ZCI5aSx5pWI77ybXG4gICAgICAvLyAgIOKRoSBgZ2FjaGFfcmVjb3JkLmxhbmdgIOi/meS4gOWIl+eahOiuvuiuoeaEj+Wbvu+8iHJlc2VhcmNoLzA1IMKnMi4y77yJ5q2j5pivXG4gICAgICAvLyAgICAgIOOAjG5hbWXihpJpdGVtX2lkIOWPjeafpeS+nei1liBsb2NhbGXvvIzlrZflhbjmm7TmlrDlkI7opoHog73ph43mlL7moKHmraPjgI3igJTigJRcbiAgICAgIC8vICAgICAg6ICM5Y+N5p+l6L+Z5LiA5q2l546w5Zyo5qC55pys5rKh5Y+R55Sf77ybXG4gICAgICAvLyAgIOKRoiDmm7TopoHlkb3nmoTmmK8gbmFtZSDkuI4gcmFyaXR5IOmDveacieWAvO+8jOW9kuS4gOWMluWxguaMieeOsOacieinhOWImeS8muaKiui/meexu+iusOW9leagh+aIkFxuICAgICAgLy8gICAgICBtZXRhX3N0YXRlPSdjb21wbGV0ZSfvvIzkuo7mmK8gaWR4X3JlY29yZF9tZXRhX3BlbmRpbmcg6YKj5p2h6YOo5YiG57Si5byVXG4gICAgICAvLyAgICAgIOawuOi/nOaJq+S4jeWIsOWug+S7rOKAlOKAlCoq6ZSZ55qE5pWw5o2u6KKr5qCH6K6w5Li65a6M5pW077yM5rKh5pyJ5Lu75L2V5py65Yi25Lya5p2l57qg5q2jKirjgIJcbiAgICAgIC8vXG4gICAgICAvLyDkuI3lnKjmnKwgU3RhZ2Ug57yW6YCgIG1ldGFkYXRhLnBhcnNlUmVzcG9uc2XvvIhVSUdGIOWtl+WFuCBBUEkg55qE5ZON5bqU5b2i54q25bCa5pyqXG4gICAgICAvLyDnlKjnnJ/lrp7lrp7njrDmoKHlh4bvvIznoaznuqbmnZ/npoHmraLmnKrmoKHlh4blsLHlhpnlrp7njrDvvInjgILkvYbov5nkuKrnvLrlj6PkuI3og73lgZzlnKjms6jph4rph4zvvJpcbiAgICAgIC8vIOW3suWIl+S4uiBNMS1TMyDlvZLkuIDljJblsYLkuI4gTTEtUzUg5YWD5pWw5o2u5raI6LS555qE6Zi75aGe6aG577yM6KeBXG4gICAgICAvLyBgbWlsZXN0b25lcy8wMi1NMS3ljp/npZ7mj5Lku7blhajpk77ot68ubWRgIFMz44CBUzUg55qEIGNoZWNrbGlzdOOAglxuICAgICAgY29uc3QgaXRlbUlkID0gbmFtZSA/PyBzdGFibGVJZDtcbiAgICAgIGlmICghaXRlbUlkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIuWOn+elniBleHRyYWN0UmVjb3Jk77ya6K6w5b2V5pei5pegIG5hbWUg5Lmf5pegIGlk77yM5peg5rOV56Gu5a6aIGl0ZW1JZFwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbUlkLFxuICAgICAgICB0aW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC50aW1lKSA/PyBcIlwiLFxuICAgICAgICAvLyDkv53nlZnmr4/mnaHorrDlvZXoh6rlt7HnmoTljp/lp4sgZ2FjaGFfdHlwZe+8iOiAjOS4jeaYr+acrOasoeafpeivoueUqOeahOaxoOWtkCBpZO+8ieKAlOKAlFxuICAgICAgICAvLyAzMDEg5YiG57uE6YeM5re35pyJIGdhY2hhX3R5cGU6IFwiNDAwXCIg55qE6K6w5b2V5piv5Y6f56We55qE55yf5a6e6KGM5Li6XG4gICAgICAgIC8vIO+8iHJlc2VhcmNoLzAzIMKnMi4y77yMNjE3MCDmnaHnu4TlhoXmt7fmnInkuKTnp43lj5blgLzvvInvvIzlv4Xpobvljp/moLfkv53nlZnmiY3og73orqlcbiAgICAgICAgLy8gcGl0eUdyb3VwcyDnmoQgMzAxLzQwMCDlkIjlubbnlJ/mlYjvvIzkuZ/mmK/nlZnlupXjgIHlj6/ph43mlL7nmoTliY3mj5DjgIJcbiAgICAgICAgYmFubmVySWQ6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmdhY2hhX3R5cGUpID8/IFwiXCIsXG4gICAgICAgIGNvdW50OiB0b0NvdW50KHJlY29yZC5jb3VudCksXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGl0ZW1UeXBlOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5pdGVtX3R5cGUpLFxuICAgICAgICByYXJpdHk6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLnJhbmtfdHlwZSksXG4gICAgICAgIHN0YWJsZUlkLFxuICAgICAgfTtcbiAgICB9LFxuICB9LFxuXG4gIGJhbm5lcnM6IFtcbiAgICB7IGlkOiBcIjMwMVwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6KeS6Imy5rS75Yqo56WI5oS/XCIgfSB9LFxuICAgIHsgaWQ6IFwiMzAyXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLmrablmajmtLvliqjnpYjmhL9cIiB9IH0sXG4gICAgeyBpZDogXCIyMDBcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuW4uOmpu+eliOaEv1wiIH0gfSxcbiAgICB7IGlkOiBcIjUwMFwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6ZuG5b2V56WI5oS/XCIgfSB9LFxuICAgIHsgaWQ6IFwiMTAwXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLmlrDmiYvnpYjmhL9cIiB9IH0sXG4gICAgLy8gNDAwIOS4jeaYr+S4gOS4quWPr+WNleeLrOafpeivoueahOaxoOWtkO+8iOS4jeS8muS7pSA0MDAg5L2c5Li65Y2h5rGg5Y+W5YC85Y+R6LW36K+35rGC77yJ77yMXG4gICAgLy8g5L2G5a6D5pivIDMwMSDlk43lupTph4znnJ/lrp7lh7rnjrDnmoQgZ2FjaGFfdHlwZSDlj5blgLzvvIzlv4Xpobvlo7DmmI7kuLrni6znq4sgQmFubmVyU3BlY++8jFxuICAgIC8vIHBpdHlHcm91cHNbXS5tZW1iZXJzIOaJjeiDveWQiOazleW8leeUqOWug+KAlOKAlOWQpuWImSBiYW5uZXJJZD1cIjQwMFwiIOeahOiusOW9leS8muaMh+WQkVxuICAgIC8vIOS4gOS4quS4jeWtmOWcqOeahCBCYW5uZXJTcGVj77yM6KeB5pys5paH5Lu25pyr5bC+44CM5YGP5beu5LiO5Y+R546w44CN6K+05piO44CCXG4gICAgeyBpZDogXCI0MDBcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuinkuiJsua0u+WKqOeliOaEv++8iDQwMCDlrZDnsbvlnovvvIzpmo8gMzAxIOS4gOW5tui/lOWbnu+8iVwiIH0gfSxcbiAgXSxcblxuICBwaXR5R3JvdXBzOiBbXG4gICAge1xuICAgICAga2V5OiBcImNoYXJhY3RlckV2ZW50V2lzaFwiLFxuICAgICAgbWVtYmVyczogW1wiMzAxXCIsIFwiNDAwXCJdLFxuICAgICAgaGFyZFBpdHk6IDkwLFxuICAgICAgLy8gYmFzZS9zdGFydCDlj5boh6rlhazlvIDnmoTnpYjmhL/mpoLnjofor7TmmI7vvJs3NCDmir3otbfnur/mgKfmj5DljYfjgIE4NiDmir3lpJbln7rmnKzlsIHpobbvvIxcbiAgICAgIC8vIDkwIOaKveW/heWHuuKAlOKAlHN0ZXAg6YeH55So5ZCM5Lq656S+5Yy65bm/5rOb5byV55So55qE44CMNzQg5oq96LW35q+P5oq9ICs2JeOAjeWPo+W+hOOAglxuICAgICAgY3VydmU6IHsga2luZDogXCJzb2Z0UGl0eVwiLCBiYXNlOiAwLjAwNiwgc3RhcnQ6IDc0LCBzdGVwOiAwLjA2IH0sXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgICB9LFxuICBdLFxuXG4gIHJhcml0eTogeyBsYWRkZXI6IFtcIjNcIiwgXCI0XCIsIFwiNVwiXSwgcGl0eVRhcmdldDogXCI1XCIgfSxcblxuICB0aW1lOiB7IHRpbWV6b25lU291cmNlOiB7IGtpbmQ6IFwiY29tcHV0ZWRcIiB9IH0sXG5cbiAgcHJlY29uZGl0aW9uczogW1xuICAgIHtcbiAgICAgIGlkOiBcImdlbnNoaW4uY3JlZGVudGlhbC5jYWNoZURpckV4aXN0c1wiLFxuICAgICAgY2FwYWJpbGl0eTogXCJjcmVkZW50aWFsXCIsXG4gICAgICBsZXZlbDogXCJyZXF1aXJlZFwiLFxuICAgICAgZGVzY3JpYmU6IHtcbiAgICAgICAgXCJ6aC1DTlwiOiBcIuiHquWKqOiOt+WPluaKveWNoemTvuaOpeimgeaxgua4uOaIj+WuouaIt+err+iHs+Wwkei/kOihjOi/h+S4gOasoe+8jOe8k+WtmOebruW9leaJjeS8muiiq+WIm+W7ulwiLFxuICAgICAgfSxcbiAgICAgIC8vIEhvc3RFbnYg55uu5YmN5Y+q5pyJIGdhbWVDbGllbnRTaXplIC8gaW5zdGFsbGVkRGVwZW5kZW5jaWVzIOS4pOS4quWtl+aute+8jOacquaQuuW4plxuICAgICAgLy8g44CMY3JlZGVudGlhbC5nYW1lRGlyIOWjsOaYjueahOe8k+WtmOebruW9leaYr+WQpuW3suiiq+ingua1i+WIsOOAjei/meS4gOS6i+WunuKAlOKAlOi/meato+aYr1xuICAgICAgLy8gZml4dHVyZSDlpZHnuqbmtYvor5XpmLbmrrXlsLHog73lj5HnjrDnmoTlpZHnuqbnvLrlj6PvvIzkuI3mmK/ov5DooYzml7bmiY3mmrTpnLLjgILop4Hmlofku7bmnKvlsL5cbiAgICAgIC8vIOOAjOWBj+W3ruS4juWPkeeOsOOAje+8jOeVmee7mSBncy1ob3N0IOaJqeWxlSBIb3N0RW52IOaXtuihpeS4iuOAglxuICAgICAgY2hlY2s6ICgpID0+ICh7IGtpbmQ6IFwidW5rbm93blwiIH0pLFxuICAgICAgcmVtZWR5OiB7IFwiemgtQ05cIjogXCLor7flhYjlkK/liqjmuLjmiI/lubbmiZPlvIDkuIDmrKHmir3ljaHorrDlvZXpobXvvIzlho3lm57liLDmnKzlupTnlKjph43or5VcIiB9LFxuICAgIH0sXG4gIF0sXG5cbiAgYmFzZWxpbmU6IHsga2luZDogXCJpbkdhbWVQYWdlQ291bnRcIiB9LFxuXG4gIHJldGVudGlvbjoge1xuICAgIGRpc3BsYXlUZXh0OiB7IFwiemgtQ05cIjogXCI2IOS4quaciFwiIH0sXG4gICAgY29uc2VydmF0aXZlRGF5czogNiAqIDI4LFxuICB9LFxuXG4gIC8vIOKaoO+4jyDljp/npZ4gQVBJIOS4jei/lOWbniBpdGVtX2lk77yMZXh0cmFjdFJlY29yZCDnmoQgaXRlbUlkIOaYr+acrOWcsOWMlueJqeWTgeWQjVxuICAvLyDvvIjop4HkuIrmlrkgZXh0cmFjdFJlY29yZCDlhoXnmoTor6bnu4bor7TmmI7kuI4gTTEtUzMg6Zi75aGe6aG55byV55So77yJ44CC5aOw5piO6L+Z5Liq5L+h5Y+3XG4gIC8vIOWQju+8jOWuv+S4u+eahOW9kuS4gOWMluWxguS8muaKiui/meexu+iusOW9leagh+aIkCBtZXRhX3N0YXRlPSdwZW5kaW5nJ++8jOiAjOS4jeaYr+WboOS4ulxuICAvLyBuYW1lL3Jhcml0eSDpg73mnInlgLzlsLHor6/liKTmiJAgY29tcGxldGXigJTigJTplJnnmoQgaXRlbV9pZCDkuI3or6XooqvmoIforrDkuLrlrozmlbTjgIJcbiAgaXRlbUlkU291cmNlOiBcImRpc3BsYXlOYW1lXCIsXG5cbiAgLy8gbWV0YWRhdGEg5a2X5q615pysIFN0YWdlIOWIu+aEj+S4jeWjsOaYju+8jOeQhueUseingeaWh+S7tuacq+WwvuOAjOWBj+W3ruS4juWPkeeOsOOAjeOAglxufSBzYXRpc2ZpZXMgUGx1Z2luTWFuaWZlc3Q7XG4iLCIvKipcbiAqIOaYn+mTgeaPkuS7tueahOmAg+eUn+iIsSBob29rc+OAglxuICpcbiAqIOWPqumcgOimgSBgZGVyaXZlUmVjb3JkS2V5YCDkuIDkuKogaG9va++8mlxuICogLSBgcmVzb2x2ZVRpbWV6b25lYCDkuI3pnIDopoHigJTigJRgbWFuaWZlc3QudHNgIOeahCBgdGltZS50aW1lem9uZVNvdXJjZS5raW5kYCDmmK9cbiAqICAgYFwiYXBpRmllbGRcImDvvIzkuI3mmK8gYFwiY29tcHV0ZWRcImDvvIzlrr/kuLvnm7TmjqXku47lk43lupTkvZPpobXnuqflrZfmrrVcbiAqICAgYHJlZ2lvbl90aW1lX3pvbmVgIOivu+WPluWBj+enu+mHj++8jOS4jee7j+i/h+acrOaPkuS7tueahOS7u+S9leWHveaVsO+8iOingSBgbWFuaWZlc3QudHNgXG4gKiAgIGB0aW1lYCDlrZfmrrXml4HnmoTms6jph4rvvInjgIJcbiAqIC0gYGRlcml2ZVJlY29yZEtleWAg5b+F6aG75a6e546w77yM5LiN6IO955yB55Wl77ya5pif6ZOB6IGU5Yqo5rGg77yIMjEvMjLvvInotbDni6znq4vnq6/ngrlcbiAqICAgYGdldExkR2FjaGFMb2dg77yM5pyN5Yqh56uv6Zuq6IqxIElEIOeahOWRveWQjeepuumXtOWcqOi3qOerr+eCueWcuuaZr+S4i+S4jeS/neivgemalOemu+KAlOKAlFxuICogICDoo7jnlKggYHN0YWJsZUlkYCDkvJrmkp7plK7vvIzlhpnlhaXlsYIgYElOU0VSVCBPUiBJR05PUkVgIOS8muaKiuaSnumUruiusOW9lSoq6Z2Z6buYXG4gKiAgIOS4ouW8gyoq77yM55So5oi35Y+q5Lya5Y+R546w44CM5bCR5LqG5LiA5p2h44CN77yM5LiU5peg5rOV5a6a5L2N5piv5ZOq5LiA5p2h44CC5YGa5rOV5LiOXG4gKiAgIGBwbHVnaW5zL2dlbnNoaW4vaG9va3MudHNgIOWujOWFqOS4gOiHtO+8iOWQjOagt+aYr+exs+WTiOa4uOacjeWKoeerr+mbquiKsSBJRCDlnLrmma/vvIxcbiAqICAgYHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvbWFuaWZlc3QudHNgIOeahCBgUGx1Z2luSG9va3MuZGVyaXZlUmVjb3JkS2V5YFxuICogICDmlofmoaPmmI7noa7ngrnlkI1cIuexs+WTiOa4uOS4iea4uOS4jeW+l+e8uuecgeacrCBob29rXCLvvInvvJpgYCBgJHtiYW5uZXJJZH06JHtzdGFibGVJZH1gIGBg77yMXG4gKiAgIOaKiuWNoeaxoOe7tOW6puW5tui/m+WkjeWQiOmUru+8jOWPguiAg+WunueOsCBIb1lvLkdhY2hhIOS4iue6v+S4gOW5tOWQjuS4uuaYn+mTgeiBlOWKqOaxoOeahOi/meS4qlxuICogICDpl67popjku5jlh7rov4fkuIDmrKHmlbTooajph43lu7rov4Hnp7vvvIzmnKzmj5Lku7bku47nrKzkuIDlpKnlsLHmjInlpI3lkIjplK7lrp7njrDvvIzkuI3nlZnlkIzmoLfnmoTlnZHjgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Ib29rcyB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCBjb25zdCBob29rczogUGx1Z2luSG9va3MgPSB7XG4gIGRlcml2ZVJlY29yZEtleTogKHJlY29yZCkgPT4ge1xuICAgIGlmICghcmVjb3JkLnN0YWJsZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYOaYn+mTgeiusOW9lee8uuWwkSBzdGFibGVJZO+8iOacjeWKoeerr+mbquiKsSBJRO+8ie+8jOaXoOazleeUn+aIkOeos+WumueahCByZWNvcmRfa2V577yaaXRlbUlkPVwiJHtyZWNvcmQuaXRlbUlkfVwiYCk7XG4gICAgfVxuICAgIHJldHVybiBgJHtyZWNvcmQuYmFubmVySWR9OiR7cmVjb3JkLnN0YWJsZUlkfWA7XG4gIH0sXG59O1xuIiwiLyoqXG4gKiDltKnlnY/vvJrmmJ/nqbnpk4HpgZPmj5Lku7YgbWFuaWZlc3TjgIJcbiAqXG4gKiDph4fpm4bojIPlvI/vvJpjcmVkZW50aWFsZWRBcGnvvIhgZ3MtcC1hdXRoa2V5YO+8ie+8jOS4juWOn+elnuWQjOa6kOKAlOKAlOWHreaNruadpeiHqua4uOaIj+WGhee9rlxuICogQ2hyb21pdW0g57uE5Lu255qE56OB55uY57yT5a2Y77yI546p5a625omT5byA6LeD6L+B6K6w5b2V6aG15pe277yMd2VidmlldyDkvJrlkb3kuK3lrpjmlrlcbiAqIGBnZXRHYWNoYUxvZ2Ag5o6l5Y+j5bm25bim5LiKIGF1dGhrZXnvvIzokL3lnKggYHdlYkNhY2hlc2Ag55uu5b2V5LiL5p+Q5Liq54mI5pys5Y+35a2Q55uu5b2V55qEXG4gKiBgQ2FjaGUvQ2FjaGVfRGF0YS9kYXRhXzJgIOe0ouW8leaWh+S7tumHjO+8ieOAglxuICpcbiAqIOacrOaWh+S7tueUsSBNMS1TNyDnurjpnaLloavooajmvJTnu4PojYnnqL8gYGRyaWxscy9zdGFycmFpbC9tYW5pZmVzdC50c2Ag6L2s5YyW6ICM5p2l4oCU4oCUXG4gKiDmvJTnu4Ppqozor4HnmoTmmK9cIlMyIOaUuei/h+eahOaPkuS7tuWlkee6puexu+Wei+aYr+WQpuijheW+l+S4i+aYn+mTgeeahOecn+WunuW3ruW8gueCuVwi77yM5pys5paH5Lu25piv5oqKXG4gKiDpqozor4Hnu5PorrrokL3lnLDmiJDnnJ/mraPmjqXlhaUgYHBsdWdpbnMvaW5kZXgudHNgIOeahOWPr+i/kOihjOaPkuS7tu+8iOacrOasoeaUueWKqOiMg+WbtOS4jeWQq1xuICogYHBsdWdpbnMvaW5kZXgudHNgIOeahOazqOWGjO+8jOeUseS4u+i/m+eoi+e7n+S4gOWkhOeQhu+8ieOAguiNieeov+mHjOeahOS7peS4i+WGheWuueW3sumaj+acrOasoVxuICog6L2s5YyW6L+H5pyf44CB5LiN5YaN54Wn5oqE77yaXG4gKiAgIC0gYGFsbG93ZWRIb3N0c2Ag5Y2g5L2N5Z+f5ZCNIOKGkiDmjaLmiJDkuIvmlrnnnJ/lrp7moLjlrp7nmoTkuKTkuKogaG9zdFxuICogICAtIFwiYGVuZHBvaW50T3ZlcnJpZGVgIOS7juacquiiqyBgYnVpbGRfcGFnZV91cmxgIOivu+WPllwiXCJhcGlGaWVsZCDliIbmlK/ooqvmoIdcbiAqICAgICBgI1thbGxvdyhkZWFkX2NvZGUpXWBcIiDihpIg5Z2H5pivIE0xLVM3IOaXtueahOeKtuaAge+8jE0yIOW3suWFqOmDqOWunuijhe+8jOacrOaWh+S7tuS4jeWGjVxuICogICAgIOWkjei/sOi/h+acn+aPj+i/sFxuICogICAtIOaWsOWiniBgcGl0eUdyb3Vwc2DjgIFgaG9va3MudHNg77yI6I2J56i/5Yi75oSP5LiN5aGr77yM55CG55Sx5bey6ZqP5L+d5bqV5pWw5YC85Yiw5L2N6ICM5aSx5pWI77yJXG4gKiAgIC0g5pi+5byP5Yaz562WIGBiYW5uZXJJZGVudGl0eWAg5LiN5aOw5piO77yI6KeB5LiL5pa5IGNvbGxlY3QucGFyYW1zIOWGheazqOmHiu+8iVxuICogICAtIOaWsOWiniBgcmF0ZUxpbWl0YCDmmL7lvI/lo7DmmI5cbiAqXG4gKiDmlbDmja7mnaXmupDvvIjkuI3lh63orq3nu4PorrDlv4bnvJbpgKDlrZfmrrXlkI0v5pWw5YC877yJ77yaXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvZ2FtZV9iaXovc3JjL2FwaS5yczo0Mi00NmBcbiAqICAg77yIaG9zdCDkuI7nq6/ngrnot6/lvoTliY3nvIDvvJpgcHVibGljLW9wZXJhdGlvbi1oa3JwZy5taWhveW8uY29tYCAvXG4gKiAgIGBwdWJsaWMtb3BlcmF0aW9uLWhrcnBnLXNnLmhveW92ZXJzZS5jb21g77yM6Lev5b6E5YmN57yAXG4gKiAgIGAvY29tbW9uL2hrcnBnX2dhY2hhX3JlY29yZC9hcGkvYO+8jGBnZXRHYWNoYUxvZ2AvYGdldExkR2FjaGFMb2dgIOerr+eCueWQje+8iVxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL3N0YXItcmFpbC13YXJwLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIxNi0yMzRgXG4gKiAgIO+8iGBbJzIxJywnMjInXS5pbmNsdWRlcyhrZXkpID8gJ2dldExkR2FjaGFMb2cnIDogJ2dldEdhY2hhTG9nJ2Ag55qE56uv54K56YCJ5oup6YC76L6R77ybXG4gKiAgIOivpeWPguiAg+WunueOsOeUqOeahOi3r+W+hOWJjee8gOaYryBgL2NvbW1vbi9nYWNoYV9yZWNvcmQvYXBpL2DvvIzkuI4gSG9Zby5HYWNoYSDnmoRcbiAqICAgYC9jb21tb24vaGtycGdfZ2FjaGFfcmVjb3JkL2FwaS9gIOS4jeWQjOKAlOKAlOacrOaPkuS7tuS4jeaUueWGmei3r+W+hOWJjee8gO+8jOS4pOWll+WGmeazlVxuICogICDpg73kuI3kvJrouKnliLDvvIzop4HkuIvmlrkgcmVxdWVzdC51cmwg5rOo6YeK77yJ44CBYDoyMjMtMjI1YO+8iGBzbGVlcCgwLjMpYCDmr4/pobXlu7bov58gK1xuICogICDms6jph4rmjonnmoTmr48gMTAg6aG1IGBzbGVlcCgxKWAg5om56YeP5YGc6aG/ICsgYHJldHJ5Q291bnQ6IDVg77yJ44CBYDoyMjYtMjM0YFxuICogICDvvIjlk43lupTkv6HlsIEgYHJlcy5kYXRhYCDkuIsgYGxpc3RgL2ByZWdpb25gL2ByZWdpb25fdGltZV96b25lYCDlkIznuqfvvInjgIFcbiAqICAgYDo0NTEtNDUyYO+8iOacrOWcsOWtmOaho+Wtl+aute+8muS7heS/neeVmSA5IOmUru+8jGB1aWRgL2BsYW5nYCDooqvkuKLlvIPvvIzor4HmmI7nnJ/lrp4gQVBJXG4gKiAgIOiusOW9leacrOi6q+aQuuW4pui/meS4pOS4quWtl+auteKAlOKAlOS4juS4i+aWueOAjDExIOmUruOAjeeahOS7u+WKoeeugOaKpeWPo+W+hOS6kuebuOWNsOivge+8iVxuICogLSBgZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDMt55yf5a6e5a+85Ye65pWw5o2u5qC85byP5a6e5rWLLm1kYCDCpzEuMu+8iGBnYWNoYV9pZGDvvIlcbiAqICAgwqcxLjPvvIjlhYPmlbDmja7nvLrlpLHnnJ/lrp7moLfkvovvvIxgaXRlbV9pZGAg5piv5ZSv5LiA5L+d6K+B6Z2e56m655qE6ZSa54K577yJwqcyLjHvvIh0eXBlTWFw77yJXG4gKiAgIMKnMi4z77yIYHJlZ2lvbl90aW1lX3pvbmVgIOaYr+mhtee6p+Wtl+aute+8jOS4jeaYr+mAkOadoeiusOW9leWtl+aute+8iVxuICogLSDlrpjmlrnkv53lupXmpoLnjoflhaznpLogSlNPTu+8iGBvcGVyYXRpb24td2Vic3RhdGljLm1paG95by5jb20vZ2FjaGFfaW5mby9oa3JwZy9cbiAqICAgcHJvZF9nZl9jbi88YmFubmVySWQ+L3poLWNuLmpzb25g77yJ4oCU4oCUKirlt7LnlLHkuLvov5vnqIvlnKjku7vliqHnroDmiqXpmLbmrrXni6znq4vmoLjpqowqKu+8jFxuICogICDmnKwgQWdlbnQg5Lya6K+d5pyq6YeN5paw5oqT5Y+W77yMYHBpdHlHcm91cHNgIOmHjOmAkOe7hOagh+azqOS6hui/meadoei+ueeVjOOAglxuICogLSBgcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzYCAvIGBwbHVnaW5zL3d1d2EvbWFuaWZlc3QudHNg77yI5ZCM5peP5bey6JC95Zyw5o+S5Lu277yMXG4gKiAgIOWGmeazleS4juazqOmHiuWvhuW6puWvuem9kO+8iVxuICovXG5pbXBvcnQgdHlwZSB7IFBsdWdpbk1hbmlmZXN0IH0gZnJvbSBcImdzLXBsdWdpbi1raXRcIjtcblxuZXhwb3J0IHsgaG9va3MgfSBmcm9tIFwiLi9ob29rcy50c1wiO1xuXG4vKipcbiAqIOS7jiBgZ2V0R2FjaGFMb2dgL2BnZXRMZEdhY2hhTG9nYCDlk43lupTkvZPph4zlj5blh7rmnKzpobXorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDnnJ/lrp7lk43lupTlvaLmgIHmmK8gYHsgcmV0Y29kZSwgbWVzc2FnZSwgZGF0YTogeyBsaXN0OiBbLi4uXSwgcmVnaW9uLCByZWdpb25fdGltZV96b25lIH0gfWBcbiAqIOKAlOKAlOS4juWOn+elnuWQjOaehO+8jGByZWdpb25gL2ByZWdpb25fdGltZV96b25lYCDkuI4gYGxpc3RgIOWQjOe6p++8jOaYr+mhtee6p+WFg+aVsOaNru+8jFxuICog5LiN5piv6YCQ5p2h6K6w5b2V5a2X5q6177yIYHJlc2VhcmNoLzAzYCDCpzIuM++8m2BzdGFyLXJhaWwtd2FycC1leHBvcnQvc3JjL21haW4vXG4gKiBnZXREYXRhLmpzOjIyNi0yMzRgIOeahCBgY29uc3QgeyBsaXN0LCB1aWQsIHJlZ2lvbiwgcmVnaW9uX3RpbWVfem9uZSB9ID1cbiAqIGF3YWl0IGdldEdhY2hhTG9ncyguLi4pYCDljbDor4HkuInogIXku47lkIzkuIDkuKogYHJlcz8uZGF0YWAg5a+56LGh6Kej5p6E6ICM5p2l77yJ44CCXG4gKiDpmLLlvqHlvI/op6PmnpDvvJrku7vkvZXkuIDlsYLlvaLnirbkuI3lr7nlsLHov5Tlm57nqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjigJTigJTliIbpobXlvJXmk47kvJrmiornqbrmlbDnu4RcbiAqIOW9k+S9nCBgZW1wdHlQYWdlYCDnu4jmraLmnaHku7blpITnkIbvvIzmr5TorqnkuIDmrKHlgbblj5HnmoTnlbjlvaLlk43lupTkuK3mlq3mlbTmnaHph4fpm4bmtYHnqIvmm7TlronlhajjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhTG9nTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBkYXRhID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xufVxuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKiDlrpjmlrnlk43lupTph4znmoQgYGNvdW50YCDmmK/mlbDlrZflrZfnrKbkuLLvvIjlpoIgYFwiMVwiYO+8ie+8jOmYsuW+oeW8j+i9rOaNou+8jOW8guW4uOi+k+WFpeWFnOW6leS4uiAx44CCICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyDkv53lupXvvJo14piFIOi9r+S/neW6leabsue6v+eahOS4pOWll+ekvuWMuuaOqOeul+WPo+W+hFxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8g4pqg77iPICoqYmFzZSAvIGhhcmRQaXR5IC8gZ3VhcmFudGVlIOadpeiHquWumOaWueWFrOekuiBKU09O77yI5bey55Sx5Li76L+b56iL5qC46aqM77yJ77yMXG4vLyBjdXJ2ZSDnmoQgc3RhcnQgLyBzdGVwIOWumOaWueS7juacquWFrOekuu+8jOaYr+WQjOS6uuekvuWMuuWPo+W+hOeahOaOqOeul+WAvO+8jOS4jeWQjOadpea6kOWcqFxuLy8gNzN+NzUg5LmL6Ze05LiN5LiA6Ie0KirigJTigJTmoIfms6jmlrnlvI/lr7npvZAgYHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50czoxNjEtMTY0YFxuLy8g55qE5ZCM5qy+5YWI5L6L77yM5LiN5oqK5o6o566X5YC86K+05oiQ5a6Y5pa55pWw5YC844CCXG5cbi8qKiDop5LoibLnsbvmsaDvvIjnoazkv53lupUgOTDvvInnmoTova/kv53lupXmm7Lnur/vvJo3NCDmir3otbfjgIHmr4/mir0gKzYl77yM5ZCM5Lq656S+5Yy65Y+j5b6E44CCICovXG5jb25zdCBDSEFSQUNURVJfU09GVF9QSVRZX0NVUlZFID0ge1xuICBraW5kOiBcInNvZnRQaXR5XCIgYXMgY29uc3QsXG4gIGJhc2U6IDAuMDA2LFxuICBzdGFydDogNzQsXG4gIHN0ZXA6IDAuMDYsXG59O1xuXG4vKiog5YWJ6ZSl57G75rGg77yI56Gs5L+d5bqVIDgw77yJ55qE6L2v5L+d5bqV5puy57q/77ya5oyJ6KeS6Imy5rGg5Y+j5b6E562J5q+U5L6L5aSW5o6o77yMNjUg5oq96LW344CB5q+P5oq9ICs3JeOAgiAqL1xuY29uc3QgTElHSFRfQ09ORV9TT0ZUX1BJVFlfQ1VSVkUgPSB7XG4gIGtpbmQ6IFwic29mdFBpdHlcIiBhcyBjb25zdCxcbiAgYmFzZTogMC4wMDgsXG4gIHN0YXJ0OiA2NSxcbiAgc3RlcDogMC4wNyxcbn07XG5cbmV4cG9ydCBjb25zdCBtYW5pZmVzdCA9IHtcbiAgaWQ6IFwic3RhcnJhaWxcIixcbiAgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuW0qeWdj++8muaYn+epuemTgemBk1wiIH0sXG4gIHNka1ZlcnNpb246IFwiMS4wLjBcIixcbiAgcGxhdGZvcm1zOiBbXCJ3aW5kb3dzXCJdLFxuICBtYWludGFpbmVyczogW1wiZ2FjaGEtc3R1ZGlvXCJdLFxuICAvLyBleGNoYW5nZUZvcm1hdHMg5LiN5aOw5piO77ya5pif6ZOB55qEIFVJR0Yg5a2X5q615pig5bCE5pyq57uP55yf5a6e5a6e546w5qCh5YeG77yM5LiN5Zyo5pys5qyhXG4gIC8vIOaOpeWFpeiMg+WbtOWGhee8lumAoO+8iOS4jiBkcmlsbHMvc3RhcnJhaWwvbWFuaWZlc3QudHMg55qE5pei5pyJ56uL5Zy65LiA6Ie077yJ44CCXG5cbiAgLy8g5Zu+5qCH5Zyw5Z2A5p2l6IeqIFRhcFRhcCDlupTnlKjluILlnLrpobXpnaLvvIzlt7Llrp7mtYvpqozor4HvvIzlkIwgYHBsdWdpbnMvZ2Vuc2hpbi9cbiAgLy8gbWFuaWZlc3QudHNgIOWQjOasvuaVmeiureKAlOKAlOWcsOWdgOS7pSAuanBnIOe7k+WwvuS9huWunumZheWGheWuueaYryBQTkfvvIzkuI3opoFcIue6oOato1wiXG4gIC8vIOaJqeWxleWQje+8jOagvOW8j+agoemqjO+8iGNvbnRlbnQtdHlwZSArIG1hZ2ljIGJ5dGVz77yJ5piv5a6/5Li75L6n6IGM6LSj44CCXG4gIGljb25Vcmw6XG4gICAgXCJodHRwczovL2ltZy10Yy50YXBpbWcuY29tL21hcmtldC9pbWFnZXMvMWI3Mzg1ZGE1ZGJmNmQ1MzQyYTgzMmU2Njg1ZTIwNjYucG5nL190YXBfYXBwaWNvbl9tLmpwZ1wiLFxuXG4gIGNvbGxlY3Q6IHtcbiAgICBwYXJhZGlnbTogXCJjcmVkZW50aWFsZWRBcGlcIixcbiAgICBwYXJhbXM6IHtcbiAgICAgIGNyZWRlbnRpYWw6IHtcbiAgICAgICAga2luZDogXCJjaHJvbWl1bUNhY2hlXCIsXG4gICAgICAgIC8vIOebuOWvueeJh+aute+8jOS4jeaYr+e7neWvuei3r+W+hOKAlOKAlOe7neWvueWuieijheebruW9leadpeiHqueUqOaIt+mFjee9ru+8jOeUsSBSdXN0IOS+p+aLvOaOpeOAglxuICAgICAgICBnYW1lRGlyOiBcIlN0YXJSYWlsX0RhdGEvd2ViQ2FjaGVzXCIsXG4gICAgICAgIHVybFBhdHRlcm46IC9odHRwczpcXC9cXC8uKz9nZXRHYWNoYUxvZ1teXCJdKy8sXG4gICAgICB9LFxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICAvLyDimqDvuI8gKirnq6/ngrnot6/lvoTliY3nvIDmnInkuKTlpZflhpnms5XvvIzmnKzmj5Lku7bkuI3mlLnlhpnliY3nvIAqKu+8muWPguiAg+WunueOsFxuICAgICAgICAvLyBzdGFyLXJhaWwtd2FycC1leHBvcnQg55SoIGAvY29tbW9uL2dhY2hhX3JlY29yZC9hcGkvYFxuICAgICAgICAvLyDvvIhnZXREYXRhLmpzOjIxN++8ie+8jEhvWW8uR2FjaGEg55SoIGAvY29tbW9uL2hrcnBnX2dhY2hhX3JlY29yZC9hcGkvYFxuICAgICAgICAvLyDvvIhnYW1lX2Jpei9zcmMvYXBpLnJzOjQyLTQ277yJ44CC5Yet5o2uIFVSTCDmmK/ku47muLjmiI/nvJPlrZjph4zljp/moLfmiavlh7rmnaXnmoRcbiAgICAgICAgLy8g5a6M5pW06K+35rGCIFVSTO+8iOWQq+ecn+WunuWJjee8gO+8ie+8jOS4i+mdoueahOaooeadv+eUqCBge3tjcmVkZW50aWFsfX1gIOWOn+S4slxuICAgICAgICAvLyDov73liqDliIbpobXlj4LmlbDvvIzkuI3ph43mlrDmi7zot6/lvoTigJTigJTml6DorrrnnJ/lrp7lrqLmiLfnq6/lkb3kuK3lk6rkuIDlpZfliY3nvIDpg73og73mraPluLhcbiAgICAgICAgLy8g5bel5L2c44CCYGJhbm5lcnNbXS5lbmRwb2ludE92ZXJyaWRlYO+8iOingeS4i+aWuSBiYW5uZXJz77yJ5Y+q5pu/5o2iIFVSTCDnmoRcbiAgICAgICAgLy8g5pyA5ZCO5LiA5Liq6Lev5b6E5q6177yIYGdldEdhY2hhTG9nYCDihpIgYGdldExkR2FjaGFMb2dg77yJ77yM5ZCM5qC35LiN5YWz5b+D5YmN57yAXG4gICAgICAgIC8vIOaYr+WTquS4gOWll++8jOS4pOenjeWGmeazlemDveS4jeS8mui4qembt+OAglxuICAgICAgICAvL1xuICAgICAgICAvLyDlj4LmlbDlkI3kuI7ljp/npZ7mqKHmnb/kuIDoh7TvvJpwYWdlL2dhY2hhX3R5cGUvc2l6ZS9lbmRfaWTvvIzmnaXmupBcbiAgICAgICAgLy8gc3Rhci1yYWlsLXdhcnAtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MTg477yIXG4gICAgICAgIC8vIGAke3VybH0mZ2FjaGFfdHlwZT0ke2tleX0mcGFnZT0ke3BhZ2V9JnNpemU9JHsyMH0ke2VuZElkPycmZW5kX2lkPScrZW5kSWQ6Jyd9YO+8ieOAglxuICAgICAgICB1cmw6IFwie3tjcmVkZW50aWFsfX0mcGFnZT17e3BhZ2V9fSZnYWNoYV90eXBlPXt7Z2FjaGFUeXBlfX0mc2l6ZT17e3BhZ2VTaXplfX0mZW5kX2lkPTBcIixcbiAgICAgIH0sXG4gICAgICAvLyDlm73mnI0gKyDlm73pmYXmnI3kuKTkuKogaG9zdCDpg73opoHmlLblvZXvvIznkIbnlLHkuI4gcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzXG4gICAgICAvLyA3OS04OCDooYzlkIzmrL7mlZnorq3kuIDoh7TvvJp1cmxQYXR0ZXJuIOacrOi6q+S4jeWMuuWIhuWfn+WQje+8jOWPquimgSBVUkwg6YeM5Ye6546wXG4gICAgICAvLyBcImdldEdhY2hhTG9nXCIg5bCx5Lya5Yy56YWN77yM6Iul5Y+q5aOw5piO5Zu95pyNIGhvc3TvvIzlm73pmYXmnI3njqnlrrbnmoTmraPluLjor7fmsYLkvJrooqtcbiAgICAgIC8vIOivr+WIpOS4uuaKleavkuiAjOaLkue7neOAguS4pOS4quWfn+WQjeW3sueUqCBIb1lvLkdhY2hhIOa6kOeggeaguOWunu+8mlxuICAgICAgLy8gZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDItNDNcbiAgICAgIC8vICAgKChIa3JwZywgT2ZmaWNpYWwpLCBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24taGtycGcubWlob3lvLmNvbS8uLi5cIlxuICAgICAgLy8gICAoKEhrcnBnLCBPdmVyc2VhKSwgIFN0YW5kYXJkKSAtPiBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1oa3JwZy1zZy5ob3lvdmVyc2UuY29tLy4uLlwiXG4gICAgICBhbGxvd2VkSG9zdHM6IFtcInB1YmxpYy1vcGVyYXRpb24taGtycGcubWlob3lvLmNvbVwiLCBcInB1YmxpYy1vcGVyYXRpb24taGtycGctc2cuaG95b3ZlcnNlLmNvbVwiXSxcbiAgICAgIGV4dHJhY3RMaXN0OiBleHRyYWN0R2FjaGFMb2dMaXN0LFxuICAgICAgLy8g6ZmQ6YCf562W55Wl77ya5pi+5byP5aOw5piO77yM5Y+W5YC85oqE6Ieq5Y+C6ICD5a6e546w55qE55yf5a6e6KGM5Li64oCU4oCUXG4gICAgICAvLyBzdGFyLXJhaWwtd2FycC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczoyMjPvvIhgYXdhaXQgc2xlZXAoMC4zKWBcbiAgICAgIC8vIOavj+mhteW7tui/nyAzMDBtc++8ieOAgToyMTktMjIy77yI5q+PIDEwIOmhtemineWkluWBnOmhvyAxc++8jOivpeeJiOacrOmHjOi/meauteiiq+azqOmHilxuICAgICAgLy8g5o6J5LqG77yM5L2G5pWw5YC85pys6Lqr5LuN5piv5Y+v5L+h55qE5Y+C6ICD5a6e546w6K6+6K6h5oSP5Zu+77yJ44CBOjIyNe+8iGByZXRyeUNvdW50OiA1YO+8ieOAglxuICAgICAgLy8g5a6/5Li75oyJXCLpgJDlrZfmrrXlj5bmm7TmuKnlkozogIVcIuWQiOW5tui/memHjOeahOWjsOaYjuS4juWuv+S4u+acrOasoeS8muivneeahOazqOWFpeetlueVpVxuICAgICAgLy8g77yIYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9yYXRlX2xpbWl0LnJzYCDnmoRcbiAgICAgIC8vIGBtZXJnZWRfd2l0aF9kZWNsYXJlZGDvvInigJTigJTku7vkvZXkuIDmlrnpg73kuI3og73miorlj6bkuIDmlrnmlL7mnb7vvIzlm6DmraTov5nph4zloatcbiAgICAgIC8vIFwi5ri45oiPIEFQSSDog73lj5flpJrlsJFcIu+8jOS4jemcgOimgeaLheW/g+iiq+Wuv+S4u+eahOabtOa/gOi/m+etlueVpeimhuebluOAglxuICAgICAgcmF0ZUxpbWl0OiB7XG4gICAgICAgIHBlclBhZ2VEZWxheU1zOiAzMDAsXG4gICAgICAgIGJhdGNoU2l6ZTogMTAsXG4gICAgICAgIGJhdGNoRGVsYXlNczogMTAwMCxcbiAgICAgICAgcmV0cnk6IHsgbWF4QXR0ZW1wdHM6IDUsIGRlbGF5TXM6IDUwMDAgfSxcbiAgICAgIH0sXG4gICAgICAvLyBiYW5uZXJJZGVudGl0eSDkuI3lo7DmmI7vvIznvLrnnIEgXCJyZXNwb25zZVwi4oCU4oCU6L+Z5piv5pi+5byP5Yaz562W77yM5LiN5piv5ryP5aGr44CCXG4gICAgICAvLyDnsbPlk4jmuLjkuInmuLjlhbHkuqvlkIzkuIDlpZcgYGdldEdhY2hhTG9nYCDlk43lupTlvaLmgIHvvIzljp/npZ7lt7Llrp7mtYvor4Hlrp7kvJrmt7fmsaBcbiAgICAgIC8vIO+8iGZpeHR1cmVzL2dlbnNoaW4vcmF3X3Jlc3BvbnNlLzMwMV9wYWdlXzEuanNvbu+8muafpeivoiBnYWNoYV90eXBlPTMwMe+8jFxuICAgICAgLy8g5ZON5bqU6YeM5re35ZueIGdhY2hhX3R5cGU9NDAwIOeahOiusOW9le+8ieOAguaYn+mTgeaYr+WQpuS8mua3t+axoO+8jOacrOasoeS7u+WKoeeugOaKpeS4jlxuICAgICAgLy8gcmVzZWFyY2gvMDPjgIEwNCDlnYfmnKrnu5nlh7rmmJ/pk4Hoh6rouqvnmoTni6znq4vmt7fmsaDlrp7mtYvvvIzkuI7puKPmva7pgqPnp43jgIzlt7Lor4Hlrp5cbiAgICAgIC8vIOS4jea3t+axoOOAjeeahOaDheWGteS4jeWQjOKAlOKAlOm4o+a9ruiDveWuieWFqOWjsOaYjiBcInF1ZXJ5XCLvvIjop4FcbiAgICAgIC8vIHBsdWdpbnMvd3V3YS9tYW5pZmVzdC50cyDnmoTlkIzlkI3lrZfmrrXms6jph4rvvInmmK/lm6DkuLrmnInnnJ/lrp7lrZjmoaPlrp7mtYvog4zkuabvvIxcbiAgICAgIC8vIOaYn+mTgeayoeacieOAguWjsOaYjiBcInF1ZXJ5XCIg5LiA5pem5YGH6K6+6ZSZ6K+v77yM5re35YWl55qE6K6w5b2V5Lya6KKr6Z2Z6buY6ZSZ6K+v5b2S5rGg5LiUXG4gICAgICAvLyDmnoHpmr7lrprkvY3vvIzku6Pku7fov5zpq5jkuo5cIuS4jeWjsOaYjuOAgeayv+eUqOabtOS/neWuiOeahOm7mOiupOWAvFwi77yM5Zug5q2k6L+Z6YeM5LiN6LWM44CCXG4gICAgfSxcbiAgfSxcblxuICBmaWVsZHM6IHtcbiAgICBleHRyYWN0UmVjb3JkOiAocmF3KSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCByYXcgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi5pif6ZOBIGV4dHJhY3RSZWNvcmQg5pS25Yiw6Z2e5a+56LGh5b2i5oCB55qE5Y6f5aeL6K6w5b2VXCIpO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVjb3JkID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4gICAgICAvLyDmmJ/pk4EgQVBJIOWOn+eUn+i/lOWbniBpdGVtX2lk4oCU4oCU5LiO5Y6f56We5LiN5ZCM77yI5Y6f56WeIGdldEdhY2hhTG9nIOS4jei/lOWbnlxuICAgICAgLy8gaXRlbV9pZO+8jGl0ZW1JZCDlj6rog73pgIDogIzmsYLlhbbmrKHnlKjmnKzlnLDljJbnianlk4HlkI3vvIzop4FcbiAgICAgIC8vIHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50cyDnmoTor6bnu4bor7TmmI7vvInjgILnnJ/lrp7orrDlvZXmoLfkvovop4EgcmVzZWFyY2gvMDNcbiAgICAgIC8vIMKnMS4z77ya6K+l5qC35L6L5oGw5aW95piv5LiA5p2h5YWD5pWw5o2u57y65aSx6K6w5b2V77yIaXRlbV9pZD1cIjEyMjNcIiDmnInnnJ/lrp7lgLzvvIxcbiAgICAgIC8vIG5hbWUvaXRlbV90eXBlL3JhbmtfdHlwZSDlhajkuLrnqbrlrZfnrKbkuLLvvInigJTigJTov5nmnaHmoLfkvovlj43ogIzmm7TmnInor7TmnI3lipvvvIxcbiAgICAgIC8vIOivgeaYjiBpdGVtX2lkIOaYr+i/meexu+W8guW4uOiusOW9lemHjOWUr+S4gOS7jeeEtuS/neivgemdnuepuueahOmUmueCueOAglxuICAgICAgY29uc3QgaXRlbUlkID0gdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaXRlbV9pZCk7XG4gICAgICBpZiAoIWl0ZW1JZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLmmJ/pk4EgZXh0cmFjdFJlY29yZO+8muiusOW9lee8uuWwkSBpdGVtX2lk77yM5peg5rOV56Gu5a6aIGl0ZW1JZFwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbUlkLFxuICAgICAgICB0aW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC50aW1lKSA/PyBcIlwiLFxuICAgICAgICAvLyBiYW5uZXJJZCDnlKggZ2FjaGFfdHlwZe+8iOWNoeaxoOexu+WIq+egge+8mjEvMi8xMS8xMi8yMS8yMu+8ie+8jOS4jeaYr1xuICAgICAgICAvLyBnYWNoYV9pZOKAlOKAlGdhY2hhX2lkIOaYr+WFt+S9k+WNoeaxoOWunuS+iyBpZO+8iOWmguWQjOS4gOexu+WIq+eggeS4i+maj+aXtumXtOaOqOWHuueahFxuICAgICAgICAvLyDkuI3lkIzmnJ/mlbDvvIxyZXNlYXJjaC8wMyDCpzEuMiDlrp7mtYvmnIkgNDkg56eN55yf5a6e5Y+W5YC877yJ77yMXG4gICAgICAgIC8vIFVuaWZpZWRSZWNvcmRGaWVsZHMg5rKh5pyJ5a2X5q616IO95om/6L295a6D77yM5Lya5a+86Ie0IGJhbm5lcnNbXSDpnIDopoHmnprkuL5cbiAgICAgICAgLy8g5oyB57ut5aKe6ZW/55qE5a6e5L6LIGlk77yM57u05oqk6LSf5ouF6L+c6auY5LqO5oyJ57G75Yir5aOw5piO77yM5Zug5q2k5LiN6JC95Zyw6L+Z5Liq5L+h5oGv77yMXG4gICAgICAgIC8vIOWPquS/neeVmSBnYWNoYV90eXBlIOi/meS4gOWxguWNoeaxoOexu+WIq+OAglxuICAgICAgICBiYW5uZXJJZDogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuZ2FjaGFfdHlwZSkgPz8gXCJcIixcbiAgICAgICAgY291bnQ6IHRvQ291bnQocmVjb3JkLmNvdW50KSxcbiAgICAgICAgbmFtZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQubmFtZSksXG4gICAgICAgIGl0ZW1UeXBlOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5pdGVtX3R5cGUpLFxuICAgICAgICByYXJpdHk6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLnJhbmtfdHlwZSksXG4gICAgICAgIHN0YWJsZUlkOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5pZCksXG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG5cbiAgLy8g5Y2h5rGg57G75Yir56CB5LiO5pi+56S65ZCN77yM55u05o6l5Y+W6IeqIHJlc2VhcmNoLzAzIMKnMi4xIOeahCB0eXBlTWFwIOWunua1i+e7k+aenO+8jFxuICAvLyDlrpjmlrnlsZXnpLrlkI3msr/nlKjku7vliqHnroDmiqXlj6PlvoTvvIgxLzIg5Lik5Liq5rGg55qE56ys5LiJ5pa55a+85Ye65bel5YW3IHR5cGVNYXAg55So55qE5pivXG4gIC8vIOmAmueUqOagh+etvlwi5bi46am76LeD6L+BXCIvXCLmlrDmiYvot4Pov4FcIu+8jOS4jeaYr+a4uOaIj+WGheWumOaWueWxleekuuWQjVwi576k5pif6LeD6L+BXCIvXG4gIC8vIFwi5aeL5Y+R6LeD6L+BXCLigJTigJTkuKTogIXmjIflkJHlkIzkuIDkuKogZ2FjaGFfdHlwZe+8jOWPquaYr+agh+etvuadpea6kOS4jeWQjO+8jOWmguWunuagh+azqO+8ieOAglxuICBiYW5uZXJzOiBbXG4gICAgeyBpZDogXCIxXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLnvqTmmJ/ot4Pov4FcIiB9IH0sXG4gICAgeyBpZDogXCIyXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLlp4vlj5Hot4Pov4FcIiB9IH0sXG4gICAgeyBpZDogXCIxMVwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6KeS6Imy5rS75Yqo6LeD6L+BXCIgfSB9LFxuICAgIHsgaWQ6IFwiMTJcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuWFiemUpea0u+WKqOi3g+i/gVwiIH0gfSxcbiAgICAvLyDogZTliqjot4Pov4HotbDni6znq4vnq6/ngrnvvIzmnaXmupAgc3Rhci1yYWlsLXdhcnAtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjE2XG4gICAgLy8g77yIYFsnMjEnLCcyMiddLmluY2x1ZGVzKGtleSkgPyAnZ2V0TGRHYWNoYUxvZycgOiAnZ2V0R2FjaGFMb2cnYO+8ie+8jFxuICAgIC8vIEhvWW8uR2FjaGEg55qEIGdhbWVfYml6L3NyYy9hcGkucnM6NDUtNDbvvIhDb2xsYWJvcmF0aW9uIOWIhuaUr++8ieWQjOagt+WNsOivgeOAglxuICAgIHsgaWQ6IFwiMjFcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuinkuiJsuiBlOWKqOi3g+i/gVwiIH0sIGVuZHBvaW50T3ZlcnJpZGU6IFwiZ2V0TGRHYWNoYUxvZ1wiIH0sXG4gICAgeyBpZDogXCIyMlwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5YWJ6ZSl6IGU5Yqo6LeD6L+BXCIgfSwgZW5kcG9pbnRPdmVycmlkZTogXCJnZXRMZEdhY2hhTG9nXCIgfSxcbiAgXSxcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gcGl0eUdyb3Vwc++8mjYg5Liq5Y2h5rGg5ZCE6Ieq54us56uL5LiA57uE77yM6IGU5Yqo5rGg5LiN5LiO5bi46KeE5rGg5ZCI5bm2XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyBiYXNlIC8gaGFyZFBpdHkgLyBndWFyYW50ZWUg5LiJ6aG55Y+W6Ieq5a6Y5pa55L+d5bqV5qaC546H5YWs56S6IEpTT05cbiAgLy8g77yIb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vaGtycGcvcHJvZF9nZl9jbi88aWQ+L1xuICAvLyB6aC1jbi5qc29u77yM5bey55Sx5Li76L+b56iL54us56uL5qC46aqM77yM5pysIEFnZW50IOS8muivneacqumHjeaWsOaKk+WPlu+8ie+8jOWPr+S/oeW6puinhuS4ulxuICAvLyDjgIzlrpjmlrnjgI3jgIJjdXJ2ZSDnmoQgc3RhcnQvc3RlcCDmmK/lkIzkurrnpL7ljLrmjqjnrpflgLzvvIzpnZ7lrpjmlrnvvIzop4HkuIrmlrlcbiAgLy8gQ0hBUkFDVEVSX1NPRlRfUElUWV9DVVJWRSAvIExJR0hUX0NPTkVfU09GVF9QSVRZX0NVUlZFIOeahOazqOmHiuOAglxuICAvL1xuICAvLyDimqDvuI8gKioyMS8yMiDogZTliqjmsaDkv53lupXni6znq4vkuo4gMTEvMTIg5bi46KeE5rGg77yM5LiN5ZCI5bm2IG1lbWJlcnMqKuKAlOKAlOWumOaWueWFrOekulxuICAvLyBKU09OIOWOn+aWh++8iOW3sueUseS4u+i/m+eoi+aguOmqjO+8ie+8muOAjOWcqOS7u+aEj+OAjEZhdGVbVUJXXSDop5LoibLogZTliqjot4Pov4HjgI3kuK3mnKrojrflj5ZcbiAgLy8gNeaYn+inkuiJsueahOe0r+iuoei3g+i/geasoeaVsOS8muS4gOebtOe0r+iuoeS6juOAjEZhdGVbVUJXXSDop5LoibLogZTliqjot4Pov4HjgI3kuK3vvIzkuI7lhbbku5ZcbiAgLy8g6LeD6L+B55qE6LeD6L+B5qyh5pWw5L+d5bqV55u45LqS54us56uL6K6h566X77yM5LqS5LiN5b2x5ZON44CC44CN6L+Z5p2h5q2k5YmN5piv5pys6aG555uu55qE5pyq5Yaz6aG577yMXG4gIC8vIOeOsOW3suacieWumOaWueWOn+aWh+iDjOS5pu+8jDIxLzIyIOWQhOiHquWNleeLrOaIkOe7hOOAglxuICBwaXR5R3JvdXBzOiBbXG4gICAge1xuICAgICAga2V5OiBcImNoYXJhY3RlckV2ZW50V2FycFwiLCAvLyAxMSDop5LoibLmtLvliqjot4Pov4FcbiAgICAgIG1lbWJlcnM6IFtcIjExXCJdLFxuICAgICAgaGFyZFBpdHk6IDkwLFxuICAgICAgY3VydmU6IENIQVJBQ1RFUl9TT0ZUX1BJVFlfQ1VSVkUsXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJmaWZ0eUZpZnR5XCIgfSwgLy8gNTAlIOebtOaOpSBVUO+8jOatquWImeS4i+asoeW/heS4rVxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcImxpZ2h0Q29uZUV2ZW50V2FycFwiLCAvLyAxMiDlhYnplKXmtLvliqjot4Pov4FcbiAgICAgIG1lbWJlcnM6IFtcIjEyXCJdLFxuICAgICAgaGFyZFBpdHk6IDgwLFxuICAgICAgY3VydmU6IExJR0hUX0NPTkVfU09GVF9QSVRZX0NVUlZFLFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwid2VpZ2h0ZWRcIiwgcmF0ZVVwQ2hhbmNlOiAwLjc1IH0sIC8vIDc1JSDnm7TmjqUgVVBcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJzdGVsbGFyV2FycFwiLCAvLyAxIOe+pOaYn+i3g+i/ge+8iOW4uOmpu++8ie+8jOaXoCBVUFxuICAgICAgbWVtYmVyczogW1wiMVwiXSxcbiAgICAgIGhhcmRQaXR5OiA5MCxcbiAgICAgIGN1cnZlOiBDSEFSQUNURVJfU09GVF9QSVRZX0NVUlZFLFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwibm9uZVwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwiZGVwYXJ0dXJlV2FycFwiLCAvLyAyIOWni+WPkei3g+i/ge+8iOaWsOaJi++8ie+8jOaXoCBVUFxuICAgICAgbWVtYmVyczogW1wiMlwiXSxcbiAgICAgIGhhcmRQaXR5OiA1MCxcbiAgICAgIC8vIOKaoO+4jyAqKnN0YXJ0L3N0ZXAg5pyq6KaG55uW77yM5aaC5a6e55WZ56m655SoIGN1c3RvbSDljaDkvY3vvIzkuI3lpJbmjqgqKu+8muS7u+WKoeeugOaKpVxuICAgICAgLy8g57uZ5Ye655qE5Lik5p2h56S+5Yy65o6o566X5Y+j5b6E5YiG5Yir5a+55bqU56Gs5L+d5bqVIDkw77yI6KeS6Imy57G777yJ5LiO56Gs5L+d5bqVIDgwXG4gICAgICAvLyDvvIjlhYnplKXnsbvvvInkuKTmoaPvvIzmnKzljaHmsaDnoazkv53lupUgNTDvvIzkuI3lsZ7kuo7ku7vkuIDmoaPvvJvmsqHmnInnrKzkuInmoaPnmoTmjqjnrpflgLxcbiAgICAgIC8vIOWPr+eUqO+8jOS5n+ayoeacieWIhuahtuWRveS4reeOh+aVsOaNruaUr+aSkeeOsOaOqOS4gOadoeaWsOabsue6v+OAguWkhOeQhuaWueW8j+Wvuem9kFxuICAgICAgLy8gcGx1Z2lucy93dXdhL21hbmlmZXN0LnRzIOWvueaXoOWIhuahtuaVsOaNruaUr+aSkeabsue6v+eahOS4gOi0r+WBmuazlVxuICAgICAgLy8g77yIYHd1d2EtdW5jb25maXJtZWQtKnN0YXItcG9vbC0qYCDljaDkvY0gaWTvvInjgIJcbiAgICAgIGN1cnZlOiB7IGtpbmQ6IFwiY3VzdG9tXCIsIGlkOiBcInN0YXJyYWlsLXVuY29uZmlybWVkLXNvZnRwaXR5LXBvb2wtMlwiIH0sXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJub25lXCIgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJjaGFyYWN0ZXJFdmVudFdhcnBDb2xsYWJcIiwgLy8gMjEg6KeS6Imy6IGU5Yqo6LeD6L+B77yM54us56uL5L+d5bqV77yM5LiN5LiOIDExIOWQiOW5tlxuICAgICAgbWVtYmVyczogW1wiMjFcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogQ0hBUkFDVEVSX1NPRlRfUElUWV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcImxpZ2h0Q29uZUV2ZW50V2FycENvbGxhYlwiLCAvLyAyMiDlhYnplKXogZTliqjot4Pov4HvvIzni6znq4vkv53lupXvvIzkuI3kuI4gMTIg5ZCI5bm2XG4gICAgICBtZW1iZXJzOiBbXCIyMlwiXSxcbiAgICAgIGhhcmRQaXR5OiA4MCxcbiAgICAgIGN1cnZlOiBMSUdIVF9DT05FX1NPRlRfUElUWV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIndlaWdodGVkXCIsIHJhdGVVcENoYW5jZTogMC43NSB9LFxuICAgIH0sXG4gIF0sXG4gIC8vIOacrOi9ruWPquWjsOaYjiA14piFIOS/neW6lee7hO+8jOS4jeWjsOaYjiA04piFIOe7hOKAlOKAlOWfuue6vyBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHNcbiAgLy8g5ZCM5qC35rKh5pyJIDTimIUg5YiG57uE77yM5L+d5oyB5Y+v5q+U77yb5pys6L2u5pyq6KaG55uW77yM55WZ5b6F5ZCO57ut5pyJ5YiG5qG25pWw5o2u5pSv5pKR5pe25YaN6KGl44CCXG5cbiAgcmFyaXR5OiB7IGxhZGRlcjogW1wiM1wiLCBcIjRcIiwgXCI1XCJdLCBwaXR5VGFyZ2V0OiBcIjVcIiB9LFxuXG4gIHRpbWU6IHtcbiAgICAvLyDnm7Tov57lrpjmlrkgQVBJ77yM5b6X5Yiw55qE5piv5pyN5Yqh5Zmo5pys5Zyw5pe26Ze05a2X56ym5Liy77yM5LiN5bim5pe25Yy6XG4gICAgLy8g77yIcmVzZWFyY2gvMDMgwqcyLjPvvJpcIuaXtumXtOWtl+espuS4suS4gOW+i+S4jeW4puaXtuWMuu+8jOaYr+acjeWKoeWZqOacrOWcsOaXtumXtFwi77yJ44CCXG4gICAgcmF3VGltZUNvbnZlbnRpb246IFwic2VydmVyTG9jYWxcIixcbiAgICAvLyByZWdpb25fdGltZV96b25lIOaYr+WTjeW6lOS9kyBkYXRhIOWxgueahOmhtee6p+Wtl+aute+8iOS4jiBsaXN0IOWQjOe6p++8jOS4jeaYr+mAkOadoVxuICAgIC8vIOiusOW9leWtl+aute+8ieKAlOKAlOadpea6kCByZXNlYXJjaC8wMyDCpzIuM+OAjOaYn+mTgSByZWdpb25fdGltZV96b25lPTjjgI0rXG4gICAgLy8gc3Rhci1yYWlsLXdhcnAtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjI2LTIzNO+8iGByZXM/LmRhdGFgIOino+aehOWHulxuICAgIC8vIGBsaXN0YC9gcmVnaW9uYC9gcmVnaW9uX3RpbWVfem9uZWAg5LiJ6ICF5ZCM57qn77yJ44CC5a6/5Li755qEXG4gICAgLy8gYHJlYWRfcGFnZV9sZXZlbF9maWVsZGAg5bey5a6e6KOF77yI5LiN5ZCM5LqOIGRyaWxscy9zdGFycmFpbC9tYW5pZmVzdC50c1xuICAgIC8vIOaSsOWGmeaXtiBNMS1TNyDnmoTnirbmgIHigJTigJTlvZPml7bov5nkuKrliIbmlK/ku47mnKrooqvmtojotLnvvIzmoIfkuoZcbiAgICAvLyBgI1thbGxvdyhkZWFkX2NvZGUpXWDvvIxNMiDlt7Llrp7oo4XlubbooqvnnJ/lrp7mtojotLnvvInvvIzlm6DmraTov5nph4zkuI3pnIDopoFcbiAgICAvLyBob29rcy5yZXNvbHZlVGltZXpvbmXvvIzlrr/kuLvkvJrnm7TmjqXku47lk43lupTkvZPpobXnuqflrZfmrrXor7vlj5blgY/np7vph4/jgIJcbiAgICB0aW1lem9uZVNvdXJjZTogeyBraW5kOiBcImFwaUZpZWxkXCIsIGZpZWxkOiBcInJlZ2lvbl90aW1lX3pvbmVcIiB9LFxuICAgIC8vIHJhd0Zvcm1hdCDkuI3loavvvJrlk43lupQgdGltZSDmmK/nqbrmoLzliIbpmpTmoLzlvI8gXCJZWVlZLU1NLUREIEhIOm1tOnNzXCJcbiAgICAvLyDvvIjlpoIgcmVzZWFyY2gvMDMgwqcxLjMg5qC35L6LIFwiMjAyNC0wOS0xMCAxMDowNToyNlwi77yJ77yM5oGw5aW95pivXG4gICAgLy8gUmF3VGltZUZvcm1hdCDnmoTpu5jorqTlgLwgc3BhY2VTZXBhcmF0ZWTvvIzkuI3pnIDopoHmmL7lvI/lo7DmmI7jgIJcbiAgfSxcblxuICBwcmVjb25kaXRpb25zOiBbXG4gICAge1xuICAgICAgaWQ6IFwic3RhcnJhaWwuY3JlZGVudGlhbC5jYWNoZURpckV4aXN0c1wiLFxuICAgICAgY2FwYWJpbGl0eTogXCJjcmVkZW50aWFsXCIsXG4gICAgICBsZXZlbDogXCJyZXF1aXJlZFwiLFxuICAgICAgZGVzY3JpYmU6IHtcbiAgICAgICAgXCJ6aC1DTlwiOiBcIuiHquWKqOiOt+WPlui3g+i/geiusOW9leimgeaxgua4uOaIj+WuouaIt+err+iHs+Wwkei/kOihjOi/h+S4gOasoe+8jOe8k+WtmOebruW9leaJjeS8muiiq+WIm+W7ulwiLFxuICAgICAgfSxcbiAgICAgIC8vIOWQjOWOn+elnuWFiOS+i++8mkhvc3RFbnYg55uu5YmN5rKh5pyJ44CMY3JlZGVudGlhbC5nYW1lRGlyIOWjsOaYjueahOe8k+WtmOebruW9leaYr+WQplxuICAgICAgLy8g5bey6KKr6KeC5rWL5Yiw44CN6L+Z5LiA5LqL5a6e77yMY2hlY2sg5Y+q6IO96L+U5ZueIHVua25vd27jgIJcbiAgICAgIGNoZWNrOiAoKSA9PiAoeyBraW5kOiBcInVua25vd25cIiB9KSxcbiAgICAgIHJlbWVkeTogeyBcInpoLUNOXCI6IFwi6K+35YWI5ZCv5Yqo5ri45oiP5bm25omT5byA5LiA5qyh6LeD6L+B6K6w5b2V6aG177yM5YaN5Zue5Yiw5pys5bqU55So6YeN6K+VXCIgfSxcbiAgICB9LFxuICBdLFxuXG4gIC8vIOS4juWOn+elnuS4gOiHtOeahOiMg+W8jyBBIOmAmueUqOWfuue6v+etlueVpe+8muWIhumhteWTjeW6lOiHquW4puaAu+adoeaVsO+8jOmbtuaIkOacrOOAgeWFqOimhuebluOAgVxuICAvLyDml6Dpop3lpJblh63mja7po47pmanjgIJcbiAgYmFzZWxpbmU6IHsga2luZDogXCJpbkdhbWVQYWdlQ291bnRcIiB9LFxuXG4gIHJldGVudGlvbjoge1xuICAgIGRpc3BsYXlUZXh0OiB7IFwiemgtQ05cIjogXCI2IOS4quaciFwiIH0sXG4gICAgLy8g5a6Y5pa5IEFQSSDlj6rov5Tlm57ov5EgNiDkuKrmnIjorrDlvZXvvIzmnIjplb/kuI3kuIDvvIzmjIkgNsOXMjg9MTY4IOWkqei/meexu+i+g+efreWAvOWPlu+8jFxuICAgIC8vIOWRiuitpuWugeaXqeWLv+aZmu+8jOWxleekuuaWh+ahiOS4gOW+i+eUqOOAjDYg5Liq5pyI44CN4oCU4oCU5Y+j5b6E5LiOIGdlbnNoaW4g5LiA6Ie077yM5p2l5rqQXG4gICAgLy8gcmVzZWFyY2gvMDIt5byC546vTlRF6YeH6ZuG5pa55qGI6LCD56CULm1kIMKnNS4x77ya44CM5Y6f56WeIC8g5pif6ZOBIC8g57ud5Yy66Zu2IHxcbiAgICAvLyDnuqYgNiDkuKrmnIjjgI3jgIJcbiAgICBjb25zZXJ2YXRpdmVEYXlzOiA2ICogMjgsXG4gIH0sXG5cbiAgLy8gaXRlbUlkU291cmNlIOS4jeWjsOaYju+8jOm7mOiupCBcIm5hdGl2ZVwi44CC6L+Z5piv5LiO5Y6f56We55qE5riF5pmw5a+554Wn77ya5Y6f56We5Zug5Li6IEFQSVxuICAvLyDkuI3ov5Tlm54gaXRlbV9pZCDmiY3pnIDopoHmmL7lvI/lo7DmmI4gXCJkaXNwbGF5TmFtZVwi77yb5pif6ZOB55qEIGl0ZW1faWQg5pivIEFQSSDljp/nlJ9cbiAgLy8g5a2X5q6177yI55yf5a6e5a2Y5qGj57uf6K6h6K+B5a6e77yM6KeB5LiK5pa5IGZpZWxkcy5leHRyYWN0UmVjb3JkIOWGheeahOivtOaYju+8ie+8jOS4jemcgOimgVxuICAvLyDov5nkuKrnibnkvovjgIJcblxuICAvLyBtZXRhZGF0YSDkuI3lo7DmmI7jgIJyZXNlYXJjaC8wMyDCpzEuMyDmjIflh7rmmJ/pk4HlrZjmoaPnoa7mnInlhYPmlbDmja7nvLrlpLHorrDlvZVcbiAgLy8g77yIMS81Mzcy77yJ77yMTWV0YWRhdGFQcm92aWRlciDnmoRcIuS6i+WQjuWbnuWhq1wi6IO95Yqb5a+55pif6ZOB5piv5b+F6KaB55qE77yM5L2G6Z2Z5oCBXG4gIC8vIOWtl+WFuOWGheWuueacrOasoeacquiOt+WPlu+8jOS4jee8lumAoOWtl+WFuOWGheWuue+8jOeVmeepuuS4juWOn+elnueOsOeKtuS4gOiHtFxuICAvLyDvvIhwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHMg5ZCM5qC35pyq5aOw5piOIG1ldGFkYXRh77yJ4oCU4oCU5pys6L2u5pyq6KaG55uW44CCXG5cbiAgLy8gZHJhd0NvdW50aW5nIOS4jeWjsOaYju+8jOm7mOiupCBwZXJSZWNvcmTvvIjnsbPlk4jmuLjkuInmuLggY291bnQg5oGS5Li6IDHvvIzpgILnlKjvvInjgIJcbn0gc2F0aXNmaWVzIFBsdWdpbk1hbmlmZXN0O1xuIiwiLyoqXG4gKiDpuKPmva7mj5Lku7bnmoTpgIPnlJ/oiLEgaG9va3PjgIJcbiAqXG4gKiDlj6rlrp7njrAgYGRlcml2ZVJlY29yZEtleXNgIOS4gOS4qiBob29r4oCU4oCUYHJlc29sdmVUaW1lem9uZWAg57y65bCRXG4gKiBzdnJfaWQvc3ZyX2FyZWEg5YiwIFVUQyDlgY/np7vph4/nmoTnnJ/lrp7mmKDlsITooajvvIxgY291bnREcmF3c2Ag5LiN6ZyA6KaB77yI6bij5r2uXG4gKiBgZHJhd0NvdW50aW5nYCDmnKrlo7DmmI7vvIzotbDpu5jorqQgYHBlclJlY29yZGDvvInvvIzop4EgYC4vbWFuaWZlc3QudHNgIOWvueW6lOWtl+autVxuICog5peB55qE5rOo6YeK44CCXG4gKlxuICogIyMg5Li65LuA5LmI5b+F6aG75piv5om55aSE55CG54mI5pys77yIYGRlcml2ZVJlY29yZEtleXNg77yJ77yM5LiN6IO955SoIGBkZXJpdmVSZWNvcmRLZXlgXG4gKlxuICog6bij5r2u5ZON5bqU6K6w5b2V5rKh5pyJ5Lu75L2V5b2i5byP55qE56iz5a6aIElE77yI6KeBIGAuL21hbmlmZXN0LnRzYCDnmoRcbiAqIGBmaWVsZHMuZXh0cmFjdFJlY29yZGAg5rOo6YeK77yJ77yMYHJlY29yZF9rZXlgIOetlueVpeaYr1xuICogYGhhc2go5pe26Ze0ICsg54mp5ZOBICsg5ZCM5om55qyh5YaF5bqP5L2NKWDigJTigJRcIuWQjOaJueasoeWGheW6j+S9jVwi6L+Z5Liq5L+h5oGvKirnu5PmnoTkuIrlj6rmnIlcbiAqIOWQjOaXtueci+WIsFwi6L+Z5LiA5om56YeM55qE5YW25L2Z6K6w5b2VXCLmiY3nrpflvpflh7rmnaUqKu+8jOWNleiusOW9leetvuWQjVxuICogYChyZWNvcmQpID0+IHN0cmluZ2Ag5YGa5LiN5Yiw77yM5Zug5q2k5b+F6aG755So5om55aSE55CG54mI5pys44CCXG4gKlxuICogIyMg55yf5a6e5a2Y5qGj5a6e5rWL55qE5Lik5Liq55m+5YiG5q+U77yI5LiN6KaB5re355So77yJXG4gKlxuICogYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKn5LiA5a+5IDMzNzEg5p2h55yf5a6e6K6w5b2V5oyJXG4gKiBgKOWNoeaxoCwg5pe26Ze0LCDnianlk4EpYCDliIbnu4Tnu5/orqHlh7rkuKTkuKrkuI3lkIzlkKvkuYnnmoTnmb7liIbmr5TvvIzooYzmlofml7blv4XpobvliIbmuIXmpZpcbiAqIOaMh+eahOaYr+WTquS4gOS4qu+8mlxuICogLSAqKjMyLjYwJe+8iDEwOTkvMzM3Me+8iSoq4oCU4oCUa2V5IOeahOato+ehruaApyoq5L6d6LWW5bqP5L2NKirnmoTorrDlvZXmr5TkvovvvIjnorDmkp7nu4RcbiAqICAg5YWo6YOo5oiQ5ZGY77ya57uE5YaF5Y+q6KaB5pyJIOKJpTIg5p2h6K6w5b2V77yM5pW057uE6YO9566X5Zyo5YaF77yM5Zug5Li657uE5YaF5Lu75L2V5LiA5p2h55qEIGtleVxuICogICDmmK/lkKbmraPnoa7pg73lj5blhrPkuo7luo/kvY3nrpflvpflr7nkuI3lr7nvvInjgIJcbiAqIC0gKioxNy41MyXvvIg1OTEvMzM3Me+8iSoq4oCU4oCU5LiN55So5bqP5L2N44CB5Y+q5oyJIGAo5Y2h5rGgLCDml7bpl7QsIOeJqeWTgSlgIOS4ieWFg+e7hOeul1xuICogICBrZXkg5pe277yM5Lya6KKrIGBJTlNFUlQgT1IgSUdOT1JFYCAqKumdmem7mOS4ouW8gyoq55qE6K6w5b2V5q+U5L6L77yI5q+P5Liq56Kw5pKe57uE6YeMXG4gKiAgIFwi5oqi5YiwXCLkuInlhYPnu4Qga2V5IOeahOmCo+S4gOadoeiDvea0u+S4i+adpe+8jOe7hOWGheWFtuS9meaIkOWRmOWFqOmDqOaSnumUruS4ouWkse+8ieOAglxuICpcbiAqIOeisOaSnue7hOWFsSA1MDgg57uE44CCNTA4IOS4queisOaSnue7hOWGhSoq6YCQ5a2X5q615a6M5YWo55u45ZCMKirvvIjlkIzkuIDkuKogYCjljaHmsaAsIOenkilgXG4gKiDlhoXnmoTljYHov57mibnmrKHlpKnnhLblpoLmraTvvInigJTigJTpuKPmva4gQVBJIOS4jeWIhumhteOAgeS4gOasoei/lOWbnuaVtOaxoOWFqOmHj++8jOi/meaYr+acrOaWh+S7tlxuICog5Lik5Liq6K6+6K6h6Zq+54K577yI5pa55ZCR44CB5bqP5L2N5a6J5YWo5oCn77yJ5ZSv5LiA55qE5a656ZSZ5p2l5rqQ77yM5LiL6Z2i6YCQ5LiA6K+05piO44CCXG4gKlxuICogIyMg6K6+6K6h6Zq+54K55LiA77ya5pWw57uE5pa55ZCR5LiN5Y+v5L+h77yM5b+F6aG75b2S5LiA5YyWXG4gKlxuICog5Y+C6ICD5a6e546wIGBVcGRhdGVHYWNoYURhdGFEaWFsb2dWaWV3TW9kZWwuY3NgIOmHjCBgYXBpRGF0YS5EYXRhLlJldmVyc2UoKWBcbiAqIOivgeWunu+8mkFQSSDlk43lupTmnKzouqvmmK8qKuWAkuW6jyoq77yI5pyA5paw55qE6K6w5b2V5o6S5pyA5YmN6Z2i77yJ77yM5Y+C6ICD5a6e546w5ou/5Yiw5ZON5bqU5ZCOXG4gKiDmlbTkvZPlj43ovazkuIDmrKHmiY3kvb/nlKjjgIJgZXh0cmFjdExpc3Rg77yI6KeBIGAuL21hbmlmZXN0LnRzYO+8ieS4jeaUueWPmOaVsOe7hOmhuuW6j++8jFxuICog5Y6f5qC35oqK6L+Z5Liq5YCS5bqP5pWw57uE5Lqk57uZIGBmaWVsZHMuZXh0cmFjdFJlY29yZGDvvIzlho3kuqTnu5nmnKzmlofku7bnmoRcbiAqIGBkZXJpdmVSZWNvcmRLZXlzYOKAlOKAlOS5n+WwseaYr+ivtO+8jOacrCBob29rIOaLv+WIsOeahOiusOW9lemhuuW6jyoq57un5om/6IeqIEFQSSDnmoRcbiAqIOecn+Wunui/lOWbnumhuuW6j++8jOaWueWQkeS4jeeUseaPkuS7tuiHquW3seaOp+WItioq44CCXG4gKlxuICog6Iul5bqP5L2N55u05o6l5oyJ6L6T5YWl5pWw57uE5LiL5qCH6K6h566X77yM6ICM5Lik5qyh6YeH6ZuG5LmL6Ze05pWw57uE5pa55ZCR5Y+R55Sf5Y+Y5YyW77yI5L6L5aaC5pyq5p2lXG4gKiDmnInku6PnoIHlnKggYGV4dHJhY3RMaXN0YCDkuI7mnKwgaG9vayDkuYvpl7Tmj5LlhaXkuobkuIDmrKHlj43ovazjgIHmiJYgQVBJIOacrOi6q+eahOaOkuW6j1xuICog57qm5a6a5Y+R55Sf5Y+Y5YyW77yJ77yM5ZCM5LiA5om56K6w5b2V5Lya566X5Ye65LiN5ZCM55qE5bqP5L2N77yMYHJlY29yZF9rZXlgIOWwseS8mua8guenu1xuICog4oCU4oCU6L+Z5q2j5pivIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlzYCDluYLnrYnmgKfopoHmsYLvvIhcIuWQjOS4gOadoeWunumZheiusOW9le+8jFxuICog5Lu75oSP5pe26Ze05Lu75oSP5qyh6YeH6ZuG6YO95b+F6aG75Lqn5Ye655u45ZCM55qEIGtleVwi77yJ5Lya6KKr5omT56C055qE5Zyw5pa544CCXG4gKlxuICogKirop6PlhrPmlrnmoYjvvJrmmL7lvI/lvZLkuIDljJbvvIzkuI3lgYforr7mlrnlkJHkuI3lj5jjgIIqKiDmr5TovoPmlbDnu4TpppblsL7kuKTmnaHorrDlvZXnmoTml7bpl7TvvIxcbiAqIOiLpemmliA+IOWwvu+8iOWAkuW6j++8ie+8jOWFiOaKiuaVtOS4quaVsOe7hOWPjei9rOaIkFwi5pen4oaS5pawXCLnmoTmraPluo/lho3orqHnrpfluo/kvY3vvJvoi6XpppYgPD1cbiAqIOWwvu+8iOW3sue7j+aYr+ato+W6j++8jOaIluaVsOe7hOmVv+W6piA8PSAxIOaXoOazleWIpOaWreaWueWQke+8ie+8jOaMieWOn+agt+WkhOeQhuOAgui/meS4quW9kuS4gOWMllxuICog5LmL5omA5Lul5q2j56Gu44CB5LiU5LiN6ZyA6KaB5a+5XCLnu4TlhoXpobrluo/mmK/lkKbkuZ/ooqvmraPnoa7ov5jljp9cIuWPpuS9nOivgeaYju+8mkFQSSDlk43lupTmmK/lr7lcbiAqICoq5pW05Liq5pWw57uEKirlgZrkuIDmrKHljZXkuIDmlrnlkJHnmoTmjpLluo/vvIjkuI3mmK9cIue7hOmXtOWAkuW6j+OAgee7hOWGheWPpuacieeLrOeri+mhuuW6j1wi77yJ77yMXG4gKiBgYXBpRGF0YS5EYXRhLlJldmVyc2UoKWAg6K+B5a6e5Y+C6ICD5a6e546w5aSE55CG55qE5piv5a+55pW05Liq5pWw57uE55qE5pW05L2T5Y+N6L2s4oCU4oCUXG4gKiDmlbTkvZPlj43ovazmmK/oh6rouqvnmoTpgIbmk43kvZzvvIzmr5TovoPpppblsL7liKTmlq3mlrnlkJHlkI7mjInpnIDmlbTkvZPlj43ovazkuIDmrKHvvIzlvpfliLDnmoTmraPluo9cbiAqIOaVsOe7hOS4jlwiQVBJIOS4gOW8gOWni+Wwsei/lOWbnuato+W6j1wi5pe26YCQ5L2N572u5a6M5YWo5LiA6Ie077yM5YyF5ous57uE5YaF5oiQ5ZGY55qE55u45a+56aG65bqP44CCXG4gKlxuICog5b2S5LiA5YyW5LmL5ZCO5YaN5oyJ77yI546w5bey5L+d6K+B5piv5q2j5bqP55qE77yJ5pWw57uE5LiL5qCH6aG65bqP57uZ5q+P5LiqIGAoYmFubmVySWQsIHRpbWUpYFxuICog5YiG57uE5YaF55qE6K6w5b2V57yW5Y+377yM5pyA5ZCO5oqK566X5Ye655qEIGtleSDlhpnlm54qKuWOn+Wni+i+k+WFpeS4i+aghyoq5a+55bqU55qE5L2N572u4oCU4oCUXG4gKiDov5Tlm57lgLzlv4XpobvkuI7ovpPlhaUgYHJlY29yZHNgIOmAkOS9jee9ruWvueW6lO+8jOi/meaYryBgUGx1Z2luSG9va3MuZGVyaXZlUmVjb3JkS2V5c2BcbiAqIOeahOWlkee6pu+8iFwi6L+U5Zue5YC85b+F6aG75LiO6L6T5YWl562J6ZW/44CB5oyJ6L6T5YWl6aG65bqP5LiA5LiA5a+55bqUXCLvvInjgIJcbiAqXG4gKiAjIyDorr7orqHpmr7ngrnkuozvvJpBUEkg5ZON5bqU57q/5qC85byP5pyq57uP5oqT5YyF6aqM6K+B77yMa2V5IOS4jeiDveebtOaOpeWTiOW4jOWOn+Wni+Wtl+espuS4slxuICpcbiAqIOWPguiAg+WunueOsOWPjeW6j+WIl+WMliBBUEkg5ZON5bqU5pe277yMYE1vZGVscy9HYWNoYURhdGEuY3NgIOeahCBgVGltZWAg5a2X5q615piv5by6XG4gKiDnsbvlnosgYERhdGVUaW1lYOKAlOKAlOe6v+agvOW8j+WcqOWPjeW6j+WIl+WMlumCo+S4gOatpeWwseiiq+ivreiogOi/kOihjOaXtuWQg+aOieS6hu+8jOa6kOeggemHjOeci1xuICog5LiN5Ye6IEFQSSDliLDlupXlj5HnmoTmmK8gYDIwMjQtMDYtMDZUMTA6MjM6NDhg77yISVNP77yJ6L+Y5pivXG4gKiBgMjAyNC8wNi8wNiAxMDoyMzo0OGDvvIjmlpzmnaDvvInov5jmmK/liKvnmoTlhpnms5XvvJvmnKzlnLDlrZjmoaPph4zlh7rnjrDnmoQgSVNPIOagvOW8j+aYr1xuICogTmV3dG9uc29mdCDluo/liJfljJYgYERhdGVUaW1lYCDnmoTpu5jorqTkuqfnianvvIzkuI3ku6PooaggQVBJIOWTjeW6lOacrOi6q+eahOe6v+agvOW8j++8m1xuICogYERhdGVGb3JtYXRTdHJpbmcgPSBcInl5eXkvTU0vZGQgaGg6bW06c3NcImAg5Y+q5Zyo5Y+N5bqP5YiX5YyW6Lev5b6E5LiK55Sf5pWI55qE6K+B5o2uXG4gKiDlvojlvLHvvIzkuI3otrPku6XlrprorrrvvJvmnKzku5PlupPmsqHmnInpuKPmva4gQVBJIOeahOecn+WunuaKk+WMheagt+acrOiDvemqjOivgeOAglxuICpcbiAqIOiLpSBgZGVyaXZlUmVjb3JkS2V5c2Ag55u05o6l5oqKIGByZWNvcmQudGltZWAg5Y6f5aeL5a2X56ym5Liy5ou86L+b5ZOI5biM6L6T5YWl77yM5LiA5pemXG4gKiDnur/moLzlvI/njJzplJnigJTigJTmiJbogIXml6XlkI4gQVBJIOaNouS6huS4quWIhumalOespuKAlOKAlOaJgOaciSBrZXkg6YO95Lya5LiO6aKE5pyf5LiN5ZCM77ya5LiN5LyaXG4gKiDmiqXplJnvvIzlj6rkvJrpnZnpu5jph43lpI3lhaXlupPvvIzmiJbogIXorqnlt7LlhaXlupPnmoQga2V5IOS4juaWsOmHh+mbhueul+WHuueahCBrZXkg5a+55LiN5LiK77yMXG4gKiDkuI4gSG9Zby5HYWNoYSDlm6DkuLogYHJlY29yZF9rZXlgIOiuvuiuoeS4jeWIsOS9jeS7mOWHuui/h+S4gOasoeaVtOihqOmHjeW7uui/geenu+aYr+WQjOS4gOexu1xuICog5Luj5Lu344CCXG4gKlxuICogKirop6PlhrPmlrnmoYjvvJrlhYjmioogYHRpbWVgIOinhOiMg+WMluaIkOS4jue6v+agvOW8j+aXoOWFs+eahOW9ouW8j++8jOWGjeWPguS4juWTiOW4jCoq77yM6KeB5LiL5pa5XG4gKiBgbm9ybWFsaXplVGltZUZvcktleWDjgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Ib29rcywgVW5pZmllZFJlY29yZEZpZWxkcyB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbi8qKlxuICog5oqKIEFQSSDlk43lupTnmoQgYHRpbWVgIOWtl+auteinhOiMg+WMluaIkOS4jue6v+agvOW8j+aXoOWFs+OAgeWPr+ebtOaOpeaMieWtl+espuS4suavlOi+g+Wkp+Wwj+eahFxuICog5b2i5byP77yIYFlZWVlNTURESEhtbXNzYO+8jDE0IOS9jee6r+aVsOWtl++8ieOAglxuICpcbiAqIGAyMDI0LTA2LTA2VDEwOjIzOjQ4YCDkuI4gYDIwMjQvMDYvMDYgMTA6MjM6NDhgIOW9kuS4gOWQjumDveaYr1xuICogYFwiMjAyNDA2MDYxMDIzNDhcImDigJTigJTnlKjmraPliJnmi4blh7rlubQv5pyIL+aXpS/ml7Yv5YiGL+enkuWFreS4quaVsOWtl+WIhumHj+WGjeaLvOaOpe+8jFxuICog5YiG6ZqU56ym5pys6Lqr77yIYC1gL2AvYC9gVGAv56m65qC877yJ6KKr5q2j5YiZ55u05o6l5ZCD5o6J44CB5LiN5b2x5ZON5b2S5LiA5YyW57uT5p6c44CCXG4gKlxuICog4pqg77iPICoq5LiN55SoIGBuZXcgRGF0ZSguLi4pYCDop6PmnpAqKu+8mmBEYXRlYCDmnoTpgKDlh73mlbDlr7nkuI3luKbml7bljLrlkI7nvIDnmoTlrZfnrKbkuLJcbiAqIOaMiSrov5DooYznjq/looPmnKzlnLDml7bljLoq6Kej6YeK77yM5ZCM5LiA5Liq5a2X56ym5Liy5Zyo5LiN5ZCM5py65ZmoL+S4jeWQjOaXtuWMuuS4iui3keWHuueahFxuICogYERhdGVgIOWvueixoeS7o+ihqOeahOe7neWvueaXtuWIu+S4jeWQjOKAlOKAlOi/meS4jlwi57qv5Ye95pWw44CB57uT5p6c5Y+q5Y+W5Yaz5LqO6L6T5YWlXCLov5nmnaHnoaxcbiAqIOe6puadn+ebtOaOpeWGsueqge+8iGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlzYCDlv4XpobvmmK/nuq/lh73mlbDvvIxUUyDov5DooYznjq/looNcbiAqIOeJqeeQhuS4iuS5n+S4jeaPkOS+m+iDveabv+S7oyBgRGF0ZWAg5pys5Zyw5pe25Yy66KGM5Li655qE5pe25Yy65pWw5o2u5bqT77yJ44CC5pS555So5q2j5YiZ55u05o6l5ouGXG4gKiDmlbDlrZfliIbph4/vvIzkuI3nu4/ov4cgYERhdGVg77yM6KeE6IyD5YyW57uT5p6c5LiO6L+Q6KGM546v5aKD5peg5YWz44CCXG4gKlxuICog4pqg77iPICoq5peg5rOV6K+G5Yir55qE5qC85byP5b+F6aG75oql6ZSZ77yM5LiN6IO96Z2Z6buY5Zue6JC95Yiw5Y6f5aeL5a2X56ym5LiyKirvvJrpnZnpu5jlm57okL3nrYnkuo5cbiAqIFwi5YWI5b2S5LiA5YyW5YaN5ZOI5biMXCLov5nlsYLkv53miqTlrozlhajkuI3lrZjlnKjigJTigJTmnKzpobnnm67lt7Lnu4/lpJrmrKHmipPliLBcIueci+i1t+adpeaciemYsuaKpOOAgVxuICog5a6e6ZmF5LuA5LmI6YO95rKh5YGaXCLov5nkuIDnsbvlpLHmlYjmqKHlvI/vvIzov5nph4zkuI3og73ph43ouYjjgIJcbiAqXG4gKiDnm67liY3lj6rorqTkuKTnp43lt7Lnn6XlgJnpgInmoLzlvI/vvIhJU08g55qEIGAtYC9gVGAg5YiG6ZqU44CB5Y+C6ICD5a6e546w5pqX56S655qEIGAvYC/nqbrmoLxcbiAqIOWIhumalO+8ie+8m+iLpeacquadpeecn+WunuaKk+WMheWPkeeOsOesrOS4ieenjeagvOW8j++8jOi/memHjOmcgOimgeWQjOatpeaJqeWxleato+WIme+8jOiAjOS4jeaYr+aUvuWuvVxuICog5YiwXCLpmo/kvr/ku4DkuYjpg73mlLZcIuOAglxuICovXG5mdW5jdGlvbiBub3JtYWxpemVUaW1lRm9yS2V5KHRpbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gL14oXFxkezR9KVstL10oXFxkezJ9KVstL10oXFxkezJ9KVtUIF0oXFxkezJ9KTooXFxkezJ9KTooXFxkezJ9KSQvLmV4ZWModGltZSk7XG4gIGlmICghbWF0Y2gpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBg6bij5r2uIGRlcml2ZVJlY29yZEtleXPvvJrml6Dms5Xor4bliKvnmoTml7bpl7TmoLzlvI8gXCIke3RpbWV9XCLigJTigJTnur/moLzlvI/mnKrnu4/mipPljIXpqozor4HvvIzmi5Lnu53lnKjnjJzmtYvnmoTmoLzlvI/kuIrorqHnrpcgcmVjb3JkX2tleWAsXG4gICAgKTtcbiAgfVxuICBjb25zdCBbLCB5ZWFyLCBtb250aCwgZGF5LCBob3VyLCBtaW51dGUsIHNlY29uZF0gPSBtYXRjaDtcbiAgcmV0dXJuIGAke3llYXJ9JHttb250aH0ke2RheX0ke2hvdXJ9JHttaW51dGV9JHtzZWNvbmR9YDtcbn1cblxuLyoqXG4gKiBGTlYtMWEgMzIg5L2N5ZOI5biM77yM57qv5L2N6L+Q566X5a6e546w77yM5LiN5L6d6LWW5Lu75L2VIE5vZGUvV2ViIOWKoOWvhiBBUEnigJTigJRUUyDkvqfov5DooYxcbiAqIOeOr+Wig+eJqeeQhuS4iuS4jeaPkOS+myBgY3J5cHRvYO+8jOaPkuS7tuS7o+eggeWPquiDveeUqOivreiogOWGhee9ruiDveWKm++8iGBjaGFyQ29kZUF0YC9cbiAqIGBNYXRoLmltdWxgL+enu+S9jei/kOeul++8jEVTMjAyMiDmoIflh4YgSlPvvIzku7vkvZXpgbXlvqrop4TojIPnmoTlvJXmk47pg73og73ot5HvvIzljIXmi6zlrr/kuLtcbiAqIOWGheW1jOeahCBRdWlja0pT77yJ44CCXG4gKlxuICog5Y+q5a+5IEFTQ0lJIOWtl+espuato+ehru+8muacrOaWh+S7tuWUr+S4gOeahOiwg+eUqOeCueS8oOWFpeeahOaYr1xuICogYEpTT04uc3RyaW5naWZ5KFtiYW5uZXJJZCwgbm9ybWFsaXplZFRpbWUsIGl0ZW1JZCwgc2VxSW5Hcm91cF0pYO+8jOWbm+S4qlxuICog5YiG6YeP5YiG5Yir5piv57qv5pWw5a2X5a2X56ym5Liy77yIUG9vbFR5cGUgaWTjgIFgbm9ybWFsaXplVGltZUZvcktleWAg55qE6L6T5Ye644CBXG4gKiBgcmVzb3VyY2VJZGAg6L2s55qE5a2X56ym5Liy44CB5om55qyh5YaF5bqP5L2N77yJ5YqgIEpTT04g5pys6Lqr55qE5qCH54K577yM6YCQ5a2X56ym6YO95ZyoXG4gKiBBU0NJSSDojIPlm7TlhoXvvIxgY2hhckNvZGVBdGAg5LiO5a2X6IqC5YC85LiA5LiA5a+55bqU77yM5LiN6ZyA6KaB5aSE55CG5aSa5a2X6IqC5a2X56ym44CCXG4gKi9cbmZ1bmN0aW9uIGZudjFhMzIoaW5wdXQ6IHN0cmluZywgb2Zmc2V0QmFzaXM6IG51bWJlcik6IHN0cmluZyB7XG4gIGxldCBoYXNoID0gb2Zmc2V0QmFzaXMgPj4+IDA7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgaW5wdXQubGVuZ3RoOyBpICs9IDEpIHtcbiAgICBoYXNoIF49IGlucHV0LmNoYXJDb2RlQXQoaSk7XG4gICAgaGFzaCA9IE1hdGguaW11bChoYXNoLCAweDAxMDAwMTkzKSA+Pj4gMDtcbiAgfVxuICByZXR1cm4gaGFzaC50b1N0cmluZygxNikucGFkU3RhcnQoOCwgXCIwXCIpO1xufVxuXG4vKiog5qCH5YeGIEZOVi0xYSAzMiDkvY3lgY/np7vln7rlh4bjgIIgKi9cbmNvbnN0IEZOVl9PRkZTRVRfQkFTSVNfQSA9IDB4ODExYzlkYzU7XG4vKipcbiAqIOesrOS6jOS4quWBj+enu+WfuuWHhu+8jOWPquimgeaxguS4jiBBIOS4jeWQjOKAlOKAlOeUqOadpeaKiuS4pOasoeeLrOeri+eahCAzMiDkvY3lk4jluIzmi7zmiJDkuIDkuKpcbiAqIDE2IOS9jeWNgeWFrei/m+WItu+8iDY0IOS9je+8ieeahOWkjeWQiCBrZXnvvIzpmY3kvY7ljZXni6zkuIDkuKogMzIg5L2N5ZOI5biM5Zyo5Yeg5Y2D5p2h6K6w5b2VXG4gKiDop4TmqKHkuIvnmoTnlJ/ml6XnorDmkp7mpoLnjofvvIhgc3FydCgyXjMyKSDiiYggNjU1MzZg77yM5LiA5Liq6LSm5Y+355qE6K6w5b2V5pWw6YeP57qn5bey57uPXG4gKiDlpJ/kuI3kuIrmlL7lv4Plj6rnlKggMzIg5L2N77yJ44CC5Y+W5YC85pys6Lqr5rKh5pyJ54m55q6K5ZCr5LmJ77yM5Y+q6KaB5rGC5piv5LiA5Liq5LiOIEEg5LiN5ZCM55qEXG4gKiDlm7rlrprluLjph4/jgIJcbiAqL1xuY29uc3QgRk5WX09GRlNFVF9CQVNJU19CID0gMHg5ZTM3NzliOTtcblxuLyoqXG4gKiDorqHnrpfljZXmnaHorrDlvZXnmoQgYHJlY29yZF9rZXlg44CCXG4gKlxuICog55SoIGBKU09OLnN0cmluZ2lmeWAg5oqK5Zub5Liq5YiG6YeP5bqP5YiX5YyW5oiQ5LiA5Liq5pWw57uE5a2X56ym5Liy77yM6ICM5LiN5piv55So5YiG6ZqU56ymXG4gKiDvvIjlpoIgYDpg77yJ5omL5bel5ou85o6l4oCU4oCUYG5vcm1hbGl6ZWRUaW1lYCDlhoXpg6jlhajmmK/mlbDlrZfmsqHmnInmrafkuYnvvIzkvYYgSlNPTiDnmoRcbiAqIOi9rOS5ieinhOWImeiDveS/neivgVwi5LiN5ZCM55qE6L6T5YWl5YWD57uE5LiN5Lya5ou85Ye65ZCM5LiA5Liq5a2X56ym5LiyXCLov5nmnaHmgKfotKjlnKjku7vkvZXmnKrmnaVcbiAqIOWIhumHj+exu+Wei+WPmOWMluaXtuS+neeEtuaIkOeri++8jOavlOaJi+W3peaMkeS4gOS4qlwi55yL6LW35p2l5LiN5Lya5Ye6546w5Zyo5a2X5q616YeMXCLnmoTliIbpmpTnrKZcbiAqIOabtOWPr+mdoOOAglxuICovXG5mdW5jdGlvbiBoYXNoUmVjb3JkS2V5KGJhbm5lcklkOiBzdHJpbmcsIG5vcm1hbGl6ZWRUaW1lOiBzdHJpbmcsIGl0ZW1JZDogc3RyaW5nLCBzZXFJbkdyb3VwOiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBjYW5vbmljYWwgPSBKU09OLnN0cmluZ2lmeShbYmFubmVySWQsIG5vcm1hbGl6ZWRUaW1lLCBpdGVtSWQsIHNlcUluR3JvdXBdKTtcbiAgcmV0dXJuIGAke2ZudjFhMzIoY2Fub25pY2FsLCBGTlZfT0ZGU0VUX0JBU0lTX0EpfSR7Zm52MWEzMihjYW5vbmljYWwsIEZOVl9PRkZTRVRfQkFTSVNfQil9YDtcbn1cblxuZXhwb3J0IGNvbnN0IGhvb2tzOiBQbHVnaW5Ib29rcyA9IHtcbiAgZGVyaXZlUmVjb3JkS2V5czogKHJlY29yZHM6IFVuaWZpZWRSZWNvcmRGaWVsZHNbXSk6IHN0cmluZ1tdID0+IHtcbiAgICBjb25zdCB0b3RhbCA9IHJlY29yZHMubGVuZ3RoO1xuICAgIGlmICh0b3RhbCA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gICAgLy8g5pe26Ze057q/5qC85byP5peg5YWz77ya5YWI57uf5LiA6KeE6IyD5YyW77yM5Ye6546w5peg5rOV6K+G5Yir55qE5qC85byP56uL5Yi75oql6ZSZ77yI6KeBXG4gICAgLy8gbm9ybWFsaXplVGltZUZvcktleSDmlofmoaPvvInvvIzkuI3lhYHorrjmn5DkuIDmnaHorrDlvZXmgoTmgoTnlKjljp/lp4vlrZfnrKbkuLLlj4LkuI7lk4jluIzjgIJcbiAgICBjb25zdCBub3JtYWxpemVkVGltZXMgPSByZWNvcmRzLm1hcCgocmVjb3JkKSA9PiBub3JtYWxpemVUaW1lRm9yS2V5KHJlY29yZC50aW1lKSk7XG5cbiAgICAvLyDmlrnlkJHlvZLkuIDljJbvvJrmr5TovoPpppblsL7kuKTmnaHorrDlvZXnmoTop4TojIPljJbml7bpl7TjgILpppYgPiDlsL7or7TmmI7mlbDnu4TmmK/lgJLluo9cbiAgICAvLyDvvIhBUEkg55yf5a6e6L+U5Zue55qE6aG65bqP77yM5Y+C6ICD5a6e546w55SoIGFwaURhdGEuRGF0YS5SZXZlcnNlKCkg5aSE55CG77yJ77yM6ZyA6KaBXG4gICAgLy8g5oyJXCLljp/lp4vovpPlhaXkuIvmoIdcIuWIsFwi5q2j5bqP6YGN5Y6G6aG65bqPXCLlu7rnq4vkuIDku73mmKDlsITvvJvlkKbliJnvvIjlt7Lnu4/mmK/mraPluo/vvIzmiJZcbiAgICAvLyDplb/luqYgPD0gMSDml6Dms5XliKTmlq3mlrnlkJHvvInnm7TmjqXmjInljp/lp4vkuIvmoIfpgY3ljobjgILop4Hmlofku7blpLTpg6hcIuiuvuiuoemavueCueS4gFwi44CCXG4gICAgLy9cbiAgICAvLyDkuIvmoIforr/pl67lnKggbm9VbmNoZWNrZWRJbmRleGVkQWNjZXNzIOS4i+exu+Wei+aYryBgc3RyaW5nIHwgdW5kZWZpbmVkYOKAlOKAlFxuICAgIC8vIOi/memHjOS4jeeUqOmdnuepuuaWreiogC/nsbvlnovovazmjaLlgYfoo4VcIuiCr+WumuS4jeS8mumUmVwi77yM6ICM5piv5pi+5byP5Yik56m65ZCO5oqb5YaF6YOo6ZSZ6K+vXG4gICAgLy8g77yI5LiOIHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvdGVzdGtpdC9pbmRleC50cyDlpITnkIblkIznsbvmg4XlvaLnmoTlhpnms5XkuIDoh7TvvInvvIxcbiAgICAvLyDnkIborrrkuIrkuI3kvJrop6blj5HvvJpmaXJzdFRpbWUvbGFzdFRpbWUg55qE5LiL5qCH5oGS5ZyoIFswLCB0b3RhbCkg5YaF44CCXG4gICAgY29uc3QgZmlyc3RUaW1lID0gbm9ybWFsaXplZFRpbWVzWzBdO1xuICAgIGNvbnN0IGxhc3RUaW1lID0gbm9ybWFsaXplZFRpbWVzW3RvdGFsIC0gMV07XG4gICAgaWYgKGZpcnN0VGltZSA9PT0gdW5kZWZpbmVkIHx8IGxhc3RUaW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIum4o+a9riBkZXJpdmVSZWNvcmRLZXlzIOWGhemDqOmUmeivr++8muaXoOazleWPluWIsOmmli/lsL7orrDlvZXnmoTop4TojIPljJbml7bpl7RcIik7XG4gICAgfVxuICAgIGNvbnN0IGlzRGVzY2VuZGluZyA9IHRvdGFsID4gMSAmJiBmaXJzdFRpbWUgPiBsYXN0VGltZTtcblxuICAgIGNvbnN0IGFzY2VuZGluZ09yZGVyOiBudW1iZXJbXSA9IG5ldyBBcnJheSh0b3RhbCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b3RhbDsgaSArPSAxKSB7XG4gICAgICBhc2NlbmRpbmdPcmRlcltpXSA9IGlzRGVzY2VuZGluZyA/IHRvdGFsIC0gMSAtIGkgOiBpO1xuICAgIH1cblxuICAgIC8vIOaMie+8iOW3suS/neivgeato+W6j+eahO+8iemBjeWOhumhuuW6j++8jOWvueavj+S4qiAoYmFubmVySWQsIOinhOiMg+WMluaXtumXtCkg5YiG57uE5YaF55qEXG4gICAgLy8g6K6w5b2V57yW5Y+377yM57yW5Y+35Y2zXCLmibnmrKHlhoXluo/kvY1cIu+8m+eul+WHuueahCBrZXkg5YaZ5Zue5Y6f5aeL6L6T5YWl5LiL5qCH5a+55bqU55qE5L2N572u44CCXG4gICAgY29uc3Qgc2VxQnlHcm91cCA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgY29uc3Qga2V5cyA9IG5ldyBBcnJheTxzdHJpbmc+KHRvdGFsKTtcbiAgICBmb3IgKGNvbnN0IG9yaWdpbmFsSW5kZXggb2YgYXNjZW5kaW5nT3JkZXIpIHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IHJlY29yZHNbb3JpZ2luYWxJbmRleF07XG4gICAgICBjb25zdCBub3JtYWxpemVkVGltZSA9IG5vcm1hbGl6ZWRUaW1lc1tvcmlnaW5hbEluZGV4XTtcbiAgICAgIGlmIChyZWNvcmQgPT09IHVuZGVmaW5lZCB8fCBub3JtYWxpemVkVGltZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIC8vIOS4jeW6lOWPkeeUn++8mm9yaWdpbmFsSW5kZXgg55Sx5LiK6Z2i55qE5b6q546v55Sf5oiQ77yM5Y+W5YC86IyD5Zu05oGS5ZyoIFswLCB0b3RhbCnjgIJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGDpuKPmva4gZGVyaXZlUmVjb3JkS2V5cyDlhoXpg6jplJnor6/vvJrkuIvmoIcgJHtvcmlnaW5hbEluZGV4fSDlpITnmoTorrDlvZXmiJbop4TojIPljJbml7bpl7TnvLrlpLFgKTtcbiAgICAgIH1cbiAgICAgIC8vIOKYhSDliIbnu4TplK7lv4XpobvljIXlkKsgaXRlbUlk77yM5LiN6IO95Y+q5oyJIChiYW5uZXJJZCwg5pe26Ze0KSDliIbnu4TjgIJcbiAgICAgIC8vXG4gICAgICAvLyDluo/kvY3lrZjlnKjnmoTllK/kuIDnm67nmoTvvIzmmK/ljLrliIYqKumAkOWtl+auteWujOWFqOebuOWQjOOAgeWQpuWImeaXoOazleWMuuWIhioq55qE6K6w5b2V44CCXG4gICAgICAvLyDnnJ/lrp7lrZjmoaPlrp7mtYvvvIhgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqfkuIDvvInph4zlkIznp5JcbiAgICAgIC8vIOeisOaSnue7hOWFsSA1MDgg57uE44CB57uE5YaF6K6w5b2V6YCQ5a2X5q615YWo562J77yb6K+l5a6h6K6hIMKnMS43IOKRoiDnu5nlh7rnmoTlronlhajmgKforrror4FcbiAgICAgIC8vIOS5n+ato+aYr+OAjOe7hOWGheiusOW9lemAkOWtl+auteWujOWFqOebuOWQjCDihpIg5Lqk5o2i5a6D5Lus5Lqn5Ye655qEIGtleSDlpJrph43pm4bkuI3lj5jjgI3jgIJcbiAgICAgIC8vIOi/meadoeiuuuivgeaIkOeri+eahOWJjeaPkO+8jOaYr+WIhue7hOaMiSoq5YWo562J5a2X5q61KirliJLliIbjgIJcbiAgICAgIC8vXG4gICAgICAvLyDoi6XliIbnu4TplK7mvI/mjokgaXRlbUlk77yM5LiA5qyh5Y2B6L+e77yIMTAg5p2h5ZCM56eS44CB5L2G54mp5ZOB5ZCE5LiN55u45ZCM55qE6K6w5b2V77yJ5Lya6KKrXG4gICAgICAvLyDloZ7ov5vlkIzkuIDnu4Tmi7/liLDluo/kvY0gMH4577yM5LqO5piv5q+P5p2h6K6w5b2V55qEIGtleSDpg73lj5blhrPkuo7lroPlnKjmlbDnu4Tph4znmoTkvY3nva7jgIJcbiAgICAgIC8vIOWQjuaenOW3suWcqOWFqOmHj+ecn+WunuaVsOaNru+8iDMzNzEg5p2h77yJ5LiK5a6e5rWL77yaXG4gICAgICAvLyAgIC0g5pa55ZCR6L+d5L6LIDEwIOadoeKAlOKAlFBvb2xUeXBlPTEyIOaVtOaJueWFseeUqOWQjOS4gOS4quaXtumXtOaIs++8jOmmluWwvuebuOetie+8jFxuICAgICAgLy8gICAgIOS4iumdoumCo+Wll1wi5q+U6L6D6aaW5bC+5Yik5pa55ZCRXCLnmoTpgLvovpHlpLHmlYjvvIzmraPluo8v5YCS5bqP5ZaC5YWl5Lqn5Ye65Lik5aWXIGtlee+8m1xuICAgICAgLy8gICAtICoq5aKe6ZW/56iz5a6a5oCn6L+d5L6LIDIwIOadoSoq4oCU4oCU6L+Z5p2h5omN55yf5q2j5Lya5Lyk5Yiw55So5oi377ya5pW05rGg5YWo6YeP5ouJ5Y+W5LiL77yMXG4gICAgICAvLyAgICAg5ZCO5LiA5qyh6YeH6ZuG5b+F54S25q+U5YmN5LiA5qyh6K6w5b2V5pu05aSa77yM5LiA5pem6K6w5b2V5Y+Y5aSa6K6p5pa55ZCR5Yik5a6a5LuOXCLliKTkuI3lh7pcIlxuICAgICAgLy8gICAgIOe/u+i9rOaIkFwi5Yik5b6X5Ye6XCLvvIzml6nlhYjpgqPmibnorrDlvZXnmoTluo/kvY3kvJrmlbTkvZPlj43ovazjgIFrZXkg5YWo5Y+Y77yM5LqO5piv6KKrXG4gICAgICAvLyAgICAg5b2T5oiQ5paw6K6w5b2VKirph43lpI3lhaXlupMqKuOAglxuICAgICAgLy8g5oqKIGl0ZW1JZCDlubbov5vliIbnu4TplK7lkI7vvIzkuIrov7DkuKTpobnlrp7mtYvliIbliKvpmY3kuLogMiDkuI4gMO+8m+WJqeS4i+mCoyAyIOadoee7j1xuICAgICAgLy8g5qC45a+56YO95piv44CM5LiO5Y+m5LiA5p2h6YCQ5a2X5q615YWo562J44CN55qE6K6w5b2V5LqS5o2i5LqGIGtleeKAlOKAlOiusOW9leacrOi6q+S4jeWPr+WMuuWIhu+8jFxuICAgICAgLy8g5YWo6YOoIDUg5Liq6Z2e56m65rGg55qEIGtleSDlpJrph43pm4blnYfkuIDoh7TvvIzljrvph43nu5PmnpzlrozlhajnrYnku7fjgIJcbiAgICAgIC8vXG4gICAgICAvLyDliIbpmpTnrKbnlKjmma7pgJrnqbrmoLzljbPlj6/vvJpiYW5uZXJJZCDmmK/nuq/mlbDlrZcgUG9vbFR5cGUgaWTvvIxub3JtYWxpemVkVGltZVxuICAgICAgLy8g5pivIG5vcm1hbGl6ZVRpbWVGb3JLZXkg5Lqn5Ye655qEIDE0IOS9jee6r+aVsOWtl+Wtl+espuS4su+8jGl0ZW1JZCDmmK/nuq/mlbDlrZdcbiAgICAgIC8vIHJlc291cmNlSWTvvIzkuInogIXpg73kuI3lj6/og73lkKvnqbrmoLzvvIzkuI3kvJrlh7rnjrDmi7zmjqXmrafkuYnjgIJcbiAgICAgIGNvbnN0IGdyb3VwS2V5ID0gYCR7cmVjb3JkLmJhbm5lcklkfSAke25vcm1hbGl6ZWRUaW1lfSAke3JlY29yZC5pdGVtSWR9YDtcbiAgICAgIGNvbnN0IHNlcUluR3JvdXAgPSBzZXFCeUdyb3VwLmdldChncm91cEtleSkgPz8gMDtcbiAgICAgIHNlcUJ5R3JvdXAuc2V0KGdyb3VwS2V5LCBzZXFJbkdyb3VwICsgMSk7XG4gICAgICBrZXlzW29yaWdpbmFsSW5kZXhdID0gaGFzaFJlY29yZEtleShyZWNvcmQuYmFubmVySWQsIG5vcm1hbGl6ZWRUaW1lLCByZWNvcmQuaXRlbUlkLCBzZXFJbkdyb3VwKTtcbiAgICB9XG5cbiAgICByZXR1cm4ga2V5cztcbiAgfSxcbn07XG4iLCIvKipcbiAqIOm4o+a9ruaPkuS7tiBtYW5pZmVzdOOAglxuICpcbiAqIOacrOaWh+S7tueUsSBNMi1TMS9TMiDnmoTnurjpnaLloavooajmvJTnu4PojYnnqL/vvIhgZHJpbGxzL3d1d2EvbWFuaWZlc3QudHNg77yJ6L2s5YyW6ICM5p2lXG4gKiDigJTigJTmvJTnu4Ppqozor4HnmoTmmK9cIlMyIOaUuei/h+eahOaPkuS7tuWlkee6puexu+Wei+aYr+WQpuijheW+l+S4i+m4o+a9rueahOecn+WunuW3ruW8gueCuVwi77yM5pys5paH5Lu2XG4gKiDmmK/miorpqozor4Hnu5PorrrokL3lnLDmiJDnnJ/mraPmjqXlhaUgYHBsdWdpbnMvaW5kZXgudHNgIOeahOWPr+i/kOihjOaPkuS7tuOAgui9rOWMlui/h+eoi+S4rVxuICog5Yig5o6J5LqG5ryU57uD5paH5Lu26YeM5aSn5q61XCLkuLrku4DkuYjlvZPml7bloavkuI3kuItcIueahOi/h+eoi+aAp+azqOmHiu+8iOmCo+S6m+epuueZveW3sue7j+iiq1xuICogUzIvUzMg55qE5aWR57qm5pS55Yqo5aGr5bmz77yM57un57ut5L+d55WZ5Lya6K+v5a+86K+76ICF5Lul5Li65a2X5q615LuN54S257y65aSx77yJ77yM5Y+q5L+d55WZ5LuN54S2XG4gKiDmiJDnq4vnmoTpoobln5/nn6Xor4bvvJvlt7LojrflvpfnnJ/lrp7lj4LmlbDnmoTlrZfmrrXvvIjor7fmsYIgYm9keSDlhbflkI3ljaDkvY3nrKbjgIFcbiAqIGBhbGxvd2VkSG9zdHNg44CBYHN0b3BDb25kaXRpb25g77yJ5oyJ5LiL5pa55rOo6YeK6YeM55qE5p2l5rqQ6YeN5paw5qCh5YeG5aGr5YaZ44CCXG4gKlxuICog5pWw5o2u5p2l5rqQ77yI5LiN5Yet6K6t57uD6K6w5b+G57yW6YCg5a2X5q615ZCNL+aVsOWAvO+8ie+8mlxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL1dXR2FjaGFFeHBvcnQvV1dHYWNoYUV4cG9ydC9TZXJ2aWNlcy9Db25maWdTZXJ2aWNlLmNzOjI5LTQzYFxuICogICDvvIgxMyDpobkgYFBvb2xUeXBlYCDooajvvIzmnoTpgKDlh73mlbDnrb7lkI0gYEdhY2hhUG9vbEluZm8ocG9vbFR5cGUsIG5hbWUsIG5vb2JQb29sLFxuICogICBsZXZlbEZpdmVNYXhEcmF3LCBsZXZlbEZvdXJNYXhEcmF3LCBpbmhlcml0ID0gdHJ1ZSlg77yM5pys5paH5Lu25a6e546w5YmN5bey6YCQ6KGM5qC45a+55rqQ56CB5Y6f5paH77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvV1dHYWNoYUV4cG9ydC9XV0dhY2hhRXhwb3J0L1ZpZXdNb2RlbHMvRGlhbG9ncy9VcGRhdGVHYWNoYURhdGFEaWFsb2dWaWV3TW9kZWwuY3NgXG4gKiAgIO+8iOaXpeW/l+i3r+W+hOaLvOaOpeOAgeW8guaIluino+a3t+a3huWPguaVsOOAgXF1ZXJ5IOWPguaVsCDihpIgUE9TVCBib2R5IOWtl+auteaYoOWwhOOAgVxuICogICBgY2FyZFBvb2xUeXBlYC9gcGxheWVySWRgIOeahCBDIyDnsbvlnovjgIFVc2VyLUFnZW5044CB6K+35rGCIGhvc3Qg5LqM6YCJ5LiA6YC76L6R44CBXG4gKiAgIGBhcGlEYXRhLkRhdGEuUmV2ZXJzZSgpYCDnmoTosIPnlKjkvY3nva7vvIzmnKzmlofku7blrp7njrDliY3lt7LpgJDooYzmoLjlr7nmupDnoIHljp/mlofvvIlcbiAqIC0gYGRvY3MvX2ludGVybmFsL2F1ZGl0L0FVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRg77yIMzM3MSDmnaFcbiAqICAg55yf5a6e5a2Y5qGj55qE5a2X5q6157G75Z6L57uf6K6h44CBYHJlY29yZF9rZXlgIOeisOaSnueOh+Wunua1i+OAgeS/neW6lemXtOmalOS4jumAkOaKveWRveS4reeOh++8iVxuICogLSBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2DjgIFgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC90eXBlcy9nZW5lcmF0ZWQudHNgXG4gKiAgIO+8iFMzIOS5i+WQjueahOWlkee6puexu+Wei++8muWFt+WQjeWNoOS9jeespiBge3tjcmVkZW50aWFsLjxxdWVyeVBhcmFtPn19YOOAgVxuICogICBgUmVxdWVzdFRlbXBsYXRlLm1ldGhvZGAvYGhlYWRlcnNgL2Bib2R5YOOAgWBTdG9wQ29uZGl0aW9uLnNpbmdsZVJlcXVlc3Rg77yJXG4gKiAtIGBjcmF0ZXMvcGFyYWRpZ21zL2dzLXAtYXV0aGtleS9zcmMvcGlwZWxpbmUucnNg77yIYFJlcXVlc3RUZW1wbGF0ZUpzb25gIOS4iuaWuVxuICogICBcIuW3suefpee8uuWPoyBDOFwiIOazqOmHiu+8muWbvemZheacjSBob3N0IOaXoOazleS7jiBgc3ZyX2FyZWFgIOaOqOWHuiBUTETvvIzliLvmhI/kuI3pooTmlL5cbiAqICAgYC5uZXRg77ybYHN1YnN0aXR1dGVfbmFtZWRfY3JlZGVudGlhbF9wbGFjZWhvbGRlcnNgIOeahOS4ieadoSBmYWlsLWNsb3NlZCDop4TliJnvvIlcbiAqXG4gKiDku43mnKrop6PlhrPjgIHlpoLlrp7moIfms6jjgIHkuI3nvJbpgKDnmoTnvLrlj6Pop4Hlr7nlupTlrZfmrrXml4HnmoTms6jph4rvvJo04piFL+WkmuaVsCA14piFIOaxoOeahOa4kOi/m1xuICog5qaC546H57K+56Gu5pWw5YC85pys5py65qC35pys5LiN6Laz5Lul5qCH5a6a44CBYHJlc29sdmVUaW1lem9uZWAg57y65bCRIHN2cl9pZC9zdnJfYXJlYSDliLBcbiAqIFVUQyDlgY/np7vph4/nmoTnnJ/lrp7mmKDlsITooajjgIHogZTliqjmsaDnmoRcIuacn+asoeWGheS/neW6lemHjee9rlwi5Y+C6ICD5a6e546w5Zyo55yf5a6e5pWw5o2u5LiK5beyXG4gKiDlpLHmlYjlm6DogIzmnKzmj5Lku7bkuI3lrp7njrDjgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbi8vIOaJk+WMheiEmuacrO+8iHNjcmlwdHMvZ3MtYnVuZGxlLXBsdWdpbnMubWpz77yJ5LuOIG1hbmlmZXN0LnRzIOi/meS4gOS4quWFpeWPo+WQjOaXtuWPllxuLy8gbWFuaWZlc3Qg5LiOIGhvb2tzIOS4pOS4quWvvOWHuu+8jOS4jiBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHMg55qE5YaZ5rOV5LiA6Ie044CCXG5leHBvcnQgeyBob29rcyB9IGZyb20gXCIuL2hvb2tzLnRzXCI7XG5cbi8qKiDlj6/pgInkvYbkuI3mjqXlj5fnqbrkuLLigJTigJTnqbrkuLLlv4XpobvooqvlvZPmiJDjgIzmsqHmnInlgLzjgI3vvIzkuI3og73lhpLlhYXjgIzmnInlgLzjgI3jgIIgKi9cbmZ1bmN0aW9uIHRvTm9uRW1wdHlTdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpO1xuICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdHJpbW1lZCA6IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiDlk43lupTorrDlvZXnmoQgYHJlc291cmNlSWRgL2BxdWFsaXR5TGV2ZWxgIOaYryBKU09OIG51bWJlcu+8iGBNb2RlbHMvR2FjaGFBUEkuY3NgXG4gKiDnmoQgYHJlc291cmNlSWQ6IGludGDjgIFgcXVhbGl0eUxldmVsOiBpbnRg77yM5LiU5bey6KKrXG4gKiBgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqcyLjEg55qE55yf5a6e5a2Y5qGj5a2X5q6157G75Z6L57uf6K6hXG4gKiDni6znq4vor4Hlrp7vvInvvIzkuI7nsbPlk4jmuLjkuInmuLhcIuaVsOWtl+Wtl+espuS4slwi5LiN5ZCM77yM5Zug5q2k5Y2V54us5LiA5Liq6L2s5o2i5Ye95pWw44CCXG4gKi9cbmZ1bmN0aW9uIG51bWVyaWNUb1N0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0cmltbWVkIDogdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogYGNvdW50OiBpbnRg77yIYE1vZGVscy9HYWNoYUFQSS5jc2DvvIzlkIzkuIrlt7LooqvnnJ/lrp7lrZjmoaPnu5/orqHni6znq4vor4Hlrp7mgZLkuLrlkIzkuIBcbiAqIOaVtOaVsOWPluWAvO+8ieOAgumYsuW+oeW8j+i9rOaNoiArIOW8guW4uOWFnOW6leS4uiAx77yM5a655b+N5ZON5bqU5b2i5oCB5LiO5pys5py65qC45a6e55qE5qC35pys5LiN5a6M5YWoXG4gKiDkuIDoh7TnmoTmg4XlhrXjgIJcbiAqL1xuZnVuY3Rpb24gdG9Db3VudCh2YWx1ZTogdW5rbm93bik6IG51bWJlciB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgcGFyc2VkID0gTnVtYmVyKHZhbHVlKTtcbiAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiBwYXJzZWQ7XG4gIH1cbiAgcmV0dXJuIDE7XG59XG5cbi8qKlxuICog5LuOIGBQT1NUIGdtc2VydmVyLWFwaS5ha2ktZ2FtZTIuY29tL2dhY2hhL3JlY29yZC9xdWVyeWAg5ZON5bqU5L2T5Y+W5Ye66K+lXG4gKiBQb29sVHlwZSDnmoTlhajpg6jorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDimqDvuI8gKirlk43lupTlpJblsYLkv6HlsIHlvaLmgIHmnKzouqvnoJTnqbbmnKropobnm5YqKu+8mmBNb2RlbHMvR2FjaGFBUEkuY3NgIOe7meWHuueahOaYr+WNleadoVxuICog6K6w5b2V55qEIERUTyDlrZfmrrXvvIzmsqHmnInnu5nlh7rlk43lupTlpJblsYLkv6HlsIHnmoTlrozmlbQgSlNPTiDlvaLmgIHvvJvmnKzmnLrmsqHmnInpuKPmva4gQVBJXG4gKiDnmoTnnJ/lrp7mipPljIXmoLfmnKzjgILov5nph4zpmLLlvqHlvI/lhbzlrrnnsbPlk4jmuLjkuInmuLjlkIzml4/mj5Lku7bluLjop4HnmoTkuKTnp43kv6HlsIFcbiAqIO+8iGB7IGRhdGE6IFsuLi5dIH1gIOS4jiBgeyBkYXRhOiB7IGxpc3Q6IFsuLi5dIH0gfWDvvInvvIzkuKTogIXpg73mmK8qKuexu+avlCoq77yMXG4gKiDkuI3mmK/lt7LmoLjlrp7kuovlrp7vvIzku7vkvZXkuIDlsYLlvaLnirbkuI3lr7nlsLHov5Tlm57nqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjigJTigJTliIbpobXlvJXmk47kvJrmiopcbiAqIOepuuaVsOe7hOW9k+S9nOe7iOatouadoeS7tuWkhOeQhu+8jOavlOiuqeS4gOasoeWTjeW6lOW9ouaAgeS4jeespuebtOaOpeS4reaWreaVtOadoemHh+mbhua1geeoi+abtOWuieWFqOOAglxuICovXG5mdW5jdGlvbiBleHRyYWN0R2FjaGFSZWNvcmRMaXN0KHJlc3BvbnNlOiB1bmtub3duKTogdW5rbm93bltdIHtcbiAgaWYgKHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIiB8fCByZXNwb25zZSA9PT0gbnVsbCkgcmV0dXJuIFtdO1xuICBjb25zdCBkYXRhID0gKHJlc3BvbnNlIGFzIHsgZGF0YT86IHVua25vd24gfSkuZGF0YTtcbiAgaWYgKEFycmF5LmlzQXJyYXkoZGF0YSkpIHJldHVybiBkYXRhO1xuICBpZiAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgZGF0YSAhPT0gbnVsbCkge1xuICAgIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkobGlzdCkpIHJldHVybiBsaXN0O1xuICB9XG4gIHJldHVybiBbXTtcbn1cblxuLyoqXG4gKiAxMyDpobkgYFBvb2xUeXBlYCDooajvvIzpgJDlrZfmrrXlj5boh6ogYFNlcnZpY2VzL0NvbmZpZ1NlcnZpY2UuY3M6MjktNDNgIOWOn+agt+ihqOagvO+8mlxuICogICBgKFBvb2xUeXBlLCDlkI3np7AsIOaYr+WQpuaWsOaJi+axoCwgNeKYheehrOS/neW6lSwgNOKYheehrOS/neW6lSwg5L+d5bqV5piv5ZCm57un5om/KWBcbiAqXG4gKiDmnKzooajkv53nlZnnnJ/mraPnlKjlvpfkuIrnmoTkuInliJfvvJppZCAvIGRpc3BsYXlOYW1lIC8gaGFyZFBpdHk1U3Rhcu+8jOWkluWKoFxuICogYGZpdmVTdGFyR3VhcmFudGVlS2luZGDvvIjmnKzmj5Lku7boh6rooYzlvZLnurPvvIzkuI3lnKggYENvbmZpZ1NlcnZpY2UuY3NgIOWOn+ihqOmHjO+8jFxuICog6KeB5LiL5pa55Y2V54us6K+05piO77yJ44CCNOKYhSDnoazkv53lupXmgZLkuLogMTDvvIjop4HkuIvmlrkgYFdVV0FfNFNUQVJfSEFSRF9QSVRZYO+8ie+8jOS4jeWGjVxuICog6ZyA6KaB6YCQ6KGM5Yy65YiG44CC44CM5piv5ZCm5paw5omL5rGg44CN44CM5L+d5bqV5piv5ZCm57un5om/44CN5Lik5YiX55uu5YmN55qE5o+S5Lu25aWR57qm6YeM5rKh5pyJ5a+55bqUXG4gKiDlrZfmrrXlj6/ku6Xmib/ovb3vvIzjgIzmmK/lkKbnu6fmib/jgI3ov5nkuIDliJfljbPkvb/mnInlrZfmrrXkuZ/ml6Dms5XmraPnoa7lrp7njrDvvIzop4HkuIvmlrlcbiAqIGBwaXR5R3JvdXBzYCDkuIDoioLnmoRcIuW3suefpee8uuWPo1wi6K+05piO44CCXG4gKlxuICogYGZpdmVTdGFyR3VhcmFudGVlS2luZGAg5Y+W5YC85L6d5o2u77yIYGRvY3MvX2ludGVybmFsL21pbGVzdG9uZXMvXG4gKiAwMy1NMi3puKPmva7mj5Lku7bkuI7mir3osaHor4HkvKoubWRgIMKnNC4077yaXCLop5LoibLmsaAgNTAvNTDvvIzmrablmajmsaDlv4XkuK3kuI3mrapcIu+8ie+8mlxuICogICAtIDUg5Liq44CM6KeS6Imy44CN5rGg77yIaWQgMS8zLzgvMTAvMTLvvInlj5YgYGZpZnR5RmlmdHlg4oCU4oCU5L6d5o2u5piv5oqKIMKnNC4044CM6KeS6Imy5rGgXG4gKiAgICAgNTAvNTDjgI3ov5nmnaHpgJrnlKjnu5PorrrmjInjgIzop5LoibLljaHmsaDjgI3lpKfnsbvlupTnlKjvvIzkuI3mmK/lr7nluLjpqbsv5paw5peFL+iBlOWKqC/lv4bml4VcbiAqICAgICDov5nkupvlrZDnsbvlnovpgJDkuIDljZXni6zpqozor4Hov4fjgIJcbiAqICAgLSA1IOS4quOAjOatpuWZqOOAjeaxoO+8iGlkIDIvNC85LzExLzEz77yJ5Y+WIGBhbHdheXNSYXRlVXBg4oCU4oCU5ZCM5LiK77yM5oyJ44CM5q2m5Zmo5Y2h5rGg44CNXG4gKiAgICAg5aSn57G75bqU55So44CCXG4gKlxuICogICDimqDvuI8g5Lil5qC86K+077yM5Y+q5pyJ44CM6KeS6Imy5rS75Yqo5ZSk5Y+W44CN44CM5q2m5Zmo5rS75Yqo5ZSk5Y+W44CN77yIaWQgMS8y77yJ6L+Z5Lik5Liq5a2Q57G75Z6LXG4gKiAgIOWcqCDCpzQuNCDph4zmnInnm7TmjqXlr7nnhafvvIzlhbbkvZkgOCDkuKrmmK8qKuWQjOexu+aOqOW5vyoq44CC5o6o5bm/5pys6Lqr5piv5ZCI55CG55qE6aKG5Z+f5o6o5patXG4gKiAgIO+8iOaLheS/neinhOWImeWcqOm4o+a9rumHjOaMieeJqeWTgeWkp+exu+iAjOmdnuaMieWNoeaxoOWtkOexu+Wei+WIkuWIhu+8ie+8jOS9huWug+ayoeaciemAkOaxoOWunua1i1xuICogICDog4zkuabigJTigJToi6Xml6XlkI7mn5DkuKrlrZDnsbvlnovooqvlj5HnjrDop4TliJnkuI3lkIzvvIzmlLnov5nkuIDliJfljbPlj6/vvIzkuI3lv4Xliqjku7vkvZXpgLvovpHjgIJcbiAqICAgLSAzIOS4quOAjOaWsOaJi+OAjeaxoO+8iGlkIDUvNi8377yJ5Y+WIGBub25lYOKAlOKAlCoq5rKh5pyJ5Lu75L2V5a6e5rWL5L6d5o2uKirvvIzlj6rmmK/msr/nlKhcbiAqICAgICDmraTliY3nlKjmsaDlkI3lrZfnrKbkuLLljLnphY3ml7bnmoTnjrDnirbvvIjmsaDlkI3kuI3lkKtcIuinkuiJslwi5Lmf5LiN5ZCrXCLmrablmahcIu+8jOWMuemFjeS4jeS4ilxuICogICAgIOS7u+S9leS4gOaUr+aJjeiQveWIsCBgbm9uZWDvvInvvIzpgJDooYzmoIfms6ggYC8vIOaXoOWunua1i+S+neaNru+8jOayv+eUqOeOsOeKtmDjgIJcbiAqXG4gKiDkuYvliY3mmK/ku44gYHBvb2wubmFtZWAg55SoIGAuaW5jbHVkZXMoXCLop5LoibJcIilgL2AuaW5jbHVkZXMoXCLmrablmahcIilgIOeOsOWcuuaOqOWvvFxuICog6L+Z5Liq5YC877yM6L+Z6YeM5pS55oiQ5pi+5byP5YiX5Ye64oCU4oCU5pi+56S65ZCN5piv57uZ5Lq655yL55qE77yM5LiN6K+l5om/5ouFXCLlhrPlrprkv53lupXor63kuYlcIui/meS4qlxuICog6IGM6LSj77ya5pS55LiA5Liq5a2X44CB5oiW5Ye6546w5ZCM5pe25ZCrL+mDveS4jeWQq+i/meS4pOS4quivjeeahOaxoOWQje+8jOivreS5ieS8mumdmem7mOaUueWPmO+8m+WbuuWMllxuICog5oiQ6KGo5qC85ZCO5q+P5LiA6KGM55qE5Y+W5YC855u05o6l5Y+v6K+777yM5LiN55So6Lez5Yiw5Yir5aSE5Y+N5o6o44CCXG4gKi9cbmNvbnN0IFdVV0FfUE9PTF9UWVBFUyA9IFtcbiAgeyBpZDogXCIxXCIsIG5hbWU6IFwi6KeS6Imy5rS75Yqo5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gIHsgaWQ6IFwiMlwiLCBuYW1lOiBcIuatpuWZqOa0u+WKqOWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImFsd2F5c1JhdGVVcFwiIH0sXG4gIHsgaWQ6IFwiM1wiLCBuYW1lOiBcIuinkuiJsuW4uOmpu+WUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjRcIiwgbmFtZTogXCLmrablmajluLjpqbvllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJhbHdheXNSYXRlVXBcIiB9LFxuICB7IGlkOiBcIjVcIiwgbmFtZTogXCLmlrDmiYvllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogNTAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJub25lXCIgfSwgLy8g5peg5a6e5rWL5L6d5o2u77yM5rK/55So546w54q2XG4gIHsgaWQ6IFwiNlwiLCBuYW1lOiBcIuaWsOaJi+iHqumAieWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcIm5vbmVcIiB9LCAvLyDml6Dlrp7mtYvkvp3mja7vvIzmsr/nlKjnjrDnirZcbiAgeyBpZDogXCI3XCIsIG5hbWU6IFwi5paw5omL6Ieq6YCJ5ZSk5Y+W77yI5oSf5oGp5a6a5ZCR5ZSk5Y+W77yJXCIsIGhhcmRQaXR5NVN0YXI6IDEsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJub25lXCIgfSwgLy8g5peg5a6e5rWL5L6d5o2u77yM5rK/55So546w54q2XG4gIHsgaWQ6IFwiOFwiLCBuYW1lOiBcIuinkuiJsuaWsOaXheWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjlcIiwgbmFtZTogXCLmrablmajmlrDml4XllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJhbHdheXNSYXRlVXBcIiB9LFxuICB7IGlkOiBcIjEwXCIsIG5hbWU6IFwi6KeS6Imy6IGU5Yqo5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gIHsgaWQ6IFwiMTFcIiwgbmFtZTogXCLmrablmajogZTliqjllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJhbHdheXNSYXRlVXBcIiB9LFxuICB7IGlkOiBcIjEyXCIsIG5hbWU6IFwi6KeS6Imy5b+G5peF5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gIHsgaWQ6IFwiMTNcIiwgbmFtZTogXCLmrablmajlv4bml4XllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJhbHdheXNSYXRlVXBcIiB9LFxuXSBhcyBjb25zdDtcblxuLyoqIDTimIUg56Gs5L+d5bqV77yM5YWo6YOoIDEzIOmhuSBQb29sVHlwZSDlhbHnlKjlkIzkuIDkuKrlgLzvvIhgQ29uZmlnU2VydmljZS5jc2Ag56ysIDUg5YiX5oGS5Li6IDEw77yJ44CCICovXG5jb25zdCBXVVdBXzRTVEFSX0hBUkRfUElUWSA9IDEwO1xuXG4vKiogYGZpdmVTdGFyR3VhcmFudGVlS2luZGAg4oaSIOWunumZhSBgR3VhcmFudGVlUnVsZWAg5a2X6Z2i6YeP5a+56LGh77yIUDIg6KGo77yJ44CCICovXG5jb25zdCBXVVdBX0ZJVkVfU1RBUl9HVUFSQU5URUVfQllfS0lORCA9IHtcbiAgZmlmdHlGaWZ0eTogeyBraW5kOiBcImZpZnR5RmlmdHlcIiBhcyBjb25zdCB9LFxuICBhbHdheXNSYXRlVXA6IHsga2luZDogXCJhbHdheXNSYXRlVXBcIiBhcyBjb25zdCB9LFxuICBub25lOiB7IGtpbmQ6IFwibm9uZVwiIGFzIGNvbnN0IH0sXG59IGFzIGNvbnN0O1xuXG4vKipcbiAqIOS7juaXpeW/l+ihjOaPkOWPliBnYWNoYUxpbmsg55qE5q2j5YiZ77yM6YCQ5a2X5Y+W6Ieq5Y+C6ICD5a6e546wXG4gKiDvvIhgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYCDnmoQgYFJlZ2V4Lk1hdGNoYCDosIPnlKjvvInvvJpcbiAqICAgYChodHRwcz8uKlxcL2FraVxcL2dhY2hhXFwvaW5kZXhcXC5odG1sI1xcL3JlY29yZFtcXD89Jlxcd1xcLV0rKWBcbiAqXG4gKiDmjInooYwqKuWAkuW6jyoq5omr5o+P44CB5ZG95Lit56ys5LiA5Liq5Y2z5YGc6L+Z5Lu25LqL5a6M5YWo5pivIFJ1c3QgTDFcbiAqIO+8iGBjcmF0ZTo6Y2FjaGVfc2NhbmDvvInnmoTlrp7njrDnu4boioLvvIzmnKzmraPliJnlj6rlo7DmmI7ljLnphY3mqKHlvI/mnKzouqvvvIzmj5Lku7bkvqfkuI3pnIDopoFcbiAqIO+8iOS5n+S4jeiDve+8ieWjsOaYjuaJq+aPj+aWueWQkeOAglxuICovXG5jb25zdCBXVVdBX0dBQ0hBX0xJTktfUEFUVEVSTiA9IC8oaHR0cHM/LipcXC9ha2lcXC9nYWNoYVxcL2luZGV4XFwuaHRtbCNcXC9yZWNvcmRbXFw/PSZcXHdcXC1dKykvO1xuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIDXimIUg5riQ6L+b5qaC546H5puy57q/XG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyDimqDvuI8g6L+Z5Lik5Liq5aOw5piO5b+F6aG75pS+5ZyoIGBleHBvcnQgY29uc3QgbWFuaWZlc3RgIOS5i+WJjeKAlOKAlOS4i+mdoiBgbWFuaWZlc3QucGl0eUdyb3Vwc2Bcbi8vIOeahCBgZmxhdE1hcGAg5ZyoKirmqKHlnZfmsYLlgLzmnJ8qKuWwseS8muiwg+eUqCBgZml2ZVN0YXJDdXJ2ZWDvvIzoi6Xmiopcbi8vIGBXVVdBX0ZJVkVfU1RBUl9QUk9HUkVTU0lWRV9DVVJWRWAg5aOw5piO5pS+5ZyoIGBtYW5pZmVzdGAg5LmL5ZCO77yMYGNvbnN0YCDkuI3kvJpcbi8vIOiiq+aPkOWNh+WIneWni+WMlu+8iOaaguaXtuaAp+atu+WMuu+8ie+8jOS8muWcqOaxguWAvCBgbWFuaWZlc3RgIOaXtuebtOaOpeaKm1xuLy8gXCJDYW5ub3QgYWNjZXNzIGJlZm9yZSBpbml0aWFsaXphdGlvblwi44CCXG5cbi8qKlxuICogNeKYhSDmuJDov5vmpoLnjofmm7Lnur/nmoQqKueyl+eykuW6pui/keS8vCoq77yM5Y+q5a+556Gs5L+d5bqVIDgwIOeahOaxoOWtkOaIkOeri1xuICog77yIMS8yLzMvNC82LzgvOS8xMC8xMS8xMi8xM+KAlOKAlOWNs+mZpCA144CBNyDkuYvlpJbnmoTlhajpg6jvvInjgIJcbiAqXG4gKiDmlbDlgLznm7TmjqXlj5boh6ogYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKnMy4z77yIUG9vbFR5cGVcbiAqIDEvMi80IOWQiOW5tuOAgeaMiSAxMCDmir3liIbmobbnmoTnnJ/lrp7lkb3kuK3njofvvIzkuI3mmK/pgJDmir3mi5/lkIjlh7rmnaXnmoTmm7Lnur/vvInvvJpcbiAqICAgMX42MCDmir3vvJrlkb3kuK3njoflnKggMC41JX4xLjklIOS5i+mXtOazouWKqO+8jOivpeaWh+aho+WIpOWumuS4uuWwj+agt+acrOWZquWjsO+8jFxuICogICAgICAgICAgICDlha3kuKrliIbmobblnYflgLwg4omIMC45MyXvvIzlm5voiI3kupTlhaXlj5YgMSUg5L2c5Li6IGJhc2VcbiAqICAgNjF+NzAg5oq977yaNi45Je+8iDMxNyDkuKrmoLfmnKzjgIEyMiDmrKHlkb3kuK3vvIlcbiAqICAgNzF+ODAg5oq977yaNDguMSXvvIgyNyDkuKrmoLfmnKzjgIExMyDmrKHlkb3kuK3vvIwqKue9ruS/oeWMuumXtOaegeWuvSoq4oCU4oCU5qC35pys6YeP5bCP77yMXG4gKiAgICAgICAgICAgICDov5nkuKrmlbDlrZfmnKzouqvlsLHmnInlvojlpKfkuI3noa7lrprmgKfvvIzkuI3opoHlvZPmiJDnsr7noa7lgLzkvb/nlKjvvIlcbiAqXG4gKiBgY3JhdGVzL2dzLWFuYWx5c2lzL3NyYy9waXR5LnJzYCDnmoQgYGV2YWx1YXRlX2N1cnZlYCDlr7kgYFByb2dyZXNzaXZlYCDnmoRcbiAqIOivreS5ieaYr+OAjGB0YWJsZWAg5q+P5Liq5YWD57Sg5a+55bqU5LiA5oq944CN77yaYHB1bGxfaW5kZXggPD0gc3RhcnRgIOaXtuWPliBgYmFzZWDvvIxcbiAqIGBwdWxsX2luZGV4ID4gc3RhcnRgIOaXtuWPliBgdGFibGVbcHVsbF9pbmRleCAtIHN0YXJ0IC0gMV1g77yI5Y2zIGB0YWJsZVswXWBcbiAqIOWvueW6lOesrCBgc3RhcnQgKyAxYCDmir3vvInvvIzkuIvmoIfotornlYzpkrPliLbliLDmnIDlkI7kuIDkuKrlhYPntKDigJTigJTov5nmnaHmm7Lnur/njrDlnKjkvJrooqtcbiAqIOecn+Wunua2iOi0ue+8jOS4jeWGjeaYr+WNoOS9jeWjsOaYjuOAguaMiei/meS4quivreS5ie+8jOS4i+mdoiAyMCDkuKrlhYPntKDmmK/miorkuIrpnaLkuKTkuKogMTAg5oq9XG4gKiDliIbmobYqKumAkOaKveWxleW8gCoq77ya56ysIDYxfjcwIOaKve+8iGB0YWJsZVswLi45XWDvvInlj5YgNi45Je+8jOesrCA3MX44MCDmir1cbiAqIO+8iGB0YWJsZVsxMC4uMTldYO+8ieWPliA0OC4xJeOAglxuICpcbiAqIOKaoO+4jyAqKui/meaYr+WIhuauteW4uOaVsOWxleW8gO+8jOS4jeaYr+mAkOaKveagh+Wumioq77ya5qG25YaF5q+P5LiA5oq95Y+W5ZCM5LiA5Liq5YC85piv5LiA5Liq5pi+5byP55qEXG4gKiDlu7rmqKHpgInmi6nvvIzkv6Hmga/ph4/kuI7ljp/lp4vliIbmobbmlbDmja7lrozlhajnm7jlkIzvvIzmsqHmnInlh63nqbrnvJbpgKDku7vkvZXmlrDkv6Hmga/vvJvkvYbnnJ/lrp5cbiAqIOabsue6v+WcqOahtuWGheWkp+amgueOh+aYr+WNleiwg+S4iuWNh+eahO+8iOi2iuaOpei/keS/neW6leWRveS4reeOh+i2iumrmO+8ie+8jOWIhuauteW4uOaVsOS8muiuqeahtueahFxuICog5YmN5Yeg5oq95qaC546H5YGP6auY44CB5ZCO5Yeg5oq95YGP5L2O77yM6L+Z5piv5bey55+l55qE6L+R5Ly86K+v5beu77yM5LiN5piv6ZSZ6K+v5pWw5o2u44CC562J5pyJ6YCQ5oq9XG4gKiDnsr7nu4bmoLfmnKzvvIjlsKTlhbbmmK8gNzF+ODAg5oq96L+Z5LiA5qG277yMMjcg5Liq5qC35pys5pKR5LiN6LW357K+56Gu5puy57q/77yJ5YaN5pu/5o2i44CCXG4gKi9cbmNvbnN0IFdVV0FfRklWRV9TVEFSX1BST0dSRVNTSVZFX0NVUlZFID0ge1xuICBraW5kOiBcInByb2dyZXNzaXZlXCIgYXMgY29uc3QsXG4gIGJhc2U6IDAuMDEsXG4gIHN0YXJ0OiA2MCxcbiAgLy8gMTAg5LiqIDYuOSXvvIjnrKwgNjF+NzAg5oq977yJKyAxMCDkuKogNDguMSXvvIjnrKwgNzF+ODAg5oq977yJ77yM5a+55bqU5LiK5pa55rOo6YeK55qEXG4gIC8vIOWIhuauteW4uOaVsOWxleW8gOOAgueUqCBBcnJheS5maWxsIOaLvOaOpeiAjOmdnuaJi+WGmSAyMCDkuKrlrZfpnaLph4/vvIzpgb/lhY3mlbDplJnkuKrmlbDvvIxcbiAgLy8g5Lmf6K6p44CMMTAgKyAxMOOAjei/meS4quWIhuahtue7k+aehOWcqOS7o+eggemHjOS/neaMgeWPr+ingeOAglxuICB0YWJsZTogWy4uLkFycmF5KDEwKS5maWxsKDAuMDY5KSwgLi4uQXJyYXkoMTApLmZpbGwoMC40ODEpXSxcbn07XG5cbi8qKlxuICog5oyJIFBvb2xUeXBlIOWIhua0viA14piFIOabsue6v+OAglxuICpcbiAqIC0gUG9vbFR5cGUgN++8iOaWsOaJi+iHqumAieWUpOWPlsK35oSf6LCi5a6a5ZCR5ZSk5Y+W77yJ77ya56Gs5L+d5bqVID0gMe+8jOaVsOWtpuS4iuebtOaOpeetieS7t+S6jlxuICogICBcIuavj+asoeWUpOWPlumDveW/heWHuiA14piFXCLvvIzkuI3mmK/njJzmtYvigJTigJTnoazkv53lupXmlbDlgLzmnKzouqvlhrPlrprnmoTvvIzkuI3kvp3otZbku7vkvZXlrp7mtYtcbiAqICAg5qC35pys44CCXG4gKiAtIFBvb2xUeXBlIDXvvIjmlrDmiYvllKTlj5bvvIznoazkv53lupUgNTDvvInvvJrnnJ/lrp7lrZjmoaPlrp7mtYvor6XmsaAgKiowIOadoeiusOW9lSoqXG4gKiAgIO+8iGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCpzEuMiBcIuepuuanveS9jVwi5YiX5Ye6IDUg5Zyo5YaF77yJ77yMXG4gKiAgIOiAjCBgV1VXQV9GSVZFX1NUQVJfUFJPR1JFU1NJVkVfQ1VSVkVgIOeahOabsue6v+W9oueKtuaYr+S7juehrOS/neW6lSA4MCDnmoTkuInkuKrmsaBcbiAqICAg77yIMS8yLzTvvInlrp7mtYvmlbDmja7ph4zmjqjlh7rnmoTigJTigJTmuJDov5vmm7Lnur/nkIblupTpmo/noazkv53lupXkvY3nva7mnKzouqvlj5jljJbvvIjkv53lupUgNTBcbiAqICAg55qE5rGg5a2Q5LiN5Y+v6IO95Zyo56ysIDYwIOaKveaJjeW8gOWni1wi6LeD5Y2HXCLvvIzpgqPlt7Lnu4/otoXov4fnoazkv53lupXmnKzouqvvvInvvIzmioogODAg56GsXG4gKiAgIOS/neW6leaxoOWtkOeahOabsue6v+ebtOaOpeWll+WIsCA1MCDnoazkv53lupXnmoTmsaDlrZDkuIrmmK/msqHmnInor4Hmja7mlK/mjIHnmoTlpJbmjqjvvIzlm6DmraRcbiAqICAg5pys5rGg5LuN55SoIGN1c3RvbSDljaDkvY3vvIzkuI3lpJbmjqjjgIJcbiAqIC0g5YW25L2Z5YWo6YOo56Gs5L+d5bqVIDgwIOeahOaxoOWtkO+8muWFseeUqOWQjOS4gOadoSBgV1VXQV9GSVZFX1NUQVJfUFJPR1JFU1NJVkVfQ1VSVkVgXG4gKiAgIOKAlOKAlOWPquaciSAxLzIvNCDkuInkuKrmsaDmnInnnJ/lrp7moLfmnKzvvIzlhbbkvZnlkIznoazkv53lupXmsaDlrZDmsqHmnInni6znq4vmoLfmnKzvvIzkvYbkuZ/msqHmnIlcbiAqICAg5Lu75L2V55CG55Sx6K6k5Li65a6D5Lus55qE5puy57q/5b2i54q25LiN5ZCM77yM55So5ZCM5LiA5p2h5puy57q/5pivXCLnlKjku4XmnInnmoTor4Hmja7kuIDoh7TlnLDlupTnlKhcIu+8jFxuICogICDkuI3mmK/pgJDmsaDnvJbpgKDlh7rkupLkuI3nm7jlkIznmoTmlbDlrZfjgIJcbiAqL1xuZnVuY3Rpb24gZml2ZVN0YXJDdXJ2ZShwb29sOiAodHlwZW9mIFdVV0FfUE9PTF9UWVBFUylbbnVtYmVyXSkge1xuICBpZiAocG9vbC5oYXJkUGl0eTVTdGFyID09PSAxKSB7XG4gICAgcmV0dXJuIHsga2luZDogXCJmbGF0XCIgYXMgY29uc3QsIGJhc2U6IDEgfTtcbiAgfVxuICBpZiAocG9vbC5oYXJkUGl0eTVTdGFyICE9PSA4MCkge1xuICAgIHJldHVybiB7IGtpbmQ6IFwiY3VzdG9tXCIgYXMgY29uc3QsIGlkOiBgd3V3YS11bmNvbmZpcm1lZC01c3Rhci1wb29sLSR7cG9vbC5pZH1gIH07XG4gIH1cbiAgcmV0dXJuIFdVV0FfRklWRV9TVEFSX1BST0dSRVNTSVZFX0NVUlZFO1xufVxuXG5leHBvcnQgY29uc3QgbWFuaWZlc3QgPSB7XG4gIGlkOiBcInd1d2FcIixcbiAgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIum4o+a9rlwiIH0sXG4gIHNka1ZlcnNpb246IFwiMS4wLjBcIixcbiAgcGxhdGZvcm1zOiBbXCJ3aW5kb3dzXCJdLFxuICBtYWludGFpbmVyczogW1wiZ2FjaGEtc3R1ZGlvXCJdLFxuICAvLyBleGNoYW5nZUZvcm1hdHMg5LiN5aOw5piO77ya6bij5r2u5rKh5pyJ5bey55+l55qE5YWs5byA5qCH5YeG5Lqk5o2i5qC85byP77yIV1dHRiDkuYvnsbvnmoTor7Tms5VcbiAgLy8g5pyq57uP6K+B5a6e77yMYHJlc2VhcmNoLzAxYCDCpzMuMiDlt7Lnoa7orqTlj4LogIPlrp7njrDnmoTmnKzlnLDlrZjmoaPmmK/oh6rlrprkuYkgSlNPTiDnu5PmnoRcbiAgLy8g6ICM6Z2e5Lu75L2V5qCH5YeG5qC85byP77yJ77yM5aOw5piO5LiA5Liq5LiN5a2Y5Zyo55qE5qC85byP5q+U5LiN5aOw5piO5pu05pyJ5a6z44CCXG5cbiAgLy8g5Zu+5qCH5Zyw5Z2A5p2l6IeqIFRhcFRhcCDlupTnlKjluILlnLrpobXpnaLvvIzlt7Llrp7mtYvpqozor4HvvIzlkIwgYHBsdWdpbnMvZ2Vuc2hpbi9cbiAgLy8gbWFuaWZlc3QudHNgIOWQjOasvuaVmeiureKAlOKAlOWcsOWdgOS7pSAuanBnIOe7k+WwvuS9huWunumZheWGheWuueaYryBQTkfvvIzkuI3opoFcIue6oOato1wiXG4gIC8vIOaJqeWxleWQje+8jOagvOW8j+agoemqjO+8iGNvbnRlbnQtdHlwZSArIG1hZ2ljIGJ5dGVz77yJ5piv5a6/5Li75L6n6IGM6LSj44CCXG4gIGljb25Vcmw6XG4gICAgXCJodHRwczovL2ltZy10Yy50YXBpbWcuY29tL21hcmtldC9pbWFnZXMvYTQ2NWUzNGYwZTRhZmIzNjMxZThlZTViMWYwMmM5OTIucG5nL190YXBfYXBwaWNvbl9tLmpwZ1wiLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBjb2xsZWN077ya5YWI5LuOIENsaWVudC5sb2cg5ou/5Yet5o2u77yIZ2FjaGFMaW5r77yJ77yM5YaN6LCDIHJlY29yZC9xdWVyeSDmjqXlj6NcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGNvbGxlY3Q6IHtcbiAgICBwYXJhZGlnbTogXCJjcmVkZW50aWFsZWRBcGlcIixcbiAgICBwYXJhbXM6IHtcbiAgICAgIGNyZWRlbnRpYWw6IHtcbiAgICAgICAga2luZDogXCJsb2dGaWxlXCIsXG4gICAgICAgIC8vIOKaoO+4jyDnm7jlr7nniYfmrrXvvIzkuI3mmK/nu53lr7not6/lvoTigJTigJRgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzOjY2LTY3YFxuICAgICAgICAvLyDmmL7npLrlrpjmlrnlkK/liqjlmajkuI4gV2VHYW1lIOWQr+WKqOWZqOeahOaXpeW/l+ebuOWvuei3r+W+hOS4jeWQjO+8iOWumOaWueWQr+WKqOWZqOWcqOa4uOaIj1xuICAgICAgICAvLyDnm67lvZXkuIvlpJrlpZfkuIDlsYIgXCJXdXRoZXJpbmcgV2F2ZXMgR2FtZS9cIu+8jFdlR2FtZSDmsqHmnInov5nkuIDlsYLvvInjgIJcbiAgICAgICAgLy8gYGxvZ1BhdGhgIOebruWJjeS7jeaYr+WNleS4quWtl+espuS4suWtl+aute+8jOijheS4jeS4i+S4pOS4quWAmemAie+8m1J1c3Qg5L6nXG4gICAgICAgIC8vIGBsb2NhdGVfbG9nX2NhbmRpZGF0ZXNgIOS8muWQjOaXtuWwneivlVwi55u05o6l5ZG95LitXCLkuI5cIuaBsOWlveS4gOWxguWtkOebruW9lVwi5Lik56eNXG4gICAgICAgIC8vIOWAmemAiei3r+W+hO+8jOWboOatpOi/memHjCoq5LiN6KaBKirmioogXCJXdXRoZXJpbmcgV2F2ZXMgR2FtZVwiIOWJjee8gOWGmei/m+adpeKAlOKAlFxuICAgICAgICAvLyDlhpnkuoblj43ogIzlj6rog73ljLnphY3lrpjmlrnlkK/liqjlmajov5nkuIDnp43vvIxSdXN0IOS+p+eahOWPjOWAmemAieacuuWItuWwseeUqOS4jeS4iuS6huOAglxuICAgICAgICBsb2dQYXRoOiBcIkNsaWVudC9TYXZlZC9Mb2dzL0NsaWVudC5sb2dcIixcbiAgICAgICAgdXJsUGF0dGVybjogV1VXQV9HQUNIQV9MSU5LX1BBVFRFUk4sXG4gICAgICAgIC8vIOWtl+iKgue6p+ino+a3t+a3huWPguaVsO+8mui3s+i/h+WJjSAzIOWtl+iKgu+8jOatpOWQjumAkOWtl+iKguaMiSoq6K+l5a2X6IqC6Ieq6Lqr55qE5YC8KipcbiAgICAgICAgLy8g77yI5LiN5piv5LiL5qCH77yJ55qE5aWH5YG25YiG5Yir5byC5oiWIDB4QTUvMHhFRuOAgua6kOeggeS+neaNrlxuICAgICAgICAvLyBgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYCDnrKwgMTE4fjEyMyDooYzvvJpcbiAgICAgICAgLy8gICBgYnl0ZSBiID0gZW5jcnlwdGVkW2ldOyBpZiAoKGIgJiAxKSA9PSAxKSBiIF49IDB4QTU7IGVsc2UgYiBePSAweEVGO2BcbiAgICAgICAgLy8g5Yik5o2u5pivIGLvvIjlrZfoioLlgLzvvInvvIzlvqrnjq/lj5jph48gaSDlj6rnlKjkuo7lj5blgLzlkozlhpnlm57vvIzkuI7kuIvmoIfml6DlhbPigJTigJTov5nmnaFcbiAgICAgICAgLy8g5bey57uP6KKr6K+B5Lyq6L+H5LiA5qyh5LqM5omL6L2s6L+w77yIYHJlc2VhcmNoLzAxYCDljp/orrDovb3puKPmva7ml6Xlv5fmmK/mmI7mlofvvIzljovmoLlcbiAgICAgICAgLy8g5rKh5o+P6L+w6L+H6Kej56CB77yJ77yM5Zug5q2k5Y+q6K6k6L+Z5q615rqQ56CB5Y6f5paH77yM5LiN6K6k5Lu75L2V6L2s6L+w44CCXG4gICAgICAgIGRlY29kZTogeyBraW5kOiBcInhvckJ5TG93Qml0XCIsIHNraXBCeXRlczogMywgbWFza1doZW5PZGQ6IDB4YTUsIG1hc2tXaGVuRXZlbjogMHhlZiB9LFxuICAgICAgfSxcblxuICAgICAgLy8gUE9TVCArIEpTT04gYm9keeOAguWtl+auteaYoOWwhOmAkOWtl+WPluiHqlxuICAgICAgLy8gYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jczoxNjMtMTk2YO+8iHF1ZXJ5IOWPguaVsOino+aekO+8ieS4jlxuICAgICAgLy8gYDoyMzktMjUzYO+8iOaehOmAoOivt+axguS9k++8ie+8mlxuICAgICAgLy8gICByZXNvdXJjZXNfaWQg4oaSIGNhcmRQb29sSWQgICAgbGFuZyAgICAgIOKGkiBsYW5ndWFnZUNvZGVcbiAgICAgIC8vICAgcGxheWVyX2lkICAgIOKGkiBwbGF5ZXJJZCAgICAgIHJlY29yZF9pZCDihpIgcmVjb3JkSWRcbiAgICAgIC8vICAgc3ZyX2lkICAgICAgIOKGkiBzZXJ2ZXJJZCAgICAgIO+8iOmaj+WNoeaxoOWPmOWMlu+8ieKGkiBjYXJkUG9vbFR5cGVcbiAgICAgIC8vXG4gICAgICAvLyDimqDvuI8gKirlvJXlj7fpmbfpmLHvvIzlha3kuKrlrZfmrrXph4zkuKTkuKrkuI3og73liqDlvJXlj7cqKu+8mmBjYXJkUG9vbElkYC9gbGFuZ3VhZ2VDb2RlYC9cbiAgICAgIC8vIGByZWNvcmRJZGAvYHNlcnZlcklkYCDlnKggQyMg6YeM5pivIGBzdHJpbmdg77yM5bqP5YiX5YyW5ZCO5pivIEpTT04g5a2X56ym5Liy77yMXG4gICAgICAvLyBib2R5IOaooeadv+mHjOWvueW6lOeahOWNoOS9jeespuimgeWKoOW8leWPt++8m+S9hiBgY2FyZFBvb2xUeXBlYCDnm7TmjqXotYvlgLxcbiAgICAgIC8vIGBnYWNoYVBvb2wuUG9vbFR5cGVg77yIYGludGDvvInvvIxgcGxheWVySWRgIOaYryBgbG9uZy5QYXJzZSguLi4pYCDnmoTnu5PmnpxcbiAgICAgIC8vIO+8iGBsb25nYO+8ieKAlOKAlOi/meS4pOS4quWcqCBDIyDkvqfpg73mmK/mlbDlgLznsbvlnovvvIxgSnNvbkNvbnZlcnQuU2VyaWFsaXplT2JqZWN0YFxuICAgICAgLy8g5Lya5oqK5a6D5Lus5bqP5YiX5YyW5oiQ5LiN5bim5byV5Y+355qEIEpTT04g5pWw5a2X44CC5Y2g5L2N56ym5pu/5o2i5piv57qv5a2X56ym5Liy5ou85o6lXG4gICAgICAvLyDvvIhgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYCDnmoRcbiAgICAgIC8vIGBzdWJzdGl0dXRlX3BsYWNlaG9sZGVyc2DvvInvvIzmqKHmnb/ph4znu5kgYHt7Z2FjaGFUeXBlfX1gL1xuICAgICAgLy8gYHt7Y3JlZGVudGlhbC5wbGF5ZXJfaWR9fWAg5aWX5LiK5byV5Y+35Lya5Lqn5Ye6IGBcImNhcmRQb29sVHlwZVwiOlwiMVwiYOKAlOKAlFxuICAgICAgLy8g5pyN5Yqh56uv5pS25Yiw55qE5piv5a2X56ym5LiyIFwiMVwiIOiAjOS4jeaYr+aVsOWtlyAx77yM5LiO55yf5a6e5a6i5oi356uv5Y+R6YCB55qE6K+35rGC5b2i5oCBXG4gICAgICAvLyDkuI3kuIDoh7TvvIzlm6DmraTkuIvpnaIgYm9keSDmqKHmnb/ph4zov5nkuKTlpIQqKuaVheaEj+S4jeWKoOW8leWPtyoq44CCXG4gICAgICByZXF1ZXN0OiB7XG4gICAgICAgIHVybDogXCJodHRwczovL2dtc2VydmVyLWFwaS5ha2ktZ2FtZTIuY29tL2dhY2hhL3JlY29yZC9xdWVyeVwiLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgICAgLy8g5Y+C6ICD5a6e546w5Zu65a6a6ZmE5bim55qEIFVzZXItQWdlbnTvvIhgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYFxuICAgICAgICAgIC8vIGBjbGllbnQuRGVmYXVsdFJlcXVlc3RIZWFkZXJzLkFkZChcIlVzZXItQWdlbnRcIiwgLi4uKWAg6LCD55So5aSE77yM5Y6f5qC35oqE5b2V77yJ44CCXG4gICAgICAgICAgXCJVc2VyLUFnZW50XCI6XG4gICAgICAgICAgICBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDYuMjsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzkyLjAuNDUxNS4xMDcgU2FmYXJpLzUzNy4zNlwiLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OlxuICAgICAgICAgICd7XCJjYXJkUG9vbElkXCI6XCJ7e2NyZWRlbnRpYWwucmVzb3VyY2VzX2lkfX1cIixcImNhcmRQb29sVHlwZVwiOnt7Z2FjaGFUeXBlfX0sJyArXG4gICAgICAgICAgJ1wibGFuZ3VhZ2VDb2RlXCI6XCJ7e2NyZWRlbnRpYWwubGFuZ319XCIsXCJwbGF5ZXJJZFwiOnt7Y3JlZGVudGlhbC5wbGF5ZXJfaWR9fSwnICtcbiAgICAgICAgICAnXCJyZWNvcmRJZFwiOlwie3tjcmVkZW50aWFsLnJlY29yZF9pZH19XCIsXCJzZXJ2ZXJJZFwiOlwie3tjcmVkZW50aWFsLnN2cl9pZH19XCJ9JyxcbiAgICAgIH0sXG5cbiAgICAgIC8vIOKaoO+4jyAqKuWPquaUvuWbveacjSBgLmNvbWDvvIzliLvmhI/kuI3pooTmlL7lm73pmYXmnI0gYC5uZXRgKirvvJrlj4LogIPlrp7njrDmjInlh63mja5cbiAgICAgIC8vIGBzdnJfYXJlYWAg5Zyo5Lik5LiqIGhvc3Qg5LmL6Ze05LqM6YCJ5LiA77yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2BcbiAgICAgIC8vIGBzZXJ2ZXJDTiA/IFwiLi4uLmNvbVwiIDogXCIuLi4ubmV0XCJg77yJ77yM5L2G5pys6aG555uu5pys5py65Y+q5pyJ5Zu95pyN5a2Y5qGj5qC35pys77yMXG4gICAgICAvLyDlm73pmYXmnI3liIbmlK/ml6Dms5Xpqozor4HjgIJgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYFxuICAgICAgLy8g6YeMIGBSZXF1ZXN0VGVtcGxhdGVKc29uYCDkuIrmlrnnmoRcIuW3suefpee8uuWPoyBDOFwi5rOo6YeK5bey57uP5oqK6L+Z5p2h6ZKJ5q2777yaXG4gICAgICAvLyBcImNvbGxlY3QucGFyYW1zLmFsbG93ZWRIb3N0cyDph4zlkIzmoLfkuI3pooTmlL4gLm5ldO+8mumihOaUvuetieS6juWjsOaYjuS4gOS4qui3keS4jeWIsFxuICAgICAgLy8g55qE6IO95YqbXCLjgILpooTmlL7kuIDkuKrmnKrnu4/pqozor4HjgIHlvZPliY3or7fmsYLmqKHmnb/kuZ/miZPkuI3liLDnmoQgaG9zdO+8jOWPquS8muWItumAoOS4gOenjVxuICAgICAgLy8gXCLnnIvotbfmnaXmlK/mjIHlm73pmYXmnI1cIueahOWBh+ixoeOAguetieecn+eahOacieWbvemZheacjeagt+acrOaXtu+8jOmcgOimgeWQjOaXtuihpVxuICAgICAgLy8g6K+35rGC56uv54K55YiG5pSv5py65Yi25LiO6L+Z6YeM55qE55m95ZCN5Y2V77yM5Lik6ICF57y65LiA5LiN5Y+v44CCXG4gICAgICBhbGxvd2VkSG9zdHM6IFtcImdtc2VydmVyLWFwaS5ha2ktZ2FtZTIuY29tXCJdLFxuXG4gICAgICBleHRyYWN0TGlzdDogZXh0cmFjdEdhY2hhUmVjb3JkTGlzdCxcblxuICAgICAgLy8g5o6l5Y+j5pys6Lqr5LiN5YiG6aG177yM5LiA5qyh6K+35rGC5Y2z5ou/5Yiw6K+l5Y2h5rGg5YWo6YOo6K6w5b2VXG4gICAgICAvLyDvvIhgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYCDph4zmr4/kuKrljaHmsaDlj6rlj5HkuIDmrKEgUE9TVO+8jOayoeaciVxuICAgICAgLy8g5Lu75L2V5YiG6aG15Y+C5pWw77yJ44CC55So57y655yB55qEIGBlbXB0eVBhZ2VgIOS8muWvueWQjOS4gOS7veWFqOmHj+WTjeW6lOatu+W+queOr+OAglxuICAgICAgLy9cbiAgICAgIC8vIOKaoO+4jyDov5nkuI3lj6rmmK9cIuaOpeWPo+W9ouaAgeWmguatpFwi6L+Z5LmI566A5Y2V4oCU4oCUYGhvb2tzLmRlcml2ZVJlY29yZEtleXNg77yI6KeBXG4gICAgICAvLyBgLi9ob29rcy50c2DvvInkvp3otZZcIuavj+asoemDveaYr+aVtOaxoOWFqOmHj+aLieWPllwi6L+Z5p2h5YmN5o+Q6K6h566X5om55qyh5YaF5bqP5L2N77yMXG4gICAgICAvLyDoi6Xml6XlkI7or6/mlLnmiJDlop7ph48v5YiG6aG16YeH6ZuG77yM5bqP5L2N5Lya5Zyo5bGA6YOo6ZuG5ZCI5LiK6K6h566X77yMXG4gICAgICAvLyBgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqcxLjgg5a6e5rWL55qEIDMyLjYwJVxuICAgICAgLy8g77yIMTA5OS8zMzcx77yMa2V5IOato+ehruaAp+S+nei1luW6j+S9jeeahOiusOW9le+8ieS8mueri+WIu+WHuueOsCBrZXkg5ryC56e744CCXG4gICAgICBzdG9wQ29uZGl0aW9uOiB7IGtpbmQ6IFwic2luZ2xlUmVxdWVzdFwiIH0sXG5cbiAgICAgIC8vIOWNoeaxoOW9kuWxnuS7peacrOasoeafpeivoueUqOeahCBiYW5uZXIg5Li65YeG77yM5LiN5L+h5ZON5bqU4oCU4oCU6bij5r2u5ZON5bqU6K6w5b2V6YeM55qEXG4gICAgICAvLyBgY2FyZFBvb2xUeXBlYCDmmK/kuI3lj6/ov5jljp/nmoTkuK3mloflsZXnpLrmoIfnrb7vvIjop4HkuIvmlrlcbiAgICAgIC8vIGBmaWVsZHMuZXh0cmFjdFJlY29yZGAg6YeMIGBiYW5uZXJJZGAg5a2X5q615peB55qE6K+m57uG6K+05piO77yJ77yM6ICM6bij5r2uXG4gICAgICAvLyDkuIDmrKHmn6Xor6Llj6rov5Tlm57kuIDkuKrmsaDnmoTlhajph4/orrDlvZXvvIzkuI3lrZjlnKjmt7fmsaDvvIzlm6DmraTmn6Xor6Lml7bnmoQgYmFubmVyXG4gICAgICAvLyDlsLHmmK/llK/kuIDmnYPlqIHmnaXmupDjgILkuI7ljp/npZ7nm7jlj43igJTigJTljp/npZ7kuIDmrKHmn6Xor6LkvJrmt7flm57lhbblroPljaHmsaDnmoTorrDlvZVcbiAgICAgIC8vIO+8iGBmaXh0dXJlcy9nZW5zaGluL3Jhd19yZXNwb25zZS8zMDFfcGFnZV8xLmpzb25gIOWunua1i++8ie+8jOW/hemhu+S/oVxuICAgICAgLy8g5ZON5bqU44CC5a6M5pW05a+554Wn6KeBIGBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L21hbmlmZXN0LnRzYCDph4xcbiAgICAgIC8vIGBDcmVkZW50aWFsZWRBcGlQaXBlbGluZVBhcmFtcy5iYW5uZXJJZGVudGl0eWAg55qE5paH5qGj44CCXG4gICAgICBiYW5uZXJJZGVudGl0eTogXCJxdWVyeVwiLFxuICAgIH0sXG4gIH0sXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIGZpZWxkc++8muWTjeW6lOiusOW9lSDihpIg57uf5LiA5a2X5q61XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBmaWVsZHM6IHtcbiAgICBleHRyYWN0UmVjb3JkOiAocmF3KSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCByYXcgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi6bij5r2uIGV4dHJhY3RSZWNvcmQg5pS25Yiw6Z2e5a+56LGh5b2i5oCB55qE5Y6f5aeL6K6w5b2VXCIpO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVjb3JkID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4gICAgICAvLyDlk43lupTorrDlvZXlrZfmrrXvvIhgTW9kZWxzL0dhY2hhQVBJLmNzYO+8ie+8mlxuICAgICAgLy8gICBjYXJkUG9vbFR5cGU6IHN0cmluZyAgIHJlc291cmNlSWQ6IGludCAgICAgIHF1YWxpdHlMZXZlbDogaW50XG4gICAgICAvLyAgIHJlc291cmNlVHlwZTogc3RyaW5nICAgbmFtZTogc3RyaW5nICAgICAgICAgY291bnQ6IGludFxuICAgICAgLy8gICB0aW1lOiBEYXRlVGltZVxuICAgICAgLy8g5rKh5pyJ5Lu75L2V5b2i5byP55qE6K6w5b2VIElE77yI5pegIGlkL3V1aWQvaW5kZXjvvInvvIzkuI7nnJ/lrp7lrZjmoaPlrp7mtYvnu5PorrrkuIDoh7RcbiAgICAgIC8vIO+8iGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCp+S4gO+8ieKAlOKAlOWboOatpCBzdGFibGVJZCDkuI3loavvvIxcbiAgICAgIC8vIGBob29rcy5kZXJpdmVSZWNvcmRLZXlzYCDlv4Xpobvlrp7njrDvvIjop4EgYC4vaG9va3MudHNg77yJ77yM5LiN6IO95L6d6LWW5a6/5Li7XG4gICAgICAvLyDlhZzlupXnlKggc3RhYmxlSWTjgIJcbiAgICAgIGNvbnN0IGl0ZW1JZCA9IG51bWVyaWNUb1N0cmluZyhyZWNvcmQucmVzb3VyY2VJZCk7XG4gICAgICBpZiAoIWl0ZW1JZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLpuKPmva4gZXh0cmFjdFJlY29yZO+8muiusOW9lee8uuWwkSByZXNvdXJjZUlk77yM5peg5rOV56Gu5a6aIGl0ZW1JZFwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbUlkLFxuICAgICAgICB0aW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC50aW1lKSA/PyBcIlwiLFxuICAgICAgICAvLyDimqDvuI8gKirmnKzlrZfmrrXkuI3nlLHlk43lupTlhrPlrpoqKuKAlOKAlGBmaXh0dXJlcy93dXdhL3Jhd19yZXNwb25zZS8xX3BhZ2VfMS5qc29uYFxuICAgICAgICAvLyDnnJ/lrp7moLfmnKzor4Hlrp7vvIxQb29sVHlwZT0xIOeahOWTjeW6lOiusOW9lemHjCBgY2FyZFBvb2xUeXBlYCDlj5blgLzmmK/kuK3mlodcbiAgICAgICAgLy8g5bGV56S65qCH562+IGBcIuinkuiJsueyvuWHhuiwg+iwkFwiYO+8jCoq5LiN5pivKiogYFwiMVwiYO+8m+WPquaciSBgMTBfcGFnZV8xLmpzb25gXG4gICAgICAgIC8vIO+8iFBvb2xUeXBlPTEw77yJ5oGw5aW96ZmN57qn5oiQ5LqG5pWw5a2X5a2X56ym5LiyIGBcIjEwXCJg44CC5Lmf5bCx5piv6K+0XG4gICAgICAgIC8vIGBjYXJkUG9vbFR5cGVgIOWkmuaVsOaDheWGteS4i+S4jeaYryBgV1VXQV9QT09MX1RZUEVTYCDooajnmoQgaWTvvIznm7TmjqXmi7/lroNcbiAgICAgICAgLy8g5b2TIGJhbm5lcklkIOS8muS6p+WHuuS4gOS4quS4jeWMuemFjeS7u+S9lSBgYmFubmVyc1tdLmlkYC9cbiAgICAgICAgLy8gYHBpdHlHcm91cHNbXS5tZW1iZXJzYCDnmoTlrZfnrKbkuLLvvIzkv53lupXnu5/orqHkvJrlr7nov5nkupvorrDlvZXpnZnpu5jlpLHmlYjjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g6L+Z5LiN5pivXCLlgLzlj5bplJnkuoZcIui/meS5iOeugOWNle+8mmBGaWVsZE1hcHBpbmcuZXh0cmFjdFJlY29yZGAg55qE562+5ZCN5pivXG4gICAgICAgIC8vIGAocmF3OiB1bmtub3duKSA9PiBVbmlmaWVkUmVjb3JkRmllbGRzYO+8jCoq5rKh5pyJ5Lu75L2V5Y+C5pWw6IO95ZGK6K+J5a6DXG4gICAgICAgIC8vIOi/meaJueiusOW9leaYr+afpeivouWTquS4qiBQb29sVHlwZSDlvpfliLDnmoQqKuKAlOKAlOi/meaYr+e7k+aehOaAp+mZkOWItu+8jOS4jeaYr+iDveWcqFxuICAgICAgICAvLyDov5nkuKrlh73mlbDlhoXpg6jkv67lpb3nmoTlrp7njrDnu4boioLvvIhQT1NUIGJvZHkg6YeM5Y+R55qEIGBjYXJkUG9vbFR5cGVgIOaYr1xuICAgICAgICAvLyDmiJHku6zoh6rlt7HmjIflrprnmoTmn6Xor6Llj4LmlbDvvIzlk43lupTph4zlkIzlkI3lrZfmrrXljbTmmK/mnI3liqHnq6/oh6rlt7HnmoTlsZXnpLrlgLzvvIxcbiAgICAgICAgLy8g5Lik6ICF5LiN5L+d6K+B5LiA6Ie077yM55yf5a6e5pWw5o2u5bey57uP6K+B5LyqXCLkuIDoh7RcIui/meS4quWBh+iuvu+8ieOAglxuICAgICAgICAvL1xuICAgICAgICAvLyDlm6DmraTov5nph4zkuI3lho3lsJ3or5Xku47lk43lupTop6PmnpDljaHmsaDlvZLlsZ7vvIzmlLnnlKjlrr/kuLvkvqfopobnm5bvvJpcbiAgICAgICAgLy8gYGNvbGxlY3QucGFyYW1zLmJhbm5lcklkZW50aXR5OiBcInF1ZXJ5XCJg77yI6KeB5LiK5pa55aOw5piO77yJ6K6p5a6/5Li7KirlnKhcbiAgICAgICAgLy8g5pys5Ye95pWw6L+U5Zue5LmL5ZCO44CB6LCD55SoIGBob29rcy5kZXJpdmVSZWNvcmRLZXlzYCDkuYvliY0qKu+8jOWwseaKiui/meS4quWtl+autVxuICAgICAgICAvLyDmjaLmiJDlj5HotbfmnKzmrKHmn6Xor6Lml7blrp7pmYXkvb/nlKjnmoQgYmFubmVyIGlk4oCU4oCU5a6M5pW05Yaz562W5L6d5o2u6KeBXG4gICAgICAgIC8vIGBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L21hbmlmZXN0LnRzYCDph4xcbiAgICAgICAgLy8gYENyZWRlbnRpYWxlZEFwaVBpcGVsaW5lUGFyYW1zLmJhbm5lcklkZW50aXR5YCDnmoTmlofmoaPvvIjljp/npZ7kvJrmt7fmsaBcbiAgICAgICAgLy8g5b+F6aG75L+h5ZON5bqU77yM6bij5r2u5LiN5re35rGg5b+F6aG75L+h5p+l6K+i77yM5Lik6ICF5a+554Wn77yJ44CCXG4gICAgICAgIC8vXG4gICAgICAgIC8vIOKaoO+4jyDopobnm5bml7bmnLrmmK/jgIzlnKggaG9va3Mg5LmL5YmN44CN6ICM5LiN5piv44CM6JC95bqT5pe244CN77yM6L+Z5LiA54K55a+5XG4gICAgICAgIC8vIGByZWNvcmRfa2V5YCDnmoTmraPnoa7mgKfmmK/lv4XopoHnmoTvvJpgaG9va3MuZGVyaXZlUmVjb3JkS2V5c2DvvIjop4FcbiAgICAgICAgLy8gYC4vaG9va3MudHNg77yJ5Lya6K+7IGBiYW5uZXJJZGAg5Y+C5LiO5ZOI5biM77yM6Iul5a6D55yL5Yiw55qE5piv5LiL6Z2i6L+Z5Liq5LiO5Y2h5rGgXG4gICAgICAgIC8vIOaXoOWFs+eahOWNoOS9jeWAvO+8jGtleSDlsLHlsJHkuobljaHmsaDov5nkuIDnu7TigJTigJTpuKPmva7ljYHov57mlbTnu4TlhbHnlKjlkIzkuIDkuKrml7bpl7TmiLPvvIxcbiAgICAgICAgLy8g6ICMIDPimIUg5q2m5Zmo5ZCM5pe25Ye6546w5Zyo6KeS6Imy5rGg5LiO5q2m5Zmo5rGg77yM5Lik5rGg5ZCM5LiA56eS5ZCE5Ye65LiA5qyh5ZCM5LiA5Lu2IDPimIUg5LiUXG4gICAgICAgIC8vIOe7hOWGheW6j+S9jeebuOWQjOaXtuS8mueul+WHuuebuOWQjOeahCBrZXnvvIzooqsgYFVOSVFVRShhY2NvdW50X2lkLCByZWNvcmRfa2V5KWBcbiAgICAgICAgLy8gKyBgSU5TRVJUIE9SIElHTk9SRWAg6Z2Z6buY5ZCe5o6J5LiA5p2h44CC5a6/5Li75L6n5a+55bqU5a6e546w5LiO6ZKJ5L2P6K+l5pe25py655qE5pat6KiAXG4gICAgICAgIC8vIOingSBgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYOOAglxuICAgICAgICAvL1xuICAgICAgICAvLyDpgqPkuLrku4DkuYjov5nph4zov5jopoHloavkuIDkuKrljaDkvY3lgLzogIzkuI3mmK/pmo/kvr/loasgYGNhcmRQb29sVHlwZWDvvJ/lm6DkuLpcbiAgICAgICAgLy8gYFVuaWZpZWRSZWNvcmRGaWVsZHMuYmFubmVySWRgIOaYr+W/heWhq+Wtl+aute+8jOaAu+W+l+i/lOWbnueCueS7gOS5iO+8m+iAjOi/meS4quWAvFxuICAgICAgICAvLyDllK/kuIDkvJrnnJ/mraPnlJ/mlYjnmoTlnLrmma/vvIzmmK8qKuacieS6uuivr+WIoOS6huS4iumdoueahCBgYmFubmVySWRlbnRpdHk6IFwicXVlcnlcImBcbiAgICAgICAgLy8g5aOw5piOKirigJTigJTpgqPml7bljaDkvY3lgLzkvJrorqnmr4/mnaHorrDlvZXpg73okL3liLDkuIDkuKrkuI3ljLnphY3ku7vkvZUgYGJhbm5lcnNbXS5pZGBcbiAgICAgICAgLy8g55qE5Y2h5rGg5LiK77yM6Zeu6aKY5b2T5Zy65pi+5b2i77yb6Iul5pS55aGrIGBjYXJkUG9vbFR5cGVg77yM6JC95bqT55qE5Lya5pivXCLop5LoibLnsr7lh4ZcbiAgICAgICAgLy8g6LCD6LCQXCLov5nnsbvnnIvnnYDmjLrlkIjnkIbjgIHlrp7pmYXlkIzmoLfljLnphY3kuI3kuIrnmoTlgLzvvIzlj43ogIzmm7Tpmr7lj5HnjrDjgIJcbiAgICAgICAgYmFubmVySWQ6IFwid3V3YS1iYW5uZXItaWRlbnRpdHktbm90LWRlcml2YWJsZS1mcm9tLXJlc3BvbnNlXCIsXG4gICAgICAgIGNvdW50OiB0b0NvdW50KHJlY29yZC5jb3VudCksXG4gICAgICAgIG5hbWU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLm5hbWUpLFxuICAgICAgICBpdGVtVHlwZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQucmVzb3VyY2VUeXBlKSxcbiAgICAgICAgcmFyaXR5OiBudW1lcmljVG9TdHJpbmcocmVjb3JkLnF1YWxpdHlMZXZlbCksXG4gICAgICAgIC8vIHN0YWJsZUlkIOeVmeepuu+8muingeS4iuaWueazqOmHiu+8jEFQSSDlk43lupTmsqHmnInku7vkvZXorrDlvZUgSUQg5a2X5q6144CCXG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG5cbiAgLy8g5Y2h5rGg6KGo77yaMTMg5LiqIFBvb2xUeXBlIOanveS9je+8jOayoeacieS7u+S9leS4gOadoeWjsOaYjiBlbmRwb2ludE92ZXJyaWRl4oCU4oCUMTMg5Liq5rGgXG4gIC8vIOWFseeUqOWQjOS4gOS4querr+eCue+8jOWMuuWIq+WujOWFqOWcqCBQT1NUIGJvZHkg55qEIGNhcmRQb29sVHlwZSDlrZfmrrXlgLzjgIJcbiAgYmFubmVyczogV1VXQV9QT09MX1RZUEVTLm1hcCgocG9vbCkgPT4gKHtcbiAgICBpZDogcG9vbC5pZCxcbiAgICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IHBvb2wubmFtZSB9LFxuICB9KSksXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIHBpdHlHcm91cHPvvJo14piFLzTimIUg5Y+M5qGj5L+d5bqVXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyDmr4/kuKogUG9vbFR5cGUg5aOw5piO5Lik5LiqIFBpdHlHcm91cO+8jG1lbWJlcnMg6YO95oyH5ZCR5ZCM5LiA5Liq5Y2h5rGgIGlk77yaXG4gIC8vICAgLSA14piFIOmCo+S7veS4jeWhqyBwaXR5VGFyZ2V077yM5Zue6JC9IHJhcml0eS5waXR5VGFyZ2V0ID0gXCI1XCLvvJtcbiAgLy8gICAtIDTimIUg6YKj5Lu95pi+5byPIHBpdHlUYXJnZXQ6IFwiNFwi77yMaGFyZFBpdHkg5Y+WIFdVV0FfNFNUQVJfSEFSRF9QSVRZ44CCXG4gIC8vXG4gIC8vIOKaoO+4jyAqKjXimIUg57uE5b+F6aG75o6S5Zyo5pWw57uE5YmN6Z2iKirvvJrlrr/kuLvokL3lupPml7YgYHBpdHlfZ3JvdXBfZm9yKClgXG4gIC8vIO+8iGBwaXBlbGluZS5yc2DvvInlj5ZcIuWjsOaYjumhuuW6j+esrOS4gOS4qlwi5L2c5Li65YaZ5YWlIGBHYWNoYVJlY29yZC5waXR5X2dyb3VwYFxuICAvLyDljZXlgLzliJfnmoTpgqPkuIDkuKrigJTigJTov5nkuKrpmpDlvI/or63kuYnlt7Lnn6XmnInpl67popjvvIhTNSDlvoXop6PlhrPvvInvvIzkvYblvZPliY3ooYzkuLrlpoLmraTvvIxcbiAgLy8g6aG65bqP5LiN6IO95Lmx44CC5LiL6Z2iIGBmbGF0TWFwYCDlr7nmr4/kuKogUG9vbFR5cGUg5YWI5Lqn5Ye6IDXimIUg5YiG57uE44CB5YaN5Lqn5Ye6IDTimIVcbiAgLy8g5YiG57uE77yM5L+d6K+B6L+Z5LiA54K544CCXG4gIC8vXG4gIC8vIOOAjOS/neW6leaYr+WQpue7p+aJv+OAje+8iOWPguiAg+WunueOsOmHjOiBlOWKqOaxoCAxMC8xMSDkvKAgaW5oZXJpdD1mYWxzZe+8jOWFtuS9mem7mOiupFxuICAvLyB0cnVl77yJ5rKh5pyJ5a2X5q615om/6L2977yM5LiU5Y2z5L2/5pyJ5a2X5q615Lmf5YGa5LiN5Yiw4oCU4oCU6KeB5LiL5pa55aSn5q61XCLlt7Lnn6XnvLrlj6NcIuivtOaYjuOAglxuICBwaXR5R3JvdXBzOiBXVVdBX1BPT0xfVFlQRVMuZmxhdE1hcCgocG9vbCkgPT4gW1xuICAgIHtcbiAgICAgIGtleTogYCR7cG9vbC5pZH0tNXN0YXJgLFxuICAgICAgbWVtYmVyczogW3Bvb2wuaWRdLFxuICAgICAgaGFyZFBpdHk6IHBvb2wuaGFyZFBpdHk1U3RhcixcbiAgICAgIGN1cnZlOiBmaXZlU3RhckN1cnZlKHBvb2wpLFxuICAgICAgLy8g5Y+W5YC85L6d5o2u6KeB5LiK5pa5IFdVV0FfUE9PTF9UWVBFUyDooajmoLzms6jph4rvvIjop5LoibIv5q2m5ZmoL+aWsOaJi+S4ieexu+eahFxuICAgICAgLy8gZml2ZVN0YXJHdWFyYW50ZWVLaW5kIOWIpOWumuS+neaNruS4jlwi5peg5a6e5rWL5L6d5o2uXCLmoIfms6jpg73lnKjpgqPph4zvvInjgIJcbiAgICAgIGd1YXJhbnRlZTogV1VXQV9GSVZFX1NUQVJfR1VBUkFOVEVFX0JZX0tJTkRbcG9vbC5maXZlU3Rhckd1YXJhbnRlZUtpbmRdLFxuICAgICAgLy8gcGl0eVRhcmdldCDkuI3loavvvJrlm57okL0gcmFyaXR5LnBpdHlUYXJnZXQgPSBcIjVcIuOAglxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBgJHtwb29sLmlkfS00c3RhcmAsXG4gICAgICBtZW1iZXJzOiBbcG9vbC5pZF0sXG4gICAgICBoYXJkUGl0eTogV1VXQV80U1RBUl9IQVJEX1BJVFksXG4gICAgICBwaXR5VGFyZ2V0OiBcIjRcIixcbiAgICAgIC8vIDTimIUg6L2v5L+d5bqVL+a4kOi/m+amgueOh+aVsOWAvOayoeacieS7u+S9leadpea6kOe7meWHuuWIhuahtuWRveS4reeOh++8iOecn+WunuWtmOaho+Wunua1i1xuICAgICAgLy8g5Y+q57uf6K6h5LqGIDTimIUg5Ye66LSn6Ze06ZqU55qE5pyA5bCPL+acgOWkpy/lnYflgLzvvIzop4FcbiAgICAgIC8vIGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCpzMuMu+8jOayoeacieWDjyA14piFIOmCo+agt+eahFxuICAgICAgLy8g6YCQ5oq95ZG95Lit546H5YiG5qG25pWw5o2u77yJ77yM55SoIGN1c3RvbSDljaDkvY3igJTigJTkuI3nvJbpgKDmsqHmnInliIbmobbmlbDmja7mlK/mkpHnmoRcbiAgICAgIC8vIOabsue6v+W9oueKtuOAglxuICAgICAgY3VydmU6IHsga2luZDogXCJjdXN0b21cIiBhcyBjb25zdCwgaWQ6IGB3dXdhLXVuY29uZmlybWVkLTRzdGFyLXBvb2wtJHtwb29sLmlkfWAgfSxcbiAgICAgIC8vIDTimIUg5piv5ZCm5pyJ57G75Ly8IDXimIUg55qEXCLop5LoibIv5q2m5Zmo5b+F5Lit5LiN5q2qXCLop4TliJnmnKrnu4/or4Hlrp7vvIzkuI3lpZfnlKggNeKYhSDnmoRcbiAgICAgIC8vIOinhOWIme+8jOWmguWunuagh+azqOS4uuacquefpeOAglxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwibm9uZVwiIGFzIGNvbnN0IH0sXG4gICAgfSxcbiAgXSksXG5cbiAgcmFyaXR5OiB7IGxhZGRlcjogW1wiM1wiLCBcIjRcIiwgXCI1XCJdLCBwaXR5VGFyZ2V0OiBcIjVcIiB9LFxuXG4gIHRpbWU6IHtcbiAgICAvLyDorrDlvZXml7bpl7TlsLHmmK/mnI3liqHlmajov5Tlm57nmoTmjILpkp/ml7bpl7TlrZfnrKbkuLLjgIHmnKrnu4/lrqLmiLfnq6/mnKzlnLDljJbigJTigJRcbiAgICAvLyBgTW9kZWxzL0dhY2hhRGF0YS5jc2Ag55qEIGBUaW1lYCDlrZfmrrXkuI4gZml4dHVyZSDmoLfmnKznmoTlvaLmgIHkuIDoh7TvvIzov5nkuIDngrlcbiAgICAvLyDkuI5cIuaYr+WQpuefpemBk+WFt+S9k+aXtuWMuuWBj+enu1wi5piv5Lik5Zue5LqL77yM5LiN5Y+X5LiL6Z2i6L+Z5p2h57y65Y+j5b2x5ZON77yM5LqI5Lul5L+d55WZ44CCXG4gICAgcmF3VGltZUNvbnZlbnRpb246IFwic2VydmVyTG9jYWxcIixcblxuICAgIC8vIHJhd0Zvcm1hdDogXCJpc29Mb2NhbFwiIOKAlOKAlCDlj5blgLzmnaXoh6ogYGZpeHR1cmVzL3d1d2EvcmF3X3Jlc3BvbnNlLyouanNvbmBcbiAgICAvLyDkuI4gYGZpeHR1cmVzL3d1d2EvYXJjaGl2ZS93d2dhY2hhX2FyY2hpdmUuanNvbmAg55qE5b2i54q277yIYFwiMjEwMC0wMS0wNlxuICAgIC8vIFQyMjo1MzowN1wiYCDov5nnsbsgYFlZWVktTU0tRERUSEg6TU06U1Ng77yJ77yM5Y2z5pys5Zyw5a2Y5qGj5a2X5q6177yIQyNcbiAgICAvLyBgRGF0ZVRpbWVg77yMTmV3dG9uc29mdCDpu5jorqTluo/liJfljJbkuqfnianvvInnmoTlvaLmgIHjgIJcbiAgICAvL1xuICAgIC8vIOKaoO+4jyAqKkFQSSDnnJ/lrp7nur/moLzlvI/ku43mnKrpqozor4EqKu+8jOi/meS4jeaYr+mBl+a8j++8jOaYr+WmguWunuagh+azqOeahOepuueZveKAlOKAlOWujOaVtFxuICAgIC8vIOafpeivgei/h+eoi+ingSBgZml4dHVyZXMvd3V3YS9tZXRhLnRvbWxgXCLlt7Lnn6XmnKrpqozor4HpobnvvJpBUEkg55qEIFRpbWVcbiAgICAvLyDnur/moLzlvI9cIuS4gOiKgu+8mmBNb2RlbHMvR2FjaGFEYXRhLmNzYCDph4wgYFRpbWVgIOaYryBgRGF0ZVRpbWVgIOW8uuexu+Wei++8jFxuICAgIC8vIEFQSSDlj5HmnaXnmoTljp/lp4vnur/moLzlvI/lnKjlj43luo/liJfljJbpgqPkuIDliLvlsLHooqvlkIPmjonkuobvvIzlj43mjqjkuI3lh7rmnaXvvJtcbiAgICAvLyBgZG9jcy9faW50ZXJuYWwvY2FwdHVyZS9gIOS4i+ayoeaciem4o+a9ruaKk+WMheagt+acrOOAguWjsOaYjiBgaXNvTG9jYWxgIOi1jOeahOaYr1xuICAgIC8vIFwi5pys5Zyw5a2Y5qGj55qE5qC85byP5aSn5qaC546H5LiOIEFQSSDkuIDoh7RcIu+8jOWmguaenOi/meS4quWBh+iuvumUmeS6hu+8jFJ1c3Qg5L6nXG4gICAgLy8gYHBhcnNlX3JlY29yZF90aW1lYCDnjrDlnKjmlLnmiJDkuobkuKXmoLzljLnphY3vvIjkuI3lho3kvp3mrKHlsJ3or5XlpJrnp43moLzlvI/vvInvvIzkvJrlnKhcbiAgICAvLyDpppbmrKHnnJ/lrp7ph4fpm4bml7bmmI7noa7miqXplJnvvIzogIzkuI3mmK/ooqvpnZnpu5jlhZzlupXlkLjmlLbmjonigJTigJTlj4Lop4EgZ3MtY29yZTo6XG4gICAgLy8gUmF3VGltZUZvcm1hdCDmlofmoaNcIuS4uuS7gOS5iOaUueaIkOS4peagvOWMuemFjVwi5LiA6IqC44CCXG4gICAgLy9cbiAgICAvLyDimqDvuI8gKirlt7Lnn6XopLbnmrEqKu+8mum4o+a9ruWQjOaXtuacieS4pOadoeaVsOaNruadpea6kOWFseeUqOi/meS4gOS7veWjsOaYjuKAlOKAlOmHh+mbhui1sCBBUElcbiAgICAvLyDvvIjmoLzlvI/mnKrpqozor4HvvInvvIzlr7zlhaXotbDmnKzlnLDlrZjmoaPvvIhJU0/vvIznoa7lrprvvInjgILoi6XlsIbmnaXor4Hlrp4gQVBJIOWPkeeahOaYr1xuICAgIC8vIOWIq+eahOagvOW8j++8jOi/meS4gOS4qiByYXdGb3JtYXQg5bCx5LiN5aSf55So5LqG77yM6ZyA6KaB5oyJ5pWw5o2u5p2l5rqQ5YiG5Yir5aOw5piO77yb546w5ZyoXG4gICAgLy8g5qC35pys5pWw5Li6IDHvvIzmjInkuInmrKHms5XliJnkuI3kuLrmraTorr7orqHmnLrliLbvvIzlj6rlnKjov5nph4zorrDkuIDnrJTjgIJcbiAgICByYXdGb3JtYXQ6IHsga2luZDogXCJpc29Mb2NhbFwiIH0sXG5cbiAgICAvLyDimqDvuI8gdGltZXpvbmVTb3VyY2Ug5Yi75oSP5LiN5aOw5piO77yI6ICM5LiN5piv5aGrIFwiY29tcHV0ZWRcIu+8ieOAguS4ieS4quWPr+mAieW9ouaAgemAkOS4gFxuICAgIC8vIOaOkumZpO+8jOS4jeaYr+a8j+Whq++8mlxuICAgIC8vICAgLSBhcGlGaWVsZO+8mmBNb2RlbHMvR2FjaGFBUEkuY3NgIOeahCBLUkFQSUl0ZW0g5Y+q5pyJIDcg5Liq5a2X5q6177yM5rKh5pyJ5Lu75L2VXG4gICAgLy8gICAgIOaXtuWMui/lgY/np7vph4/lrZfmrrXvvIzlk43lupTkvZPph4zmsqHmnInog73or7vnmoTlgLzjgIJcbiAgICAvLyAgIC0gc3RhdGljVGFibGXvvJpgZmllbGRgIOivreS5ieaYr1wi5ZON5bqU5L2T6YeM5ZOq5Liq5a2X5q615piv5p+l6KGo6ZSuXCLvvIjkuI4gYXBpRmllbGRcbiAgICAvLyAgICAg5a+556ew77yM6KeBIHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvdHlwZXMvZ2VuZXJhdGVkLnRzIOWvueW6lOWtl+auteazqOmHiu+8ie+8jFxuICAgIC8vICAgICDkvYbmn6XooajplK7lkIzmoLflv4XpobvmnaXoh6rlk43lupTkvZPigJTigJTlk43lupTkvZPmsqHmnIkgcmVnaW9uL3N2ciDnsbvlrZfmrrXvvIxcbiAgICAvLyAgICAg6L+Z5Liq5b2i5oCB5Zyo6bij5r2u6Lqr5LiK5peg5a2X5q615Y+v5p+l77yM5LiN5pivXCLooajkuI3lhahcIueahOmXrumimOOAglxuICAgIC8vICAgLSBjb21wdXRlZO+8muacrOacuuWPquacieWbveacje+8iHN2cl9hcmVhPWNu77yJ5qC35pys77yMYFRpbWV6b25lQ29udGV4dGAg6IO957uZXG4gICAgLy8gICAgIOWIsCBob29rIOeahOi0puWPt+S+p+S/oeWPt+WPquaciSB1aWQvcmVnaW9uIOS4pOS4quWtl+aute+8m2Bob29rcy5yZXNvbHZlVGltZXpvbmVgXG4gICAgLy8gICAgIOeahOetvuWQjeimgeaxguWvueS7u+aEj+i+k+WFpemDvei/lOWbnuS4gOS4quehruWumueahCBudW1iZXLvvIzlm73pmYXmnI3nmoTljLrmnI3liJLliIbkuI5cbiAgICAvLyAgICAg5pe25Yy65rKh5pyJ5Lu75L2V5Y+v6aqM6K+B5L6d5o2u77yM6KaB5LmI57yW5LiA5byg5p+l5peg5a6e5o2u55qE5pig5bCE6KGo77yM6KaB5LmI5a+55pyq55+lXG4gICAgLy8gICAgIHJlZ2lvbiDnm7TmjqXmipvplJnkuK3mlq3ph4fpm4bigJTigJTkuKTogIXpg73mr5RcIuWmguWunuWjsOaYjuS4jeefpemBk1wi5pu057Of44CCXG4gICAgLy9cbiAgICAvLyDnnIHnlaUgdGltZXpvbmVTb3VyY2Ug5ZCO6LWw55qE5piv5a6/5Li75bey57uP6K6+6K6h5aW955qE5YWc5bqV6Lev5b6E77yI5LiN5piv5pys5o+S5Lu25Y+m5byAXG4gICAgLy8g55qE5Y+j5a2Q77yJ77yaYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2Ag55qEXG4gICAgLy8gYHJlc29sdmVfcGFnZV9sZXZlbF90aW1lem9uZV9vZmZzZXRfaG91cnNgIOWvuSBgTm9uZWAg5bCx6L+U5ZueXG4gICAgLy8gYE9rKE5vbmUpYO+8jGBub3JtYWxpemVfdGltZWAg5Zyo5YGP56e76YeP5Li6IGBOb25lYCDml7bmiormjILpkp/ml7bpl7Tljp/moLflvZPmiJBcbiAgICAvLyBVVEMg5a2Y5YWlIGBvY2N1cnJlZF9hdGDjgIFgdHpfb3JpZ2luYCDmoIforrDkuLogYEFzc3VtZWRg4oCU4oCU5Y2zXCLmlbDlrZfnhafmioTvvIxcbiAgICAvLyDmmI7noa7moIfms6jkuI3kv53nnJ9cIu+8jOS4jeaYr+mdmem7mOS6p+WHuuS4gOS4quiHquS/oeS9huWPr+iDvemUmeivr+eahOaXtumXtOaIs+OAglxuICAgIC8vXG4gICAgLy8g5a+555So5oi355qE55yf5a6e5ZCO5p6c77yI5aaC5a6e5YaZ77yM5LiN57KJ6aWw77yJ77ya5LiN5Yy65YiG5Zu95pyNL+WbvemZheacje+8jCoq5omA5pyJKirpuKPmva5cbiAgICAvLyDotKblj7fnmoQgb2NjdXJyZWRfYXQg6YO95Lya5bim552A6L+Z5LiqXCLmnKrnn6XlgY/np7tcIuagh+iusOKAlOKAlOS4jeaYr+WbvemZheacjeavlOWbveacjeabtOW3ru+8jFxuICAgIC8vIOiAjOaYr+S4pOiAheS4gOagt+S4jeS/neecn+OAguWbveacjeeUqOaIt+eci+WIsOeahOaMgumSn+aVsOWtl+Wkp+amgueOh+WwseaYr+acrOWcsOaXtumXtO+8iOWboOS4ulxuICAgIC8vIFwiYXNzdW1lZCBVVENcIiDmgbDlpb3nuqbnrYnkuo5cIuS4jeWBmuaNoueul++8jOWOn+agt+aYvuekulwi77yJ77yM5L2G5Y+q6KaB54m15raJ6Leo5pe25Yy6XG4gICAgLy8g5o2i566X5oiW5LiO5YW25a6D5bey55+l5pe25Yy65p2l5rqQ55qE5ri45oiP5YGa5pe26Ze057q/5q+U5a+577yM6L+Z5Liq5a2X5q616YO95LiN5Y+v5L+h44CC562JXG4gICAgLy8g5ou/5YiwIHN2cl9pZC9zdnJfYXJlYSDihpIgVVRDIOWBj+enu+mHj+eahOecn+WunumqjOivgeS+neaNru+8iOWTquaAleWPquaYr+WbveacjeS4gOadoe+8ie+8jFxuICAgIC8vIOW6lOaUueWbniBgY29tcHV0ZWRgIOW5tuihpeS4iiBgaG9va3MucmVzb2x2ZVRpbWV6b25lYOOAglxuICB9LFxuXG4gIHByZWNvbmRpdGlvbnM6IFtcbiAgICB7XG4gICAgICBpZDogXCJ3dXdhLmNyZWRlbnRpYWwubG9nSGFzR2FjaGFMaW5rXCIsXG4gICAgICBjYXBhYmlsaXR5OiBcImNyZWRlbnRpYWxcIixcbiAgICAgIGxldmVsOiBcInJlcXVpcmVkXCIsXG4gICAgICBkZXNjcmliZToge1xuICAgICAgICBcInpoLUNOXCI6IFwi6Ieq5Yqo6I635Y+W5ZSk5Y+W6K6w5b2V6KaB5rGC5omT5byA6L+H5LiA5qyh5ri45oiP5YaF55qE5ZSk5Y+W6K+m5oOF6aG177yM5LiU6ZyA6KaB5Zyo6ZO+5o6l5pyJ5pWI5pyf5YaF56uL5Y2z5a+85Ye6XCIsXG4gICAgICB9LFxuICAgICAgLy8g5ZCM5Y6f56We5YWI5L6L77yaSG9zdEVudiDnm67liY3msqHmnIlcIuaXpeW/l+aWh+S7tuaYr+WQpuW3suWMheWQq+WMuemFjSBVUkxcIui/meS4quS/oeWPt++8jFxuICAgICAgLy8gY2hlY2sg5Y+q6IO96L+U5ZueIHVua25vd27jgIJcbiAgICAgIGNoZWNrOiAoKSA9PiAoeyBraW5kOiBcInVua25vd25cIiB9KSxcbiAgICAgIHJlbWVkeToge1xuICAgICAgICBcInpoLUNOXCI6IFwi6K+35Zyo5ri45oiP5YaF5omT5byA5ZSk5Y+W6K+m5oOF6aG15ZCO77yM56uL5Y2z5Zue5Yiw5pys5bqU55So6YeN6K+V77yI6ZO+5o6l5pyJ5pWI5pyf5pyq57uP5a6e5rWL56Gu6K6k77yM5oyJ5pyA55+t5oOF5Ya15aSE55CG77yJXCIsXG4gICAgICB9LFxuICAgIH0sXG4gIF0sXG5cbiAgLy8gYmFzZWxpbmUg5LiN5aOw5piO77ya6bij5r2u5o6l5Y+j5LiN5YiG6aG144CB5Lmf5rKh5pyJ5bey55+l55qE5p2D5aiB6IGa5ZCI57uf6K6h5o6l5Y+j77yMXG4gIC8vIGBpbkdhbWVQYWdlQ291bnRgL2BhdXRob3JpdGF0aXZlQXBpYCDkuKTkuKrlj5jkvZPlpZfnlKjpuKPmva7nmoTmg4XlhrXpg73kvJrlkI3kuI3lia/lrp7jgIJcblxuICAvLyByZXRlbnRpb24g5LiN5aOw5piO77ya5rKh5pyJ5Lu75L2V5p2l5rqQ57uZ5Ye66bij5r2u5a6Y5pa56K6w5b2V5L+d55WZ5pyf77yM5LiN6Leo5ri45oiP5oyq55SoXG4gIC8vIOexs+WTiOa4uOS4iea4uFwiNiDkuKrmnIhcIueahOivtOazleOAglxuXG4gIC8vIGl0ZW1JZFNvdXJjZSDkuI3lo7DmmI7vvIzpu5jorqQgXCJuYXRpdmVcIuKAlOKAlHJlc291cmNlSWQg5pivIEFQSSDljp/nlJ/lrZfmrrXvvIzkuI3mmK9cbiAgLy8g5pys5Zyw5YyW54mp5ZOB5ZCN77yM5LiO5pif6ZOBL+e7neWMuumbtuWQjOeQhuOAglxuXG4gIC8vIG1ldGFkYXRhIOS4jeWjsOaYju+8muWTjeW6lOiusOW9leiHquW4piBuYW1lL3Jlc291cmNlVHlwZS9xdWFsaXR5TGV2ZWzvvIzkuI3pnIDopoFcbiAgLy8g5Y+N5p+l5a2X5YW444CCXG5cbiAgLy8gZHJhd0NvdW50aW5nIOS4jeWjsOaYju+8jOm7mOiupCBwZXJSZWNvcmTvvIjop4HkuIrmlrkgdG9Db3VudCDlh73mlbDms6jph4rvvInjgIJcbn0gc2F0aXNmaWVzIFBsdWdpbk1hbmlmZXN0O1xuIiwiLyoqXG4gKiDnu53ljLrpm7bmj5Lku7bnmoTpgIPnlJ/oiLEgaG9va3PjgIJcbiAqXG4gKiDlj6rpnIDopoHkuIDkuKogaG9va++8mlxuICpcbiAqIC0gYGRlcml2ZVJlY29yZEtleWDvvJrkuI7ljp/npZ7lkIznkIbvvIznsbPlk4jmuLjkuInmuLjkuIDlvovkuI3lvpfnnIHnlaXmnKwgaG9va++8iOingVxuICogICBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag6YeMIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlgXG4gKiAgIOaWh+aho++8ieKAlOKAlOacjeWKoeerr+mbquiKsSBJRCDkuI3lkKvljaHmsaDnu7TluqbvvIzot6jnq6/ngrnlnLrmma/kuIvoo7jnlKggYHN0YWJsZUlkYCDmnIlcbiAqICAg5pKe6ZSu6aOO6Zmp77ybSG9Zby5HYWNoYSDkuLrmraTlnKjljp/npZ7ogZTliqjmsaDkuIrnur/kuIDlubTlkI7ku5jlh7rov4fkuIDmrKHmlbTooajph43lu7rov4Hnp7vvvIxcbiAqICAg5pys5o+S5Lu25LuO56ys5LiA5aSp5bCx5oqK5Y2h5rGg57u05bqm5bm26L+bIGtlee+8jOeQhueUseS4jiBgcGx1Z2lucy9nZW5zaGluL2hvb2tzLnRzYFxuICogICDlrozlhajkuIDoh7TjgIJcbiAqIC0gYHJlc29sdmVUaW1lem9uZWAg5LiN6ZyA6KaB77yaYG1hbmlmZXN0LnRzYCDnmoQgYHRpbWUudGltZXpvbmVTb3VyY2Uua2luZGBcbiAqICAg5pivIGBcInN0YXRpY1RhYmxlXCJg77yI5ZON5bqUIGByZWdpb25gIOWtl+auteafpeihqO+8ie+8jOS4jeaYryBgXCJjb21wdXRlZFwiYO+8jOaXtuWMulxuICogICDmjaLnrpfkuI3pnIDopoHmj5Lku7bku6PnoIHlj4LkuI7jgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Ib29rcyB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCBjb25zdCBob29rczogUGx1Z2luSG9va3MgPSB7XG4gIGRlcml2ZVJlY29yZEtleTogKHJlY29yZCkgPT4ge1xuICAgIGlmICghcmVjb3JkLnN0YWJsZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGDnu53ljLrpm7borrDlvZXnvLrlsJEgc3RhYmxlSWTvvIjmnI3liqHnq6/pm6roirEgSUTvvInvvIzml6Dms5XnlJ/miJDnqLPlrprnmoQgcmVjb3JkX2tlee+8mml0ZW1JZD1cIiR7cmVjb3JkLml0ZW1JZH1cImAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gYCR7cmVjb3JkLmJhbm5lcklkfToke3JlY29yZC5zdGFibGVJZH1gO1xuICB9LFxufTtcbiIsIi8qKlxuICog57ud5Yy66Zu25o+S5Lu2IG1hbmlmZXN044CCXG4gKlxuICog6YeH6ZuG6IyD5byP77yaY3JlZGVudGlhbGVkQXBp77yIYGdzLXAtYXV0aGtleWDvvInvvIzlh63mja7mnaXmupDkuI7ljp/npZ7lkIzmrL7igJTigJTnjqnlrrbmiZPlvIBcbiAqIOiur+WPt++8iOaKveWNoe+8ieiusOW9lemhteaXtu+8jOWuouaIt+erryB3ZWJ2aWV3IOS8muWRveS4reWumOaWuSBgZ2V0R2FjaGFMb2dgIOaOpeWPo+W5tuW4puS4ilxuICogYXV0aGtlee+8jOivt+axgiBVUkwg6KKr5YaZ5YWlIGB3ZWJDYWNoZXNgIOebruW9leS4iyBgQ2FjaGUvQ2FjaGVfRGF0YS9kYXRhXzJgIOe8k+WtmFxuICog57Si5byV5paH5Lu277yI5ZCMIGBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHNgIOmhtumDqOivtOaYju+8jOS4pOiAheaYr+WQjOS4gOWll+WHreaNruiOt+WPllxuICog5py65Yi277yM5Y+q5pivIGBnYW1lRGlyYCDniYfmrrXkuI3lkIzvvInjgIJcbiAqXG4gKiDmnKzmlofku7bmmK8gYGRyaWxscy96enovbWFuaWZlc3QudHNg77yITTEtUzcg57q46Z2i5aGr6KGo5ryU57uD6I2J56i/77yJ55qE5Y+v6L+Q6KGM54mI5pys77yMXG4gKiDovazljJbml7bmjInku6XkuIvotYTmlpnph43mlrDmoKHlh4bvvIzojYnnqL/ph4zmoIfms6jkuLrjgIzmnKropobnm5YgLyDpnIDlrp7mtYvjgI3nmoTlh6DlpITlt7LnlKjnnJ/lrp5cbiAqIOa6kOeggeihpem9kO+8iOivpuingeWQhOWtl+auteaXgeazqOmHiu+8ie+8jOS4jeWGjeaYr+aOqOaWre+8mlxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDktNTBgXG4gKiAgIO+8iGBhbGxvd2VkSG9zdHNgIOS4pOS4quWfn+WQjSArIOm7mOiupOerr+eCueWujOaVtOi3r+W+hCBgL2NvbW1vbi9nYWNoYV9yZWNvcmQvYXBpL2dldEdhY2hhTG9nYO+8iVxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9saWIucnM6MTQ1LTE0OSwyMDAtMjA0YFxuICogICDvvIhgdGltZXpvbmVTb3VyY2UudGFibGVgIOS6lOadoeWMuuacjeeggeWIsCBVVEMg5YGP56e76YeP55qE5a6M5pW05pig5bCE77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjYwLTE2MGBcbiAqICAg77yIYEdhY2hhTG9nYCDnu5PmnoTkvZPvvJpgZ2FjaGFfdHlwZWAvYGl0ZW1faWRgL2BpdGVtX3R5cGVgL2ByYW5rX3R5cGVgL2BnYWNoYV9pZGBcbiAqICAg5Zub5qy+57Gz5ZOI5ri45ri45oiP5YWx55So5ZCM5LiA5aWX5a2X5q615a6a5LmJ77yM57ud5Yy66Zu25rKh5pyJ5Lu75L2V5a2X5q615ZCN54m55L6L77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjMtMzksMTk5LTI0OSw0NzctNDc4YFxuICogICDvvIhgcmVhbF9nYWNoYV90eXBlYCDliIbpobXlj4LmlbDlkI3jgIHpmZDpgJ/kuI7ph43or5XnmoTnnJ/lrp7lrp7njrDjgIHlk43lupTorrDlvZUgOSDplK7nu5PmnoTjgIFcbiAqICAg5Y2h5rGg57G75Yir56CB6KGo77yJXG4gKiAtIOecn+WunuaKveWNoeWtmOaho+Wunua1i++8iOacrOWcsOiEseaVj+agt+acrO+8jOingSBgZml4dHVyZXMvenp6L21ldGEudG9tbGDvvInvvJpcbiAqICAgYGdhY2hhX2lkYCDmgZLkuLogYCcwJ2DjgIFgY291bnRgIOaBkuS4uiBgJzEnYOOAgWBpZGAg5oGS5Li6IDE5IOS9jeaVsOWtl+Wtl+espuS4suOAgVxuICogICBgaXRlbV90eXBlYC9gcmFua190eXBlYCDnu4TlkIjkuI3mmK/nrJvljaHlsJTnp6/vvIjpn7Pmk47ni6zmnIkgQiDnuqfvvIlcbiAqIC0g5a6Y5pa55L+d5bqV5qaC546H5YWs56S6IEpTT07vvIhgb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vbmFwLy4uLmDvvInvvIxcbiAqICAg6KeB5LiL5pa5IGBwaXR5R3JvdXBzYCDml4Hms6jph4pcbiAqXG4gKiBleGNoYW5nZUZvcm1hdHMg5LiN5aOw5piO77ya57ud5Yy66Zu255qEIFVJR0Yg5a2X5q615pig5bCE5pyq57uP55yf5a6e5a6e546w5qCh5YeG77yM5pysIFN0YWdlXG4gKiDkuI3lnKjmsqHmnInmoKHlh4bnmoTmg4XlhrXkuIvnvJbpgKDlr7zlh7rmoLzlvI/mlK/mjIHvvIjkuI4gYGRyaWxscy96enovbWFuaWZlc3QudHNgIOeahOWIpOaWrVxuICog5LiA6Ie077yM5Y6f56We5bey5a6e546w55qEIGB1aWdmLXY0YCDkuI3ku6Pooajnu53ljLrpm7blj6/ku6Xnm7TmjqXnhafmioTlkIzkuIDku73lo7DmmI7vvInjgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqXG4gKiDku44gYGdldEdhY2hhTG9nYCDlk43lupTkvZPph4zlj5blh7rmnKzpobXorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDnnJ/lrp7lk43lupTlvaLmgIEgYHsgcmV0Y29kZSwgbWVzc2FnZSwgZGF0YTogeyBsaXN0OiBbLi4uXSwgcmVnaW9uIH0gfWAg5LiO5Y6f56WeXG4gKiDlrozlhajlkIzmnoTvvIzlt7LnlKggYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIwMy0yMDRgXG4gKiDvvIhgcmVzPy5kYXRhPy5saXN0YCDliKTnqbrjgIFgcmVzLnJlZ2lvbmAg5Y+W5YC877yJ5qC45a6e77yM5LiN5piv57G75q+U5o6o5pat44CC6Ziy5b6h5byPXG4gKiDop6PmnpDvvJrku7vkvZXkuIDlsYLlvaLnirbkuI3lr7nlsLHov5Tlm57nqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjvvIzkuqTnu5nliIbpobXlvJXmk47mjInnqbrpobXlpITnkIbjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhTG9nTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBkYXRhID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xufVxuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKiDlrpjmlrnlk43lupTph4znmoQgYGNvdW50YCDmmK/mlbDlrZflrZfnrKbkuLLvvIjnnJ/lrp7lrZjmoaPlrp7mtYvmgZLkuLogYFwiMVwiYO+8ie+8jOmYsuW+oeW8j+i9rOaNou+8jOW8guW4uOi+k+WFpeWFnOW6leS4uiAx44CCICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA14piF77yIUyDnuqfvvInkv53lupXmm7Lnur9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIGJhc2UgLyBoYXJkUGl0eSAvIGd1YXJhbnRlZSDkuInpobnlj5boh6rlrpjmlrnkv53lupXmpoLnjoflhaznpLogSlNPTu+8iOS4gOaJi+aVsOaNru+8jFxuLy8gYGh0dHBzOi8vb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vbmFwL3Byb2RfZ2ZfY24vPGlkPi96aC1jbi5qc29uYO+8ie+8m1xuLy8gc3RhcnQgLyBzdGVwIOWumOaWueS7juacquWFrOekuu+8jOaMieWQjOS6uuekvuWMuuWPo+W+hOaOqOeul+KAlOKAlOS4jlxuLy8gYHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50czoxNjEtMTY0YCDlkIzkuIDlpITnkIbmlrnlvI/vvIg5MCDnoazkv53lupXmsr/nlKjljp/npZ5cbi8vIOOAjDc0IOaKvei1t+avj+aKvSArNiXjgI3nmoTlj6PlvoTvvJs4MCDnoazkv53lupXmjInmr5TkvovmjaLnrpfvvIzlj5YgYHN0YXJ0OiA2NSwgc3RlcDogMC4wN2DvvIxcbi8vICoq6L+Z5Lik5Liq5pWw5a2X5pys6Lqr5rKh5pyJ5a6Y5pa55p2l5rqQ77yM57qv57K55piv5oyJIDkw4oaSNzQvMC4wNiDnmoTmr5TkvovlpJbmjqgqKu+8ieOAglxuLy8g4pqg77iPIOS4jeimgeaKiiBzdGFydC9zdGVwIOivr+W9k+WumOaWueaVsOWAvOS9v+eUqOOAglxuY29uc3QgRVhDTFVTSVZFX0NVUlZFID0geyBraW5kOiBcInNvZnRQaXR5XCIsIGJhc2U6IDAuMDA2LCBzdGFydDogNzQsIHN0ZXA6IDAuMDYgfSBhcyBjb25zdDtcbmNvbnN0IFdfRU5HSU5FX0NVUlZFID0geyBraW5kOiBcInNvZnRQaXR5XCIsIGJhc2U6IDAuMDEsIHN0YXJ0OiA2NSwgc3RlcDogMC4wNyB9IGFzIGNvbnN0O1xuXG5leHBvcnQgY29uc3QgbWFuaWZlc3QgPSB7XG4gIGlkOiBcInp6elwiLFxuICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi57ud5Yy66Zu2XCIgfSxcbiAgc2RrVmVyc2lvbjogXCIxLjAuMFwiLFxuICBwbGF0Zm9ybXM6IFtcIndpbmRvd3NcIl0sXG4gIG1haW50YWluZXJzOiBbXCJnYWNoYS1zdHVkaW9cIl0sXG5cbiAgLy8gZXhjaGFuZ2VGb3JtYXRzIOS4jeWjsOaYju+8jOingeaWh+S7tuWktOazqOmHiuOAglxuXG4gIC8vIOWbvuagh+WcsOWdgOadpeiHqiBUYXBUYXAg5bqU55So5biC5Zy66aG16Z2i77yM5bey5a6e5rWL6aqM6K+B77yM5ZCMIGBwbHVnaW5zL2dlbnNoaW4vXG4gIC8vIG1hbmlmZXN0LnRzYCDlkIzmrL7mlZnorq3igJTigJTlnLDlnYDku6UgLmpwZyDnu5PlsL7kvYblrp7pmYXlhoXlrrnmmK8gUE5H77yM5LiN6KaBXCLnuqDmraNcIlxuICAvLyDmianlsZXlkI3vvIzmoLzlvI/moKHpqozvvIhjb250ZW50LXR5cGUgKyBtYWdpYyBieXRlc++8ieaYr+Wuv+S4u+S+p+iBjOi0o+OAglxuICBpY29uVXJsOlxuICAgIFwiaHR0cHM6Ly9pbWctdGMudGFwaW1nLmNvbS9tYXJrZXQvaW1hZ2VzL2NjYTRiMTdkNmRkOTAzMDAzNzA5NWMxOWFhOWZlNzhhLnBuZy9fdGFwX2FwcGljb25fbS5qcGdcIixcblxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwiY2hyb21pdW1DYWNoZVwiLFxuICAgICAgICAvLyDimqDvuI8g55u45a+554mH5q6177yM5LiN5piv57ud5a+56Lev5b6E44CC5p2l5rqQIHJlc2VhcmNoLzAx44CM5pWw5o2u6YeH6ZuG5Y6f55CG5YiG5bGC44CNXG4gICAgICAgIC8vIOiMg+W8jyBBIOmAmueUqOe7k+iuuu+8mnvlronoo4Xnm67lvZV9L1plbmxlc3Nab25lWmVyb19EYXRhL3dlYkNhY2hlcy9754mI5pysfS9cbiAgICAgICAgLy8gQ2FjaGUvQ2FjaGVfRGF0YS9kYXRhXzLjgIJcbiAgICAgICAgZ2FtZURpcjogXCJaZW5sZXNzWm9uZVplcm9fRGF0YS93ZWJDYWNoZXNcIixcbiAgICAgICAgLy8g56uv54K55pyA5ZCO5LiA5q615pivIFwiZ2V0R2FjaGFMb2dcIu+8iOS4juWOn+elni/mmJ/pk4HlkIzlkI3vvInvvIzlt7LnlKhcbiAgICAgICAgLy8gSG9Zby5HYWNoYSBgY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDktNTBgIOeahOWujOaVtOi3r+W+hFxuICAgICAgICAvLyBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1uYXAoLXNnKS4uLi9jb21tb24vZ2FjaGFfcmVjb3JkL2FwaS9nZXRHYWNoYUxvZ1wiXG4gICAgICAgIC8vIOaguOWunuKAlOKAlGRyaWxscyDojYnnqL/ph4xcIuerr+eCueWtl+mdouWQjeacquimhueblu+8jOmcgOWunua1i1wi6L+Z5p2hIFRPRE8g5bey6Kej5Yaz44CCXG4gICAgICAgIHVybFBhdHRlcm46IC9odHRwczpcXC9cXC8uKz9nZXRHYWNoYUxvZ1teXCJdKy8sXG4gICAgICB9LFxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICAvLyDimIUg5beu5byC54K577ya5YiG6aG15Y+C5pWw5ZCN5pivIHJlYWxfZ2FjaGFfdHlwZe+8jOS4jeaYryBnYWNoYV90eXBl4oCU4oCU55u05o6l5YaZXG4gICAgICAgIC8vIOi/m+i/meS4gOihjOWtl+espuS4suaooeadv++8jOS4jemcgOimgeS7u+S9lemineWkluWjsOaYjuWtl+auteOAgui/meaYr+WvuVxuICAgICAgICAvLyBgQ3JlZGVudGlhbGVkQXBpUGlwZWxpbmVQYXJhbXMucGFnZVNpemVgIOaWh+aho+mHjOmCo+adoVwi57ud5Yy66Zu255qEXG4gICAgICAgIC8vIHJlYWxfZ2FjaGFfdHlwZSDlt67lvILnhafmoLflj6rmlLnoh6rlt7HpgqPkuIDooYzmqKHmnb9cIue7k+iuuueahOWunumZheiQveWcsO+8jOadpea6kFxuICAgICAgICAvLyBgenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjAyYO+8mlxuICAgICAgICAvLyAgIGAke3VybH0mcmVhbF9nYWNoYV90eXBlPSR7a2V5fSZwYWdlPSR7cGFnZX0mc2l6ZT0kezIwfS4uLmBcbiAgICAgICAgLy9cbiAgICAgICAgLy8gZW5kX2lkPTDvvJrkuI7ljp/npZ4v5pif6ZOB55qE5YaZ5rOV5LiA6Ie077yM5L2c5Li65q+P6aG15Zu65a6a6L+95Yqg55qE5bi46YeP5Y+C5pWw44CCXG4gICAgICAgIC8vIOKaoO+4jyDnnJ/lrp7lj4LogIPlrp7njrDph4wgZW5kX2lkIOWFtuWunuaYr+S8muWPmOWMlueahOa4uOagh++8iOWQjOaWh+S7tuWQjOS4gOihjOeahFxuICAgICAgICAvLyBgJHtlbmRJZCA/ICcmZW5kX2lkPScgKyBlbmRJZCA6ICcnfWDvvIzlj5bkuIrkuIDpobXmnIDlkI7kuIDmnaHorrDlvZXnmoRcbiAgICAgICAgLy8gaWTvvInvvIzkvYbmnKzpobnnm67nmoQgTDEg5YiG6aG15byV5pOO5oyJ6aG156CB6YCS5aKe57+76aG144CB5LiN6L+96Liq5ri45qCH77yI5pyq5aOw5piOXG4gICAgICAgIC8vIGBleHRyYWN0Q3Vyc29yYCDml7bnmoTnvLrnnIHooYzkuLrvvInvvIzlm7rlrprkvKAgMCDmmK/msr/nlKjlkIzml4/nuqblrprvvIzmnKrpkojlr7lcbiAgICAgICAgLy8g57ud5Yy66Zu254us56uL6aqM6K+BXCLmnI3liqHnq6/lnKggZW5kX2lkIOaBkuS4uiAwIOaXtuaYr+WQpuS7jeiDveato+ehrue/u+mhtVwi4oCU4oCU5LiOXG4gICAgICAgIC8vIGBkcmlsbHMvenp6L21hbmlmZXN0LnRzYCDlr7nov5nkuKrlj4LmlbDnmoTmgIHluqbkuIDoh7TvvIjmnKrni6znq4vlrp7mtYvvvInjgIJcbiAgICAgICAgdXJsOiBcInt7Y3JlZGVudGlhbH19JnBhZ2U9e3twYWdlfX0mcmVhbF9nYWNoYV90eXBlPXt7Z2FjaGFUeXBlfX0mc2l6ZT17e3BhZ2VTaXplfX0mZW5kX2lkPTBcIixcbiAgICAgIH0sXG4gICAgICAvLyDkuKTkuKogaG9zdCDpg73lv4XpobvloavvvJp1cmxQYXR0ZXJuIOacrOi6q+S4jeWMuuWIhuWfn+WQje+8jOWPquimgSBVUkwg6YeM5Ye6546wXG4gICAgICAvLyBcImdldEdhY2hhTG9nXCIg5bCx5Lya5Yy56YWN77yM5Zu95pyNL+WbvemZheacjeWuouaIt+err+e8k+WtmOmDveWPr+iDveWRveS4reKAlOKAlOWPquWhq+WbveacjVxuICAgICAgLy8g5Lya5oqK5Zu96ZmF5pyN546p5a6255qE5q2j5bi46K+35rGC6K+v5Yik5Li65oqV5q+S77yI5ZCM5Y6f56WeIG1hbmlmZXN0IDc5LTg4IOihjOeahOaVmeiure+8ieOAglxuICAgICAgLy8g5Lik5Liq5Z+f5ZCN5LiO6buY6K6k56uv54K56Lev5b6E5bey55SoIEhvWW8uR2FjaGEg5rqQ56CB5qC45a6e77yI6Z2e5pys5o+S5Lu254us56uL5a6e5rWL77yMXG4gICAgICAvLyDku4XkvZzkuovlrp7lvJXnlKjvvInvvJpcbiAgICAgIC8vICAgY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDlcbiAgICAgIC8vICAgICAoKE5hcCwgT2ZmaWNpYWwpLCBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24tbmFwLm1paG95by5jb20vY29tbW9uL2dhY2hhX3JlY29yZC9hcGkvZ2V0R2FjaGFMb2dcIlxuICAgICAgLy8gICBjcmF0ZXMvZ2FtZV9iaXovc3JjL2FwaS5yczo1MFxuICAgICAgLy8gICAgICgoTmFwLCBPdmVyc2VhKSwgIFN0YW5kYXJkKSAtPiBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1uYXAtc2cuaG95b3ZlcnNlLmNvbS9jb21tb24vZ2FjaGFfcmVjb3JkL2FwaS9nZXRHYWNoYUxvZ1wiXG4gICAgICAvLyDkuI4gYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjE1YO+8iOWbveacjeWfn+WQje+8ieOAgVxuICAgICAgLy8gYDozMjItMzI0YO+8iOWbvemZheacjeWfn+WQjeWIh+aNouWIhuaUr++8ieS6kuebuOWNsOivgeOAglxuICAgICAgYWxsb3dlZEhvc3RzOiBbXCJwdWJsaWMtb3BlcmF0aW9uLW5hcC5taWhveW8uY29tXCIsIFwicHVibGljLW9wZXJhdGlvbi1uYXAtc2cuaG95b3ZlcnNlLmNvbVwiXSxcbiAgICAgIGV4dHJhY3RMaXN0OiBleHRyYWN0R2FjaGFMb2dMaXN0LFxuXG4gICAgICAvLyDpmZDpgJ/nrZbnlaXvvJrlrr/kuLvmjInlrZfmrrXpgJDkuIDlj5ZcIuabtOa4qeWSjOiAhVwi5LiO57y655yB5YC85ZCI5bm277yM5LiN5piv5pW05L2T6KaG55uWXG4gICAgICAvLyDvvIjop4EgYENyZWRlbnRpYWxlZEFwaVBpcGVsaW5lUGFyYW1zLnJhdGVMaW1pdGAg5paH5qGj77yJ44CC5pWw5YC855u05o6l5Y+W6IeqXG4gICAgICAvLyDlj4LogIPlrp7njrAgYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzYO+8mlxuICAgICAgLy8gICA6MjM077yIYGF3YWl0IHNsZWVwKDAuMylg77yM5q+P6aG16K+35rGC5ZCO5Zu65a6a562J5b6F77yJXG4gICAgICAvLyAgIDoyMjctMjMw77yIYGlmIChwYWdlICUgMTAgPT09IDApIHsgLi4uOyBhd2FpdCBzbGVlcCgxKSB9YO+8jOavjyAxMCDpobVcbiAgICAgIC8vICAgICDpop3lpJblpJrnrYkgMSDnp5LvvIlcbiAgICAgIC8vICAgOjE5OS0yMTLvvIhgZ2V0R2FjaGFMb2dgIOmAkuW9kumHjeivle+8jOWIneWniyBgcmV0cnlDb3VudDogNWDvvIzph43or5Xpl7TpmpRcbiAgICAgIC8vICAgICBgYXdhaXQgc2xlZXAoNSlg77yJXG4gICAgICAvLyBwZXJQYWdlRGVsYXlNcy9yZXRyeS5tYXhBdHRlbXB0cyDmgbDlpb3kuI7lrr/kuLvnvLrnnIHlgLznm7jlkIzvvIzov5nph4zku43nhLbmmL7lvI9cbiAgICAgIC8vIOWjsOaYjuKAlOKAlOeQhueUseaYr1wi6L+Z5Liq5pWw5a2X5pyJ5Ye65aSEXCLmnKzouqvlsLHmmK/mlofmoaPvvIzkuI3mmK/kuLrkuobmlLnlj5jnvLrnnIHooYzkuLrjgIJcbiAgICAgIHJhdGVMaW1pdDoge1xuICAgICAgICBwZXJQYWdlRGVsYXlNczogMzAwLFxuICAgICAgICBiYXRjaFNpemU6IDEwLFxuICAgICAgICBiYXRjaERlbGF5TXM6IDEwMDAsXG4gICAgICAgIHJldHJ5OiB7IG1heEF0dGVtcHRzOiA1LCBkZWxheU1zOiA1MDAwIH0sXG4gICAgICB9LFxuXG4gICAgICAvLyBiYW5uZXJJZGVudGl0eSDkuI3lo7DmmI7vvIznvLrnnIEgXCJyZXNwb25zZVwi4oCU4oCU57Gz5ZOI5ri45LiJ5ri46YO95Y+v6IO95re35rGg77yI5Y6f56WeXG4gICAgICAvLyDlt7Llrp7mtYsgMzAxIOWTjeW6lOmHjOa3t+WbniA0MDAg55qE6K6w5b2V77yM6KeBIGBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHNgXG4gICAgICAvLyBiYW5uZXJzIOazqOmHiu+8ie+8jOe7neWMuumbtuiZveeEtuacrOaPkuS7tuWwmuacquaLv+WIsFwi5ZON5bqU5re35rGgXCLnmoTnm7TmjqXor4Hmja7vvIzkvYZcbiAgICAgIC8vIOS5n+ayoeacieivgeaNruaOkumZpO+8jOaMieWQjOaXj+S/neWuiOWBh+iuvue7p+e7reS/oeWTjeW6lO+8jOS4jei0uOeEtuWjsOaYjiBcInF1ZXJ5XCLigJTigJRcbiAgICAgIC8vIGBiYW5uZXJJZGVudGl0eWAg5paH5qGj5piO56Gu6K2m5ZGK6L+H77yaXCLoi6Xmn5DmuLjmiI/lhbblrp7kvJrmt7fmsaDljbTlo7DmmI7kuoZcbiAgICAgIC8vIHF1ZXJ577yM6KKr5re36L+b5p2l55qE6K6w5b2V5Lya6KKr6Z2Z6buY6ZSZ6K+v5b2S5rGgXCLvvIzku6Pku7fkuI3lr7nnp7DvvIzlm6DmraTkuI3lhpnov5lcbiAgICAgIC8vIOS4gOihjO+8iOe8uuecgeWNs+ato+ehrumAieaLqe+8ie+8jOS7heWcqOatpOazqOmHiumHjOivtOaYjuS4uuS7gOS5iOS4jeWGmeOAglxuICAgIH0sXG4gIH0sXG5cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIue7neWMuumbtiBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgLy8g5ZON5bqU6K6w5b2VIDExIOmUru+8iOecn+WunuWtmOaho+Wunua1iyArIGB6enotc2lnbmFsLXNlYXJjaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczo0NzctNDc4YFxuICAgICAgLy8g5Y+M5p2l5rqQ56Gu6K6k5LiA6Ie077yJ77yaaWQgLyB1aWQgLyBnYWNoYV90eXBlIC8gZ2FjaGFfaWQgLyBpdGVtX2lkIC8gY291bnQgL1xuICAgICAgLy8gdGltZSAvIG5hbWUgLyBpdGVtX3R5cGUgLyByYW5rX3R5cGUgLyBsYW5n44CC5LiO5Y6f56We5LiN5ZCM77yM57ud5Yy66Zu2IEFQSVxuICAgICAgLy8g55u05o6l6L+U5ZueIGl0ZW1faWTvvIhIb1lvLkdhY2hhIGBjcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjE0NC0xNDlg77yaXG4gICAgICAvLyBcIkV4Y2VwdCBmb3IgJ0dlbnNoaW4gSW1wYWN0J1wi77yM5Y2z57ud5Yy66Zu244CB5pif6ZOB5Z2H5pyJ5q2k5a2X5q6177yJ77yM5Zug5q2kIGl0ZW1JZFxuICAgICAgLy8g5Y+WIGl0ZW1faWTvvIzkuI3otbDljp/npZ7pgqPmnaFcIuacrOWcsOWMlueJqeWTgeWQjeWFnOW6lVwi55qE54m55L6L6Lev5b6E77yM5Lmf5LiN6ZyA6KaB5aOw5piOXG4gICAgICAvLyBgaXRlbUlkU291cmNlYO+8iOe8uuecgSBcIm5hdGl2ZVwiIOWNs+ato+ehru+8ieOAglxuICAgICAgY29uc3QgaXRlbUlkID0gdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaXRlbV9pZCk7XG4gICAgICBpZiAoIWl0ZW1JZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLnu53ljLrpm7YgZXh0cmFjdFJlY29yZO+8muiusOW9lee8uuWwkSBpdGVtX2lk77yM5peg5rOV56Gu5a6aIGl0ZW1JZFwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbUlkLFxuICAgICAgICB0aW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC50aW1lKSA/PyBcIlwiLFxuICAgICAgICAvLyDimqDvuI8gKirmjqjmlq3vvIzpnZ7lrp7mtYsqKu+8muafpeivouWPguaVsOWQjeW3suehruiupOaUueaIkOS6hiByZWFsX2dhY2hhX3R5cGVcbiAgICAgICAgLy8g77yIYGdldERhdGEuanM6MjAyYO+8ie+8jOS9huWTjeW6lOiusOW9lemHjOWvueW6lOWtl+auteeahOmUruWQjeaYr+WQpuS5n+WPq1xuICAgICAgICAvLyByZWFsX2dhY2hhX3R5cGXjgIHov5jmmK/ku43nhLblj6sgZ2FjaGFfdHlwZe+8jHJlc2VhcmNoLzAz44CBMDQg5Z2H5pyq55u05o6lXG4gICAgICAgIC8vIOe7meWHuuOAgui/memHjOmAieaLqee7p+e7reivuyByZWNvcmQuZ2FjaGFfdHlwZeKAlOKAlOacgOW8uuaXgeivgeaYryBIb1lvLkdhY2hhXG4gICAgICAgIC8vIGBjcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjgwLTkwYCDnmoQgYEdhY2hhTG9nLmdhY2hhX3R5cGVgXG4gICAgICAgIC8vIOWtl+aute+8muWbm+asvuexs+WTiOa4uOa4uOaIj++8iOWQq+e7neWMuumbtu+8ieWFseeUqOWQjOS4gOS4qiBgZ2FjaGFfdHlwZWAg5Y+N5bqP5YiX5YyWXG4gICAgICAgIC8vIOebruagh++8jGRvYyBjb21tZW50IOayoeacieS4uue7neWMuumbtueVmeS7u+S9leWtl+auteWQjeeJueS+i++8iOWUr+S4gOeahOeJueS+i+azqOmHiuaYr1xuICAgICAgICAvLyBcIkdlbnNoaW4gSW1wYWN0OiBNaWxpYXN0cmEgV29uZGVybGFuZFwi77yM5LiO57ud5Yy66Zu25peg5YWz77yJ44CC5piv5peB6K+B77yMXG4gICAgICAgIC8vIOS4jeaYr+ebtOaOpeWunua1i+e7neWMuumbtuafkOS4gOadoeecn+WunuWTjeW6lOaKpeaWh+W+l+WHuueahOe7k+iuuu+8jOWmguWunuagh+azqOOAglxuICAgICAgICBiYW5uZXJJZDogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuZ2FjaGFfdHlwZSkgPz8gXCJcIixcbiAgICAgICAgY291bnQ6IHRvQ291bnQocmVjb3JkLmNvdW50KSxcbiAgICAgICAgbmFtZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQubmFtZSksXG4gICAgICAgIC8vIOesrOS4ieaho+eJqeWTgeWIhuexu1wi6YKm5biDXCLigJTigJRpdGVtVHlwZSDmnKzmnaXlsLHmmK/oh6rnlLHlrZfnrKbkuLJcbiAgICAgICAgLy8g77yIYFVuaWZpZWRSZWNvcmRGaWVsZHMuaXRlbVR5cGU/OiBzdHJpbmdg77yJ77yM6KOF5Lik5qGj6L+Y5piv5LiJ5qGj5a+557G75Z6LXG4gICAgICAgIC8vIOezu+e7n+ayoeacieWMuuWIq++8jOS4jemcgOimgeS7u+S9leaWsOWtl+auteOAglxuICAgICAgICBpdGVtVHlwZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaXRlbV90eXBlKSxcbiAgICAgICAgcmFyaXR5OiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5yYW5rX3R5cGUpLFxuICAgICAgICBzdGFibGVJZDogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaWQpLFxuICAgICAgICAvLyBnYWNoYV9pZCDmgZLkuLogJzAn77yI55yf5a6e5a2Y5qGj5a6e5rWL5YWo6YeP6K6w5b2V5LiA6Ie077yJ77yM5Yi75oSP5LiN6K+75Y+W4oCU4oCUXG4gICAgICAgIC8vIFVuaWZpZWRSZWNvcmRGaWVsZHMg5rKh5pyJ5om/6L29IGdhY2hhX2lkIOeahOWtl+aute+8jOWNoeaxoOacn+asoeW9kuWxnuWujOWFqOS6pFxuICAgICAgICAvLyDnu5kgYmFubmVySWTvvIhnYWNoYV90eXBlIOexu+WIq+egge+8iSsg5aSW6YOoIGJhbm5lciDlhYPmlbDmja7mjqjlr7zvvIzov5nmnaHot6/lvoRcbiAgICAgICAgLy8g5LiN6KaB5rGCIGdhY2hhX2lkIOacieaEj+S5ieOAguKaoO+4jyDkuI3opoHmioogXCLmgZLkuLogJzAnXCIg5b2T5oiQ6IO95L6d6LWW55qE5pat6KiA5Y67XG4gICAgICAgIC8vIOWGmeagoemqjOmAu+i+ke+8mkhvWW8uR2FjaGEgYGNyYXRlcy91cmxfc2NyYXBlci9zcmMvdHlwZXMucnM6OTctMTAyYCDlr7lcbiAgICAgICAgLy8g6L+Z5Liq5a2X5q6155So55qE5pivXCLlrrnlv43nqbrlrZfnrKbkuLJcIueahOWPjeW6j+WIl+WMlu+8iGBnYWNoYV9sb2dfZW1wdHlfc3RyaW5nX251bWJlcl9pbnRvYO+8ie+8jFxuICAgICAgICAvLyDor7TmmI7nnJ/lrp7lk43lupTph4zov5nkuKrlrZfmrrXlj6/og73mmK/nqbrkuLLvvIzkuI3msLjov5zmmK/lrZfpnaLph48gXCIwXCLjgIJcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcblxuICAvLyDljaHmsaDnsbvliKvnoIHkuI7mmL7npLrlkI3vvIzlj4zmnaXmupDnoa7orqTkuIDoh7TvvJrnnJ/lrp7lrZjmoaMgYHR5cGVNYXBgIOWtl+autSArXG4gIC8vIGB6enotc2lnbmFsLXNlYXJjaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczoyMy0zMGAg55qEIGBkZWZhdWx0VHlwZU1hcGDvvIxcbiAgLy8gNiDpobnpgJDmnaHlr7nkuIrvvIzpm7bliIbmrafjgIJcbiAgLy9cbiAgLy8g4pqg77iPIOi3qOa4uOaIj+WkjeeUqOmZt+mYse+8mmlkIFwiMlwiIOWcqOaYn+mTgeaYr1wi5paw5omL5rGgXCLvvIzlnKjnu53ljLrpm7bmmK9cIueLrOWutumikeautVwiXG4gIC8vIO+8iOinkuiJsiBVUCDmsaDvvIznrYnku7fkuo7ljp/npZ7nmoTop5LoibLmtLvliqjnpYjmhL/vvInigJTigJTlkIzkuIDkuKogaWQg5Zyo5Lik5Liq5o+S5Lu26YeM6K+t5LmJXG4gIC8vIOebuOWPje+8jOS4jeiDveaKiuafkOS4qua4uOaIj+eahCBiYW5uZXIgaWQg5bi46YeP5b2T5oiQXCLot6jmuLjmiI/pgJrnlKhcIuWOu+WkjeeUqOOAglxuICAvL1xuICAvLyDlnYfkuI3pnIDopoEgZW5kcG9pbnRPdmVycmlkZeKAlOKAlHJlc2VhcmNoLzA0IOS4juacrOasoeaguOWunueahOa6kOeggeWdh+acquingua1i+WIsOe7neWMuumbtlxuICAvLyDlrZjlnKjnsbvkvLzmmJ/pk4EgMjEvMjIg55qE56uv54K55YiG5rWB44CCXG4gIGJhbm5lcnM6IFtcbiAgICB7IGlkOiBcIjFcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuW4uOmpu+mikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjJcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIueLrOWutumikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjNcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIumfs+aTjumikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjVcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIumCpuW4g+mikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjEwMlwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi54us5a626YeN5pigXCIgfSB9LFxuICAgIHsgaWQ6IFwiMTAzXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLpn7Pmk47lm57lk41cIiB9IH0sXG4gIF0sXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIHBpdHlHcm91cHPvvJpiYXNlL2hhcmRQaXR5L2d1YXJhbnRlZSDlj5boh6rlrpjmlrnkv53lupXmpoLnjoflhaznpLogSlNPTlxuICAvLyDvvIhvcGVyYXRpb24td2Vic3RhdGljLm1paG95by5jb20vZ2FjaGFfaW5mby9uYXAvcHJvZF9nZl9jbi88aWQ+L3poLWNuLmpzb27vvIxcbiAgLy8g5LiA5omL5pWw5o2u77yJ77ybc3RhcnQvc3RlcCDmmK/npL7ljLrmjqjnrpfvvIzpnZ7lrpjmlrnvvIzop4HkuIrmlrkgRVhDTFVTSVZFX0NVUlZFIC9cbiAgLy8gV19FTkdJTkVfQ1VSVkUg5aOw5piO5peB55qE6K+05piO44CC5pys6L2u5Y+q5aOw5piOIFMg57qn77yIcmFyaXR5LnBpdHlUYXJnZXQg5a+55bqU5qGj77yJXG4gIC8vIOS/neW6lee7hO+8jOS4jeWjsOaYjiBBIOe6p+e7hOKAlOKAlOWfuue6vyBgcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzYCDlkIzmoLflj6rmnInkuIDkuKpcbiAgLy8gcGl0eUdyb3Vw77yM5L+d5oyB5Y+v5q+U77yMQSDnuqfkv53lupXmnKzova7mnKropobnm5bjgIJcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIHBpdHlHcm91cHM6IFtcbiAgICB7XG4gICAgICBrZXk6IFwiZXhjbHVzaXZlQ2hhbm5lbFwiLFxuICAgICAgbWVtYmVyczogW1wiMlwiXSxcbiAgICAgIGhhcmRQaXR5OiA5MCxcbiAgICAgIGN1cnZlOiBFWENMVVNJVkVfQ1VSVkUsXG4gICAgICAvLyDni6zlrrbpopHmrrXvvJpTIOe6pyA1MCUg5qaC546H55u05o6l5pivIFVQIOinkuiJsu+8jOatquS4gOasoeWQjuS4i+S4gOasoeW/heWumiBVUOOAglxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwid0VuZ2luZUNoYW5uZWxcIixcbiAgICAgIG1lbWJlcnM6IFtcIjNcIl0sXG4gICAgICBoYXJkUGl0eTogODAsXG4gICAgICBjdXJ2ZTogV19FTkdJTkVfQ1VSVkUsXG4gICAgICAvLyDpn7Pmk47popHmrrXvvJo3NSUg55u05o6lIFVQ77yI5LiN5pivIDUwJe+8ie+8jOWFrOekuiBKU09OIOWOn+aWh1xuICAgICAgLy8gdXBfcHJvYiDlr7nlupTov5nkuIDmoaPvvIznlKggd2VpZ2h0ZWQg6ICM5LiN5pivIGZpZnR5RmlmdHkg6KGo6L6+6Z2e5a+556ew5q+U5L6L44CCXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJ3ZWlnaHRlZFwiLCByYXRlVXBDaGFuY2U6IDAuNzUgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJzdGFuZGFyZENoYW5uZWxcIixcbiAgICAgIG1lbWJlcnM6IFtcIjFcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogRVhDTFVTSVZFX0NVUlZFLFxuICAgICAgLy8g5bi46am76aKR5q6177ya5rKh5pyJIFVQIOinkuiJsueahOamguW/te+8jOaKveWIsCBTIOe6p+WwseaYr+aKveWIsCBTIOe6p++8jOS4jeWtmOWcqFwi5q2qXCLjgIJcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIm5vbmVcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcImJhbmdib29DaGFubmVsXCIsXG4gICAgICBtZW1iZXJzOiBbXCI1XCJdLFxuICAgICAgaGFyZFBpdHk6IDgwLFxuICAgICAgY3VydmU6IFdfRU5HSU5FX0NVUlZFLFxuICAgICAgLy8g6YKm5biD6aKR5q6177ya546p5a626aKE5YWI5oyH5a6a55uu5qCH6YKm5biD77yM6Kem5Y+RIFMg57qn5pe25a6Y5pa55YWs56S6IHVwX3Byb2Ig5pivXG4gICAgICAvLyBcIjEwMC4wMDAlXCLigJTigJTmsqHmnIlcIuatqlwi55qE5qaC5b+177yM55SoIGFsd2F5c1JhdGVVcCDogIzkuI3mmK8gd2VpZ2h0ZWQ6MVxuICAgICAgLy8g5pu05YeG56Gu5Zyw6KGo6L6+XCLov5nkuKrmsaDlrZDnu5PmnoTkuIrkuI3lrZjlnKjpnZ4gVVAg57uT5p6cXCLjgIJcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcImFsd2F5c1JhdGVVcFwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICAvLyDimqDvuI8gMTAy77yI54us5a626YeN5pig77yJ5LiOIDLvvIjni6zlrrbpopHmrrXvvInmmK/lkKblhbHkuqvkv53lupXorqHmlbDigJTigJQqKuacquehruivgSoq44CCXG4gICAgICAvLyDlrpjmlrnmpoLnjoflhaznpLrpobXnlKjnmoTmmK/lj6bkuIDlpZflhoXpg6jnvJblj7fvvIzkuI7mir3ljaHorrDlvZUgQVBJIOeahCBnYWNoYV90eXBlXG4gICAgICAvLyDlr7nkuI3kuIrvvIzml6Dms5Xnm7TmjqXmr5Tlr7nvvJvnrKzkuInmlrkgd2lraSDnp7Dni6znq4vkvYbmsqHmnInlrpjmlrnnoa7orqTjgILov5nph4zmjIlcbiAgICAgIC8vIFwi54us56uL5L+d5bqV57uEXCLlpITnkIbvvIzmmK/kv53lrojpgInmi6nogIzpnZ7lt7Lpqozor4Hnu5PorrrigJTigJToi6XlkI7nu63or4Hlrp4gMTAyIOS4jiAyXG4gICAgICAvLyDlrp7pmYXlhbHkuqvkv53lupXorqHmlbDvvIzpnIDopoHmiorov5nph4zlkIjlubbmiJDlkIzkuIDkuKogUGl0eUdyb3Vw77yI5pS5IG1lbWJlcnM6XG4gICAgICAvLyBbXCIyXCIsIFwiMTAyXCJd77yJ77yM546w5Zyo5YWI5YiG5byA5bu657uE77yM6YG/5YWN57yW6YCg5LiA5Liq5pyq57uP6aqM6K+B55qE5ZCI5bm25YWz57O744CCXG4gICAgICBrZXk6IFwiZXhjbHVzaXZlQ2hhbm5lbFJlcnVuXCIsXG4gICAgICBtZW1iZXJzOiBbXCIxMDJcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogRVhDTFVTSVZFX0NVUlZFLFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICAvLyDlkIzkuIrvvJoxMDPvvIjpn7Pmk47lm57lk43vvInkuI4gM++8iOmfs+aTjumikeaute+8ieeahOS/neW6leWFseS6q+WFs+ezu+WQjOagt+acquehruivge+8jFxuICAgICAgLy8g54us56uL5bu657uE77yM55CG55Sx5LiOIDEwMiDlrozlhajkuIDoh7TjgIJcbiAgICAgIGtleTogXCJ3RW5naW5lQ2hhbm5lbEVjaG9cIixcbiAgICAgIG1lbWJlcnM6IFtcIjEwM1wiXSxcbiAgICAgIGhhcmRQaXR5OiA4MCxcbiAgICAgIGN1cnZlOiBXX0VOR0lORV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIndlaWdodGVkXCIsIHJhdGVVcENoYW5jZTogMC43NSB9LFxuICAgIH0sXG4gIF0sXG5cbiAgLy8g4piFIOacrOaPkuS7tuacgOmHjeimgeeahOmqjOivgeeCue+8mueogOacieW6pumYtuair+aYryAyLzMvNO+8jOS4jeaYryAzLzQvNeKAlOKAlOecn+WunuWtmOaho+WFqOmHj1xuICAvLyDorrDlvZXlrp7mtYsgcmFua190eXBlIOWPquWHuueOsOi/meS4ieS4quWAvO+8jOacgOmrmOaho+aYryA077yIUyDnuqfvvInkuI3mmK8gNeOAguWuv+S4u+afpeivolxuICAvLyDkv53lupXlkb3kuK3lv4XpobvotbAgYFdIRVJFIHJhcml0eSA9IDpwaXR5X3RhcmdldGDvvIzkuI3og73mnInku7vkvZUgXCI9IDVcIiDlrZfpnaLph4/jgIJcbiAgcmFyaXR5OiB7IGxhZGRlcjogW1wiMlwiLCBcIjNcIiwgXCI0XCJdLCBwaXR5VGFyZ2V0OiBcIjRcIiB9LFxuXG4gIHRpbWU6IHtcbiAgICAvLyDnm7Tov57lrpjmlrkgQVBJIOW+l+WIsOeahOaYr+acjeWKoeWZqOacrOWcsOaXtumXtO+8jOS4jee7j+i/h+S7u+S9leesrOS4ieaWueW3peWFt+eahOS6jOasoVxuICAgIC8vIOacrOWcsOWMluWkhOeQhuKAlOKAlOW3sueUqCBgenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6NDYwLTQ3NGBcbiAgICAvLyDmupDnoIHmoLjlrp7vvJror6Xlt6XlhbfkvJrmioogYGl0ZW0udGltZWAg5LuOIGByZWdpb25fdGltZV96b25lYCDmjaLnrpfliLBcbiAgICAvLyBgbG9jYWxUaW1lWm9uZWDvvIjlpJrotKblj7flkIjlubblnLrmma/kuIvkuKTogIXlj6/og73kuI3lkIzvvInvvJvkvYbmnKzmj5Lku7bkuI3nu4/ov4fov5nlsYJcbiAgICAvLyDlt6XlhbflpITnkIbvvIznm7Tov54gQVBJIOaLv+WIsOeahOWwseaYr+WOn+Wni+acjeWKoeWZqOacrOWcsOaXtumXtOWtl+espuS4su+8jOS4jemAgueUqOi/meadoVxuICAgIC8vIOaNoueul+mjjumZqeOAglxuICAgIHJhd1RpbWVDb252ZW50aW9uOiBcInNlcnZlckxvY2FsXCIsXG4gICAgLy8g5beu5byC54K577ya5pe25Yy65p2l5rqQ5pivIHJlZ2lvbiDlrZfmrrUgKyDlrqLmiLfnq6/pnZnmgIHooajvvIzkuI3mmK8gYXBpRmllbGTigJTigJRcbiAgICAvLyBBUEkg5Y+q6L+U5ZueIHJlZ2lvbu+8iOWmgiBcInByb2RfZ2ZfY25cIu+8ie+8jOS4jei/lOWbnuS7u+S9leW9ouW8j+eahCBVVEMg5YGP56e76YeP77yMXG4gICAgLy8g5o2i566X6KGo55Sx5a6i5oi356uv57u05oqk44CCXG4gICAgdGltZXpvbmVTb3VyY2U6IHtcbiAgICAgIGtpbmQ6IFwic3RhdGljVGFibGVcIixcbiAgICAgIGZpZWxkOiBcInJlZ2lvblwiLFxuICAgICAgLy8g5LqU5p2h5Yy65pyN56CB5YiwIFVUQyDlgY/np7vph4/nmoTlrozmlbTmmKDlsITvvIzlj4zmnaXmupDpgJDpobnmoLjlr7nkuIDoh7TvvIzpm7bliIbmrafvvJpcbiAgICAgIC8vICAgYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjMzLTM5YO+8iHNlcnZlclRpbWVab25l77yJXG4gICAgICAvLyAgIGBIb1lvLkdhY2hhL2NyYXRlcy9nYW1lX2Jpei9zcmMvbGliLnJzOjE0NS0xNDlg77yI5Yy65pyN56CB5a2X56ym5Liy5bi46YeP77yJXG4gICAgICAvLyAgICAg5LiOIGA6MjAwLTIwNGDvvIhOQVBfQ04vTkFQX0dMT0JBTF9KUC9FVS9VUy9TRyDkupTkuKrlj5jkvZPnu5HlrprnmoTlgY/np7vph4/vvIlcbiAgICAgIC8vIOKaoO+4jyBwcm9kX2dmX2pwIOWQjeWtl+WDj+aXpeacje+8jOWunumZheaYr+S6muacjeKAlOKAlEhvWW8uR2FjaGEg5rqQ56CB5Zyo6L+Z5LiA6KGM55qEXG4gICAgICAvLyDooYzlsL7ms6jph4rnm7TkuaYgXCIvLyBBc2lhXCLvvIhsaWIucnM6MjAx77yJ77yM5LiN6KaB5oyJ5a2X6Z2i5ZCN6K+v5Yik5oiQ5pel5pys5pe25Yy644CCXG4gICAgICB0YWJsZToge1xuICAgICAgICBwcm9kX2dmX2NuOiA4LFxuICAgICAgICBwcm9kX2dmX2pwOiA4LFxuICAgICAgICBwcm9kX2dmX3VzOiAtNSxcbiAgICAgICAgcHJvZF9nZl9ldTogMSxcbiAgICAgICAgcHJvZF9nZl9zZzogOCxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyByYXdGb3JtYXQg5LiN5aOw5piO4oCU4oCU5ZON5bqUIHRpbWUg5a2X5q615piv56m65qC85YiG6ZqU55qEIFwiWVlZWS1NTS1ERCBISDptbTpzc1wiXG4gICAgLy8g77yI55yf5a6e5a2Y5qGj5a6e5rWL5LiA6Ie077yJ77yM5q2j5aW95pivIEwxIOiMg+W8j+WxgueahOe8uuecgeWAvCBzcGFjZVNlcGFyYXRlZO+8jOS4jemcgOimgVxuICAgIC8vIOaYvuW8j+imhuebluOAglxuICB9LFxuXG4gIC8vIOS4juWOn+elnuS4gOiHtOeahOiMg+W8jyBBIOmAmueUqOWfuue6v+etlueVpe+8jOmdnue7neWMuumbtuS4k+WxnuW3ruW8gueCue+8muWIhumhteWTjeW6lOiDveaLv+WIsOeahFxuICAvLyDlj6rmmK/jgIzov5nkuIDpobXmnInmsqHmnInmm7TlpJrjgI3vvIzlrpjmlrnkuZ/msqHmnInlj6blpJbnmoTmnYPlqIHogZrlkIjnu5/orqHmjqXlj6PvvIzlm6DmraTnlKhcbiAgLy8gaW5HYW1lUGFnZUNvdW5077yI6Zu25oiQ5pys44CB5YWo6KaG55uW44CB5peg6aKd5aSW5Yet5o2u6aOO6Zmp77yJ77yM5LiN5piv57ud5Yy66Zu254m55pyJ5Yaz562W44CCXG4gIGJhc2VsaW5lOiB7IGtpbmQ6IFwiaW5HYW1lUGFnZUNvdW50XCIgfSxcblxuICByZXRlbnRpb246IHtcbiAgICBkaXNwbGF5VGV4dDogeyBcInpoLUNOXCI6IFwiNiDkuKrmnIhcIiB9LFxuICAgIGNvbnNlcnZhdGl2ZURheXM6IDYgKiAyOCxcbiAgfSxcblxuICAvLyBpdGVtSWRTb3VyY2Ug5LiN5aOw5piO77yM57y655yBIFwibmF0aXZlXCLigJTigJTop4HkuIrmlrkgZXh0cmFjdFJlY29yZCDph4wgaXRlbUlkXG4gIC8vIOaXgeeahOivtOaYju+8mue7neWMuumbtiBBUEkg55u05o6l6L+U5ZueIGl0ZW1faWTvvIzkuI3mmK/ljp/npZ7pgqPnp41cIuacrOWcsOWMlueJqeWTgeWQjVwi54m55L6L44CCXG5cbiAgLy8gcHJlY29uZGl0aW9ucyAvIG1ldGFkYXRhIOWdh+S4jeWjsOaYjuKAlOKAlOWOn+elnumCo+adoVwi5ri45oiP6Iez5bCR6L+Q6KGM6L+H5LiA5qyh77yM57yT5a2YXG4gIC8vIOebruW9leaJjeS8muiiq+WIm+W7ulwi55qE5YmN572u5p2h5Lu25py65Yi25LiK5a+557ud5Yy66Zu25ZCM5qC35oiQ56uL77yI5ZCM5LiA5aWXIGNocm9taXVtQ2FjaGVcbiAgLy8g5Yet5o2u6I635Y+W5py65Yi277yJ77yM5L2G5pys5qyh5Lu75Yqh55qE6LWE5paZ6IyD5Zu077yIcmVzZWFyY2gvMDHjgIEwM+OAgTA0ICtcbiAgLy8g5LiK6Z2i5YiX5Ye655qE5rqQ56CB5byV55So77yJ5rKh5pyJ6KaG55uW57ud5Yy66Zu25LiT5bGe55qE5YmN572u5p2h5Lu25beu5byC77yM5LiN6aKd5aSW57yW6YCg77yMXG4gIC8vIOWIpOaWreS4jiBgZHJpbGxzL3p6ei9tYW5pZmVzdC50c2Ag5LiA6Ie044CCXG59IHNhdGlzZmllcyBQbHVnaW5NYW5pZmVzdDtcbiJdLCJtYXBwaW5ncyI6Ijs7O0NBa0JBLE1BQWFBLFVBQXFCO0VBQ2hDLGtCQUFrQixTQUFTLFFBQVE7R0FDakMsTUFBTSxhQUFhLElBQUksSUFBSSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUM7R0FDMUMsSUFBSSxlQUFlLEtBQUssT0FBTztHQUMvQixJQUFJLGVBQWUsS0FBSyxPQUFPO0dBQy9CLE9BQU87RUFDVDtFQUVBLGtCQUFrQixXQUFXO0dBQzNCLElBQUksQ0FBQyxPQUFPLFVBQ1YsTUFBTSxJQUFJLE1BQ1Isd0RBQXdELE9BQU8sT0FBTyxFQUN4RTtHQUlGLE9BQU8sR0FBRyxPQUFPLFNBQVMsR0FBRyxPQUFPO0VBQ3RDO0NBQ0Y7Ozs7Ozs7Ozs7Ozs7Q0NKQSxTQUFTQyxzQkFBb0IsVUFBOEI7RUFDekQsSUFBSSxPQUFPLGFBQWEsWUFBWSxhQUFhLE1BQU0sT0FBTyxDQUFDO0VBQy9E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