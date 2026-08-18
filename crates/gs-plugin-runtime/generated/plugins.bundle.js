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
	/**
	* 解析 `api.uigf.org` 字典接口的响应体：一份 `{ name: id }` 的全量映射
	* （如 `{"无锋剑": 11101, ...}`），产出 name → itemId（字符串）的字典。
	*
	* 纯函数，不做 IO——真正的网络请求、重试、本地缓存全部在宿主侧
	* （`gs_host::metadata_backfill` 模块），这里只负责"信任宿主已经取回的这份
	* JSON，形状对不对我说了算"。
	*
	* 已用真实实现核实（`docs/example-projects/genshin-wish-export/src/main/
	* UIGFJson.js` 的 `fetchItemIdDict`）：字典值是 JSON number，不是字符串——
	* `gacha_record.item_id` 落库后是字符串列，这里显式 `String()` 转换一次，
	* 不把"数字转字符串"这件事丢给调用方假设。
	*
	* 防御式解析：整份响应形状不对（非对象/是数组）返回 `undefined`，让宿主
	* 按"这个语言暂时没有可用字典"处理；单个条目的值形状不对（既不是数字也不是
	* 非空字符串）直接跳过那一条，不让一条脏数据拖垮整份字典——与
	* `extractGachaLogList` 的防御式解析同一态度。
	*/
	function parseUigfDictResponse(response) {
		if (typeof response !== "object" || response === null || Array.isArray(response)) return;
		const dict = {};
		for (const [name, id] of Object.entries(response)) if (typeof id === "number" && Number.isFinite(id)) dict[name] = String(id);
		else if (typeof id === "string" && id.trim().length > 0) dict[name] = id;
		return dict;
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
			pityTarget: "5",
			tierLabels: {
				"3": { "zh-CN": "三星" },
				"4": { "zh-CN": "四星" },
				"5": { "zh-CN": "五星" }
			}
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
		itemIdSource: "displayName",
		metadata: {
			kind: "online",
			direction: "nameToId",
			request: { url: "https://api.uigf.org/dict/genshin/{{lang}}.json" },
			parseResponse: parseUigfDictResponse
		}
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
				stableId: toNonEmptyString$2(record.id),
				gachaId: toNonEmptyString$2(record.gacha_id)
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
			pityTarget: "5",
			tierLabels: {
				"3": { "zh-CN": "三星" },
				"4": { "zh-CN": "四星" },
				"5": { "zh-CN": "五星" }
			}
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
			pityTarget: "5",
			tierLabels: {
				"3": { "zh-CN": "三星" },
				"4": { "zh-CN": "四星" },
				"5": { "zh-CN": "五星" }
			}
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
			pityTarget: "4",
			tierLabels: {
				"2": { "zh-CN": "B" },
				"3": { "zh-CN": "A" },
				"4": { "zh-CN": "S" }
			}
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiX2dzLXBsdWdpbnMtZW50cnkuanMiLCJuYW1lcyI6WyJob29rcyIsImV4dHJhY3RHYWNoYUxvZ0xpc3QiLCJ0b05vbkVtcHR5U3RyaW5nIiwidG9Db3VudCIsIm1hbmlmZXN0IiwiaG9va3MiLCJleHRyYWN0R2FjaGFMb2dMaXN0IiwidG9Ob25FbXB0eVN0cmluZyIsInRvQ291bnQiLCJtYW5pZmVzdCIsImhvb2tzIiwidG9Ob25FbXB0eVN0cmluZyIsInRvQ291bnQiLCJtYW5pZmVzdCJdLCJzb3VyY2VzIjpbIi4uL3BsdWdpbnMvZ2Vuc2hpbi9ob29rcy50cyIsIi4uL3BsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50cyIsIi4uL3BsdWdpbnMvc3RhcnJhaWwvaG9va3MudHMiLCIuLi9wbHVnaW5zL3N0YXJyYWlsL21hbmlmZXN0LnRzIiwiLi4vcGx1Z2lucy93dXdhL2hvb2tzLnRzIiwiLi4vcGx1Z2lucy93dXdhL21hbmlmZXN0LnRzIiwiLi4vcGx1Z2lucy96enovaG9va3MudHMiLCIuLi9wbHVnaW5zL3p6ei9tYW5pZmVzdC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIOWOn+elnuaPkuS7tueahOmAg+eUn+iIsSBob29rc+OAglxuICpcbiAqIOS4pOS4qiBob29rIOWdh+S4jeWPr+ecgeeVpe+8mlxuICpcbiAqIC0gYHJlc29sdmVUaW1lem9uZWDvvJrnsbPlk4jmuLggYGdldEdhY2hhTG9nYCDlk43lupTkuI3luKbku7vkvZXml7bljLrlrZfmrrXvvIjml6Lml6AgYHJlZ2lvbmBcbiAqICAg5Lmf5pegIGByZWdpb25fdGltZV96b25lYO+8ie+8jOWPquiDveaMiSBVSUQg6aaW5L2N5pWw5a2X5o6o5pat5pyN5Yqh5Zmo5omA5Zyo5pe25Yy644CCXG4gKiAgIOWPguiAg+WunueOsOW3sueUqOS4ieaWueW3peWFt+a6kOeggeaguOWunu+8mmB1aWRbMF09PT0nNifihpItNSwgJzcn4oaSMSwgZWxzZSA4YFxuICogICDvvIhkb2NzL19pbnRlcm5hbC9yZXNlYXJjaC8wNC3lkIzml4/lt6XlhbfkuInmlrnmupDnoIHlr7nmr5QubWQgwqc0LjTvvInjgIJcbiAqIC0gYGRlcml2ZVJlY29yZEtleWDvvJrmnI3liqHnq6/pm6roirEgSUQg5LiN5ZCr5Y2h5rGg57u05bqm44CC5Y+C6ICD5a6e546wIEhvWW8uR2FjaGEg5LiK57q/5pe2XG4gKiAgIOS4u+mUruaYryBgKGJ1c2luZXNzLCB1aWQsIGlkKWDvvIzkuIDlubTlkI7kuLrmmJ/pk4HogZTliqjmsaAgYGdldExkR2FjaGFMb2dgIOihpeS6huS4gOasoVxuICogICDmlbTooajph43lu7rov4Hnp7vvvIzmlLnmiJAgYChidXNpbmVzcywgdWlkLCBpZCwgZ2FjaGFfdHlwZSlg4oCU4oCUU1FMaXRlIOaUueS4jeS6huS4u+mUru+8jFxuICogICDov5nkuKrku6Pku7fkuI3or6XnlZnliLDku6XlkI7miY3ooaXjgILnsbPlk4jmuLjkuInmuLjkuIDlvovmjInlkIzkuIDop4TliJnlrp7njrDmnKwgaG9va++8jOWNs+S9v+WOn+elnlxuICogICDnm67liY3lj6rmnInljZXkuIDnq6/ngrnjgIHlsJrmnKrop4LmtYvliLDot6jnq6/ngrnpm6roirEgSUQg56Kw5pKe77yM5Lmf5LiN5L6L5aSWXG4gKiAgIO+8iHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvbWFuaWZlc3QudHMg55qEIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlgIOaWh+aho++8ieOAglxuICovXG5pbXBvcnQgdHlwZSB7IFBsdWdpbkhvb2tzIH0gZnJvbSBcImdzLXBsdWdpbi1raXRcIjtcblxuZXhwb3J0IGNvbnN0IGhvb2tzOiBQbHVnaW5Ib29rcyA9IHtcbiAgcmVzb2x2ZVRpbWV6b25lOiAoX3JlY29yZCwgY3R4KSA9PiB7XG4gICAgY29uc3QgZmlyc3REaWdpdCA9IGN0eC51aWQudHJpbSgpLmNoYXJBdCgwKTtcbiAgICBpZiAoZmlyc3REaWdpdCA9PT0gXCI2XCIpIHJldHVybiAtNTsgLy8g576O5pyNXG4gICAgaWYgKGZpcnN0RGlnaXQgPT09IFwiN1wiKSByZXR1cm4gMTsgLy8g5qyn5pyNXG4gICAgcmV0dXJuIDg7IC8vIOWbveacjSAvIOS6muacjeetieWFtuS9meWMuuacje+8jOWQq+acquefpeWMuuacjeeahOS/neWuiOm7mOiupOWAvFxuICB9LFxuXG4gIGRlcml2ZVJlY29yZEtleTogKHJlY29yZCkgPT4ge1xuICAgIGlmICghcmVjb3JkLnN0YWJsZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGDljp/npZ7orrDlvZXnvLrlsJEgc3RhYmxlSWTvvIjmnI3liqHnq6/pm6roirEgSUTvvInvvIzml6Dms5XnlJ/miJDnqLPlrprnmoQgcmVjb3JkX2tlee+8mml0ZW1JZD1cIiR7cmVjb3JkLml0ZW1JZH1cImAsXG4gICAgICApO1xuICAgIH1cbiAgICAvLyDljp/lp4sgZ2FjaGFfdHlwZe+8iOWPr+iDveaYryBcIjQwMFwiIOi/meexu+S4jeWPr+WNleeLrOafpeivoueahOWQiOW5tuWtkOexu+Wei++8iSsg5pyN5Yqh56uv6Zuq6IqxIElE77yMXG4gICAgLy8g5oqK5Y2h5rGg57u05bqm5bm26L+b5Y6777yM6YG/5YWN6Leo56uv54K55Zy65pmv5LiL6KO46Zuq6IqxIElEIOaSnumUruWQjuiiqyBJTlNFUlQgT1IgSUdOT1JFIOmdmem7mOS4ouW8g+OAglxuICAgIHJldHVybiBgJHtyZWNvcmQuYmFubmVySWR9OiR7cmVjb3JkLnN0YWJsZUlkfWA7XG4gIH0sXG59O1xuIiwiLyoqXG4gKiDljp/npZ7mj5Lku7YgbWFuaWZlc3TjgIJcbiAqXG4gKiDph4fpm4bojIPlvI/vvJphdXRoa2V577yIYGdzLXAtYXV0aGtleWDvvInvvIzlh63mja7mnaXmupDmmK/muLjmiI/lhoXnva4gQ2hyb21pdW0g57uE5Lu255qEXG4gKiDno4Hnm5jnvJPlrZjigJTigJTnjqnlrrbmiZPlvIDnpYjmhL/orrDlvZXpobXml7bvvIzlrqLmiLfnq6/kvJrku6Ugd2VidmlldyDliqDovb3orrDlvZXpobXpnaLvvIzlhbbkuK3kuIDmrKFcbiAqIOivt+axguS8muWRveS4reWumOaWuSBgZ2V0R2FjaGFMb2dgIOaOpeWPo+W5tuW4puS4iiBgYXV0aGtleWDvvIzov5nkuKror7fmsYIgVVJMIOS8muiiq+WGmeWFpVxuICogYHdlYkNhY2hlc2Ag55uu5b2V5LiL5p+Q5Liq54mI5pys5Y+35a2Q55uu5b2V5YaF55qEIGBDYWNoZS9DYWNoZV9EYXRhL2RhdGFfMmAg57yT5a2Y57Si5byV5paH5Lu2XG4gKiDvvIjms6jmhI/vvJpKU0RvYyDms6jph4rph4zkuI3og73lh7rnjrDlrZfpnaLph48gXCLmmJ/lj7cr5pac5p2gXCLvvIzmlYXmraTlpITkuI3lhpnpgJrphY3nrKblvaLlvI/nmoTot6/lvoTvvInjgIJcbiAqXG4gKiDlrZfmrrXlvaLnirbkuI7nnJ/lrp7ooYzkuLrlt7Llr7nnhafku6XkuIvotYTmlpnmoKHlh4bvvIzpgb/lhY3ph43ouYggYENMQVVERS5sb2NhbC5tZGAg6K6w5b2V6L+H55qEXG4gKiDjgIzmnKrmoKHlh4blsLHlhpnlrp7njrDjgI3nmoTplJnor6/vvIjpuKPmva7lh63mja7ot6/lvoTkuInlpITmjqjnv7vnmoTmlZnorq3vvInvvJpcbiAqIC0gZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDMt55yf5a6e5a+85Ye65pWw5o2u5qC85byP5a6e5rWLLm1kIMKn5LiA44CBwqfkuoxcbiAqIC0gZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDQt5ZCM5peP5bel5YW35LiJ5pa55rqQ56CB5a+55q+ULm1kIMKnNC4x772ewqc0LjlcbiAqIC0gZG9jcy9leGFtcGxlLXByb2plY3RzL2dlbnNoaW4td2lzaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qc++8iOWIhumhtS/lkIjlubYv6ZmQ6YCf5a6e546w77yJXG4gKiAtIGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9Ib1lvLkdhY2hhL2NyYXRlcy91cmxfc2NyYXBlci9zcmMvdHlwZXMucnPvvIhgR2FjaGFMb2dgIOWtl+auteWumuS5ie+8jFxuICogICDnoa7orqTljp/npZ4gQVBJIOWTjeW6lOmHjOayoeaciSBgaXRlbV9pZGAg5a2X5q614oCU4oCU5LiO5pif6ZOBL+e7neWMuumbtuS4jeWQjO+8iVxuICogLSBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvdXJsX2ZpbmRlci9zcmMvbGliLnJz77yIYFJFR0VYX0dBQ0hBX1VSTGDvvIxcbiAqICAg56Gu6K6k57yT5a2Y6YeM5ZG95Lit55qE5pivIGAuLi4vZ2FjaGFfaW5mby9hcGkvZ2V0R2FjaGFMb2c/Li4uYXV0aGtleT0uLi5gIOi/meadoeecn+Wunuivt+axgiBVUkzvvIlcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqXG4gKiDku44gYGdldEdhY2hhTG9nYCDlk43lupTkvZPph4zlj5blh7rmnKzpobXorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDnnJ/lrp7lk43lupTlvaLmgIHmmK8gYHsgcmV0Y29kZSwgbWVzc2FnZSwgZGF0YTogeyBsaXN0OiBbLi4uXSwgcmVnaW9uIH0gfWBcbiAqIO+8iEhvWW8uR2FjaGEgYE1paG95b1Jlc3BvbnNlPEdhY2hhTG9ncz5gIC8gZ2Vuc2hpbi13aXNoLWV4cG9ydFxuICogYGdldEdhY2hhTG9nYCDph4znmoQgYHJlcy5kYXRhLmxpc3Rg77yJ44CC6Ziy5b6h5byP6Kej5p6Q77ya5Lu75L2V5LiA5bGC5b2i54q25LiN5a+55bCx6L+U5ZueXG4gKiDnqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjigJTigJTliIbpobXlvJXmk47kvJrmiornqbrmlbDnu4TlvZPkvZwgYGVtcHR5UGFnZWAg57uI5q2i5p2h5Lu25aSE55CG77yMXG4gKiDov5nmr5TorqnkuIDmrKHlgbblj5HnmoTnlbjlvaLlk43lupTkuK3mlq3mlbTmnaHph4fpm4bmtYHnqIvmm7TlronlhajjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhTG9nTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBkYXRhID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xufVxuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKiDlrpjmlrnlk43lupTph4znmoQgYGNvdW50YCDmmK/mlbDlrZflrZfnrKbkuLLvvIjlpoIgYFwiMVwiYO+8ie+8jOmYsuW+oeW8j+i9rOaNou+8jOW8guW4uOi+k+WFpeWFnOW6leS4uiAx44CCICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuLyoqXG4gKiDop6PmnpAgYGFwaS51aWdmLm9yZ2Ag5a2X5YW45o6l5Y+j55qE5ZON5bqU5L2T77ya5LiA5Lu9IGB7IG5hbWU6IGlkIH1gIOeahOWFqOmHj+aYoOWwhFxuICog77yI5aaCIGB7XCLml6DplIvliZFcIjogMTExMDEsIC4uLn1g77yJ77yM5Lqn5Ye6IG5hbWUg4oaSIGl0ZW1JZO+8iOWtl+espuS4su+8ieeahOWtl+WFuOOAglxuICpcbiAqIOe6r+WHveaVsO+8jOS4jeWBmiBJT+KAlOKAlOecn+ato+eahOe9kee7nOivt+axguOAgemHjeivleOAgeacrOWcsOe8k+WtmOWFqOmDqOWcqOWuv+S4u+S+p1xuICog77yIYGdzX2hvc3Q6Om1ldGFkYXRhX2JhY2tmaWxsYCDmqKHlnZfvvInvvIzov5nph4zlj6rotJ/otKNcIuS/oeS7u+Wuv+S4u+W3sue7j+WPluWbnueahOi/meS7vVxuICogSlNPTu+8jOW9oueKtuWvueS4jeWvueaIkeivtOS6hueul1wi44CCXG4gKlxuICog5bey55So55yf5a6e5a6e546w5qC45a6e77yIYGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9nZW5zaGluLXdpc2gtZXhwb3J0L3NyYy9tYWluL1xuICogVUlHRkpzb24uanNgIOeahCBgZmV0Y2hJdGVtSWREaWN0YO+8ie+8muWtl+WFuOWAvOaYryBKU09OIG51bWJlcu+8jOS4jeaYr+Wtl+espuS4suKAlOKAlFxuICogYGdhY2hhX3JlY29yZC5pdGVtX2lkYCDokL3lupPlkI7mmK/lrZfnrKbkuLLliJfvvIzov5nph4zmmL7lvI8gYFN0cmluZygpYCDovazmjaLkuIDmrKHvvIxcbiAqIOS4jeaKilwi5pWw5a2X6L2s5a2X56ym5LiyXCLov5nku7bkuovkuKLnu5nosIPnlKjmlrnlgYforr7jgIJcbiAqXG4gKiDpmLLlvqHlvI/op6PmnpDvvJrmlbTku73lk43lupTlvaLnirbkuI3lr7nvvIjpnZ7lr7nosaEv5piv5pWw57uE77yJ6L+U5ZueIGB1bmRlZmluZWRg77yM6K6p5a6/5Li7XG4gKiDmjIlcIui/meS4quivreiogOaaguaXtuayoeacieWPr+eUqOWtl+WFuFwi5aSE55CG77yb5Y2V5Liq5p2h55uu55qE5YC85b2i54q25LiN5a+577yI5pei5LiN5piv5pWw5a2X5Lmf5LiN5pivXG4gKiDpnZ7nqbrlrZfnrKbkuLLvvInnm7TmjqXot7Pov4fpgqPkuIDmnaHvvIzkuI3orqnkuIDmnaHohI/mlbDmja7mi5blnq7mlbTku73lrZflhbjigJTigJTkuI5cbiAqIGBleHRyYWN0R2FjaGFMb2dMaXN0YCDnmoTpmLLlvqHlvI/op6PmnpDlkIzkuIDmgIHluqbjgIJcbiAqL1xuZnVuY3Rpb24gcGFyc2VVaWdmRGljdFJlc3BvbnNlKHJlc3BvbnNlOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwgfHwgQXJyYXkuaXNBcnJheShyZXNwb25zZSkpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIGNvbnN0IGRpY3Q6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgZm9yIChjb25zdCBbbmFtZSwgaWRdIG9mIE9iamVjdC5lbnRyaWVzKHJlc3BvbnNlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xuICAgIGlmICh0eXBlb2YgaWQgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKGlkKSkge1xuICAgICAgZGljdFtuYW1lXSA9IFN0cmluZyhpZCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgaWQgPT09IFwic3RyaW5nXCIgJiYgaWQudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgIGRpY3RbbmFtZV0gPSBpZDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGRpY3Q7XG59XG5cbmV4cG9ydCBjb25zdCBtYW5pZmVzdCA9IHtcbiAgaWQ6IFwiZ2Vuc2hpblwiLFxuICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5Y6f56WeXCIgfSxcbiAgc2RrVmVyc2lvbjogXCIxLjAuMFwiLFxuICBwbGF0Zm9ybXM6IFtcIndpbmRvd3NcIl0sXG4gIG1haW50YWluZXJzOiBbXCJnYWNoYS1zdHVkaW9cIl0sXG4gIGV4Y2hhbmdlRm9ybWF0czogW1widWlnZi12NFwiXSxcblxuICAvLyDlm77moIflnLDlnYDmnaXoh6ogVGFwVGFwIOW6lOeUqOW4guWcuumhtemdou+8jOW3suWunua1i+mqjOivge+8iEhUVFAgMjAw44CB5peg6Ziy55uX6ZO+L+aXoOmcgFxuICAvLyByZWZlcmVy44CBY29udGVudC10eXBlIOWdh+S4uiBpbWFnZS9wbmfjgIFtYWdpYyBieXRlcyA4OTUwNGU0N+OAgTUwfjc0IEtC77yJ44CCXG4gIC8vIOKaoO+4jyDlnLDlnYDku6UgLmpwZyDnu5PlsL7kvYblrp7pmYXlhoXlrrnmmK8gUE5H4oCU4oCU6L+Z5pivIFRhcFRhcCBDRE4g55qE55yf5a6e6KGM5Li677yM5LiN5pivXG4gIC8vIOaLvOWGmemUmeivr++8jOS4jeimgVwi57qg5q2jXCLmianlsZXlkI3vvJvokL3nm5jliY3nmoTmoLzlvI/moKHpqozvvIhjb250ZW50LXR5cGUgKyBtYWdpY1xuICAvLyBieXRlc++8jOS4jeS/oeS7uyBVUkwg5omp5bGV5ZCN77yJ5piv5a6/5Li75L6n6IGM6LSj77yM6KeBIGBpY29uVXJsYCDlrZfmrrXmnKzouqvnmoTmlofmoaPjgIJcbiAgaWNvblVybDpcbiAgICBcImh0dHBzOi8vaW1nLXRjLnRhcGltZy5jb20vbWFya2V0L2ltYWdlcy80YzQ0MTc2OWI1ZmIzYjY3MGM4YjU5YTYxMjRkOWZmMi5wbmcvX3RhcF9hcHBpY29uX20uanBnXCIsXG5cbiAgY29sbGVjdDoge1xuICAgIHBhcmFkaWdtOiBcImNyZWRlbnRpYWxlZEFwaVwiLFxuICAgIHBhcmFtczoge1xuICAgICAgY3JlZGVudGlhbDoge1xuICAgICAgICBraW5kOiBcImNocm9taXVtQ2FjaGVcIixcbiAgICAgICAgLy8g4pqg77iPIOebuOWvueeJh+aute+8jOS4jeaYr+e7neWvuei3r+W+hOKAlOKAlOe7neWvueWuieijheebruW9leadpeiHqueUqOaIt+mFjee9ru+8jOeUsSBSdXN0IOS+p+aLvOaOpeOAglxuICAgICAgICBnYW1lRGlyOiBcIll1YW5TaGVuX0RhdGEvd2ViQ2FjaGVzXCIsXG4gICAgICAgIHVybFBhdHRlcm46IC9odHRwczpcXC9cXC8uKz9nZXRHYWNoYUxvZ1teXCJdKy8sXG4gICAgICB9LFxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICB1cmw6IFwie3tjcmVkZW50aWFsfX0mcGFnZT17e3BhZ2V9fSZnYWNoYV90eXBlPXt7Z2FjaGFUeXBlfX0mc2l6ZT17e3BhZ2VTaXplfX0mZW5kX2lkPTBcIixcbiAgICAgIH0sXG4gICAgICAvLyDlm73mnI0gKyDlm73pmYXmnI3kuKTkuKogaG9zdCDpg73opoHmlLblvZXvvJp1cmxQYXR0ZXJu77yI5LiK5pa577yJ5pys6Lqr5LiN5Yy65YiG5Z+f5ZCN77yMXG4gICAgICAvLyDlj6ropoEgVVJMIOmHjOWHuueOsCBcImdldEdhY2hhTG9nXCIg5bCx5Lya5Yy56YWN4oCU4oCU5Lmf5bCx5piv6K+077yM5ZCM5LiA5Lu95o+S5Lu25pei5LyaXG4gICAgICAvLyDku47lm73mnI3lrqLmiLfnq6/kuZ/kvJrku47lm73pmYXmnI3lrqLmiLfnq6/nmoTnvJPlrZjph4zmiavlh7rlh63mja4gVVJM77yM6Iul5Y+q5aOw5piO5Zu95pyNXG4gICAgICAvLyBob3N077yM5Zu96ZmF5pyN546p5a6255qE5q2j5bi46K+35rGC5Lya6KKr6L+Z6YeM5paw5Yqg55qE55m95ZCN5Y2V6K+v5Yik5Li65oqV5q+S6ICM5ouS57ud44CCXG4gICAgICAvLyDkuKTkuKrln5/lkI3lt7LnlKggSG9Zby5HYWNoYSDmupDnoIHmoLjlrp7vvIjpnZ7mnKzmj5Lku7bni6znq4vlrp7mtYvvvIzku4XkvZzkuovlrp7lvJXnlKjvvInvvJpcbiAgICAgIC8vIGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9Ib1lvLkdhY2hhL2NyYXRlcy9nYW1lX2Jpei9zcmMvYXBpLnJzOjM1LTM2XG4gICAgICAvLyAgICgoSGs0ZSwgT2ZmaWNpYWwpLCBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24taGs0ZS5taWhveW8uY29tLy4uLlwiXG4gICAgICAvLyAgICgoSGs0ZSwgT3ZlcnNlYSksICBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24taGs0ZS1zZy5ob3lvdmVyc2UuY29tLy4uLlwiXG4gICAgICAvLyDkuI4gZml4dHVyZXMvZ2Vuc2hpbi9jcmVkZW50aWFsL2RhdGFfMi5zYW1wbGUg6YeM55qE56S65L6LIFVSTO+8iOWbveacje+8jFxuICAgICAgLy8gcHVibGljLW9wZXJhdGlvbi1oazRlLm1paG95by5jb23vvInkupLnm7jljbDor4HvvIxkYXRhXzIuc2FtcGxlIOacrOi6q+WPqlxuICAgICAgLy8g6KaG55uW5LqG5Zu95pyN6L+Z5LiA56eN77yM5Zu96ZmF5pyNIGhvc3Qg6KGl5YWF6Ieq5LiK6Z2i6L+Z5Lu95rqQ56CB5byV55So44CCXG4gICAgICBhbGxvd2VkSG9zdHM6IFtcInB1YmxpYy1vcGVyYXRpb24taGs0ZS5taWhveW8uY29tXCIsIFwicHVibGljLW9wZXJhdGlvbi1oazRlLXNnLmhveW92ZXJzZS5jb21cIl0sXG4gICAgICBleHRyYWN0TGlzdDogZXh0cmFjdEdhY2hhTG9nTGlzdCxcbiAgICB9LFxuICB9LFxuXG4gIGZpZWxkczoge1xuICAgIGV4dHJhY3RSZWNvcmQ6IChyYXcpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgcmF3ICE9PSBcIm9iamVjdFwiIHx8IHJhdyA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLljp/npZ4gZXh0cmFjdFJlY29yZCDmlLbliLDpnZ7lr7nosaHlvaLmgIHnmoTljp/lp4vorrDlvZVcIik7XG4gICAgICB9XG4gICAgICBjb25zdCByZWNvcmQgPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbiAgICAgIGNvbnN0IG5hbWUgPSB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5uYW1lKTtcbiAgICAgIGNvbnN0IHN0YWJsZUlkID0gdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaWQpO1xuICAgICAgLy8g4pqg77iPIOWOn+elniBBUEkg5LiN6L+U5ZueIGl0ZW1faWTigJTigJTlt7LnlKjmupDnoIHmoLjlrp7vvJpIb1lvLkdhY2hhIOeahFxuICAgICAgLy8gYGNyYXRlcy91cmxfc2NyYXBlci9zcmMvdHlwZXMucnM6MTUwYCDmmK8gYGl0ZW1faWQ6IE9wdGlvbjx1MzI+YO+8jFxuICAgICAgLy8g5LiUIGBoYXNfaXRlbV9pZCgpYCDnmoQgZG9jIGNvbW1lbnQg55u05LmmIFwiRXhjZXB0IGZvciAnR2Vuc2hpbiBJbXBhY3QnXCLjgIJcbiAgICAgIC8vXG4gICAgICAvLyDlm6DmraTov5nph4znmoQgaXRlbUlkIOaYryoq5Li05pe25YC877ya5pys5Zyw5YyW54mp5ZOB5ZCNKirvvIzkuI3mmK/nnJ/mraPnmoTnianlk4HmoIfor4bjgIJcbiAgICAgIC8vIOWQjuaenOW/hemhu+ivtOa4healmu+8jOWQpuWImeS4i+S4gOS4quivu+i/meauteS7o+eggeeahOS6uuS8muS7peS4uuWug+W3sue7j+WvueS6hu+8mlxuICAgICAgLy8gICDikaAgaXRlbV9jYXRhbG9nIOS4u+mUruaYryAocGx1Z2luX2lkLCBpdGVtX2lkLCBsYW5nKeOAgml0ZW1JZCDoi6XmmK/mnKzlnLDljJblkI3vvIxcbiAgICAgIC8vICAgICAg5ZCM5LiA5Liq6KeS6Imy5ZyoIHpoLWNuIOS4jiBlbi11cyDkuIvkvJrkuqflh7rkuKTkuKrkuI3lkIznmoQgaXRlbV9pZO+8jOi3qOivreiogOiBmuWQiOWkseaViO+8m1xuICAgICAgLy8gICDikaEgYGdhY2hhX3JlY29yZC5sYW5nYCDov5nkuIDliJfnmoTorr7orqHmhI/lm77vvIhyZXNlYXJjaC8wNSDCpzIuMu+8ieato+aYr1xuICAgICAgLy8gICAgICDjgIxuYW1l4oaSaXRlbV9pZCDlj43mn6Xkvp3otZYgbG9jYWxl77yM5a2X5YW45pu05paw5ZCO6KaB6IO96YeN5pS+5qCh5q2j44CN4oCU4oCUXG4gICAgICAvLyAgICAgIOiAjOWPjeafpei/meS4gOatpeeOsOWcqOagueacrOayoeWPkeeUn++8m1xuICAgICAgLy8gICDikaIg5pu06KaB5ZG955qE5pivIG5hbWUg5LiOIHJhcml0eSDpg73mnInlgLzvvIzlvZLkuIDljJblsYLmjInnjrDmnInop4TliJnkvJrmiorov5nnsbvorrDlvZXmoIfmiJBcbiAgICAgIC8vICAgICAgbWV0YV9zdGF0ZT0nY29tcGxldGUn77yM5LqO5pivIGlkeF9yZWNvcmRfbWV0YV9wZW5kaW5nIOmCo+adoemDqOWIhue0ouW8lVxuICAgICAgLy8gICAgICDmsLjov5zmiavkuI3liLDlroPku6zigJTigJQqKumUmeeahOaVsOaNruiiq+agh+iusOS4uuWujOaVtO+8jOayoeacieS7u+S9leacuuWItuS8muadpee6oOatoyoq44CCXG4gICAgICAvL1xuICAgICAgLy8g5LiN5Zyo5pysIFN0YWdlIOe8lumAoCBtZXRhZGF0YS5wYXJzZVJlc3BvbnNl77yIVUlHRiDlrZflhbggQVBJIOeahOWTjeW6lOW9oueKtuWwmuacqlxuICAgICAgLy8g55So55yf5a6e5a6e546w5qCh5YeG77yM56Gs57qm5p2f56aB5q2i5pyq5qCh5YeG5bCx5YaZ5a6e546w77yJ44CC5L2G6L+Z5Liq57y65Y+j5LiN6IO95YGc5Zyo5rOo6YeK6YeM77yaXG4gICAgICAvLyDlt7LliJfkuLogTTEtUzMg5b2S5LiA5YyW5bGC5LiOIE0xLVM1IOWFg+aVsOaNrua2iOi0ueeahOmYu+Whnumhue+8jOingVxuICAgICAgLy8gYG1pbGVzdG9uZXMvMDItTTEt5Y6f56We5o+S5Lu25YWo6ZO+6LevLm1kYCBTM+OAgVM1IOeahCBjaGVja2xpc3TjgIJcbiAgICAgIGNvbnN0IGl0ZW1JZCA9IG5hbWUgPz8gc3RhYmxlSWQ7XG4gICAgICBpZiAoIWl0ZW1JZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLljp/npZ4gZXh0cmFjdFJlY29yZO+8muiusOW9leaXouaXoCBuYW1lIOS5n+aXoCBpZO+8jOaXoOazleehruWumiBpdGVtSWRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGl0ZW1JZCxcbiAgICAgICAgdGltZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQudGltZSkgPz8gXCJcIixcbiAgICAgICAgLy8g5L+d55WZ5q+P5p2h6K6w5b2V6Ieq5bex55qE5Y6f5aeLIGdhY2hhX3R5cGXvvIjogIzkuI3mmK/mnKzmrKHmn6Xor6LnlKjnmoTmsaDlrZAgaWTvvInigJTigJRcbiAgICAgICAgLy8gMzAxIOWIhue7hOmHjOa3t+aciSBnYWNoYV90eXBlOiBcIjQwMFwiIOeahOiusOW9leaYr+WOn+elnueahOecn+WunuihjOS4ulxuICAgICAgICAvLyDvvIhyZXNlYXJjaC8wMyDCpzIuMu+8jDYxNzAg5p2h57uE5YaF5re35pyJ5Lik56eN5Y+W5YC877yJ77yM5b+F6aG75Y6f5qC35L+d55WZ5omN6IO96K6pXG4gICAgICAgIC8vIHBpdHlHcm91cHMg55qEIDMwMS80MDAg5ZCI5bm255Sf5pWI77yM5Lmf5piv55WZ5bqV44CB5Y+v6YeN5pS+55qE5YmN5o+Q44CCXG4gICAgICAgIGJhbm5lcklkOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5nYWNoYV90eXBlKSA/PyBcIlwiLFxuICAgICAgICBjb3VudDogdG9Db3VudChyZWNvcmQuY291bnQpLFxuICAgICAgICBuYW1lLFxuICAgICAgICBpdGVtVHlwZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaXRlbV90eXBlKSxcbiAgICAgICAgcmFyaXR5OiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5yYW5rX3R5cGUpLFxuICAgICAgICBzdGFibGVJZCxcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcblxuICBiYW5uZXJzOiBbXG4gICAgeyBpZDogXCIzMDFcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuinkuiJsua0u+WKqOeliOaEv1wiIH0gfSxcbiAgICB7IGlkOiBcIjMwMlwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5q2m5Zmo5rS75Yqo56WI5oS/XCIgfSB9LFxuICAgIHsgaWQ6IFwiMjAwXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLluLjpqbvnpYjmhL9cIiB9IH0sXG4gICAgeyBpZDogXCI1MDBcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIumbhuW9leeliOaEv1wiIH0gfSxcbiAgICB7IGlkOiBcIjEwMFwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5paw5omL56WI5oS/XCIgfSB9LFxuICAgIC8vIDQwMCDkuI3mmK/kuIDkuKrlj6/ljZXni6zmn6Xor6LnmoTmsaDlrZDvvIjkuI3kvJrku6UgNDAwIOS9nOS4uuWNoeaxoOWPluWAvOWPkei1t+ivt+axgu+8ie+8jFxuICAgIC8vIOS9huWug+aYryAzMDEg5ZON5bqU6YeM55yf5a6e5Ye6546w55qEIGdhY2hhX3R5cGUg5Y+W5YC877yM5b+F6aG75aOw5piO5Li654us56uLIEJhbm5lclNwZWPvvIxcbiAgICAvLyBwaXR5R3JvdXBzW10ubWVtYmVycyDmiY3og73lkIjms5XlvJXnlKjlroPigJTigJTlkKbliJkgYmFubmVySWQ9XCI0MDBcIiDnmoTorrDlvZXkvJrmjIflkJFcbiAgICAvLyDkuIDkuKrkuI3lrZjlnKjnmoQgQmFubmVyU3BlY++8jOingeacrOaWh+S7tuacq+WwvuOAjOWBj+W3ruS4juWPkeeOsOOAjeivtOaYjuOAglxuICAgIHsgaWQ6IFwiNDAwXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLop5LoibLmtLvliqjnpYjmhL/vvIg0MDAg5a2Q57G75Z6L77yM6ZqPIDMwMSDkuIDlubbov5Tlm57vvIlcIiB9IH0sXG4gIF0sXG5cbiAgcGl0eUdyb3VwczogW1xuICAgIHtcbiAgICAgIGtleTogXCJjaGFyYWN0ZXJFdmVudFdpc2hcIixcbiAgICAgIG1lbWJlcnM6IFtcIjMwMVwiLCBcIjQwMFwiXSxcbiAgICAgIGhhcmRQaXR5OiA5MCxcbiAgICAgIC8vIGJhc2Uvc3RhcnQg5Y+W6Ieq5YWs5byA55qE56WI5oS/5qaC546H6K+05piO77ybNzQg5oq96LW357q/5oCn5o+Q5Y2H44CBODYg5oq95aSW5Z+65pys5bCB6aG277yMXG4gICAgICAvLyA5MCDmir3lv4Xlh7rigJTigJRzdGVwIOmHh+eUqOWQjOS6uuekvuWMuuW5v+azm+W8leeUqOeahOOAjDc0IOaKvei1t+avj+aKvSArNiXjgI3lj6PlvoTjgIJcbiAgICAgIGN1cnZlOiB7IGtpbmQ6IFwic29mdFBpdHlcIiwgYmFzZTogMC4wMDYsIHN0YXJ0OiA3NCwgc3RlcDogMC4wNiB9LFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gICAgfSxcbiAgXSxcblxuICByYXJpdHk6IHtcbiAgICBsYWRkZXI6IFtcIjNcIiwgXCI0XCIsIFwiNVwiXSxcbiAgICBwaXR5VGFyZ2V0OiBcIjVcIixcbiAgICB0aWVyTGFiZWxzOiB7XG4gICAgICBcIjNcIjogeyBcInpoLUNOXCI6IFwi5LiJ5pifXCIgfSxcbiAgICAgIFwiNFwiOiB7IFwiemgtQ05cIjogXCLlm5vmmJ9cIiB9LFxuICAgICAgXCI1XCI6IHsgXCJ6aC1DTlwiOiBcIuS6lOaYn1wiIH0sXG4gICAgfSxcbiAgfSxcblxuICB0aW1lOiB7IHRpbWV6b25lU291cmNlOiB7IGtpbmQ6IFwiY29tcHV0ZWRcIiB9IH0sXG5cbiAgcHJlY29uZGl0aW9uczogW1xuICAgIHtcbiAgICAgIGlkOiBcImdlbnNoaW4uY3JlZGVudGlhbC5jYWNoZURpckV4aXN0c1wiLFxuICAgICAgY2FwYWJpbGl0eTogXCJjcmVkZW50aWFsXCIsXG4gICAgICBsZXZlbDogXCJyZXF1aXJlZFwiLFxuICAgICAgZGVzY3JpYmU6IHtcbiAgICAgICAgXCJ6aC1DTlwiOiBcIuiHquWKqOiOt+WPluaKveWNoemTvuaOpeimgeaxgua4uOaIj+WuouaIt+err+iHs+Wwkei/kOihjOi/h+S4gOasoe+8jOe8k+WtmOebruW9leaJjeS8muiiq+WIm+W7ulwiLFxuICAgICAgfSxcbiAgICAgIC8vIEhvc3RFbnYg55uu5YmN5Y+q5pyJIGdhbWVDbGllbnRTaXplIC8gaW5zdGFsbGVkRGVwZW5kZW5jaWVzIOS4pOS4quWtl+aute+8jOacquaQuuW4plxuICAgICAgLy8g44CMY3JlZGVudGlhbC5nYW1lRGlyIOWjsOaYjueahOe8k+WtmOebruW9leaYr+WQpuW3suiiq+ingua1i+WIsOOAjei/meS4gOS6i+WunuKAlOKAlOi/meato+aYr1xuICAgICAgLy8gZml4dHVyZSDlpZHnuqbmtYvor5XpmLbmrrXlsLHog73lj5HnjrDnmoTlpZHnuqbnvLrlj6PvvIzkuI3mmK/ov5DooYzml7bmiY3mmrTpnLLjgILop4Hmlofku7bmnKvlsL5cbiAgICAgIC8vIOOAjOWBj+W3ruS4juWPkeeOsOOAje+8jOeVmee7mSBncy1ob3N0IOaJqeWxlSBIb3N0RW52IOaXtuihpeS4iuOAglxuICAgICAgY2hlY2s6ICgpID0+ICh7IGtpbmQ6IFwidW5rbm93blwiIH0pLFxuICAgICAgcmVtZWR5OiB7IFwiemgtQ05cIjogXCLor7flhYjlkK/liqjmuLjmiI/lubbmiZPlvIDkuIDmrKHmir3ljaHorrDlvZXpobXvvIzlho3lm57liLDmnKzlupTnlKjph43or5VcIiB9LFxuICAgIH0sXG4gIF0sXG5cbiAgYmFzZWxpbmU6IHsga2luZDogXCJpbkdhbWVQYWdlQ291bnRcIiB9LFxuXG4gIHJldGVudGlvbjoge1xuICAgIGRpc3BsYXlUZXh0OiB7IFwiemgtQ05cIjogXCI2IOS4quaciFwiIH0sXG4gICAgY29uc2VydmF0aXZlRGF5czogNiAqIDI4LFxuICB9LFxuXG4gIC8vIOKaoO+4jyDljp/npZ4gQVBJIOS4jei/lOWbniBpdGVtX2lk77yMZXh0cmFjdFJlY29yZCDnmoQgaXRlbUlkIOaYr+acrOWcsOWMlueJqeWTgeWQjVxuICAvLyDvvIjop4HkuIrmlrkgZXh0cmFjdFJlY29yZCDlhoXnmoTor6bnu4bor7TmmI7kuI4gTTEtUzMg6Zi75aGe6aG55byV55So77yJ44CC5aOw5piO6L+Z5Liq5L+h5Y+3XG4gIC8vIOWQju+8jOWuv+S4u+eahOW9kuS4gOWMluWxguS8muaKiui/meexu+iusOW9leagh+aIkCBtZXRhX3N0YXRlPSdwZW5kaW5nJ++8jOiAjOS4jeaYr+WboOS4ulxuICAvLyBuYW1lL3Jhcml0eSDpg73mnInlgLzlsLHor6/liKTmiJAgY29tcGxldGXigJTigJTplJnnmoQgaXRlbV9pZCDkuI3or6XooqvmoIforrDkuLrlrozmlbTjgIJcbiAgaXRlbUlkU291cmNlOiBcImRpc3BsYXlOYW1lXCIsXG5cbiAgLy8g5Zue5aGr5L6n77ya5Y+N5p+lIGl0ZW1JZFNvdXJjZTogXCJkaXNwbGF5TmFtZVwiIOagh+aIkCBwZW5kaW5nIOeahOiusOW9le+8jOaKilxuICAvLyBleHRyYWN0UmVjb3JkIOWhq+i/myBpdGVtSWQg6YeM55qE5pys5Zyw5YyW54mp5ZOB5ZCN5o2i5oiQ55yf5q2j55qE54mp5ZOB5qCH6K+G44CCXG4gIC8vIOW3sueUqOecn+WunuWunueOsOagoeWHhu+8iOingSBwYXJzZVVpZ2ZEaWN0UmVzcG9uc2Ug5LiOIE1ldGFkYXRhUHJvdmlkZXJDb25maWdcbiAgLy8g55qE5paH5qGj77yJ77yM5LiN5piv5pyq5qCh5YeG55qE54yc5rWL44CCXG4gIG1ldGFkYXRhOiB7XG4gICAga2luZDogXCJvbmxpbmVcIixcbiAgICBkaXJlY3Rpb246IFwibmFtZVRvSWRcIixcbiAgICByZXF1ZXN0OiB7XG4gICAgICAvLyBge3tsYW5nfX1gIOeUseWuv+S4u+aMieW+heWbnuWhq+iusOW9leeahCBnYWNoYV9yZWNvcmQubGFuZyDovazmjaLmiJAgYXBpLnVpZ2Yub3JnXG4gICAgICAvLyDoh6rlt7HnmoTor63oqIDnn63noIHlkI7mm7/mjaLvvIjovazmjaLooajop4EgZ3NfaG9zdDo6bWV0YWRhdGFfYmFja2ZpbGwg5qih5Z2X77yM5pivXG4gICAgICAvLyBcIui/meS4quWFt+S9k+aOpeWPo1wi55qE55+l6K+G77yM5LiN5piv5ri45oiP55+l6K+G77yM5LiN5Zyo6L+Z6YeM5aOw5piO77yJ44CCXG4gICAgICB1cmw6IFwiaHR0cHM6Ly9hcGkudWlnZi5vcmcvZGljdC9nZW5zaGluL3t7bGFuZ319Lmpzb25cIixcbiAgICB9LFxuICAgIHBhcnNlUmVzcG9uc2U6IHBhcnNlVWlnZkRpY3RSZXNwb25zZSxcbiAgfSxcbn0gc2F0aXNmaWVzIFBsdWdpbk1hbmlmZXN0O1xuIiwiLyoqXG4gKiDmmJ/pk4Hmj5Lku7bnmoTpgIPnlJ/oiLEgaG9va3PjgIJcbiAqXG4gKiDlj6rpnIDopoEgYGRlcml2ZVJlY29yZEtleWAg5LiA5LiqIGhvb2vvvJpcbiAqIC0gYHJlc29sdmVUaW1lem9uZWAg5LiN6ZyA6KaB4oCU4oCUYG1hbmlmZXN0LnRzYCDnmoQgYHRpbWUudGltZXpvbmVTb3VyY2Uua2luZGAg5pivXG4gKiAgIGBcImFwaUZpZWxkXCJg77yM5LiN5pivIGBcImNvbXB1dGVkXCJg77yM5a6/5Li755u05o6l5LuO5ZON5bqU5L2T6aG157qn5a2X5q61XG4gKiAgIGByZWdpb25fdGltZV96b25lYCDor7vlj5blgY/np7vph4/vvIzkuI3nu4/ov4fmnKzmj5Lku7bnmoTku7vkvZXlh73mlbDvvIjop4EgYG1hbmlmZXN0LnRzYFxuICogICBgdGltZWAg5a2X5q615peB55qE5rOo6YeK77yJ44CCXG4gKiAtIGBkZXJpdmVSZWNvcmRLZXlgIOW/hemhu+WunueOsO+8jOS4jeiDveecgeeVpe+8muaYn+mTgeiBlOWKqOaxoO+8iDIxLzIy77yJ6LWw54us56uL56uv54K5XG4gKiAgIGBnZXRMZEdhY2hhTG9nYO+8jOacjeWKoeerr+mbquiKsSBJRCDnmoTlkb3lkI3nqbrpl7TlnKjot6jnq6/ngrnlnLrmma/kuIvkuI3kv53or4HpmpTnprvigJTigJRcbiAqICAg6KO455SoIGBzdGFibGVJZGAg5Lya5pKe6ZSu77yM5YaZ5YWl5bGCIGBJTlNFUlQgT1IgSUdOT1JFYCDkvJrmiormkp7plK7orrDlvZUqKumdmem7mFxuICogICDkuKLlvIMqKu+8jOeUqOaIt+WPquS8muWPkeeOsOOAjOWwkeS6huS4gOadoeOAje+8jOS4lOaXoOazleWumuS9jeaYr+WTquS4gOadoeOAguWBmuazleS4jlxuICogICBgcGx1Z2lucy9nZW5zaGluL2hvb2tzLnRzYCDlrozlhajkuIDoh7TvvIjlkIzmoLfmmK/nsbPlk4jmuLjmnI3liqHnq6/pm6roirEgSUQg5Zy65pmv77yMXG4gKiAgIGBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L21hbmlmZXN0LnRzYCDnmoQgYFBsdWdpbkhvb2tzLmRlcml2ZVJlY29yZEtleWBcbiAqICAg5paH5qGj5piO56Gu54K55ZCNXCLnsbPlk4jmuLjkuInmuLjkuI3lvpfnvLrnnIHmnKwgaG9va1wi77yJ77yaYGAgYCR7YmFubmVySWR9OiR7c3RhYmxlSWR9YCBgYO+8jFxuICogICDmiorljaHmsaDnu7Tluqblubbov5vlpI3lkIjplK7vvIzlj4LogIPlrp7njrAgSG9Zby5HYWNoYSDkuIrnur/kuIDlubTlkI7kuLrmmJ/pk4HogZTliqjmsaDnmoTov5nkuKpcbiAqICAg6Zeu6aKY5LuY5Ye66L+H5LiA5qyh5pW06KGo6YeN5bu66L+B56e777yM5pys5o+S5Lu25LuO56ys5LiA5aSp5bCx5oyJ5aSN5ZCI6ZSu5a6e546w77yM5LiN55WZ5ZCM5qC355qE5Z2R44CCXG4gKi9cbmltcG9ydCB0eXBlIHsgUGx1Z2luSG9va3MgfSBmcm9tIFwiZ3MtcGx1Z2luLWtpdFwiO1xuXG5leHBvcnQgY29uc3QgaG9va3M6IFBsdWdpbkhvb2tzID0ge1xuICBkZXJpdmVSZWNvcmRLZXk6IChyZWNvcmQpID0+IHtcbiAgICBpZiAoIXJlY29yZC5zdGFibGVJZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGDmmJ/pk4HorrDlvZXnvLrlsJEgc3RhYmxlSWTvvIjmnI3liqHnq6/pm6roirEgSUTvvInvvIzml6Dms5XnlJ/miJDnqLPlrprnmoQgcmVjb3JkX2tlee+8mml0ZW1JZD1cIiR7cmVjb3JkLml0ZW1JZH1cImApO1xuICAgIH1cbiAgICByZXR1cm4gYCR7cmVjb3JkLmJhbm5lcklkfToke3JlY29yZC5zdGFibGVJZH1gO1xuICB9LFxufTtcbiIsIi8qKlxuICog5bSp5Z2P77ya5pif56m56ZOB6YGT5o+S5Lu2IG1hbmlmZXN044CCXG4gKlxuICog6YeH6ZuG6IyD5byP77yaY3JlZGVudGlhbGVkQXBp77yIYGdzLXAtYXV0aGtleWDvvInvvIzkuI7ljp/npZ7lkIzmupDigJTigJTlh63mja7mnaXoh6rmuLjmiI/lhoXnva5cbiAqIENocm9taXVtIOe7hOS7tueahOejgeebmOe8k+WtmO+8iOeOqeWutuaJk+W8gOi3g+i/geiusOW9lemhteaXtu+8jHdlYnZpZXcg5Lya5ZG95Lit5a6Y5pa5XG4gKiBgZ2V0R2FjaGFMb2dgIOaOpeWPo+W5tuW4puS4iiBhdXRoa2V577yM6JC95ZyoIGB3ZWJDYWNoZXNgIOebruW9leS4i+afkOS4queJiOacrOWPt+WtkOebruW9leeahFxuICogYENhY2hlL0NhY2hlX0RhdGEvZGF0YV8yYCDntKLlvJXmlofku7bph4zvvInjgIJcbiAqXG4gKiDmnKzmlofku7bnlLEgTTEtUzcg57q46Z2i5aGr6KGo5ryU57uD6I2J56i/IGBkcmlsbHMvc3RhcnJhaWwvbWFuaWZlc3QudHNgIOi9rOWMluiAjOadpeKAlOKAlFxuICog5ryU57uD6aqM6K+B55qE5pivXCJTMiDmlLnov4fnmoTmj5Lku7blpZHnuqbnsbvlnovmmK/lkKboo4XlvpfkuIvmmJ/pk4HnmoTnnJ/lrp7lt67lvILngrlcIu+8jOacrOaWh+S7tuaYr+aKilxuICog6aqM6K+B57uT6K666JC95Zyw5oiQ55yf5q2j5o6l5YWlIGBwbHVnaW5zL2luZGV4LnRzYCDnmoTlj6/ov5DooYzmj5Lku7bvvIjmnKzmrKHmlLnliqjojIPlm7TkuI3lkKtcbiAqIGBwbHVnaW5zL2luZGV4LnRzYCDnmoTms6jlhozvvIznlLHkuLvov5vnqIvnu5/kuIDlpITnkIbvvInjgILojYnnqL/ph4znmoTku6XkuIvlhoXlrrnlt7Lpmo/mnKzmrKFcbiAqIOi9rOWMlui/h+acn+OAgeS4jeWGjeeFp+aKhO+8mlxuICogICAtIGBhbGxvd2VkSG9zdHNgIOWNoOS9jeWfn+WQjSDihpIg5o2i5oiQ5LiL5pa555yf5a6e5qC45a6e55qE5Lik5LiqIGhvc3RcbiAqICAgLSBcImBlbmRwb2ludE92ZXJyaWRlYCDku47mnKrooqsgYGJ1aWxkX3BhZ2VfdXJsYCDor7vlj5ZcIlwiYXBpRmllbGQg5YiG5pSv6KKr5qCHXG4gKiAgICAgYCNbYWxsb3coZGVhZF9jb2RlKV1gXCIg4oaSIOWdh+aYryBNMS1TNyDml7bnmoTnirbmgIHvvIxNMiDlt7Llhajpg6jlrp7oo4XvvIzmnKzmlofku7bkuI3lho1cbiAqICAgICDlpI3ov7Dov4fmnJ/mj4/ov7BcbiAqICAgLSDmlrDlop4gYHBpdHlHcm91cHNg44CBYGhvb2tzLnRzYO+8iOiNieeov+WIu+aEj+S4jeWhq++8jOeQhueUseW3sumaj+S/neW6leaVsOWAvOWIsOS9jeiAjOWkseaViO+8iVxuICogICAtIOaYvuW8j+WGs+etliBgYmFubmVySWRlbnRpdHlgIOS4jeWjsOaYju+8iOingeS4i+aWuSBjb2xsZWN0LnBhcmFtcyDlhoXms6jph4rvvIlcbiAqICAgLSDmlrDlop4gYHJhdGVMaW1pdGAg5pi+5byP5aOw5piOXG4gKlxuICog5pWw5o2u5p2l5rqQ77yI5LiN5Yet6K6t57uD6K6w5b+G57yW6YCg5a2X5q615ZCNL+aVsOWAvO+8ie+8mlxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDItNDZgXG4gKiAgIO+8iGhvc3Qg5LiO56uv54K56Lev5b6E5YmN57yA77yaYHB1YmxpYy1vcGVyYXRpb24taGtycGcubWlob3lvLmNvbWAgL1xuICogICBgcHVibGljLW9wZXJhdGlvbi1oa3JwZy1zZy5ob3lvdmVyc2UuY29tYO+8jOi3r+W+hOWJjee8gFxuICogICBgL2NvbW1vbi9oa3JwZ19nYWNoYV9yZWNvcmQvYXBpL2DvvIxgZ2V0R2FjaGFMb2dgL2BnZXRMZEdhY2hhTG9nYCDnq6/ngrnlkI3vvIlcbiAqIC0gYGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9zdGFyLXJhaWwtd2FycC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczoyMTYtMjM0YFxuICogICDvvIhgWycyMScsJzIyJ10uaW5jbHVkZXMoa2V5KSA/ICdnZXRMZEdhY2hhTG9nJyA6ICdnZXRHYWNoYUxvZydgIOeahOerr+eCuemAieaLqemAu+i+ke+8m1xuICogICDor6Xlj4LogIPlrp7njrDnlKjnmoTot6/lvoTliY3nvIDmmK8gYC9jb21tb24vZ2FjaGFfcmVjb3JkL2FwaS9g77yM5LiOIEhvWW8uR2FjaGEg55qEXG4gKiAgIGAvY29tbW9uL2hrcnBnX2dhY2hhX3JlY29yZC9hcGkvYCDkuI3lkIzigJTigJTmnKzmj5Lku7bkuI3mlLnlhpnot6/lvoTliY3nvIDvvIzkuKTlpZflhpnms5VcbiAqICAg6YO95LiN5Lya6Lip5Yiw77yM6KeB5LiL5pa5IHJlcXVlc3QudXJsIOazqOmHiu+8ieOAgWA6MjIzLTIyNWDvvIhgc2xlZXAoMC4zKWAg5q+P6aG15bu26L+fICtcbiAqICAg5rOo6YeK5o6J55qE5q+PIDEwIOmhtSBgc2xlZXAoMSlgIOaJuemHj+WBnOmhvyArIGByZXRyeUNvdW50OiA1YO+8ieOAgWA6MjI2LTIzNGBcbiAqICAg77yI5ZON5bqU5L+h5bCBIGByZXMuZGF0YWAg5LiLIGBsaXN0YC9gcmVnaW9uYC9gcmVnaW9uX3RpbWVfem9uZWAg5ZCM57qn77yJ44CBXG4gKiAgIGA6NDUxLTQ1MmDvvIjmnKzlnLDlrZjmoaPlrZfmrrXvvJrku4Xkv53nlZkgOSDplK7vvIxgdWlkYC9gbGFuZ2Ag6KKr5Lii5byD77yM6K+B5piO55yf5a6eIEFQSVxuICogICDorrDlvZXmnKzouqvmkLrluKbov5nkuKTkuKrlrZfmrrXigJTigJTkuI7kuIvmlrnjgIwxMSDplK7jgI3nmoTku7vliqHnroDmiqXlj6PlvoTkupLnm7jljbDor4HvvIlcbiAqIC0gYGRvY3MvX2ludGVybmFsL3Jlc2VhcmNoLzAzLeecn+WunuWvvOWHuuaVsOaNruagvOW8j+Wunua1iy5tZGAgwqcxLjLvvIhgZ2FjaGFfaWRg77yJXG4gKiAgIMKnMS4z77yI5YWD5pWw5o2u57y65aSx55yf5a6e5qC35L6L77yMYGl0ZW1faWRgIOaYr+WUr+S4gOS/neivgemdnuepuueahOmUmueCue+8icKnMi4x77yIdHlwZU1hcO+8iVxuICogICDCpzIuM++8iGByZWdpb25fdGltZV96b25lYCDmmK/pobXnuqflrZfmrrXvvIzkuI3mmK/pgJDmnaHorrDlvZXlrZfmrrXvvIlcbiAqIC0g5a6Y5pa55L+d5bqV5qaC546H5YWs56S6IEpTT07vvIhgb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vaGtycGcvXG4gKiAgIHByb2RfZ2ZfY24vPGJhbm5lcklkPi96aC1jbi5qc29uYO+8ieKAlOKAlCoq5bey55Sx5Li76L+b56iL5Zyo5Lu75Yqh566A5oql6Zi25q6154us56uL5qC46aqMKirvvIxcbiAqICAg5pysIEFnZW50IOS8muivneacqumHjeaWsOaKk+WPlu+8jGBwaXR5R3JvdXBzYCDph4zpgJDnu4TmoIfms6jkuobov5nmnaHovrnnlYzjgIJcbiAqIC0gYHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50c2AgLyBgcGx1Z2lucy93dXdhL21hbmlmZXN0LnRzYO+8iOWQjOaXj+W3suiQveWcsOaPkuS7tu+8jFxuICogICDlhpnms5XkuI7ms6jph4rlr4bluqblr7npvZDvvIlcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqXG4gKiDku44gYGdldEdhY2hhTG9nYC9gZ2V0TGRHYWNoYUxvZ2Ag5ZON5bqU5L2T6YeM5Y+W5Ye65pys6aG16K6w5b2V5pWw57uE44CCXG4gKlxuICog55yf5a6e5ZON5bqU5b2i5oCB5pivIGB7IHJldGNvZGUsIG1lc3NhZ2UsIGRhdGE6IHsgbGlzdDogWy4uLl0sIHJlZ2lvbiwgcmVnaW9uX3RpbWVfem9uZSB9IH1gXG4gKiDigJTigJTkuI7ljp/npZ7lkIzmnoTvvIxgcmVnaW9uYC9gcmVnaW9uX3RpbWVfem9uZWAg5LiOIGBsaXN0YCDlkIznuqfvvIzmmK/pobXnuqflhYPmlbDmja7vvIxcbiAqIOS4jeaYr+mAkOadoeiusOW9leWtl+aute+8iGByZXNlYXJjaC8wM2AgwqcyLjPvvJtgc3Rhci1yYWlsLXdhcnAtZXhwb3J0L3NyYy9tYWluL1xuICogZ2V0RGF0YS5qczoyMjYtMjM0YCDnmoQgYGNvbnN0IHsgbGlzdCwgdWlkLCByZWdpb24sIHJlZ2lvbl90aW1lX3pvbmUgfSA9XG4gKiBhd2FpdCBnZXRHYWNoYUxvZ3MoLi4uKWAg5Y2w6K+B5LiJ6ICF5LuO5ZCM5LiA5LiqIGByZXM/LmRhdGFgIOWvueixoeino+aehOiAjOadpe+8ieOAglxuICog6Ziy5b6h5byP6Kej5p6Q77ya5Lu75L2V5LiA5bGC5b2i54q25LiN5a+55bCx6L+U5Zue56m65pWw57uE6ICM5LiN5piv5oqb5byC5bi44oCU4oCU5YiG6aG15byV5pOO5Lya5oqK56m65pWw57uEXG4gKiDlvZPkvZwgYGVtcHR5UGFnZWAg57uI5q2i5p2h5Lu25aSE55CG77yM5q+U6K6p5LiA5qyh5YG25Y+R55qE55W45b2i5ZON5bqU5Lit5pat5pW05p2h6YeH6ZuG5rWB56iL5pu05a6J5YWo44CCXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RHYWNoYUxvZ0xpc3QocmVzcG9uc2U6IHVua25vd24pOiB1bmtub3duW10ge1xuICBpZiAodHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiIHx8IHJlc3BvbnNlID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGRhdGEgPSAocmVzcG9uc2UgYXMgeyBkYXRhPzogdW5rbm93biB9KS5kYXRhO1xuICBpZiAodHlwZW9mIGRhdGEgIT09IFwib2JqZWN0XCIgfHwgZGF0YSA9PT0gbnVsbCkgcmV0dXJuIFtdO1xuICBjb25zdCBsaXN0ID0gKGRhdGEgYXMgeyBsaXN0PzogdW5rbm93biB9KS5saXN0O1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShsaXN0KSA/IGxpc3QgOiBbXTtcbn1cblxuLyoqIOWPr+mAieS9huS4jeaOpeWPl+epuuS4suKAlOKAlOepuuS4suW/hemhu+iiq+W9k+aIkOOAjOayoeacieWAvOOAje+8jOS4jeiDveWGkuWFheOAjOacieWAvOOAjeOAgiAqL1xuZnVuY3Rpb24gdG9Ob25FbXB0eVN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0cmltbWVkIDogdW5kZWZpbmVkO1xufVxuXG4vKiog5a6Y5pa55ZON5bqU6YeM55qEIGBjb3VudGAg5piv5pWw5a2X5a2X56ym5Liy77yI5aaCIGBcIjFcImDvvInvvIzpmLLlvqHlvI/ovazmjaLvvIzlvILluLjovpPlhaXlhZzlupXkuLogMeOAgiAqL1xuZnVuY3Rpb24gdG9Db3VudCh2YWx1ZTogdW5rbm93bik6IG51bWJlciB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgcGFyc2VkID0gTnVtYmVyKHZhbHVlKTtcbiAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiBwYXJzZWQ7XG4gIH1cbiAgcmV0dXJuIDE7XG59XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8g5L+d5bqV77yaNeKYhSDova/kv53lupXmm7Lnur/nmoTkuKTlpZfnpL7ljLrmjqjnrpflj6PlvoRcbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIOKaoO+4jyAqKmJhc2UgLyBoYXJkUGl0eSAvIGd1YXJhbnRlZSDmnaXoh6rlrpjmlrnlhaznpLogSlNPTu+8iOW3sueUseS4u+i/m+eoi+aguOmqjO+8ie+8jFxuLy8gY3VydmUg55qEIHN0YXJ0IC8gc3RlcCDlrpjmlrnku47mnKrlhaznpLrvvIzmmK/lkIzkurrnpL7ljLrlj6PlvoTnmoTmjqjnrpflgLzvvIzkuI3lkIzmnaXmupDlnKhcbi8vIDczfjc1IOS5i+mXtOS4jeS4gOiHtCoq4oCU4oCU5qCH5rOo5pa55byP5a+56b2QIGBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHM6MTYxLTE2NGBcbi8vIOeahOWQjOasvuWFiOS+i++8jOS4jeaKiuaOqOeul+WAvOivtOaIkOWumOaWueaVsOWAvOOAglxuXG4vKiog6KeS6Imy57G75rGg77yI56Gs5L+d5bqVIDkw77yJ55qE6L2v5L+d5bqV5puy57q/77yaNzQg5oq96LW344CB5q+P5oq9ICs2Je+8jOWQjOS6uuekvuWMuuWPo+W+hOOAgiAqL1xuY29uc3QgQ0hBUkFDVEVSX1NPRlRfUElUWV9DVVJWRSA9IHtcbiAga2luZDogXCJzb2Z0UGl0eVwiIGFzIGNvbnN0LFxuICBiYXNlOiAwLjAwNixcbiAgc3RhcnQ6IDc0LFxuICBzdGVwOiAwLjA2LFxufTtcblxuLyoqIOWFiemUpeexu+axoO+8iOehrOS/neW6lSA4MO+8ieeahOi9r+S/neW6leabsue6v++8muaMieinkuiJsuaxoOWPo+W+hOetieavlOS+i+WkluaOqO+8jDY1IOaKvei1t+OAgeavj+aKvSArNyXjgIIgKi9cbmNvbnN0IExJR0hUX0NPTkVfU09GVF9QSVRZX0NVUlZFID0ge1xuICBraW5kOiBcInNvZnRQaXR5XCIgYXMgY29uc3QsXG4gIGJhc2U6IDAuMDA4LFxuICBzdGFydDogNjUsXG4gIHN0ZXA6IDAuMDcsXG59O1xuXG5leHBvcnQgY29uc3QgbWFuaWZlc3QgPSB7XG4gIGlkOiBcInN0YXJyYWlsXCIsXG4gIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLltKnlnY/vvJrmmJ/nqbnpk4HpgZNcIiB9LFxuICBzZGtWZXJzaW9uOiBcIjEuMC4wXCIsXG4gIHBsYXRmb3JtczogW1wid2luZG93c1wiXSxcbiAgbWFpbnRhaW5lcnM6IFtcImdhY2hhLXN0dWRpb1wiXSxcbiAgLy8gZXhjaGFuZ2VGb3JtYXRzIOS4jeWjsOaYju+8muaYn+mTgeeahCBVSUdGIOWtl+auteaYoOWwhOacque7j+ecn+WunuWunueOsOagoeWHhu+8jOS4jeWcqOacrOasoVxuICAvLyDmjqXlhaXojIPlm7TlhoXnvJbpgKDvvIjkuI4gZHJpbGxzL3N0YXJyYWlsL21hbmlmZXN0LnRzIOeahOaXouacieeri+WcuuS4gOiHtO+8ieOAglxuXG4gIC8vIOWbvuagh+WcsOWdgOadpeiHqiBUYXBUYXAg5bqU55So5biC5Zy66aG16Z2i77yM5bey5a6e5rWL6aqM6K+B77yM5ZCMIGBwbHVnaW5zL2dlbnNoaW4vXG4gIC8vIG1hbmlmZXN0LnRzYCDlkIzmrL7mlZnorq3igJTigJTlnLDlnYDku6UgLmpwZyDnu5PlsL7kvYblrp7pmYXlhoXlrrnmmK8gUE5H77yM5LiN6KaBXCLnuqDmraNcIlxuICAvLyDmianlsZXlkI3vvIzmoLzlvI/moKHpqozvvIhjb250ZW50LXR5cGUgKyBtYWdpYyBieXRlc++8ieaYr+Wuv+S4u+S+p+iBjOi0o+OAglxuICBpY29uVXJsOlxuICAgIFwiaHR0cHM6Ly9pbWctdGMudGFwaW1nLmNvbS9tYXJrZXQvaW1hZ2VzLzFiNzM4NWRhNWRiZjZkNTM0MmE4MzJlNjY4NWUyMDY2LnBuZy9fdGFwX2FwcGljb25fbS5qcGdcIixcblxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwiY2hyb21pdW1DYWNoZVwiLFxuICAgICAgICAvLyDnm7jlr7nniYfmrrXvvIzkuI3mmK/nu53lr7not6/lvoTigJTigJTnu53lr7nlronoo4Xnm67lvZXmnaXoh6rnlKjmiLfphY3nva7vvIznlLEgUnVzdCDkvqfmi7zmjqXjgIJcbiAgICAgICAgZ2FtZURpcjogXCJTdGFyUmFpbF9EYXRhL3dlYkNhY2hlc1wiLFxuICAgICAgICB1cmxQYXR0ZXJuOiAvaHR0cHM6XFwvXFwvLis/Z2V0R2FjaGFMb2dbXlwiXSsvLFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgLy8g4pqg77iPICoq56uv54K56Lev5b6E5YmN57yA5pyJ5Lik5aWX5YaZ5rOV77yM5pys5o+S5Lu25LiN5pS55YaZ5YmN57yAKirvvJrlj4LogIPlrp7njrBcbiAgICAgICAgLy8gc3Rhci1yYWlsLXdhcnAtZXhwb3J0IOeUqCBgL2NvbW1vbi9nYWNoYV9yZWNvcmQvYXBpL2BcbiAgICAgICAgLy8g77yIZ2V0RGF0YS5qczoyMTfvvInvvIxIb1lvLkdhY2hhIOeUqCBgL2NvbW1vbi9oa3JwZ19nYWNoYV9yZWNvcmQvYXBpL2BcbiAgICAgICAgLy8g77yIZ2FtZV9iaXovc3JjL2FwaS5yczo0Mi00Nu+8ieOAguWHreaNriBVUkwg5piv5LuO5ri45oiP57yT5a2Y6YeM5Y6f5qC35omr5Ye65p2l55qEXG4gICAgICAgIC8vIOWujOaVtOivt+axgiBVUkzvvIjlkKvnnJ/lrp7liY3nvIDvvInvvIzkuIvpnaLnmoTmqKHmnb/nlKggYHt7Y3JlZGVudGlhbH19YCDljp/kuLJcbiAgICAgICAgLy8g6L+95Yqg5YiG6aG15Y+C5pWw77yM5LiN6YeN5paw5ou86Lev5b6E4oCU4oCU5peg6K6655yf5a6e5a6i5oi356uv5ZG95Lit5ZOq5LiA5aWX5YmN57yA6YO96IO95q2j5bi4XG4gICAgICAgIC8vIOW3peS9nOOAgmBiYW5uZXJzW10uZW5kcG9pbnRPdmVycmlkZWDvvIjop4HkuIvmlrkgYmFubmVyc++8ieWPquabv+aNoiBVUkwg55qEXG4gICAgICAgIC8vIOacgOWQjuS4gOS4qui3r+W+hOaute+8iGBnZXRHYWNoYUxvZ2Ag4oaSIGBnZXRMZEdhY2hhTG9nYO+8ie+8jOWQjOagt+S4jeWFs+W/g+WJjee8gFxuICAgICAgICAvLyDmmK/lk6rkuIDlpZfvvIzkuKTnp43lhpnms5Xpg73kuI3kvJrouKnpm7fjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g5Y+C5pWw5ZCN5LiO5Y6f56We5qih5p2/5LiA6Ie077yacGFnZS9nYWNoYV90eXBlL3NpemUvZW5kX2lk77yM5p2l5rqQXG4gICAgICAgIC8vIHN0YXItcmFpbC13YXJwLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjE4OO+8iFxuICAgICAgICAvLyBgJHt1cmx9JmdhY2hhX3R5cGU9JHtrZXl9JnBhZ2U9JHtwYWdlfSZzaXplPSR7MjB9JHtlbmRJZD8nJmVuZF9pZD0nK2VuZElkOicnfWDvvInjgIJcbiAgICAgICAgdXJsOiBcInt7Y3JlZGVudGlhbH19JnBhZ2U9e3twYWdlfX0mZ2FjaGFfdHlwZT17e2dhY2hhVHlwZX19JnNpemU9e3twYWdlU2l6ZX19JmVuZF9pZD0wXCIsXG4gICAgICB9LFxuICAgICAgLy8g5Zu95pyNICsg5Zu96ZmF5pyN5Lik5LiqIGhvc3Qg6YO96KaB5pS25b2V77yM55CG55Sx5LiOIHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50c1xuICAgICAgLy8gNzktODgg6KGM5ZCM5qy+5pWZ6K6t5LiA6Ie077yadXJsUGF0dGVybiDmnKzouqvkuI3ljLrliIbln5/lkI3vvIzlj6ropoEgVVJMIOmHjOWHuueOsFxuICAgICAgLy8gXCJnZXRHYWNoYUxvZ1wiIOWwseS8muWMuemFje+8jOiLpeWPquWjsOaYjuWbveacjSBob3N077yM5Zu96ZmF5pyN546p5a6255qE5q2j5bi46K+35rGC5Lya6KKrXG4gICAgICAvLyDor6/liKTkuLrmipXmr5LogIzmi5Lnu53jgILkuKTkuKrln5/lkI3lt7LnlKggSG9Zby5HYWNoYSDmupDnoIHmoLjlrp7vvJpcbiAgICAgIC8vIGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9Ib1lvLkdhY2hhL2NyYXRlcy9nYW1lX2Jpei9zcmMvYXBpLnJzOjQyLTQzXG4gICAgICAvLyAgICgoSGtycGcsIE9mZmljaWFsKSwgU3RhbmRhcmQpIC0+IFwiaHR0cHM6Ly9wdWJsaWMtb3BlcmF0aW9uLWhrcnBnLm1paG95by5jb20vLi4uXCJcbiAgICAgIC8vICAgKChIa3JwZywgT3ZlcnNlYSksICBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24taGtycGctc2cuaG95b3ZlcnNlLmNvbS8uLi5cIlxuICAgICAgYWxsb3dlZEhvc3RzOiBbXCJwdWJsaWMtb3BlcmF0aW9uLWhrcnBnLm1paG95by5jb21cIiwgXCJwdWJsaWMtb3BlcmF0aW9uLWhrcnBnLXNnLmhveW92ZXJzZS5jb21cIl0sXG4gICAgICBleHRyYWN0TGlzdDogZXh0cmFjdEdhY2hhTG9nTGlzdCxcbiAgICAgIC8vIOmZkOmAn+etlueVpe+8muaYvuW8j+WjsOaYju+8jOWPluWAvOaKhOiHquWPguiAg+WunueOsOeahOecn+WunuihjOS4uuKAlOKAlFxuICAgICAgLy8gc3Rhci1yYWlsLXdhcnAtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjIz77yIYGF3YWl0IHNsZWVwKDAuMylgXG4gICAgICAvLyDmr4/pobXlu7bov58gMzAwbXPvvInjgIE6MjE5LTIyMu+8iOavjyAxMCDpobXpop3lpJblgZzpob8gMXPvvIzor6XniYjmnKzph4zov5nmrrXooqvms6jph4pcbiAgICAgIC8vIOaOieS6hu+8jOS9huaVsOWAvOacrOi6q+S7jeaYr+WPr+S/oeeahOWPguiAg+WunueOsOiuvuiuoeaEj+Wbvu+8ieOAgToyMjXvvIhgcmV0cnlDb3VudDogNWDvvInjgIJcbiAgICAgIC8vIOWuv+S4u+aMiVwi6YCQ5a2X5q615Y+W5pu05rip5ZKM6ICFXCLlkIjlubbov5nph4znmoTlo7DmmI7kuI7lrr/kuLvmnKzmrKHkvJror53nmoTms6jlhaXnrZbnlaVcbiAgICAgIC8vIO+8iGBjcmF0ZXMvcGFyYWRpZ21zL2dzLXAtYXV0aGtleS9zcmMvcmF0ZV9saW1pdC5yc2Ag55qEXG4gICAgICAvLyBgbWVyZ2VkX3dpdGhfZGVjbGFyZWRg77yJ4oCU4oCU5Lu75L2V5LiA5pa56YO95LiN6IO95oqK5Y+m5LiA5pa55pS+5p2+77yM5Zug5q2k6L+Z6YeM5aGrXG4gICAgICAvLyBcIua4uOaIjyBBUEkg6IO95Y+X5aSa5bCRXCLvvIzkuI3pnIDopoHmi4Xlv4Pooqvlrr/kuLvnmoTmm7Tmv4Dov5vnrZbnlaXopobnm5bjgIJcbiAgICAgIHJhdGVMaW1pdDoge1xuICAgICAgICBwZXJQYWdlRGVsYXlNczogMzAwLFxuICAgICAgICBiYXRjaFNpemU6IDEwLFxuICAgICAgICBiYXRjaERlbGF5TXM6IDEwMDAsXG4gICAgICAgIHJldHJ5OiB7IG1heEF0dGVtcHRzOiA1LCBkZWxheU1zOiA1MDAwIH0sXG4gICAgICB9LFxuICAgICAgLy8gYmFubmVySWRlbnRpdHkg5LiN5aOw5piO77yM57y655yBIFwicmVzcG9uc2VcIuKAlOKAlOi/meaYr+aYvuW8j+WGs+etlu+8jOS4jeaYr+a8j+Whq+OAglxuICAgICAgLy8g57Gz5ZOI5ri45LiJ5ri45YWx5Lqr5ZCM5LiA5aWXIGBnZXRHYWNoYUxvZ2Ag5ZON5bqU5b2i5oCB77yM5Y6f56We5bey5a6e5rWL6K+B5a6e5Lya5re35rGgXG4gICAgICAvLyDvvIhmaXh0dXJlcy9nZW5zaGluL3Jhd19yZXNwb25zZS8zMDFfcGFnZV8xLmpzb27vvJrmn6Xor6IgZ2FjaGFfdHlwZT0zMDHvvIxcbiAgICAgIC8vIOWTjeW6lOmHjOa3t+WbniBnYWNoYV90eXBlPTQwMCDnmoTorrDlvZXvvInjgILmmJ/pk4HmmK/lkKbkvJrmt7fmsaDvvIzmnKzmrKHku7vliqHnroDmiqXkuI5cbiAgICAgIC8vIHJlc2VhcmNoLzAz44CBMDQg5Z2H5pyq57uZ5Ye65pif6ZOB6Ieq6Lqr55qE54us56uL5re35rGg5a6e5rWL77yM5LiO6bij5r2u6YKj56eN44CM5bey6K+B5a6eXG4gICAgICAvLyDkuI3mt7fmsaDjgI3nmoTmg4XlhrXkuI3lkIzigJTigJTpuKPmva7og73lronlhajlo7DmmI4gXCJxdWVyeVwi77yI6KeBXG4gICAgICAvLyBwbHVnaW5zL3d1d2EvbWFuaWZlc3QudHMg55qE5ZCM5ZCN5a2X5q615rOo6YeK77yJ5piv5Zug5Li65pyJ55yf5a6e5a2Y5qGj5a6e5rWL6IOM5Lmm77yMXG4gICAgICAvLyDmmJ/pk4HmsqHmnInjgILlo7DmmI4gXCJxdWVyeVwiIOS4gOaXpuWBh+iuvumUmeivr++8jOa3t+WFpeeahOiusOW9leS8muiiq+mdmem7mOmUmeivr+W9kuaxoOS4lFxuICAgICAgLy8g5p6B6Zq+5a6a5L2N77yM5Luj5Lu36L+c6auY5LqOXCLkuI3lo7DmmI7jgIHmsr/nlKjmm7Tkv53lrojnmoTpu5jorqTlgLxcIu+8jOWboOatpOi/memHjOS4jei1jOOAglxuICAgIH0sXG4gIH0sXG5cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIuaYn+mTgSBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgLy8g5pif6ZOBIEFQSSDljp/nlJ/ov5Tlm54gaXRlbV9pZOKAlOKAlOS4juWOn+elnuS4jeWQjO+8iOWOn+elniBnZXRHYWNoYUxvZyDkuI3ov5Tlm55cbiAgICAgIC8vIGl0ZW1faWTvvIxpdGVtSWQg5Y+q6IO96YCA6ICM5rGC5YW25qyh55So5pys5Zyw5YyW54mp5ZOB5ZCN77yM6KeBXG4gICAgICAvLyBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHMg55qE6K+m57uG6K+05piO77yJ44CC55yf5a6e6K6w5b2V5qC35L6L6KeBIHJlc2VhcmNoLzAzXG4gICAgICAvLyDCpzEuM++8muivpeagt+S+i+aBsOWlveaYr+S4gOadoeWFg+aVsOaNrue8uuWkseiusOW9le+8iGl0ZW1faWQ9XCIxMjIzXCIg5pyJ55yf5a6e5YC877yMXG4gICAgICAvLyBuYW1lL2l0ZW1fdHlwZS9yYW5rX3R5cGUg5YWo5Li656m65a2X56ym5Liy77yJ4oCU4oCU6L+Z5p2h5qC35L6L5Y+N6ICM5pu05pyJ6K+05pyN5Yqb77yMXG4gICAgICAvLyDor4HmmI4gaXRlbV9pZCDmmK/ov5nnsbvlvILluLjorrDlvZXph4zllK/kuIDku43nhLbkv53or4HpnZ7nqbrnmoTplJrngrnjgIJcbiAgICAgIGNvbnN0IGl0ZW1JZCA9IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLml0ZW1faWQpO1xuICAgICAgaWYgKCFpdGVtSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi5pif6ZOBIGV4dHJhY3RSZWNvcmTvvJrorrDlvZXnvLrlsJEgaXRlbV9pZO+8jOaXoOazleehruWumiBpdGVtSWRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGl0ZW1JZCxcbiAgICAgICAgdGltZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQudGltZSkgPz8gXCJcIixcbiAgICAgICAgLy8gYmFubmVySWQg55SoIGdhY2hhX3R5cGXvvIjljaHmsaDnsbvliKvnoIHvvJoxLzIvMTEvMTIvMjEvMjLvvInvvIzkuI3mmK9cbiAgICAgICAgLy8gZ2FjaGFfaWTigJTigJRnYWNoYV9pZCDmmK/lhbfkvZPljaHmsaDlrp7kvosgaWTvvIjlpoLlkIzkuIDnsbvliKvnoIHkuIvpmo/ml7bpl7Tmjqjlh7rnmoRcbiAgICAgICAgLy8g5LiN5ZCM5pyf5pWw77yMcmVzZWFyY2gvMDMgwqcxLjIg5a6e5rWL5pyJIDQ5IOenjeecn+WunuWPluWAvO+8ieOAguaKiuWug+Whnui/m1xuICAgICAgICAvLyBiYW5uZXJJZCDkvJrlr7zoh7QgYmFubmVyc1tdIOmcgOimgeaemuS4vuaMgee7reWinumVv+eahOWunuS+iyBpZO+8jOe7tOaKpOi0n+aLhei/nFxuICAgICAgICAvLyDpq5jkuo7mjInnsbvliKvlo7DmmI7vvIzlm6DmraTljaHmsaDlvZLlsZ7ku43nhLblj6rnlKggZ2FjaGFfdHlwZSDov5nkuIDlsYLnsbvliKvvvJtcbiAgICAgICAgLy8gZ2FjaGFfaWQg5pS56LWw5LiL5pa554us56uL55qEIGdhY2hhSWQg5a2X5q6155WZ5bqV77yI5LiN5Y+C5LiO5Y2h5rGg5b2S5bGe5Yik5a6a77yJ44CCXG4gICAgICAgIGJhbm5lcklkOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5nYWNoYV90eXBlKSA/PyBcIlwiLFxuICAgICAgICBjb3VudDogdG9Db3VudChyZWNvcmQuY291bnQpLFxuICAgICAgICBuYW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5uYW1lKSxcbiAgICAgICAgaXRlbVR5cGU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLml0ZW1fdHlwZSksXG4gICAgICAgIHJhcml0eTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQucmFua190eXBlKSxcbiAgICAgICAgc3RhYmxlSWQ6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmlkKSxcbiAgICAgICAgLy8g5pif6ZOBIEFQSSDljp/nlJ/ov5Tlm54gZ2FjaGFfaWTvvIjnnJ/lrp7lrZjmoaPlrp7mtYvvvIxyZXNlYXJjaC8wMyDCpzEuMi/CpzEuM1xuICAgICAgICAvLyDmoLfkvovorrDlvZXph4znmoQgXCJnYWNoYV9pZFwiOiBcIjIwNDFcIu+8ieOAglVuaWZpZWRSZWNvcmRGaWVsZHMuZ2FjaGFJZCDnjrDlt7JcbiAgICAgICAgLy8g5om/6L296L+Z5Liq5a2X5q6177yIVUlHRiB2NC4yIGhrcnBnIOauteaKiuWug+WIl+S4uiByZXF1aXJlZO+8ie+8jOWOn+agt+iQveW6k+eVmeW6le+8m1xuICAgICAgICAvLyDimqDvuI8g5LiN55So5a6D5YGa5Y2h5rGg5b2S5bGe5Yik5a6a4oCU4oCUNDkg56eN55yf5a6e5Y+W5YC85peg5rOV5Y+v6Z2g5pig5bCE5Zue56iz5a6a55qEXG4gICAgICAgIC8vIEJhbm5lclNwZWPvvIznkIbnlLHlkIzkuIrmlrkgYmFubmVySWQg55qE6K+05piO77yM5pys5qyh5pS55Yqo5LiN5pS55Y+Y6L+Z5LiA54K544CCXG4gICAgICAgIGdhY2hhSWQ6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmdhY2hhX2lkKSxcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcblxuICAvLyDljaHmsaDnsbvliKvnoIHkuI7mmL7npLrlkI3vvIznm7TmjqXlj5boh6ogcmVzZWFyY2gvMDMgwqcyLjEg55qEIHR5cGVNYXAg5a6e5rWL57uT5p6c77yMXG4gIC8vIOWumOaWueWxleekuuWQjeayv+eUqOS7u+WKoeeugOaKpeWPo+W+hO+8iDEvMiDkuKTkuKrmsaDnmoTnrKzkuInmlrnlr7zlh7rlt6XlhbcgdHlwZU1hcCDnlKjnmoTmmK9cbiAgLy8g6YCa55So5qCH562+XCLluLjpqbvot4Pov4FcIi9cIuaWsOaJi+i3g+i/gVwi77yM5LiN5piv5ri45oiP5YaF5a6Y5pa55bGV56S65ZCNXCLnvqTmmJ/ot4Pov4FcIi9cbiAgLy8gXCLlp4vlj5Hot4Pov4FcIuKAlOKAlOS4pOiAheaMh+WQkeWQjOS4gOS4qiBnYWNoYV90eXBl77yM5Y+q5piv5qCH562+5p2l5rqQ5LiN5ZCM77yM5aaC5a6e5qCH5rOo77yJ44CCXG4gIGJhbm5lcnM6IFtcbiAgICB7IGlkOiBcIjFcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIue+pOaYn+i3g+i/gVwiIH0gfSxcbiAgICB7IGlkOiBcIjJcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuWni+WPkei3g+i/gVwiIH0gfSxcbiAgICB7IGlkOiBcIjExXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLop5LoibLmtLvliqjot4Pov4FcIiB9IH0sXG4gICAgeyBpZDogXCIxMlwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5YWJ6ZSl5rS75Yqo6LeD6L+BXCIgfSB9LFxuICAgIC8vIOiBlOWKqOi3g+i/gei1sOeLrOeri+err+eCue+8jOadpea6kCBzdGFyLXJhaWwtd2FycC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczoyMTZcbiAgICAvLyDvvIhgWycyMScsJzIyJ10uaW5jbHVkZXMoa2V5KSA/ICdnZXRMZEdhY2hhTG9nJyA6ICdnZXRHYWNoYUxvZydg77yJ77yMXG4gICAgLy8gSG9Zby5HYWNoYSDnmoQgZ2FtZV9iaXovc3JjL2FwaS5yczo0NS00Nu+8iENvbGxhYm9yYXRpb24g5YiG5pSv77yJ5ZCM5qC35Y2w6K+B44CCXG4gICAgeyBpZDogXCIyMVwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6KeS6Imy6IGU5Yqo6LeD6L+BXCIgfSwgZW5kcG9pbnRPdmVycmlkZTogXCJnZXRMZEdhY2hhTG9nXCIgfSxcbiAgICB7IGlkOiBcIjIyXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLlhYnplKXogZTliqjot4Pov4FcIiB9LCBlbmRwb2ludE92ZXJyaWRlOiBcImdldExkR2FjaGFMb2dcIiB9LFxuICBdLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBwaXR5R3JvdXBz77yaNiDkuKrljaHmsaDlkIToh6rni6znq4vkuIDnu4TvvIzogZTliqjmsaDkuI3kuI7luLjop4TmsaDlkIjlubZcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vXG4gIC8vIGJhc2UgLyBoYXJkUGl0eSAvIGd1YXJhbnRlZSDkuInpobnlj5boh6rlrpjmlrnkv53lupXmpoLnjoflhaznpLogSlNPTlxuICAvLyDvvIhvcGVyYXRpb24td2Vic3RhdGljLm1paG95by5jb20vZ2FjaGFfaW5mby9oa3JwZy9wcm9kX2dmX2NuLzxpZD4vXG4gIC8vIHpoLWNuLmpzb27vvIzlt7LnlLHkuLvov5vnqIvni6znq4vmoLjpqozvvIzmnKwgQWdlbnQg5Lya6K+d5pyq6YeN5paw5oqT5Y+W77yJ77yM5Y+v5L+h5bqm6KeG5Li6XG4gIC8vIOOAjOWumOaWueOAjeOAgmN1cnZlIOeahCBzdGFydC9zdGVwIOaYr+WQjOS6uuekvuWMuuaOqOeul+WAvO+8jOmdnuWumOaWue+8jOingeS4iuaWuVxuICAvLyBDSEFSQUNURVJfU09GVF9QSVRZX0NVUlZFIC8gTElHSFRfQ09ORV9TT0ZUX1BJVFlfQ1VSVkUg55qE5rOo6YeK44CCXG4gIC8vXG4gIC8vIOKaoO+4jyAqKjIxLzIyIOiBlOWKqOaxoOS/neW6leeLrOeri+S6jiAxMS8xMiDluLjop4TmsaDvvIzkuI3lkIjlubYgbWVtYmVycyoq4oCU4oCU5a6Y5pa55YWs56S6XG4gIC8vIEpTT04g5Y6f5paH77yI5bey55Sx5Li76L+b56iL5qC46aqM77yJ77ya44CM5Zyo5Lu75oSP44CMRmF0ZVtVQlddIOinkuiJsuiBlOWKqOi3g+i/geOAjeS4reacquiOt+WPllxuICAvLyA15pif6KeS6Imy55qE57Sv6K6h6LeD6L+B5qyh5pWw5Lya5LiA55u057Sv6K6h5LqO44CMRmF0ZVtVQlddIOinkuiJsuiBlOWKqOi3g+i/geOAjeS4re+8jOS4juWFtuS7llxuICAvLyDot4Pov4HnmoTot4Pov4HmrKHmlbDkv53lupXnm7jkupLni6znq4vorqHnrpfvvIzkupLkuI3lvbHlk43jgILjgI3ov5nmnaHmraTliY3mmK/mnKzpobnnm67nmoTmnKrlhrPpobnvvIxcbiAgLy8g546w5bey5pyJ5a6Y5pa55Y6f5paH6IOM5Lmm77yMMjEvMjIg5ZCE6Ieq5Y2V54us5oiQ57uE44CCXG4gIHBpdHlHcm91cHM6IFtcbiAgICB7XG4gICAgICBrZXk6IFwiY2hhcmFjdGVyRXZlbnRXYXJwXCIsIC8vIDExIOinkuiJsua0u+WKqOi3g+i/gVxuICAgICAgbWVtYmVyczogW1wiMTFcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogQ0hBUkFDVEVSX1NPRlRfUElUWV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcImZpZnR5RmlmdHlcIiB9LCAvLyA1MCUg55u05o6lIFVQ77yM5q2q5YiZ5LiL5qyh5b+F5LitXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwibGlnaHRDb25lRXZlbnRXYXJwXCIsIC8vIDEyIOWFiemUpea0u+WKqOi3g+i/gVxuICAgICAgbWVtYmVyczogW1wiMTJcIl0sXG4gICAgICBoYXJkUGl0eTogODAsXG4gICAgICBjdXJ2ZTogTElHSFRfQ09ORV9TT0ZUX1BJVFlfQ1VSVkUsXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJ3ZWlnaHRlZFwiLCByYXRlVXBDaGFuY2U6IDAuNzUgfSwgLy8gNzUlIOebtOaOpSBVUFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcInN0ZWxsYXJXYXJwXCIsIC8vIDEg576k5pif6LeD6L+B77yI5bi46am777yJ77yM5pegIFVQXG4gICAgICBtZW1iZXJzOiBbXCIxXCJdLFxuICAgICAgaGFyZFBpdHk6IDkwLFxuICAgICAgY3VydmU6IENIQVJBQ1RFUl9TT0ZUX1BJVFlfQ1VSVkUsXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJub25lXCIgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJkZXBhcnR1cmVXYXJwXCIsIC8vIDIg5aeL5Y+R6LeD6L+B77yI5paw5omL77yJ77yM5pegIFVQXG4gICAgICBtZW1iZXJzOiBbXCIyXCJdLFxuICAgICAgaGFyZFBpdHk6IDUwLFxuICAgICAgLy8g4pqg77iPICoqc3RhcnQvc3RlcCDmnKropobnm5bvvIzlpoLlrp7nlZnnqbrnlKggY3VzdG9tIOWNoOS9je+8jOS4jeWkluaOqCoq77ya5Lu75Yqh566A5oqlXG4gICAgICAvLyDnu5nlh7rnmoTkuKTmnaHnpL7ljLrmjqjnrpflj6PlvoTliIbliKvlr7nlupTnoazkv53lupUgOTDvvIjop5LoibLnsbvvvInkuI7noazkv53lupUgODBcbiAgICAgIC8vIO+8iOWFiemUpeexu++8ieS4pOaho++8jOacrOWNoeaxoOehrOS/neW6lSA1MO+8jOS4jeWxnuS6juS7u+S4gOaho++8m+ayoeacieesrOS4ieaho+eahOaOqOeul+WAvFxuICAgICAgLy8g5Y+v55So77yM5Lmf5rKh5pyJ5YiG5qG25ZG95Lit546H5pWw5o2u5pSv5pKR546w5o6o5LiA5p2h5paw5puy57q/44CC5aSE55CG5pa55byP5a+56b2QXG4gICAgICAvLyBwbHVnaW5zL3d1d2EvbWFuaWZlc3QudHMg5a+55peg5YiG5qG25pWw5o2u5pSv5pKR5puy57q/55qE5LiA6LSv5YGa5rOVXG4gICAgICAvLyDvvIhgd3V3YS11bmNvbmZpcm1lZC0qc3Rhci1wb29sLSpgIOWNoOS9jSBpZO+8ieOAglxuICAgICAgY3VydmU6IHsga2luZDogXCJjdXN0b21cIiwgaWQ6IFwic3RhcnJhaWwtdW5jb25maXJtZWQtc29mdHBpdHktcG9vbC0yXCIgfSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIm5vbmVcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcImNoYXJhY3RlckV2ZW50V2FycENvbGxhYlwiLCAvLyAyMSDop5LoibLogZTliqjot4Pov4HvvIzni6znq4vkv53lupXvvIzkuI3kuI4gMTEg5ZCI5bm2XG4gICAgICBtZW1iZXJzOiBbXCIyMVwiXSxcbiAgICAgIGhhcmRQaXR5OiA5MCxcbiAgICAgIGN1cnZlOiBDSEFSQUNURVJfU09GVF9QSVRZX0NVUlZFLFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwibGlnaHRDb25lRXZlbnRXYXJwQ29sbGFiXCIsIC8vIDIyIOWFiemUpeiBlOWKqOi3g+i/ge+8jOeLrOeri+S/neW6le+8jOS4jeS4jiAxMiDlkIjlubZcbiAgICAgIG1lbWJlcnM6IFtcIjIyXCJdLFxuICAgICAgaGFyZFBpdHk6IDgwLFxuICAgICAgY3VydmU6IExJR0hUX0NPTkVfU09GVF9QSVRZX0NVUlZFLFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwid2VpZ2h0ZWRcIiwgcmF0ZVVwQ2hhbmNlOiAwLjc1IH0sXG4gICAgfSxcbiAgXSxcbiAgLy8g5pys6L2u5Y+q5aOw5piOIDXimIUg5L+d5bqV57uE77yM5LiN5aOw5piOIDTimIUg57uE4oCU4oCU5Z+657q/IHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50c1xuICAvLyDlkIzmoLfmsqHmnIkgNOKYhSDliIbnu4TvvIzkv53mjIHlj6/mr5TvvJvmnKzova7mnKropobnm5bvvIznlZnlvoXlkI7nu63mnInliIbmobbmlbDmja7mlK/mkpHml7blho3ooaXjgIJcblxuICByYXJpdHk6IHtcbiAgICBsYWRkZXI6IFtcIjNcIiwgXCI0XCIsIFwiNVwiXSxcbiAgICBwaXR5VGFyZ2V0OiBcIjVcIixcbiAgICB0aWVyTGFiZWxzOiB7XG4gICAgICBcIjNcIjogeyBcInpoLUNOXCI6IFwi5LiJ5pifXCIgfSxcbiAgICAgIFwiNFwiOiB7IFwiemgtQ05cIjogXCLlm5vmmJ9cIiB9LFxuICAgICAgXCI1XCI6IHsgXCJ6aC1DTlwiOiBcIuS6lOaYn1wiIH0sXG4gICAgfSxcbiAgfSxcblxuICB0aW1lOiB7XG4gICAgLy8g55u06L+e5a6Y5pa5IEFQSe+8jOW+l+WIsOeahOaYr+acjeWKoeWZqOacrOWcsOaXtumXtOWtl+espuS4su+8jOS4jeW4puaXtuWMulxuICAgIC8vIO+8iHJlc2VhcmNoLzAzIMKnMi4z77yaXCLml7bpl7TlrZfnrKbkuLLkuIDlvovkuI3luKbml7bljLrvvIzmmK/mnI3liqHlmajmnKzlnLDml7bpl7RcIu+8ieOAglxuICAgIHJhd1RpbWVDb252ZW50aW9uOiBcInNlcnZlckxvY2FsXCIsXG4gICAgLy8gcmVnaW9uX3RpbWVfem9uZSDmmK/lk43lupTkvZMgZGF0YSDlsYLnmoTpobXnuqflrZfmrrXvvIjkuI4gbGlzdCDlkIznuqfvvIzkuI3mmK/pgJDmnaFcbiAgICAvLyDorrDlvZXlrZfmrrXvvInigJTigJTmnaXmupAgcmVzZWFyY2gvMDMgwqcyLjPjgIzmmJ/pk4EgcmVnaW9uX3RpbWVfem9uZT0444CNK1xuICAgIC8vIHN0YXItcmFpbC13YXJwLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIyNi0yMzTvvIhgcmVzPy5kYXRhYCDop6PmnoTlh7pcbiAgICAvLyBgbGlzdGAvYHJlZ2lvbmAvYHJlZ2lvbl90aW1lX3pvbmVgIOS4ieiAheWQjOe6p++8ieOAguWuv+S4u+eahFxuICAgIC8vIGByZWFkX3BhZ2VfbGV2ZWxfZmllbGRgIOW3suWunuijhe+8iOS4jeWQjOS6jiBkcmlsbHMvc3RhcnJhaWwvbWFuaWZlc3QudHNcbiAgICAvLyDmkrDlhpnml7YgTTEtUzcg55qE54q25oCB4oCU4oCU5b2T5pe26L+Z5Liq5YiG5pSv5LuO5pyq6KKr5raI6LS577yM5qCH5LqGXG4gICAgLy8gYCNbYWxsb3coZGVhZF9jb2RlKV1g77yMTTIg5bey5a6e6KOF5bm26KKr55yf5a6e5raI6LS577yJ77yM5Zug5q2k6L+Z6YeM5LiN6ZyA6KaBXG4gICAgLy8gaG9va3MucmVzb2x2ZVRpbWV6b25l77yM5a6/5Li75Lya55u05o6l5LuO5ZON5bqU5L2T6aG157qn5a2X5q616K+75Y+W5YGP56e76YeP44CCXG4gICAgdGltZXpvbmVTb3VyY2U6IHsga2luZDogXCJhcGlGaWVsZFwiLCBmaWVsZDogXCJyZWdpb25fdGltZV96b25lXCIgfSxcbiAgICAvLyByYXdGb3JtYXQg5LiN5aGr77ya5ZON5bqUIHRpbWUg5piv56m65qC85YiG6ZqU5qC85byPIFwiWVlZWS1NTS1ERCBISDptbTpzc1wiXG4gICAgLy8g77yI5aaCIHJlc2VhcmNoLzAzIMKnMS4zIOagt+S+iyBcIjIwMjQtMDktMTAgMTA6MDU6MjZcIu+8ie+8jOaBsOWlveaYr1xuICAgIC8vIFJhd1RpbWVGb3JtYXQg55qE6buY6K6k5YC8IHNwYWNlU2VwYXJhdGVk77yM5LiN6ZyA6KaB5pi+5byP5aOw5piO44CCXG4gIH0sXG5cbiAgcHJlY29uZGl0aW9uczogW1xuICAgIHtcbiAgICAgIGlkOiBcInN0YXJyYWlsLmNyZWRlbnRpYWwuY2FjaGVEaXJFeGlzdHNcIixcbiAgICAgIGNhcGFiaWxpdHk6IFwiY3JlZGVudGlhbFwiLFxuICAgICAgbGV2ZWw6IFwicmVxdWlyZWRcIixcbiAgICAgIGRlc2NyaWJlOiB7XG4gICAgICAgIFwiemgtQ05cIjogXCLoh6rliqjojrflj5bot4Pov4HorrDlvZXopoHmsYLmuLjmiI/lrqLmiLfnq6/oh7PlsJHov5DooYzov4fkuIDmrKHvvIznvJPlrZjnm67lvZXmiY3kvJrooqvliJvlu7pcIixcbiAgICAgIH0sXG4gICAgICAvLyDlkIzljp/npZ7lhYjkvovvvJpIb3N0RW52IOebruWJjeayoeacieOAjGNyZWRlbnRpYWwuZ2FtZURpciDlo7DmmI7nmoTnvJPlrZjnm67lvZXmmK/lkKZcbiAgICAgIC8vIOW3suiiq+ingua1i+WIsOOAjei/meS4gOS6i+Wunu+8jGNoZWNrIOWPquiDvei/lOWbniB1bmtub3du44CCXG4gICAgICBjaGVjazogKCkgPT4gKHsga2luZDogXCJ1bmtub3duXCIgfSksXG4gICAgICByZW1lZHk6IHsgXCJ6aC1DTlwiOiBcIuivt+WFiOWQr+WKqOa4uOaIj+W5tuaJk+W8gOS4gOasoei3g+i/geiusOW9lemhte+8jOWGjeWbnuWIsOacrOW6lOeUqOmHjeivlVwiIH0sXG4gICAgfSxcbiAgXSxcblxuICAvLyDkuI7ljp/npZ7kuIDoh7TnmoTojIPlvI8gQSDpgJrnlKjln7rnur/nrZbnlaXvvJrliIbpobXlk43lupToh6rluKbmgLvmnaHmlbDvvIzpm7bmiJDmnKzjgIHlhajopobnm5bjgIFcbiAgLy8g5peg6aKd5aSW5Yet5o2u6aOO6Zmp44CCXG4gIGJhc2VsaW5lOiB7IGtpbmQ6IFwiaW5HYW1lUGFnZUNvdW50XCIgfSxcblxuICByZXRlbnRpb246IHtcbiAgICBkaXNwbGF5VGV4dDogeyBcInpoLUNOXCI6IFwiNiDkuKrmnIhcIiB9LFxuICAgIC8vIOWumOaWuSBBUEkg5Y+q6L+U5Zue6L+RIDYg5Liq5pyI6K6w5b2V77yM5pyI6ZW/5LiN5LiA77yM5oyJIDbDlzI4PTE2OCDlpKnov5nnsbvovoPnn63lgLzlj5bvvIxcbiAgICAvLyDlkYrorablroHml6nli7/mmZrvvIzlsZXnpLrmlofmoYjkuIDlvovnlKjjgIw2IOS4quaciOOAjeKAlOKAlOWPo+W+hOS4jiBnZW5zaGluIOS4gOiHtO+8jOadpea6kFxuICAgIC8vIHJlc2VhcmNoLzAyLeW8gueOr05URemHh+mbhuaWueahiOiwg+eglC5tZCDCpzUuMe+8muOAjOWOn+elniAvIOaYn+mTgSAvIOe7neWMuumbtiB8XG4gICAgLy8g57qmIDYg5Liq5pyI44CN44CCXG4gICAgY29uc2VydmF0aXZlRGF5czogNiAqIDI4LFxuICB9LFxuXG4gIC8vIGl0ZW1JZFNvdXJjZSDkuI3lo7DmmI7vvIzpu5jorqQgXCJuYXRpdmVcIuOAgui/meaYr+S4juWOn+elnueahOa4heaZsOWvueeFp++8muWOn+elnuWboOS4uiBBUElcbiAgLy8g5LiN6L+U5ZueIGl0ZW1faWQg5omN6ZyA6KaB5pi+5byP5aOw5piOIFwiZGlzcGxheU5hbWVcIu+8m+aYn+mTgeeahCBpdGVtX2lkIOaYryBBUEkg5Y6f55SfXG4gIC8vIOWtl+aute+8iOecn+WunuWtmOaho+e7n+iuoeivgeWunu+8jOingeS4iuaWuSBmaWVsZHMuZXh0cmFjdFJlY29yZCDlhoXnmoTor7TmmI7vvInvvIzkuI3pnIDopoFcbiAgLy8g6L+Z5Liq54m55L6L44CCXG5cbiAgLy8gbWV0YWRhdGEg5LiN5aOw5piO44CCcmVzZWFyY2gvMDMgwqcxLjMg5oyH5Ye65pif6ZOB5a2Y5qGj56Gu5pyJ5YWD5pWw5o2u57y65aSx6K6w5b2VXG4gIC8vIO+8iDEvNTM3Mu+8ie+8jE1ldGFkYXRhUHJvdmlkZXIg55qEXCLkuovlkI7lm57loatcIuiDveWKm+WvueaYn+mTgeaYr+W/heimgeeahO+8jOS9humdmeaAgVxuICAvLyDlrZflhbjlhoXlrrnmnKzmrKHmnKrojrflj5bvvIzkuI3nvJbpgKDlrZflhbjlhoXlrrnvvIznlZnnqbrkuI7ljp/npZ7njrDnirbkuIDoh7RcbiAgLy8g77yIcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzIOWQjOagt+acquWjsOaYjiBtZXRhZGF0Ye+8ieKAlOKAlOacrOi9ruacquimhuebluOAglxuXG4gIC8vIGRyYXdDb3VudGluZyDkuI3lo7DmmI7vvIzpu5jorqQgcGVyUmVjb3Jk77yI57Gz5ZOI5ri45LiJ5ri4IGNvdW50IOaBkuS4uiAx77yM6YCC55So77yJ44CCXG59IHNhdGlzZmllcyBQbHVnaW5NYW5pZmVzdDtcbiIsIi8qKlxuICog6bij5r2u5o+S5Lu255qE6YCD55Sf6IixIGhvb2tz44CCXG4gKlxuICog5Y+q5a6e546wIGBkZXJpdmVSZWNvcmRLZXlzYCDkuIDkuKogaG9va+KAlOKAlGByZXNvbHZlVGltZXpvbmVgIOe8uuWwkVxuICogc3ZyX2lkL3N2cl9hcmVhIOWIsCBVVEMg5YGP56e76YeP55qE55yf5a6e5pig5bCE6KGo77yMYGNvdW50RHJhd3NgIOS4jemcgOimge+8iOm4o+a9rlxuICogYGRyYXdDb3VudGluZ2Ag5pyq5aOw5piO77yM6LWw6buY6K6kIGBwZXJSZWNvcmRg77yJ77yM6KeBIGAuL21hbmlmZXN0LnRzYCDlr7nlupTlrZfmrrVcbiAqIOaXgeeahOazqOmHiuOAglxuICpcbiAqICMjIOS4uuS7gOS5iOW/hemhu+aYr+aJueWkhOeQhueJiOacrO+8iGBkZXJpdmVSZWNvcmRLZXlzYO+8ie+8jOS4jeiDveeUqCBgZGVyaXZlUmVjb3JkS2V5YFxuICpcbiAqIOm4o+a9ruWTjeW6lOiusOW9leayoeacieS7u+S9leW9ouW8j+eahOeos+WumiBJRO+8iOingSBgLi9tYW5pZmVzdC50c2Ag55qEXG4gKiBgZmllbGRzLmV4dHJhY3RSZWNvcmRgIOazqOmHiu+8ie+8jGByZWNvcmRfa2V5YCDnrZbnlaXmmK9cbiAqIGBoYXNoKOaXtumXtCArIOeJqeWTgSArIOWQjOaJueasoeWGheW6j+S9jSlg4oCU4oCUXCLlkIzmibnmrKHlhoXluo/kvY1cIui/meS4quS/oeaBryoq57uT5p6E5LiK5Y+q5pyJXG4gKiDlkIzml7bnnIvliLBcIui/meS4gOaJuemHjOeahOWFtuS9meiusOW9lVwi5omN566X5b6X5Ye65p2lKirvvIzljZXorrDlvZXnrb7lkI1cbiAqIGAocmVjb3JkKSA9PiBzdHJpbmdgIOWBmuS4jeWIsO+8jOWboOatpOW/hemhu+eUqOaJueWkhOeQhueJiOacrOOAglxuICpcbiAqICMjIOecn+WunuWtmOaho+Wunua1i+eahOS4pOS4queZvuWIhuavlO+8iOS4jeimgea3t+eUqO+8iVxuICpcbiAqIGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCp+S4gOWvuSAzMzcxIOadoeecn+WunuiusOW9leaMiVxuICogYCjljaHmsaAsIOaXtumXtCwg54mp5ZOBKWAg5YiG57uE57uf6K6h5Ye65Lik5Liq5LiN5ZCM5ZCr5LmJ55qE55m+5YiG5q+U77yM6KGM5paH5pe25b+F6aG75YiG5riF5qWaXG4gKiDmjIfnmoTmmK/lk6rkuIDkuKrvvJpcbiAqIC0gKiozMi42MCXvvIgxMDk5LzMzNzHvvIkqKuKAlOKAlGtleSDnmoTmraPnoa7mgKcqKuS+nei1luW6j+S9jSoq55qE6K6w5b2V5q+U5L6L77yI56Kw5pKe57uEXG4gKiAgIOWFqOmDqOaIkOWRmO+8mue7hOWGheWPquimgeaciSDiiaUyIOadoeiusOW9le+8jOaVtOe7hOmDveeul+WcqOWGhe+8jOWboOS4uue7hOWGheS7u+S9leS4gOadoeeahCBrZXlcbiAqICAg5piv5ZCm5q2j56Gu6YO95Y+W5Yaz5LqO5bqP5L2N566X5b6X5a+55LiN5a+577yJ44CCXG4gKiAtICoqMTcuNTMl77yINTkxLzMzNzHvvIkqKuKAlOKAlOS4jeeUqOW6j+S9jeOAgeWPquaMiSBgKOWNoeaxoCwg5pe26Ze0LCDnianlk4EpYCDkuInlhYPnu4TnrpdcbiAqICAga2V5IOaXtu+8jOS8muiiqyBgSU5TRVJUIE9SIElHTk9SRWAgKirpnZnpu5jkuKLlvIMqKueahOiusOW9leavlOS+i++8iOavj+S4queisOaSnue7hOmHjFxuICogICBcIuaKouWIsFwi5LiJ5YWD57uEIGtleSDnmoTpgqPkuIDmnaHog73mtLvkuIvmnaXvvIznu4TlhoXlhbbkvZnmiJDlkZjlhajpg6jmkp7plK7kuKLlpLHvvInjgIJcbiAqXG4gKiDnorDmkp7nu4TlhbEgNTA4IOe7hOOAgjUwOCDkuKrnorDmkp7nu4TlhoUqKumAkOWtl+auteWujOWFqOebuOWQjCoq77yI5ZCM5LiA5LiqIGAo5Y2h5rGgLCDnp5IpYFxuICog5YaF55qE5Y2B6L+e5om55qyh5aSp54S25aaC5q2k77yJ4oCU4oCU6bij5r2uIEFQSSDkuI3liIbpobXjgIHkuIDmrKHov5Tlm57mlbTmsaDlhajph4/vvIzov5nmmK/mnKzmlofku7ZcbiAqIOS4pOS4quiuvuiuoemavueCue+8iOaWueWQkeOAgeW6j+S9jeWuieWFqOaAp++8ieWUr+S4gOeahOWuuemUmeadpea6kO+8jOS4i+mdoumAkOS4gOivtOaYjuOAglxuICpcbiAqICMjIOiuvuiuoemavueCueS4gO+8muaVsOe7hOaWueWQkeS4jeWPr+S/oe+8jOW/hemhu+W9kuS4gOWMllxuICpcbiAqIOWPguiAg+WunueOsCBgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYCDph4wgYGFwaURhdGEuRGF0YS5SZXZlcnNlKClgXG4gKiDor4Hlrp7vvJpBUEkg5ZON5bqU5pys6Lqr5pivKirlgJLluo8qKu+8iOacgOaWsOeahOiusOW9leaOkuacgOWJjemdou+8ie+8jOWPguiAg+WunueOsOaLv+WIsOWTjeW6lOWQjlxuICog5pW05L2T5Y+N6L2s5LiA5qyh5omN5L2/55So44CCYGV4dHJhY3RMaXN0YO+8iOingSBgLi9tYW5pZmVzdC50c2DvvInkuI3mlLnlj5jmlbDnu4Tpobrluo/vvIxcbiAqIOWOn+agt+aKiui/meS4quWAkuW6j+aVsOe7hOS6pOe7mSBgZmllbGRzLmV4dHJhY3RSZWNvcmRg77yM5YaN5Lqk57uZ5pys5paH5Lu255qEXG4gKiBgZGVyaXZlUmVjb3JkS2V5c2DigJTigJTkuZ/lsLHmmK/or7TvvIzmnKwgaG9vayDmi7/liLDnmoTorrDlvZXpobrluo8qKue7p+aJv+iHqiBBUEkg55qEXG4gKiDnnJ/lrp7ov5Tlm57pobrluo/vvIzmlrnlkJHkuI3nlLHmj5Lku7boh6rlt7HmjqfliLYqKuOAglxuICpcbiAqIOiLpeW6j+S9jeebtOaOpeaMiei+k+WFpeaVsOe7hOS4i+agh+iuoeeul++8jOiAjOS4pOasoemHh+mbhuS5i+mXtOaVsOe7hOaWueWQkeWPkeeUn+WPmOWMlu+8iOS+i+WmguacquadpVxuICog5pyJ5Luj56CB5ZyoIGBleHRyYWN0TGlzdGAg5LiO5pysIGhvb2sg5LmL6Ze05o+S5YWl5LqG5LiA5qyh5Y+N6L2s44CB5oiWIEFQSSDmnKzouqvnmoTmjpLluo9cbiAqIOe6puWumuWPkeeUn+WPmOWMlu+8ie+8jOWQjOS4gOaJueiusOW9leS8mueul+WHuuS4jeWQjOeahOW6j+S9je+8jGByZWNvcmRfa2V5YCDlsLHkvJrmvILnp7tcbiAqIOKAlOKAlOi/meato+aYryBgUGx1Z2luSG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5bmC562J5oCn6KaB5rGC77yIXCLlkIzkuIDmnaHlrp7pmYXorrDlvZXvvIxcbiAqIOS7u+aEj+aXtumXtOS7u+aEj+asoemHh+mbhumDveW/hemhu+S6p+WHuuebuOWQjOeahCBrZXlcIu+8ieS8muiiq+aJk+egtOeahOWcsOaWueOAglxuICpcbiAqICoq6Kej5Yaz5pa55qGI77ya5pi+5byP5b2S5LiA5YyW77yM5LiN5YGH6K6+5pa55ZCR5LiN5Y+Y44CCKiog5q+U6L6D5pWw57uE6aaW5bC+5Lik5p2h6K6w5b2V55qE5pe26Ze077yMXG4gKiDoi6XpppYgPiDlsL7vvIjlgJLluo/vvInvvIzlhYjmiormlbTkuKrmlbDnu4Tlj43ovazmiJBcIuaXp+KGkuaWsFwi55qE5q2j5bqP5YaN6K6h566X5bqP5L2N77yb6Iul6aaWIDw9XG4gKiDlsL7vvIjlt7Lnu4/mmK/mraPluo/vvIzmiJbmlbDnu4Tplb/luqYgPD0gMSDml6Dms5XliKTmlq3mlrnlkJHvvInvvIzmjInljp/moLflpITnkIbjgILov5nkuKrlvZLkuIDljJZcbiAqIOS5i+aJgOS7peato+ehruOAgeS4lOS4jemcgOimgeWvuVwi57uE5YaF6aG65bqP5piv5ZCm5Lmf6KKr5q2j56Gu6L+Y5Y6fXCLlj6bkvZzor4HmmI7vvJpBUEkg5ZON5bqU5piv5a+5XG4gKiAqKuaVtOS4quaVsOe7hCoq5YGa5LiA5qyh5Y2V5LiA5pa55ZCR55qE5o6S5bqP77yI5LiN5pivXCLnu4Tpl7TlgJLluo/jgIHnu4TlhoXlj6bmnInni6znq4vpobrluo9cIu+8ie+8jFxuICogYGFwaURhdGEuRGF0YS5SZXZlcnNlKClgIOivgeWunuWPguiAg+WunueOsOWkhOeQhueahOaYr+WvueaVtOS4quaVsOe7hOeahOaVtOS9k+WPjei9rOKAlOKAlFxuICog5pW05L2T5Y+N6L2s5piv6Ieq6Lqr55qE6YCG5pON5L2c77yM5q+U6L6D6aaW5bC+5Yik5pat5pa55ZCR5ZCO5oyJ6ZyA5pW05L2T5Y+N6L2s5LiA5qyh77yM5b6X5Yiw55qE5q2j5bqPXG4gKiDmlbDnu4TkuI5cIkFQSSDkuIDlvIDlp4vlsLHov5Tlm57mraPluo9cIuaXtumAkOS9jee9ruWujOWFqOS4gOiHtO+8jOWMheaLrOe7hOWGheaIkOWRmOeahOebuOWvuemhuuW6j+OAglxuICpcbiAqIOW9kuS4gOWMluS5i+WQjuWGjeaMie+8iOeOsOW3suS/neivgeaYr+ato+W6j+eahO+8ieaVsOe7hOS4i+agh+mhuuW6j+e7meavj+S4qiBgKGJhbm5lcklkLCB0aW1lKWBcbiAqIOWIhue7hOWGheeahOiusOW9lee8luWPt++8jOacgOWQjuaKiueul+WHuueahCBrZXkg5YaZ5ZueKirljp/lp4vovpPlhaXkuIvmoIcqKuWvueW6lOeahOS9jee9ruKAlOKAlFxuICog6L+U5Zue5YC85b+F6aG75LiO6L6T5YWlIGByZWNvcmRzYCDpgJDkvY3nva7lr7nlupTvvIzov5nmmK8gYFBsdWdpbkhvb2tzLmRlcml2ZVJlY29yZEtleXNgXG4gKiDnmoTlpZHnuqbvvIhcIui/lOWbnuWAvOW/hemhu+S4jui+k+WFpeetiemVv+OAgeaMiei+k+WFpemhuuW6j+S4gOS4gOWvueW6lFwi77yJ44CCXG4gKlxuICogIyMg6K6+6K6h6Zq+54K55LqM77yaQVBJIOWTjeW6lOe6v+agvOW8j+acque7j+aKk+WMhemqjOivge+8jGtleSDkuI3og73nm7TmjqXlk4jluIzljp/lp4vlrZfnrKbkuLJcbiAqXG4gKiDlj4LogIPlrp7njrDlj43luo/liJfljJYgQVBJIOWTjeW6lOaXtu+8jGBNb2RlbHMvR2FjaGFEYXRhLmNzYCDnmoQgYFRpbWVgIOWtl+auteaYr+W8ulxuICog57G75Z6LIGBEYXRlVGltZWDigJTigJTnur/moLzlvI/lnKjlj43luo/liJfljJbpgqPkuIDmraXlsLHooqvor63oqIDov5DooYzml7blkIPmjonkuobvvIzmupDnoIHph4znnItcbiAqIOS4jeWHuiBBUEkg5Yiw5bqV5Y+R55qE5pivIGAyMDI0LTA2LTA2VDEwOjIzOjQ4YO+8iElTT++8iei/mOaYr1xuICogYDIwMjQvMDYvMDYgMTA6MjM6NDhg77yI5pac5p2g77yJ6L+Y5piv5Yir55qE5YaZ5rOV77yb5pys5Zyw5a2Y5qGj6YeM5Ye6546w55qEIElTTyDmoLzlvI/mmK9cbiAqIE5ld3RvbnNvZnQg5bqP5YiX5YyWIGBEYXRlVGltZWAg55qE6buY6K6k5Lqn54mp77yM5LiN5Luj6KGoIEFQSSDlk43lupTmnKzouqvnmoTnur/moLzlvI/vvJtcbiAqIGBEYXRlRm9ybWF0U3RyaW5nID0gXCJ5eXl5L01NL2RkIGhoOm1tOnNzXCJgIOWPquWcqOWPjeW6j+WIl+WMlui3r+W+hOS4iueUn+aViOeahOivgeaNrlxuICog5b6I5byx77yM5LiN6Laz5Lul5a6a6K6677yb5pys5LuT5bqT5rKh5pyJ6bij5r2uIEFQSSDnmoTnnJ/lrp7mipPljIXmoLfmnKzog73pqozor4HjgIJcbiAqXG4gKiDoi6UgYGRlcml2ZVJlY29yZEtleXNgIOebtOaOpeaKiiBgcmVjb3JkLnRpbWVgIOWOn+Wni+Wtl+espuS4suaLvOi/m+WTiOW4jOi+k+WFpe+8jOS4gOaXplxuICog57q/5qC85byP54yc6ZSZ4oCU4oCU5oiW6ICF5pel5ZCOIEFQSSDmjaLkuobkuKrliIbpmpTnrKbigJTigJTmiYDmnIkga2V5IOmDveS8muS4jumihOacn+S4jeWQjO+8muS4jeS8mlxuICog5oql6ZSZ77yM5Y+q5Lya6Z2Z6buY6YeN5aSN5YWl5bqT77yM5oiW6ICF6K6p5bey5YWl5bqT55qEIGtleSDkuI7mlrDph4fpm4bnrpflh7rnmoQga2V5IOWvueS4jeS4iu+8jFxuICog5LiOIEhvWW8uR2FjaGEg5Zug5Li6IGByZWNvcmRfa2V5YCDorr7orqHkuI3liLDkvY3ku5jlh7rov4fkuIDmrKHmlbTooajph43lu7rov4Hnp7vmmK/lkIzkuIDnsbtcbiAqIOS7o+S7t+OAglxuICpcbiAqICoq6Kej5Yaz5pa55qGI77ya5YWI5oqKIGB0aW1lYCDop4TojIPljJbmiJDkuI7nur/moLzlvI/ml6DlhbPnmoTlvaLlvI/vvIzlho3lj4LkuI7lk4jluIwqKu+8jOingeS4i+aWuVxuICogYG5vcm1hbGl6ZVRpbWVGb3JLZXlg44CCXG4gKi9cbmltcG9ydCB0eXBlIHsgUGx1Z2luSG9va3MsIFVuaWZpZWRSZWNvcmRGaWVsZHMgfSBmcm9tIFwiZ3MtcGx1Z2luLWtpdFwiO1xuXG4vKipcbiAqIOaKiiBBUEkg5ZON5bqU55qEIGB0aW1lYCDlrZfmrrXop4TojIPljJbmiJDkuI7nur/moLzlvI/ml6DlhbPjgIHlj6/nm7TmjqXmjInlrZfnrKbkuLLmr5TovoPlpKflsI/nmoRcbiAqIOW9ouW8j++8iGBZWVlZTU1EREhIbW1zc2DvvIwxNCDkvY3nuq/mlbDlrZfvvInjgIJcbiAqXG4gKiBgMjAyNC0wNi0wNlQxMDoyMzo0OGAg5LiOIGAyMDI0LzA2LzA2IDEwOjIzOjQ4YCDlvZLkuIDlkI7pg73mmK9cbiAqIGBcIjIwMjQwNjA2MTAyMzQ4XCJg4oCU4oCU55So5q2j5YiZ5ouG5Ye65bm0L+aciC/ml6Uv5pe2L+WIhi/np5Llha3kuKrmlbDlrZfliIbph4/lho3mi7zmjqXvvIxcbiAqIOWIhumalOespuacrOi6q++8iGAtYC9gL2AvYFRgL+epuuagvO+8ieiiq+ato+WImeebtOaOpeWQg+aOieOAgeS4jeW9seWTjeW9kuS4gOWMlue7k+aenOOAglxuICpcbiAqIOKaoO+4jyAqKuS4jeeUqCBgbmV3IERhdGUoLi4uKWAg6Kej5p6QKirvvJpgRGF0ZWAg5p6E6YCg5Ye95pWw5a+55LiN5bim5pe25Yy65ZCO57yA55qE5a2X56ym5LiyXG4gKiDmjIkq6L+Q6KGM546v5aKD5pys5Zyw5pe25Yy6Kuino+mHiu+8jOWQjOS4gOS4quWtl+espuS4suWcqOS4jeWQjOacuuWZqC/kuI3lkIzml7bljLrkuIrot5Hlh7rnmoRcbiAqIGBEYXRlYCDlr7nosaHku6PooajnmoTnu53lr7nml7bliLvkuI3lkIzigJTigJTov5nkuI5cIue6r+WHveaVsOOAgee7k+aenOWPquWPluWGs+S6jui+k+WFpVwi6L+Z5p2h56GsXG4gKiDnuqbmnZ/nm7TmjqXlhrLnqoHvvIhgUGx1Z2luSG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5b+F6aG75piv57qv5Ye95pWw77yMVFMg6L+Q6KGM546v5aKDXG4gKiDniannkIbkuIrkuZ/kuI3mj5Dkvpvog73mm7/ku6MgYERhdGVgIOacrOWcsOaXtuWMuuihjOS4uueahOaXtuWMuuaVsOaNruW6k++8ieOAguaUueeUqOato+WImeebtOaOpeaLhlxuICog5pWw5a2X5YiG6YeP77yM5LiN57uP6L+HIGBEYXRlYO+8jOinhOiMg+WMlue7k+aenOS4jui/kOihjOeOr+Wig+aXoOWFs+OAglxuICpcbiAqIOKaoO+4jyAqKuaXoOazleivhuWIq+eahOagvOW8j+W/hemhu+aKpemUme+8jOS4jeiDvemdmem7mOWbnuiQveWIsOWOn+Wni+Wtl+espuS4sioq77ya6Z2Z6buY5Zue6JC9562J5LqOXG4gKiBcIuWFiOW9kuS4gOWMluWGjeWTiOW4jFwi6L+Z5bGC5L+d5oqk5a6M5YWo5LiN5a2Y5Zyo4oCU4oCU5pys6aG555uu5bey57uP5aSa5qyh5oqT5YiwXCLnnIvotbfmnaXmnInpmLLmiqTjgIFcbiAqIOWunumZheS7gOS5iOmDveayoeWBmlwi6L+Z5LiA57G75aSx5pWI5qih5byP77yM6L+Z6YeM5LiN6IO96YeN6LmI44CCXG4gKlxuICog55uu5YmN5Y+q6K6k5Lik56eN5bey55+l5YCZ6YCJ5qC85byP77yISVNPIOeahCBgLWAvYFRgIOWIhumalOOAgeWPguiAg+WunueOsOaal+ekuueahCBgL2Av56m65qC8XG4gKiDliIbpmpTvvInvvJvoi6XmnKrmnaXnnJ/lrp7mipPljIXlj5HnjrDnrKzkuInnp43moLzlvI/vvIzov5nph4zpnIDopoHlkIzmraXmianlsZXmraPliJnvvIzogIzkuI3mmK/mlL7lrr1cbiAqIOWIsFwi6ZqP5L6/5LuA5LmI6YO95pS2XCLjgIJcbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplVGltZUZvcktleSh0aW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IC9eKFxcZHs0fSlbLS9dKFxcZHsyfSlbLS9dKFxcZHsyfSlbVCBdKFxcZHsyfSk6KFxcZHsyfSk6KFxcZHsyfSkkLy5leGVjKHRpbWUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYOm4o+a9riBkZXJpdmVSZWNvcmRLZXlz77ya5peg5rOV6K+G5Yir55qE5pe26Ze05qC85byPIFwiJHt0aW1lfVwi4oCU4oCU57q/5qC85byP5pyq57uP5oqT5YyF6aqM6K+B77yM5ouS57ud5Zyo54yc5rWL55qE5qC85byP5LiK6K6h566XIHJlY29yZF9rZXlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgWywgeWVhciwgbW9udGgsIGRheSwgaG91ciwgbWludXRlLCBzZWNvbmRdID0gbWF0Y2g7XG4gIHJldHVybiBgJHt5ZWFyfSR7bW9udGh9JHtkYXl9JHtob3VyfSR7bWludXRlfSR7c2Vjb25kfWA7XG59XG5cbi8qKlxuICogRk5WLTFhIDMyIOS9jeWTiOW4jO+8jOe6r+S9jei/kOeul+WunueOsO+8jOS4jeS+nei1luS7u+S9lSBOb2RlL1dlYiDliqDlr4YgQVBJ4oCU4oCUVFMg5L6n6L+Q6KGMXG4gKiDnjq/looPniannkIbkuIrkuI3mj5DkvpsgYGNyeXB0b2DvvIzmj5Lku7bku6PnoIHlj6rog73nlKjor63oqIDlhoXnva7og73lipvvvIhgY2hhckNvZGVBdGAvXG4gKiBgTWF0aC5pbXVsYC/np7vkvY3ov5DnrpfvvIxFUzIwMjIg5qCH5YeGIEpT77yM5Lu75L2V6YG15b6q6KeE6IyD55qE5byV5pOO6YO96IO96LeR77yM5YyF5ous5a6/5Li7XG4gKiDlhoXltYznmoQgUXVpY2tKU++8ieOAglxuICpcbiAqIOWPquWvuSBBU0NJSSDlrZfnrKbmraPnoa7vvJrmnKzmlofku7bllK/kuIDnmoTosIPnlKjngrnkvKDlhaXnmoTmmK9cbiAqIGBKU09OLnN0cmluZ2lmeShbYmFubmVySWQsIG5vcm1hbGl6ZWRUaW1lLCBpdGVtSWQsIHNlcUluR3JvdXBdKWDvvIzlm5vkuKpcbiAqIOWIhumHj+WIhuWIq+aYr+e6r+aVsOWtl+Wtl+espuS4su+8iFBvb2xUeXBlIGlk44CBYG5vcm1hbGl6ZVRpbWVGb3JLZXlgIOeahOi+k+WHuuOAgVxuICogYHJlc291cmNlSWRgIOi9rOeahOWtl+espuS4suOAgeaJueasoeWGheW6j+S9je+8ieWKoCBKU09OIOacrOi6q+eahOagh+eCue+8jOmAkOWtl+espumDveWcqFxuICogQVNDSUkg6IyD5Zu05YaF77yMYGNoYXJDb2RlQXRgIOS4juWtl+iKguWAvOS4gOS4gOWvueW6lO+8jOS4jemcgOimgeWkhOeQhuWkmuWtl+iKguWtl+espuOAglxuICovXG5mdW5jdGlvbiBmbnYxYTMyKGlucHV0OiBzdHJpbmcsIG9mZnNldEJhc2lzOiBudW1iZXIpOiBzdHJpbmcge1xuICBsZXQgaGFzaCA9IG9mZnNldEJhc2lzID4+PiAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGlucHV0Lmxlbmd0aDsgaSArPSAxKSB7XG4gICAgaGFzaCBePSBpbnB1dC5jaGFyQ29kZUF0KGkpO1xuICAgIGhhc2ggPSBNYXRoLmltdWwoaGFzaCwgMHgwMTAwMDE5MykgPj4+IDA7XG4gIH1cbiAgcmV0dXJuIGhhc2gudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDgsIFwiMFwiKTtcbn1cblxuLyoqIOagh+WHhiBGTlYtMWEgMzIg5L2N5YGP56e75Z+65YeG44CCICovXG5jb25zdCBGTlZfT0ZGU0VUX0JBU0lTX0EgPSAweDgxMWM5ZGM1O1xuLyoqXG4gKiDnrKzkuozkuKrlgY/np7vln7rlh4bvvIzlj6ropoHmsYLkuI4gQSDkuI3lkIzigJTigJTnlKjmnaXmiorkuKTmrKHni6znq4vnmoQgMzIg5L2N5ZOI5biM5ou85oiQ5LiA5LiqXG4gKiAxNiDkvY3ljYHlha3ov5vliLbvvIg2NCDkvY3vvInnmoTlpI3lkIgga2V577yM6ZmN5L2O5Y2V54us5LiA5LiqIDMyIOS9jeWTiOW4jOWcqOWHoOWNg+adoeiusOW9lVxuICog6KeE5qih5LiL55qE55Sf5pel56Kw5pKe5qaC546H77yIYHNxcnQoMl4zMikg4omIIDY1NTM2YO+8jOS4gOS4qui0puWPt+eahOiusOW9leaVsOmHj+e6p+W3sue7j1xuICog5aSf5LiN5LiK5pS+5b+D5Y+q55SoIDMyIOS9je+8ieOAguWPluWAvOacrOi6q+ayoeacieeJueauiuWQq+S5ie+8jOWPquimgeaxguaYr+S4gOS4quS4jiBBIOS4jeWQjOeahFxuICog5Zu65a6a5bi46YeP44CCXG4gKi9cbmNvbnN0IEZOVl9PRkZTRVRfQkFTSVNfQiA9IDB4OWUzNzc5Yjk7XG5cbi8qKlxuICog6K6h566X5Y2V5p2h6K6w5b2V55qEIGByZWNvcmRfa2V5YOOAglxuICpcbiAqIOeUqCBgSlNPTi5zdHJpbmdpZnlgIOaKiuWbm+S4quWIhumHj+W6j+WIl+WMluaIkOS4gOS4quaVsOe7hOWtl+espuS4su+8jOiAjOS4jeaYr+eUqOWIhumalOesplxuICog77yI5aaCIGA6YO+8ieaJi+W3peaLvOaOpeKAlOKAlGBub3JtYWxpemVkVGltZWAg5YaF6YOo5YWo5piv5pWw5a2X5rKh5pyJ5q2n5LmJ77yM5L2GIEpTT04g55qEXG4gKiDovazkuYnop4TliJnog73kv53or4FcIuS4jeWQjOeahOi+k+WFpeWFg+e7hOS4jeS8muaLvOWHuuWQjOS4gOS4quWtl+espuS4slwi6L+Z5p2h5oCn6LSo5Zyo5Lu75L2V5pyq5p2lXG4gKiDliIbph4/nsbvlnovlj5jljJbml7bkvp3nhLbmiJDnq4vvvIzmr5TmiYvlt6XmjJHkuIDkuKpcIueci+i1t+adpeS4jeS8muWHuueOsOWcqOWtl+autemHjFwi55qE5YiG6ZqU56ymXG4gKiDmm7Tlj6/pnaDjgIJcbiAqL1xuZnVuY3Rpb24gaGFzaFJlY29yZEtleShiYW5uZXJJZDogc3RyaW5nLCBub3JtYWxpemVkVGltZTogc3RyaW5nLCBpdGVtSWQ6IHN0cmluZywgc2VxSW5Hcm91cDogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgY2Fub25pY2FsID0gSlNPTi5zdHJpbmdpZnkoW2Jhbm5lcklkLCBub3JtYWxpemVkVGltZSwgaXRlbUlkLCBzZXFJbkdyb3VwXSk7XG4gIHJldHVybiBgJHtmbnYxYTMyKGNhbm9uaWNhbCwgRk5WX09GRlNFVF9CQVNJU19BKX0ke2ZudjFhMzIoY2Fub25pY2FsLCBGTlZfT0ZGU0VUX0JBU0lTX0IpfWA7XG59XG5cbmV4cG9ydCBjb25zdCBob29rczogUGx1Z2luSG9va3MgPSB7XG4gIGRlcml2ZVJlY29yZEtleXM6IChyZWNvcmRzOiBVbmlmaWVkUmVjb3JkRmllbGRzW10pOiBzdHJpbmdbXSA9PiB7XG4gICAgY29uc3QgdG90YWwgPSByZWNvcmRzLmxlbmd0aDtcbiAgICBpZiAodG90YWwgPT09IDApIHJldHVybiBbXTtcblxuICAgIC8vIOaXtumXtOe6v+agvOW8j+aXoOWFs++8muWFiOe7n+S4gOinhOiMg+WMlu+8jOWHuueOsOaXoOazleivhuWIq+eahOagvOW8j+eri+WIu+aKpemUme+8iOingVxuICAgIC8vIG5vcm1hbGl6ZVRpbWVGb3JLZXkg5paH5qGj77yJ77yM5LiN5YWB6K645p+Q5LiA5p2h6K6w5b2V5oKE5oKE55So5Y6f5aeL5a2X56ym5Liy5Y+C5LiO5ZOI5biM44CCXG4gICAgY29uc3Qgbm9ybWFsaXplZFRpbWVzID0gcmVjb3Jkcy5tYXAoKHJlY29yZCkgPT4gbm9ybWFsaXplVGltZUZvcktleShyZWNvcmQudGltZSkpO1xuXG4gICAgLy8g5pa55ZCR5b2S5LiA5YyW77ya5q+U6L6D6aaW5bC+5Lik5p2h6K6w5b2V55qE6KeE6IyD5YyW5pe26Ze044CC6aaWID4g5bC+6K+05piO5pWw57uE5piv5YCS5bqPXG4gICAgLy8g77yIQVBJIOecn+Wunui/lOWbnueahOmhuuW6j++8jOWPguiAg+WunueOsOeUqCBhcGlEYXRhLkRhdGEuUmV2ZXJzZSgpIOWkhOeQhu+8ie+8jOmcgOimgVxuICAgIC8vIOaMiVwi5Y6f5aeL6L6T5YWl5LiL5qCHXCLliLBcIuato+W6j+mBjeWOhumhuuW6j1wi5bu656uL5LiA5Lu95pig5bCE77yb5ZCm5YiZ77yI5bey57uP5piv5q2j5bqP77yM5oiWXG4gICAgLy8g6ZW/5bqmIDw9IDEg5peg5rOV5Yik5pat5pa55ZCR77yJ55u05o6l5oyJ5Y6f5aeL5LiL5qCH6YGN5Y6G44CC6KeB5paH5Lu25aS06YOoXCLorr7orqHpmr7ngrnkuIBcIuOAglxuICAgIC8vXG4gICAgLy8g5LiL5qCH6K6/6Zeu5ZyoIG5vVW5jaGVja2VkSW5kZXhlZEFjY2VzcyDkuIvnsbvlnovmmK8gYHN0cmluZyB8IHVuZGVmaW5lZGDigJTigJRcbiAgICAvLyDov5nph4zkuI3nlKjpnZ7nqbrmlq3oqIAv57G75Z6L6L2s5o2i5YGH6KOFXCLogq/lrprkuI3kvJrplJlcIu+8jOiAjOaYr+aYvuW8j+WIpOepuuWQjuaKm+WGhemDqOmUmeivr1xuICAgIC8vIO+8iOS4jiBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L3Rlc3RraXQvaW5kZXgudHMg5aSE55CG5ZCM57G75oOF5b2i55qE5YaZ5rOV5LiA6Ie077yJ77yMXG4gICAgLy8g55CG6K665LiK5LiN5Lya6Kem5Y+R77yaZmlyc3RUaW1lL2xhc3RUaW1lIOeahOS4i+agh+aBkuWcqCBbMCwgdG90YWwpIOWGheOAglxuICAgIGNvbnN0IGZpcnN0VGltZSA9IG5vcm1hbGl6ZWRUaW1lc1swXTtcbiAgICBjb25zdCBsYXN0VGltZSA9IG5vcm1hbGl6ZWRUaW1lc1t0b3RhbCAtIDFdO1xuICAgIGlmIChmaXJzdFRpbWUgPT09IHVuZGVmaW5lZCB8fCBsYXN0VGltZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCLpuKPmva4gZGVyaXZlUmVjb3JkS2V5cyDlhoXpg6jplJnor6/vvJrml6Dms5Xlj5bliLDpppYv5bC+6K6w5b2V55qE6KeE6IyD5YyW5pe26Ze0XCIpO1xuICAgIH1cbiAgICBjb25zdCBpc0Rlc2NlbmRpbmcgPSB0b3RhbCA+IDEgJiYgZmlyc3RUaW1lID4gbGFzdFRpbWU7XG5cbiAgICBjb25zdCBhc2NlbmRpbmdPcmRlcjogbnVtYmVyW10gPSBuZXcgQXJyYXkodG90YWwpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG90YWw7IGkgKz0gMSkge1xuICAgICAgYXNjZW5kaW5nT3JkZXJbaV0gPSBpc0Rlc2NlbmRpbmcgPyB0b3RhbCAtIDEgLSBpIDogaTtcbiAgICB9XG5cbiAgICAvLyDmjInvvIjlt7Lkv53or4HmraPluo/nmoTvvInpgY3ljobpobrluo/vvIzlr7nmr4/kuKogKGJhbm5lcklkLCDop4TojIPljJbml7bpl7QpIOWIhue7hOWGheeahFxuICAgIC8vIOiusOW9lee8luWPt++8jOe8luWPt+WNs1wi5om55qyh5YaF5bqP5L2NXCLvvJvnrpflh7rnmoQga2V5IOWGmeWbnuWOn+Wni+i+k+WFpeS4i+agh+WvueW6lOeahOS9jee9ruOAglxuICAgIGNvbnN0IHNlcUJ5R3JvdXAgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGNvbnN0IGtleXMgPSBuZXcgQXJyYXk8c3RyaW5nPih0b3RhbCk7XG4gICAgZm9yIChjb25zdCBvcmlnaW5hbEluZGV4IG9mIGFzY2VuZGluZ09yZGVyKSB7XG4gICAgICBjb25zdCByZWNvcmQgPSByZWNvcmRzW29yaWdpbmFsSW5kZXhdO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZFRpbWUgPSBub3JtYWxpemVkVGltZXNbb3JpZ2luYWxJbmRleF07XG4gICAgICBpZiAocmVjb3JkID09PSB1bmRlZmluZWQgfHwgbm9ybWFsaXplZFRpbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyDkuI3lupTlj5HnlJ/vvJpvcmlnaW5hbEluZGV4IOeUseS4iumdoueahOW+queOr+eUn+aIkO+8jOWPluWAvOiMg+WbtOaBkuWcqCBbMCwgdG90YWwp44CCXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihg6bij5r2uIGRlcml2ZVJlY29yZEtleXMg5YaF6YOo6ZSZ6K+v77ya5LiL5qCHICR7b3JpZ2luYWxJbmRleH0g5aSE55qE6K6w5b2V5oiW6KeE6IyD5YyW5pe26Ze057y65aSxYCk7XG4gICAgICB9XG4gICAgICAvLyDimIUg5YiG57uE6ZSu5b+F6aG75YyF5ZCrIGl0ZW1JZO+8jOS4jeiDveWPquaMiSAoYmFubmVySWQsIOaXtumXtCkg5YiG57uE44CCXG4gICAgICAvL1xuICAgICAgLy8g5bqP5L2N5a2Y5Zyo55qE5ZSv5LiA55uu55qE77yM5piv5Yy65YiGKirpgJDlrZfmrrXlrozlhajnm7jlkIzjgIHlkKbliJnml6Dms5XljLrliIYqKueahOiusOW9leOAglxuICAgICAgLy8g55yf5a6e5a2Y5qGj5a6e5rWL77yIYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKn5LiA77yJ6YeM5ZCM56eSXG4gICAgICAvLyDnorDmkp7nu4TlhbEgNTA4IOe7hOOAgee7hOWGheiusOW9lemAkOWtl+auteWFqOetie+8m+ivpeWuoeiuoSDCpzEuNyDikaIg57uZ5Ye655qE5a6J5YWo5oCn6K666K+BXG4gICAgICAvLyDkuZ/mraPmmK/jgIznu4TlhoXorrDlvZXpgJDlrZfmrrXlrozlhajnm7jlkIwg4oaSIOS6pOaNouWug+S7rOS6p+WHuueahCBrZXkg5aSa6YeN6ZuG5LiN5Y+Y44CN44CCXG4gICAgICAvLyDov5nmnaHorrror4HmiJDnq4vnmoTliY3mj5DvvIzmmK/liIbnu4TmjIkqKuWFqOetieWtl+autSoq5YiS5YiG44CCXG4gICAgICAvL1xuICAgICAgLy8g6Iul5YiG57uE6ZSu5ryP5o6JIGl0ZW1JZO+8jOS4gOasoeWNgei/nu+8iDEwIOadoeWQjOenkuOAgeS9hueJqeWTgeWQhOS4jeebuOWQjOeahOiusOW9le+8ieS8muiiq1xuICAgICAgLy8g5aGe6L+b5ZCM5LiA57uE5ou/5Yiw5bqP5L2NIDB+Oe+8jOS6juaYr+avj+adoeiusOW9leeahCBrZXkg6YO95Y+W5Yaz5LqO5a6D5Zyo5pWw57uE6YeM55qE5L2N572u44CCXG4gICAgICAvLyDlkI7mnpzlt7LlnKjlhajph4/nnJ/lrp7mlbDmja7vvIgzMzcxIOadoe+8ieS4iuWunua1i++8mlxuICAgICAgLy8gICAtIOaWueWQkei/neS+iyAxMCDmnaHigJTigJRQb29sVHlwZT0xMiDmlbTmibnlhbHnlKjlkIzkuIDkuKrml7bpl7TmiLPvvIzpppblsL7nm7jnrYnvvIxcbiAgICAgIC8vICAgICDkuIrpnaLpgqPlpZdcIuavlOi+g+mmluWwvuWIpOaWueWQkVwi55qE6YC76L6R5aSx5pWI77yM5q2j5bqPL+WAkuW6j+WWguWFpeS6p+WHuuS4pOWllyBrZXnvvJtcbiAgICAgIC8vICAgLSAqKuWinumVv+eos+WumuaAp+i/neS+iyAyMCDmnaEqKuKAlOKAlOi/meadoeaJjeecn+ato+S8muS8pOWIsOeUqOaIt++8muaVtOaxoOWFqOmHj+aLieWPluS4i++8jFxuICAgICAgLy8gICAgIOWQjuS4gOasoemHh+mbhuW/heeEtuavlOWJjeS4gOasoeiusOW9leabtOWkmu+8jOS4gOaXpuiusOW9leWPmOWkmuiuqeaWueWQkeWIpOWumuS7jlwi5Yik5LiN5Ye6XCJcbiAgICAgIC8vICAgICDnv7vovazmiJBcIuWIpOW+l+WHulwi77yM5pep5YWI6YKj5om56K6w5b2V55qE5bqP5L2N5Lya5pW05L2T5Y+N6L2s44CBa2V5IOWFqOWPmO+8jOS6juaYr+iiq1xuICAgICAgLy8gICAgIOW9k+aIkOaWsOiusOW9lSoq6YeN5aSN5YWl5bqTKirjgIJcbiAgICAgIC8vIOaKiiBpdGVtSWQg5bm26L+b5YiG57uE6ZSu5ZCO77yM5LiK6L+w5Lik6aG55a6e5rWL5YiG5Yir6ZmN5Li6IDIg5LiOIDDvvJvliankuIvpgqMgMiDmnaHnu49cbiAgICAgIC8vIOaguOWvuemDveaYr+OAjOS4juWPpuS4gOadoemAkOWtl+auteWFqOetieOAjeeahOiusOW9leS6kuaNouS6hiBrZXnigJTigJTorrDlvZXmnKzouqvkuI3lj6/ljLrliIbvvIxcbiAgICAgIC8vIOWFqOmDqCA1IOS4qumdnuepuuaxoOeahCBrZXkg5aSa6YeN6ZuG5Z2H5LiA6Ie077yM5Y676YeN57uT5p6c5a6M5YWo562J5Lu344CCXG4gICAgICAvL1xuICAgICAgLy8g5YiG6ZqU56ym55So5pmu6YCa56m65qC85Y2z5Y+v77yaYmFubmVySWQg5piv57qv5pWw5a2XIFBvb2xUeXBlIGlk77yMbm9ybWFsaXplZFRpbWVcbiAgICAgIC8vIOaYryBub3JtYWxpemVUaW1lRm9yS2V5IOS6p+WHuueahCAxNCDkvY3nuq/mlbDlrZflrZfnrKbkuLLvvIxpdGVtSWQg5piv57qv5pWw5a2XXG4gICAgICAvLyByZXNvdXJjZUlk77yM5LiJ6ICF6YO95LiN5Y+v6IO95ZCr56m65qC877yM5LiN5Lya5Ye6546w5ou85o6l5q2n5LmJ44CCXG4gICAgICBjb25zdCBncm91cEtleSA9IGAke3JlY29yZC5iYW5uZXJJZH0gJHtub3JtYWxpemVkVGltZX0gJHtyZWNvcmQuaXRlbUlkfWA7XG4gICAgICBjb25zdCBzZXFJbkdyb3VwID0gc2VxQnlHcm91cC5nZXQoZ3JvdXBLZXkpID8/IDA7XG4gICAgICBzZXFCeUdyb3VwLnNldChncm91cEtleSwgc2VxSW5Hcm91cCArIDEpO1xuICAgICAga2V5c1tvcmlnaW5hbEluZGV4XSA9IGhhc2hSZWNvcmRLZXkocmVjb3JkLmJhbm5lcklkLCBub3JtYWxpemVkVGltZSwgcmVjb3JkLml0ZW1JZCwgc2VxSW5Hcm91cCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGtleXM7XG4gIH0sXG59O1xuIiwiLyoqXG4gKiDpuKPmva7mj5Lku7YgbWFuaWZlc3TjgIJcbiAqXG4gKiDmnKzmlofku7bnlLEgTTItUzEvUzIg55qE57q46Z2i5aGr6KGo5ryU57uD6I2J56i/77yIYGRyaWxscy93dXdhL21hbmlmZXN0LnRzYO+8iei9rOWMluiAjOadpVxuICog4oCU4oCU5ryU57uD6aqM6K+B55qE5pivXCJTMiDmlLnov4fnmoTmj5Lku7blpZHnuqbnsbvlnovmmK/lkKboo4XlvpfkuIvpuKPmva7nmoTnnJ/lrp7lt67lvILngrlcIu+8jOacrOaWh+S7tlxuICog5piv5oqK6aqM6K+B57uT6K666JC95Zyw5oiQ55yf5q2j5o6l5YWlIGBwbHVnaW5zL2luZGV4LnRzYCDnmoTlj6/ov5DooYzmj5Lku7bjgILovazljJbov4fnqIvkuK1cbiAqIOWIoOaOieS6hua8lOe7g+aWh+S7tumHjOWkp+autVwi5Li65LuA5LmI5b2T5pe25aGr5LiN5LiLXCLnmoTov4fnqIvmgKfms6jph4rvvIjpgqPkupvnqbrnmb3lt7Lnu4/ooqtcbiAqIFMyL1MzIOeahOWlkee6puaUueWKqOWhq+W5s++8jOe7p+e7reS/neeVmeS8muivr+WvvOivu+iAheS7peS4uuWtl+auteS7jeeEtue8uuWkse+8ie+8jOWPquS/neeVmeS7jeeEtlxuICog5oiQ56uL55qE6aKG5Z+f55+l6K+G77yb5bey6I635b6X55yf5a6e5Y+C5pWw55qE5a2X5q6177yI6K+35rGCIGJvZHkg5YW35ZCN5Y2g5L2N56ym44CBXG4gKiBgYWxsb3dlZEhvc3RzYOOAgWBzdG9wQ29uZGl0aW9uYO+8ieaMieS4i+aWueazqOmHiumHjOeahOadpea6kOmHjeaWsOagoeWHhuWhq+WGmeOAglxuICpcbiAqIOaVsOaNruadpea6kO+8iOS4jeWHreiuree7g+iusOW/hue8lumAoOWtl+auteWQjS/mlbDlgLzvvInvvJpcbiAqIC0gYGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9XV0dhY2hhRXhwb3J0L1dXR2FjaGFFeHBvcnQvU2VydmljZXMvQ29uZmlnU2VydmljZS5jczoyOS00M2BcbiAqICAg77yIMTMg6aG5IGBQb29sVHlwZWAg6KGo77yM5p6E6YCg5Ye95pWw562+5ZCNIGBHYWNoYVBvb2xJbmZvKHBvb2xUeXBlLCBuYW1lLCBub29iUG9vbCxcbiAqICAgbGV2ZWxGaXZlTWF4RHJhdywgbGV2ZWxGb3VyTWF4RHJhdywgaW5oZXJpdCA9IHRydWUpYO+8jOacrOaWh+S7tuWunueOsOWJjeW3sumAkOihjOaguOWvuea6kOeggeWOn+aWh++8iVxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL1dXR2FjaGFFeHBvcnQvV1dHYWNoYUV4cG9ydC9WaWV3TW9kZWxzL0RpYWxvZ3MvVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYFxuICogICDvvIjml6Xlv5fot6/lvoTmi7zmjqXjgIHlvILmiJbop6Pmt7fmt4blj4LmlbDjgIFxdWVyeSDlj4LmlbAg4oaSIFBPU1QgYm9keSDlrZfmrrXmmKDlsITjgIFcbiAqICAgYGNhcmRQb29sVHlwZWAvYHBsYXllcklkYCDnmoQgQyMg57G75Z6L44CBVXNlci1BZ2VudOOAgeivt+axgiBob3N0IOS6jOmAieS4gOmAu+i+keOAgVxuICogICBgYXBpRGF0YS5EYXRhLlJldmVyc2UoKWAg55qE6LCD55So5L2N572u77yM5pys5paH5Lu25a6e546w5YmN5bey6YCQ6KGM5qC45a+55rqQ56CB5Y6f5paH77yJXG4gKiAtIGBkb2NzL19pbnRlcm5hbC9hdWRpdC9BVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYO+8iDMzNzEg5p2hXG4gKiAgIOecn+WunuWtmOaho+eahOWtl+auteexu+Wei+e7n+iuoeOAgWByZWNvcmRfa2V5YCDnorDmkp7njoflrp7mtYvjgIHkv53lupXpl7TpmpTkuI7pgJDmir3lkb3kuK3njofvvIlcbiAqIC0gYHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvbWFuaWZlc3QudHNg44CBYHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvdHlwZXMvZ2VuZXJhdGVkLnRzYFxuICogICDvvIhTMyDkuYvlkI7nmoTlpZHnuqbnsbvlnovvvJrlhbflkI3ljaDkvY3nrKYgYHt7Y3JlZGVudGlhbC48cXVlcnlQYXJhbT59fWDjgIFcbiAqICAgYFJlcXVlc3RUZW1wbGF0ZS5tZXRob2RgL2BoZWFkZXJzYC9gYm9keWDjgIFgU3RvcENvbmRpdGlvbi5zaW5nbGVSZXF1ZXN0YO+8iVxuICogLSBgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYO+8iGBSZXF1ZXN0VGVtcGxhdGVKc29uYCDkuIrmlrlcbiAqICAgXCLlt7Lnn6XnvLrlj6MgQzhcIiDms6jph4rvvJrlm73pmYXmnI0gaG9zdCDml6Dms5Xku44gYHN2cl9hcmVhYCDmjqjlh7ogVExE77yM5Yi75oSP5LiN6aKE5pS+XG4gKiAgIGAubmV0YO+8m2BzdWJzdGl0dXRlX25hbWVkX2NyZWRlbnRpYWxfcGxhY2Vob2xkZXJzYCDnmoTkuInmnaEgZmFpbC1jbG9zZWQg6KeE5YiZ77yJXG4gKlxuICog5LuN5pyq6Kej5Yaz44CB5aaC5a6e5qCH5rOo44CB5LiN57yW6YCg55qE57y65Y+j6KeB5a+55bqU5a2X5q615peB55qE5rOo6YeK77yaNOKYhS/lpJrmlbAgNeKYhSDmsaDnmoTmuJDov5tcbiAqIOamgueOh+eyvuehruaVsOWAvOacrOacuuagt+acrOS4jei2s+S7peagh+WumuOAgWByZXNvbHZlVGltZXpvbmVgIOe8uuWwkSBzdnJfaWQvc3ZyX2FyZWEg5YiwXG4gKiBVVEMg5YGP56e76YeP55qE55yf5a6e5pig5bCE6KGo44CB6IGU5Yqo5rGg55qEXCLmnJ/mrKHlhoXkv53lupXph43nva5cIuWPguiAg+WunueOsOWcqOecn+WunuaVsOaNruS4iuW3slxuICog5aSx5pWI5Zug6ICM5pys5o+S5Lu25LiN5a6e546w44CCXG4gKi9cbmltcG9ydCB0eXBlIHsgUGx1Z2luTWFuaWZlc3QgfSBmcm9tIFwiZ3MtcGx1Z2luLWtpdFwiO1xuXG4vLyDmiZPljIXohJrmnKzvvIhzY3JpcHRzL2dzLWJ1bmRsZS1wbHVnaW5zLm1qc++8ieS7jiBtYW5pZmVzdC50cyDov5nkuIDkuKrlhaXlj6PlkIzml7blj5Zcbi8vIG1hbmlmZXN0IOS4jiBob29rcyDkuKTkuKrlr7zlh7rvvIzkuI4gcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzIOeahOWGmeazleS4gOiHtOOAglxuZXhwb3J0IHsgaG9va3MgfSBmcm9tIFwiLi9ob29rcy50c1wiO1xuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICog5ZON5bqU6K6w5b2V55qEIGByZXNvdXJjZUlkYC9gcXVhbGl0eUxldmVsYCDmmK8gSlNPTiBudW1iZXLvvIhgTW9kZWxzL0dhY2hhQVBJLmNzYFxuICog55qEIGByZXNvdXJjZUlkOiBpbnRg44CBYHF1YWxpdHlMZXZlbDogaW50YO+8jOS4lOW3suiiq1xuICogYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKnMi4xIOeahOecn+WunuWtmOaho+Wtl+auteexu+Wei+e7n+iuoVxuICog54us56uL6K+B5a6e77yJ77yM5LiO57Gz5ZOI5ri45LiJ5ri4XCLmlbDlrZflrZfnrKbkuLJcIuS4jeWQjO+8jOWboOatpOWNleeLrOS4gOS4qui9rOaNouWHveaVsOOAglxuICovXG5mdW5jdGlvbiBudW1lcmljVG9TdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiBTdHJpbmcodmFsdWUpO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdHJpbW1lZCA6IHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIGBjb3VudDogaW50YO+8iGBNb2RlbHMvR2FjaGFBUEkuY3Ng77yM5ZCM5LiK5bey6KKr55yf5a6e5a2Y5qGj57uf6K6h54us56uL6K+B5a6e5oGS5Li65ZCM5LiAXG4gKiDmlbTmlbDlj5blgLzvvInjgILpmLLlvqHlvI/ovazmjaIgKyDlvILluLjlhZzlupXkuLogMe+8jOWuueW/jeWTjeW6lOW9ouaAgeS4juacrOacuuaguOWunueahOagt+acrOS4jeWujOWFqFxuICog5LiA6Ie055qE5oOF5Ya144CCXG4gKi9cbmZ1bmN0aW9uIHRvQ291bnQodmFsdWU6IHVua25vd24pOiBudW1iZXIge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlcih2YWx1ZSk7XG4gICAgaWYgKE51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gcGFyc2VkO1xuICB9XG4gIHJldHVybiAxO1xufVxuXG4vKipcbiAqIOS7jiBgUE9TVCBnbXNlcnZlci1hcGkuYWtpLWdhbWUyLmNvbS9nYWNoYS9yZWNvcmQvcXVlcnlgIOWTjeW6lOS9k+WPluWHuuivpVxuICogUG9vbFR5cGUg55qE5YWo6YOo6K6w5b2V5pWw57uE44CCXG4gKlxuICog4pqg77iPICoq5ZON5bqU5aSW5bGC5L+h5bCB5b2i5oCB5pys6Lqr56CU56m25pyq6KaG55uWKirvvJpgTW9kZWxzL0dhY2hhQVBJLmNzYCDnu5nlh7rnmoTmmK/ljZXmnaFcbiAqIOiusOW9leeahCBEVE8g5a2X5q6177yM5rKh5pyJ57uZ5Ye65ZON5bqU5aSW5bGC5L+h5bCB55qE5a6M5pW0IEpTT04g5b2i5oCB77yb5pys5py65rKh5pyJ6bij5r2uIEFQSVxuICog55qE55yf5a6e5oqT5YyF5qC35pys44CC6L+Z6YeM6Ziy5b6h5byP5YW85a6557Gz5ZOI5ri45LiJ5ri45ZCM5peP5o+S5Lu25bi46KeB55qE5Lik56eN5L+h5bCBXG4gKiDvvIhgeyBkYXRhOiBbLi4uXSB9YCDkuI4gYHsgZGF0YTogeyBsaXN0OiBbLi4uXSB9IH1g77yJ77yM5Lik6ICF6YO95pivKirnsbvmr5QqKu+8jFxuICog5LiN5piv5bey5qC45a6e5LqL5a6e77yM5Lu75L2V5LiA5bGC5b2i54q25LiN5a+55bCx6L+U5Zue56m65pWw57uE6ICM5LiN5piv5oqb5byC5bi44oCU4oCU5YiG6aG15byV5pOO5Lya5oqKXG4gKiDnqbrmlbDnu4TlvZPkvZznu4jmraLmnaHku7blpITnkIbvvIzmr5TorqnkuIDmrKHlk43lupTlvaLmgIHkuI3nrKbnm7TmjqXkuK3mlq3mlbTmnaHph4fpm4bmtYHnqIvmm7TlronlhajjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhUmVjb3JkTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmIChBcnJheS5pc0FycmF5KGRhdGEpKSByZXR1cm4gZGF0YTtcbiAgaWYgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIGRhdGEgIT09IG51bGwpIHtcbiAgICBjb25zdCBsaXN0ID0gKGRhdGEgYXMgeyBsaXN0PzogdW5rbm93biB9KS5saXN0O1xuICAgIGlmIChBcnJheS5pc0FycmF5KGxpc3QpKSByZXR1cm4gbGlzdDtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8qKlxuICogMTMg6aG5IGBQb29sVHlwZWAg6KGo77yM6YCQ5a2X5q615Y+W6IeqIGBTZXJ2aWNlcy9Db25maWdTZXJ2aWNlLmNzOjI5LTQzYCDljp/moLfooajmoLzvvJpcbiAqICAgYChQb29sVHlwZSwg5ZCN56ewLCDmmK/lkKbmlrDmiYvmsaAsIDXimIXnoazkv53lupUsIDTimIXnoazkv53lupUsIOS/neW6leaYr+WQpue7p+aJvylgXG4gKlxuICog5pys6KGo5L+d55WZ55yf5q2j55So5b6X5LiK55qE5LiJ5YiX77yaaWQgLyBkaXNwbGF5TmFtZSAvIGhhcmRQaXR5NVN0YXLvvIzlpJbliqBcbiAqIGBmaXZlU3Rhckd1YXJhbnRlZUtpbmRg77yI5pys5o+S5Lu26Ieq6KGM5b2S57qz77yM5LiN5ZyoIGBDb25maWdTZXJ2aWNlLmNzYCDljp/ooajph4zvvIxcbiAqIOingeS4i+aWueWNleeLrOivtOaYju+8ieOAgjTimIUg56Gs5L+d5bqV5oGS5Li6IDEw77yI6KeB5LiL5pa5IGBXVVdBXzRTVEFSX0hBUkRfUElUWWDvvInvvIzkuI3lho1cbiAqIOmcgOimgemAkOihjOWMuuWIhuOAguOAjOaYr+WQpuaWsOaJi+axoOOAjeOAjOS/neW6leaYr+WQpue7p+aJv+OAjeS4pOWIl+ebruWJjeeahOaPkuS7tuWlkee6pumHjOayoeacieWvueW6lFxuICog5a2X5q615Y+v5Lul5om/6L2977yM44CM5piv5ZCm57un5om/44CN6L+Z5LiA5YiX5Y2z5L2/5pyJ5a2X5q615Lmf5peg5rOV5q2j56Gu5a6e546w77yM6KeB5LiL5pa5XG4gKiBgcGl0eUdyb3Vwc2Ag5LiA6IqC55qEXCLlt7Lnn6XnvLrlj6NcIuivtOaYjuOAglxuICpcbiAqIGBmaXZlU3Rhckd1YXJhbnRlZUtpbmRgIOWPluWAvOS+neaNru+8iGBkb2NzL19pbnRlcm5hbC9taWxlc3RvbmVzL1xuICogMDMtTTIt6bij5r2u5o+S5Lu25LiO5oq96LGh6K+B5LyqLm1kYCDCpzQuNO+8mlwi6KeS6Imy5rGgIDUwLzUw77yM5q2m5Zmo5rGg5b+F5Lit5LiN5q2qXCLvvInvvJpcbiAqICAgLSA1IOS4quOAjOinkuiJsuOAjeaxoO+8iGlkIDEvMy84LzEwLzEy77yJ5Y+WIGBmaWZ0eUZpZnR5YOKAlOKAlOS+neaNruaYr+aKiiDCpzQuNOOAjOinkuiJsuaxoFxuICogICAgIDUwLzUw44CN6L+Z5p2h6YCa55So57uT6K665oyJ44CM6KeS6Imy5Y2h5rGg44CN5aSn57G75bqU55So77yM5LiN5piv5a+55bi46am7L+aWsOaXhS/ogZTliqgv5b+G5peFXG4gKiAgICAg6L+Z5Lqb5a2Q57G75Z6L6YCQ5LiA5Y2V54us6aqM6K+B6L+H44CCXG4gKiAgIC0gNSDkuKrjgIzmrablmajjgI3msaDvvIhpZCAyLzQvOS8xMS8xM++8ieWPliBgYWx3YXlzUmF0ZVVwYOKAlOKAlOWQjOS4iu+8jOaMieOAjOatpuWZqOWNoeaxoOOAjVxuICogICAgIOWkp+exu+W6lOeUqOOAglxuICpcbiAqICAg4pqg77iPIOS4peagvOivtO+8jOWPquacieOAjOinkuiJsua0u+WKqOWUpOWPluOAjeOAjOatpuWZqOa0u+WKqOWUpOWPluOAje+8iGlkIDEvMu+8iei/meS4pOS4quWtkOexu+Wei1xuICogICDlnKggwqc0LjQg6YeM5pyJ55u05o6l5a+554Wn77yM5YW25L2ZIDgg5Liq5pivKirlkIznsbvmjqjlub8qKuOAguaOqOW5v+acrOi6q+aYr+WQiOeQhueahOmihuWfn+aOqOaWrVxuICogICDvvIjmi4Xkv53op4TliJnlnKjpuKPmva7ph4zmjInnianlk4HlpKfnsbvogIzpnZ7mjInljaHmsaDlrZDnsbvlnovliJLliIbvvInvvIzkvYblroPmsqHmnInpgJDmsaDlrp7mtYtcbiAqICAg6IOM5Lmm4oCU4oCU6Iul5pel5ZCO5p+Q5Liq5a2Q57G75Z6L6KKr5Y+R546w6KeE5YiZ5LiN5ZCM77yM5pS56L+Z5LiA5YiX5Y2z5Y+v77yM5LiN5b+F5Yqo5Lu75L2V6YC76L6R44CCXG4gKiAgIC0gMyDkuKrjgIzmlrDmiYvjgI3msaDvvIhpZCA1LzYvN++8ieWPliBgbm9uZWDigJTigJQqKuayoeacieS7u+S9leWunua1i+S+neaNrioq77yM5Y+q5piv5rK/55SoXG4gKiAgICAg5q2k5YmN55So5rGg5ZCN5a2X56ym5Liy5Yy56YWN5pe255qE546w54q277yI5rGg5ZCN5LiN5ZCrXCLop5LoibJcIuS5n+S4jeWQq1wi5q2m5ZmoXCLvvIzljLnphY3kuI3kuIpcbiAqICAgICDku7vkvZXkuIDmlK/miY3okL3liLAgYG5vbmVg77yJ77yM6YCQ6KGM5qCH5rOoIGAvLyDml6Dlrp7mtYvkvp3mja7vvIzmsr/nlKjnjrDnirZg44CCXG4gKlxuICog5LmL5YmN5piv5LuOIGBwb29sLm5hbWVgIOeUqCBgLmluY2x1ZGVzKFwi6KeS6ImyXCIpYC9gLmluY2x1ZGVzKFwi5q2m5ZmoXCIpYCDnjrDlnLrmjqjlr7xcbiAqIOi/meS4quWAvO+8jOi/memHjOaUueaIkOaYvuW8j+WIl+WHuuKAlOKAlOaYvuekuuWQjeaYr+e7meS6uueci+eahO+8jOS4jeivpeaJv+aLhVwi5Yaz5a6a5L+d5bqV6K+t5LmJXCLov5nkuKpcbiAqIOiBjOi0o++8muaUueS4gOS4quWtl+OAgeaIluWHuueOsOWQjOaXtuWQqy/pg73kuI3lkKvov5nkuKTkuKror43nmoTmsaDlkI3vvIzor63kuYnkvJrpnZnpu5jmlLnlj5jvvJvlm7rljJZcbiAqIOaIkOihqOagvOWQjuavj+S4gOihjOeahOWPluWAvOebtOaOpeWPr+ivu++8jOS4jeeUqOi3s+WIsOWIq+WkhOWPjeaOqOOAglxuICovXG5jb25zdCBXVVdBX1BPT0xfVFlQRVMgPSBbXG4gIHsgaWQ6IFwiMVwiLCBuYW1lOiBcIuinkuiJsua0u+WKqOWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjJcIiwgbmFtZTogXCLmrablmajmtLvliqjllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJhbHdheXNSYXRlVXBcIiB9LFxuICB7IGlkOiBcIjNcIiwgbmFtZTogXCLop5LoibLluLjpqbvllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgeyBpZDogXCI0XCIsIG5hbWU6IFwi5q2m5Zmo5bi46am75ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbiAgeyBpZDogXCI1XCIsIG5hbWU6IFwi5paw5omL5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDUwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwibm9uZVwiIH0sIC8vIOaXoOWunua1i+S+neaNru+8jOayv+eUqOeOsOeKtlxuICB7IGlkOiBcIjZcIiwgbmFtZTogXCLmlrDmiYvoh6rpgInllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJub25lXCIgfSwgLy8g5peg5a6e5rWL5L6d5o2u77yM5rK/55So546w54q2XG4gIHsgaWQ6IFwiN1wiLCBuYW1lOiBcIuaWsOaJi+iHqumAieWUpOWPlu+8iOaEn+aBqeWumuWQkeWUpOWPlu+8iVwiLCBoYXJkUGl0eTVTdGFyOiAxLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwibm9uZVwiIH0sIC8vIOaXoOWunua1i+S+neaNru+8jOayv+eUqOeOsOeKtlxuICB7IGlkOiBcIjhcIiwgbmFtZTogXCLop5LoibLmlrDml4XllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgeyBpZDogXCI5XCIsIG5hbWU6IFwi5q2m5Zmo5paw5peF5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbiAgeyBpZDogXCIxMFwiLCBuYW1lOiBcIuinkuiJsuiBlOWKqOWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjExXCIsIG5hbWU6IFwi5q2m5Zmo6IGU5Yqo5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbiAgeyBpZDogXCIxMlwiLCBuYW1lOiBcIuinkuiJsuW/huaXheWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjEzXCIsIG5hbWU6IFwi5q2m5Zmo5b+G5peF5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbl0gYXMgY29uc3Q7XG5cbi8qKiA04piFIOehrOS/neW6le+8jOWFqOmDqCAxMyDpobkgUG9vbFR5cGUg5YWx55So5ZCM5LiA5Liq5YC877yIYENvbmZpZ1NlcnZpY2UuY3NgIOesrCA1IOWIl+aBkuS4uiAxMO+8ieOAgiAqL1xuY29uc3QgV1VXQV80U1RBUl9IQVJEX1BJVFkgPSAxMDtcblxuLyoqIGBmaXZlU3Rhckd1YXJhbnRlZUtpbmRgIOKGkiDlrp7pmYUgYEd1YXJhbnRlZVJ1bGVgIOWtl+mdoumHj+Wvueixoe+8iFAyIOihqO+8ieOAgiAqL1xuY29uc3QgV1VXQV9GSVZFX1NUQVJfR1VBUkFOVEVFX0JZX0tJTkQgPSB7XG4gIGZpZnR5RmlmdHk6IHsga2luZDogXCJmaWZ0eUZpZnR5XCIgYXMgY29uc3QgfSxcbiAgYWx3YXlzUmF0ZVVwOiB7IGtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgYXMgY29uc3QgfSxcbiAgbm9uZTogeyBraW5kOiBcIm5vbmVcIiBhcyBjb25zdCB9LFxufSBhcyBjb25zdDtcblxuLyoqXG4gKiDku47ml6Xlv5fooYzmj5Dlj5YgZ2FjaGFMaW5rIOeahOato+WIme+8jOmAkOWtl+WPluiHquWPguiAg+WunueOsFxuICog77yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2Ag55qEIGBSZWdleC5NYXRjaGAg6LCD55So77yJ77yaXG4gKiAgIGAoaHR0cHM/LipcXC9ha2lcXC9nYWNoYVxcL2luZGV4XFwuaHRtbCNcXC9yZWNvcmRbXFw/PSZcXHdcXC1dKylgXG4gKlxuICog5oyJ6KGMKirlgJLluo8qKuaJq+aPj+OAgeWRveS4reesrOS4gOS4quWNs+WBnOi/meS7tuS6i+WujOWFqOaYryBSdXN0IEwxXG4gKiDvvIhgY3JhdGU6OmNhY2hlX3NjYW5g77yJ55qE5a6e546w57uG6IqC77yM5pys5q2j5YiZ5Y+q5aOw5piO5Yy56YWN5qih5byP5pys6Lqr77yM5o+S5Lu25L6n5LiN6ZyA6KaBXG4gKiDvvIjkuZ/kuI3og73vvInlo7DmmI7miavmj4/mlrnlkJHjgIJcbiAqL1xuY29uc3QgV1VXQV9HQUNIQV9MSU5LX1BBVFRFUk4gPSAvKGh0dHBzPy4qXFwvYWtpXFwvZ2FjaGFcXC9pbmRleFxcLmh0bWwjXFwvcmVjb3JkW1xcPz0mXFx3XFwtXSspLztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA14piFIOa4kOi/m+amgueOh+absue6v1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8g4pqg77iPIOi/meS4pOS4quWjsOaYjuW/hemhu+aUvuWcqCBgZXhwb3J0IGNvbnN0IG1hbmlmZXN0YCDkuYvliY3igJTigJTkuIvpnaIgYG1hbmlmZXN0LnBpdHlHcm91cHNgXG4vLyDnmoQgYGZsYXRNYXBgIOWcqCoq5qih5Z2X5rGC5YC85pyfKirlsLHkvJrosIPnlKggYGZpdmVTdGFyQ3VydmVg77yM6Iul5oqKXG4vLyBgV1VXQV9GSVZFX1NUQVJfUFJPR1JFU1NJVkVfQ1VSVkVgIOWjsOaYjuaUvuWcqCBgbWFuaWZlc3RgIOS5i+WQju+8jGBjb25zdGAg5LiN5LyaXG4vLyDooqvmj5DljYfliJ3lp4vljJbvvIjmmoLml7bmgKfmrbvljLrvvInvvIzkvJrlnKjmsYLlgLwgYG1hbmlmZXN0YCDml7bnm7TmjqXmiptcbi8vIFwiQ2Fubm90IGFjY2VzcyBiZWZvcmUgaW5pdGlhbGl6YXRpb25cIuOAglxuXG4vKipcbiAqIDXimIUg5riQ6L+b5qaC546H5puy57q/55qEKirnspfnspLluqbov5HkvLwqKu+8jOWPquWvueehrOS/neW6lSA4MCDnmoTmsaDlrZDmiJDnq4tcbiAqIO+8iDEvMi8zLzQvNi84LzkvMTAvMTEvMTIvMTPigJTigJTljbPpmaQgNeOAgTcg5LmL5aSW55qE5YWo6YOo77yJ44CCXG4gKlxuICog5pWw5YC855u05o6l5Y+W6IeqIGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCpzMuM++8iFBvb2xUeXBlXG4gKiAxLzIvNCDlkIjlubbjgIHmjIkgMTAg5oq95YiG5qG255qE55yf5a6e5ZG95Lit546H77yM5LiN5piv6YCQ5oq95ouf5ZCI5Ye65p2l55qE5puy57q/77yJ77yaXG4gKiAgIDF+NjAg5oq977ya5ZG95Lit546H5ZyoIDAuNSV+MS45JSDkuYvpl7Tms6LliqjvvIzor6XmlofmoaPliKTlrprkuLrlsI/moLfmnKzlmarlo7DvvIxcbiAqICAgICAgICAgICAg5YWt5Liq5YiG5qG25Z2H5YC8IOKJiDAuOTMl77yM5Zub6IiN5LqU5YWl5Y+WIDElIOS9nOS4uiBiYXNlXG4gKiAgIDYxfjcwIOaKve+8mjYuOSXvvIgzMTcg5Liq5qC35pys44CBMjIg5qyh5ZG95Lit77yJXG4gKiAgIDcxfjgwIOaKve+8mjQ4LjEl77yIMjcg5Liq5qC35pys44CBMTMg5qyh5ZG95Lit77yMKirnva7kv6HljLrpl7TmnoHlrr0qKuKAlOKAlOagt+acrOmHj+Wwj++8jFxuICogICAgICAgICAgICAg6L+Z5Liq5pWw5a2X5pys6Lqr5bCx5pyJ5b6I5aSn5LiN56Gu5a6a5oCn77yM5LiN6KaB5b2T5oiQ57K+56Gu5YC85L2/55So77yJXG4gKlxuICogYGNyYXRlcy9ncy1hbmFseXNpcy9zcmMvcGl0eS5yc2Ag55qEIGBldmFsdWF0ZV9jdXJ2ZWAg5a+5IGBQcm9ncmVzc2l2ZWAg55qEXG4gKiDor63kuYnmmK/jgIxgdGFibGVgIOavj+S4quWFg+e0oOWvueW6lOS4gOaKveOAje+8mmBwdWxsX2luZGV4IDw9IHN0YXJ0YCDml7blj5YgYGJhc2Vg77yMXG4gKiBgcHVsbF9pbmRleCA+IHN0YXJ0YCDml7blj5YgYHRhYmxlW3B1bGxfaW5kZXggLSBzdGFydCAtIDFdYO+8iOWNsyBgdGFibGVbMF1gXG4gKiDlr7nlupTnrKwgYHN0YXJ0ICsgMWAg5oq977yJ77yM5LiL5qCH6LaK55WM6ZKz5Yi25Yiw5pyA5ZCO5LiA5Liq5YWD57Sg4oCU4oCU6L+Z5p2h5puy57q/546w5Zyo5Lya6KKrXG4gKiDnnJ/lrp7mtojotLnvvIzkuI3lho3mmK/ljaDkvY3lo7DmmI7jgILmjInov5nkuKror63kuYnvvIzkuIvpnaIgMjAg5Liq5YWD57Sg5piv5oqK5LiK6Z2i5Lik5LiqIDEwIOaKvVxuICog5YiG5qG2KirpgJDmir3lsZXlvIAqKu+8muesrCA2MX43MCDmir3vvIhgdGFibGVbMC4uOV1g77yJ5Y+WIDYuOSXvvIznrKwgNzF+ODAg5oq9XG4gKiDvvIhgdGFibGVbMTAuLjE5XWDvvInlj5YgNDguMSXjgIJcbiAqXG4gKiDimqDvuI8gKirov5nmmK/liIbmrrXluLjmlbDlsZXlvIDvvIzkuI3mmK/pgJDmir3moIflrpoqKu+8muahtuWGheavj+S4gOaKveWPluWQjOS4gOS4quWAvOaYr+S4gOS4quaYvuW8j+eahFxuICog5bu65qih6YCJ5oup77yM5L+h5oGv6YeP5LiO5Y6f5aeL5YiG5qG25pWw5o2u5a6M5YWo55u45ZCM77yM5rKh5pyJ5Yet56m657yW6YCg5Lu75L2V5paw5L+h5oGv77yb5L2G55yf5a6eXG4gKiDmm7Lnur/lnKjmobblhoXlpKfmpoLnjofmmK/ljZXosIPkuIrljYfnmoTvvIjotormjqXov5Hkv53lupXlkb3kuK3njofotorpq5jvvInvvIzliIbmrrXluLjmlbDkvJrorqnmobbnmoRcbiAqIOWJjeWHoOaKveamgueOh+WBj+mrmOOAgeWQjuWHoOaKveWBj+S9ju+8jOi/meaYr+W3suefpeeahOi/keS8vOivr+W3ru+8jOS4jeaYr+mUmeivr+aVsOaNruOAguetieaciemAkOaKvVxuICog57K+57uG5qC35pys77yI5bCk5YW25pivIDcxfjgwIOaKvei/meS4gOahtu+8jDI3IOS4quagt+acrOaSkeS4jei1t+eyvuehruabsue6v++8ieWGjeabv+aNouOAglxuICovXG5jb25zdCBXVVdBX0ZJVkVfU1RBUl9QUk9HUkVTU0lWRV9DVVJWRSA9IHtcbiAga2luZDogXCJwcm9ncmVzc2l2ZVwiIGFzIGNvbnN0LFxuICBiYXNlOiAwLjAxLFxuICBzdGFydDogNjAsXG4gIC8vIDEwIOS4qiA2Ljkl77yI56ysIDYxfjcwIOaKve+8iSsgMTAg5LiqIDQ4LjEl77yI56ysIDcxfjgwIOaKve+8ie+8jOWvueW6lOS4iuaWueazqOmHiueahFxuICAvLyDliIbmrrXluLjmlbDlsZXlvIDjgILnlKggQXJyYXkuZmlsbCDmi7zmjqXogIzpnZ7miYvlhpkgMjAg5Liq5a2X6Z2i6YeP77yM6YG/5YWN5pWw6ZSZ5Liq5pWw77yMXG4gIC8vIOS5n+iuqeOAjDEwICsgMTDjgI3ov5nkuKrliIbmobbnu5PmnoTlnKjku6PnoIHph4zkv53mjIHlj6/op4HjgIJcbiAgdGFibGU6IFsuLi5BcnJheSgxMCkuZmlsbCgwLjA2OSksIC4uLkFycmF5KDEwKS5maWxsKDAuNDgxKV0sXG59O1xuXG4vKipcbiAqIOaMiSBQb29sVHlwZSDliIbmtL4gNeKYhSDmm7Lnur/jgIJcbiAqXG4gKiAtIFBvb2xUeXBlIDfvvIjmlrDmiYvoh6rpgInllKTlj5bCt+aEn+iwouWumuWQkeWUpOWPlu+8ie+8muehrOS/neW6lSA9IDHvvIzmlbDlrabkuIrnm7TmjqXnrYnku7fkuo5cbiAqICAgXCLmr4/mrKHllKTlj5bpg73lv4Xlh7ogNeKYhVwi77yM5LiN5piv54yc5rWL4oCU4oCU56Gs5L+d5bqV5pWw5YC85pys6Lqr5Yaz5a6a55qE77yM5LiN5L6d6LWW5Lu75L2V5a6e5rWLXG4gKiAgIOagt+acrOOAglxuICogLSBQb29sVHlwZSA177yI5paw5omL5ZSk5Y+W77yM56Gs5L+d5bqVIDUw77yJ77ya55yf5a6e5a2Y5qGj5a6e5rWL6K+l5rGgICoqMCDmnaHorrDlvZUqKlxuICogICDvvIhgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqcxLjIgXCLnqbrmp73kvY1cIuWIl+WHuiA1IOWcqOWGhe+8ie+8jFxuICogICDogIwgYFdVV0FfRklWRV9TVEFSX1BST0dSRVNTSVZFX0NVUlZFYCDnmoTmm7Lnur/lvaLnirbmmK/ku47noazkv53lupUgODAg55qE5LiJ5Liq5rGgXG4gKiAgIO+8iDEvMi8077yJ5a6e5rWL5pWw5o2u6YeM5o6o5Ye655qE4oCU4oCU5riQ6L+b5puy57q/55CG5bqU6ZqP56Gs5L+d5bqV5L2N572u5pys6Lqr5Y+Y5YyW77yI5L+d5bqVIDUwXG4gKiAgIOeahOaxoOWtkOS4jeWPr+iDveWcqOesrCA2MCDmir3miY3lvIDlp4tcIui3g+WNh1wi77yM6YKj5bey57uP6LaF6L+H56Gs5L+d5bqV5pys6Lqr77yJ77yM5oqKIDgwIOehrFxuICogICDkv53lupXmsaDlrZDnmoTmm7Lnur/nm7TmjqXlpZfliLAgNTAg56Gs5L+d5bqV55qE5rGg5a2Q5LiK5piv5rKh5pyJ6K+B5o2u5pSv5oyB55qE5aSW5o6o77yM5Zug5q2kXG4gKiAgIOacrOaxoOS7jeeUqCBjdXN0b20g5Y2g5L2N77yM5LiN5aSW5o6o44CCXG4gKiAtIOWFtuS9meWFqOmDqOehrOS/neW6lSA4MCDnmoTmsaDlrZDvvJrlhbHnlKjlkIzkuIDmnaEgYFdVV0FfRklWRV9TVEFSX1BST0dSRVNTSVZFX0NVUlZFYFxuICogICDigJTigJTlj6rmnIkgMS8yLzQg5LiJ5Liq5rGg5pyJ55yf5a6e5qC35pys77yM5YW25L2Z5ZCM56Gs5L+d5bqV5rGg5a2Q5rKh5pyJ54us56uL5qC35pys77yM5L2G5Lmf5rKh5pyJXG4gKiAgIOS7u+S9leeQhueUseiupOS4uuWug+S7rOeahOabsue6v+W9oueKtuS4jeWQjO+8jOeUqOWQjOS4gOadoeabsue6v+aYr1wi55So5LuF5pyJ55qE6K+B5o2u5LiA6Ie05Zyw5bqU55SoXCLvvIxcbiAqICAg5LiN5piv6YCQ5rGg57yW6YCg5Ye65LqS5LiN55u45ZCM55qE5pWw5a2X44CCXG4gKi9cbmZ1bmN0aW9uIGZpdmVTdGFyQ3VydmUocG9vbDogKHR5cGVvZiBXVVdBX1BPT0xfVFlQRVMpW251bWJlcl0pIHtcbiAgaWYgKHBvb2wuaGFyZFBpdHk1U3RhciA9PT0gMSkge1xuICAgIHJldHVybiB7IGtpbmQ6IFwiZmxhdFwiIGFzIGNvbnN0LCBiYXNlOiAxIH07XG4gIH1cbiAgaWYgKHBvb2wuaGFyZFBpdHk1U3RhciAhPT0gODApIHtcbiAgICByZXR1cm4geyBraW5kOiBcImN1c3RvbVwiIGFzIGNvbnN0LCBpZDogYHd1d2EtdW5jb25maXJtZWQtNXN0YXItcG9vbC0ke3Bvb2wuaWR9YCB9O1xuICB9XG4gIHJldHVybiBXVVdBX0ZJVkVfU1RBUl9QUk9HUkVTU0lWRV9DVVJWRTtcbn1cblxuZXhwb3J0IGNvbnN0IG1hbmlmZXN0ID0ge1xuICBpZDogXCJ3dXdhXCIsXG4gIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLpuKPmva5cIiB9LFxuICBzZGtWZXJzaW9uOiBcIjEuMC4wXCIsXG4gIHBsYXRmb3JtczogW1wid2luZG93c1wiXSxcbiAgbWFpbnRhaW5lcnM6IFtcImdhY2hhLXN0dWRpb1wiXSxcbiAgLy8gZXhjaGFuZ2VGb3JtYXRzIOS4jeWjsOaYju+8mum4o+a9ruayoeacieW3suefpeeahOWFrOW8gOagh+WHhuS6pOaNouagvOW8j++8iFdXR0Yg5LmL57G755qE6K+05rOVXG4gIC8vIOacque7j+ivgeWunu+8jGByZXNlYXJjaC8wMWAgwqczLjIg5bey56Gu6K6k5Y+C6ICD5a6e546w55qE5pys5Zyw5a2Y5qGj5piv6Ieq5a6a5LmJIEpTT04g57uT5p6EXG4gIC8vIOiAjOmdnuS7u+S9leagh+WHhuagvOW8j++8ie+8jOWjsOaYjuS4gOS4quS4jeWtmOWcqOeahOagvOW8j+avlOS4jeWjsOaYjuabtOacieWus+OAglxuXG4gIC8vIOWbvuagh+WcsOWdgOadpeiHqiBUYXBUYXAg5bqU55So5biC5Zy66aG16Z2i77yM5bey5a6e5rWL6aqM6K+B77yM5ZCMIGBwbHVnaW5zL2dlbnNoaW4vXG4gIC8vIG1hbmlmZXN0LnRzYCDlkIzmrL7mlZnorq3igJTigJTlnLDlnYDku6UgLmpwZyDnu5PlsL7kvYblrp7pmYXlhoXlrrnmmK8gUE5H77yM5LiN6KaBXCLnuqDmraNcIlxuICAvLyDmianlsZXlkI3vvIzmoLzlvI/moKHpqozvvIhjb250ZW50LXR5cGUgKyBtYWdpYyBieXRlc++8ieaYr+Wuv+S4u+S+p+iBjOi0o+OAglxuICBpY29uVXJsOlxuICAgIFwiaHR0cHM6Ly9pbWctdGMudGFwaW1nLmNvbS9tYXJrZXQvaW1hZ2VzL2E0NjVlMzRmMGU0YWZiMzYzMWU4ZWU1YjFmMDJjOTkyLnBuZy9fdGFwX2FwcGljb25fbS5qcGdcIixcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gY29sbGVjdO+8muWFiOS7jiBDbGllbnQubG9nIOaLv+WHreaNru+8iGdhY2hhTGlua++8ie+8jOWGjeiwgyByZWNvcmQvcXVlcnkg5o6l5Y+jXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwibG9nRmlsZVwiLFxuICAgICAgICAvLyDimqDvuI8g55u45a+554mH5q6177yM5LiN5piv57ud5a+56Lev5b6E4oCU4oCUYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jczo2Ni02N2BcbiAgICAgICAgLy8g5pi+56S65a6Y5pa55ZCv5Yqo5Zmo5LiOIFdlR2FtZSDlkK/liqjlmajnmoTml6Xlv5fnm7jlr7not6/lvoTkuI3lkIzvvIjlrpjmlrnlkK/liqjlmajlnKjmuLjmiI9cbiAgICAgICAgLy8g55uu5b2V5LiL5aSa5aWX5LiA5bGCIFwiV3V0aGVyaW5nIFdhdmVzIEdhbWUvXCLvvIxXZUdhbWUg5rKh5pyJ6L+Z5LiA5bGC77yJ44CCXG4gICAgICAgIC8vIGBsb2dQYXRoYCDnm67liY3ku43mmK/ljZXkuKrlrZfnrKbkuLLlrZfmrrXvvIzoo4XkuI3kuIvkuKTkuKrlgJnpgInvvJtSdXN0IOS+p1xuICAgICAgICAvLyBgbG9jYXRlX2xvZ19jYW5kaWRhdGVzYCDkvJrlkIzml7blsJ3or5VcIuebtOaOpeWRveS4rVwi5LiOXCLmgbDlpb3kuIDlsYLlrZDnm67lvZVcIuS4pOenjVxuICAgICAgICAvLyDlgJnpgInot6/lvoTvvIzlm6DmraTov5nph4wqKuS4jeimgSoq5oqKIFwiV3V0aGVyaW5nIFdhdmVzIEdhbWVcIiDliY3nvIDlhpnov5vmnaXigJTigJRcbiAgICAgICAgLy8g5YaZ5LqG5Y+N6ICM5Y+q6IO95Yy56YWN5a6Y5pa55ZCv5Yqo5Zmo6L+Z5LiA56eN77yMUnVzdCDkvqfnmoTlj4zlgJnpgInmnLrliLblsLHnlKjkuI3kuIrkuobjgIJcbiAgICAgICAgbG9nUGF0aDogXCJDbGllbnQvU2F2ZWQvTG9ncy9DbGllbnQubG9nXCIsXG4gICAgICAgIHVybFBhdHRlcm46IFdVV0FfR0FDSEFfTElOS19QQVRURVJOLFxuICAgICAgICAvLyDlrZfoioLnuqfop6Pmt7fmt4blj4LmlbDvvJrot7Pov4fliY0gMyDlrZfoioLvvIzmraTlkI7pgJDlrZfoioLmjIkqKuivpeWtl+iKguiHqui6q+eahOWAvCoqXG4gICAgICAgIC8vIO+8iOS4jeaYr+S4i+agh++8ieeahOWlh+WBtuWIhuWIq+W8guaIliAweEE1LzB4RUbjgILmupDnoIHkvp3mja5cbiAgICAgICAgLy8gYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2Ag56ysIDExOH4xMjMg6KGM77yaXG4gICAgICAgIC8vICAgYGJ5dGUgYiA9IGVuY3J5cHRlZFtpXTsgaWYgKChiICYgMSkgPT0gMSkgYiBePSAweEE1OyBlbHNlIGIgXj0gMHhFRjtgXG4gICAgICAgIC8vIOWIpOaNruaYryBi77yI5a2X6IqC5YC877yJ77yM5b6q546v5Y+Y6YePIGkg5Y+q55So5LqO5Y+W5YC85ZKM5YaZ5Zue77yM5LiO5LiL5qCH5peg5YWz4oCU4oCU6L+Z5p2hXG4gICAgICAgIC8vIOW3sue7j+iiq+ivgeS8qui/h+S4gOasoeS6jOaJi+i9rOi/sO+8iGByZXNlYXJjaC8wMWAg5Y6f6K6w6L296bij5r2u5pel5b+X5piv5piO5paH77yM5Y6L5qC5XG4gICAgICAgIC8vIOayoeaPj+i/sOi/h+ino+egge+8ie+8jOWboOatpOWPquiupOi/meautea6kOeggeWOn+aWh++8jOS4jeiupOS7u+S9lei9rOi/sOOAglxuICAgICAgICBkZWNvZGU6IHsga2luZDogXCJ4b3JCeUxvd0JpdFwiLCBza2lwQnl0ZXM6IDMsIG1hc2tXaGVuT2RkOiAweGE1LCBtYXNrV2hlbkV2ZW46IDB4ZWYgfSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIFBPU1QgKyBKU09OIGJvZHnjgILlrZfmrrXmmKDlsITpgJDlrZflj5boh6pcbiAgICAgIC8vIGBVcGRhdGVHYWNoYURhdGFEaWFsb2dWaWV3TW9kZWwuY3M6MTYzLTE5NmDvvIhxdWVyeSDlj4LmlbDop6PmnpDvvInkuI5cbiAgICAgIC8vIGA6MjM5LTI1M2DvvIjmnoTpgKDor7fmsYLkvZPvvInvvJpcbiAgICAgIC8vICAgcmVzb3VyY2VzX2lkIOKGkiBjYXJkUG9vbElkICAgIGxhbmcgICAgICDihpIgbGFuZ3VhZ2VDb2RlXG4gICAgICAvLyAgIHBsYXllcl9pZCAgICDihpIgcGxheWVySWQgICAgICByZWNvcmRfaWQg4oaSIHJlY29yZElkXG4gICAgICAvLyAgIHN2cl9pZCAgICAgICDihpIgc2VydmVySWQgICAgICDvvIjpmo/ljaHmsaDlj5jljJbvvInihpIgY2FyZFBvb2xUeXBlXG4gICAgICAvL1xuICAgICAgLy8g4pqg77iPICoq5byV5Y+36Zm36Zix77yM5YWt5Liq5a2X5q616YeM5Lik5Liq5LiN6IO95Yqg5byV5Y+3KirvvJpgY2FyZFBvb2xJZGAvYGxhbmd1YWdlQ29kZWAvXG4gICAgICAvLyBgcmVjb3JkSWRgL2BzZXJ2ZXJJZGAg5ZyoIEMjIOmHjOaYryBgc3RyaW5nYO+8jOW6j+WIl+WMluWQjuaYryBKU09OIOWtl+espuS4su+8jFxuICAgICAgLy8gYm9keSDmqKHmnb/ph4zlr7nlupTnmoTljaDkvY3nrKbopoHliqDlvJXlj7fvvJvkvYYgYGNhcmRQb29sVHlwZWAg55u05o6l6LWL5YC8XG4gICAgICAvLyBgZ2FjaGFQb29sLlBvb2xUeXBlYO+8iGBpbnRg77yJ77yMYHBsYXllcklkYCDmmK8gYGxvbmcuUGFyc2UoLi4uKWAg55qE57uT5p6cXG4gICAgICAvLyDvvIhgbG9uZ2DvvInigJTigJTov5nkuKTkuKrlnKggQyMg5L6n6YO95piv5pWw5YC857G75Z6L77yMYEpzb25Db252ZXJ0LlNlcmlhbGl6ZU9iamVjdGBcbiAgICAgIC8vIOS8muaKiuWug+S7rOW6j+WIl+WMluaIkOS4jeW4puW8leWPt+eahCBKU09OIOaVsOWtl+OAguWNoOS9jeespuabv+aNouaYr+e6r+Wtl+espuS4suaLvOaOpVxuICAgICAgLy8g77yIYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2Ag55qEXG4gICAgICAvLyBgc3Vic3RpdHV0ZV9wbGFjZWhvbGRlcnNg77yJ77yM5qih5p2/6YeM57uZIGB7e2dhY2hhVHlwZX19YC9cbiAgICAgIC8vIGB7e2NyZWRlbnRpYWwucGxheWVyX2lkfX1gIOWll+S4iuW8leWPt+S8muS6p+WHuiBgXCJjYXJkUG9vbFR5cGVcIjpcIjFcImDigJTigJRcbiAgICAgIC8vIOacjeWKoeerr+aUtuWIsOeahOaYr+Wtl+espuS4siBcIjFcIiDogIzkuI3mmK/mlbDlrZcgMe+8jOS4juecn+WunuWuouaIt+err+WPkemAgeeahOivt+axguW9ouaAgVxuICAgICAgLy8g5LiN5LiA6Ie077yM5Zug5q2k5LiL6Z2iIGJvZHkg5qih5p2/6YeM6L+Z5Lik5aSEKirmlYXmhI/kuI3liqDlvJXlj7cqKuOAglxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICB1cmw6IFwiaHR0cHM6Ly9nbXNlcnZlci1hcGkuYWtpLWdhbWUyLmNvbS9nYWNoYS9yZWNvcmQvcXVlcnlcIixcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICAgIC8vIOWPguiAg+WunueOsOWbuuWumumZhOW4pueahCBVc2VyLUFnZW5077yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2BcbiAgICAgICAgICAvLyBgY2xpZW50LkRlZmF1bHRSZXF1ZXN0SGVhZGVycy5BZGQoXCJVc2VyLUFnZW50XCIsIC4uLilgIOiwg+eUqOWkhO+8jOWOn+agt+aKhOW9le+8ieOAglxuICAgICAgICAgIFwiVXNlci1BZ2VudFwiOlxuICAgICAgICAgICAgXCJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCA2LjI7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS85Mi4wLjQ1MTUuMTA3IFNhZmFyaS81MzcuMzZcIixcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTpcbiAgICAgICAgICAne1wiY2FyZFBvb2xJZFwiOlwie3tjcmVkZW50aWFsLnJlc291cmNlc19pZH19XCIsXCJjYXJkUG9vbFR5cGVcIjp7e2dhY2hhVHlwZX19LCcgK1xuICAgICAgICAgICdcImxhbmd1YWdlQ29kZVwiOlwie3tjcmVkZW50aWFsLmxhbmd9fVwiLFwicGxheWVySWRcIjp7e2NyZWRlbnRpYWwucGxheWVyX2lkfX0sJyArXG4gICAgICAgICAgJ1wicmVjb3JkSWRcIjpcInt7Y3JlZGVudGlhbC5yZWNvcmRfaWR9fVwiLFwic2VydmVySWRcIjpcInt7Y3JlZGVudGlhbC5zdnJfaWR9fVwifScsXG4gICAgICB9LFxuXG4gICAgICAvLyDimqDvuI8gKirlj6rmlL7lm73mnI0gYC5jb21g77yM5Yi75oSP5LiN6aKE5pS+5Zu96ZmF5pyNIGAubmV0YCoq77ya5Y+C6ICD5a6e546w5oyJ5Yet5o2uXG4gICAgICAvLyBgc3ZyX2FyZWFgIOWcqOS4pOS4qiBob3N0IOS5i+mXtOS6jOmAieS4gO+8iGBVcGRhdGVHYWNoYURhdGFEaWFsb2dWaWV3TW9kZWwuY3NgXG4gICAgICAvLyBgc2VydmVyQ04gPyBcIi4uLi5jb21cIiA6IFwiLi4uLm5ldFwiYO+8ie+8jOS9huacrOmhueebruacrOacuuWPquacieWbveacjeWtmOaho+agt+acrO+8jFxuICAgICAgLy8g5Zu96ZmF5pyN5YiG5pSv5peg5rOV6aqM6K+B44CCYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2BcbiAgICAgIC8vIOmHjCBgUmVxdWVzdFRlbXBsYXRlSnNvbmAg5LiK5pa555qEXCLlt7Lnn6XnvLrlj6MgQzhcIuazqOmHiuW3sue7j+aKiui/meadoemSieatu++8mlxuICAgICAgLy8gXCJjb2xsZWN0LnBhcmFtcy5hbGxvd2VkSG9zdHMg6YeM5ZCM5qC35LiN6aKE5pS+IC5uZXTvvJrpooTmlL7nrYnkuo7lo7DmmI7kuIDkuKrot5HkuI3liLBcbiAgICAgIC8vIOeahOiDveWKm1wi44CC6aKE5pS+5LiA5Liq5pyq57uP6aqM6K+B44CB5b2T5YmN6K+35rGC5qih5p2/5Lmf5omT5LiN5Yiw55qEIGhvc3TvvIzlj6rkvJrliLbpgKDkuIDnp41cbiAgICAgIC8vIFwi55yL6LW35p2l5pSv5oyB5Zu96ZmF5pyNXCLnmoTlgYfosaHjgILnrYnnnJ/nmoTmnInlm73pmYXmnI3moLfmnKzml7bvvIzpnIDopoHlkIzml7booaVcbiAgICAgIC8vIOivt+axguerr+eCueWIhuaUr+acuuWItuS4jui/memHjOeahOeZveWQjeWNle+8jOS4pOiAhee8uuS4gOS4jeWPr+OAglxuICAgICAgYWxsb3dlZEhvc3RzOiBbXCJnbXNlcnZlci1hcGkuYWtpLWdhbWUyLmNvbVwiXSxcblxuICAgICAgZXh0cmFjdExpc3Q6IGV4dHJhY3RHYWNoYVJlY29yZExpc3QsXG5cbiAgICAgIC8vIOaOpeWPo+acrOi6q+S4jeWIhumhte+8jOS4gOasoeivt+axguWNs+aLv+WIsOivpeWNoeaxoOWFqOmDqOiusOW9lVxuICAgICAgLy8g77yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2Ag6YeM5q+P5Liq5Y2h5rGg5Y+q5Y+R5LiA5qyhIFBPU1TvvIzmsqHmnIlcbiAgICAgIC8vIOS7u+S9leWIhumhteWPguaVsO+8ieOAgueUqOe8uuecgeeahCBgZW1wdHlQYWdlYCDkvJrlr7nlkIzkuIDku73lhajph4/lk43lupTmrbvlvqrnjq/jgIJcbiAgICAgIC8vXG4gICAgICAvLyDimqDvuI8g6L+Z5LiN5Y+q5pivXCLmjqXlj6PlvaLmgIHlpoLmraRcIui/meS5iOeugOWNleKAlOKAlGBob29rcy5kZXJpdmVSZWNvcmRLZXlzYO+8iOingVxuICAgICAgLy8gYC4vaG9va3MudHNg77yJ5L6d6LWWXCLmr4/mrKHpg73mmK/mlbTmsaDlhajph4/mi4nlj5ZcIui/meadoeWJjeaPkOiuoeeul+aJueasoeWGheW6j+S9je+8jFxuICAgICAgLy8g6Iul5pel5ZCO6K+v5pS55oiQ5aKe6YePL+WIhumhtemHh+mbhu+8jOW6j+S9jeS8muWcqOWxgOmDqOmbhuWQiOS4iuiuoeeul++8jFxuICAgICAgLy8gYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKnMS44IOWunua1i+eahCAzMi42MCVcbiAgICAgIC8vIO+8iDEwOTkvMzM3Me+8jGtleSDmraPnoa7mgKfkvp3otZbluo/kvY3nmoTorrDlvZXvvInkvJrnq4vliLvlh7rnjrAga2V5IOa8guenu+OAglxuICAgICAgc3RvcENvbmRpdGlvbjogeyBraW5kOiBcInNpbmdsZVJlcXVlc3RcIiB9LFxuXG4gICAgICAvLyDljaHmsaDlvZLlsZ7ku6XmnKzmrKHmn6Xor6LnlKjnmoQgYmFubmVyIOS4uuWHhu+8jOS4jeS/oeWTjeW6lOKAlOKAlOm4o+a9ruWTjeW6lOiusOW9lemHjOeahFxuICAgICAgLy8gYGNhcmRQb29sVHlwZWAg5piv5LiN5Y+v6L+Y5Y6f55qE5Lit5paH5bGV56S65qCH562+77yI6KeB5LiL5pa5XG4gICAgICAvLyBgZmllbGRzLmV4dHJhY3RSZWNvcmRgIOmHjCBgYmFubmVySWRgIOWtl+auteaXgeeahOivpue7huivtOaYju+8ie+8jOiAjOm4o+a9rlxuICAgICAgLy8g5LiA5qyh5p+l6K+i5Y+q6L+U5Zue5LiA5Liq5rGg55qE5YWo6YeP6K6w5b2V77yM5LiN5a2Y5Zyo5re35rGg77yM5Zug5q2k5p+l6K+i5pe255qEIGJhbm5lclxuICAgICAgLy8g5bCx5piv5ZSv5LiA5p2D5aiB5p2l5rqQ44CC5LiO5Y6f56We55u45Y+N4oCU4oCU5Y6f56We5LiA5qyh5p+l6K+i5Lya5re35Zue5YW25a6D5Y2h5rGg55qE6K6w5b2VXG4gICAgICAvLyDvvIhgZml4dHVyZXMvZ2Vuc2hpbi9yYXdfcmVzcG9uc2UvMzAxX3BhZ2VfMS5qc29uYCDlrp7mtYvvvInvvIzlv4Xpobvkv6FcbiAgICAgIC8vIOWTjeW6lOOAguWujOaVtOWvueeFp+ingSBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag6YeMXG4gICAgICAvLyBgQ3JlZGVudGlhbGVkQXBpUGlwZWxpbmVQYXJhbXMuYmFubmVySWRlbnRpdHlgIOeahOaWh+aho+OAglxuICAgICAgYmFubmVySWRlbnRpdHk6IFwicXVlcnlcIixcbiAgICB9LFxuICB9LFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBmaWVsZHPvvJrlk43lupTorrDlvZUg4oaSIOe7n+S4gOWtl+autVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIum4o+a9riBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgLy8g5ZON5bqU6K6w5b2V5a2X5q6177yIYE1vZGVscy9HYWNoYUFQSS5jc2DvvInvvJpcbiAgICAgIC8vICAgY2FyZFBvb2xUeXBlOiBzdHJpbmcgICByZXNvdXJjZUlkOiBpbnQgICAgICBxdWFsaXR5TGV2ZWw6IGludFxuICAgICAgLy8gICByZXNvdXJjZVR5cGU6IHN0cmluZyAgIG5hbWU6IHN0cmluZyAgICAgICAgIGNvdW50OiBpbnRcbiAgICAgIC8vICAgdGltZTogRGF0ZVRpbWVcbiAgICAgIC8vIOayoeacieS7u+S9leW9ouW8j+eahOiusOW9lSBJRO+8iOaXoCBpZC91dWlkL2luZGV477yJ77yM5LiO55yf5a6e5a2Y5qGj5a6e5rWL57uT6K665LiA6Ie0XG4gICAgICAvLyDvvIhgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqfkuIDvvInigJTigJTlm6DmraQgc3RhYmxlSWQg5LiN5aGr77yMXG4gICAgICAvLyBgaG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5b+F6aG75a6e546w77yI6KeBIGAuL2hvb2tzLnRzYO+8ie+8jOS4jeiDveS+nei1luWuv+S4u1xuICAgICAgLy8g5YWc5bqV55SoIHN0YWJsZUlk44CCXG4gICAgICBjb25zdCBpdGVtSWQgPSBudW1lcmljVG9TdHJpbmcocmVjb3JkLnJlc291cmNlSWQpO1xuICAgICAgaWYgKCFpdGVtSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi6bij5r2uIGV4dHJhY3RSZWNvcmTvvJrorrDlvZXnvLrlsJEgcmVzb3VyY2VJZO+8jOaXoOazleehruWumiBpdGVtSWRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGl0ZW1JZCxcbiAgICAgICAgdGltZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQudGltZSkgPz8gXCJcIixcbiAgICAgICAgLy8g4pqg77iPICoq5pys5a2X5q615LiN55Sx5ZON5bqU5Yaz5a6aKirigJTigJRgZml4dHVyZXMvd3V3YS9yYXdfcmVzcG9uc2UvMV9wYWdlXzEuanNvbmBcbiAgICAgICAgLy8g55yf5a6e5qC35pys6K+B5a6e77yMUG9vbFR5cGU9MSDnmoTlk43lupTorrDlvZXph4wgYGNhcmRQb29sVHlwZWAg5Y+W5YC85piv5Lit5paHXG4gICAgICAgIC8vIOWxleekuuagh+etviBgXCLop5LoibLnsr7lh4bosIPosJBcImDvvIwqKuS4jeaYryoqIGBcIjFcImDvvJvlj6rmnIkgYDEwX3BhZ2VfMS5qc29uYFxuICAgICAgICAvLyDvvIhQb29sVHlwZT0xMO+8ieaBsOWlvemZjee6p+aIkOS6huaVsOWtl+Wtl+espuS4siBgXCIxMFwiYOOAguS5n+WwseaYr+ivtFxuICAgICAgICAvLyBgY2FyZFBvb2xUeXBlYCDlpJrmlbDmg4XlhrXkuIvkuI3mmK8gYFdVV0FfUE9PTF9UWVBFU2Ag6KGo55qEIGlk77yM55u05o6l5ou/5a6DXG4gICAgICAgIC8vIOW9kyBiYW5uZXJJZCDkvJrkuqflh7rkuIDkuKrkuI3ljLnphY3ku7vkvZUgYGJhbm5lcnNbXS5pZGAvXG4gICAgICAgIC8vIGBwaXR5R3JvdXBzW10ubWVtYmVyc2Ag55qE5a2X56ym5Liy77yM5L+d5bqV57uf6K6h5Lya5a+56L+Z5Lqb6K6w5b2V6Z2Z6buY5aSx5pWI44CCXG4gICAgICAgIC8vXG4gICAgICAgIC8vIOi/meS4jeaYr1wi5YC85Y+W6ZSZ5LqGXCLov5nkuYjnroDljZXvvJpgRmllbGRNYXBwaW5nLmV4dHJhY3RSZWNvcmRgIOeahOetvuWQjeaYr1xuICAgICAgICAvLyBgKHJhdzogdW5rbm93bikgPT4gVW5pZmllZFJlY29yZEZpZWxkc2DvvIwqKuayoeacieS7u+S9leWPguaVsOiDveWRiuivieWug1xuICAgICAgICAvLyDov5nmibnorrDlvZXmmK/mn6Xor6Llk6rkuKogUG9vbFR5cGUg5b6X5Yiw55qEKirigJTigJTov5nmmK/nu5PmnoTmgKfpmZDliLbvvIzkuI3mmK/og73lnKhcbiAgICAgICAgLy8g6L+Z5Liq5Ye95pWw5YaF6YOo5L+u5aW955qE5a6e546w57uG6IqC77yIUE9TVCBib2R5IOmHjOWPkeeahCBgY2FyZFBvb2xUeXBlYCDmmK9cbiAgICAgICAgLy8g5oiR5Lus6Ieq5bex5oyH5a6a55qE5p+l6K+i5Y+C5pWw77yM5ZON5bqU6YeM5ZCM5ZCN5a2X5q615Y205piv5pyN5Yqh56uv6Ieq5bex55qE5bGV56S65YC877yMXG4gICAgICAgIC8vIOS4pOiAheS4jeS/neivgeS4gOiHtO+8jOecn+WunuaVsOaNruW3sue7j+ivgeS8qlwi5LiA6Ie0XCLov5nkuKrlgYforr7vvInjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g5Zug5q2k6L+Z6YeM5LiN5YaN5bCd6K+V5LuO5ZON5bqU6Kej5p6Q5Y2h5rGg5b2S5bGe77yM5pS555So5a6/5Li75L6n6KaG55uW77yaXG4gICAgICAgIC8vIGBjb2xsZWN0LnBhcmFtcy5iYW5uZXJJZGVudGl0eTogXCJxdWVyeVwiYO+8iOingeS4iuaWueWjsOaYju+8ieiuqeWuv+S4uyoq5ZyoXG4gICAgICAgIC8vIOacrOWHveaVsOi/lOWbnuS5i+WQjuOAgeiwg+eUqCBgaG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5LmL5YmNKirvvIzlsLHmiorov5nkuKrlrZfmrrVcbiAgICAgICAgLy8g5o2i5oiQ5Y+R6LW35pys5qyh5p+l6K+i5pe25a6e6ZmF5L2/55So55qEIGJhbm5lciBpZOKAlOKAlOWujOaVtOWGs+etluS+neaNruingVxuICAgICAgICAvLyBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag6YeMXG4gICAgICAgIC8vIGBDcmVkZW50aWFsZWRBcGlQaXBlbGluZVBhcmFtcy5iYW5uZXJJZGVudGl0eWAg55qE5paH5qGj77yI5Y6f56We5Lya5re35rGgXG4gICAgICAgIC8vIOW/hemhu+S/oeWTjeW6lO+8jOm4o+a9ruS4jea3t+axoOW/hemhu+S/oeafpeivou+8jOS4pOiAheWvueeFp++8ieOAglxuICAgICAgICAvL1xuICAgICAgICAvLyDimqDvuI8g6KaG55uW5pe25py65piv44CM5ZyoIGhvb2tzIOS5i+WJjeOAjeiAjOS4jeaYr+OAjOiQveW6k+aXtuOAje+8jOi/meS4gOeCueWvuVxuICAgICAgICAvLyBgcmVjb3JkX2tleWAg55qE5q2j56Gu5oCn5piv5b+F6KaB55qE77yaYGhvb2tzLmRlcml2ZVJlY29yZEtleXNg77yI6KeBXG4gICAgICAgIC8vIGAuL2hvb2tzLnRzYO+8ieS8muivuyBgYmFubmVySWRgIOWPguS4juWTiOW4jO+8jOiLpeWug+eci+WIsOeahOaYr+S4i+mdoui/meS4quS4juWNoeaxoFxuICAgICAgICAvLyDml6DlhbPnmoTljaDkvY3lgLzvvIxrZXkg5bCx5bCR5LqG5Y2h5rGg6L+Z5LiA57u04oCU4oCU6bij5r2u5Y2B6L+e5pW057uE5YWx55So5ZCM5LiA5Liq5pe26Ze05oiz77yMXG4gICAgICAgIC8vIOiAjCAz4piFIOatpuWZqOWQjOaXtuWHuueOsOWcqOinkuiJsuaxoOS4juatpuWZqOaxoO+8jOS4pOaxoOWQjOS4gOenkuWQhOWHuuS4gOasoeWQjOS4gOS7tiAz4piFIOS4lFxuICAgICAgICAvLyDnu4TlhoXluo/kvY3nm7jlkIzml7bkvJrnrpflh7rnm7jlkIznmoQga2V577yM6KKrIGBVTklRVUUoYWNjb3VudF9pZCwgcmVjb3JkX2tleSlgXG4gICAgICAgIC8vICsgYElOU0VSVCBPUiBJR05PUkVgIOmdmem7mOWQnuaOieS4gOadoeOAguWuv+S4u+S+p+WvueW6lOWunueOsOS4jumSieS9j+ivpeaXtuacuueahOaWreiogFxuICAgICAgICAvLyDop4EgYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2DjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g6YKj5Li65LuA5LmI6L+Z6YeM6L+Y6KaB5aGr5LiA5Liq5Y2g5L2N5YC86ICM5LiN5piv6ZqP5L6/5aGrIGBjYXJkUG9vbFR5cGVg77yf5Zug5Li6XG4gICAgICAgIC8vIGBVbmlmaWVkUmVjb3JkRmllbGRzLmJhbm5lcklkYCDmmK/lv4XloavlrZfmrrXvvIzmgLvlvpfov5Tlm57ngrnku4DkuYjvvJvogIzov5nkuKrlgLxcbiAgICAgICAgLy8g5ZSv5LiA5Lya55yf5q2j55Sf5pWI55qE5Zy65pmv77yM5pivKirmnInkurror6/liKDkuobkuIrpnaLnmoQgYGJhbm5lcklkZW50aXR5OiBcInF1ZXJ5XCJgXG4gICAgICAgIC8vIOWjsOaYjioq4oCU4oCU6YKj5pe25Y2g5L2N5YC85Lya6K6p5q+P5p2h6K6w5b2V6YO96JC95Yiw5LiA5Liq5LiN5Yy56YWN5Lu75L2VIGBiYW5uZXJzW10uaWRgXG4gICAgICAgIC8vIOeahOWNoeaxoOS4iu+8jOmXrumimOW9k+WcuuaYvuW9ou+8m+iLpeaUueWhqyBgY2FyZFBvb2xUeXBlYO+8jOiQveW6k+eahOS8muaYr1wi6KeS6Imy57K+5YeGXG4gICAgICAgIC8vIOiwg+iwkFwi6L+Z57G755yL552A5oy65ZCI55CG44CB5a6e6ZmF5ZCM5qC35Yy56YWN5LiN5LiK55qE5YC877yM5Y+N6ICM5pu06Zq+5Y+R546w44CCXG4gICAgICAgIGJhbm5lcklkOiBcInd1d2EtYmFubmVyLWlkZW50aXR5LW5vdC1kZXJpdmFibGUtZnJvbS1yZXNwb25zZVwiLFxuICAgICAgICBjb3VudDogdG9Db3VudChyZWNvcmQuY291bnQpLFxuICAgICAgICBuYW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5uYW1lKSxcbiAgICAgICAgaXRlbVR5cGU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLnJlc291cmNlVHlwZSksXG4gICAgICAgIHJhcml0eTogbnVtZXJpY1RvU3RyaW5nKHJlY29yZC5xdWFsaXR5TGV2ZWwpLFxuICAgICAgICAvLyBzdGFibGVJZCDnlZnnqbrvvJrop4HkuIrmlrnms6jph4rvvIxBUEkg5ZON5bqU5rKh5pyJ5Lu75L2V6K6w5b2VIElEIOWtl+auteOAglxuICAgICAgfTtcbiAgICB9LFxuICB9LFxuXG4gIC8vIOWNoeaxoOihqO+8mjEzIOS4qiBQb29sVHlwZSDmp73kvY3vvIzmsqHmnInku7vkvZXkuIDmnaHlo7DmmI4gZW5kcG9pbnRPdmVycmlkZeKAlOKAlDEzIOS4quaxoFxuICAvLyDlhbHnlKjlkIzkuIDkuKrnq6/ngrnvvIzljLrliKvlrozlhajlnKggUE9TVCBib2R5IOeahCBjYXJkUG9vbFR5cGUg5a2X5q615YC844CCXG4gIGJhbm5lcnM6IFdVV0FfUE9PTF9UWVBFUy5tYXAoKHBvb2wpID0+ICh7XG4gICAgaWQ6IHBvb2wuaWQsXG4gICAgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBwb29sLm5hbWUgfSxcbiAgfSkpLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBwaXR5R3JvdXBz77yaNeKYhS804piFIOWPjOaho+S/neW6lVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy9cbiAgLy8g5q+P5LiqIFBvb2xUeXBlIOWjsOaYjuS4pOS4qiBQaXR5R3JvdXDvvIxtZW1iZXJzIOmDveaMh+WQkeWQjOS4gOS4quWNoeaxoCBpZO+8mlxuICAvLyAgIC0gNeKYhSDpgqPku73kuI3loasgcGl0eVRhcmdldO+8jOWbnuiQvSByYXJpdHkucGl0eVRhcmdldCA9IFwiNVwi77ybXG4gIC8vICAgLSA04piFIOmCo+S7veaYvuW8jyBwaXR5VGFyZ2V0OiBcIjRcIu+8jGhhcmRQaXR5IOWPliBXVVdBXzRTVEFSX0hBUkRfUElUWeOAglxuICAvL1xuICAvLyDimqDvuI8gKio14piFIOe7hOW/hemhu+aOkuWcqOaVsOe7hOWJjemdoioq77ya5a6/5Li76JC95bqT5pe2IGBwaXR5X2dyb3VwX2ZvcigpYFxuICAvLyDvvIhgcGlwZWxpbmUucnNg77yJ5Y+WXCLlo7DmmI7pobrluo/nrKzkuIDkuKpcIuS9nOS4uuWGmeWFpSBgR2FjaGFSZWNvcmQucGl0eV9ncm91cGBcbiAgLy8g5Y2V5YC85YiX55qE6YKj5LiA5Liq4oCU4oCU6L+Z5Liq6ZqQ5byP6K+t5LmJ5bey55+l5pyJ6Zeu6aKY77yIUzUg5b6F6Kej5Yaz77yJ77yM5L2G5b2T5YmN6KGM5Li65aaC5q2k77yMXG4gIC8vIOmhuuW6j+S4jeiDveS5seOAguS4i+mdoiBgZmxhdE1hcGAg5a+55q+P5LiqIFBvb2xUeXBlIOWFiOS6p+WHuiA14piFIOWIhue7hOOAgeWGjeS6p+WHuiA04piFXG4gIC8vIOWIhue7hO+8jOS/neivgei/meS4gOeCueOAglxuICAvL1xuICAvLyDjgIzkv53lupXmmK/lkKbnu6fmib/jgI3vvIjlj4LogIPlrp7njrDph4zogZTliqjmsaAgMTAvMTEg5LygIGluaGVyaXQ9ZmFsc2XvvIzlhbbkvZnpu5jorqRcbiAgLy8gdHJ1Ze+8ieayoeacieWtl+auteaJv+i9ve+8jOS4lOWNs+S9v+acieWtl+auteS5n+WBmuS4jeWIsOKAlOKAlOingeS4i+aWueWkp+autVwi5bey55+l57y65Y+jXCLor7TmmI7jgIJcbiAgcGl0eUdyb3VwczogV1VXQV9QT09MX1RZUEVTLmZsYXRNYXAoKHBvb2wpID0+IFtcbiAgICB7XG4gICAgICBrZXk6IGAke3Bvb2wuaWR9LTVzdGFyYCxcbiAgICAgIG1lbWJlcnM6IFtwb29sLmlkXSxcbiAgICAgIGhhcmRQaXR5OiBwb29sLmhhcmRQaXR5NVN0YXIsXG4gICAgICBjdXJ2ZTogZml2ZVN0YXJDdXJ2ZShwb29sKSxcbiAgICAgIC8vIOWPluWAvOS+neaNruingeS4iuaWuSBXVVdBX1BPT0xfVFlQRVMg6KGo5qC85rOo6YeK77yI6KeS6ImyL+atpuWZqC/mlrDmiYvkuInnsbvnmoRcbiAgICAgIC8vIGZpdmVTdGFyR3VhcmFudGVlS2luZCDliKTlrprkvp3mja7kuI5cIuaXoOWunua1i+S+neaNrlwi5qCH5rOo6YO95Zyo6YKj6YeM77yJ44CCXG4gICAgICBndWFyYW50ZWU6IFdVV0FfRklWRV9TVEFSX0dVQVJBTlRFRV9CWV9LSU5EW3Bvb2wuZml2ZVN0YXJHdWFyYW50ZWVLaW5kXSxcbiAgICAgIC8vIHBpdHlUYXJnZXQg5LiN5aGr77ya5Zue6JC9IHJhcml0eS5waXR5VGFyZ2V0ID0gXCI1XCLjgIJcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogYCR7cG9vbC5pZH0tNHN0YXJgLFxuICAgICAgbWVtYmVyczogW3Bvb2wuaWRdLFxuICAgICAgaGFyZFBpdHk6IFdVV0FfNFNUQVJfSEFSRF9QSVRZLFxuICAgICAgcGl0eVRhcmdldDogXCI0XCIsXG4gICAgICAvLyA04piFIOi9r+S/neW6lS/muJDov5vmpoLnjofmlbDlgLzmsqHmnInku7vkvZXmnaXmupDnu5nlh7rliIbmobblkb3kuK3njofvvIjnnJ/lrp7lrZjmoaPlrp7mtYtcbiAgICAgIC8vIOWPque7n+iuoeS6hiA04piFIOWHuui0p+mXtOmalOeahOacgOWwjy/mnIDlpKcv5Z2H5YC877yM6KeBXG4gICAgICAvLyBgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqczLjLvvIzmsqHmnInlg48gNeKYhSDpgqPmoLfnmoRcbiAgICAgIC8vIOmAkOaKveWRveS4reeOh+WIhuahtuaVsOaNru+8ie+8jOeUqCBjdXN0b20g5Y2g5L2N4oCU4oCU5LiN57yW6YCg5rKh5pyJ5YiG5qG25pWw5o2u5pSv5pKR55qEXG4gICAgICAvLyDmm7Lnur/lvaLnirbjgIJcbiAgICAgIGN1cnZlOiB7IGtpbmQ6IFwiY3VzdG9tXCIgYXMgY29uc3QsIGlkOiBgd3V3YS11bmNvbmZpcm1lZC00c3Rhci1wb29sLSR7cG9vbC5pZH1gIH0sXG4gICAgICAvLyA04piFIOaYr+WQpuacieexu+S8vCA14piFIOeahFwi6KeS6ImyL+atpuWZqOW/heS4reS4jeatqlwi6KeE5YiZ5pyq57uP6K+B5a6e77yM5LiN5aWX55SoIDXimIUg55qEXG4gICAgICAvLyDop4TliJnvvIzlpoLlrp7moIfms6jkuLrmnKrnn6XjgIJcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIm5vbmVcIiBhcyBjb25zdCB9LFxuICAgIH0sXG4gIF0pLFxuXG4gIHJhcml0eToge1xuICAgIGxhZGRlcjogW1wiM1wiLCBcIjRcIiwgXCI1XCJdLFxuICAgIHBpdHlUYXJnZXQ6IFwiNVwiLFxuICAgIHRpZXJMYWJlbHM6IHtcbiAgICAgIFwiM1wiOiB7IFwiemgtQ05cIjogXCLkuInmmJ9cIiB9LFxuICAgICAgXCI0XCI6IHsgXCJ6aC1DTlwiOiBcIuWbm+aYn1wiIH0sXG4gICAgICBcIjVcIjogeyBcInpoLUNOXCI6IFwi5LqU5pifXCIgfSxcbiAgICB9LFxuICB9LFxuXG4gIHRpbWU6IHtcbiAgICAvLyDorrDlvZXml7bpl7TlsLHmmK/mnI3liqHlmajov5Tlm57nmoTmjILpkp/ml7bpl7TlrZfnrKbkuLLjgIHmnKrnu4/lrqLmiLfnq6/mnKzlnLDljJbigJTigJRcbiAgICAvLyBgTW9kZWxzL0dhY2hhRGF0YS5jc2Ag55qEIGBUaW1lYCDlrZfmrrXkuI4gZml4dHVyZSDmoLfmnKznmoTlvaLmgIHkuIDoh7TvvIzov5nkuIDngrlcbiAgICAvLyDkuI5cIuaYr+WQpuefpemBk+WFt+S9k+aXtuWMuuWBj+enu1wi5piv5Lik5Zue5LqL77yM5LiN5Y+X5LiL6Z2i6L+Z5p2h57y65Y+j5b2x5ZON77yM5LqI5Lul5L+d55WZ44CCXG4gICAgcmF3VGltZUNvbnZlbnRpb246IFwic2VydmVyTG9jYWxcIixcblxuICAgIC8vIHJhd0Zvcm1hdDogXCJpc29Mb2NhbFwiIOKAlOKAlCDlj5blgLzmnaXoh6ogYGZpeHR1cmVzL3d1d2EvcmF3X3Jlc3BvbnNlLyouanNvbmBcbiAgICAvLyDkuI4gYGZpeHR1cmVzL3d1d2EvYXJjaGl2ZS93d2dhY2hhX2FyY2hpdmUuanNvbmAg55qE5b2i54q277yIYFwiMjEwMC0wMS0wNlxuICAgIC8vIFQyMjo1MzowN1wiYCDov5nnsbsgYFlZWVktTU0tRERUSEg6TU06U1Ng77yJ77yM5Y2z5pys5Zyw5a2Y5qGj5a2X5q6177yIQyNcbiAgICAvLyBgRGF0ZVRpbWVg77yMTmV3dG9uc29mdCDpu5jorqTluo/liJfljJbkuqfnianvvInnmoTlvaLmgIHjgIJcbiAgICAvL1xuICAgIC8vIOKaoO+4jyAqKkFQSSDnnJ/lrp7nur/moLzlvI/ku43mnKrpqozor4EqKu+8jOi/meS4jeaYr+mBl+a8j++8jOaYr+WmguWunuagh+azqOeahOepuueZveKAlOKAlOWujOaVtFxuICAgIC8vIOafpeivgei/h+eoi+ingSBgZml4dHVyZXMvd3V3YS9tZXRhLnRvbWxgXCLlt7Lnn6XmnKrpqozor4HpobnvvJpBUEkg55qEIFRpbWVcbiAgICAvLyDnur/moLzlvI9cIuS4gOiKgu+8mmBNb2RlbHMvR2FjaGFEYXRhLmNzYCDph4wgYFRpbWVgIOaYryBgRGF0ZVRpbWVgIOW8uuexu+Wei++8jFxuICAgIC8vIEFQSSDlj5HmnaXnmoTljp/lp4vnur/moLzlvI/lnKjlj43luo/liJfljJbpgqPkuIDliLvlsLHooqvlkIPmjonkuobvvIzlj43mjqjkuI3lh7rmnaXvvJtcbiAgICAvLyBgZG9jcy9faW50ZXJuYWwvY2FwdHVyZS9gIOS4i+ayoeaciem4o+a9ruaKk+WMheagt+acrOOAguWjsOaYjiBgaXNvTG9jYWxgIOi1jOeahOaYr1xuICAgIC8vIFwi5pys5Zyw5a2Y5qGj55qE5qC85byP5aSn5qaC546H5LiOIEFQSSDkuIDoh7RcIu+8jOWmguaenOi/meS4quWBh+iuvumUmeS6hu+8jFJ1c3Qg5L6nXG4gICAgLy8gYHBhcnNlX3JlY29yZF90aW1lYCDnjrDlnKjmlLnmiJDkuobkuKXmoLzljLnphY3vvIjkuI3lho3kvp3mrKHlsJ3or5XlpJrnp43moLzlvI/vvInvvIzkvJrlnKhcbiAgICAvLyDpppbmrKHnnJ/lrp7ph4fpm4bml7bmmI7noa7miqXplJnvvIzogIzkuI3mmK/ooqvpnZnpu5jlhZzlupXlkLjmlLbmjonigJTigJTlj4Lop4EgZ3MtY29yZTo6XG4gICAgLy8gUmF3VGltZUZvcm1hdCDmlofmoaNcIuS4uuS7gOS5iOaUueaIkOS4peagvOWMuemFjVwi5LiA6IqC44CCXG4gICAgLy9cbiAgICAvLyDimqDvuI8gKirlt7Lnn6XopLbnmrEqKu+8mum4o+a9ruWQjOaXtuacieS4pOadoeaVsOaNruadpea6kOWFseeUqOi/meS4gOS7veWjsOaYjuKAlOKAlOmHh+mbhui1sCBBUElcbiAgICAvLyDvvIjmoLzlvI/mnKrpqozor4HvvInvvIzlr7zlhaXotbDmnKzlnLDlrZjmoaPvvIhJU0/vvIznoa7lrprvvInjgILoi6XlsIbmnaXor4Hlrp4gQVBJIOWPkeeahOaYr1xuICAgIC8vIOWIq+eahOagvOW8j++8jOi/meS4gOS4qiByYXdGb3JtYXQg5bCx5LiN5aSf55So5LqG77yM6ZyA6KaB5oyJ5pWw5o2u5p2l5rqQ5YiG5Yir5aOw5piO77yb546w5ZyoXG4gICAgLy8g5qC35pys5pWw5Li6IDHvvIzmjInkuInmrKHms5XliJnkuI3kuLrmraTorr7orqHmnLrliLbvvIzlj6rlnKjov5nph4zorrDkuIDnrJTjgIJcbiAgICByYXdGb3JtYXQ6IHsga2luZDogXCJpc29Mb2NhbFwiIH0sXG5cbiAgICAvLyDimqDvuI8gdGltZXpvbmVTb3VyY2Ug5Yi75oSP5LiN5aOw5piO77yI6ICM5LiN5piv5aGrIFwiY29tcHV0ZWRcIu+8ieOAguS4ieS4quWPr+mAieW9ouaAgemAkOS4gFxuICAgIC8vIOaOkumZpO+8jOS4jeaYr+a8j+Whq++8mlxuICAgIC8vICAgLSBhcGlGaWVsZO+8mmBNb2RlbHMvR2FjaGFBUEkuY3NgIOeahCBLUkFQSUl0ZW0g5Y+q5pyJIDcg5Liq5a2X5q6177yM5rKh5pyJ5Lu75L2VXG4gICAgLy8gICAgIOaXtuWMui/lgY/np7vph4/lrZfmrrXvvIzlk43lupTkvZPph4zmsqHmnInog73or7vnmoTlgLzjgIJcbiAgICAvLyAgIC0gc3RhdGljVGFibGXvvJpgZmllbGRgIOivreS5ieaYr1wi5ZON5bqU5L2T6YeM5ZOq5Liq5a2X5q615piv5p+l6KGo6ZSuXCLvvIjkuI4gYXBpRmllbGRcbiAgICAvLyAgICAg5a+556ew77yM6KeBIHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvdHlwZXMvZ2VuZXJhdGVkLnRzIOWvueW6lOWtl+auteazqOmHiu+8ie+8jFxuICAgIC8vICAgICDkvYbmn6XooajplK7lkIzmoLflv4XpobvmnaXoh6rlk43lupTkvZPigJTigJTlk43lupTkvZPmsqHmnIkgcmVnaW9uL3N2ciDnsbvlrZfmrrXvvIxcbiAgICAvLyAgICAg6L+Z5Liq5b2i5oCB5Zyo6bij5r2u6Lqr5LiK5peg5a2X5q615Y+v5p+l77yM5LiN5pivXCLooajkuI3lhahcIueahOmXrumimOOAglxuICAgIC8vICAgLSBjb21wdXRlZO+8muacrOacuuWPquacieWbveacje+8iHN2cl9hcmVhPWNu77yJ5qC35pys77yMYFRpbWV6b25lQ29udGV4dGAg6IO957uZXG4gICAgLy8gICAgIOWIsCBob29rIOeahOi0puWPt+S+p+S/oeWPt+WPquaciSB1aWQvcmVnaW9uIOS4pOS4quWtl+aute+8m2Bob29rcy5yZXNvbHZlVGltZXpvbmVgXG4gICAgLy8gICAgIOeahOetvuWQjeimgeaxguWvueS7u+aEj+i+k+WFpemDvei/lOWbnuS4gOS4quehruWumueahCBudW1iZXLvvIzlm73pmYXmnI3nmoTljLrmnI3liJLliIbkuI5cbiAgICAvLyAgICAg5pe25Yy65rKh5pyJ5Lu75L2V5Y+v6aqM6K+B5L6d5o2u77yM6KaB5LmI57yW5LiA5byg5p+l5peg5a6e5o2u55qE5pig5bCE6KGo77yM6KaB5LmI5a+55pyq55+lXG4gICAgLy8gICAgIHJlZ2lvbiDnm7TmjqXmipvplJnkuK3mlq3ph4fpm4bigJTigJTkuKTogIXpg73mr5RcIuWmguWunuWjsOaYjuS4jeefpemBk1wi5pu057Of44CCXG4gICAgLy9cbiAgICAvLyDnnIHnlaUgdGltZXpvbmVTb3VyY2Ug5ZCO6LWw55qE5piv5a6/5Li75bey57uP6K6+6K6h5aW955qE5YWc5bqV6Lev5b6E77yI5LiN5piv5pys5o+S5Lu25Y+m5byAXG4gICAgLy8g55qE5Y+j5a2Q77yJ77yaYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2Ag55qEXG4gICAgLy8gYHJlc29sdmVfcGFnZV9sZXZlbF90aW1lem9uZV9vZmZzZXRfaG91cnNgIOWvuSBgTm9uZWAg5bCx6L+U5ZueXG4gICAgLy8gYE9rKE5vbmUpYO+8jGBub3JtYWxpemVfdGltZWAg5Zyo5YGP56e76YeP5Li6IGBOb25lYCDml7bmiormjILpkp/ml7bpl7Tljp/moLflvZPmiJBcbiAgICAvLyBVVEMg5a2Y5YWlIGBvY2N1cnJlZF9hdGDjgIFgdHpfb3JpZ2luYCDmoIforrDkuLogYEFzc3VtZWRg4oCU4oCU5Y2zXCLmlbDlrZfnhafmioTvvIxcbiAgICAvLyDmmI7noa7moIfms6jkuI3kv53nnJ9cIu+8jOS4jeaYr+mdmem7mOS6p+WHuuS4gOS4quiHquS/oeS9huWPr+iDvemUmeivr+eahOaXtumXtOaIs+OAglxuICAgIC8vXG4gICAgLy8g5a+555So5oi355qE55yf5a6e5ZCO5p6c77yI5aaC5a6e5YaZ77yM5LiN57KJ6aWw77yJ77ya5LiN5Yy65YiG5Zu95pyNL+WbvemZheacje+8jCoq5omA5pyJKirpuKPmva5cbiAgICAvLyDotKblj7fnmoQgb2NjdXJyZWRfYXQg6YO95Lya5bim552A6L+Z5LiqXCLmnKrnn6XlgY/np7tcIuagh+iusOKAlOKAlOS4jeaYr+WbvemZheacjeavlOWbveacjeabtOW3ru+8jFxuICAgIC8vIOiAjOaYr+S4pOiAheS4gOagt+S4jeS/neecn+OAguWbveacjeeUqOaIt+eci+WIsOeahOaMgumSn+aVsOWtl+Wkp+amgueOh+WwseaYr+acrOWcsOaXtumXtO+8iOWboOS4ulxuICAgIC8vIFwiYXNzdW1lZCBVVENcIiDmgbDlpb3nuqbnrYnkuo5cIuS4jeWBmuaNoueul++8jOWOn+agt+aYvuekulwi77yJ77yM5L2G5Y+q6KaB54m15raJ6Leo5pe25Yy6XG4gICAgLy8g5o2i566X5oiW5LiO5YW25a6D5bey55+l5pe25Yy65p2l5rqQ55qE5ri45oiP5YGa5pe26Ze057q/5q+U5a+577yM6L+Z5Liq5a2X5q616YO95LiN5Y+v5L+h44CC562JXG4gICAgLy8g5ou/5YiwIHN2cl9pZC9zdnJfYXJlYSDihpIgVVRDIOWBj+enu+mHj+eahOecn+WunumqjOivgeS+neaNru+8iOWTquaAleWPquaYr+WbveacjeS4gOadoe+8ie+8jFxuICAgIC8vIOW6lOaUueWbniBgY29tcHV0ZWRgIOW5tuihpeS4iiBgaG9va3MucmVzb2x2ZVRpbWV6b25lYOOAglxuICB9LFxuXG4gIHByZWNvbmRpdGlvbnM6IFtcbiAgICB7XG4gICAgICBpZDogXCJ3dXdhLmNyZWRlbnRpYWwubG9nSGFzR2FjaGFMaW5rXCIsXG4gICAgICBjYXBhYmlsaXR5OiBcImNyZWRlbnRpYWxcIixcbiAgICAgIGxldmVsOiBcInJlcXVpcmVkXCIsXG4gICAgICBkZXNjcmliZToge1xuICAgICAgICBcInpoLUNOXCI6IFwi6Ieq5Yqo6I635Y+W5ZSk5Y+W6K6w5b2V6KaB5rGC5omT5byA6L+H5LiA5qyh5ri45oiP5YaF55qE5ZSk5Y+W6K+m5oOF6aG177yM5LiU6ZyA6KaB5Zyo6ZO+5o6l5pyJ5pWI5pyf5YaF56uL5Y2z5a+85Ye6XCIsXG4gICAgICB9LFxuICAgICAgLy8g5ZCM5Y6f56We5YWI5L6L77yaSG9zdEVudiDnm67liY3msqHmnIlcIuaXpeW/l+aWh+S7tuaYr+WQpuW3suWMheWQq+WMuemFjSBVUkxcIui/meS4quS/oeWPt++8jFxuICAgICAgLy8gY2hlY2sg5Y+q6IO96L+U5ZueIHVua25vd27jgIJcbiAgICAgIGNoZWNrOiAoKSA9PiAoeyBraW5kOiBcInVua25vd25cIiB9KSxcbiAgICAgIHJlbWVkeToge1xuICAgICAgICBcInpoLUNOXCI6IFwi6K+35Zyo5ri45oiP5YaF5omT5byA5ZSk5Y+W6K+m5oOF6aG15ZCO77yM56uL5Y2z5Zue5Yiw5pys5bqU55So6YeN6K+V77yI6ZO+5o6l5pyJ5pWI5pyf5pyq57uP5a6e5rWL56Gu6K6k77yM5oyJ5pyA55+t5oOF5Ya15aSE55CG77yJXCIsXG4gICAgICB9LFxuICAgIH0sXG4gIF0sXG5cbiAgLy8gYmFzZWxpbmUg5LiN5aOw5piO77ya6bij5r2u5o6l5Y+j5LiN5YiG6aG144CB5Lmf5rKh5pyJ5bey55+l55qE5p2D5aiB6IGa5ZCI57uf6K6h5o6l5Y+j77yMXG4gIC8vIGBpbkdhbWVQYWdlQ291bnRgL2BhdXRob3JpdGF0aXZlQXBpYCDkuKTkuKrlj5jkvZPlpZfnlKjpuKPmva7nmoTmg4XlhrXpg73kvJrlkI3kuI3lia/lrp7jgIJcblxuICAvLyByZXRlbnRpb24g5LiN5aOw5piO77ya5rKh5pyJ5Lu75L2V5p2l5rqQ57uZ5Ye66bij5r2u5a6Y5pa56K6w5b2V5L+d55WZ5pyf77yM5LiN6Leo5ri45oiP5oyq55SoXG4gIC8vIOexs+WTiOa4uOS4iea4uFwiNiDkuKrmnIhcIueahOivtOazleOAglxuXG4gIC8vIGl0ZW1JZFNvdXJjZSDkuI3lo7DmmI7vvIzpu5jorqQgXCJuYXRpdmVcIuKAlOKAlHJlc291cmNlSWQg5pivIEFQSSDljp/nlJ/lrZfmrrXvvIzkuI3mmK9cbiAgLy8g5pys5Zyw5YyW54mp5ZOB5ZCN77yM5LiO5pif6ZOBL+e7neWMuumbtuWQjOeQhuOAglxuXG4gIC8vIG1ldGFkYXRhIOS4jeWjsOaYju+8muWTjeW6lOiusOW9leiHquW4piBuYW1lL3Jlc291cmNlVHlwZS9xdWFsaXR5TGV2ZWzvvIzkuI3pnIDopoFcbiAgLy8g5Y+N5p+l5a2X5YW444CCXG5cbiAgLy8gZHJhd0NvdW50aW5nIOS4jeWjsOaYju+8jOm7mOiupCBwZXJSZWNvcmTvvIjop4HkuIrmlrkgdG9Db3VudCDlh73mlbDms6jph4rvvInjgIJcbn0gc2F0aXNmaWVzIFBsdWdpbk1hbmlmZXN0O1xuIiwiLyoqXG4gKiDnu53ljLrpm7bmj5Lku7bnmoTpgIPnlJ/oiLEgaG9va3PjgIJcbiAqXG4gKiDlj6rpnIDopoHkuIDkuKogaG9va++8mlxuICpcbiAqIC0gYGRlcml2ZVJlY29yZEtleWDvvJrkuI7ljp/npZ7lkIznkIbvvIznsbPlk4jmuLjkuInmuLjkuIDlvovkuI3lvpfnnIHnlaXmnKwgaG9va++8iOingVxuICogICBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag6YeMIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlgXG4gKiAgIOaWh+aho++8ieKAlOKAlOacjeWKoeerr+mbquiKsSBJRCDkuI3lkKvljaHmsaDnu7TluqbvvIzot6jnq6/ngrnlnLrmma/kuIvoo7jnlKggYHN0YWJsZUlkYCDmnIlcbiAqICAg5pKe6ZSu6aOO6Zmp77ybSG9Zby5HYWNoYSDkuLrmraTlnKjljp/npZ7ogZTliqjmsaDkuIrnur/kuIDlubTlkI7ku5jlh7rov4fkuIDmrKHmlbTooajph43lu7rov4Hnp7vvvIxcbiAqICAg5pys5o+S5Lu25LuO56ys5LiA5aSp5bCx5oqK5Y2h5rGg57u05bqm5bm26L+bIGtlee+8jOeQhueUseS4jiBgcGx1Z2lucy9nZW5zaGluL2hvb2tzLnRzYFxuICogICDlrozlhajkuIDoh7TjgIJcbiAqIC0gYHJlc29sdmVUaW1lem9uZWAg5LiN6ZyA6KaB77yaYG1hbmlmZXN0LnRzYCDnmoQgYHRpbWUudGltZXpvbmVTb3VyY2Uua2luZGBcbiAqICAg5pivIGBcInN0YXRpY1RhYmxlXCJg77yI5ZON5bqUIGByZWdpb25gIOWtl+auteafpeihqO+8ie+8jOS4jeaYryBgXCJjb21wdXRlZFwiYO+8jOaXtuWMulxuICogICDmjaLnrpfkuI3pnIDopoHmj5Lku7bku6PnoIHlj4LkuI7jgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Ib29rcyB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCBjb25zdCBob29rczogUGx1Z2luSG9va3MgPSB7XG4gIGRlcml2ZVJlY29yZEtleTogKHJlY29yZCkgPT4ge1xuICAgIGlmICghcmVjb3JkLnN0YWJsZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGDnu53ljLrpm7borrDlvZXnvLrlsJEgc3RhYmxlSWTvvIjmnI3liqHnq6/pm6roirEgSUTvvInvvIzml6Dms5XnlJ/miJDnqLPlrprnmoQgcmVjb3JkX2tlee+8mml0ZW1JZD1cIiR7cmVjb3JkLml0ZW1JZH1cImAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gYCR7cmVjb3JkLmJhbm5lcklkfToke3JlY29yZC5zdGFibGVJZH1gO1xuICB9LFxufTtcbiIsIi8qKlxuICog57ud5Yy66Zu25o+S5Lu2IG1hbmlmZXN044CCXG4gKlxuICog6YeH6ZuG6IyD5byP77yaY3JlZGVudGlhbGVkQXBp77yIYGdzLXAtYXV0aGtleWDvvInvvIzlh63mja7mnaXmupDkuI7ljp/npZ7lkIzmrL7igJTigJTnjqnlrrbmiZPlvIBcbiAqIOiur+WPt++8iOaKveWNoe+8ieiusOW9lemhteaXtu+8jOWuouaIt+erryB3ZWJ2aWV3IOS8muWRveS4reWumOaWuSBgZ2V0R2FjaGFMb2dgIOaOpeWPo+W5tuW4puS4ilxuICogYXV0aGtlee+8jOivt+axgiBVUkwg6KKr5YaZ5YWlIGB3ZWJDYWNoZXNgIOebruW9leS4iyBgQ2FjaGUvQ2FjaGVfRGF0YS9kYXRhXzJgIOe8k+WtmFxuICog57Si5byV5paH5Lu277yI5ZCMIGBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHNgIOmhtumDqOivtOaYju+8jOS4pOiAheaYr+WQjOS4gOWll+WHreaNruiOt+WPllxuICog5py65Yi277yM5Y+q5pivIGBnYW1lRGlyYCDniYfmrrXkuI3lkIzvvInjgIJcbiAqXG4gKiDmnKzmlofku7bmmK8gYGRyaWxscy96enovbWFuaWZlc3QudHNg77yITTEtUzcg57q46Z2i5aGr6KGo5ryU57uD6I2J56i/77yJ55qE5Y+v6L+Q6KGM54mI5pys77yMXG4gKiDovazljJbml7bmjInku6XkuIvotYTmlpnph43mlrDmoKHlh4bvvIzojYnnqL/ph4zmoIfms6jkuLrjgIzmnKropobnm5YgLyDpnIDlrp7mtYvjgI3nmoTlh6DlpITlt7LnlKjnnJ/lrp5cbiAqIOa6kOeggeihpem9kO+8iOivpuingeWQhOWtl+auteaXgeazqOmHiu+8ie+8jOS4jeWGjeaYr+aOqOaWre+8mlxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDktNTBgXG4gKiAgIO+8iGBhbGxvd2VkSG9zdHNgIOS4pOS4quWfn+WQjSArIOm7mOiupOerr+eCueWujOaVtOi3r+W+hCBgL2NvbW1vbi9nYWNoYV9yZWNvcmQvYXBpL2dldEdhY2hhTG9nYO+8iVxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9saWIucnM6MTQ1LTE0OSwyMDAtMjA0YFxuICogICDvvIhgdGltZXpvbmVTb3VyY2UudGFibGVgIOS6lOadoeWMuuacjeeggeWIsCBVVEMg5YGP56e76YeP55qE5a6M5pW05pig5bCE77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjYwLTE2MGBcbiAqICAg77yIYEdhY2hhTG9nYCDnu5PmnoTkvZPvvJpgZ2FjaGFfdHlwZWAvYGl0ZW1faWRgL2BpdGVtX3R5cGVgL2ByYW5rX3R5cGVgL2BnYWNoYV9pZGBcbiAqICAg5Zub5qy+57Gz5ZOI5ri45ri45oiP5YWx55So5ZCM5LiA5aWX5a2X5q615a6a5LmJ77yM57ud5Yy66Zu25rKh5pyJ5Lu75L2V5a2X5q615ZCN54m55L6L77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjMtMzksMTk5LTI0OSw0NzctNDc4YFxuICogICDvvIhgcmVhbF9nYWNoYV90eXBlYCDliIbpobXlj4LmlbDlkI3jgIHpmZDpgJ/kuI7ph43or5XnmoTnnJ/lrp7lrp7njrDjgIHlk43lupTorrDlvZUgOSDplK7nu5PmnoTjgIFcbiAqICAg5Y2h5rGg57G75Yir56CB6KGo77yJXG4gKiAtIOecn+WunuaKveWNoeWtmOaho+Wunua1i++8iOacrOWcsOiEseaVj+agt+acrO+8jOingSBgZml4dHVyZXMvenp6L21ldGEudG9tbGDvvInvvJpcbiAqICAgYGdhY2hhX2lkYCDmgZLkuLogYCcwJ2DjgIFgY291bnRgIOaBkuS4uiBgJzEnYOOAgWBpZGAg5oGS5Li6IDE5IOS9jeaVsOWtl+Wtl+espuS4suOAgVxuICogICBgaXRlbV90eXBlYC9gcmFua190eXBlYCDnu4TlkIjkuI3mmK/nrJvljaHlsJTnp6/vvIjpn7Pmk47ni6zmnIkgQiDnuqfvvIlcbiAqIC0g5a6Y5pa55L+d5bqV5qaC546H5YWs56S6IEpTT07vvIhgb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vbmFwLy4uLmDvvInvvIxcbiAqICAg6KeB5LiL5pa5IGBwaXR5R3JvdXBzYCDml4Hms6jph4pcbiAqXG4gKiBleGNoYW5nZUZvcm1hdHMg5LiN5aOw5piO77ya57ud5Yy66Zu255qEIFVJR0Yg5a2X5q615pig5bCE5pyq57uP55yf5a6e5a6e546w5qCh5YeG77yM5pysIFN0YWdlXG4gKiDkuI3lnKjmsqHmnInmoKHlh4bnmoTmg4XlhrXkuIvnvJbpgKDlr7zlh7rmoLzlvI/mlK/mjIHvvIjkuI4gYGRyaWxscy96enovbWFuaWZlc3QudHNgIOeahOWIpOaWrVxuICog5LiA6Ie077yM5Y6f56We5bey5a6e546w55qEIGB1aWdmLXY0YCDkuI3ku6Pooajnu53ljLrpm7blj6/ku6Xnm7TmjqXnhafmioTlkIzkuIDku73lo7DmmI7vvInjgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqXG4gKiDku44gYGdldEdhY2hhTG9nYCDlk43lupTkvZPph4zlj5blh7rmnKzpobXorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDnnJ/lrp7lk43lupTlvaLmgIEgYHsgcmV0Y29kZSwgbWVzc2FnZSwgZGF0YTogeyBsaXN0OiBbLi4uXSwgcmVnaW9uIH0gfWAg5LiO5Y6f56WeXG4gKiDlrozlhajlkIzmnoTvvIzlt7LnlKggYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIwMy0yMDRgXG4gKiDvvIhgcmVzPy5kYXRhPy5saXN0YCDliKTnqbrjgIFgcmVzLnJlZ2lvbmAg5Y+W5YC877yJ5qC45a6e77yM5LiN5piv57G75q+U5o6o5pat44CC6Ziy5b6h5byPXG4gKiDop6PmnpDvvJrku7vkvZXkuIDlsYLlvaLnirbkuI3lr7nlsLHov5Tlm57nqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjvvIzkuqTnu5nliIbpobXlvJXmk47mjInnqbrpobXlpITnkIbjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhTG9nTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBkYXRhID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xufVxuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKiDlrpjmlrnlk43lupTph4znmoQgYGNvdW50YCDmmK/mlbDlrZflrZfnrKbkuLLvvIjnnJ/lrp7lrZjmoaPlrp7mtYvmgZLkuLogYFwiMVwiYO+8ie+8jOmYsuW+oeW8j+i9rOaNou+8jOW8guW4uOi+k+WFpeWFnOW6leS4uiAx44CCICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA14piF77yIUyDnuqfvvInkv53lupXmm7Lnur9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIGJhc2UgLyBoYXJkUGl0eSAvIGd1YXJhbnRlZSDkuInpobnlj5boh6rlrpjmlrnkv53lupXmpoLnjoflhaznpLogSlNPTu+8iOS4gOaJi+aVsOaNru+8jFxuLy8gYGh0dHBzOi8vb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vbmFwL3Byb2RfZ2ZfY24vPGlkPi96aC1jbi5qc29uYO+8ie+8m1xuLy8gc3RhcnQgLyBzdGVwIOWumOaWueS7juacquWFrOekuu+8jOaMieWQjOS6uuekvuWMuuWPo+W+hOaOqOeul+KAlOKAlOS4jlxuLy8gYHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50czoxNjEtMTY0YCDlkIzkuIDlpITnkIbmlrnlvI/vvIg5MCDnoazkv53lupXmsr/nlKjljp/npZ5cbi8vIOOAjDc0IOaKvei1t+avj+aKvSArNiXjgI3nmoTlj6PlvoTvvJs4MCDnoazkv53lupXmjInmr5TkvovmjaLnrpfvvIzlj5YgYHN0YXJ0OiA2NSwgc3RlcDogMC4wN2DvvIxcbi8vICoq6L+Z5Lik5Liq5pWw5a2X5pys6Lqr5rKh5pyJ5a6Y5pa55p2l5rqQ77yM57qv57K55piv5oyJIDkw4oaSNzQvMC4wNiDnmoTmr5TkvovlpJbmjqgqKu+8ieOAglxuLy8g4pqg77iPIOS4jeimgeaKiiBzdGFydC9zdGVwIOivr+W9k+WumOaWueaVsOWAvOS9v+eUqOOAglxuY29uc3QgRVhDTFVTSVZFX0NVUlZFID0geyBraW5kOiBcInNvZnRQaXR5XCIsIGJhc2U6IDAuMDA2LCBzdGFydDogNzQsIHN0ZXA6IDAuMDYgfSBhcyBjb25zdDtcbmNvbnN0IFdfRU5HSU5FX0NVUlZFID0geyBraW5kOiBcInNvZnRQaXR5XCIsIGJhc2U6IDAuMDEsIHN0YXJ0OiA2NSwgc3RlcDogMC4wNyB9IGFzIGNvbnN0O1xuXG5leHBvcnQgY29uc3QgbWFuaWZlc3QgPSB7XG4gIGlkOiBcInp6elwiLFxuICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi57ud5Yy66Zu2XCIgfSxcbiAgc2RrVmVyc2lvbjogXCIxLjAuMFwiLFxuICBwbGF0Zm9ybXM6IFtcIndpbmRvd3NcIl0sXG4gIG1haW50YWluZXJzOiBbXCJnYWNoYS1zdHVkaW9cIl0sXG5cbiAgLy8gZXhjaGFuZ2VGb3JtYXRzIOS4jeWjsOaYju+8jOingeaWh+S7tuWktOazqOmHiuOAglxuXG4gIC8vIOWbvuagh+WcsOWdgOadpeiHqiBUYXBUYXAg5bqU55So5biC5Zy66aG16Z2i77yM5bey5a6e5rWL6aqM6K+B77yM5ZCMIGBwbHVnaW5zL2dlbnNoaW4vXG4gIC8vIG1hbmlmZXN0LnRzYCDlkIzmrL7mlZnorq3igJTigJTlnLDlnYDku6UgLmpwZyDnu5PlsL7kvYblrp7pmYXlhoXlrrnmmK8gUE5H77yM5LiN6KaBXCLnuqDmraNcIlxuICAvLyDmianlsZXlkI3vvIzmoLzlvI/moKHpqozvvIhjb250ZW50LXR5cGUgKyBtYWdpYyBieXRlc++8ieaYr+Wuv+S4u+S+p+iBjOi0o+OAglxuICBpY29uVXJsOlxuICAgIFwiaHR0cHM6Ly9pbWctdGMudGFwaW1nLmNvbS9tYXJrZXQvaW1hZ2VzL2NjYTRiMTdkNmRkOTAzMDAzNzA5NWMxOWFhOWZlNzhhLnBuZy9fdGFwX2FwcGljb25fbS5qcGdcIixcblxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwiY2hyb21pdW1DYWNoZVwiLFxuICAgICAgICAvLyDimqDvuI8g55u45a+554mH5q6177yM5LiN5piv57ud5a+56Lev5b6E44CC5p2l5rqQIHJlc2VhcmNoLzAx44CM5pWw5o2u6YeH6ZuG5Y6f55CG5YiG5bGC44CNXG4gICAgICAgIC8vIOiMg+W8jyBBIOmAmueUqOe7k+iuuu+8mnvlronoo4Xnm67lvZV9L1plbmxlc3Nab25lWmVyb19EYXRhL3dlYkNhY2hlcy9754mI5pysfS9cbiAgICAgICAgLy8gQ2FjaGUvQ2FjaGVfRGF0YS9kYXRhXzLjgIJcbiAgICAgICAgZ2FtZURpcjogXCJaZW5sZXNzWm9uZVplcm9fRGF0YS93ZWJDYWNoZXNcIixcbiAgICAgICAgLy8g56uv54K55pyA5ZCO5LiA5q615pivIFwiZ2V0R2FjaGFMb2dcIu+8iOS4juWOn+elni/mmJ/pk4HlkIzlkI3vvInvvIzlt7LnlKhcbiAgICAgICAgLy8gSG9Zby5HYWNoYSBgY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDktNTBgIOeahOWujOaVtOi3r+W+hFxuICAgICAgICAvLyBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1uYXAoLXNnKS4uLi9jb21tb24vZ2FjaGFfcmVjb3JkL2FwaS9nZXRHYWNoYUxvZ1wiXG4gICAgICAgIC8vIOaguOWunuKAlOKAlGRyaWxscyDojYnnqL/ph4xcIuerr+eCueWtl+mdouWQjeacquimhueblu+8jOmcgOWunua1i1wi6L+Z5p2hIFRPRE8g5bey6Kej5Yaz44CCXG4gICAgICAgIHVybFBhdHRlcm46IC9odHRwczpcXC9cXC8uKz9nZXRHYWNoYUxvZ1teXCJdKy8sXG4gICAgICB9LFxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICAvLyDimIUg5beu5byC54K577ya5YiG6aG15Y+C5pWw5ZCN5pivIHJlYWxfZ2FjaGFfdHlwZe+8jOS4jeaYryBnYWNoYV90eXBl4oCU4oCU55u05o6l5YaZXG4gICAgICAgIC8vIOi/m+i/meS4gOihjOWtl+espuS4suaooeadv++8jOS4jemcgOimgeS7u+S9lemineWkluWjsOaYjuWtl+auteOAgui/meaYr+WvuVxuICAgICAgICAvLyBgQ3JlZGVudGlhbGVkQXBpUGlwZWxpbmVQYXJhbXMucGFnZVNpemVgIOaWh+aho+mHjOmCo+adoVwi57ud5Yy66Zu255qEXG4gICAgICAgIC8vIHJlYWxfZ2FjaGFfdHlwZSDlt67lvILnhafmoLflj6rmlLnoh6rlt7HpgqPkuIDooYzmqKHmnb9cIue7k+iuuueahOWunumZheiQveWcsO+8jOadpea6kFxuICAgICAgICAvLyBgenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjAyYO+8mlxuICAgICAgICAvLyAgIGAke3VybH0mcmVhbF9nYWNoYV90eXBlPSR7a2V5fSZwYWdlPSR7cGFnZX0mc2l6ZT0kezIwfS4uLmBcbiAgICAgICAgLy9cbiAgICAgICAgLy8gZW5kX2lkPTDvvJrkuI7ljp/npZ4v5pif6ZOB55qE5YaZ5rOV5LiA6Ie077yM5L2c5Li65q+P6aG15Zu65a6a6L+95Yqg55qE5bi46YeP5Y+C5pWw44CCXG4gICAgICAgIC8vIOKaoO+4jyDnnJ/lrp7lj4LogIPlrp7njrDph4wgZW5kX2lkIOWFtuWunuaYr+S8muWPmOWMlueahOa4uOagh++8iOWQjOaWh+S7tuWQjOS4gOihjOeahFxuICAgICAgICAvLyBgJHtlbmRJZCA/ICcmZW5kX2lkPScgKyBlbmRJZCA6ICcnfWDvvIzlj5bkuIrkuIDpobXmnIDlkI7kuIDmnaHorrDlvZXnmoRcbiAgICAgICAgLy8gaWTvvInvvIzkvYbmnKzpobnnm67nmoQgTDEg5YiG6aG15byV5pOO5oyJ6aG156CB6YCS5aKe57+76aG144CB5LiN6L+96Liq5ri45qCH77yI5pyq5aOw5piOXG4gICAgICAgIC8vIGBleHRyYWN0Q3Vyc29yYCDml7bnmoTnvLrnnIHooYzkuLrvvInvvIzlm7rlrprkvKAgMCDmmK/msr/nlKjlkIzml4/nuqblrprvvIzmnKrpkojlr7lcbiAgICAgICAgLy8g57ud5Yy66Zu254us56uL6aqM6K+BXCLmnI3liqHnq6/lnKggZW5kX2lkIOaBkuS4uiAwIOaXtuaYr+WQpuS7jeiDveato+ehrue/u+mhtVwi4oCU4oCU5LiOXG4gICAgICAgIC8vIGBkcmlsbHMvenp6L21hbmlmZXN0LnRzYCDlr7nov5nkuKrlj4LmlbDnmoTmgIHluqbkuIDoh7TvvIjmnKrni6znq4vlrp7mtYvvvInjgIJcbiAgICAgICAgdXJsOiBcInt7Y3JlZGVudGlhbH19JnBhZ2U9e3twYWdlfX0mcmVhbF9nYWNoYV90eXBlPXt7Z2FjaGFUeXBlfX0mc2l6ZT17e3BhZ2VTaXplfX0mZW5kX2lkPTBcIixcbiAgICAgIH0sXG4gICAgICAvLyDkuKTkuKogaG9zdCDpg73lv4XpobvloavvvJp1cmxQYXR0ZXJuIOacrOi6q+S4jeWMuuWIhuWfn+WQje+8jOWPquimgSBVUkwg6YeM5Ye6546wXG4gICAgICAvLyBcImdldEdhY2hhTG9nXCIg5bCx5Lya5Yy56YWN77yM5Zu95pyNL+WbvemZheacjeWuouaIt+err+e8k+WtmOmDveWPr+iDveWRveS4reKAlOKAlOWPquWhq+WbveacjVxuICAgICAgLy8g5Lya5oqK5Zu96ZmF5pyN546p5a6255qE5q2j5bi46K+35rGC6K+v5Yik5Li65oqV5q+S77yI5ZCM5Y6f56WeIG1hbmlmZXN0IDc5LTg4IOihjOeahOaVmeiure+8ieOAglxuICAgICAgLy8g5Lik5Liq5Z+f5ZCN5LiO6buY6K6k56uv54K56Lev5b6E5bey55SoIEhvWW8uR2FjaGEg5rqQ56CB5qC45a6e77yI6Z2e5pys5o+S5Lu254us56uL5a6e5rWL77yMXG4gICAgICAvLyDku4XkvZzkuovlrp7lvJXnlKjvvInvvJpcbiAgICAgIC8vICAgY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDlcbiAgICAgIC8vICAgICAoKE5hcCwgT2ZmaWNpYWwpLCBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24tbmFwLm1paG95by5jb20vY29tbW9uL2dhY2hhX3JlY29yZC9hcGkvZ2V0R2FjaGFMb2dcIlxuICAgICAgLy8gICBjcmF0ZXMvZ2FtZV9iaXovc3JjL2FwaS5yczo1MFxuICAgICAgLy8gICAgICgoTmFwLCBPdmVyc2VhKSwgIFN0YW5kYXJkKSAtPiBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1uYXAtc2cuaG95b3ZlcnNlLmNvbS9jb21tb24vZ2FjaGFfcmVjb3JkL2FwaS9nZXRHYWNoYUxvZ1wiXG4gICAgICAvLyDkuI4gYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjE1YO+8iOWbveacjeWfn+WQje+8ieOAgVxuICAgICAgLy8gYDozMjItMzI0YO+8iOWbvemZheacjeWfn+WQjeWIh+aNouWIhuaUr++8ieS6kuebuOWNsOivgeOAglxuICAgICAgYWxsb3dlZEhvc3RzOiBbXCJwdWJsaWMtb3BlcmF0aW9uLW5hcC5taWhveW8uY29tXCIsIFwicHVibGljLW9wZXJhdGlvbi1uYXAtc2cuaG95b3ZlcnNlLmNvbVwiXSxcbiAgICAgIGV4dHJhY3RMaXN0OiBleHRyYWN0R2FjaGFMb2dMaXN0LFxuXG4gICAgICAvLyDpmZDpgJ/nrZbnlaXvvJrlrr/kuLvmjInlrZfmrrXpgJDkuIDlj5ZcIuabtOa4qeWSjOiAhVwi5LiO57y655yB5YC85ZCI5bm277yM5LiN5piv5pW05L2T6KaG55uWXG4gICAgICAvLyDvvIjop4EgYENyZWRlbnRpYWxlZEFwaVBpcGVsaW5lUGFyYW1zLnJhdGVMaW1pdGAg5paH5qGj77yJ44CC5pWw5YC855u05o6l5Y+W6IeqXG4gICAgICAvLyDlj4LogIPlrp7njrAgYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzYO+8mlxuICAgICAgLy8gICA6MjM077yIYGF3YWl0IHNsZWVwKDAuMylg77yM5q+P6aG16K+35rGC5ZCO5Zu65a6a562J5b6F77yJXG4gICAgICAvLyAgIDoyMjctMjMw77yIYGlmIChwYWdlICUgMTAgPT09IDApIHsgLi4uOyBhd2FpdCBzbGVlcCgxKSB9YO+8jOavjyAxMCDpobVcbiAgICAgIC8vICAgICDpop3lpJblpJrnrYkgMSDnp5LvvIlcbiAgICAgIC8vICAgOjE5OS0yMTLvvIhgZ2V0R2FjaGFMb2dgIOmAkuW9kumHjeivle+8jOWIneWniyBgcmV0cnlDb3VudDogNWDvvIzph43or5Xpl7TpmpRcbiAgICAgIC8vICAgICBgYXdhaXQgc2xlZXAoNSlg77yJXG4gICAgICAvLyBwZXJQYWdlRGVsYXlNcy9yZXRyeS5tYXhBdHRlbXB0cyDmgbDlpb3kuI7lrr/kuLvnvLrnnIHlgLznm7jlkIzvvIzov5nph4zku43nhLbmmL7lvI9cbiAgICAgIC8vIOWjsOaYjuKAlOKAlOeQhueUseaYr1wi6L+Z5Liq5pWw5a2X5pyJ5Ye65aSEXCLmnKzouqvlsLHmmK/mlofmoaPvvIzkuI3mmK/kuLrkuobmlLnlj5jnvLrnnIHooYzkuLrjgIJcbiAgICAgIHJhdGVMaW1pdDoge1xuICAgICAgICBwZXJQYWdlRGVsYXlNczogMzAwLFxuICAgICAgICBiYXRjaFNpemU6IDEwLFxuICAgICAgICBiYXRjaERlbGF5TXM6IDEwMDAsXG4gICAgICAgIHJldHJ5OiB7IG1heEF0dGVtcHRzOiA1LCBkZWxheU1zOiA1MDAwIH0sXG4gICAgICB9LFxuXG4gICAgICAvLyBiYW5uZXJJZGVudGl0eSDkuI3lo7DmmI7vvIznvLrnnIEgXCJyZXNwb25zZVwi4oCU4oCU57Gz5ZOI5ri45LiJ5ri46YO95Y+v6IO95re35rGg77yI5Y6f56WeXG4gICAgICAvLyDlt7Llrp7mtYsgMzAxIOWTjeW6lOmHjOa3t+WbniA0MDAg55qE6K6w5b2V77yM6KeBIGBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHNgXG4gICAgICAvLyBiYW5uZXJzIOazqOmHiu+8ie+8jOe7neWMuumbtuiZveeEtuacrOaPkuS7tuWwmuacquaLv+WIsFwi5ZON5bqU5re35rGgXCLnmoTnm7TmjqXor4Hmja7vvIzkvYZcbiAgICAgIC8vIOS5n+ayoeacieivgeaNruaOkumZpO+8jOaMieWQjOaXj+S/neWuiOWBh+iuvue7p+e7reS/oeWTjeW6lO+8jOS4jei0uOeEtuWjsOaYjiBcInF1ZXJ5XCLigJTigJRcbiAgICAgIC8vIGBiYW5uZXJJZGVudGl0eWAg5paH5qGj5piO56Gu6K2m5ZGK6L+H77yaXCLoi6Xmn5DmuLjmiI/lhbblrp7kvJrmt7fmsaDljbTlo7DmmI7kuoZcbiAgICAgIC8vIHF1ZXJ577yM6KKr5re36L+b5p2l55qE6K6w5b2V5Lya6KKr6Z2Z6buY6ZSZ6K+v5b2S5rGgXCLvvIzku6Pku7fkuI3lr7nnp7DvvIzlm6DmraTkuI3lhpnov5lcbiAgICAgIC8vIOS4gOihjO+8iOe8uuecgeWNs+ato+ehrumAieaLqe+8ie+8jOS7heWcqOatpOazqOmHiumHjOivtOaYjuS4uuS7gOS5iOS4jeWGmeOAglxuICAgIH0sXG4gIH0sXG5cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIue7neWMuumbtiBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgLy8g5ZON5bqU6K6w5b2VIDExIOmUru+8iOecn+WunuWtmOaho+Wunua1iyArIGB6enotc2lnbmFsLXNlYXJjaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczo0NzctNDc4YFxuICAgICAgLy8g5Y+M5p2l5rqQ56Gu6K6k5LiA6Ie077yJ77yaaWQgLyB1aWQgLyBnYWNoYV90eXBlIC8gZ2FjaGFfaWQgLyBpdGVtX2lkIC8gY291bnQgL1xuICAgICAgLy8gdGltZSAvIG5hbWUgLyBpdGVtX3R5cGUgLyByYW5rX3R5cGUgLyBsYW5n44CC5LiO5Y6f56We5LiN5ZCM77yM57ud5Yy66Zu2IEFQSVxuICAgICAgLy8g55u05o6l6L+U5ZueIGl0ZW1faWTvvIhIb1lvLkdhY2hhIGBjcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjE0NC0xNDlg77yaXG4gICAgICAvLyBcIkV4Y2VwdCBmb3IgJ0dlbnNoaW4gSW1wYWN0J1wi77yM5Y2z57ud5Yy66Zu244CB5pif6ZOB5Z2H5pyJ5q2k5a2X5q6177yJ77yM5Zug5q2kIGl0ZW1JZFxuICAgICAgLy8g5Y+WIGl0ZW1faWTvvIzkuI3otbDljp/npZ7pgqPmnaFcIuacrOWcsOWMlueJqeWTgeWQjeWFnOW6lVwi55qE54m55L6L6Lev5b6E77yM5Lmf5LiN6ZyA6KaB5aOw5piOXG4gICAgICAvLyBgaXRlbUlkU291cmNlYO+8iOe8uuecgSBcIm5hdGl2ZVwiIOWNs+ato+ehru+8ieOAglxuICAgICAgY29uc3QgaXRlbUlkID0gdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaXRlbV9pZCk7XG4gICAgICBpZiAoIWl0ZW1JZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLnu53ljLrpm7YgZXh0cmFjdFJlY29yZO+8muiusOW9lee8uuWwkSBpdGVtX2lk77yM5peg5rOV56Gu5a6aIGl0ZW1JZFwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbUlkLFxuICAgICAgICB0aW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC50aW1lKSA/PyBcIlwiLFxuICAgICAgICAvLyDimqDvuI8gKirmjqjmlq3vvIzpnZ7lrp7mtYsqKu+8muafpeivouWPguaVsOWQjeW3suehruiupOaUueaIkOS6hiByZWFsX2dhY2hhX3R5cGVcbiAgICAgICAgLy8g77yIYGdldERhdGEuanM6MjAyYO+8ie+8jOS9huWTjeW6lOiusOW9lemHjOWvueW6lOWtl+auteeahOmUruWQjeaYr+WQpuS5n+WPq1xuICAgICAgICAvLyByZWFsX2dhY2hhX3R5cGXjgIHov5jmmK/ku43nhLblj6sgZ2FjaGFfdHlwZe+8jHJlc2VhcmNoLzAz44CBMDQg5Z2H5pyq55u05o6lXG4gICAgICAgIC8vIOe7meWHuuOAgui/memHjOmAieaLqee7p+e7reivuyByZWNvcmQuZ2FjaGFfdHlwZeKAlOKAlOacgOW8uuaXgeivgeaYryBIb1lvLkdhY2hhXG4gICAgICAgIC8vIGBjcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjgwLTkwYCDnmoQgYEdhY2hhTG9nLmdhY2hhX3R5cGVgXG4gICAgICAgIC8vIOWtl+aute+8muWbm+asvuexs+WTiOa4uOa4uOaIj++8iOWQq+e7neWMuumbtu+8ieWFseeUqOWQjOS4gOS4qiBgZ2FjaGFfdHlwZWAg5Y+N5bqP5YiX5YyWXG4gICAgICAgIC8vIOebruagh++8jGRvYyBjb21tZW50IOayoeacieS4uue7neWMuumbtueVmeS7u+S9leWtl+auteWQjeeJueS+i++8iOWUr+S4gOeahOeJueS+i+azqOmHiuaYr1xuICAgICAgICAvLyBcIkdlbnNoaW4gSW1wYWN0OiBNaWxpYXN0cmEgV29uZGVybGFuZFwi77yM5LiO57ud5Yy66Zu25peg5YWz77yJ44CC5piv5peB6K+B77yMXG4gICAgICAgIC8vIOS4jeaYr+ebtOaOpeWunua1i+e7neWMuumbtuafkOS4gOadoeecn+WunuWTjeW6lOaKpeaWh+W+l+WHuueahOe7k+iuuu+8jOWmguWunuagh+azqOOAglxuICAgICAgICBiYW5uZXJJZDogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuZ2FjaGFfdHlwZSkgPz8gXCJcIixcbiAgICAgICAgY291bnQ6IHRvQ291bnQocmVjb3JkLmNvdW50KSxcbiAgICAgICAgbmFtZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQubmFtZSksXG4gICAgICAgIC8vIOesrOS4ieaho+eJqeWTgeWIhuexu1wi6YKm5biDXCLigJTigJRpdGVtVHlwZSDmnKzmnaXlsLHmmK/oh6rnlLHlrZfnrKbkuLJcbiAgICAgICAgLy8g77yIYFVuaWZpZWRSZWNvcmRGaWVsZHMuaXRlbVR5cGU/OiBzdHJpbmdg77yJ77yM6KOF5Lik5qGj6L+Y5piv5LiJ5qGj5a+557G75Z6LXG4gICAgICAgIC8vIOezu+e7n+ayoeacieWMuuWIq++8jOS4jemcgOimgeS7u+S9leaWsOWtl+auteOAglxuICAgICAgICBpdGVtVHlwZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaXRlbV90eXBlKSxcbiAgICAgICAgcmFyaXR5OiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5yYW5rX3R5cGUpLFxuICAgICAgICBzdGFibGVJZDogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaWQpLFxuICAgICAgICAvLyBnYWNoYV9pZCDmgZLkuLogJzAn77yI55yf5a6e5a2Y5qGj5a6e5rWL5YWo6YeP6K6w5b2V5LiA6Ie077yJ77yM5Yi75oSP5LiN6K+75Y+W4oCU4oCUXG4gICAgICAgIC8vIOKaoO+4jyAqKuWJjeaPkOW3suabtOaWsCoq77yaYFVuaWZpZWRSZWNvcmRGaWVsZHNgIOeOsOWcqOaciSBgZ2FjaGFJZGAg5a2X5q615LqGXG4gICAgICAgIC8vIO+8iOaYn+mTgeaPkuS7tuW3suaOpeWFpe+8jOingSBgcGx1Z2lucy9zdGFycmFpbC9tYW5pZmVzdC50c2DvvInvvIxcIuayoeacieWtl+auteiDvVxuICAgICAgICAvLyDmib/ovb3lroNcIuS4jeWGjeaYr+eQhueUseOAgue7neWMuumbtuS7jeeEtuS4jeivu+eahOecn+WunueQhueUse+8mlVJR0YgdjQuMiDmnYPlqIEgSlNPTlxuICAgICAgICAvLyBTY2hlbWEg6YeMIGBuYXBg77yI57ud5Yy66Zu277yJ5q615oqKIGBnYWNoYV9pZGAg5YiX5Li6Kirlj6/pgIkqKu+8iOS4jeWDj1xuICAgICAgICAvLyBgaGtycGdgIOauteWIl+S4uuW/heWhq++8ie+8jOS4lOi/meS4quWAvOaBkuS4uiAnMCfvvIzor7vkuobmsqHmnInkv6Hmga/ph4/igJTigJTokL3ov5nkuIDliJdcbiAgICAgICAgLy8g5LiN5Lya6K6p5Lu75L2V5LiL5ri45Yik5pat5Y+Y5b6X5pu05YeG44CC5Y2h5rGg5pyf5qyh5b2S5bGe5LuN54S25a6M5YWo5Lqk57uZIGJhbm5lcklkXG4gICAgICAgIC8vIO+8iGdhY2hhX3R5cGUg57G75Yir56CB77yJKyDlpJbpg6ggYmFubmVyIOWFg+aVsOaNruaOqOWvvO+8jOS4jeS+nei1liBnYWNoYV9pZOOAglxuICAgICAgICAvLyDimqDvuI8g5LiN6KaB5oqKIFwi5oGS5Li6ICcwJ1wiIOW9k+aIkOiDveS+nei1lueahOaWreiogOWOu+WGmeagoemqjOmAu+i+ke+8mkhvWW8uR2FjaGFcbiAgICAgICAgLy8gYGNyYXRlcy91cmxfc2NyYXBlci9zcmMvdHlwZXMucnM6OTctMTAyYCDlr7nov5nkuKrlrZfmrrXnlKjnmoTmmK9cIuWuueW/jeepulxuICAgICAgICAvLyDlrZfnrKbkuLJcIueahOWPjeW6j+WIl+WMlu+8iGBnYWNoYV9sb2dfZW1wdHlfc3RyaW5nX251bWJlcl9pbnRvYO+8ie+8jOivtOaYjuecn+WunlxuICAgICAgICAvLyDlk43lupTph4zov5nkuKrlrZfmrrXlj6/og73mmK/nqbrkuLLvvIzkuI3msLjov5zmmK/lrZfpnaLph48gXCIwXCLjgIJcbiAgICAgIH07XG4gICAgfSxcbiAgfSxcblxuICAvLyDljaHmsaDnsbvliKvnoIHkuI7mmL7npLrlkI3vvIzlj4zmnaXmupDnoa7orqTkuIDoh7TvvJrnnJ/lrp7lrZjmoaMgYHR5cGVNYXBgIOWtl+autSArXG4gIC8vIGB6enotc2lnbmFsLXNlYXJjaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczoyMy0zMGAg55qEIGBkZWZhdWx0VHlwZU1hcGDvvIxcbiAgLy8gNiDpobnpgJDmnaHlr7nkuIrvvIzpm7bliIbmrafjgIJcbiAgLy9cbiAgLy8g4pqg77iPIOi3qOa4uOaIj+WkjeeUqOmZt+mYse+8mmlkIFwiMlwiIOWcqOaYn+mTgeaYr1wi5paw5omL5rGgXCLvvIzlnKjnu53ljLrpm7bmmK9cIueLrOWutumikeautVwiXG4gIC8vIO+8iOinkuiJsiBVUCDmsaDvvIznrYnku7fkuo7ljp/npZ7nmoTop5LoibLmtLvliqjnpYjmhL/vvInigJTigJTlkIzkuIDkuKogaWQg5Zyo5Lik5Liq5o+S5Lu26YeM6K+t5LmJXG4gIC8vIOebuOWPje+8jOS4jeiDveaKiuafkOS4qua4uOaIj+eahCBiYW5uZXIgaWQg5bi46YeP5b2T5oiQXCLot6jmuLjmiI/pgJrnlKhcIuWOu+WkjeeUqOOAglxuICAvL1xuICAvLyDlnYfkuI3pnIDopoEgZW5kcG9pbnRPdmVycmlkZeKAlOKAlHJlc2VhcmNoLzA0IOS4juacrOasoeaguOWunueahOa6kOeggeWdh+acquingua1i+WIsOe7neWMuumbtlxuICAvLyDlrZjlnKjnsbvkvLzmmJ/pk4EgMjEvMjIg55qE56uv54K55YiG5rWB44CCXG4gIGJhbm5lcnM6IFtcbiAgICB7IGlkOiBcIjFcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuW4uOmpu+mikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjJcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIueLrOWutumikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjNcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIumfs+aTjumikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjVcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIumCpuW4g+mikeautVwiIH0gfSxcbiAgICB7IGlkOiBcIjEwMlwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi54us5a626YeN5pigXCIgfSB9LFxuICAgIHsgaWQ6IFwiMTAzXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLpn7Pmk47lm57lk41cIiB9IH0sXG4gIF0sXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIHBpdHlHcm91cHPvvJpiYXNlL2hhcmRQaXR5L2d1YXJhbnRlZSDlj5boh6rlrpjmlrnkv53lupXmpoLnjoflhaznpLogSlNPTlxuICAvLyDvvIhvcGVyYXRpb24td2Vic3RhdGljLm1paG95by5jb20vZ2FjaGFfaW5mby9uYXAvcHJvZF9nZl9jbi88aWQ+L3poLWNuLmpzb27vvIxcbiAgLy8g5LiA5omL5pWw5o2u77yJ77ybc3RhcnQvc3RlcCDmmK/npL7ljLrmjqjnrpfvvIzpnZ7lrpjmlrnvvIzop4HkuIrmlrkgRVhDTFVTSVZFX0NVUlZFIC9cbiAgLy8gV19FTkdJTkVfQ1VSVkUg5aOw5piO5peB55qE6K+05piO44CC5pys6L2u5Y+q5aOw5piOIFMg57qn77yIcmFyaXR5LnBpdHlUYXJnZXQg5a+55bqU5qGj77yJXG4gIC8vIOS/neW6lee7hO+8jOS4jeWjsOaYjiBBIOe6p+e7hOKAlOKAlOWfuue6vyBgcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzYCDlkIzmoLflj6rmnInkuIDkuKpcbiAgLy8gcGl0eUdyb3Vw77yM5L+d5oyB5Y+v5q+U77yMQSDnuqfkv53lupXmnKzova7mnKropobnm5bjgIJcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIHBpdHlHcm91cHM6IFtcbiAgICB7XG4gICAgICBrZXk6IFwiZXhjbHVzaXZlQ2hhbm5lbFwiLFxuICAgICAgbWVtYmVyczogW1wiMlwiXSxcbiAgICAgIGhhcmRQaXR5OiA5MCxcbiAgICAgIGN1cnZlOiBFWENMVVNJVkVfQ1VSVkUsXG4gICAgICAvLyDni6zlrrbpopHmrrXvvJpTIOe6pyA1MCUg5qaC546H55u05o6l5pivIFVQIOinkuiJsu+8jOatquS4gOasoeWQjuS4i+S4gOasoeW/heWumiBVUOOAglxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwid0VuZ2luZUNoYW5uZWxcIixcbiAgICAgIG1lbWJlcnM6IFtcIjNcIl0sXG4gICAgICBoYXJkUGl0eTogODAsXG4gICAgICBjdXJ2ZTogV19FTkdJTkVfQ1VSVkUsXG4gICAgICAvLyDpn7Pmk47popHmrrXvvJo3NSUg55u05o6lIFVQ77yI5LiN5pivIDUwJe+8ie+8jOWFrOekuiBKU09OIOWOn+aWh1xuICAgICAgLy8gdXBfcHJvYiDlr7nlupTov5nkuIDmoaPvvIznlKggd2VpZ2h0ZWQg6ICM5LiN5pivIGZpZnR5RmlmdHkg6KGo6L6+6Z2e5a+556ew5q+U5L6L44CCXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJ3ZWlnaHRlZFwiLCByYXRlVXBDaGFuY2U6IDAuNzUgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJzdGFuZGFyZENoYW5uZWxcIixcbiAgICAgIG1lbWJlcnM6IFtcIjFcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogRVhDTFVTSVZFX0NVUlZFLFxuICAgICAgLy8g5bi46am76aKR5q6177ya5rKh5pyJIFVQIOinkuiJsueahOamguW/te+8jOaKveWIsCBTIOe6p+WwseaYr+aKveWIsCBTIOe6p++8jOS4jeWtmOWcqFwi5q2qXCLjgIJcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIm5vbmVcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcImJhbmdib29DaGFubmVsXCIsXG4gICAgICBtZW1iZXJzOiBbXCI1XCJdLFxuICAgICAgaGFyZFBpdHk6IDgwLFxuICAgICAgY3VydmU6IFdfRU5HSU5FX0NVUlZFLFxuICAgICAgLy8g6YKm5biD6aKR5q6177ya546p5a626aKE5YWI5oyH5a6a55uu5qCH6YKm5biD77yM6Kem5Y+RIFMg57qn5pe25a6Y5pa55YWs56S6IHVwX3Byb2Ig5pivXG4gICAgICAvLyBcIjEwMC4wMDAlXCLigJTigJTmsqHmnIlcIuatqlwi55qE5qaC5b+177yM55SoIGFsd2F5c1JhdGVVcCDogIzkuI3mmK8gd2VpZ2h0ZWQ6MVxuICAgICAgLy8g5pu05YeG56Gu5Zyw6KGo6L6+XCLov5nkuKrmsaDlrZDnu5PmnoTkuIrkuI3lrZjlnKjpnZ4gVVAg57uT5p6cXCLjgIJcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcImFsd2F5c1JhdGVVcFwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICAvLyDimqDvuI8gMTAy77yI54us5a626YeN5pig77yJ5LiOIDLvvIjni6zlrrbpopHmrrXvvInmmK/lkKblhbHkuqvkv53lupXorqHmlbDigJTigJQqKuacquehruivgSoq44CCXG4gICAgICAvLyDlrpjmlrnmpoLnjoflhaznpLrpobXnlKjnmoTmmK/lj6bkuIDlpZflhoXpg6jnvJblj7fvvIzkuI7mir3ljaHorrDlvZUgQVBJIOeahCBnYWNoYV90eXBlXG4gICAgICAvLyDlr7nkuI3kuIrvvIzml6Dms5Xnm7TmjqXmr5Tlr7nvvJvnrKzkuInmlrkgd2lraSDnp7Dni6znq4vkvYbmsqHmnInlrpjmlrnnoa7orqTjgILov5nph4zmjIlcbiAgICAgIC8vIFwi54us56uL5L+d5bqV57uEXCLlpITnkIbvvIzmmK/kv53lrojpgInmi6nogIzpnZ7lt7Lpqozor4Hnu5PorrrigJTigJToi6XlkI7nu63or4Hlrp4gMTAyIOS4jiAyXG4gICAgICAvLyDlrp7pmYXlhbHkuqvkv53lupXorqHmlbDvvIzpnIDopoHmiorov5nph4zlkIjlubbmiJDlkIzkuIDkuKogUGl0eUdyb3Vw77yI5pS5IG1lbWJlcnM6XG4gICAgICAvLyBbXCIyXCIsIFwiMTAyXCJd77yJ77yM546w5Zyo5YWI5YiG5byA5bu657uE77yM6YG/5YWN57yW6YCg5LiA5Liq5pyq57uP6aqM6K+B55qE5ZCI5bm25YWz57O744CCXG4gICAgICBrZXk6IFwiZXhjbHVzaXZlQ2hhbm5lbFJlcnVuXCIsXG4gICAgICBtZW1iZXJzOiBbXCIxMDJcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogRVhDTFVTSVZFX0NVUlZFLFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICAvLyDlkIzkuIrvvJoxMDPvvIjpn7Pmk47lm57lk43vvInkuI4gM++8iOmfs+aTjumikeaute+8ieeahOS/neW6leWFseS6q+WFs+ezu+WQjOagt+acquehruivge+8jFxuICAgICAgLy8g54us56uL5bu657uE77yM55CG55Sx5LiOIDEwMiDlrozlhajkuIDoh7TjgIJcbiAgICAgIGtleTogXCJ3RW5naW5lQ2hhbm5lbEVjaG9cIixcbiAgICAgIG1lbWJlcnM6IFtcIjEwM1wiXSxcbiAgICAgIGhhcmRQaXR5OiA4MCxcbiAgICAgIGN1cnZlOiBXX0VOR0lORV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIndlaWdodGVkXCIsIHJhdGVVcENoYW5jZTogMC43NSB9LFxuICAgIH0sXG4gIF0sXG5cbiAgLy8g4piFIOacrOaPkuS7tuacgOmHjeimgeeahOmqjOivgeeCue+8mueogOacieW6pumYtuair+aYryAyLzMvNO+8jOS4jeaYryAzLzQvNeKAlOKAlOecn+WunuWtmOaho+WFqOmHj1xuICAvLyDorrDlvZXlrp7mtYsgcmFua190eXBlIOWPquWHuueOsOi/meS4ieS4quWAvO+8jOacgOmrmOaho+aYryA077yIUyDnuqfvvInkuI3mmK8gNeOAguWuv+S4u+afpeivolxuICAvLyDkv53lupXlkb3kuK3lv4XpobvotbAgYFdIRVJFIHJhcml0eSA9IDpwaXR5X3RhcmdldGDvvIzkuI3og73mnInku7vkvZUgXCI9IDVcIiDlrZfpnaLph4/jgIJcbiAgLy8g5qGj5L2N5paH5qGIIEIvQS9T4oCU4oCU57ud5Yy66Zu25a6Y5pa55pyv6K+t77yM5LiN5pivXCIy5pifLzPmmJ8vNOaYn1wi77yI6YKj5aWX6K+05rOV5Zyo6L+Z5LiqXG4gIC8vIOa4uOaIj+mHjOagueacrOS4jeWtmOWcqO+8jOingSBSYXJpdHlTcGVjLnRpZXJMYWJlbHMg5a2X5q615paH5qGj77yJ44CCXG4gIHJhcml0eToge1xuICAgIGxhZGRlcjogW1wiMlwiLCBcIjNcIiwgXCI0XCJdLFxuICAgIHBpdHlUYXJnZXQ6IFwiNFwiLFxuICAgIHRpZXJMYWJlbHM6IHtcbiAgICAgIFwiMlwiOiB7IFwiemgtQ05cIjogXCJCXCIgfSxcbiAgICAgIFwiM1wiOiB7IFwiemgtQ05cIjogXCJBXCIgfSxcbiAgICAgIFwiNFwiOiB7IFwiemgtQ05cIjogXCJTXCIgfSxcbiAgICB9LFxuICB9LFxuXG4gIHRpbWU6IHtcbiAgICAvLyDnm7Tov57lrpjmlrkgQVBJIOW+l+WIsOeahOaYr+acjeWKoeWZqOacrOWcsOaXtumXtO+8jOS4jee7j+i/h+S7u+S9leesrOS4ieaWueW3peWFt+eahOS6jOasoVxuICAgIC8vIOacrOWcsOWMluWkhOeQhuKAlOKAlOW3sueUqCBgenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6NDYwLTQ3NGBcbiAgICAvLyDmupDnoIHmoLjlrp7vvJror6Xlt6XlhbfkvJrmioogYGl0ZW0udGltZWAg5LuOIGByZWdpb25fdGltZV96b25lYCDmjaLnrpfliLBcbiAgICAvLyBgbG9jYWxUaW1lWm9uZWDvvIjlpJrotKblj7flkIjlubblnLrmma/kuIvkuKTogIXlj6/og73kuI3lkIzvvInvvJvkvYbmnKzmj5Lku7bkuI3nu4/ov4fov5nlsYJcbiAgICAvLyDlt6XlhbflpITnkIbvvIznm7Tov54gQVBJIOaLv+WIsOeahOWwseaYr+WOn+Wni+acjeWKoeWZqOacrOWcsOaXtumXtOWtl+espuS4su+8jOS4jemAgueUqOi/meadoVxuICAgIC8vIOaNoueul+mjjumZqeOAglxuICAgIHJhd1RpbWVDb252ZW50aW9uOiBcInNlcnZlckxvY2FsXCIsXG4gICAgLy8g5beu5byC54K577ya5pe25Yy65p2l5rqQ5pivIHJlZ2lvbiDlrZfmrrUgKyDlrqLmiLfnq6/pnZnmgIHooajvvIzkuI3mmK8gYXBpRmllbGTigJTigJRcbiAgICAvLyBBUEkg5Y+q6L+U5ZueIHJlZ2lvbu+8iOWmgiBcInByb2RfZ2ZfY25cIu+8ie+8jOS4jei/lOWbnuS7u+S9leW9ouW8j+eahCBVVEMg5YGP56e76YeP77yMXG4gICAgLy8g5o2i566X6KGo55Sx5a6i5oi356uv57u05oqk44CCXG4gICAgdGltZXpvbmVTb3VyY2U6IHtcbiAgICAgIGtpbmQ6IFwic3RhdGljVGFibGVcIixcbiAgICAgIGZpZWxkOiBcInJlZ2lvblwiLFxuICAgICAgLy8g5LqU5p2h5Yy65pyN56CB5YiwIFVUQyDlgY/np7vph4/nmoTlrozmlbTmmKDlsITvvIzlj4zmnaXmupDpgJDpobnmoLjlr7nkuIDoh7TvvIzpm7bliIbmrafvvJpcbiAgICAgIC8vICAgYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjMzLTM5YO+8iHNlcnZlclRpbWVab25l77yJXG4gICAgICAvLyAgIGBIb1lvLkdhY2hhL2NyYXRlcy9nYW1lX2Jpei9zcmMvbGliLnJzOjE0NS0xNDlg77yI5Yy65pyN56CB5a2X56ym5Liy5bi46YeP77yJXG4gICAgICAvLyAgICAg5LiOIGA6MjAwLTIwNGDvvIhOQVBfQ04vTkFQX0dMT0JBTF9KUC9FVS9VUy9TRyDkupTkuKrlj5jkvZPnu5HlrprnmoTlgY/np7vph4/vvIlcbiAgICAgIC8vIOKaoO+4jyBwcm9kX2dmX2pwIOWQjeWtl+WDj+aXpeacje+8jOWunumZheaYr+S6muacjeKAlOKAlEhvWW8uR2FjaGEg5rqQ56CB5Zyo6L+Z5LiA6KGM55qEXG4gICAgICAvLyDooYzlsL7ms6jph4rnm7TkuaYgXCIvLyBBc2lhXCLvvIhsaWIucnM6MjAx77yJ77yM5LiN6KaB5oyJ5a2X6Z2i5ZCN6K+v5Yik5oiQ5pel5pys5pe25Yy644CCXG4gICAgICB0YWJsZToge1xuICAgICAgICBwcm9kX2dmX2NuOiA4LFxuICAgICAgICBwcm9kX2dmX2pwOiA4LFxuICAgICAgICBwcm9kX2dmX3VzOiAtNSxcbiAgICAgICAgcHJvZF9nZl9ldTogMSxcbiAgICAgICAgcHJvZF9nZl9zZzogOCxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyByYXdGb3JtYXQg5LiN5aOw5piO4oCU4oCU5ZON5bqUIHRpbWUg5a2X5q615piv56m65qC85YiG6ZqU55qEIFwiWVlZWS1NTS1ERCBISDptbTpzc1wiXG4gICAgLy8g77yI55yf5a6e5a2Y5qGj5a6e5rWL5LiA6Ie077yJ77yM5q2j5aW95pivIEwxIOiMg+W8j+WxgueahOe8uuecgeWAvCBzcGFjZVNlcGFyYXRlZO+8jOS4jemcgOimgVxuICAgIC8vIOaYvuW8j+imhuebluOAglxuICB9LFxuXG4gIC8vIOS4juWOn+elnuS4gOiHtOeahOiMg+W8jyBBIOmAmueUqOWfuue6v+etlueVpe+8jOmdnue7neWMuumbtuS4k+WxnuW3ruW8gueCue+8muWIhumhteWTjeW6lOiDveaLv+WIsOeahFxuICAvLyDlj6rmmK/jgIzov5nkuIDpobXmnInmsqHmnInmm7TlpJrjgI3vvIzlrpjmlrnkuZ/msqHmnInlj6blpJbnmoTmnYPlqIHogZrlkIjnu5/orqHmjqXlj6PvvIzlm6DmraTnlKhcbiAgLy8gaW5HYW1lUGFnZUNvdW5077yI6Zu25oiQ5pys44CB5YWo6KaG55uW44CB5peg6aKd5aSW5Yet5o2u6aOO6Zmp77yJ77yM5LiN5piv57ud5Yy66Zu254m55pyJ5Yaz562W44CCXG4gIGJhc2VsaW5lOiB7IGtpbmQ6IFwiaW5HYW1lUGFnZUNvdW50XCIgfSxcblxuICByZXRlbnRpb246IHtcbiAgICBkaXNwbGF5VGV4dDogeyBcInpoLUNOXCI6IFwiNiDkuKrmnIhcIiB9LFxuICAgIGNvbnNlcnZhdGl2ZURheXM6IDYgKiAyOCxcbiAgfSxcblxuICAvLyBpdGVtSWRTb3VyY2Ug5LiN5aOw5piO77yM57y655yBIFwibmF0aXZlXCLigJTigJTop4HkuIrmlrkgZXh0cmFjdFJlY29yZCDph4wgaXRlbUlkXG4gIC8vIOaXgeeahOivtOaYju+8mue7neWMuumbtiBBUEkg55u05o6l6L+U5ZueIGl0ZW1faWTvvIzkuI3mmK/ljp/npZ7pgqPnp41cIuacrOWcsOWMlueJqeWTgeWQjVwi54m55L6L44CCXG5cbiAgLy8gcHJlY29uZGl0aW9ucyAvIG1ldGFkYXRhIOWdh+S4jeWjsOaYjuKAlOKAlOWOn+elnumCo+adoVwi5ri45oiP6Iez5bCR6L+Q6KGM6L+H5LiA5qyh77yM57yT5a2YXG4gIC8vIOebruW9leaJjeS8muiiq+WIm+W7ulwi55qE5YmN572u5p2h5Lu25py65Yi25LiK5a+557ud5Yy66Zu25ZCM5qC35oiQ56uL77yI5ZCM5LiA5aWXIGNocm9taXVtQ2FjaGVcbiAgLy8g5Yet5o2u6I635Y+W5py65Yi277yJ77yM5L2G5pys5qyh5Lu75Yqh55qE6LWE5paZ6IyD5Zu077yIcmVzZWFyY2gvMDHjgIEwM+OAgTA0ICtcbiAgLy8g5LiK6Z2i5YiX5Ye655qE5rqQ56CB5byV55So77yJ5rKh5pyJ6KaG55uW57ud5Yy66Zu25LiT5bGe55qE5YmN572u5p2h5Lu25beu5byC77yM5LiN6aKd5aSW57yW6YCg77yMXG4gIC8vIOWIpOaWreS4jiBgZHJpbGxzL3p6ei9tYW5pZmVzdC50c2Ag5LiA6Ie044CCXG59IHNhdGlzZmllcyBQbHVnaW5NYW5pZmVzdDtcbiJdLCJtYXBwaW5ncyI6Ijs7O0NBa0JBLE1BQWFBLFVBQXFCO0VBQ2hDLGtCQUFrQixTQUFTLFFBQVE7R0FDakMsTUFBTSxhQUFhLElBQUksSUFBSSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUM7R0FDMUMsSUFBSSxlQUFlLEtBQUssT0FBTztHQUMvQixJQUFJLGVBQWUsS0FBSyxPQUFPO0dBQy9CLE9BQU87RUFDVDtFQUVBLGtCQUFrQixXQUFXO0dBQzNCLElBQUksQ0FBQyxPQUFPLFVBQ1YsTUFBTSxJQUFJLE1BQ1Isd0RBQXdELE9BQU8sT0FBTyxFQUN4RTtHQUlGLE9BQU8sR0FBRyxPQUFPLFNBQVMsR0FBRyxPQUFPO0VBQ3RDO0NBQ0Y7Ozs7Ozs7Ozs7Ozs7Q0NKQSxTQUFTQyxzQkFBb0IsVUFBOEI7RUFDekQsSUFBSSxPQUFPLGFBQWEsWUFBWSxhQUFhLE1BQU0sT0FBTyxDQUFDO0VBQy9ELE1BQU0sT0FBUSxTQUFnQztFQUM5QyxJQUFJLE9BQU8sU0FBUyxZQUFZLFNBQVMsTUFBTSxPQUFPLENBQUM7RUFDdkQsTUFBTSxPQUFRLEtBQTRCO0VBQzFDLE9BQU8sTUFBTSxRQUFRLElBQUksSUFBSSxPQUFPLENBQUM7Q0FDdkM7O0NBR0EsU0FBU0MsbUJBQWlCLE9BQW9DO0VBQzVELElBQUksT0FBTyxVQUFVLFVBQVUsT0FBTztFQUN0QyxNQUFNLFVBQVUsTUFBTSxLQUFLO0VBQzNCLE9BQU8sUUFBUSxT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