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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiX2dzLXBsdWdpbnMtZW50cnkuanMiLCJuYW1lcyI6WyJob29rcyIsImV4dHJhY3RHYWNoYUxvZ0xpc3QiLCJ0b05vbkVtcHR5U3RyaW5nIiwidG9Db3VudCIsIm1hbmlmZXN0IiwiaG9va3MiLCJleHRyYWN0R2FjaGFMb2dMaXN0IiwidG9Ob25FbXB0eVN0cmluZyIsInRvQ291bnQiLCJtYW5pZmVzdCIsImhvb2tzIiwidG9Ob25FbXB0eVN0cmluZyIsInRvQ291bnQiLCJtYW5pZmVzdCJdLCJzb3VyY2VzIjpbIi4uL3BsdWdpbnMvZ2Vuc2hpbi9ob29rcy50cyIsIi4uL3BsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50cyIsIi4uL3BsdWdpbnMvc3RhcnJhaWwvaG9va3MudHMiLCIuLi9wbHVnaW5zL3N0YXJyYWlsL21hbmlmZXN0LnRzIiwiLi4vcGx1Z2lucy93dXdhL2hvb2tzLnRzIiwiLi4vcGx1Z2lucy93dXdhL21hbmlmZXN0LnRzIiwiLi4vcGx1Z2lucy96enovaG9va3MudHMiLCIuLi9wbHVnaW5zL3p6ei9tYW5pZmVzdC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIOWOn+elnuaPkuS7tueahOmAg+eUn+iIsSBob29rc+OAglxuICpcbiAqIOS4pOS4qiBob29rIOWdh+S4jeWPr+ecgeeVpe+8mlxuICpcbiAqIC0gYHJlc29sdmVUaW1lem9uZWDvvJrnsbPlk4jmuLggYGdldEdhY2hhTG9nYCDlk43lupTkuI3luKbku7vkvZXml7bljLrlrZfmrrXvvIjml6Lml6AgYHJlZ2lvbmBcbiAqICAg5Lmf5pegIGByZWdpb25fdGltZV96b25lYO+8ie+8jOWPquiDveaMiSBVSUQg6aaW5L2N5pWw5a2X5o6o5pat5pyN5Yqh5Zmo5omA5Zyo5pe25Yy644CCXG4gKiAgIOWPguiAg+WunueOsOW3sueUqOS4ieaWueW3peWFt+a6kOeggeaguOWunu+8mmB1aWRbMF09PT0nNifihpItNSwgJzcn4oaSMSwgZWxzZSA4YFxuICogICDvvIhkb2NzL19pbnRlcm5hbC9yZXNlYXJjaC8wNC3lkIzml4/lt6XlhbfkuInmlrnmupDnoIHlr7nmr5QubWQgwqc0LjTvvInjgIJcbiAqIC0gYGRlcml2ZVJlY29yZEtleWDvvJrmnI3liqHnq6/pm6roirEgSUQg5LiN5ZCr5Y2h5rGg57u05bqm44CC5Y+C6ICD5a6e546wIEhvWW8uR2FjaGEg5LiK57q/5pe2XG4gKiAgIOS4u+mUruaYryBgKGJ1c2luZXNzLCB1aWQsIGlkKWDvvIzkuIDlubTlkI7kuLrmmJ/pk4HogZTliqjmsaAgYGdldExkR2FjaGFMb2dgIOihpeS6huS4gOasoVxuICogICDmlbTooajph43lu7rov4Hnp7vvvIzmlLnmiJAgYChidXNpbmVzcywgdWlkLCBpZCwgZ2FjaGFfdHlwZSlg4oCU4oCUU1FMaXRlIOaUueS4jeS6huS4u+mUru+8jFxuICogICDov5nkuKrku6Pku7fkuI3or6XnlZnliLDku6XlkI7miY3ooaXjgILnsbPlk4jmuLjkuInmuLjkuIDlvovmjInlkIzkuIDop4TliJnlrp7njrDmnKwgaG9va++8jOWNs+S9v+WOn+elnlxuICogICDnm67liY3lj6rmnInljZXkuIDnq6/ngrnjgIHlsJrmnKrop4LmtYvliLDot6jnq6/ngrnpm6roirEgSUQg56Kw5pKe77yM5Lmf5LiN5L6L5aSWXG4gKiAgIO+8iHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvbWFuaWZlc3QudHMg55qEIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlgIOaWh+aho++8ieOAglxuICovXG5pbXBvcnQgdHlwZSB7IFBsdWdpbkhvb2tzIH0gZnJvbSBcImdzLXBsdWdpbi1raXRcIjtcblxuZXhwb3J0IGNvbnN0IGhvb2tzOiBQbHVnaW5Ib29rcyA9IHtcbiAgcmVzb2x2ZVRpbWV6b25lOiAoX3JlY29yZCwgY3R4KSA9PiB7XG4gICAgY29uc3QgZmlyc3REaWdpdCA9IGN0eC51aWQudHJpbSgpLmNoYXJBdCgwKTtcbiAgICBpZiAoZmlyc3REaWdpdCA9PT0gXCI2XCIpIHJldHVybiAtNTsgLy8g576O5pyNXG4gICAgaWYgKGZpcnN0RGlnaXQgPT09IFwiN1wiKSByZXR1cm4gMTsgLy8g5qyn5pyNXG4gICAgcmV0dXJuIDg7IC8vIOWbveacjSAvIOS6muacjeetieWFtuS9meWMuuacje+8jOWQq+acquefpeWMuuacjeeahOS/neWuiOm7mOiupOWAvFxuICB9LFxuXG4gIGRlcml2ZVJlY29yZEtleTogKHJlY29yZCkgPT4ge1xuICAgIGlmICghcmVjb3JkLnN0YWJsZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGDljp/npZ7orrDlvZXnvLrlsJEgc3RhYmxlSWTvvIjmnI3liqHnq6/pm6roirEgSUTvvInvvIzml6Dms5XnlJ/miJDnqLPlrprnmoQgcmVjb3JkX2tlee+8mml0ZW1JZD1cIiR7cmVjb3JkLml0ZW1JZH1cImAsXG4gICAgICApO1xuICAgIH1cbiAgICAvLyDljp/lp4sgZ2FjaGFfdHlwZe+8iOWPr+iDveaYryBcIjQwMFwiIOi/meexu+S4jeWPr+WNleeLrOafpeivoueahOWQiOW5tuWtkOexu+Wei++8iSsg5pyN5Yqh56uv6Zuq6IqxIElE77yMXG4gICAgLy8g5oqK5Y2h5rGg57u05bqm5bm26L+b5Y6777yM6YG/5YWN6Leo56uv54K55Zy65pmv5LiL6KO46Zuq6IqxIElEIOaSnumUruWQjuiiqyBJTlNFUlQgT1IgSUdOT1JFIOmdmem7mOS4ouW8g+OAglxuICAgIHJldHVybiBgJHtyZWNvcmQuYmFubmVySWR9OiR7cmVjb3JkLnN0YWJsZUlkfWA7XG4gIH0sXG59O1xuIiwiLyoqXG4gKiDljp/npZ7mj5Lku7YgbWFuaWZlc3TjgIJcbiAqXG4gKiDph4fpm4bojIPlvI/vvJphdXRoa2V577yIYGdzLXAtYXV0aGtleWDvvInvvIzlh63mja7mnaXmupDmmK/muLjmiI/lhoXnva4gQ2hyb21pdW0g57uE5Lu255qEXG4gKiDno4Hnm5jnvJPlrZjigJTigJTnjqnlrrbmiZPlvIDnpYjmhL/orrDlvZXpobXml7bvvIzlrqLmiLfnq6/kvJrku6Ugd2VidmlldyDliqDovb3orrDlvZXpobXpnaLvvIzlhbbkuK3kuIDmrKFcbiAqIOivt+axguS8muWRveS4reWumOaWuSBgZ2V0R2FjaGFMb2dgIOaOpeWPo+W5tuW4puS4iiBgYXV0aGtleWDvvIzov5nkuKror7fmsYIgVVJMIOS8muiiq+WGmeWFpVxuICogYHdlYkNhY2hlc2Ag55uu5b2V5LiL5p+Q5Liq54mI5pys5Y+35a2Q55uu5b2V5YaF55qEIGBDYWNoZS9DYWNoZV9EYXRhL2RhdGFfMmAg57yT5a2Y57Si5byV5paH5Lu2XG4gKiDvvIjms6jmhI/vvJpKU0RvYyDms6jph4rph4zkuI3og73lh7rnjrDlrZfpnaLph48gXCLmmJ/lj7cr5pac5p2gXCLvvIzmlYXmraTlpITkuI3lhpnpgJrphY3nrKblvaLlvI/nmoTot6/lvoTvvInjgIJcbiAqXG4gKiDlrZfmrrXlvaLnirbkuI7nnJ/lrp7ooYzkuLrlt7Llr7nnhafku6XkuIvotYTmlpnmoKHlh4bvvIzpgb/lhY3ph43ouYggYENMQVVERS5sb2NhbC5tZGAg6K6w5b2V6L+H55qEXG4gKiDjgIzmnKrmoKHlh4blsLHlhpnlrp7njrDjgI3nmoTplJnor6/vvIjpuKPmva7lh63mja7ot6/lvoTkuInlpITmjqjnv7vnmoTmlZnorq3vvInvvJpcbiAqIC0gZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDMt55yf5a6e5a+85Ye65pWw5o2u5qC85byP5a6e5rWLLm1kIMKn5LiA44CBwqfkuoxcbiAqIC0gZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDQt5ZCM5peP5bel5YW35LiJ5pa55rqQ56CB5a+55q+ULm1kIMKnNC4x772ewqc0LjlcbiAqIC0gZG9jcy9leGFtcGxlLXByb2plY3RzL2dlbnNoaW4td2lzaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qc++8iOWIhumhtS/lkIjlubYv6ZmQ6YCf5a6e546w77yJXG4gKiAtIGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9Ib1lvLkdhY2hhL2NyYXRlcy91cmxfc2NyYXBlci9zcmMvdHlwZXMucnPvvIhgR2FjaGFMb2dgIOWtl+auteWumuS5ie+8jFxuICogICDnoa7orqTljp/npZ4gQVBJIOWTjeW6lOmHjOayoeaciSBgaXRlbV9pZGAg5a2X5q614oCU4oCU5LiO5pif6ZOBL+e7neWMuumbtuS4jeWQjO+8iVxuICogLSBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvdXJsX2ZpbmRlci9zcmMvbGliLnJz77yIYFJFR0VYX0dBQ0hBX1VSTGDvvIxcbiAqICAg56Gu6K6k57yT5a2Y6YeM5ZG95Lit55qE5pivIGAuLi4vZ2FjaGFfaW5mby9hcGkvZ2V0R2FjaGFMb2c/Li4uYXV0aGtleT0uLi5gIOi/meadoeecn+Wunuivt+axgiBVUkzvvIlcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqXG4gKiDku44gYGdldEdhY2hhTG9nYCDlk43lupTkvZPph4zlj5blh7rmnKzpobXorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDnnJ/lrp7lk43lupTlvaLmgIHmmK8gYHsgcmV0Y29kZSwgbWVzc2FnZSwgZGF0YTogeyBsaXN0OiBbLi4uXSwgcmVnaW9uIH0gfWBcbiAqIO+8iEhvWW8uR2FjaGEgYE1paG95b1Jlc3BvbnNlPEdhY2hhTG9ncz5gIC8gZ2Vuc2hpbi13aXNoLWV4cG9ydFxuICogYGdldEdhY2hhTG9nYCDph4znmoQgYHJlcy5kYXRhLmxpc3Rg77yJ44CC6Ziy5b6h5byP6Kej5p6Q77ya5Lu75L2V5LiA5bGC5b2i54q25LiN5a+55bCx6L+U5ZueXG4gKiDnqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjigJTigJTliIbpobXlvJXmk47kvJrmiornqbrmlbDnu4TlvZPkvZwgYGVtcHR5UGFnZWAg57uI5q2i5p2h5Lu25aSE55CG77yMXG4gKiDov5nmr5TorqnkuIDmrKHlgbblj5HnmoTnlbjlvaLlk43lupTkuK3mlq3mlbTmnaHph4fpm4bmtYHnqIvmm7TlronlhajjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhTG9nTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBkYXRhID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xufVxuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKiDlrpjmlrnlk43lupTph4znmoQgYGNvdW50YCDmmK/mlbDlrZflrZfnrKbkuLLvvIjlpoIgYFwiMVwiYO+8ie+8jOmYsuW+oeW8j+i9rOaNou+8jOW8guW4uOi+k+WFpeWFnOW6leS4uiAx44CCICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuZXhwb3J0IGNvbnN0IG1hbmlmZXN0ID0ge1xuICBpZDogXCJnZW5zaGluXCIsXG4gIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLljp/npZ5cIiB9LFxuICBzZGtWZXJzaW9uOiBcIjEuMC4wXCIsXG4gIHBsYXRmb3JtczogW1wid2luZG93c1wiXSxcbiAgbWFpbnRhaW5lcnM6IFtcImdhY2hhLXN0dWRpb1wiXSxcbiAgZXhjaGFuZ2VGb3JtYXRzOiBbXCJ1aWdmLXY0XCJdLFxuXG4gIGNvbGxlY3Q6IHtcbiAgICBwYXJhZGlnbTogXCJjcmVkZW50aWFsZWRBcGlcIixcbiAgICBwYXJhbXM6IHtcbiAgICAgIGNyZWRlbnRpYWw6IHtcbiAgICAgICAga2luZDogXCJjaHJvbWl1bUNhY2hlXCIsXG4gICAgICAgIC8vIOKaoO+4jyDnm7jlr7nniYfmrrXvvIzkuI3mmK/nu53lr7not6/lvoTigJTigJTnu53lr7nlronoo4Xnm67lvZXmnaXoh6rnlKjmiLfphY3nva7vvIznlLEgUnVzdCDkvqfmi7zmjqXjgIJcbiAgICAgICAgZ2FtZURpcjogXCJZdWFuU2hlbl9EYXRhL3dlYkNhY2hlc1wiLFxuICAgICAgICB1cmxQYXR0ZXJuOiAvaHR0cHM6XFwvXFwvLis/Z2V0R2FjaGFMb2dbXlwiXSsvLFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgdXJsOiBcInt7Y3JlZGVudGlhbH19JnBhZ2U9e3twYWdlfX0mZ2FjaGFfdHlwZT17e2dhY2hhVHlwZX19JnNpemU9e3twYWdlU2l6ZX19JmVuZF9pZD0wXCIsXG4gICAgICB9LFxuICAgICAgLy8g5Zu95pyNICsg5Zu96ZmF5pyN5Lik5LiqIGhvc3Qg6YO96KaB5pS25b2V77yadXJsUGF0dGVybu+8iOS4iuaWue+8ieacrOi6q+S4jeWMuuWIhuWfn+WQje+8jFxuICAgICAgLy8g5Y+q6KaBIFVSTCDph4zlh7rnjrAgXCJnZXRHYWNoYUxvZ1wiIOWwseS8muWMuemFjeKAlOKAlOS5n+WwseaYr+ivtO+8jOWQjOS4gOS7veaPkuS7tuaXouS8mlxuICAgICAgLy8g5LuO5Zu95pyN5a6i5oi356uv5Lmf5Lya5LuO5Zu96ZmF5pyN5a6i5oi356uv55qE57yT5a2Y6YeM5omr5Ye65Yet5o2uIFVSTO+8jOiLpeWPquWjsOaYjuWbveacjVxuICAgICAgLy8gaG9zdO+8jOWbvemZheacjeeOqeWutueahOato+W4uOivt+axguS8muiiq+i/memHjOaWsOWKoOeahOeZveWQjeWNleivr+WIpOS4uuaKleavkuiAjOaLkue7neOAglxuICAgICAgLy8g5Lik5Liq5Z+f5ZCN5bey55SoIEhvWW8uR2FjaGEg5rqQ56CB5qC45a6e77yI6Z2e5pys5o+S5Lu254us56uL5a6e5rWL77yM5LuF5L2c5LqL5a6e5byV55So77yJ77yaXG4gICAgICAvLyBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvZ2FtZV9iaXovc3JjL2FwaS5yczozNS0zNlxuICAgICAgLy8gICAoKEhrNGUsIE9mZmljaWFsKSwgU3RhbmRhcmQpIC0+IFwiaHR0cHM6Ly9wdWJsaWMtb3BlcmF0aW9uLWhrNGUubWlob3lvLmNvbS8uLi5cIlxuICAgICAgLy8gICAoKEhrNGUsIE92ZXJzZWEpLCAgU3RhbmRhcmQpIC0+IFwiaHR0cHM6Ly9wdWJsaWMtb3BlcmF0aW9uLWhrNGUtc2cuaG95b3ZlcnNlLmNvbS8uLi5cIlxuICAgICAgLy8g5LiOIGZpeHR1cmVzL2dlbnNoaW4vY3JlZGVudGlhbC9kYXRhXzIuc2FtcGxlIOmHjOeahOekuuS+iyBVUkzvvIjlm73mnI3vvIxcbiAgICAgIC8vIHB1YmxpYy1vcGVyYXRpb24taGs0ZS5taWhveW8uY29t77yJ5LqS55u45Y2w6K+B77yMZGF0YV8yLnNhbXBsZSDmnKzouqvlj6pcbiAgICAgIC8vIOimhuebluS6huWbveacjei/meS4gOenje+8jOWbvemZheacjSBob3N0IOihpeWFheiHquS4iumdoui/meS7vea6kOeggeW8leeUqOOAglxuICAgICAgYWxsb3dlZEhvc3RzOiBbXCJwdWJsaWMtb3BlcmF0aW9uLWhrNGUubWlob3lvLmNvbVwiLCBcInB1YmxpYy1vcGVyYXRpb24taGs0ZS1zZy5ob3lvdmVyc2UuY29tXCJdLFxuICAgICAgZXh0cmFjdExpc3Q6IGV4dHJhY3RHYWNoYUxvZ0xpc3QsXG4gICAgfSxcbiAgfSxcblxuICBmaWVsZHM6IHtcbiAgICBleHRyYWN0UmVjb3JkOiAocmF3KSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCByYXcgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi5Y6f56WeIGV4dHJhY3RSZWNvcmQg5pS25Yiw6Z2e5a+56LGh5b2i5oCB55qE5Y6f5aeL6K6w5b2VXCIpO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVjb3JkID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4gICAgICBjb25zdCBuYW1lID0gdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQubmFtZSk7XG4gICAgICBjb25zdCBzdGFibGVJZCA9IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmlkKTtcbiAgICAgIC8vIOKaoO+4jyDljp/npZ4gQVBJIOS4jei/lOWbniBpdGVtX2lk4oCU4oCU5bey55So5rqQ56CB5qC45a6e77yaSG9Zby5HYWNoYSDnmoRcbiAgICAgIC8vIGBjcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjE1MGAg5pivIGBpdGVtX2lkOiBPcHRpb248dTMyPmDvvIxcbiAgICAgIC8vIOS4lCBgaGFzX2l0ZW1faWQoKWAg55qEIGRvYyBjb21tZW50IOebtOS5piBcIkV4Y2VwdCBmb3IgJ0dlbnNoaW4gSW1wYWN0J1wi44CCXG4gICAgICAvL1xuICAgICAgLy8g5Zug5q2k6L+Z6YeM55qEIGl0ZW1JZCDmmK8qKuS4tOaXtuWAvO+8muacrOWcsOWMlueJqeWTgeWQjSoq77yM5LiN5piv55yf5q2j55qE54mp5ZOB5qCH6K+G44CCXG4gICAgICAvLyDlkI7mnpzlv4Xpobvor7TmuIXmpZrvvIzlkKbliJnkuIvkuIDkuKror7vov5nmrrXku6PnoIHnmoTkurrkvJrku6XkuLrlroPlt7Lnu4/lr7nkuobvvJpcbiAgICAgIC8vICAg4pGgIGl0ZW1fY2F0YWxvZyDkuLvplK7mmK8gKHBsdWdpbl9pZCwgaXRlbV9pZCwgbGFuZynjgIJpdGVtSWQg6Iul5piv5pys5Zyw5YyW5ZCN77yMXG4gICAgICAvLyAgICAgIOWQjOS4gOS4quinkuiJsuWcqCB6aC1jbiDkuI4gZW4tdXMg5LiL5Lya5Lqn5Ye65Lik5Liq5LiN5ZCM55qEIGl0ZW1faWTvvIzot6jor63oqIDogZrlkIjlpLHmlYjvvJtcbiAgICAgIC8vICAg4pGhIGBnYWNoYV9yZWNvcmQubGFuZ2Ag6L+Z5LiA5YiX55qE6K6+6K6h5oSP5Zu+77yIcmVzZWFyY2gvMDUgwqcyLjLvvInmraPmmK9cbiAgICAgIC8vICAgICAg44CMbmFtZeKGkml0ZW1faWQg5Y+N5p+l5L6d6LWWIGxvY2FsZe+8jOWtl+WFuOabtOaWsOWQjuimgeiDvemHjeaUvuagoeato+OAjeKAlOKAlFxuICAgICAgLy8gICAgICDogIzlj43mn6Xov5nkuIDmraXnjrDlnKjmoLnmnKzmsqHlj5HnlJ/vvJtcbiAgICAgIC8vICAg4pGiIOabtOimgeWRveeahOaYryBuYW1lIOS4jiByYXJpdHkg6YO95pyJ5YC877yM5b2S5LiA5YyW5bGC5oyJ546w5pyJ6KeE5YiZ5Lya5oqK6L+Z57G76K6w5b2V5qCH5oiQXG4gICAgICAvLyAgICAgIG1ldGFfc3RhdGU9J2NvbXBsZXRlJ++8jOS6juaYryBpZHhfcmVjb3JkX21ldGFfcGVuZGluZyDpgqPmnaHpg6jliIbntKLlvJVcbiAgICAgIC8vICAgICAg5rC46L+c5omr5LiN5Yiw5a6D5Lus4oCU4oCUKirplJnnmoTmlbDmja7ooqvmoIforrDkuLrlrozmlbTvvIzmsqHmnInku7vkvZXmnLrliLbkvJrmnaXnuqDmraMqKuOAglxuICAgICAgLy9cbiAgICAgIC8vIOS4jeWcqOacrCBTdGFnZSDnvJbpgKAgbWV0YWRhdGEucGFyc2VSZXNwb25zZe+8iFVJR0Yg5a2X5YW4IEFQSSDnmoTlk43lupTlvaLnirblsJrmnKpcbiAgICAgIC8vIOeUqOecn+WunuWunueOsOagoeWHhu+8jOehrOe6puadn+emgeatouacquagoeWHhuWwseWGmeWunueOsO+8ieOAguS9hui/meS4que8uuWPo+S4jeiDveWBnOWcqOazqOmHiumHjO+8mlxuICAgICAgLy8g5bey5YiX5Li6IE0xLVMzIOW9kuS4gOWMluWxguS4jiBNMS1TNSDlhYPmlbDmja7mtojotLnnmoTpmLvloZ7pobnvvIzop4FcbiAgICAgIC8vIGBtaWxlc3RvbmVzLzAyLU0xLeWOn+elnuaPkuS7tuWFqOmTvui3ry5tZGAgUzPjgIFTNSDnmoQgY2hlY2tsaXN044CCXG4gICAgICBjb25zdCBpdGVtSWQgPSBuYW1lID8/IHN0YWJsZUlkO1xuICAgICAgaWYgKCFpdGVtSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi5Y6f56WeIGV4dHJhY3RSZWNvcmTvvJrorrDlvZXml6Lml6AgbmFtZSDkuZ/ml6AgaWTvvIzml6Dms5Xnoa7lrpogaXRlbUlkXCIpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBpdGVtSWQsXG4gICAgICAgIHRpbWU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLnRpbWUpID8/IFwiXCIsXG4gICAgICAgIC8vIOS/neeVmeavj+adoeiusOW9leiHquW3seeahOWOn+WniyBnYWNoYV90eXBl77yI6ICM5LiN5piv5pys5qyh5p+l6K+i55So55qE5rGg5a2QIGlk77yJ4oCU4oCUXG4gICAgICAgIC8vIDMwMSDliIbnu4Tph4zmt7fmnIkgZ2FjaGFfdHlwZTogXCI0MDBcIiDnmoTorrDlvZXmmK/ljp/npZ7nmoTnnJ/lrp7ooYzkuLpcbiAgICAgICAgLy8g77yIcmVzZWFyY2gvMDMgwqcyLjLvvIw2MTcwIOadoee7hOWGhea3t+acieS4pOenjeWPluWAvO+8ie+8jOW/hemhu+WOn+agt+S/neeVmeaJjeiDveiuqVxuICAgICAgICAvLyBwaXR5R3JvdXBzIOeahCAzMDEvNDAwIOWQiOW5tueUn+aViO+8jOS5n+aYr+eVmeW6leOAgeWPr+mHjeaUvueahOWJjeaPkOOAglxuICAgICAgICBiYW5uZXJJZDogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuZ2FjaGFfdHlwZSkgPz8gXCJcIixcbiAgICAgICAgY291bnQ6IHRvQ291bnQocmVjb3JkLmNvdW50KSxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgaXRlbVR5cGU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLml0ZW1fdHlwZSksXG4gICAgICAgIHJhcml0eTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQucmFua190eXBlKSxcbiAgICAgICAgc3RhYmxlSWQsXG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG5cbiAgYmFubmVyczogW1xuICAgIHsgaWQ6IFwiMzAxXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLop5LoibLmtLvliqjnpYjmhL9cIiB9IH0sXG4gICAgeyBpZDogXCIzMDJcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuatpuWZqOa0u+WKqOeliOaEv1wiIH0gfSxcbiAgICB7IGlkOiBcIjIwMFwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5bi46am756WI5oS/XCIgfSB9LFxuICAgIHsgaWQ6IFwiNTAwXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLpm4blvZXnpYjmhL9cIiB9IH0sXG4gICAgeyBpZDogXCIxMDBcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuaWsOaJi+eliOaEv1wiIH0gfSxcbiAgICAvLyA0MDAg5LiN5piv5LiA5Liq5Y+v5Y2V54us5p+l6K+i55qE5rGg5a2Q77yI5LiN5Lya5LulIDQwMCDkvZzkuLrljaHmsaDlj5blgLzlj5Hotbfor7fmsYLvvInvvIxcbiAgICAvLyDkvYblroPmmK8gMzAxIOWTjeW6lOmHjOecn+WunuWHuueOsOeahCBnYWNoYV90eXBlIOWPluWAvO+8jOW/hemhu+WjsOaYjuS4uueLrOeriyBCYW5uZXJTcGVj77yMXG4gICAgLy8gcGl0eUdyb3Vwc1tdLm1lbWJlcnMg5omN6IO95ZCI5rOV5byV55So5a6D4oCU4oCU5ZCm5YiZIGJhbm5lcklkPVwiNDAwXCIg55qE6K6w5b2V5Lya5oyH5ZCRXG4gICAgLy8g5LiA5Liq5LiN5a2Y5Zyo55qEIEJhbm5lclNwZWPvvIzop4HmnKzmlofku7bmnKvlsL7jgIzlgY/lt67kuI7lj5HnjrDjgI3or7TmmI7jgIJcbiAgICB7IGlkOiBcIjQwMFwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6KeS6Imy5rS75Yqo56WI5oS/77yINDAwIOWtkOexu+Wei++8jOmajyAzMDEg5LiA5bm26L+U5Zue77yJXCIgfSB9LFxuICBdLFxuXG4gIHBpdHlHcm91cHM6IFtcbiAgICB7XG4gICAgICBrZXk6IFwiY2hhcmFjdGVyRXZlbnRXaXNoXCIsXG4gICAgICBtZW1iZXJzOiBbXCIzMDFcIiwgXCI0MDBcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICAvLyBiYXNlL3N0YXJ0IOWPluiHquWFrOW8gOeahOeliOaEv+amgueOh+ivtOaYju+8mzc0IOaKvei1t+e6v+aAp+aPkOWNh+OAgTg2IOaKveWkluWfuuacrOWwgemhtu+8jFxuICAgICAgLy8gOTAg5oq95b+F5Ye64oCU4oCUc3RlcCDph4fnlKjlkIzkurrnpL7ljLrlub/ms5vlvJXnlKjnmoTjgIw3NCDmir3otbfmr4/mir0gKzYl44CN5Y+j5b6E44CCXG4gICAgICBjdXJ2ZTogeyBraW5kOiBcInNvZnRQaXR5XCIsIGJhc2U6IDAuMDA2LCBzdGFydDogNzQsIHN0ZXA6IDAuMDYgfSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICAgIH0sXG4gIF0sXG5cbiAgcmFyaXR5OiB7IGxhZGRlcjogW1wiM1wiLCBcIjRcIiwgXCI1XCJdLCBwaXR5VGFyZ2V0OiBcIjVcIiB9LFxuXG4gIHRpbWU6IHsgdGltZXpvbmVTb3VyY2U6IHsga2luZDogXCJjb21wdXRlZFwiIH0gfSxcblxuICBwcmVjb25kaXRpb25zOiBbXG4gICAge1xuICAgICAgaWQ6IFwiZ2Vuc2hpbi5jcmVkZW50aWFsLmNhY2hlRGlyRXhpc3RzXCIsXG4gICAgICBjYXBhYmlsaXR5OiBcImNyZWRlbnRpYWxcIixcbiAgICAgIGxldmVsOiBcInJlcXVpcmVkXCIsXG4gICAgICBkZXNjcmliZToge1xuICAgICAgICBcInpoLUNOXCI6IFwi6Ieq5Yqo6I635Y+W5oq95Y2h6ZO+5o6l6KaB5rGC5ri45oiP5a6i5oi356uv6Iez5bCR6L+Q6KGM6L+H5LiA5qyh77yM57yT5a2Y55uu5b2V5omN5Lya6KKr5Yib5bu6XCIsXG4gICAgICB9LFxuICAgICAgLy8gSG9zdEVudiDnm67liY3lj6rmnIkgZ2FtZUNsaWVudFNpemUgLyBpbnN0YWxsZWREZXBlbmRlbmNpZXMg5Lik5Liq5a2X5q6177yM5pyq5pC65bimXG4gICAgICAvLyDjgIxjcmVkZW50aWFsLmdhbWVEaXIg5aOw5piO55qE57yT5a2Y55uu5b2V5piv5ZCm5bey6KKr6KeC5rWL5Yiw44CN6L+Z5LiA5LqL5a6e4oCU4oCU6L+Z5q2j5pivXG4gICAgICAvLyBmaXh0dXJlIOWlkee6pua1i+ivlemYtuauteWwseiDveWPkeeOsOeahOWlkee6pue8uuWPo++8jOS4jeaYr+i/kOihjOaXtuaJjeaatOmcsuOAguingeaWh+S7tuacq+WwvlxuICAgICAgLy8g44CM5YGP5beu5LiO5Y+R546w44CN77yM55WZ57uZIGdzLWhvc3Qg5omp5bGVIEhvc3RFbnYg5pe26KGl5LiK44CCXG4gICAgICBjaGVjazogKCkgPT4gKHsga2luZDogXCJ1bmtub3duXCIgfSksXG4gICAgICByZW1lZHk6IHsgXCJ6aC1DTlwiOiBcIuivt+WFiOWQr+WKqOa4uOaIj+W5tuaJk+W8gOS4gOasoeaKveWNoeiusOW9lemhte+8jOWGjeWbnuWIsOacrOW6lOeUqOmHjeivlVwiIH0sXG4gICAgfSxcbiAgXSxcblxuICBiYXNlbGluZTogeyBraW5kOiBcImluR2FtZVBhZ2VDb3VudFwiIH0sXG5cbiAgcmV0ZW50aW9uOiB7XG4gICAgZGlzcGxheVRleHQ6IHsgXCJ6aC1DTlwiOiBcIjYg5Liq5pyIXCIgfSxcbiAgICBjb25zZXJ2YXRpdmVEYXlzOiA2ICogMjgsXG4gIH0sXG5cbiAgLy8g4pqg77iPIOWOn+elniBBUEkg5LiN6L+U5ZueIGl0ZW1faWTvvIxleHRyYWN0UmVjb3JkIOeahCBpdGVtSWQg5piv5pys5Zyw5YyW54mp5ZOB5ZCNXG4gIC8vIO+8iOingeS4iuaWuSBleHRyYWN0UmVjb3JkIOWGheeahOivpue7huivtOaYjuS4jiBNMS1TMyDpmLvloZ7pobnlvJXnlKjvvInjgILlo7DmmI7ov5nkuKrkv6Hlj7dcbiAgLy8g5ZCO77yM5a6/5Li755qE5b2S5LiA5YyW5bGC5Lya5oqK6L+Z57G76K6w5b2V5qCH5oiQIG1ldGFfc3RhdGU9J3BlbmRpbmcn77yM6ICM5LiN5piv5Zug5Li6XG4gIC8vIG5hbWUvcmFyaXR5IOmDveacieWAvOWwseivr+WIpOaIkCBjb21wbGV0ZeKAlOKAlOmUmeeahCBpdGVtX2lkIOS4jeivpeiiq+agh+iusOS4uuWujOaVtOOAglxuICBpdGVtSWRTb3VyY2U6IFwiZGlzcGxheU5hbWVcIixcblxuICAvLyBtZXRhZGF0YSDlrZfmrrXmnKwgU3RhZ2Ug5Yi75oSP5LiN5aOw5piO77yM55CG55Sx6KeB5paH5Lu25pyr5bC+44CM5YGP5beu5LiO5Y+R546w44CN44CCXG59IHNhdGlzZmllcyBQbHVnaW5NYW5pZmVzdDtcbiIsIi8qKlxuICog5pif6ZOB5o+S5Lu255qE6YCD55Sf6IixIGhvb2tz44CCXG4gKlxuICog5Y+q6ZyA6KaBIGBkZXJpdmVSZWNvcmRLZXlgIOS4gOS4qiBob29r77yaXG4gKiAtIGByZXNvbHZlVGltZXpvbmVgIOS4jemcgOimgeKAlOKAlGBtYW5pZmVzdC50c2Ag55qEIGB0aW1lLnRpbWV6b25lU291cmNlLmtpbmRgIOaYr1xuICogICBgXCJhcGlGaWVsZFwiYO+8jOS4jeaYryBgXCJjb21wdXRlZFwiYO+8jOWuv+S4u+ebtOaOpeS7juWTjeW6lOS9k+mhtee6p+Wtl+autVxuICogICBgcmVnaW9uX3RpbWVfem9uZWAg6K+75Y+W5YGP56e76YeP77yM5LiN57uP6L+H5pys5o+S5Lu255qE5Lu75L2V5Ye95pWw77yI6KeBIGBtYW5pZmVzdC50c2BcbiAqICAgYHRpbWVgIOWtl+auteaXgeeahOazqOmHiu+8ieOAglxuICogLSBgZGVyaXZlUmVjb3JkS2V5YCDlv4Xpobvlrp7njrDvvIzkuI3og73nnIHnlaXvvJrmmJ/pk4HogZTliqjmsaDvvIgyMS8yMu+8iei1sOeLrOeri+err+eCuVxuICogICBgZ2V0TGRHYWNoYUxvZ2DvvIzmnI3liqHnq6/pm6roirEgSUQg55qE5ZG95ZCN56m66Ze05Zyo6Leo56uv54K55Zy65pmv5LiL5LiN5L+d6K+B6ZqU56a74oCU4oCUXG4gKiAgIOijuOeUqCBgc3RhYmxlSWRgIOS8muaSnumUru+8jOWGmeWFpeWxgiBgSU5TRVJUIE9SIElHTk9SRWAg5Lya5oqK5pKe6ZSu6K6w5b2VKirpnZnpu5hcbiAqICAg5Lii5byDKirvvIznlKjmiLflj6rkvJrlj5HnjrDjgIzlsJHkuobkuIDmnaHjgI3vvIzkuJTml6Dms5XlrprkvY3mmK/lk6rkuIDmnaHjgILlgZrms5XkuI5cbiAqICAgYHBsdWdpbnMvZ2Vuc2hpbi9ob29rcy50c2Ag5a6M5YWo5LiA6Ie077yI5ZCM5qC35piv57Gz5ZOI5ri45pyN5Yqh56uv6Zuq6IqxIElEIOWcuuaZr++8jFxuICogICBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag55qEIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlgXG4gKiAgIOaWh+aho+aYjuehrueCueWQjVwi57Gz5ZOI5ri45LiJ5ri45LiN5b6X57y655yB5pysIGhvb2tcIu+8ie+8mmBgIGAke2Jhbm5lcklkfToke3N0YWJsZUlkfWAgYGDvvIxcbiAqICAg5oqK5Y2h5rGg57u05bqm5bm26L+b5aSN5ZCI6ZSu77yM5Y+C6ICD5a6e546wIEhvWW8uR2FjaGEg5LiK57q/5LiA5bm05ZCO5Li65pif6ZOB6IGU5Yqo5rGg55qE6L+Z5LiqXG4gKiAgIOmXrumimOS7mOWHuui/h+S4gOasoeaVtOihqOmHjeW7uui/geenu++8jOacrOaPkuS7tuS7juesrOS4gOWkqeWwseaMieWkjeWQiOmUruWunueOsO+8jOS4jeeVmeWQjOagt+eahOWdkeOAglxuICovXG5pbXBvcnQgdHlwZSB7IFBsdWdpbkhvb2tzIH0gZnJvbSBcImdzLXBsdWdpbi1raXRcIjtcblxuZXhwb3J0IGNvbnN0IGhvb2tzOiBQbHVnaW5Ib29rcyA9IHtcbiAgZGVyaXZlUmVjb3JkS2V5OiAocmVjb3JkKSA9PiB7XG4gICAgaWYgKCFyZWNvcmQuc3RhYmxlSWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihg5pif6ZOB6K6w5b2V57y65bCRIHN0YWJsZUlk77yI5pyN5Yqh56uv6Zuq6IqxIElE77yJ77yM5peg5rOV55Sf5oiQ56iz5a6a55qEIHJlY29yZF9rZXnvvJppdGVtSWQ9XCIke3JlY29yZC5pdGVtSWR9XCJgKTtcbiAgICB9XG4gICAgcmV0dXJuIGAke3JlY29yZC5iYW5uZXJJZH06JHtyZWNvcmQuc3RhYmxlSWR9YDtcbiAgfSxcbn07XG4iLCIvKipcbiAqIOW0qeWdj++8muaYn+epuemTgemBk+aPkuS7tiBtYW5pZmVzdOOAglxuICpcbiAqIOmHh+mbhuiMg+W8j++8mmNyZWRlbnRpYWxlZEFwae+8iGBncy1wLWF1dGhrZXlg77yJ77yM5LiO5Y6f56We5ZCM5rqQ4oCU4oCU5Yet5o2u5p2l6Ieq5ri45oiP5YaF572uXG4gKiBDaHJvbWl1bSDnu4Tku7bnmoTno4Hnm5jnvJPlrZjvvIjnjqnlrrbmiZPlvIDot4Pov4HorrDlvZXpobXml7bvvIx3ZWJ2aWV3IOS8muWRveS4reWumOaWuVxuICogYGdldEdhY2hhTG9nYCDmjqXlj6PlubbluKbkuIogYXV0aGtlee+8jOiQveWcqCBgd2ViQ2FjaGVzYCDnm67lvZXkuIvmn5DkuKrniYjmnKzlj7flrZDnm67lvZXnmoRcbiAqIGBDYWNoZS9DYWNoZV9EYXRhL2RhdGFfMmAg57Si5byV5paH5Lu26YeM77yJ44CCXG4gKlxuICog5pys5paH5Lu255SxIE0xLVM3IOe6uOmdouWhq+ihqOa8lOe7g+iNieeovyBgZHJpbGxzL3N0YXJyYWlsL21hbmlmZXN0LnRzYCDovazljJbogIzmnaXigJTigJRcbiAqIOa8lOe7g+mqjOivgeeahOaYr1wiUzIg5pS56L+H55qE5o+S5Lu25aWR57qm57G75Z6L5piv5ZCm6KOF5b6X5LiL5pif6ZOB55qE55yf5a6e5beu5byC54K5XCLvvIzmnKzmlofku7bmmK/miopcbiAqIOmqjOivgee7k+iuuuiQveWcsOaIkOecn+ato+aOpeWFpSBgcGx1Z2lucy9pbmRleC50c2Ag55qE5Y+v6L+Q6KGM5o+S5Lu277yI5pys5qyh5pS55Yqo6IyD5Zu05LiN5ZCrXG4gKiBgcGx1Z2lucy9pbmRleC50c2Ag55qE5rOo5YaM77yM55Sx5Li76L+b56iL57uf5LiA5aSE55CG77yJ44CC6I2J56i/6YeM55qE5Lul5LiL5YaF5a655bey6ZqP5pys5qyhXG4gKiDovazljJbov4fmnJ/jgIHkuI3lho3nhafmioTvvJpcbiAqICAgLSBgYWxsb3dlZEhvc3RzYCDljaDkvY3ln5/lkI0g4oaSIOaNouaIkOS4i+aWueecn+WunuaguOWunueahOS4pOS4qiBob3N0XG4gKiAgIC0gXCJgZW5kcG9pbnRPdmVycmlkZWAg5LuO5pyq6KKrIGBidWlsZF9wYWdlX3VybGAg6K+75Y+WXCJcImFwaUZpZWxkIOWIhuaUr+iiq+agh1xuICogICAgIGAjW2FsbG93KGRlYWRfY29kZSldYFwiIOKGkiDlnYfmmK8gTTEtUzcg5pe255qE54q25oCB77yMTTIg5bey5YWo6YOo5a6e6KOF77yM5pys5paH5Lu25LiN5YaNXG4gKiAgICAg5aSN6L+w6L+H5pyf5o+P6L+wXG4gKiAgIC0g5paw5aKeIGBwaXR5R3JvdXBzYOOAgWBob29rcy50c2DvvIjojYnnqL/liLvmhI/kuI3loavvvIznkIbnlLHlt7Lpmo/kv53lupXmlbDlgLzliLDkvY3ogIzlpLHmlYjvvIlcbiAqICAgLSDmmL7lvI/lhrPnrZYgYGJhbm5lcklkZW50aXR5YCDkuI3lo7DmmI7vvIjop4HkuIvmlrkgY29sbGVjdC5wYXJhbXMg5YaF5rOo6YeK77yJXG4gKiAgIC0g5paw5aKeIGByYXRlTGltaXRgIOaYvuW8j+WjsOaYjlxuICpcbiAqIOaVsOaNruadpea6kO+8iOS4jeWHreiuree7g+iusOW/hue8lumAoOWtl+auteWQjS/mlbDlgLzvvInvvJpcbiAqIC0gYGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9Ib1lvLkdhY2hhL2NyYXRlcy9nYW1lX2Jpei9zcmMvYXBpLnJzOjQyLTQ2YFxuICogICDvvIhob3N0IOS4juerr+eCuei3r+W+hOWJjee8gO+8mmBwdWJsaWMtb3BlcmF0aW9uLWhrcnBnLm1paG95by5jb21gIC9cbiAqICAgYHB1YmxpYy1vcGVyYXRpb24taGtycGctc2cuaG95b3ZlcnNlLmNvbWDvvIzot6/lvoTliY3nvIBcbiAqICAgYC9jb21tb24vaGtycGdfZ2FjaGFfcmVjb3JkL2FwaS9g77yMYGdldEdhY2hhTG9nYC9gZ2V0TGRHYWNoYUxvZ2Ag56uv54K55ZCN77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvc3Rhci1yYWlsLXdhcnAtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjE2LTIzNGBcbiAqICAg77yIYFsnMjEnLCcyMiddLmluY2x1ZGVzKGtleSkgPyAnZ2V0TGRHYWNoYUxvZycgOiAnZ2V0R2FjaGFMb2cnYCDnmoTnq6/ngrnpgInmi6npgLvovpHvvJtcbiAqICAg6K+l5Y+C6ICD5a6e546w55So55qE6Lev5b6E5YmN57yA5pivIGAvY29tbW9uL2dhY2hhX3JlY29yZC9hcGkvYO+8jOS4jiBIb1lvLkdhY2hhIOeahFxuICogICBgL2NvbW1vbi9oa3JwZ19nYWNoYV9yZWNvcmQvYXBpL2Ag5LiN5ZCM4oCU4oCU5pys5o+S5Lu25LiN5pS55YaZ6Lev5b6E5YmN57yA77yM5Lik5aWX5YaZ5rOVXG4gKiAgIOmDveS4jeS8mui4qeWIsO+8jOingeS4i+aWuSByZXF1ZXN0LnVybCDms6jph4rvvInjgIFgOjIyMy0yMjVg77yIYHNsZWVwKDAuMylgIOavj+mhteW7tui/nyArXG4gKiAgIOazqOmHiuaOieeahOavjyAxMCDpobUgYHNsZWVwKDEpYCDmibnph4/lgZzpob8gKyBgcmV0cnlDb3VudDogNWDvvInjgIFgOjIyNi0yMzRgXG4gKiAgIO+8iOWTjeW6lOS/oeWwgSBgcmVzLmRhdGFgIOS4iyBgbGlzdGAvYHJlZ2lvbmAvYHJlZ2lvbl90aW1lX3pvbmVgIOWQjOe6p++8ieOAgVxuICogICBgOjQ1MS00NTJg77yI5pys5Zyw5a2Y5qGj5a2X5q6177ya5LuF5L+d55WZIDkg6ZSu77yMYHVpZGAvYGxhbmdgIOiiq+S4ouW8g++8jOivgeaYjuecn+WuniBBUElcbiAqICAg6K6w5b2V5pys6Lqr5pC65bim6L+Z5Lik5Liq5a2X5q614oCU4oCU5LiO5LiL5pa544CMMTEg6ZSu44CN55qE5Lu75Yqh566A5oql5Y+j5b6E5LqS55u45Y2w6K+B77yJXG4gKiAtIGBkb2NzL19pbnRlcm5hbC9yZXNlYXJjaC8wMy3nnJ/lrp7lr7zlh7rmlbDmja7moLzlvI/lrp7mtYsubWRgIMKnMS4y77yIYGdhY2hhX2lkYO+8iVxuICogICDCpzEuM++8iOWFg+aVsOaNrue8uuWkseecn+Wunuagt+S+i++8jGBpdGVtX2lkYCDmmK/llK/kuIDkv53or4HpnZ7nqbrnmoTplJrngrnvvInCpzIuMe+8iHR5cGVNYXDvvIlcbiAqICAgwqcyLjPvvIhgcmVnaW9uX3RpbWVfem9uZWAg5piv6aG157qn5a2X5q6177yM5LiN5piv6YCQ5p2h6K6w5b2V5a2X5q6177yJXG4gKiAtIOWumOaWueS/neW6leamgueOh+WFrOekuiBKU09O77yIYG9wZXJhdGlvbi13ZWJzdGF0aWMubWlob3lvLmNvbS9nYWNoYV9pbmZvL2hrcnBnL1xuICogICBwcm9kX2dmX2NuLzxiYW5uZXJJZD4vemgtY24uanNvbmDvvInigJTigJQqKuW3sueUseS4u+i/m+eoi+WcqOS7u+WKoeeugOaKpemYtuauteeLrOeri+aguOmqjCoq77yMXG4gKiAgIOacrCBBZ2VudCDkvJror53mnKrph43mlrDmipPlj5bvvIxgcGl0eUdyb3Vwc2Ag6YeM6YCQ57uE5qCH5rOo5LqG6L+Z5p2h6L6555WM44CCXG4gKiAtIGBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHNgIC8gYHBsdWdpbnMvd3V3YS9tYW5pZmVzdC50c2DvvIjlkIzml4/lt7LokL3lnLDmj5Lku7bvvIxcbiAqICAg5YaZ5rOV5LiO5rOo6YeK5a+G5bqm5a+56b2Q77yJXG4gKi9cbmltcG9ydCB0eXBlIHsgUGx1Z2luTWFuaWZlc3QgfSBmcm9tIFwiZ3MtcGx1Z2luLWtpdFwiO1xuXG5leHBvcnQgeyBob29rcyB9IGZyb20gXCIuL2hvb2tzLnRzXCI7XG5cbi8qKlxuICog5LuOIGBnZXRHYWNoYUxvZ2AvYGdldExkR2FjaGFMb2dgIOWTjeW6lOS9k+mHjOWPluWHuuacrOmhteiusOW9leaVsOe7hOOAglxuICpcbiAqIOecn+WunuWTjeW6lOW9ouaAgeaYryBgeyByZXRjb2RlLCBtZXNzYWdlLCBkYXRhOiB7IGxpc3Q6IFsuLi5dLCByZWdpb24sIHJlZ2lvbl90aW1lX3pvbmUgfSB9YFxuICog4oCU4oCU5LiO5Y6f56We5ZCM5p6E77yMYHJlZ2lvbmAvYHJlZ2lvbl90aW1lX3pvbmVgIOS4jiBgbGlzdGAg5ZCM57qn77yM5piv6aG157qn5YWD5pWw5o2u77yMXG4gKiDkuI3mmK/pgJDmnaHorrDlvZXlrZfmrrXvvIhgcmVzZWFyY2gvMDNgIMKnMi4z77ybYHN0YXItcmFpbC13YXJwLWV4cG9ydC9zcmMvbWFpbi9cbiAqIGdldERhdGEuanM6MjI2LTIzNGAg55qEIGBjb25zdCB7IGxpc3QsIHVpZCwgcmVnaW9uLCByZWdpb25fdGltZV96b25lIH0gPVxuICogYXdhaXQgZ2V0R2FjaGFMb2dzKC4uLilgIOWNsOivgeS4ieiAheS7juWQjOS4gOS4qiBgcmVzPy5kYXRhYCDlr7nosaHop6PmnoTogIzmnaXvvInjgIJcbiAqIOmYsuW+oeW8j+ino+aekO+8muS7u+S9leS4gOWxguW9oueKtuS4jeWvueWwsei/lOWbnuepuuaVsOe7hOiAjOS4jeaYr+aKm+W8guW4uOKAlOKAlOWIhumhteW8leaTjuS8muaKiuepuuaVsOe7hFxuICog5b2T5L2cIGBlbXB0eVBhZ2VgIOe7iOatouadoeS7tuWkhOeQhu+8jOavlOiuqeS4gOasoeWBtuWPkeeahOeVuOW9ouWTjeW6lOS4reaWreaVtOadoemHh+mbhua1geeoi+abtOWuieWFqOOAglxuICovXG5mdW5jdGlvbiBleHRyYWN0R2FjaGFMb2dMaXN0KHJlc3BvbnNlOiB1bmtub3duKTogdW5rbm93bltdIHtcbiAgaWYgKHR5cGVvZiByZXNwb25zZSAhPT0gXCJvYmplY3RcIiB8fCByZXNwb25zZSA9PT0gbnVsbCkgcmV0dXJuIFtdO1xuICBjb25zdCBkYXRhID0gKHJlc3BvbnNlIGFzIHsgZGF0YT86IHVua25vd24gfSkuZGF0YTtcbiAgaWYgKHR5cGVvZiBkYXRhICE9PSBcIm9iamVjdFwiIHx8IGRhdGEgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgbGlzdCA9IChkYXRhIGFzIHsgbGlzdD86IHVua25vd24gfSkubGlzdDtcbiAgcmV0dXJuIEFycmF5LmlzQXJyYXkobGlzdCkgPyBsaXN0IDogW107XG59XG5cbi8qKiDlj6/pgInkvYbkuI3mjqXlj5fnqbrkuLLigJTigJTnqbrkuLLlv4XpobvooqvlvZPmiJDjgIzmsqHmnInlgLzjgI3vvIzkuI3og73lhpLlhYXjgIzmnInlgLzjgI3jgIIgKi9cbmZ1bmN0aW9uIHRvTm9uRW1wdHlTdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpO1xuICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdHJpbW1lZCA6IHVuZGVmaW5lZDtcbn1cblxuLyoqIOWumOaWueWTjeW6lOmHjOeahCBgY291bnRgIOaYr+aVsOWtl+Wtl+espuS4su+8iOWmgiBgXCIxXCJg77yJ77yM6Ziy5b6h5byP6L2s5o2i77yM5byC5bi46L6T5YWl5YWc5bqV5Li6IDHjgIIgKi9cbmZ1bmN0aW9uIHRvQ291bnQodmFsdWU6IHVua25vd24pOiBudW1iZXIge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlcih2YWx1ZSk7XG4gICAgaWYgKE51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gcGFyc2VkO1xuICB9XG4gIHJldHVybiAxO1xufVxuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIOS/neW6le+8mjXimIUg6L2v5L+d5bqV5puy57q/55qE5Lik5aWX56S+5Yy65o6o566X5Y+j5b6EXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vXG4vLyDimqDvuI8gKipiYXNlIC8gaGFyZFBpdHkgLyBndWFyYW50ZWUg5p2l6Ieq5a6Y5pa55YWs56S6IEpTT07vvIjlt7LnlLHkuLvov5vnqIvmoLjpqozvvInvvIxcbi8vIGN1cnZlIOeahCBzdGFydCAvIHN0ZXAg5a6Y5pa55LuO5pyq5YWs56S677yM5piv5ZCM5Lq656S+5Yy65Y+j5b6E55qE5o6o566X5YC877yM5LiN5ZCM5p2l5rqQ5ZyoXG4vLyA3M343NSDkuYvpl7TkuI3kuIDoh7QqKuKAlOKAlOagh+azqOaWueW8j+Wvuem9kCBgcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzOjE2MS0xNjRgXG4vLyDnmoTlkIzmrL7lhYjkvovvvIzkuI3miormjqjnrpflgLzor7TmiJDlrpjmlrnmlbDlgLzjgIJcblxuLyoqIOinkuiJsuexu+axoO+8iOehrOS/neW6lSA5MO+8ieeahOi9r+S/neW6leabsue6v++8mjc0IOaKvei1t+OAgeavj+aKvSArNiXvvIzlkIzkurrnpL7ljLrlj6PlvoTjgIIgKi9cbmNvbnN0IENIQVJBQ1RFUl9TT0ZUX1BJVFlfQ1VSVkUgPSB7XG4gIGtpbmQ6IFwic29mdFBpdHlcIiBhcyBjb25zdCxcbiAgYmFzZTogMC4wMDYsXG4gIHN0YXJ0OiA3NCxcbiAgc3RlcDogMC4wNixcbn07XG5cbi8qKiDlhYnplKXnsbvmsaDvvIjnoazkv53lupUgODDvvInnmoTova/kv53lupXmm7Lnur/vvJrmjInop5LoibLmsaDlj6PlvoTnrYnmr5TkvovlpJbmjqjvvIw2NSDmir3otbfjgIHmr4/mir0gKzcl44CCICovXG5jb25zdCBMSUdIVF9DT05FX1NPRlRfUElUWV9DVVJWRSA9IHtcbiAga2luZDogXCJzb2Z0UGl0eVwiIGFzIGNvbnN0LFxuICBiYXNlOiAwLjAwOCxcbiAgc3RhcnQ6IDY1LFxuICBzdGVwOiAwLjA3LFxufTtcblxuZXhwb3J0IGNvbnN0IG1hbmlmZXN0ID0ge1xuICBpZDogXCJzdGFycmFpbFwiLFxuICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5bSp5Z2P77ya5pif56m56ZOB6YGTXCIgfSxcbiAgc2RrVmVyc2lvbjogXCIxLjAuMFwiLFxuICBwbGF0Zm9ybXM6IFtcIndpbmRvd3NcIl0sXG4gIG1haW50YWluZXJzOiBbXCJnYWNoYS1zdHVkaW9cIl0sXG4gIC8vIGV4Y2hhbmdlRm9ybWF0cyDkuI3lo7DmmI7vvJrmmJ/pk4HnmoQgVUlHRiDlrZfmrrXmmKDlsITmnKrnu4/nnJ/lrp7lrp7njrDmoKHlh4bvvIzkuI3lnKjmnKzmrKFcbiAgLy8g5o6l5YWl6IyD5Zu05YaF57yW6YCg77yI5LiOIGRyaWxscy9zdGFycmFpbC9tYW5pZmVzdC50cyDnmoTml6LmnInnq4vlnLrkuIDoh7TvvInjgIJcblxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwiY2hyb21pdW1DYWNoZVwiLFxuICAgICAgICAvLyDnm7jlr7nniYfmrrXvvIzkuI3mmK/nu53lr7not6/lvoTigJTigJTnu53lr7nlronoo4Xnm67lvZXmnaXoh6rnlKjmiLfphY3nva7vvIznlLEgUnVzdCDkvqfmi7zmjqXjgIJcbiAgICAgICAgZ2FtZURpcjogXCJTdGFyUmFpbF9EYXRhL3dlYkNhY2hlc1wiLFxuICAgICAgICB1cmxQYXR0ZXJuOiAvaHR0cHM6XFwvXFwvLis/Z2V0R2FjaGFMb2dbXlwiXSsvLFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgLy8g4pqg77iPICoq56uv54K56Lev5b6E5YmN57yA5pyJ5Lik5aWX5YaZ5rOV77yM5pys5o+S5Lu25LiN5pS55YaZ5YmN57yAKirvvJrlj4LogIPlrp7njrBcbiAgICAgICAgLy8gc3Rhci1yYWlsLXdhcnAtZXhwb3J0IOeUqCBgL2NvbW1vbi9nYWNoYV9yZWNvcmQvYXBpL2BcbiAgICAgICAgLy8g77yIZ2V0RGF0YS5qczoyMTfvvInvvIxIb1lvLkdhY2hhIOeUqCBgL2NvbW1vbi9oa3JwZ19nYWNoYV9yZWNvcmQvYXBpL2BcbiAgICAgICAgLy8g77yIZ2FtZV9iaXovc3JjL2FwaS5yczo0Mi00Nu+8ieOAguWHreaNriBVUkwg5piv5LuO5ri45oiP57yT5a2Y6YeM5Y6f5qC35omr5Ye65p2l55qEXG4gICAgICAgIC8vIOWujOaVtOivt+axgiBVUkzvvIjlkKvnnJ/lrp7liY3nvIDvvInvvIzkuIvpnaLnmoTmqKHmnb/nlKggYHt7Y3JlZGVudGlhbH19YCDljp/kuLJcbiAgICAgICAgLy8g6L+95Yqg5YiG6aG15Y+C5pWw77yM5LiN6YeN5paw5ou86Lev5b6E4oCU4oCU5peg6K6655yf5a6e5a6i5oi356uv5ZG95Lit5ZOq5LiA5aWX5YmN57yA6YO96IO95q2j5bi4XG4gICAgICAgIC8vIOW3peS9nOOAgmBiYW5uZXJzW10uZW5kcG9pbnRPdmVycmlkZWDvvIjop4HkuIvmlrkgYmFubmVyc++8ieWPquabv+aNoiBVUkwg55qEXG4gICAgICAgIC8vIOacgOWQjuS4gOS4qui3r+W+hOaute+8iGBnZXRHYWNoYUxvZ2Ag4oaSIGBnZXRMZEdhY2hhTG9nYO+8ie+8jOWQjOagt+S4jeWFs+W/g+WJjee8gFxuICAgICAgICAvLyDmmK/lk6rkuIDlpZfvvIzkuKTnp43lhpnms5Xpg73kuI3kvJrouKnpm7fjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g5Y+C5pWw5ZCN5LiO5Y6f56We5qih5p2/5LiA6Ie077yacGFnZS9nYWNoYV90eXBlL3NpemUvZW5kX2lk77yM5p2l5rqQXG4gICAgICAgIC8vIHN0YXItcmFpbC13YXJwLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjE4OO+8iFxuICAgICAgICAvLyBgJHt1cmx9JmdhY2hhX3R5cGU9JHtrZXl9JnBhZ2U9JHtwYWdlfSZzaXplPSR7MjB9JHtlbmRJZD8nJmVuZF9pZD0nK2VuZElkOicnfWDvvInjgIJcbiAgICAgICAgdXJsOiBcInt7Y3JlZGVudGlhbH19JnBhZ2U9e3twYWdlfX0mZ2FjaGFfdHlwZT17e2dhY2hhVHlwZX19JnNpemU9e3twYWdlU2l6ZX19JmVuZF9pZD0wXCIsXG4gICAgICB9LFxuICAgICAgLy8g5Zu95pyNICsg5Zu96ZmF5pyN5Lik5LiqIGhvc3Qg6YO96KaB5pS25b2V77yM55CG55Sx5LiOIHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50c1xuICAgICAgLy8gNzktODgg6KGM5ZCM5qy+5pWZ6K6t5LiA6Ie077yadXJsUGF0dGVybiDmnKzouqvkuI3ljLrliIbln5/lkI3vvIzlj6ropoEgVVJMIOmHjOWHuueOsFxuICAgICAgLy8gXCJnZXRHYWNoYUxvZ1wiIOWwseS8muWMuemFje+8jOiLpeWPquWjsOaYjuWbveacjSBob3N077yM5Zu96ZmF5pyN546p5a6255qE5q2j5bi46K+35rGC5Lya6KKrXG4gICAgICAvLyDor6/liKTkuLrmipXmr5LogIzmi5Lnu53jgILkuKTkuKrln5/lkI3lt7LnlKggSG9Zby5HYWNoYSDmupDnoIHmoLjlrp7vvJpcbiAgICAgIC8vIGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9Ib1lvLkdhY2hhL2NyYXRlcy9nYW1lX2Jpei9zcmMvYXBpLnJzOjQyLTQzXG4gICAgICAvLyAgICgoSGtycGcsIE9mZmljaWFsKSwgU3RhbmRhcmQpIC0+IFwiaHR0cHM6Ly9wdWJsaWMtb3BlcmF0aW9uLWhrcnBnLm1paG95by5jb20vLi4uXCJcbiAgICAgIC8vICAgKChIa3JwZywgT3ZlcnNlYSksICBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24taGtycGctc2cuaG95b3ZlcnNlLmNvbS8uLi5cIlxuICAgICAgYWxsb3dlZEhvc3RzOiBbXCJwdWJsaWMtb3BlcmF0aW9uLWhrcnBnLm1paG95by5jb21cIiwgXCJwdWJsaWMtb3BlcmF0aW9uLWhrcnBnLXNnLmhveW92ZXJzZS5jb21cIl0sXG4gICAgICBleHRyYWN0TGlzdDogZXh0cmFjdEdhY2hhTG9nTGlzdCxcbiAgICAgIC8vIOmZkOmAn+etlueVpe+8muaYvuW8j+WjsOaYju+8jOWPluWAvOaKhOiHquWPguiAg+WunueOsOeahOecn+WunuihjOS4uuKAlOKAlFxuICAgICAgLy8gc3Rhci1yYWlsLXdhcnAtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjIz77yIYGF3YWl0IHNsZWVwKDAuMylgXG4gICAgICAvLyDmr4/pobXlu7bov58gMzAwbXPvvInjgIE6MjE5LTIyMu+8iOavjyAxMCDpobXpop3lpJblgZzpob8gMXPvvIzor6XniYjmnKzph4zov5nmrrXooqvms6jph4pcbiAgICAgIC8vIOaOieS6hu+8jOS9huaVsOWAvOacrOi6q+S7jeaYr+WPr+S/oeeahOWPguiAg+WunueOsOiuvuiuoeaEj+Wbvu+8ieOAgToyMjXvvIhgcmV0cnlDb3VudDogNWDvvInjgIJcbiAgICAgIC8vIOWuv+S4u+aMiVwi6YCQ5a2X5q615Y+W5pu05rip5ZKM6ICFXCLlkIjlubbov5nph4znmoTlo7DmmI7kuI7lrr/kuLvmnKzmrKHkvJror53nmoTms6jlhaXnrZbnlaVcbiAgICAgIC8vIO+8iGBjcmF0ZXMvcGFyYWRpZ21zL2dzLXAtYXV0aGtleS9zcmMvcmF0ZV9saW1pdC5yc2Ag55qEXG4gICAgICAvLyBgbWVyZ2VkX3dpdGhfZGVjbGFyZWRg77yJ4oCU4oCU5Lu75L2V5LiA5pa56YO95LiN6IO95oqK5Y+m5LiA5pa55pS+5p2+77yM5Zug5q2k6L+Z6YeM5aGrXG4gICAgICAvLyBcIua4uOaIjyBBUEkg6IO95Y+X5aSa5bCRXCLvvIzkuI3pnIDopoHmi4Xlv4Pooqvlrr/kuLvnmoTmm7Tmv4Dov5vnrZbnlaXopobnm5bjgIJcbiAgICAgIHJhdGVMaW1pdDoge1xuICAgICAgICBwZXJQYWdlRGVsYXlNczogMzAwLFxuICAgICAgICBiYXRjaFNpemU6IDEwLFxuICAgICAgICBiYXRjaERlbGF5TXM6IDEwMDAsXG4gICAgICAgIHJldHJ5OiB7IG1heEF0dGVtcHRzOiA1LCBkZWxheU1zOiA1MDAwIH0sXG4gICAgICB9LFxuICAgICAgLy8gYmFubmVySWRlbnRpdHkg5LiN5aOw5piO77yM57y655yBIFwicmVzcG9uc2VcIuKAlOKAlOi/meaYr+aYvuW8j+WGs+etlu+8jOS4jeaYr+a8j+Whq+OAglxuICAgICAgLy8g57Gz5ZOI5ri45LiJ5ri45YWx5Lqr5ZCM5LiA5aWXIGBnZXRHYWNoYUxvZ2Ag5ZON5bqU5b2i5oCB77yM5Y6f56We5bey5a6e5rWL6K+B5a6e5Lya5re35rGgXG4gICAgICAvLyDvvIhmaXh0dXJlcy9nZW5zaGluL3Jhd19yZXNwb25zZS8zMDFfcGFnZV8xLmpzb27vvJrmn6Xor6IgZ2FjaGFfdHlwZT0zMDHvvIxcbiAgICAgIC8vIOWTjeW6lOmHjOa3t+WbniBnYWNoYV90eXBlPTQwMCDnmoTorrDlvZXvvInjgILmmJ/pk4HmmK/lkKbkvJrmt7fmsaDvvIzmnKzmrKHku7vliqHnroDmiqXkuI5cbiAgICAgIC8vIHJlc2VhcmNoLzAz44CBMDQg5Z2H5pyq57uZ5Ye65pif6ZOB6Ieq6Lqr55qE54us56uL5re35rGg5a6e5rWL77yM5LiO6bij5r2u6YKj56eN44CM5bey6K+B5a6eXG4gICAgICAvLyDkuI3mt7fmsaDjgI3nmoTmg4XlhrXkuI3lkIzigJTigJTpuKPmva7og73lronlhajlo7DmmI4gXCJxdWVyeVwi77yI6KeBXG4gICAgICAvLyBwbHVnaW5zL3d1d2EvbWFuaWZlc3QudHMg55qE5ZCM5ZCN5a2X5q615rOo6YeK77yJ5piv5Zug5Li65pyJ55yf5a6e5a2Y5qGj5a6e5rWL6IOM5Lmm77yMXG4gICAgICAvLyDmmJ/pk4HmsqHmnInjgILlo7DmmI4gXCJxdWVyeVwiIOS4gOaXpuWBh+iuvumUmeivr++8jOa3t+WFpeeahOiusOW9leS8muiiq+mdmem7mOmUmeivr+W9kuaxoOS4lFxuICAgICAgLy8g5p6B6Zq+5a6a5L2N77yM5Luj5Lu36L+c6auY5LqOXCLkuI3lo7DmmI7jgIHmsr/nlKjmm7Tkv53lrojnmoTpu5jorqTlgLxcIu+8jOWboOatpOi/memHjOS4jei1jOOAglxuICAgIH0sXG4gIH0sXG5cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIuaYn+mTgSBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgLy8g5pif6ZOBIEFQSSDljp/nlJ/ov5Tlm54gaXRlbV9pZOKAlOKAlOS4juWOn+elnuS4jeWQjO+8iOWOn+elniBnZXRHYWNoYUxvZyDkuI3ov5Tlm55cbiAgICAgIC8vIGl0ZW1faWTvvIxpdGVtSWQg5Y+q6IO96YCA6ICM5rGC5YW25qyh55So5pys5Zyw5YyW54mp5ZOB5ZCN77yM6KeBXG4gICAgICAvLyBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHMg55qE6K+m57uG6K+05piO77yJ44CC55yf5a6e6K6w5b2V5qC35L6L6KeBIHJlc2VhcmNoLzAzXG4gICAgICAvLyDCpzEuM++8muivpeagt+S+i+aBsOWlveaYr+S4gOadoeWFg+aVsOaNrue8uuWkseiusOW9le+8iGl0ZW1faWQ9XCIxMjIzXCIg5pyJ55yf5a6e5YC877yMXG4gICAgICAvLyBuYW1lL2l0ZW1fdHlwZS9yYW5rX3R5cGUg5YWo5Li656m65a2X56ym5Liy77yJ4oCU4oCU6L+Z5p2h5qC35L6L5Y+N6ICM5pu05pyJ6K+05pyN5Yqb77yMXG4gICAgICAvLyDor4HmmI4gaXRlbV9pZCDmmK/ov5nnsbvlvILluLjorrDlvZXph4zllK/kuIDku43nhLbkv53or4HpnZ7nqbrnmoTplJrngrnjgIJcbiAgICAgIGNvbnN0IGl0ZW1JZCA9IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLml0ZW1faWQpO1xuICAgICAgaWYgKCFpdGVtSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi5pif6ZOBIGV4dHJhY3RSZWNvcmTvvJrorrDlvZXnvLrlsJEgaXRlbV9pZO+8jOaXoOazleehruWumiBpdGVtSWRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGl0ZW1JZCxcbiAgICAgICAgdGltZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQudGltZSkgPz8gXCJcIixcbiAgICAgICAgLy8gYmFubmVySWQg55SoIGdhY2hhX3R5cGXvvIjljaHmsaDnsbvliKvnoIHvvJoxLzIvMTEvMTIvMjEvMjLvvInvvIzkuI3mmK9cbiAgICAgICAgLy8gZ2FjaGFfaWTigJTigJRnYWNoYV9pZCDmmK/lhbfkvZPljaHmsaDlrp7kvosgaWTvvIjlpoLlkIzkuIDnsbvliKvnoIHkuIvpmo/ml7bpl7Tmjqjlh7rnmoRcbiAgICAgICAgLy8g5LiN5ZCM5pyf5pWw77yMcmVzZWFyY2gvMDMgwqcxLjIg5a6e5rWL5pyJIDQ5IOenjeecn+WunuWPluWAvO+8ie+8jFxuICAgICAgICAvLyBVbmlmaWVkUmVjb3JkRmllbGRzIOayoeacieWtl+auteiDveaJv+i9veWug++8jOS8muWvvOiHtCBiYW5uZXJzW10g6ZyA6KaB5p6a5Li+XG4gICAgICAgIC8vIOaMgee7reWinumVv+eahOWunuS+iyBpZO+8jOe7tOaKpOi0n+aLhei/nOmrmOS6juaMieexu+WIq+WjsOaYju+8jOWboOatpOS4jeiQveWcsOi/meS4quS/oeaBr++8jFxuICAgICAgICAvLyDlj6rkv53nlZkgZ2FjaGFfdHlwZSDov5nkuIDlsYLljaHmsaDnsbvliKvjgIJcbiAgICAgICAgYmFubmVySWQ6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmdhY2hhX3R5cGUpID8/IFwiXCIsXG4gICAgICAgIGNvdW50OiB0b0NvdW50KHJlY29yZC5jb3VudCksXG4gICAgICAgIG5hbWU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLm5hbWUpLFxuICAgICAgICBpdGVtVHlwZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaXRlbV90eXBlKSxcbiAgICAgICAgcmFyaXR5OiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5yYW5rX3R5cGUpLFxuICAgICAgICBzdGFibGVJZDogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQuaWQpLFxuICAgICAgfTtcbiAgICB9LFxuICB9LFxuXG4gIC8vIOWNoeaxoOexu+WIq+eggeS4juaYvuekuuWQje+8jOebtOaOpeWPluiHqiByZXNlYXJjaC8wMyDCpzIuMSDnmoQgdHlwZU1hcCDlrp7mtYvnu5PmnpzvvIxcbiAgLy8g5a6Y5pa55bGV56S65ZCN5rK/55So5Lu75Yqh566A5oql5Y+j5b6E77yIMS8yIOS4pOS4quaxoOeahOesrOS4ieaWueWvvOWHuuW3peWFtyB0eXBlTWFwIOeUqOeahOaYr1xuICAvLyDpgJrnlKjmoIfnrb5cIuW4uOmpu+i3g+i/gVwiL1wi5paw5omL6LeD6L+BXCLvvIzkuI3mmK/muLjmiI/lhoXlrpjmlrnlsZXnpLrlkI1cIue+pOaYn+i3g+i/gVwiL1xuICAvLyBcIuWni+WPkei3g+i/gVwi4oCU4oCU5Lik6ICF5oyH5ZCR5ZCM5LiA5LiqIGdhY2hhX3R5cGXvvIzlj6rmmK/moIfnrb7mnaXmupDkuI3lkIzvvIzlpoLlrp7moIfms6jvvInjgIJcbiAgYmFubmVyczogW1xuICAgIHsgaWQ6IFwiMVwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi576k5pif6LeD6L+BXCIgfSB9LFxuICAgIHsgaWQ6IFwiMlwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5aeL5Y+R6LeD6L+BXCIgfSB9LFxuICAgIHsgaWQ6IFwiMTFcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuinkuiJsua0u+WKqOi3g+i/gVwiIH0gfSxcbiAgICB7IGlkOiBcIjEyXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLlhYnplKXmtLvliqjot4Pov4FcIiB9IH0sXG4gICAgLy8g6IGU5Yqo6LeD6L+B6LWw54us56uL56uv54K577yM5p2l5rqQIHN0YXItcmFpbC13YXJwLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIxNlxuICAgIC8vIO+8iGBbJzIxJywnMjInXS5pbmNsdWRlcyhrZXkpID8gJ2dldExkR2FjaGFMb2cnIDogJ2dldEdhY2hhTG9nJ2DvvInvvIxcbiAgICAvLyBIb1lvLkdhY2hhIOeahCBnYW1lX2Jpei9zcmMvYXBpLnJzOjQ1LTQ277yIQ29sbGFib3JhdGlvbiDliIbmlK/vvInlkIzmoLfljbDor4HjgIJcbiAgICB7IGlkOiBcIjIxXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLop5LoibLogZTliqjot4Pov4FcIiB9LCBlbmRwb2ludE92ZXJyaWRlOiBcImdldExkR2FjaGFMb2dcIiB9LFxuICAgIHsgaWQ6IFwiMjJcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuWFiemUpeiBlOWKqOi3g+i/gVwiIH0sIGVuZHBvaW50T3ZlcnJpZGU6IFwiZ2V0TGRHYWNoYUxvZ1wiIH0sXG4gIF0sXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIHBpdHlHcm91cHPvvJo2IOS4quWNoeaxoOWQhOiHqueLrOeri+S4gOe7hO+8jOiBlOWKqOaxoOS4jeS4juW4uOinhOaxoOWQiOW5tlxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy9cbiAgLy8gYmFzZSAvIGhhcmRQaXR5IC8gZ3VhcmFudGVlIOS4iemhueWPluiHquWumOaWueS/neW6leamgueOh+WFrOekuiBKU09OXG4gIC8vIO+8iG9wZXJhdGlvbi13ZWJzdGF0aWMubWlob3lvLmNvbS9nYWNoYV9pbmZvL2hrcnBnL3Byb2RfZ2ZfY24vPGlkPi9cbiAgLy8gemgtY24uanNvbu+8jOW3sueUseS4u+i/m+eoi+eLrOeri+aguOmqjO+8jOacrCBBZ2VudCDkvJror53mnKrph43mlrDmipPlj5bvvInvvIzlj6/kv6Hluqbop4bkuLpcbiAgLy8g44CM5a6Y5pa544CN44CCY3VydmUg55qEIHN0YXJ0L3N0ZXAg5piv5ZCM5Lq656S+5Yy65o6o566X5YC877yM6Z2e5a6Y5pa577yM6KeB5LiK5pa5XG4gIC8vIENIQVJBQ1RFUl9TT0ZUX1BJVFlfQ1VSVkUgLyBMSUdIVF9DT05FX1NPRlRfUElUWV9DVVJWRSDnmoTms6jph4rjgIJcbiAgLy9cbiAgLy8g4pqg77iPICoqMjEvMjIg6IGU5Yqo5rGg5L+d5bqV54us56uL5LqOIDExLzEyIOW4uOinhOaxoO+8jOS4jeWQiOW5tiBtZW1iZXJzKirigJTigJTlrpjmlrnlhaznpLpcbiAgLy8gSlNPTiDljp/mlofvvIjlt7LnlLHkuLvov5vnqIvmoLjpqozvvInvvJrjgIzlnKjku7vmhI/jgIxGYXRlW1VCV10g6KeS6Imy6IGU5Yqo6LeD6L+B44CN5Lit5pyq6I635Y+WXG4gIC8vIDXmmJ/op5LoibLnmoTntK/orqHot4Pov4HmrKHmlbDkvJrkuIDnm7TntK/orqHkuo7jgIxGYXRlW1VCV10g6KeS6Imy6IGU5Yqo6LeD6L+B44CN5Lit77yM5LiO5YW25LuWXG4gIC8vIOi3g+i/geeahOi3g+i/geasoeaVsOS/neW6leebuOS6kueLrOeri+iuoeeul++8jOS6kuS4jeW9seWTjeOAguOAjei/meadoeatpOWJjeaYr+acrOmhueebrueahOacquWGs+mhue+8jFxuICAvLyDnjrDlt7LmnInlrpjmlrnljp/mlofog4zkuabvvIwyMS8yMiDlkIToh6rljZXni6zmiJDnu4TjgIJcbiAgcGl0eUdyb3VwczogW1xuICAgIHtcbiAgICAgIGtleTogXCJjaGFyYWN0ZXJFdmVudFdhcnBcIiwgLy8gMTEg6KeS6Imy5rS75Yqo6LeD6L+BXG4gICAgICBtZW1iZXJzOiBbXCIxMVwiXSxcbiAgICAgIGhhcmRQaXR5OiA5MCxcbiAgICAgIGN1cnZlOiBDSEFSQUNURVJfU09GVF9QSVRZX0NVUlZFLFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sIC8vIDUwJSDnm7TmjqUgVVDvvIzmrarliJnkuIvmrKHlv4XkuK1cbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJsaWdodENvbmVFdmVudFdhcnBcIiwgLy8gMTIg5YWJ6ZSl5rS75Yqo6LeD6L+BXG4gICAgICBtZW1iZXJzOiBbXCIxMlwiXSxcbiAgICAgIGhhcmRQaXR5OiA4MCxcbiAgICAgIGN1cnZlOiBMSUdIVF9DT05FX1NPRlRfUElUWV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIndlaWdodGVkXCIsIHJhdGVVcENoYW5jZTogMC43NSB9LCAvLyA3NSUg55u05o6lIFVQXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwic3RlbGxhcldhcnBcIiwgLy8gMSDnvqTmmJ/ot4Pov4HvvIjluLjpqbvvvInvvIzml6AgVVBcbiAgICAgIG1lbWJlcnM6IFtcIjFcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogQ0hBUkFDVEVSX1NPRlRfUElUWV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIm5vbmVcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcImRlcGFydHVyZVdhcnBcIiwgLy8gMiDlp4vlj5Hot4Pov4HvvIjmlrDmiYvvvInvvIzml6AgVVBcbiAgICAgIG1lbWJlcnM6IFtcIjJcIl0sXG4gICAgICBoYXJkUGl0eTogNTAsXG4gICAgICAvLyDimqDvuI8gKipzdGFydC9zdGVwIOacquimhueblu+8jOWmguWunueVmeepuueUqCBjdXN0b20g5Y2g5L2N77yM5LiN5aSW5o6oKirvvJrku7vliqHnroDmiqVcbiAgICAgIC8vIOe7meWHuueahOS4pOadoeekvuWMuuaOqOeul+WPo+W+hOWIhuWIq+WvueW6lOehrOS/neW6lSA5MO+8iOinkuiJsuexu++8ieS4juehrOS/neW6lSA4MFxuICAgICAgLy8g77yI5YWJ6ZSl57G777yJ5Lik5qGj77yM5pys5Y2h5rGg56Gs5L+d5bqVIDUw77yM5LiN5bGe5LqO5Lu75LiA5qGj77yb5rKh5pyJ56ys5LiJ5qGj55qE5o6o566X5YC8XG4gICAgICAvLyDlj6/nlKjvvIzkuZ/msqHmnInliIbmobblkb3kuK3njofmlbDmja7mlK/mkpHnjrDmjqjkuIDmnaHmlrDmm7Lnur/jgILlpITnkIbmlrnlvI/lr7npvZBcbiAgICAgIC8vIHBsdWdpbnMvd3V3YS9tYW5pZmVzdC50cyDlr7nml6DliIbmobbmlbDmja7mlK/mkpHmm7Lnur/nmoTkuIDotK/lgZrms5VcbiAgICAgIC8vIO+8iGB3dXdhLXVuY29uZmlybWVkLSpzdGFyLXBvb2wtKmAg5Y2g5L2NIGlk77yJ44CCXG4gICAgICBjdXJ2ZTogeyBraW5kOiBcImN1c3RvbVwiLCBpZDogXCJzdGFycmFpbC11bmNvbmZpcm1lZC1zb2Z0cGl0eS1wb29sLTJcIiB9LFxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwibm9uZVwiIH0sXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwiY2hhcmFjdGVyRXZlbnRXYXJwQ29sbGFiXCIsIC8vIDIxIOinkuiJsuiBlOWKqOi3g+i/ge+8jOeLrOeri+S/neW6le+8jOS4jeS4jiAxMSDlkIjlubZcbiAgICAgIG1lbWJlcnM6IFtcIjIxXCJdLFxuICAgICAgaGFyZFBpdHk6IDkwLFxuICAgICAgY3VydmU6IENIQVJBQ1RFUl9TT0ZUX1BJVFlfQ1VSVkUsXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJsaWdodENvbmVFdmVudFdhcnBDb2xsYWJcIiwgLy8gMjIg5YWJ6ZSl6IGU5Yqo6LeD6L+B77yM54us56uL5L+d5bqV77yM5LiN5LiOIDEyIOWQiOW5tlxuICAgICAgbWVtYmVyczogW1wiMjJcIl0sXG4gICAgICBoYXJkUGl0eTogODAsXG4gICAgICBjdXJ2ZTogTElHSFRfQ09ORV9TT0ZUX1BJVFlfQ1VSVkUsXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJ3ZWlnaHRlZFwiLCByYXRlVXBDaGFuY2U6IDAuNzUgfSxcbiAgICB9LFxuICBdLFxuICAvLyDmnKzova7lj6rlo7DmmI4gNeKYhSDkv53lupXnu4TvvIzkuI3lo7DmmI4gNOKYhSDnu4TigJTigJTln7rnur8gcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzXG4gIC8vIOWQjOagt+ayoeaciSA04piFIOWIhue7hO+8jOS/neaMgeWPr+avlO+8m+acrOi9ruacquimhueblu+8jOeVmeW+heWQjue7reacieWIhuahtuaVsOaNruaUr+aSkeaXtuWGjeihpeOAglxuXG4gIHJhcml0eTogeyBsYWRkZXI6IFtcIjNcIiwgXCI0XCIsIFwiNVwiXSwgcGl0eVRhcmdldDogXCI1XCIgfSxcblxuICB0aW1lOiB7XG4gICAgLy8g55u06L+e5a6Y5pa5IEFQSe+8jOW+l+WIsOeahOaYr+acjeWKoeWZqOacrOWcsOaXtumXtOWtl+espuS4su+8jOS4jeW4puaXtuWMulxuICAgIC8vIO+8iHJlc2VhcmNoLzAzIMKnMi4z77yaXCLml7bpl7TlrZfnrKbkuLLkuIDlvovkuI3luKbml7bljLrvvIzmmK/mnI3liqHlmajmnKzlnLDml7bpl7RcIu+8ieOAglxuICAgIHJhd1RpbWVDb252ZW50aW9uOiBcInNlcnZlckxvY2FsXCIsXG4gICAgLy8gcmVnaW9uX3RpbWVfem9uZSDmmK/lk43lupTkvZMgZGF0YSDlsYLnmoTpobXnuqflrZfmrrXvvIjkuI4gbGlzdCDlkIznuqfvvIzkuI3mmK/pgJDmnaFcbiAgICAvLyDorrDlvZXlrZfmrrXvvInigJTigJTmnaXmupAgcmVzZWFyY2gvMDMgwqcyLjPjgIzmmJ/pk4EgcmVnaW9uX3RpbWVfem9uZT0444CNK1xuICAgIC8vIHN0YXItcmFpbC13YXJwLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIyNi0yMzTvvIhgcmVzPy5kYXRhYCDop6PmnoTlh7pcbiAgICAvLyBgbGlzdGAvYHJlZ2lvbmAvYHJlZ2lvbl90aW1lX3pvbmVgIOS4ieiAheWQjOe6p++8ieOAguWuv+S4u+eahFxuICAgIC8vIGByZWFkX3BhZ2VfbGV2ZWxfZmllbGRgIOW3suWunuijhe+8iOS4jeWQjOS6jiBkcmlsbHMvc3RhcnJhaWwvbWFuaWZlc3QudHNcbiAgICAvLyDmkrDlhpnml7YgTTEtUzcg55qE54q25oCB4oCU4oCU5b2T5pe26L+Z5Liq5YiG5pSv5LuO5pyq6KKr5raI6LS577yM5qCH5LqGXG4gICAgLy8gYCNbYWxsb3coZGVhZF9jb2RlKV1g77yMTTIg5bey5a6e6KOF5bm26KKr55yf5a6e5raI6LS577yJ77yM5Zug5q2k6L+Z6YeM5LiN6ZyA6KaBXG4gICAgLy8gaG9va3MucmVzb2x2ZVRpbWV6b25l77yM5a6/5Li75Lya55u05o6l5LuO5ZON5bqU5L2T6aG157qn5a2X5q616K+75Y+W5YGP56e76YeP44CCXG4gICAgdGltZXpvbmVTb3VyY2U6IHsga2luZDogXCJhcGlGaWVsZFwiLCBmaWVsZDogXCJyZWdpb25fdGltZV96b25lXCIgfSxcbiAgICAvLyByYXdGb3JtYXQg5LiN5aGr77ya5ZON5bqUIHRpbWUg5piv56m65qC85YiG6ZqU5qC85byPIFwiWVlZWS1NTS1ERCBISDptbTpzc1wiXG4gICAgLy8g77yI5aaCIHJlc2VhcmNoLzAzIMKnMS4zIOagt+S+iyBcIjIwMjQtMDktMTAgMTA6MDU6MjZcIu+8ie+8jOaBsOWlveaYr1xuICAgIC8vIFJhd1RpbWVGb3JtYXQg55qE6buY6K6k5YC8IHNwYWNlU2VwYXJhdGVk77yM5LiN6ZyA6KaB5pi+5byP5aOw5piO44CCXG4gIH0sXG5cbiAgcHJlY29uZGl0aW9uczogW1xuICAgIHtcbiAgICAgIGlkOiBcInN0YXJyYWlsLmNyZWRlbnRpYWwuY2FjaGVEaXJFeGlzdHNcIixcbiAgICAgIGNhcGFiaWxpdHk6IFwiY3JlZGVudGlhbFwiLFxuICAgICAgbGV2ZWw6IFwicmVxdWlyZWRcIixcbiAgICAgIGRlc2NyaWJlOiB7XG4gICAgICAgIFwiemgtQ05cIjogXCLoh6rliqjojrflj5bot4Pov4HorrDlvZXopoHmsYLmuLjmiI/lrqLmiLfnq6/oh7PlsJHov5DooYzov4fkuIDmrKHvvIznvJPlrZjnm67lvZXmiY3kvJrooqvliJvlu7pcIixcbiAgICAgIH0sXG4gICAgICAvLyDlkIzljp/npZ7lhYjkvovvvJpIb3N0RW52IOebruWJjeayoeacieOAjGNyZWRlbnRpYWwuZ2FtZURpciDlo7DmmI7nmoTnvJPlrZjnm67lvZXmmK/lkKZcbiAgICAgIC8vIOW3suiiq+ingua1i+WIsOOAjei/meS4gOS6i+Wunu+8jGNoZWNrIOWPquiDvei/lOWbniB1bmtub3du44CCXG4gICAgICBjaGVjazogKCkgPT4gKHsga2luZDogXCJ1bmtub3duXCIgfSksXG4gICAgICByZW1lZHk6IHsgXCJ6aC1DTlwiOiBcIuivt+WFiOWQr+WKqOa4uOaIj+W5tuaJk+W8gOS4gOasoei3g+i/geiusOW9lemhte+8jOWGjeWbnuWIsOacrOW6lOeUqOmHjeivlVwiIH0sXG4gICAgfSxcbiAgXSxcblxuICAvLyDkuI7ljp/npZ7kuIDoh7TnmoTojIPlvI8gQSDpgJrnlKjln7rnur/nrZbnlaXvvJrliIbpobXlk43lupToh6rluKbmgLvmnaHmlbDvvIzpm7bmiJDmnKzjgIHlhajopobnm5bjgIFcbiAgLy8g5peg6aKd5aSW5Yet5o2u6aOO6Zmp44CCXG4gIGJhc2VsaW5lOiB7IGtpbmQ6IFwiaW5HYW1lUGFnZUNvdW50XCIgfSxcblxuICByZXRlbnRpb246IHtcbiAgICBkaXNwbGF5VGV4dDogeyBcInpoLUNOXCI6IFwiNiDkuKrmnIhcIiB9LFxuICAgIC8vIOWumOaWuSBBUEkg5Y+q6L+U5Zue6L+RIDYg5Liq5pyI6K6w5b2V77yM5pyI6ZW/5LiN5LiA77yM5oyJIDbDlzI4PTE2OCDlpKnov5nnsbvovoPnn63lgLzlj5bvvIxcbiAgICAvLyDlkYrorablroHml6nli7/mmZrvvIzlsZXnpLrmlofmoYjkuIDlvovnlKjjgIw2IOS4quaciOOAjeKAlOKAlOWPo+W+hOS4jiBnZW5zaGluIOS4gOiHtO+8jOadpea6kFxuICAgIC8vIHJlc2VhcmNoLzAyLeW8gueOr05URemHh+mbhuaWueahiOiwg+eglC5tZCDCpzUuMe+8muOAjOWOn+elniAvIOaYn+mTgSAvIOe7neWMuumbtiB8XG4gICAgLy8g57qmIDYg5Liq5pyI44CN44CCXG4gICAgY29uc2VydmF0aXZlRGF5czogNiAqIDI4LFxuICB9LFxuXG4gIC8vIGl0ZW1JZFNvdXJjZSDkuI3lo7DmmI7vvIzpu5jorqQgXCJuYXRpdmVcIuOAgui/meaYr+S4juWOn+elnueahOa4heaZsOWvueeFp++8muWOn+elnuWboOS4uiBBUElcbiAgLy8g5LiN6L+U5ZueIGl0ZW1faWQg5omN6ZyA6KaB5pi+5byP5aOw5piOIFwiZGlzcGxheU5hbWVcIu+8m+aYn+mTgeeahCBpdGVtX2lkIOaYryBBUEkg5Y6f55SfXG4gIC8vIOWtl+aute+8iOecn+WunuWtmOaho+e7n+iuoeivgeWunu+8jOingeS4iuaWuSBmaWVsZHMuZXh0cmFjdFJlY29yZCDlhoXnmoTor7TmmI7vvInvvIzkuI3pnIDopoFcbiAgLy8g6L+Z5Liq54m55L6L44CCXG5cbiAgLy8gbWV0YWRhdGEg5LiN5aOw5piO44CCcmVzZWFyY2gvMDMgwqcxLjMg5oyH5Ye65pif6ZOB5a2Y5qGj56Gu5pyJ5YWD5pWw5o2u57y65aSx6K6w5b2VXG4gIC8vIO+8iDEvNTM3Mu+8ie+8jE1ldGFkYXRhUHJvdmlkZXIg55qEXCLkuovlkI7lm57loatcIuiDveWKm+WvueaYn+mTgeaYr+W/heimgeeahO+8jOS9humdmeaAgVxuICAvLyDlrZflhbjlhoXlrrnmnKzmrKHmnKrojrflj5bvvIzkuI3nvJbpgKDlrZflhbjlhoXlrrnvvIznlZnnqbrkuI7ljp/npZ7njrDnirbkuIDoh7RcbiAgLy8g77yIcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzIOWQjOagt+acquWjsOaYjiBtZXRhZGF0Ye+8ieKAlOKAlOacrOi9ruacquimhuebluOAglxuXG4gIC8vIGRyYXdDb3VudGluZyDkuI3lo7DmmI7vvIzpu5jorqQgcGVyUmVjb3Jk77yI57Gz5ZOI5ri45LiJ5ri4IGNvdW50IOaBkuS4uiAx77yM6YCC55So77yJ44CCXG59IHNhdGlzZmllcyBQbHVnaW5NYW5pZmVzdDtcbiIsIi8qKlxuICog6bij5r2u5o+S5Lu255qE6YCD55Sf6IixIGhvb2tz44CCXG4gKlxuICog5Y+q5a6e546wIGBkZXJpdmVSZWNvcmRLZXlzYCDkuIDkuKogaG9va+KAlOKAlGByZXNvbHZlVGltZXpvbmVgIOe8uuWwkVxuICogc3ZyX2lkL3N2cl9hcmVhIOWIsCBVVEMg5YGP56e76YeP55qE55yf5a6e5pig5bCE6KGo77yMYGNvdW50RHJhd3NgIOS4jemcgOimge+8iOm4o+a9rlxuICogYGRyYXdDb3VudGluZ2Ag5pyq5aOw5piO77yM6LWw6buY6K6kIGBwZXJSZWNvcmRg77yJ77yM6KeBIGAuL21hbmlmZXN0LnRzYCDlr7nlupTlrZfmrrVcbiAqIOaXgeeahOazqOmHiuOAglxuICpcbiAqICMjIOS4uuS7gOS5iOW/hemhu+aYr+aJueWkhOeQhueJiOacrO+8iGBkZXJpdmVSZWNvcmRLZXlzYO+8ie+8jOS4jeiDveeUqCBgZGVyaXZlUmVjb3JkS2V5YFxuICpcbiAqIOm4o+a9ruWTjeW6lOiusOW9leayoeacieS7u+S9leW9ouW8j+eahOeos+WumiBJRO+8iOingSBgLi9tYW5pZmVzdC50c2Ag55qEXG4gKiBgZmllbGRzLmV4dHJhY3RSZWNvcmRgIOazqOmHiu+8ie+8jGByZWNvcmRfa2V5YCDnrZbnlaXmmK9cbiAqIGBoYXNoKOaXtumXtCArIOeJqeWTgSArIOWQjOaJueasoeWGheW6j+S9jSlg4oCU4oCUXCLlkIzmibnmrKHlhoXluo/kvY1cIui/meS4quS/oeaBryoq57uT5p6E5LiK5Y+q5pyJXG4gKiDlkIzml7bnnIvliLBcIui/meS4gOaJuemHjOeahOWFtuS9meiusOW9lVwi5omN566X5b6X5Ye65p2lKirvvIzljZXorrDlvZXnrb7lkI1cbiAqIGAocmVjb3JkKSA9PiBzdHJpbmdgIOWBmuS4jeWIsO+8jOWboOatpOW/hemhu+eUqOaJueWkhOeQhueJiOacrOOAglxuICpcbiAqICMjIOecn+WunuWtmOaho+Wunua1i+eahOS4pOS4queZvuWIhuavlO+8iOS4jeimgea3t+eUqO+8iVxuICpcbiAqIGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCp+S4gOWvuSAzMzcxIOadoeecn+WunuiusOW9leaMiVxuICogYCjljaHmsaAsIOaXtumXtCwg54mp5ZOBKWAg5YiG57uE57uf6K6h5Ye65Lik5Liq5LiN5ZCM5ZCr5LmJ55qE55m+5YiG5q+U77yM6KGM5paH5pe25b+F6aG75YiG5riF5qWaXG4gKiDmjIfnmoTmmK/lk6rkuIDkuKrvvJpcbiAqIC0gKiozMi42MCXvvIgxMDk5LzMzNzHvvIkqKuKAlOKAlGtleSDnmoTmraPnoa7mgKcqKuS+nei1luW6j+S9jSoq55qE6K6w5b2V5q+U5L6L77yI56Kw5pKe57uEXG4gKiAgIOWFqOmDqOaIkOWRmO+8mue7hOWGheWPquimgeaciSDiiaUyIOadoeiusOW9le+8jOaVtOe7hOmDveeul+WcqOWGhe+8jOWboOS4uue7hOWGheS7u+S9leS4gOadoeeahCBrZXlcbiAqICAg5piv5ZCm5q2j56Gu6YO95Y+W5Yaz5LqO5bqP5L2N566X5b6X5a+55LiN5a+577yJ44CCXG4gKiAtICoqMTcuNTMl77yINTkxLzMzNzHvvIkqKuKAlOKAlOS4jeeUqOW6j+S9jeOAgeWPquaMiSBgKOWNoeaxoCwg5pe26Ze0LCDnianlk4EpYCDkuInlhYPnu4TnrpdcbiAqICAga2V5IOaXtu+8jOS8muiiqyBgSU5TRVJUIE9SIElHTk9SRWAgKirpnZnpu5jkuKLlvIMqKueahOiusOW9leavlOS+i++8iOavj+S4queisOaSnue7hOmHjFxuICogICBcIuaKouWIsFwi5LiJ5YWD57uEIGtleSDnmoTpgqPkuIDmnaHog73mtLvkuIvmnaXvvIznu4TlhoXlhbbkvZnmiJDlkZjlhajpg6jmkp7plK7kuKLlpLHvvInjgIJcbiAqXG4gKiDnorDmkp7nu4TlhbEgNTA4IOe7hOOAgjUwOCDkuKrnorDmkp7nu4TlhoUqKumAkOWtl+auteWujOWFqOebuOWQjCoq77yI5ZCM5LiA5LiqIGAo5Y2h5rGgLCDnp5IpYFxuICog5YaF55qE5Y2B6L+e5om55qyh5aSp54S25aaC5q2k77yJ4oCU4oCU6bij5r2uIEFQSSDkuI3liIbpobXjgIHkuIDmrKHov5Tlm57mlbTmsaDlhajph4/vvIzov5nmmK/mnKzmlofku7ZcbiAqIOS4pOS4quiuvuiuoemavueCue+8iOaWueWQkeOAgeW6j+S9jeWuieWFqOaAp++8ieWUr+S4gOeahOWuuemUmeadpea6kO+8jOS4i+mdoumAkOS4gOivtOaYjuOAglxuICpcbiAqICMjIOiuvuiuoemavueCueS4gO+8muaVsOe7hOaWueWQkeS4jeWPr+S/oe+8jOW/hemhu+W9kuS4gOWMllxuICpcbiAqIOWPguiAg+WunueOsCBgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYCDph4wgYGFwaURhdGEuRGF0YS5SZXZlcnNlKClgXG4gKiDor4Hlrp7vvJpBUEkg5ZON5bqU5pys6Lqr5pivKirlgJLluo8qKu+8iOacgOaWsOeahOiusOW9leaOkuacgOWJjemdou+8ie+8jOWPguiAg+WunueOsOaLv+WIsOWTjeW6lOWQjlxuICog5pW05L2T5Y+N6L2s5LiA5qyh5omN5L2/55So44CCYGV4dHJhY3RMaXN0YO+8iOingSBgLi9tYW5pZmVzdC50c2DvvInkuI3mlLnlj5jmlbDnu4Tpobrluo/vvIxcbiAqIOWOn+agt+aKiui/meS4quWAkuW6j+aVsOe7hOS6pOe7mSBgZmllbGRzLmV4dHJhY3RSZWNvcmRg77yM5YaN5Lqk57uZ5pys5paH5Lu255qEXG4gKiBgZGVyaXZlUmVjb3JkS2V5c2DigJTigJTkuZ/lsLHmmK/or7TvvIzmnKwgaG9vayDmi7/liLDnmoTorrDlvZXpobrluo8qKue7p+aJv+iHqiBBUEkg55qEXG4gKiDnnJ/lrp7ov5Tlm57pobrluo/vvIzmlrnlkJHkuI3nlLHmj5Lku7boh6rlt7HmjqfliLYqKuOAglxuICpcbiAqIOiLpeW6j+S9jeebtOaOpeaMiei+k+WFpeaVsOe7hOS4i+agh+iuoeeul++8jOiAjOS4pOasoemHh+mbhuS5i+mXtOaVsOe7hOaWueWQkeWPkeeUn+WPmOWMlu+8iOS+i+WmguacquadpVxuICog5pyJ5Luj56CB5ZyoIGBleHRyYWN0TGlzdGAg5LiO5pysIGhvb2sg5LmL6Ze05o+S5YWl5LqG5LiA5qyh5Y+N6L2s44CB5oiWIEFQSSDmnKzouqvnmoTmjpLluo9cbiAqIOe6puWumuWPkeeUn+WPmOWMlu+8ie+8jOWQjOS4gOaJueiusOW9leS8mueul+WHuuS4jeWQjOeahOW6j+S9je+8jGByZWNvcmRfa2V5YCDlsLHkvJrmvILnp7tcbiAqIOKAlOKAlOi/meato+aYryBgUGx1Z2luSG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5bmC562J5oCn6KaB5rGC77yIXCLlkIzkuIDmnaHlrp7pmYXorrDlvZXvvIxcbiAqIOS7u+aEj+aXtumXtOS7u+aEj+asoemHh+mbhumDveW/hemhu+S6p+WHuuebuOWQjOeahCBrZXlcIu+8ieS8muiiq+aJk+egtOeahOWcsOaWueOAglxuICpcbiAqICoq6Kej5Yaz5pa55qGI77ya5pi+5byP5b2S5LiA5YyW77yM5LiN5YGH6K6+5pa55ZCR5LiN5Y+Y44CCKiog5q+U6L6D5pWw57uE6aaW5bC+5Lik5p2h6K6w5b2V55qE5pe26Ze077yMXG4gKiDoi6XpppYgPiDlsL7vvIjlgJLluo/vvInvvIzlhYjmiormlbTkuKrmlbDnu4Tlj43ovazmiJBcIuaXp+KGkuaWsFwi55qE5q2j5bqP5YaN6K6h566X5bqP5L2N77yb6Iul6aaWIDw9XG4gKiDlsL7vvIjlt7Lnu4/mmK/mraPluo/vvIzmiJbmlbDnu4Tplb/luqYgPD0gMSDml6Dms5XliKTmlq3mlrnlkJHvvInvvIzmjInljp/moLflpITnkIbjgILov5nkuKrlvZLkuIDljJZcbiAqIOS5i+aJgOS7peato+ehruOAgeS4lOS4jemcgOimgeWvuVwi57uE5YaF6aG65bqP5piv5ZCm5Lmf6KKr5q2j56Gu6L+Y5Y6fXCLlj6bkvZzor4HmmI7vvJpBUEkg5ZON5bqU5piv5a+5XG4gKiAqKuaVtOS4quaVsOe7hCoq5YGa5LiA5qyh5Y2V5LiA5pa55ZCR55qE5o6S5bqP77yI5LiN5pivXCLnu4Tpl7TlgJLluo/jgIHnu4TlhoXlj6bmnInni6znq4vpobrluo9cIu+8ie+8jFxuICogYGFwaURhdGEuRGF0YS5SZXZlcnNlKClgIOivgeWunuWPguiAg+WunueOsOWkhOeQhueahOaYr+WvueaVtOS4quaVsOe7hOeahOaVtOS9k+WPjei9rOKAlOKAlFxuICog5pW05L2T5Y+N6L2s5piv6Ieq6Lqr55qE6YCG5pON5L2c77yM5q+U6L6D6aaW5bC+5Yik5pat5pa55ZCR5ZCO5oyJ6ZyA5pW05L2T5Y+N6L2s5LiA5qyh77yM5b6X5Yiw55qE5q2j5bqPXG4gKiDmlbDnu4TkuI5cIkFQSSDkuIDlvIDlp4vlsLHov5Tlm57mraPluo9cIuaXtumAkOS9jee9ruWujOWFqOS4gOiHtO+8jOWMheaLrOe7hOWGheaIkOWRmOeahOebuOWvuemhuuW6j+OAglxuICpcbiAqIOW9kuS4gOWMluS5i+WQjuWGjeaMie+8iOeOsOW3suS/neivgeaYr+ato+W6j+eahO+8ieaVsOe7hOS4i+agh+mhuuW6j+e7meavj+S4qiBgKGJhbm5lcklkLCB0aW1lKWBcbiAqIOWIhue7hOWGheeahOiusOW9lee8luWPt++8jOacgOWQjuaKiueul+WHuueahCBrZXkg5YaZ5ZueKirljp/lp4vovpPlhaXkuIvmoIcqKuWvueW6lOeahOS9jee9ruKAlOKAlFxuICog6L+U5Zue5YC85b+F6aG75LiO6L6T5YWlIGByZWNvcmRzYCDpgJDkvY3nva7lr7nlupTvvIzov5nmmK8gYFBsdWdpbkhvb2tzLmRlcml2ZVJlY29yZEtleXNgXG4gKiDnmoTlpZHnuqbvvIhcIui/lOWbnuWAvOW/hemhu+S4jui+k+WFpeetiemVv+OAgeaMiei+k+WFpemhuuW6j+S4gOS4gOWvueW6lFwi77yJ44CCXG4gKlxuICogIyMg6K6+6K6h6Zq+54K55LqM77yaQVBJIOWTjeW6lOe6v+agvOW8j+acque7j+aKk+WMhemqjOivge+8jGtleSDkuI3og73nm7TmjqXlk4jluIzljp/lp4vlrZfnrKbkuLJcbiAqXG4gKiDlj4LogIPlrp7njrDlj43luo/liJfljJYgQVBJIOWTjeW6lOaXtu+8jGBNb2RlbHMvR2FjaGFEYXRhLmNzYCDnmoQgYFRpbWVgIOWtl+auteaYr+W8ulxuICog57G75Z6LIGBEYXRlVGltZWDigJTigJTnur/moLzlvI/lnKjlj43luo/liJfljJbpgqPkuIDmraXlsLHooqvor63oqIDov5DooYzml7blkIPmjonkuobvvIzmupDnoIHph4znnItcbiAqIOS4jeWHuiBBUEkg5Yiw5bqV5Y+R55qE5pivIGAyMDI0LTA2LTA2VDEwOjIzOjQ4YO+8iElTT++8iei/mOaYr1xuICogYDIwMjQvMDYvMDYgMTA6MjM6NDhg77yI5pac5p2g77yJ6L+Y5piv5Yir55qE5YaZ5rOV77yb5pys5Zyw5a2Y5qGj6YeM5Ye6546w55qEIElTTyDmoLzlvI/mmK9cbiAqIE5ld3RvbnNvZnQg5bqP5YiX5YyWIGBEYXRlVGltZWAg55qE6buY6K6k5Lqn54mp77yM5LiN5Luj6KGoIEFQSSDlk43lupTmnKzouqvnmoTnur/moLzlvI/vvJtcbiAqIGBEYXRlRm9ybWF0U3RyaW5nID0gXCJ5eXl5L01NL2RkIGhoOm1tOnNzXCJgIOWPquWcqOWPjeW6j+WIl+WMlui3r+W+hOS4iueUn+aViOeahOivgeaNrlxuICog5b6I5byx77yM5LiN6Laz5Lul5a6a6K6677yb5pys5LuT5bqT5rKh5pyJ6bij5r2uIEFQSSDnmoTnnJ/lrp7mipPljIXmoLfmnKzog73pqozor4HjgIJcbiAqXG4gKiDoi6UgYGRlcml2ZVJlY29yZEtleXNgIOebtOaOpeaKiiBgcmVjb3JkLnRpbWVgIOWOn+Wni+Wtl+espuS4suaLvOi/m+WTiOW4jOi+k+WFpe+8jOS4gOaXplxuICog57q/5qC85byP54yc6ZSZ4oCU4oCU5oiW6ICF5pel5ZCOIEFQSSDmjaLkuobkuKrliIbpmpTnrKbigJTigJTmiYDmnIkga2V5IOmDveS8muS4jumihOacn+S4jeWQjO+8muS4jeS8mlxuICog5oql6ZSZ77yM5Y+q5Lya6Z2Z6buY6YeN5aSN5YWl5bqT77yM5oiW6ICF6K6p5bey5YWl5bqT55qEIGtleSDkuI7mlrDph4fpm4bnrpflh7rnmoQga2V5IOWvueS4jeS4iu+8jFxuICog5LiOIEhvWW8uR2FjaGEg5Zug5Li6IGByZWNvcmRfa2V5YCDorr7orqHkuI3liLDkvY3ku5jlh7rov4fkuIDmrKHmlbTooajph43lu7rov4Hnp7vmmK/lkIzkuIDnsbtcbiAqIOS7o+S7t+OAglxuICpcbiAqICoq6Kej5Yaz5pa55qGI77ya5YWI5oqKIGB0aW1lYCDop4TojIPljJbmiJDkuI7nur/moLzlvI/ml6DlhbPnmoTlvaLlvI/vvIzlho3lj4LkuI7lk4jluIwqKu+8jOingeS4i+aWuVxuICogYG5vcm1hbGl6ZVRpbWVGb3JLZXlg44CCXG4gKi9cbmltcG9ydCB0eXBlIHsgUGx1Z2luSG9va3MsIFVuaWZpZWRSZWNvcmRGaWVsZHMgfSBmcm9tIFwiZ3MtcGx1Z2luLWtpdFwiO1xuXG4vKipcbiAqIOaKiiBBUEkg5ZON5bqU55qEIGB0aW1lYCDlrZfmrrXop4TojIPljJbmiJDkuI7nur/moLzlvI/ml6DlhbPjgIHlj6/nm7TmjqXmjInlrZfnrKbkuLLmr5TovoPlpKflsI/nmoRcbiAqIOW9ouW8j++8iGBZWVlZTU1EREhIbW1zc2DvvIwxNCDkvY3nuq/mlbDlrZfvvInjgIJcbiAqXG4gKiBgMjAyNC0wNi0wNlQxMDoyMzo0OGAg5LiOIGAyMDI0LzA2LzA2IDEwOjIzOjQ4YCDlvZLkuIDlkI7pg73mmK9cbiAqIGBcIjIwMjQwNjA2MTAyMzQ4XCJg4oCU4oCU55So5q2j5YiZ5ouG5Ye65bm0L+aciC/ml6Uv5pe2L+WIhi/np5Llha3kuKrmlbDlrZfliIbph4/lho3mi7zmjqXvvIxcbiAqIOWIhumalOespuacrOi6q++8iGAtYC9gL2AvYFRgL+epuuagvO+8ieiiq+ato+WImeebtOaOpeWQg+aOieOAgeS4jeW9seWTjeW9kuS4gOWMlue7k+aenOOAglxuICpcbiAqIOKaoO+4jyAqKuS4jeeUqCBgbmV3IERhdGUoLi4uKWAg6Kej5p6QKirvvJpgRGF0ZWAg5p6E6YCg5Ye95pWw5a+55LiN5bim5pe25Yy65ZCO57yA55qE5a2X56ym5LiyXG4gKiDmjIkq6L+Q6KGM546v5aKD5pys5Zyw5pe25Yy6Kuino+mHiu+8jOWQjOS4gOS4quWtl+espuS4suWcqOS4jeWQjOacuuWZqC/kuI3lkIzml7bljLrkuIrot5Hlh7rnmoRcbiAqIGBEYXRlYCDlr7nosaHku6PooajnmoTnu53lr7nml7bliLvkuI3lkIzigJTigJTov5nkuI5cIue6r+WHveaVsOOAgee7k+aenOWPquWPluWGs+S6jui+k+WFpVwi6L+Z5p2h56GsXG4gKiDnuqbmnZ/nm7TmjqXlhrLnqoHvvIhgUGx1Z2luSG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5b+F6aG75piv57qv5Ye95pWw77yMVFMg6L+Q6KGM546v5aKDXG4gKiDniannkIbkuIrkuZ/kuI3mj5Dkvpvog73mm7/ku6MgYERhdGVgIOacrOWcsOaXtuWMuuihjOS4uueahOaXtuWMuuaVsOaNruW6k++8ieOAguaUueeUqOato+WImeebtOaOpeaLhlxuICog5pWw5a2X5YiG6YeP77yM5LiN57uP6L+HIGBEYXRlYO+8jOinhOiMg+WMlue7k+aenOS4jui/kOihjOeOr+Wig+aXoOWFs+OAglxuICpcbiAqIOKaoO+4jyAqKuaXoOazleivhuWIq+eahOagvOW8j+W/hemhu+aKpemUme+8jOS4jeiDvemdmem7mOWbnuiQveWIsOWOn+Wni+Wtl+espuS4sioq77ya6Z2Z6buY5Zue6JC9562J5LqOXG4gKiBcIuWFiOW9kuS4gOWMluWGjeWTiOW4jFwi6L+Z5bGC5L+d5oqk5a6M5YWo5LiN5a2Y5Zyo4oCU4oCU5pys6aG555uu5bey57uP5aSa5qyh5oqT5YiwXCLnnIvotbfmnaXmnInpmLLmiqTjgIFcbiAqIOWunumZheS7gOS5iOmDveayoeWBmlwi6L+Z5LiA57G75aSx5pWI5qih5byP77yM6L+Z6YeM5LiN6IO96YeN6LmI44CCXG4gKlxuICog55uu5YmN5Y+q6K6k5Lik56eN5bey55+l5YCZ6YCJ5qC85byP77yISVNPIOeahCBgLWAvYFRgIOWIhumalOOAgeWPguiAg+WunueOsOaal+ekuueahCBgL2Av56m65qC8XG4gKiDliIbpmpTvvInvvJvoi6XmnKrmnaXnnJ/lrp7mipPljIXlj5HnjrDnrKzkuInnp43moLzlvI/vvIzov5nph4zpnIDopoHlkIzmraXmianlsZXmraPliJnvvIzogIzkuI3mmK/mlL7lrr1cbiAqIOWIsFwi6ZqP5L6/5LuA5LmI6YO95pS2XCLjgIJcbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplVGltZUZvcktleSh0aW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBtYXRjaCA9IC9eKFxcZHs0fSlbLS9dKFxcZHsyfSlbLS9dKFxcZHsyfSlbVCBdKFxcZHsyfSk6KFxcZHsyfSk6KFxcZHsyfSkkLy5leGVjKHRpbWUpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYOm4o+a9riBkZXJpdmVSZWNvcmRLZXlz77ya5peg5rOV6K+G5Yir55qE5pe26Ze05qC85byPIFwiJHt0aW1lfVwi4oCU4oCU57q/5qC85byP5pyq57uP5oqT5YyF6aqM6K+B77yM5ouS57ud5Zyo54yc5rWL55qE5qC85byP5LiK6K6h566XIHJlY29yZF9rZXlgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgWywgeWVhciwgbW9udGgsIGRheSwgaG91ciwgbWludXRlLCBzZWNvbmRdID0gbWF0Y2g7XG4gIHJldHVybiBgJHt5ZWFyfSR7bW9udGh9JHtkYXl9JHtob3VyfSR7bWludXRlfSR7c2Vjb25kfWA7XG59XG5cbi8qKlxuICogRk5WLTFhIDMyIOS9jeWTiOW4jO+8jOe6r+S9jei/kOeul+WunueOsO+8jOS4jeS+nei1luS7u+S9lSBOb2RlL1dlYiDliqDlr4YgQVBJ4oCU4oCUVFMg5L6n6L+Q6KGMXG4gKiDnjq/looPniannkIbkuIrkuI3mj5DkvpsgYGNyeXB0b2DvvIzmj5Lku7bku6PnoIHlj6rog73nlKjor63oqIDlhoXnva7og73lipvvvIhgY2hhckNvZGVBdGAvXG4gKiBgTWF0aC5pbXVsYC/np7vkvY3ov5DnrpfvvIxFUzIwMjIg5qCH5YeGIEpT77yM5Lu75L2V6YG15b6q6KeE6IyD55qE5byV5pOO6YO96IO96LeR77yM5YyF5ous5a6/5Li7XG4gKiDlhoXltYznmoQgUXVpY2tKU++8ieOAglxuICpcbiAqIOWPquWvuSBBU0NJSSDlrZfnrKbmraPnoa7vvJrmnKzmlofku7bllK/kuIDnmoTosIPnlKjngrnkvKDlhaXnmoTmmK9cbiAqIGBKU09OLnN0cmluZ2lmeShbYmFubmVySWQsIG5vcm1hbGl6ZWRUaW1lLCBpdGVtSWQsIHNlcUluR3JvdXBdKWDvvIzlm5vkuKpcbiAqIOWIhumHj+WIhuWIq+aYr+e6r+aVsOWtl+Wtl+espuS4su+8iFBvb2xUeXBlIGlk44CBYG5vcm1hbGl6ZVRpbWVGb3JLZXlgIOeahOi+k+WHuuOAgVxuICogYHJlc291cmNlSWRgIOi9rOeahOWtl+espuS4suOAgeaJueasoeWGheW6j+S9je+8ieWKoCBKU09OIOacrOi6q+eahOagh+eCue+8jOmAkOWtl+espumDveWcqFxuICogQVNDSUkg6IyD5Zu05YaF77yMYGNoYXJDb2RlQXRgIOS4juWtl+iKguWAvOS4gOS4gOWvueW6lO+8jOS4jemcgOimgeWkhOeQhuWkmuWtl+iKguWtl+espuOAglxuICovXG5mdW5jdGlvbiBmbnYxYTMyKGlucHV0OiBzdHJpbmcsIG9mZnNldEJhc2lzOiBudW1iZXIpOiBzdHJpbmcge1xuICBsZXQgaGFzaCA9IG9mZnNldEJhc2lzID4+PiAwO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGlucHV0Lmxlbmd0aDsgaSArPSAxKSB7XG4gICAgaGFzaCBePSBpbnB1dC5jaGFyQ29kZUF0KGkpO1xuICAgIGhhc2ggPSBNYXRoLmltdWwoaGFzaCwgMHgwMTAwMDE5MykgPj4+IDA7XG4gIH1cbiAgcmV0dXJuIGhhc2gudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDgsIFwiMFwiKTtcbn1cblxuLyoqIOagh+WHhiBGTlYtMWEgMzIg5L2N5YGP56e75Z+65YeG44CCICovXG5jb25zdCBGTlZfT0ZGU0VUX0JBU0lTX0EgPSAweDgxMWM5ZGM1O1xuLyoqXG4gKiDnrKzkuozkuKrlgY/np7vln7rlh4bvvIzlj6ropoHmsYLkuI4gQSDkuI3lkIzigJTigJTnlKjmnaXmiorkuKTmrKHni6znq4vnmoQgMzIg5L2N5ZOI5biM5ou85oiQ5LiA5LiqXG4gKiAxNiDkvY3ljYHlha3ov5vliLbvvIg2NCDkvY3vvInnmoTlpI3lkIgga2V577yM6ZmN5L2O5Y2V54us5LiA5LiqIDMyIOS9jeWTiOW4jOWcqOWHoOWNg+adoeiusOW9lVxuICog6KeE5qih5LiL55qE55Sf5pel56Kw5pKe5qaC546H77yIYHNxcnQoMl4zMikg4omIIDY1NTM2YO+8jOS4gOS4qui0puWPt+eahOiusOW9leaVsOmHj+e6p+W3sue7j1xuICog5aSf5LiN5LiK5pS+5b+D5Y+q55SoIDMyIOS9je+8ieOAguWPluWAvOacrOi6q+ayoeacieeJueauiuWQq+S5ie+8jOWPquimgeaxguaYr+S4gOS4quS4jiBBIOS4jeWQjOeahFxuICog5Zu65a6a5bi46YeP44CCXG4gKi9cbmNvbnN0IEZOVl9PRkZTRVRfQkFTSVNfQiA9IDB4OWUzNzc5Yjk7XG5cbi8qKlxuICog6K6h566X5Y2V5p2h6K6w5b2V55qEIGByZWNvcmRfa2V5YOOAglxuICpcbiAqIOeUqCBgSlNPTi5zdHJpbmdpZnlgIOaKiuWbm+S4quWIhumHj+W6j+WIl+WMluaIkOS4gOS4quaVsOe7hOWtl+espuS4su+8jOiAjOS4jeaYr+eUqOWIhumalOesplxuICog77yI5aaCIGA6YO+8ieaJi+W3peaLvOaOpeKAlOKAlGBub3JtYWxpemVkVGltZWAg5YaF6YOo5YWo5piv5pWw5a2X5rKh5pyJ5q2n5LmJ77yM5L2GIEpTT04g55qEXG4gKiDovazkuYnop4TliJnog73kv53or4FcIuS4jeWQjOeahOi+k+WFpeWFg+e7hOS4jeS8muaLvOWHuuWQjOS4gOS4quWtl+espuS4slwi6L+Z5p2h5oCn6LSo5Zyo5Lu75L2V5pyq5p2lXG4gKiDliIbph4/nsbvlnovlj5jljJbml7bkvp3nhLbmiJDnq4vvvIzmr5TmiYvlt6XmjJHkuIDkuKpcIueci+i1t+adpeS4jeS8muWHuueOsOWcqOWtl+autemHjFwi55qE5YiG6ZqU56ymXG4gKiDmm7Tlj6/pnaDjgIJcbiAqL1xuZnVuY3Rpb24gaGFzaFJlY29yZEtleShiYW5uZXJJZDogc3RyaW5nLCBub3JtYWxpemVkVGltZTogc3RyaW5nLCBpdGVtSWQ6IHN0cmluZywgc2VxSW5Hcm91cDogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgY2Fub25pY2FsID0gSlNPTi5zdHJpbmdpZnkoW2Jhbm5lcklkLCBub3JtYWxpemVkVGltZSwgaXRlbUlkLCBzZXFJbkdyb3VwXSk7XG4gIHJldHVybiBgJHtmbnYxYTMyKGNhbm9uaWNhbCwgRk5WX09GRlNFVF9CQVNJU19BKX0ke2ZudjFhMzIoY2Fub25pY2FsLCBGTlZfT0ZGU0VUX0JBU0lTX0IpfWA7XG59XG5cbmV4cG9ydCBjb25zdCBob29rczogUGx1Z2luSG9va3MgPSB7XG4gIGRlcml2ZVJlY29yZEtleXM6IChyZWNvcmRzOiBVbmlmaWVkUmVjb3JkRmllbGRzW10pOiBzdHJpbmdbXSA9PiB7XG4gICAgY29uc3QgdG90YWwgPSByZWNvcmRzLmxlbmd0aDtcbiAgICBpZiAodG90YWwgPT09IDApIHJldHVybiBbXTtcblxuICAgIC8vIOaXtumXtOe6v+agvOW8j+aXoOWFs++8muWFiOe7n+S4gOinhOiMg+WMlu+8jOWHuueOsOaXoOazleivhuWIq+eahOagvOW8j+eri+WIu+aKpemUme+8iOingVxuICAgIC8vIG5vcm1hbGl6ZVRpbWVGb3JLZXkg5paH5qGj77yJ77yM5LiN5YWB6K645p+Q5LiA5p2h6K6w5b2V5oKE5oKE55So5Y6f5aeL5a2X56ym5Liy5Y+C5LiO5ZOI5biM44CCXG4gICAgY29uc3Qgbm9ybWFsaXplZFRpbWVzID0gcmVjb3Jkcy5tYXAoKHJlY29yZCkgPT4gbm9ybWFsaXplVGltZUZvcktleShyZWNvcmQudGltZSkpO1xuXG4gICAgLy8g5pa55ZCR5b2S5LiA5YyW77ya5q+U6L6D6aaW5bC+5Lik5p2h6K6w5b2V55qE6KeE6IyD5YyW5pe26Ze044CC6aaWID4g5bC+6K+05piO5pWw57uE5piv5YCS5bqPXG4gICAgLy8g77yIQVBJIOecn+Wunui/lOWbnueahOmhuuW6j++8jOWPguiAg+WunueOsOeUqCBhcGlEYXRhLkRhdGEuUmV2ZXJzZSgpIOWkhOeQhu+8ie+8jOmcgOimgVxuICAgIC8vIOaMiVwi5Y6f5aeL6L6T5YWl5LiL5qCHXCLliLBcIuato+W6j+mBjeWOhumhuuW6j1wi5bu656uL5LiA5Lu95pig5bCE77yb5ZCm5YiZ77yI5bey57uP5piv5q2j5bqP77yM5oiWXG4gICAgLy8g6ZW/5bqmIDw9IDEg5peg5rOV5Yik5pat5pa55ZCR77yJ55u05o6l5oyJ5Y6f5aeL5LiL5qCH6YGN5Y6G44CC6KeB5paH5Lu25aS06YOoXCLorr7orqHpmr7ngrnkuIBcIuOAglxuICAgIC8vXG4gICAgLy8g5LiL5qCH6K6/6Zeu5ZyoIG5vVW5jaGVja2VkSW5kZXhlZEFjY2VzcyDkuIvnsbvlnovmmK8gYHN0cmluZyB8IHVuZGVmaW5lZGDigJTigJRcbiAgICAvLyDov5nph4zkuI3nlKjpnZ7nqbrmlq3oqIAv57G75Z6L6L2s5o2i5YGH6KOFXCLogq/lrprkuI3kvJrplJlcIu+8jOiAjOaYr+aYvuW8j+WIpOepuuWQjuaKm+WGhemDqOmUmeivr1xuICAgIC8vIO+8iOS4jiBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L3Rlc3RraXQvaW5kZXgudHMg5aSE55CG5ZCM57G75oOF5b2i55qE5YaZ5rOV5LiA6Ie077yJ77yMXG4gICAgLy8g55CG6K665LiK5LiN5Lya6Kem5Y+R77yaZmlyc3RUaW1lL2xhc3RUaW1lIOeahOS4i+agh+aBkuWcqCBbMCwgdG90YWwpIOWGheOAglxuICAgIGNvbnN0IGZpcnN0VGltZSA9IG5vcm1hbGl6ZWRUaW1lc1swXTtcbiAgICBjb25zdCBsYXN0VGltZSA9IG5vcm1hbGl6ZWRUaW1lc1t0b3RhbCAtIDFdO1xuICAgIGlmIChmaXJzdFRpbWUgPT09IHVuZGVmaW5lZCB8fCBsYXN0VGltZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCLpuKPmva4gZGVyaXZlUmVjb3JkS2V5cyDlhoXpg6jplJnor6/vvJrml6Dms5Xlj5bliLDpppYv5bC+6K6w5b2V55qE6KeE6IyD5YyW5pe26Ze0XCIpO1xuICAgIH1cbiAgICBjb25zdCBpc0Rlc2NlbmRpbmcgPSB0b3RhbCA+IDEgJiYgZmlyc3RUaW1lID4gbGFzdFRpbWU7XG5cbiAgICBjb25zdCBhc2NlbmRpbmdPcmRlcjogbnVtYmVyW10gPSBuZXcgQXJyYXkodG90YWwpO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG90YWw7IGkgKz0gMSkge1xuICAgICAgYXNjZW5kaW5nT3JkZXJbaV0gPSBpc0Rlc2NlbmRpbmcgPyB0b3RhbCAtIDEgLSBpIDogaTtcbiAgICB9XG5cbiAgICAvLyDmjInvvIjlt7Lkv53or4HmraPluo/nmoTvvInpgY3ljobpobrluo/vvIzlr7nmr4/kuKogKGJhbm5lcklkLCDop4TojIPljJbml7bpl7QpIOWIhue7hOWGheeahFxuICAgIC8vIOiusOW9lee8luWPt++8jOe8luWPt+WNs1wi5om55qyh5YaF5bqP5L2NXCLvvJvnrpflh7rnmoQga2V5IOWGmeWbnuWOn+Wni+i+k+WFpeS4i+agh+WvueW6lOeahOS9jee9ruOAglxuICAgIGNvbnN0IHNlcUJ5R3JvdXAgPSBuZXcgTWFwPHN0cmluZywgbnVtYmVyPigpO1xuICAgIGNvbnN0IGtleXMgPSBuZXcgQXJyYXk8c3RyaW5nPih0b3RhbCk7XG4gICAgZm9yIChjb25zdCBvcmlnaW5hbEluZGV4IG9mIGFzY2VuZGluZ09yZGVyKSB7XG4gICAgICBjb25zdCByZWNvcmQgPSByZWNvcmRzW29yaWdpbmFsSW5kZXhdO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZFRpbWUgPSBub3JtYWxpemVkVGltZXNbb3JpZ2luYWxJbmRleF07XG4gICAgICBpZiAocmVjb3JkID09PSB1bmRlZmluZWQgfHwgbm9ybWFsaXplZFRpbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAvLyDkuI3lupTlj5HnlJ/vvJpvcmlnaW5hbEluZGV4IOeUseS4iumdoueahOW+queOr+eUn+aIkO+8jOWPluWAvOiMg+WbtOaBkuWcqCBbMCwgdG90YWwp44CCXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihg6bij5r2uIGRlcml2ZVJlY29yZEtleXMg5YaF6YOo6ZSZ6K+v77ya5LiL5qCHICR7b3JpZ2luYWxJbmRleH0g5aSE55qE6K6w5b2V5oiW6KeE6IyD5YyW5pe26Ze057y65aSxYCk7XG4gICAgICB9XG4gICAgICAvLyDimIUg5YiG57uE6ZSu5b+F6aG75YyF5ZCrIGl0ZW1JZO+8jOS4jeiDveWPquaMiSAoYmFubmVySWQsIOaXtumXtCkg5YiG57uE44CCXG4gICAgICAvL1xuICAgICAgLy8g5bqP5L2N5a2Y5Zyo55qE5ZSv5LiA55uu55qE77yM5piv5Yy65YiGKirpgJDlrZfmrrXlrozlhajnm7jlkIzjgIHlkKbliJnml6Dms5XljLrliIYqKueahOiusOW9leOAglxuICAgICAgLy8g55yf5a6e5a2Y5qGj5a6e5rWL77yIYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKn5LiA77yJ6YeM5ZCM56eSXG4gICAgICAvLyDnorDmkp7nu4TlhbEgNTA4IOe7hOOAgee7hOWGheiusOW9lemAkOWtl+auteWFqOetie+8m+ivpeWuoeiuoSDCpzEuNyDikaIg57uZ5Ye655qE5a6J5YWo5oCn6K666K+BXG4gICAgICAvLyDkuZ/mraPmmK/jgIznu4TlhoXorrDlvZXpgJDlrZfmrrXlrozlhajnm7jlkIwg4oaSIOS6pOaNouWug+S7rOS6p+WHuueahCBrZXkg5aSa6YeN6ZuG5LiN5Y+Y44CN44CCXG4gICAgICAvLyDov5nmnaHorrror4HmiJDnq4vnmoTliY3mj5DvvIzmmK/liIbnu4TmjIkqKuWFqOetieWtl+autSoq5YiS5YiG44CCXG4gICAgICAvL1xuICAgICAgLy8g6Iul5YiG57uE6ZSu5ryP5o6JIGl0ZW1JZO+8jOS4gOasoeWNgei/nu+8iDEwIOadoeWQjOenkuOAgeS9hueJqeWTgeWQhOS4jeebuOWQjOeahOiusOW9le+8ieS8muiiq1xuICAgICAgLy8g5aGe6L+b5ZCM5LiA57uE5ou/5Yiw5bqP5L2NIDB+Oe+8jOS6juaYr+avj+adoeiusOW9leeahCBrZXkg6YO95Y+W5Yaz5LqO5a6D5Zyo5pWw57uE6YeM55qE5L2N572u44CCXG4gICAgICAvLyDlkI7mnpzlt7LlnKjlhajph4/nnJ/lrp7mlbDmja7vvIgzMzcxIOadoe+8ieS4iuWunua1i++8mlxuICAgICAgLy8gICAtIOaWueWQkei/neS+iyAxMCDmnaHigJTigJRQb29sVHlwZT0xMiDmlbTmibnlhbHnlKjlkIzkuIDkuKrml7bpl7TmiLPvvIzpppblsL7nm7jnrYnvvIxcbiAgICAgIC8vICAgICDkuIrpnaLpgqPlpZdcIuavlOi+g+mmluWwvuWIpOaWueWQkVwi55qE6YC76L6R5aSx5pWI77yM5q2j5bqPL+WAkuW6j+WWguWFpeS6p+WHuuS4pOWllyBrZXnvvJtcbiAgICAgIC8vICAgLSAqKuWinumVv+eos+WumuaAp+i/neS+iyAyMCDmnaEqKuKAlOKAlOi/meadoeaJjeecn+ato+S8muS8pOWIsOeUqOaIt++8muaVtOaxoOWFqOmHj+aLieWPluS4i++8jFxuICAgICAgLy8gICAgIOWQjuS4gOasoemHh+mbhuW/heeEtuavlOWJjeS4gOasoeiusOW9leabtOWkmu+8jOS4gOaXpuiusOW9leWPmOWkmuiuqeaWueWQkeWIpOWumuS7jlwi5Yik5LiN5Ye6XCJcbiAgICAgIC8vICAgICDnv7vovazmiJBcIuWIpOW+l+WHulwi77yM5pep5YWI6YKj5om56K6w5b2V55qE5bqP5L2N5Lya5pW05L2T5Y+N6L2s44CBa2V5IOWFqOWPmO+8jOS6juaYr+iiq1xuICAgICAgLy8gICAgIOW9k+aIkOaWsOiusOW9lSoq6YeN5aSN5YWl5bqTKirjgIJcbiAgICAgIC8vIOaKiiBpdGVtSWQg5bm26L+b5YiG57uE6ZSu5ZCO77yM5LiK6L+w5Lik6aG55a6e5rWL5YiG5Yir6ZmN5Li6IDIg5LiOIDDvvJvliankuIvpgqMgMiDmnaHnu49cbiAgICAgIC8vIOaguOWvuemDveaYr+OAjOS4juWPpuS4gOadoemAkOWtl+auteWFqOetieOAjeeahOiusOW9leS6kuaNouS6hiBrZXnigJTigJTorrDlvZXmnKzouqvkuI3lj6/ljLrliIbvvIxcbiAgICAgIC8vIOWFqOmDqCA1IOS4qumdnuepuuaxoOeahCBrZXkg5aSa6YeN6ZuG5Z2H5LiA6Ie077yM5Y676YeN57uT5p6c5a6M5YWo562J5Lu344CCXG4gICAgICAvL1xuICAgICAgLy8g5YiG6ZqU56ym55So5pmu6YCa56m65qC85Y2z5Y+v77yaYmFubmVySWQg5piv57qv5pWw5a2XIFBvb2xUeXBlIGlk77yMbm9ybWFsaXplZFRpbWVcbiAgICAgIC8vIOaYryBub3JtYWxpemVUaW1lRm9yS2V5IOS6p+WHuueahCAxNCDkvY3nuq/mlbDlrZflrZfnrKbkuLLvvIxpdGVtSWQg5piv57qv5pWw5a2XXG4gICAgICAvLyByZXNvdXJjZUlk77yM5LiJ6ICF6YO95LiN5Y+v6IO95ZCr56m65qC877yM5LiN5Lya5Ye6546w5ou85o6l5q2n5LmJ44CCXG4gICAgICBjb25zdCBncm91cEtleSA9IGAke3JlY29yZC5iYW5uZXJJZH0gJHtub3JtYWxpemVkVGltZX0gJHtyZWNvcmQuaXRlbUlkfWA7XG4gICAgICBjb25zdCBzZXFJbkdyb3VwID0gc2VxQnlHcm91cC5nZXQoZ3JvdXBLZXkpID8/IDA7XG4gICAgICBzZXFCeUdyb3VwLnNldChncm91cEtleSwgc2VxSW5Hcm91cCArIDEpO1xuICAgICAga2V5c1tvcmlnaW5hbEluZGV4XSA9IGhhc2hSZWNvcmRLZXkocmVjb3JkLmJhbm5lcklkLCBub3JtYWxpemVkVGltZSwgcmVjb3JkLml0ZW1JZCwgc2VxSW5Hcm91cCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGtleXM7XG4gIH0sXG59O1xuIiwiLyoqXG4gKiDpuKPmva7mj5Lku7YgbWFuaWZlc3TjgIJcbiAqXG4gKiDmnKzmlofku7bnlLEgTTItUzEvUzIg55qE57q46Z2i5aGr6KGo5ryU57uD6I2J56i/77yIYGRyaWxscy93dXdhL21hbmlmZXN0LnRzYO+8iei9rOWMluiAjOadpVxuICog4oCU4oCU5ryU57uD6aqM6K+B55qE5pivXCJTMiDmlLnov4fnmoTmj5Lku7blpZHnuqbnsbvlnovmmK/lkKboo4XlvpfkuIvpuKPmva7nmoTnnJ/lrp7lt67lvILngrlcIu+8jOacrOaWh+S7tlxuICog5piv5oqK6aqM6K+B57uT6K666JC95Zyw5oiQ55yf5q2j5o6l5YWlIGBwbHVnaW5zL2luZGV4LnRzYCDnmoTlj6/ov5DooYzmj5Lku7bjgILovazljJbov4fnqIvkuK1cbiAqIOWIoOaOieS6hua8lOe7g+aWh+S7tumHjOWkp+autVwi5Li65LuA5LmI5b2T5pe25aGr5LiN5LiLXCLnmoTov4fnqIvmgKfms6jph4rvvIjpgqPkupvnqbrnmb3lt7Lnu4/ooqtcbiAqIFMyL1MzIOeahOWlkee6puaUueWKqOWhq+W5s++8jOe7p+e7reS/neeVmeS8muivr+WvvOivu+iAheS7peS4uuWtl+auteS7jeeEtue8uuWkse+8ie+8jOWPquS/neeVmeS7jeeEtlxuICog5oiQ56uL55qE6aKG5Z+f55+l6K+G77yb5bey6I635b6X55yf5a6e5Y+C5pWw55qE5a2X5q6177yI6K+35rGCIGJvZHkg5YW35ZCN5Y2g5L2N56ym44CBXG4gKiBgYWxsb3dlZEhvc3RzYOOAgWBzdG9wQ29uZGl0aW9uYO+8ieaMieS4i+aWueazqOmHiumHjOeahOadpea6kOmHjeaWsOagoeWHhuWhq+WGmeOAglxuICpcbiAqIOaVsOaNruadpea6kO+8iOS4jeWHreiuree7g+iusOW/hue8lumAoOWtl+auteWQjS/mlbDlgLzvvInvvJpcbiAqIC0gYGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9XV0dhY2hhRXhwb3J0L1dXR2FjaGFFeHBvcnQvU2VydmljZXMvQ29uZmlnU2VydmljZS5jczoyOS00M2BcbiAqICAg77yIMTMg6aG5IGBQb29sVHlwZWAg6KGo77yM5p6E6YCg5Ye95pWw562+5ZCNIGBHYWNoYVBvb2xJbmZvKHBvb2xUeXBlLCBuYW1lLCBub29iUG9vbCxcbiAqICAgbGV2ZWxGaXZlTWF4RHJhdywgbGV2ZWxGb3VyTWF4RHJhdywgaW5oZXJpdCA9IHRydWUpYO+8jOacrOaWh+S7tuWunueOsOWJjeW3sumAkOihjOaguOWvuea6kOeggeWOn+aWh++8iVxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL1dXR2FjaGFFeHBvcnQvV1dHYWNoYUV4cG9ydC9WaWV3TW9kZWxzL0RpYWxvZ3MvVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYFxuICogICDvvIjml6Xlv5fot6/lvoTmi7zmjqXjgIHlvILmiJbop6Pmt7fmt4blj4LmlbDjgIFxdWVyeSDlj4LmlbAg4oaSIFBPU1QgYm9keSDlrZfmrrXmmKDlsITjgIFcbiAqICAgYGNhcmRQb29sVHlwZWAvYHBsYXllcklkYCDnmoQgQyMg57G75Z6L44CBVXNlci1BZ2VudOOAgeivt+axgiBob3N0IOS6jOmAieS4gOmAu+i+keOAgVxuICogICBgYXBpRGF0YS5EYXRhLlJldmVyc2UoKWAg55qE6LCD55So5L2N572u77yM5pys5paH5Lu25a6e546w5YmN5bey6YCQ6KGM5qC45a+55rqQ56CB5Y6f5paH77yJXG4gKiAtIGBkb2NzL19pbnRlcm5hbC9hdWRpdC9BVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYO+8iDMzNzEg5p2hXG4gKiAgIOecn+WunuWtmOaho+eahOWtl+auteexu+Wei+e7n+iuoeOAgWByZWNvcmRfa2V5YCDnorDmkp7njoflrp7mtYvjgIHkv53lupXpl7TpmpTkuI7pgJDmir3lkb3kuK3njofvvIlcbiAqIC0gYHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvbWFuaWZlc3QudHNg44CBYHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvdHlwZXMvZ2VuZXJhdGVkLnRzYFxuICogICDvvIhTMyDkuYvlkI7nmoTlpZHnuqbnsbvlnovvvJrlhbflkI3ljaDkvY3nrKYgYHt7Y3JlZGVudGlhbC48cXVlcnlQYXJhbT59fWDjgIFcbiAqICAgYFJlcXVlc3RUZW1wbGF0ZS5tZXRob2RgL2BoZWFkZXJzYC9gYm9keWDjgIFgU3RvcENvbmRpdGlvbi5zaW5nbGVSZXF1ZXN0YO+8iVxuICogLSBgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYO+8iGBSZXF1ZXN0VGVtcGxhdGVKc29uYCDkuIrmlrlcbiAqICAgXCLlt7Lnn6XnvLrlj6MgQzhcIiDms6jph4rvvJrlm73pmYXmnI0gaG9zdCDml6Dms5Xku44gYHN2cl9hcmVhYCDmjqjlh7ogVExE77yM5Yi75oSP5LiN6aKE5pS+XG4gKiAgIGAubmV0YO+8m2BzdWJzdGl0dXRlX25hbWVkX2NyZWRlbnRpYWxfcGxhY2Vob2xkZXJzYCDnmoTkuInmnaEgZmFpbC1jbG9zZWQg6KeE5YiZ77yJXG4gKlxuICog5LuN5pyq6Kej5Yaz44CB5aaC5a6e5qCH5rOo44CB5LiN57yW6YCg55qE57y65Y+j6KeB5a+55bqU5a2X5q615peB55qE5rOo6YeK77yaNOKYhS/lpJrmlbAgNeKYhSDmsaDnmoTmuJDov5tcbiAqIOamgueOh+eyvuehruaVsOWAvOacrOacuuagt+acrOS4jei2s+S7peagh+WumuOAgWByZXNvbHZlVGltZXpvbmVgIOe8uuWwkSBzdnJfaWQvc3ZyX2FyZWEg5YiwXG4gKiBVVEMg5YGP56e76YeP55qE55yf5a6e5pig5bCE6KGo44CB6IGU5Yqo5rGg55qEXCLmnJ/mrKHlhoXkv53lupXph43nva5cIuWPguiAg+WunueOsOWcqOecn+WunuaVsOaNruS4iuW3slxuICog5aSx5pWI5Zug6ICM5pys5o+S5Lu25LiN5a6e546w44CCXG4gKi9cbmltcG9ydCB0eXBlIHsgUGx1Z2luTWFuaWZlc3QgfSBmcm9tIFwiZ3MtcGx1Z2luLWtpdFwiO1xuXG4vLyDmiZPljIXohJrmnKzvvIhzY3JpcHRzL2dzLWJ1bmRsZS1wbHVnaW5zLm1qc++8ieS7jiBtYW5pZmVzdC50cyDov5nkuIDkuKrlhaXlj6PlkIzml7blj5Zcbi8vIG1hbmlmZXN0IOS4jiBob29rcyDkuKTkuKrlr7zlh7rvvIzkuI4gcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzIOeahOWGmeazleS4gOiHtOOAglxuZXhwb3J0IHsgaG9va3MgfSBmcm9tIFwiLi9ob29rcy50c1wiO1xuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICog5ZON5bqU6K6w5b2V55qEIGByZXNvdXJjZUlkYC9gcXVhbGl0eUxldmVsYCDmmK8gSlNPTiBudW1iZXLvvIhgTW9kZWxzL0dhY2hhQVBJLmNzYFxuICog55qEIGByZXNvdXJjZUlkOiBpbnRg44CBYHF1YWxpdHlMZXZlbDogaW50YO+8jOS4lOW3suiiq1xuICogYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKnMi4xIOeahOecn+WunuWtmOaho+Wtl+auteexu+Wei+e7n+iuoVxuICog54us56uL6K+B5a6e77yJ77yM5LiO57Gz5ZOI5ri45LiJ5ri4XCLmlbDlrZflrZfnrKbkuLJcIuS4jeWQjO+8jOWboOatpOWNleeLrOS4gOS4qui9rOaNouWHveaVsOOAglxuICovXG5mdW5jdGlvbiBudW1lcmljVG9TdHJpbmcodmFsdWU6IHVua25vd24pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiBTdHJpbmcodmFsdWUpO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPiAwID8gdHJpbW1lZCA6IHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIGBjb3VudDogaW50YO+8iGBNb2RlbHMvR2FjaGFBUEkuY3Ng77yM5ZCM5LiK5bey6KKr55yf5a6e5a2Y5qGj57uf6K6h54us56uL6K+B5a6e5oGS5Li65ZCM5LiAXG4gKiDmlbTmlbDlj5blgLzvvInjgILpmLLlvqHlvI/ovazmjaIgKyDlvILluLjlhZzlupXkuLogMe+8jOWuueW/jeWTjeW6lOW9ouaAgeS4juacrOacuuaguOWunueahOagt+acrOS4jeWujOWFqFxuICog5LiA6Ie055qE5oOF5Ya144CCXG4gKi9cbmZ1bmN0aW9uIHRvQ291bnQodmFsdWU6IHVua25vd24pOiBudW1iZXIge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkpIHJldHVybiB2YWx1ZTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlcih2YWx1ZSk7XG4gICAgaWYgKE51bWJlci5pc0Zpbml0ZShwYXJzZWQpKSByZXR1cm4gcGFyc2VkO1xuICB9XG4gIHJldHVybiAxO1xufVxuXG4vKipcbiAqIOS7jiBgUE9TVCBnbXNlcnZlci1hcGkuYWtpLWdhbWUyLmNvbS9nYWNoYS9yZWNvcmQvcXVlcnlgIOWTjeW6lOS9k+WPluWHuuivpVxuICogUG9vbFR5cGUg55qE5YWo6YOo6K6w5b2V5pWw57uE44CCXG4gKlxuICog4pqg77iPICoq5ZON5bqU5aSW5bGC5L+h5bCB5b2i5oCB5pys6Lqr56CU56m25pyq6KaG55uWKirvvJpgTW9kZWxzL0dhY2hhQVBJLmNzYCDnu5nlh7rnmoTmmK/ljZXmnaFcbiAqIOiusOW9leeahCBEVE8g5a2X5q6177yM5rKh5pyJ57uZ5Ye65ZON5bqU5aSW5bGC5L+h5bCB55qE5a6M5pW0IEpTT04g5b2i5oCB77yb5pys5py65rKh5pyJ6bij5r2uIEFQSVxuICog55qE55yf5a6e5oqT5YyF5qC35pys44CC6L+Z6YeM6Ziy5b6h5byP5YW85a6557Gz5ZOI5ri45LiJ5ri45ZCM5peP5o+S5Lu25bi46KeB55qE5Lik56eN5L+h5bCBXG4gKiDvvIhgeyBkYXRhOiBbLi4uXSB9YCDkuI4gYHsgZGF0YTogeyBsaXN0OiBbLi4uXSB9IH1g77yJ77yM5Lik6ICF6YO95pivKirnsbvmr5QqKu+8jFxuICog5LiN5piv5bey5qC45a6e5LqL5a6e77yM5Lu75L2V5LiA5bGC5b2i54q25LiN5a+55bCx6L+U5Zue56m65pWw57uE6ICM5LiN5piv5oqb5byC5bi44oCU4oCU5YiG6aG15byV5pOO5Lya5oqKXG4gKiDnqbrmlbDnu4TlvZPkvZznu4jmraLmnaHku7blpITnkIbvvIzmr5TorqnkuIDmrKHlk43lupTlvaLmgIHkuI3nrKbnm7TmjqXkuK3mlq3mlbTmnaHph4fpm4bmtYHnqIvmm7TlronlhajjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhUmVjb3JkTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmIChBcnJheS5pc0FycmF5KGRhdGEpKSByZXR1cm4gZGF0YTtcbiAgaWYgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIGRhdGEgIT09IG51bGwpIHtcbiAgICBjb25zdCBsaXN0ID0gKGRhdGEgYXMgeyBsaXN0PzogdW5rbm93biB9KS5saXN0O1xuICAgIGlmIChBcnJheS5pc0FycmF5KGxpc3QpKSByZXR1cm4gbGlzdDtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8qKlxuICogMTMg6aG5IGBQb29sVHlwZWAg6KGo77yM6YCQ5a2X5q615Y+W6IeqIGBTZXJ2aWNlcy9Db25maWdTZXJ2aWNlLmNzOjI5LTQzYCDljp/moLfooajmoLzvvJpcbiAqICAgYChQb29sVHlwZSwg5ZCN56ewLCDmmK/lkKbmlrDmiYvmsaAsIDXimIXnoazkv53lupUsIDTimIXnoazkv53lupUsIOS/neW6leaYr+WQpue7p+aJvylgXG4gKlxuICog5pys6KGo5L+d55WZ55yf5q2j55So5b6X5LiK55qE5LiJ5YiX77yaaWQgLyBkaXNwbGF5TmFtZSAvIGhhcmRQaXR5NVN0YXLvvIzlpJbliqBcbiAqIGBmaXZlU3Rhckd1YXJhbnRlZUtpbmRg77yI5pys5o+S5Lu26Ieq6KGM5b2S57qz77yM5LiN5ZyoIGBDb25maWdTZXJ2aWNlLmNzYCDljp/ooajph4zvvIxcbiAqIOingeS4i+aWueWNleeLrOivtOaYju+8ieOAgjTimIUg56Gs5L+d5bqV5oGS5Li6IDEw77yI6KeB5LiL5pa5IGBXVVdBXzRTVEFSX0hBUkRfUElUWWDvvInvvIzkuI3lho1cbiAqIOmcgOimgemAkOihjOWMuuWIhuOAguOAjOaYr+WQpuaWsOaJi+axoOOAjeOAjOS/neW6leaYr+WQpue7p+aJv+OAjeS4pOWIl+ebruWJjeeahOaPkuS7tuWlkee6pumHjOayoeacieWvueW6lFxuICog5a2X5q615Y+v5Lul5om/6L2977yM44CM5piv5ZCm57un5om/44CN6L+Z5LiA5YiX5Y2z5L2/5pyJ5a2X5q615Lmf5peg5rOV5q2j56Gu5a6e546w77yM6KeB5LiL5pa5XG4gKiBgcGl0eUdyb3Vwc2Ag5LiA6IqC55qEXCLlt7Lnn6XnvLrlj6NcIuivtOaYjuOAglxuICpcbiAqIGBmaXZlU3Rhckd1YXJhbnRlZUtpbmRgIOWPluWAvOS+neaNru+8iGBkb2NzL19pbnRlcm5hbC9taWxlc3RvbmVzL1xuICogMDMtTTIt6bij5r2u5o+S5Lu25LiO5oq96LGh6K+B5LyqLm1kYCDCpzQuNO+8mlwi6KeS6Imy5rGgIDUwLzUw77yM5q2m5Zmo5rGg5b+F5Lit5LiN5q2qXCLvvInvvJpcbiAqICAgLSA1IOS4quOAjOinkuiJsuOAjeaxoO+8iGlkIDEvMy84LzEwLzEy77yJ5Y+WIGBmaWZ0eUZpZnR5YOKAlOKAlOS+neaNruaYr+aKiiDCpzQuNOOAjOinkuiJsuaxoFxuICogICAgIDUwLzUw44CN6L+Z5p2h6YCa55So57uT6K665oyJ44CM6KeS6Imy5Y2h5rGg44CN5aSn57G75bqU55So77yM5LiN5piv5a+55bi46am7L+aWsOaXhS/ogZTliqgv5b+G5peFXG4gKiAgICAg6L+Z5Lqb5a2Q57G75Z6L6YCQ5LiA5Y2V54us6aqM6K+B6L+H44CCXG4gKiAgIC0gNSDkuKrjgIzmrablmajjgI3msaDvvIhpZCAyLzQvOS8xMS8xM++8ieWPliBgYWx3YXlzUmF0ZVVwYOKAlOKAlOWQjOS4iu+8jOaMieOAjOatpuWZqOWNoeaxoOOAjVxuICogICAgIOWkp+exu+W6lOeUqOOAglxuICpcbiAqICAg4pqg77iPIOS4peagvOivtO+8jOWPquacieOAjOinkuiJsua0u+WKqOWUpOWPluOAjeOAjOatpuWZqOa0u+WKqOWUpOWPluOAje+8iGlkIDEvMu+8iei/meS4pOS4quWtkOexu+Wei1xuICogICDlnKggwqc0LjQg6YeM5pyJ55u05o6l5a+554Wn77yM5YW25L2ZIDgg5Liq5pivKirlkIznsbvmjqjlub8qKuOAguaOqOW5v+acrOi6q+aYr+WQiOeQhueahOmihuWfn+aOqOaWrVxuICogICDvvIjmi4Xkv53op4TliJnlnKjpuKPmva7ph4zmjInnianlk4HlpKfnsbvogIzpnZ7mjInljaHmsaDlrZDnsbvlnovliJLliIbvvInvvIzkvYblroPmsqHmnInpgJDmsaDlrp7mtYtcbiAqICAg6IOM5Lmm4oCU4oCU6Iul5pel5ZCO5p+Q5Liq5a2Q57G75Z6L6KKr5Y+R546w6KeE5YiZ5LiN5ZCM77yM5pS56L+Z5LiA5YiX5Y2z5Y+v77yM5LiN5b+F5Yqo5Lu75L2V6YC76L6R44CCXG4gKiAgIC0gMyDkuKrjgIzmlrDmiYvjgI3msaDvvIhpZCA1LzYvN++8ieWPliBgbm9uZWDigJTigJQqKuayoeacieS7u+S9leWunua1i+S+neaNrioq77yM5Y+q5piv5rK/55SoXG4gKiAgICAg5q2k5YmN55So5rGg5ZCN5a2X56ym5Liy5Yy56YWN5pe255qE546w54q277yI5rGg5ZCN5LiN5ZCrXCLop5LoibJcIuS5n+S4jeWQq1wi5q2m5ZmoXCLvvIzljLnphY3kuI3kuIpcbiAqICAgICDku7vkvZXkuIDmlK/miY3okL3liLAgYG5vbmVg77yJ77yM6YCQ6KGM5qCH5rOoIGAvLyDml6Dlrp7mtYvkvp3mja7vvIzmsr/nlKjnjrDnirZg44CCXG4gKlxuICog5LmL5YmN5piv5LuOIGBwb29sLm5hbWVgIOeUqCBgLmluY2x1ZGVzKFwi6KeS6ImyXCIpYC9gLmluY2x1ZGVzKFwi5q2m5ZmoXCIpYCDnjrDlnLrmjqjlr7xcbiAqIOi/meS4quWAvO+8jOi/memHjOaUueaIkOaYvuW8j+WIl+WHuuKAlOKAlOaYvuekuuWQjeaYr+e7meS6uueci+eahO+8jOS4jeivpeaJv+aLhVwi5Yaz5a6a5L+d5bqV6K+t5LmJXCLov5nkuKpcbiAqIOiBjOi0o++8muaUueS4gOS4quWtl+OAgeaIluWHuueOsOWQjOaXtuWQqy/pg73kuI3lkKvov5nkuKTkuKror43nmoTmsaDlkI3vvIzor63kuYnkvJrpnZnpu5jmlLnlj5jvvJvlm7rljJZcbiAqIOaIkOihqOagvOWQjuavj+S4gOihjOeahOWPluWAvOebtOaOpeWPr+ivu++8jOS4jeeUqOi3s+WIsOWIq+WkhOWPjeaOqOOAglxuICovXG5jb25zdCBXVVdBX1BPT0xfVFlQRVMgPSBbXG4gIHsgaWQ6IFwiMVwiLCBuYW1lOiBcIuinkuiJsua0u+WKqOWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjJcIiwgbmFtZTogXCLmrablmajmtLvliqjllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJhbHdheXNSYXRlVXBcIiB9LFxuICB7IGlkOiBcIjNcIiwgbmFtZTogXCLop5LoibLluLjpqbvllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgeyBpZDogXCI0XCIsIG5hbWU6IFwi5q2m5Zmo5bi46am75ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbiAgeyBpZDogXCI1XCIsIG5hbWU6IFwi5paw5omL5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDUwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwibm9uZVwiIH0sIC8vIOaXoOWunua1i+S+neaNru+8jOayv+eUqOeOsOeKtlxuICB7IGlkOiBcIjZcIiwgbmFtZTogXCLmlrDmiYvoh6rpgInllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJub25lXCIgfSwgLy8g5peg5a6e5rWL5L6d5o2u77yM5rK/55So546w54q2XG4gIHsgaWQ6IFwiN1wiLCBuYW1lOiBcIuaWsOaJi+iHqumAieWUpOWPlu+8iOaEn+aBqeWumuWQkeWUpOWPlu+8iVwiLCBoYXJkUGl0eTVTdGFyOiAxLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwibm9uZVwiIH0sIC8vIOaXoOWunua1i+S+neaNru+8jOayv+eUqOeOsOeKtlxuICB7IGlkOiBcIjhcIiwgbmFtZTogXCLop5LoibLmlrDml4XllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgeyBpZDogXCI5XCIsIG5hbWU6IFwi5q2m5Zmo5paw5peF5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbiAgeyBpZDogXCIxMFwiLCBuYW1lOiBcIuinkuiJsuiBlOWKqOWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjExXCIsIG5hbWU6IFwi5q2m5Zmo6IGU5Yqo5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbiAgeyBpZDogXCIxMlwiLCBuYW1lOiBcIuinkuiJsuW/huaXheWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICB7IGlkOiBcIjEzXCIsIG5hbWU6IFwi5q2m5Zmo5b+G5peF5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbl0gYXMgY29uc3Q7XG5cbi8qKiA04piFIOehrOS/neW6le+8jOWFqOmDqCAxMyDpobkgUG9vbFR5cGUg5YWx55So5ZCM5LiA5Liq5YC877yIYENvbmZpZ1NlcnZpY2UuY3NgIOesrCA1IOWIl+aBkuS4uiAxMO+8ieOAgiAqL1xuY29uc3QgV1VXQV80U1RBUl9IQVJEX1BJVFkgPSAxMDtcblxuLyoqIGBmaXZlU3Rhckd1YXJhbnRlZUtpbmRgIOKGkiDlrp7pmYUgYEd1YXJhbnRlZVJ1bGVgIOWtl+mdoumHj+Wvueixoe+8iFAyIOihqO+8ieOAgiAqL1xuY29uc3QgV1VXQV9GSVZFX1NUQVJfR1VBUkFOVEVFX0JZX0tJTkQgPSB7XG4gIGZpZnR5RmlmdHk6IHsga2luZDogXCJmaWZ0eUZpZnR5XCIgYXMgY29uc3QgfSxcbiAgYWx3YXlzUmF0ZVVwOiB7IGtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgYXMgY29uc3QgfSxcbiAgbm9uZTogeyBraW5kOiBcIm5vbmVcIiBhcyBjb25zdCB9LFxufSBhcyBjb25zdDtcblxuLyoqXG4gKiDku47ml6Xlv5fooYzmj5Dlj5YgZ2FjaGFMaW5rIOeahOato+WIme+8jOmAkOWtl+WPluiHquWPguiAg+WunueOsFxuICog77yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2Ag55qEIGBSZWdleC5NYXRjaGAg6LCD55So77yJ77yaXG4gKiAgIGAoaHR0cHM/LipcXC9ha2lcXC9nYWNoYVxcL2luZGV4XFwuaHRtbCNcXC9yZWNvcmRbXFw/PSZcXHdcXC1dKylgXG4gKlxuICog5oyJ6KGMKirlgJLluo8qKuaJq+aPj+OAgeWRveS4reesrOS4gOS4quWNs+WBnOi/meS7tuS6i+WujOWFqOaYryBSdXN0IEwxXG4gKiDvvIhgY3JhdGU6OmNhY2hlX3NjYW5g77yJ55qE5a6e546w57uG6IqC77yM5pys5q2j5YiZ5Y+q5aOw5piO5Yy56YWN5qih5byP5pys6Lqr77yM5o+S5Lu25L6n5LiN6ZyA6KaBXG4gKiDvvIjkuZ/kuI3og73vvInlo7DmmI7miavmj4/mlrnlkJHjgIJcbiAqL1xuY29uc3QgV1VXQV9HQUNIQV9MSU5LX1BBVFRFUk4gPSAvKGh0dHBzPy4qXFwvYWtpXFwvZ2FjaGFcXC9pbmRleFxcLmh0bWwjXFwvcmVjb3JkW1xcPz0mXFx3XFwtXSspLztcblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA14piFIOa4kOi/m+amgueOh+absue6v1xuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vL1xuLy8g4pqg77iPIOi/meS4pOS4quWjsOaYjuW/hemhu+aUvuWcqCBgZXhwb3J0IGNvbnN0IG1hbmlmZXN0YCDkuYvliY3igJTigJTkuIvpnaIgYG1hbmlmZXN0LnBpdHlHcm91cHNgXG4vLyDnmoQgYGZsYXRNYXBgIOWcqCoq5qih5Z2X5rGC5YC85pyfKirlsLHkvJrosIPnlKggYGZpdmVTdGFyQ3VydmVg77yM6Iul5oqKXG4vLyBgV1VXQV9GSVZFX1NUQVJfUFJPR1JFU1NJVkVfQ1VSVkVgIOWjsOaYjuaUvuWcqCBgbWFuaWZlc3RgIOS5i+WQju+8jGBjb25zdGAg5LiN5LyaXG4vLyDooqvmj5DljYfliJ3lp4vljJbvvIjmmoLml7bmgKfmrbvljLrvvInvvIzkvJrlnKjmsYLlgLwgYG1hbmlmZXN0YCDml7bnm7TmjqXmiptcbi8vIFwiQ2Fubm90IGFjY2VzcyBiZWZvcmUgaW5pdGlhbGl6YXRpb25cIuOAglxuXG4vKipcbiAqIDXimIUg5riQ6L+b5qaC546H5puy57q/55qEKirnspfnspLluqbov5HkvLwqKu+8jOWPquWvueehrOS/neW6lSA4MCDnmoTmsaDlrZDmiJDnq4tcbiAqIO+8iDEvMi8zLzQvNi84LzkvMTAvMTEvMTIvMTPigJTigJTljbPpmaQgNeOAgTcg5LmL5aSW55qE5YWo6YOo77yJ44CCXG4gKlxuICog5pWw5YC855u05o6l5Y+W6IeqIGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCpzMuM++8iFBvb2xUeXBlXG4gKiAxLzIvNCDlkIjlubbjgIHmjIkgMTAg5oq95YiG5qG255qE55yf5a6e5ZG95Lit546H77yM5LiN5piv6YCQ5oq95ouf5ZCI5Ye65p2l55qE5puy57q/77yJ77yaXG4gKiAgIDF+NjAg5oq977ya5ZG95Lit546H5ZyoIDAuNSV+MS45JSDkuYvpl7Tms6LliqjvvIzor6XmlofmoaPliKTlrprkuLrlsI/moLfmnKzlmarlo7DvvIxcbiAqICAgICAgICAgICAg5YWt5Liq5YiG5qG25Z2H5YC8IOKJiDAuOTMl77yM5Zub6IiN5LqU5YWl5Y+WIDElIOS9nOS4uiBiYXNlXG4gKiAgIDYxfjcwIOaKve+8mjYuOSXvvIgzMTcg5Liq5qC35pys44CBMjIg5qyh5ZG95Lit77yJXG4gKiAgIDcxfjgwIOaKve+8mjQ4LjEl77yIMjcg5Liq5qC35pys44CBMTMg5qyh5ZG95Lit77yMKirnva7kv6HljLrpl7TmnoHlrr0qKuKAlOKAlOagt+acrOmHj+Wwj++8jFxuICogICAgICAgICAgICAg6L+Z5Liq5pWw5a2X5pys6Lqr5bCx5pyJ5b6I5aSn5LiN56Gu5a6a5oCn77yM5LiN6KaB5b2T5oiQ57K+56Gu5YC85L2/55So77yJXG4gKlxuICogYGNyYXRlcy9ncy1hbmFseXNpcy9zcmMvcGl0eS5yc2Ag55qEIGBldmFsdWF0ZV9jdXJ2ZWAg5a+5IGBQcm9ncmVzc2l2ZWAg55qEXG4gKiDor63kuYnmmK/jgIxgdGFibGVgIOavj+S4quWFg+e0oOWvueW6lOS4gOaKveOAje+8mmBwdWxsX2luZGV4IDw9IHN0YXJ0YCDml7blj5YgYGJhc2Vg77yMXG4gKiBgcHVsbF9pbmRleCA+IHN0YXJ0YCDml7blj5YgYHRhYmxlW3B1bGxfaW5kZXggLSBzdGFydCAtIDFdYO+8iOWNsyBgdGFibGVbMF1gXG4gKiDlr7nlupTnrKwgYHN0YXJ0ICsgMWAg5oq977yJ77yM5LiL5qCH6LaK55WM6ZKz5Yi25Yiw5pyA5ZCO5LiA5Liq5YWD57Sg4oCU4oCU6L+Z5p2h5puy57q/546w5Zyo5Lya6KKrXG4gKiDnnJ/lrp7mtojotLnvvIzkuI3lho3mmK/ljaDkvY3lo7DmmI7jgILmjInov5nkuKror63kuYnvvIzkuIvpnaIgMjAg5Liq5YWD57Sg5piv5oqK5LiK6Z2i5Lik5LiqIDEwIOaKvVxuICog5YiG5qG2KirpgJDmir3lsZXlvIAqKu+8muesrCA2MX43MCDmir3vvIhgdGFibGVbMC4uOV1g77yJ5Y+WIDYuOSXvvIznrKwgNzF+ODAg5oq9XG4gKiDvvIhgdGFibGVbMTAuLjE5XWDvvInlj5YgNDguMSXjgIJcbiAqXG4gKiDimqDvuI8gKirov5nmmK/liIbmrrXluLjmlbDlsZXlvIDvvIzkuI3mmK/pgJDmir3moIflrpoqKu+8muahtuWGheavj+S4gOaKveWPluWQjOS4gOS4quWAvOaYr+S4gOS4quaYvuW8j+eahFxuICog5bu65qih6YCJ5oup77yM5L+h5oGv6YeP5LiO5Y6f5aeL5YiG5qG25pWw5o2u5a6M5YWo55u45ZCM77yM5rKh5pyJ5Yet56m657yW6YCg5Lu75L2V5paw5L+h5oGv77yb5L2G55yf5a6eXG4gKiDmm7Lnur/lnKjmobblhoXlpKfmpoLnjofmmK/ljZXosIPkuIrljYfnmoTvvIjotormjqXov5Hkv53lupXlkb3kuK3njofotorpq5jvvInvvIzliIbmrrXluLjmlbDkvJrorqnmobbnmoRcbiAqIOWJjeWHoOaKveamgueOh+WBj+mrmOOAgeWQjuWHoOaKveWBj+S9ju+8jOi/meaYr+W3suefpeeahOi/keS8vOivr+W3ru+8jOS4jeaYr+mUmeivr+aVsOaNruOAguetieaciemAkOaKvVxuICog57K+57uG5qC35pys77yI5bCk5YW25pivIDcxfjgwIOaKvei/meS4gOahtu+8jDI3IOS4quagt+acrOaSkeS4jei1t+eyvuehruabsue6v++8ieWGjeabv+aNouOAglxuICovXG5jb25zdCBXVVdBX0ZJVkVfU1RBUl9QUk9HUkVTU0lWRV9DVVJWRSA9IHtcbiAga2luZDogXCJwcm9ncmVzc2l2ZVwiIGFzIGNvbnN0LFxuICBiYXNlOiAwLjAxLFxuICBzdGFydDogNjAsXG4gIC8vIDEwIOS4qiA2Ljkl77yI56ysIDYxfjcwIOaKve+8iSsgMTAg5LiqIDQ4LjEl77yI56ysIDcxfjgwIOaKve+8ie+8jOWvueW6lOS4iuaWueazqOmHiueahFxuICAvLyDliIbmrrXluLjmlbDlsZXlvIDjgILnlKggQXJyYXkuZmlsbCDmi7zmjqXogIzpnZ7miYvlhpkgMjAg5Liq5a2X6Z2i6YeP77yM6YG/5YWN5pWw6ZSZ5Liq5pWw77yMXG4gIC8vIOS5n+iuqeOAjDEwICsgMTDjgI3ov5nkuKrliIbmobbnu5PmnoTlnKjku6PnoIHph4zkv53mjIHlj6/op4HjgIJcbiAgdGFibGU6IFsuLi5BcnJheSgxMCkuZmlsbCgwLjA2OSksIC4uLkFycmF5KDEwKS5maWxsKDAuNDgxKV0sXG59O1xuXG4vKipcbiAqIOaMiSBQb29sVHlwZSDliIbmtL4gNeKYhSDmm7Lnur/jgIJcbiAqXG4gKiAtIFBvb2xUeXBlIDfvvIjmlrDmiYvoh6rpgInllKTlj5bCt+aEn+iwouWumuWQkeWUpOWPlu+8ie+8muehrOS/neW6lSA9IDHvvIzmlbDlrabkuIrnm7TmjqXnrYnku7fkuo5cbiAqICAgXCLmr4/mrKHllKTlj5bpg73lv4Xlh7ogNeKYhVwi77yM5LiN5piv54yc5rWL4oCU4oCU56Gs5L+d5bqV5pWw5YC85pys6Lqr5Yaz5a6a55qE77yM5LiN5L6d6LWW5Lu75L2V5a6e5rWLXG4gKiAgIOagt+acrOOAglxuICogLSBQb29sVHlwZSA177yI5paw5omL5ZSk5Y+W77yM56Gs5L+d5bqVIDUw77yJ77ya55yf5a6e5a2Y5qGj5a6e5rWL6K+l5rGgICoqMCDmnaHorrDlvZUqKlxuICogICDvvIhgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqcxLjIgXCLnqbrmp73kvY1cIuWIl+WHuiA1IOWcqOWGhe+8ie+8jFxuICogICDogIwgYFdVV0FfRklWRV9TVEFSX1BST0dSRVNTSVZFX0NVUlZFYCDnmoTmm7Lnur/lvaLnirbmmK/ku47noazkv53lupUgODAg55qE5LiJ5Liq5rGgXG4gKiAgIO+8iDEvMi8077yJ5a6e5rWL5pWw5o2u6YeM5o6o5Ye655qE4oCU4oCU5riQ6L+b5puy57q/55CG5bqU6ZqP56Gs5L+d5bqV5L2N572u5pys6Lqr5Y+Y5YyW77yI5L+d5bqVIDUwXG4gKiAgIOeahOaxoOWtkOS4jeWPr+iDveWcqOesrCA2MCDmir3miY3lvIDlp4tcIui3g+WNh1wi77yM6YKj5bey57uP6LaF6L+H56Gs5L+d5bqV5pys6Lqr77yJ77yM5oqKIDgwIOehrFxuICogICDkv53lupXmsaDlrZDnmoTmm7Lnur/nm7TmjqXlpZfliLAgNTAg56Gs5L+d5bqV55qE5rGg5a2Q5LiK5piv5rKh5pyJ6K+B5o2u5pSv5oyB55qE5aSW5o6o77yM5Zug5q2kXG4gKiAgIOacrOaxoOS7jeeUqCBjdXN0b20g5Y2g5L2N77yM5LiN5aSW5o6o44CCXG4gKiAtIOWFtuS9meWFqOmDqOehrOS/neW6lSA4MCDnmoTmsaDlrZDvvJrlhbHnlKjlkIzkuIDmnaEgYFdVV0FfRklWRV9TVEFSX1BST0dSRVNTSVZFX0NVUlZFYFxuICogICDigJTigJTlj6rmnIkgMS8yLzQg5LiJ5Liq5rGg5pyJ55yf5a6e5qC35pys77yM5YW25L2Z5ZCM56Gs5L+d5bqV5rGg5a2Q5rKh5pyJ54us56uL5qC35pys77yM5L2G5Lmf5rKh5pyJXG4gKiAgIOS7u+S9leeQhueUseiupOS4uuWug+S7rOeahOabsue6v+W9oueKtuS4jeWQjO+8jOeUqOWQjOS4gOadoeabsue6v+aYr1wi55So5LuF5pyJ55qE6K+B5o2u5LiA6Ie05Zyw5bqU55SoXCLvvIxcbiAqICAg5LiN5piv6YCQ5rGg57yW6YCg5Ye65LqS5LiN55u45ZCM55qE5pWw5a2X44CCXG4gKi9cbmZ1bmN0aW9uIGZpdmVTdGFyQ3VydmUocG9vbDogKHR5cGVvZiBXVVdBX1BPT0xfVFlQRVMpW251bWJlcl0pIHtcbiAgaWYgKHBvb2wuaGFyZFBpdHk1U3RhciA9PT0gMSkge1xuICAgIHJldHVybiB7IGtpbmQ6IFwiZmxhdFwiIGFzIGNvbnN0LCBiYXNlOiAxIH07XG4gIH1cbiAgaWYgKHBvb2wuaGFyZFBpdHk1U3RhciAhPT0gODApIHtcbiAgICByZXR1cm4geyBraW5kOiBcImN1c3RvbVwiIGFzIGNvbnN0LCBpZDogYHd1d2EtdW5jb25maXJtZWQtNXN0YXItcG9vbC0ke3Bvb2wuaWR9YCB9O1xuICB9XG4gIHJldHVybiBXVVdBX0ZJVkVfU1RBUl9QUk9HUkVTU0lWRV9DVVJWRTtcbn1cblxuZXhwb3J0IGNvbnN0IG1hbmlmZXN0ID0ge1xuICBpZDogXCJ3dXdhXCIsXG4gIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLpuKPmva5cIiB9LFxuICBzZGtWZXJzaW9uOiBcIjEuMC4wXCIsXG4gIHBsYXRmb3JtczogW1wid2luZG93c1wiXSxcbiAgbWFpbnRhaW5lcnM6IFtcImdhY2hhLXN0dWRpb1wiXSxcbiAgLy8gZXhjaGFuZ2VGb3JtYXRzIOS4jeWjsOaYju+8mum4o+a9ruayoeacieW3suefpeeahOWFrOW8gOagh+WHhuS6pOaNouagvOW8j++8iFdXR0Yg5LmL57G755qE6K+05rOVXG4gIC8vIOacque7j+ivgeWunu+8jGByZXNlYXJjaC8wMWAgwqczLjIg5bey56Gu6K6k5Y+C6ICD5a6e546w55qE5pys5Zyw5a2Y5qGj5piv6Ieq5a6a5LmJIEpTT04g57uT5p6EXG4gIC8vIOiAjOmdnuS7u+S9leagh+WHhuagvOW8j++8ie+8jOWjsOaYjuS4gOS4quS4jeWtmOWcqOeahOagvOW8j+avlOS4jeWjsOaYjuabtOacieWus+OAglxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBjb2xsZWN077ya5YWI5LuOIENsaWVudC5sb2cg5ou/5Yet5o2u77yIZ2FjaGFMaW5r77yJ77yM5YaN6LCDIHJlY29yZC9xdWVyeSDmjqXlj6NcbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIGNvbGxlY3Q6IHtcbiAgICBwYXJhZGlnbTogXCJjcmVkZW50aWFsZWRBcGlcIixcbiAgICBwYXJhbXM6IHtcbiAgICAgIGNyZWRlbnRpYWw6IHtcbiAgICAgICAga2luZDogXCJsb2dGaWxlXCIsXG4gICAgICAgIC8vIOKaoO+4jyDnm7jlr7nniYfmrrXvvIzkuI3mmK/nu53lr7not6/lvoTigJTigJRgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzOjY2LTY3YFxuICAgICAgICAvLyDmmL7npLrlrpjmlrnlkK/liqjlmajkuI4gV2VHYW1lIOWQr+WKqOWZqOeahOaXpeW/l+ebuOWvuei3r+W+hOS4jeWQjO+8iOWumOaWueWQr+WKqOWZqOWcqOa4uOaIj1xuICAgICAgICAvLyDnm67lvZXkuIvlpJrlpZfkuIDlsYIgXCJXdXRoZXJpbmcgV2F2ZXMgR2FtZS9cIu+8jFdlR2FtZSDmsqHmnInov5nkuIDlsYLvvInjgIJcbiAgICAgICAgLy8gYGxvZ1BhdGhgIOebruWJjeS7jeaYr+WNleS4quWtl+espuS4suWtl+aute+8jOijheS4jeS4i+S4pOS4quWAmemAie+8m1J1c3Qg5L6nXG4gICAgICAgIC8vIGBsb2NhdGVfbG9nX2NhbmRpZGF0ZXNgIOS8muWQjOaXtuWwneivlVwi55u05o6l5ZG95LitXCLkuI5cIuaBsOWlveS4gOWxguWtkOebruW9lVwi5Lik56eNXG4gICAgICAgIC8vIOWAmemAiei3r+W+hO+8jOWboOatpOi/memHjCoq5LiN6KaBKirmioogXCJXdXRoZXJpbmcgV2F2ZXMgR2FtZVwiIOWJjee8gOWGmei/m+adpeKAlOKAlFxuICAgICAgICAvLyDlhpnkuoblj43ogIzlj6rog73ljLnphY3lrpjmlrnlkK/liqjlmajov5nkuIDnp43vvIxSdXN0IOS+p+eahOWPjOWAmemAieacuuWItuWwseeUqOS4jeS4iuS6huOAglxuICAgICAgICBsb2dQYXRoOiBcIkNsaWVudC9TYXZlZC9Mb2dzL0NsaWVudC5sb2dcIixcbiAgICAgICAgdXJsUGF0dGVybjogV1VXQV9HQUNIQV9MSU5LX1BBVFRFUk4sXG4gICAgICAgIC8vIOWtl+iKgue6p+ino+a3t+a3huWPguaVsO+8mui3s+i/h+WJjSAzIOWtl+iKgu+8jOatpOWQjumAkOWtl+iKguaMiSoq6K+l5a2X6IqC6Ieq6Lqr55qE5YC8KipcbiAgICAgICAgLy8g77yI5LiN5piv5LiL5qCH77yJ55qE5aWH5YG25YiG5Yir5byC5oiWIDB4QTUvMHhFRuOAgua6kOeggeS+neaNrlxuICAgICAgICAvLyBgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYCDnrKwgMTE4fjEyMyDooYzvvJpcbiAgICAgICAgLy8gICBgYnl0ZSBiID0gZW5jcnlwdGVkW2ldOyBpZiAoKGIgJiAxKSA9PSAxKSBiIF49IDB4QTU7IGVsc2UgYiBePSAweEVGO2BcbiAgICAgICAgLy8g5Yik5o2u5pivIGLvvIjlrZfoioLlgLzvvInvvIzlvqrnjq/lj5jph48gaSDlj6rnlKjkuo7lj5blgLzlkozlhpnlm57vvIzkuI7kuIvmoIfml6DlhbPigJTigJTov5nmnaFcbiAgICAgICAgLy8g5bey57uP6KKr6K+B5Lyq6L+H5LiA5qyh5LqM5omL6L2s6L+w77yIYHJlc2VhcmNoLzAxYCDljp/orrDovb3puKPmva7ml6Xlv5fmmK/mmI7mlofvvIzljovmoLlcbiAgICAgICAgLy8g5rKh5o+P6L+w6L+H6Kej56CB77yJ77yM5Zug5q2k5Y+q6K6k6L+Z5q615rqQ56CB5Y6f5paH77yM5LiN6K6k5Lu75L2V6L2s6L+w44CCXG4gICAgICAgIGRlY29kZTogeyBraW5kOiBcInhvckJ5TG93Qml0XCIsIHNraXBCeXRlczogMywgbWFza1doZW5PZGQ6IDB4YTUsIG1hc2tXaGVuRXZlbjogMHhlZiB9LFxuICAgICAgfSxcblxuICAgICAgLy8gUE9TVCArIEpTT04gYm9keeOAguWtl+auteaYoOWwhOmAkOWtl+WPluiHqlxuICAgICAgLy8gYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jczoxNjMtMTk2YO+8iHF1ZXJ5IOWPguaVsOino+aekO+8ieS4jlxuICAgICAgLy8gYDoyMzktMjUzYO+8iOaehOmAoOivt+axguS9k++8ie+8mlxuICAgICAgLy8gICByZXNvdXJjZXNfaWQg4oaSIGNhcmRQb29sSWQgICAgbGFuZyAgICAgIOKGkiBsYW5ndWFnZUNvZGVcbiAgICAgIC8vICAgcGxheWVyX2lkICAgIOKGkiBwbGF5ZXJJZCAgICAgIHJlY29yZF9pZCDihpIgcmVjb3JkSWRcbiAgICAgIC8vICAgc3ZyX2lkICAgICAgIOKGkiBzZXJ2ZXJJZCAgICAgIO+8iOmaj+WNoeaxoOWPmOWMlu+8ieKGkiBjYXJkUG9vbFR5cGVcbiAgICAgIC8vXG4gICAgICAvLyDimqDvuI8gKirlvJXlj7fpmbfpmLHvvIzlha3kuKrlrZfmrrXph4zkuKTkuKrkuI3og73liqDlvJXlj7cqKu+8mmBjYXJkUG9vbElkYC9gbGFuZ3VhZ2VDb2RlYC9cbiAgICAgIC8vIGByZWNvcmRJZGAvYHNlcnZlcklkYCDlnKggQyMg6YeM5pivIGBzdHJpbmdg77yM5bqP5YiX5YyW5ZCO5pivIEpTT04g5a2X56ym5Liy77yMXG4gICAgICAvLyBib2R5IOaooeadv+mHjOWvueW6lOeahOWNoOS9jeespuimgeWKoOW8leWPt++8m+S9hiBgY2FyZFBvb2xUeXBlYCDnm7TmjqXotYvlgLxcbiAgICAgIC8vIGBnYWNoYVBvb2wuUG9vbFR5cGVg77yIYGludGDvvInvvIxgcGxheWVySWRgIOaYryBgbG9uZy5QYXJzZSguLi4pYCDnmoTnu5PmnpxcbiAgICAgIC8vIO+8iGBsb25nYO+8ieKAlOKAlOi/meS4pOS4quWcqCBDIyDkvqfpg73mmK/mlbDlgLznsbvlnovvvIxgSnNvbkNvbnZlcnQuU2VyaWFsaXplT2JqZWN0YFxuICAgICAgLy8g5Lya5oqK5a6D5Lus5bqP5YiX5YyW5oiQ5LiN5bim5byV5Y+355qEIEpTT04g5pWw5a2X44CC5Y2g5L2N56ym5pu/5o2i5piv57qv5a2X56ym5Liy5ou85o6lXG4gICAgICAvLyDvvIhgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYCDnmoRcbiAgICAgIC8vIGBzdWJzdGl0dXRlX3BsYWNlaG9sZGVyc2DvvInvvIzmqKHmnb/ph4znu5kgYHt7Z2FjaGFUeXBlfX1gL1xuICAgICAgLy8gYHt7Y3JlZGVudGlhbC5wbGF5ZXJfaWR9fWAg5aWX5LiK5byV5Y+35Lya5Lqn5Ye6IGBcImNhcmRQb29sVHlwZVwiOlwiMVwiYOKAlOKAlFxuICAgICAgLy8g5pyN5Yqh56uv5pS25Yiw55qE5piv5a2X56ym5LiyIFwiMVwiIOiAjOS4jeaYr+aVsOWtlyAx77yM5LiO55yf5a6e5a6i5oi356uv5Y+R6YCB55qE6K+35rGC5b2i5oCBXG4gICAgICAvLyDkuI3kuIDoh7TvvIzlm6DmraTkuIvpnaIgYm9keSDmqKHmnb/ph4zov5nkuKTlpIQqKuaVheaEj+S4jeWKoOW8leWPtyoq44CCXG4gICAgICByZXF1ZXN0OiB7XG4gICAgICAgIHVybDogXCJodHRwczovL2dtc2VydmVyLWFwaS5ha2ktZ2FtZTIuY29tL2dhY2hhL3JlY29yZC9xdWVyeVwiLFxuICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgICAgLy8g5Y+C6ICD5a6e546w5Zu65a6a6ZmE5bim55qEIFVzZXItQWdlbnTvvIhgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYFxuICAgICAgICAgIC8vIGBjbGllbnQuRGVmYXVsdFJlcXVlc3RIZWFkZXJzLkFkZChcIlVzZXItQWdlbnRcIiwgLi4uKWAg6LCD55So5aSE77yM5Y6f5qC35oqE5b2V77yJ44CCXG4gICAgICAgICAgXCJVc2VyLUFnZW50XCI6XG4gICAgICAgICAgICBcIk1vemlsbGEvNS4wIChXaW5kb3dzIE5UIDYuMjsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzkyLjAuNDUxNS4xMDcgU2FmYXJpLzUzNy4zNlwiLFxuICAgICAgICB9LFxuICAgICAgICBib2R5OlxuICAgICAgICAgICd7XCJjYXJkUG9vbElkXCI6XCJ7e2NyZWRlbnRpYWwucmVzb3VyY2VzX2lkfX1cIixcImNhcmRQb29sVHlwZVwiOnt7Z2FjaGFUeXBlfX0sJyArXG4gICAgICAgICAgJ1wibGFuZ3VhZ2VDb2RlXCI6XCJ7e2NyZWRlbnRpYWwubGFuZ319XCIsXCJwbGF5ZXJJZFwiOnt7Y3JlZGVudGlhbC5wbGF5ZXJfaWR9fSwnICtcbiAgICAgICAgICAnXCJyZWNvcmRJZFwiOlwie3tjcmVkZW50aWFsLnJlY29yZF9pZH19XCIsXCJzZXJ2ZXJJZFwiOlwie3tjcmVkZW50aWFsLnN2cl9pZH19XCJ9JyxcbiAgICAgIH0sXG5cbiAgICAgIC8vIOKaoO+4jyAqKuWPquaUvuWbveacjSBgLmNvbWDvvIzliLvmhI/kuI3pooTmlL7lm73pmYXmnI0gYC5uZXRgKirvvJrlj4LogIPlrp7njrDmjInlh63mja5cbiAgICAgIC8vIGBzdnJfYXJlYWAg5Zyo5Lik5LiqIGhvc3Qg5LmL6Ze05LqM6YCJ5LiA77yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2BcbiAgICAgIC8vIGBzZXJ2ZXJDTiA/IFwiLi4uLmNvbVwiIDogXCIuLi4ubmV0XCJg77yJ77yM5L2G5pys6aG555uu5pys5py65Y+q5pyJ5Zu95pyN5a2Y5qGj5qC35pys77yMXG4gICAgICAvLyDlm73pmYXmnI3liIbmlK/ml6Dms5Xpqozor4HjgIJgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYFxuICAgICAgLy8g6YeMIGBSZXF1ZXN0VGVtcGxhdGVKc29uYCDkuIrmlrnnmoRcIuW3suefpee8uuWPoyBDOFwi5rOo6YeK5bey57uP5oqK6L+Z5p2h6ZKJ5q2777yaXG4gICAgICAvLyBcImNvbGxlY3QucGFyYW1zLmFsbG93ZWRIb3N0cyDph4zlkIzmoLfkuI3pooTmlL4gLm5ldO+8mumihOaUvuetieS6juWjsOaYjuS4gOS4qui3keS4jeWIsFxuICAgICAgLy8g55qE6IO95YqbXCLjgILpooTmlL7kuIDkuKrmnKrnu4/pqozor4HjgIHlvZPliY3or7fmsYLmqKHmnb/kuZ/miZPkuI3liLDnmoQgaG9zdO+8jOWPquS8muWItumAoOS4gOenjVxuICAgICAgLy8gXCLnnIvotbfmnaXmlK/mjIHlm73pmYXmnI1cIueahOWBh+ixoeOAguetieecn+eahOacieWbvemZheacjeagt+acrOaXtu+8jOmcgOimgeWQjOaXtuihpVxuICAgICAgLy8g6K+35rGC56uv54K55YiG5pSv5py65Yi25LiO6L+Z6YeM55qE55m95ZCN5Y2V77yM5Lik6ICF57y65LiA5LiN5Y+v44CCXG4gICAgICBhbGxvd2VkSG9zdHM6IFtcImdtc2VydmVyLWFwaS5ha2ktZ2FtZTIuY29tXCJdLFxuXG4gICAgICBleHRyYWN0TGlzdDogZXh0cmFjdEdhY2hhUmVjb3JkTGlzdCxcblxuICAgICAgLy8g5o6l5Y+j5pys6Lqr5LiN5YiG6aG177yM5LiA5qyh6K+35rGC5Y2z5ou/5Yiw6K+l5Y2h5rGg5YWo6YOo6K6w5b2VXG4gICAgICAvLyDvvIhgVXBkYXRlR2FjaGFEYXRhRGlhbG9nVmlld01vZGVsLmNzYCDph4zmr4/kuKrljaHmsaDlj6rlj5HkuIDmrKEgUE9TVO+8jOayoeaciVxuICAgICAgLy8g5Lu75L2V5YiG6aG15Y+C5pWw77yJ44CC55So57y655yB55qEIGBlbXB0eVBhZ2VgIOS8muWvueWQjOS4gOS7veWFqOmHj+WTjeW6lOatu+W+queOr+OAglxuICAgICAgLy9cbiAgICAgIC8vIOKaoO+4jyDov5nkuI3lj6rmmK9cIuaOpeWPo+W9ouaAgeWmguatpFwi6L+Z5LmI566A5Y2V4oCU4oCUYGhvb2tzLmRlcml2ZVJlY29yZEtleXNg77yI6KeBXG4gICAgICAvLyBgLi9ob29rcy50c2DvvInkvp3otZZcIuavj+asoemDveaYr+aVtOaxoOWFqOmHj+aLieWPllwi6L+Z5p2h5YmN5o+Q6K6h566X5om55qyh5YaF5bqP5L2N77yMXG4gICAgICAvLyDoi6Xml6XlkI7or6/mlLnmiJDlop7ph48v5YiG6aG16YeH6ZuG77yM5bqP5L2N5Lya5Zyo5bGA6YOo6ZuG5ZCI5LiK6K6h566X77yMXG4gICAgICAvLyBgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqcxLjgg5a6e5rWL55qEIDMyLjYwJVxuICAgICAgLy8g77yIMTA5OS8zMzcx77yMa2V5IOato+ehruaAp+S+nei1luW6j+S9jeeahOiusOW9le+8ieS8mueri+WIu+WHuueOsCBrZXkg5ryC56e744CCXG4gICAgICBzdG9wQ29uZGl0aW9uOiB7IGtpbmQ6IFwic2luZ2xlUmVxdWVzdFwiIH0sXG5cbiAgICAgIC8vIOWNoeaxoOW9kuWxnuS7peacrOasoeafpeivoueUqOeahCBiYW5uZXIg5Li65YeG77yM5LiN5L+h5ZON5bqU4oCU4oCU6bij5r2u5ZON5bqU6K6w5b2V6YeM55qEXG4gICAgICAvLyBgY2FyZFBvb2xUeXBlYCDmmK/kuI3lj6/ov5jljp/nmoTkuK3mloflsZXnpLrmoIfnrb7vvIjop4HkuIvmlrlcbiAgICAgIC8vIGBmaWVsZHMuZXh0cmFjdFJlY29yZGAg6YeMIGBiYW5uZXJJZGAg5a2X5q615peB55qE6K+m57uG6K+05piO77yJ77yM6ICM6bij5r2uXG4gICAgICAvLyDkuIDmrKHmn6Xor6Llj6rov5Tlm57kuIDkuKrmsaDnmoTlhajph4/orrDlvZXvvIzkuI3lrZjlnKjmt7fmsaDvvIzlm6DmraTmn6Xor6Lml7bnmoQgYmFubmVyXG4gICAgICAvLyDlsLHmmK/llK/kuIDmnYPlqIHmnaXmupDjgILkuI7ljp/npZ7nm7jlj43igJTigJTljp/npZ7kuIDmrKHmn6Xor6LkvJrmt7flm57lhbblroPljaHmsaDnmoTorrDlvZVcbiAgICAgIC8vIO+8iGBmaXh0dXJlcy9nZW5zaGluL3Jhd19yZXNwb25zZS8zMDFfcGFnZV8xLmpzb25gIOWunua1i++8ie+8jOW/hemhu+S/oVxuICAgICAgLy8g5ZON5bqU44CC5a6M5pW05a+554Wn6KeBIGBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L21hbmlmZXN0LnRzYCDph4xcbiAgICAgIC8vIGBDcmVkZW50aWFsZWRBcGlQaXBlbGluZVBhcmFtcy5iYW5uZXJJZGVudGl0eWAg55qE5paH5qGj44CCXG4gICAgICBiYW5uZXJJZGVudGl0eTogXCJxdWVyeVwiLFxuICAgIH0sXG4gIH0sXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIGZpZWxkc++8muWTjeW6lOiusOW9lSDihpIg57uf5LiA5a2X5q61XG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBmaWVsZHM6IHtcbiAgICBleHRyYWN0UmVjb3JkOiAocmF3KSA9PiB7XG4gICAgICBpZiAodHlwZW9mIHJhdyAhPT0gXCJvYmplY3RcIiB8fCByYXcgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi6bij5r2uIGV4dHJhY3RSZWNvcmQg5pS25Yiw6Z2e5a+56LGh5b2i5oCB55qE5Y6f5aeL6K6w5b2VXCIpO1xuICAgICAgfVxuICAgICAgY29uc3QgcmVjb3JkID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuXG4gICAgICAvLyDlk43lupTorrDlvZXlrZfmrrXvvIhgTW9kZWxzL0dhY2hhQVBJLmNzYO+8ie+8mlxuICAgICAgLy8gICBjYXJkUG9vbFR5cGU6IHN0cmluZyAgIHJlc291cmNlSWQ6IGludCAgICAgIHF1YWxpdHlMZXZlbDogaW50XG4gICAgICAvLyAgIHJlc291cmNlVHlwZTogc3RyaW5nICAgbmFtZTogc3RyaW5nICAgICAgICAgY291bnQ6IGludFxuICAgICAgLy8gICB0aW1lOiBEYXRlVGltZVxuICAgICAgLy8g5rKh5pyJ5Lu75L2V5b2i5byP55qE6K6w5b2VIElE77yI5pegIGlkL3V1aWQvaW5kZXjvvInvvIzkuI7nnJ/lrp7lrZjmoaPlrp7mtYvnu5PorrrkuIDoh7RcbiAgICAgIC8vIO+8iGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCp+S4gO+8ieKAlOKAlOWboOatpCBzdGFibGVJZCDkuI3loavvvIxcbiAgICAgIC8vIGBob29rcy5kZXJpdmVSZWNvcmRLZXlzYCDlv4Xpobvlrp7njrDvvIjop4EgYC4vaG9va3MudHNg77yJ77yM5LiN6IO95L6d6LWW5a6/5Li7XG4gICAgICAvLyDlhZzlupXnlKggc3RhYmxlSWTjgIJcbiAgICAgIGNvbnN0IGl0ZW1JZCA9IG51bWVyaWNUb1N0cmluZyhyZWNvcmQucmVzb3VyY2VJZCk7XG4gICAgICBpZiAoIWl0ZW1JZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLpuKPmva4gZXh0cmFjdFJlY29yZO+8muiusOW9lee8uuWwkSByZXNvdXJjZUlk77yM5peg5rOV56Gu5a6aIGl0ZW1JZFwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbUlkLFxuICAgICAgICB0aW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC50aW1lKSA/PyBcIlwiLFxuICAgICAgICAvLyDimqDvuI8gKirmnKzlrZfmrrXkuI3nlLHlk43lupTlhrPlrpoqKuKAlOKAlGBmaXh0dXJlcy93dXdhL3Jhd19yZXNwb25zZS8xX3BhZ2VfMS5qc29uYFxuICAgICAgICAvLyDnnJ/lrp7moLfmnKzor4Hlrp7vvIxQb29sVHlwZT0xIOeahOWTjeW6lOiusOW9lemHjCBgY2FyZFBvb2xUeXBlYCDlj5blgLzmmK/kuK3mlodcbiAgICAgICAgLy8g5bGV56S65qCH562+IGBcIuinkuiJsueyvuWHhuiwg+iwkFwiYO+8jCoq5LiN5pivKiogYFwiMVwiYO+8m+WPquaciSBgMTBfcGFnZV8xLmpzb25gXG4gICAgICAgIC8vIO+8iFBvb2xUeXBlPTEw77yJ5oGw5aW96ZmN57qn5oiQ5LqG5pWw5a2X5a2X56ym5LiyIGBcIjEwXCJg44CC5Lmf5bCx5piv6K+0XG4gICAgICAgIC8vIGBjYXJkUG9vbFR5cGVgIOWkmuaVsOaDheWGteS4i+S4jeaYryBgV1VXQV9QT09MX1RZUEVTYCDooajnmoQgaWTvvIznm7TmjqXmi7/lroNcbiAgICAgICAgLy8g5b2TIGJhbm5lcklkIOS8muS6p+WHuuS4gOS4quS4jeWMuemFjeS7u+S9lSBgYmFubmVyc1tdLmlkYC9cbiAgICAgICAgLy8gYHBpdHlHcm91cHNbXS5tZW1iZXJzYCDnmoTlrZfnrKbkuLLvvIzkv53lupXnu5/orqHkvJrlr7nov5nkupvorrDlvZXpnZnpu5jlpLHmlYjjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g6L+Z5LiN5pivXCLlgLzlj5bplJnkuoZcIui/meS5iOeugOWNle+8mmBGaWVsZE1hcHBpbmcuZXh0cmFjdFJlY29yZGAg55qE562+5ZCN5pivXG4gICAgICAgIC8vIGAocmF3OiB1bmtub3duKSA9PiBVbmlmaWVkUmVjb3JkRmllbGRzYO+8jCoq5rKh5pyJ5Lu75L2V5Y+C5pWw6IO95ZGK6K+J5a6DXG4gICAgICAgIC8vIOi/meaJueiusOW9leaYr+afpeivouWTquS4qiBQb29sVHlwZSDlvpfliLDnmoQqKuKAlOKAlOi/meaYr+e7k+aehOaAp+mZkOWItu+8jOS4jeaYr+iDveWcqFxuICAgICAgICAvLyDov5nkuKrlh73mlbDlhoXpg6jkv67lpb3nmoTlrp7njrDnu4boioLvvIhQT1NUIGJvZHkg6YeM5Y+R55qEIGBjYXJkUG9vbFR5cGVgIOaYr1xuICAgICAgICAvLyDmiJHku6zoh6rlt7HmjIflrprnmoTmn6Xor6Llj4LmlbDvvIzlk43lupTph4zlkIzlkI3lrZfmrrXljbTmmK/mnI3liqHnq6/oh6rlt7HnmoTlsZXnpLrlgLzvvIxcbiAgICAgICAgLy8g5Lik6ICF5LiN5L+d6K+B5LiA6Ie077yM55yf5a6e5pWw5o2u5bey57uP6K+B5LyqXCLkuIDoh7RcIui/meS4quWBh+iuvu+8ieOAglxuICAgICAgICAvL1xuICAgICAgICAvLyDlm6DmraTov5nph4zkuI3lho3lsJ3or5Xku47lk43lupTop6PmnpDljaHmsaDlvZLlsZ7vvIzmlLnnlKjlrr/kuLvkvqfopobnm5bvvJpcbiAgICAgICAgLy8gYGNvbGxlY3QucGFyYW1zLmJhbm5lcklkZW50aXR5OiBcInF1ZXJ5XCJg77yI6KeB5LiK5pa55aOw5piO77yJ6K6p5a6/5Li7KirlnKhcbiAgICAgICAgLy8g5pys5Ye95pWw6L+U5Zue5LmL5ZCO44CB6LCD55SoIGBob29rcy5kZXJpdmVSZWNvcmRLZXlzYCDkuYvliY0qKu+8jOWwseaKiui/meS4quWtl+autVxuICAgICAgICAvLyDmjaLmiJDlj5HotbfmnKzmrKHmn6Xor6Lml7blrp7pmYXkvb/nlKjnmoQgYmFubmVyIGlk4oCU4oCU5a6M5pW05Yaz562W5L6d5o2u6KeBXG4gICAgICAgIC8vIGBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L21hbmlmZXN0LnRzYCDph4xcbiAgICAgICAgLy8gYENyZWRlbnRpYWxlZEFwaVBpcGVsaW5lUGFyYW1zLmJhbm5lcklkZW50aXR5YCDnmoTmlofmoaPvvIjljp/npZ7kvJrmt7fmsaBcbiAgICAgICAgLy8g5b+F6aG75L+h5ZON5bqU77yM6bij5r2u5LiN5re35rGg5b+F6aG75L+h5p+l6K+i77yM5Lik6ICF5a+554Wn77yJ44CCXG4gICAgICAgIC8vXG4gICAgICAgIC8vIOKaoO+4jyDopobnm5bml7bmnLrmmK/jgIzlnKggaG9va3Mg5LmL5YmN44CN6ICM5LiN5piv44CM6JC95bqT5pe244CN77yM6L+Z5LiA54K55a+5XG4gICAgICAgIC8vIGByZWNvcmRfa2V5YCDnmoTmraPnoa7mgKfmmK/lv4XopoHnmoTvvJpgaG9va3MuZGVyaXZlUmVjb3JkS2V5c2DvvIjop4FcbiAgICAgICAgLy8gYC4vaG9va3MudHNg77yJ5Lya6K+7IGBiYW5uZXJJZGAg5Y+C5LiO5ZOI5biM77yM6Iul5a6D55yL5Yiw55qE5piv5LiL6Z2i6L+Z5Liq5LiO5Y2h5rGgXG4gICAgICAgIC8vIOaXoOWFs+eahOWNoOS9jeWAvO+8jGtleSDlsLHlsJHkuobljaHmsaDov5nkuIDnu7TigJTigJTpuKPmva7ljYHov57mlbTnu4TlhbHnlKjlkIzkuIDkuKrml7bpl7TmiLPvvIxcbiAgICAgICAgLy8g6ICMIDPimIUg5q2m5Zmo5ZCM5pe25Ye6546w5Zyo6KeS6Imy5rGg5LiO5q2m5Zmo5rGg77yM5Lik5rGg5ZCM5LiA56eS5ZCE5Ye65LiA5qyh5ZCM5LiA5Lu2IDPimIUg5LiUXG4gICAgICAgIC8vIOe7hOWGheW6j+S9jeebuOWQjOaXtuS8mueul+WHuuebuOWQjOeahCBrZXnvvIzooqsgYFVOSVFVRShhY2NvdW50X2lkLCByZWNvcmRfa2V5KWBcbiAgICAgICAgLy8gKyBgSU5TRVJUIE9SIElHTk9SRWAg6Z2Z6buY5ZCe5o6J5LiA5p2h44CC5a6/5Li75L6n5a+55bqU5a6e546w5LiO6ZKJ5L2P6K+l5pe25py655qE5pat6KiAXG4gICAgICAgIC8vIOingSBgY3JhdGVzL3BhcmFkaWdtcy9ncy1wLWF1dGhrZXkvc3JjL3BpcGVsaW5lLnJzYOOAglxuICAgICAgICAvL1xuICAgICAgICAvLyDpgqPkuLrku4DkuYjov5nph4zov5jopoHloavkuIDkuKrljaDkvY3lgLzogIzkuI3mmK/pmo/kvr/loasgYGNhcmRQb29sVHlwZWDvvJ/lm6DkuLpcbiAgICAgICAgLy8gYFVuaWZpZWRSZWNvcmRGaWVsZHMuYmFubmVySWRgIOaYr+W/heWhq+Wtl+aute+8jOaAu+W+l+i/lOWbnueCueS7gOS5iO+8m+iAjOi/meS4quWAvFxuICAgICAgICAvLyDllK/kuIDkvJrnnJ/mraPnlJ/mlYjnmoTlnLrmma/vvIzmmK8qKuacieS6uuivr+WIoOS6huS4iumdoueahCBgYmFubmVySWRlbnRpdHk6IFwicXVlcnlcImBcbiAgICAgICAgLy8g5aOw5piOKirigJTigJTpgqPml7bljaDkvY3lgLzkvJrorqnmr4/mnaHorrDlvZXpg73okL3liLDkuIDkuKrkuI3ljLnphY3ku7vkvZUgYGJhbm5lcnNbXS5pZGBcbiAgICAgICAgLy8g55qE5Y2h5rGg5LiK77yM6Zeu6aKY5b2T5Zy65pi+5b2i77yb6Iul5pS55aGrIGBjYXJkUG9vbFR5cGVg77yM6JC95bqT55qE5Lya5pivXCLop5LoibLnsr7lh4ZcbiAgICAgICAgLy8g6LCD6LCQXCLov5nnsbvnnIvnnYDmjLrlkIjnkIbjgIHlrp7pmYXlkIzmoLfljLnphY3kuI3kuIrnmoTlgLzvvIzlj43ogIzmm7Tpmr7lj5HnjrDjgIJcbiAgICAgICAgYmFubmVySWQ6IFwid3V3YS1iYW5uZXItaWRlbnRpdHktbm90LWRlcml2YWJsZS1mcm9tLXJlc3BvbnNlXCIsXG4gICAgICAgIGNvdW50OiB0b0NvdW50KHJlY29yZC5jb3VudCksXG4gICAgICAgIG5hbWU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLm5hbWUpLFxuICAgICAgICBpdGVtVHlwZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQucmVzb3VyY2VUeXBlKSxcbiAgICAgICAgcmFyaXR5OiBudW1lcmljVG9TdHJpbmcocmVjb3JkLnF1YWxpdHlMZXZlbCksXG4gICAgICAgIC8vIHN0YWJsZUlkIOeVmeepuu+8muingeS4iuaWueazqOmHiu+8jEFQSSDlk43lupTmsqHmnInku7vkvZXorrDlvZUgSUQg5a2X5q6144CCXG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG5cbiAgLy8g5Y2h5rGg6KGo77yaMTMg5LiqIFBvb2xUeXBlIOanveS9je+8jOayoeacieS7u+S9leS4gOadoeWjsOaYjiBlbmRwb2ludE92ZXJyaWRl4oCU4oCUMTMg5Liq5rGgXG4gIC8vIOWFseeUqOWQjOS4gOS4querr+eCue+8jOWMuuWIq+WujOWFqOWcqCBQT1NUIGJvZHkg55qEIGNhcmRQb29sVHlwZSDlrZfmrrXlgLzjgIJcbiAgYmFubmVyczogV1VXQV9QT09MX1RZUEVTLm1hcCgocG9vbCkgPT4gKHtcbiAgICBpZDogcG9vbC5pZCxcbiAgICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IHBvb2wubmFtZSB9LFxuICB9KSksXG5cbiAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gIC8vIHBpdHlHcm91cHPvvJo14piFLzTimIUg5Y+M5qGj5L+d5bqVXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvL1xuICAvLyDmr4/kuKogUG9vbFR5cGUg5aOw5piO5Lik5LiqIFBpdHlHcm91cO+8jG1lbWJlcnMg6YO95oyH5ZCR5ZCM5LiA5Liq5Y2h5rGgIGlk77yaXG4gIC8vICAgLSA14piFIOmCo+S7veS4jeWhqyBwaXR5VGFyZ2V077yM5Zue6JC9IHJhcml0eS5waXR5VGFyZ2V0ID0gXCI1XCLvvJtcbiAgLy8gICAtIDTimIUg6YKj5Lu95pi+5byPIHBpdHlUYXJnZXQ6IFwiNFwi77yMaGFyZFBpdHkg5Y+WIFdVV0FfNFNUQVJfSEFSRF9QSVRZ44CCXG4gIC8vXG4gIC8vIOKaoO+4jyAqKjXimIUg57uE5b+F6aG75o6S5Zyo5pWw57uE5YmN6Z2iKirvvJrlrr/kuLvokL3lupPml7YgYHBpdHlfZ3JvdXBfZm9yKClgXG4gIC8vIO+8iGBwaXBlbGluZS5yc2DvvInlj5ZcIuWjsOaYjumhuuW6j+esrOS4gOS4qlwi5L2c5Li65YaZ5YWlIGBHYWNoYVJlY29yZC5waXR5X2dyb3VwYFxuICAvLyDljZXlgLzliJfnmoTpgqPkuIDkuKrigJTigJTov5nkuKrpmpDlvI/or63kuYnlt7Lnn6XmnInpl67popjvvIhTNSDlvoXop6PlhrPvvInvvIzkvYblvZPliY3ooYzkuLrlpoLmraTvvIxcbiAgLy8g6aG65bqP5LiN6IO95Lmx44CC5LiL6Z2iIGBmbGF0TWFwYCDlr7nmr4/kuKogUG9vbFR5cGUg5YWI5Lqn5Ye6IDXimIUg5YiG57uE44CB5YaN5Lqn5Ye6IDTimIVcbiAgLy8g5YiG57uE77yM5L+d6K+B6L+Z5LiA54K544CCXG4gIC8vXG4gIC8vIOOAjOS/neW6leaYr+WQpue7p+aJv+OAje+8iOWPguiAg+WunueOsOmHjOiBlOWKqOaxoCAxMC8xMSDkvKAgaW5oZXJpdD1mYWxzZe+8jOWFtuS9mem7mOiupFxuICAvLyB0cnVl77yJ5rKh5pyJ5a2X5q615om/6L2977yM5LiU5Y2z5L2/5pyJ5a2X5q615Lmf5YGa5LiN5Yiw4oCU4oCU6KeB5LiL5pa55aSn5q61XCLlt7Lnn6XnvLrlj6NcIuivtOaYjuOAglxuICBwaXR5R3JvdXBzOiBXVVdBX1BPT0xfVFlQRVMuZmxhdE1hcCgocG9vbCkgPT4gW1xuICAgIHtcbiAgICAgIGtleTogYCR7cG9vbC5pZH0tNXN0YXJgLFxuICAgICAgbWVtYmVyczogW3Bvb2wuaWRdLFxuICAgICAgaGFyZFBpdHk6IHBvb2wuaGFyZFBpdHk1U3RhcixcbiAgICAgIGN1cnZlOiBmaXZlU3RhckN1cnZlKHBvb2wpLFxuICAgICAgLy8g5Y+W5YC85L6d5o2u6KeB5LiK5pa5IFdVV0FfUE9PTF9UWVBFUyDooajmoLzms6jph4rvvIjop5LoibIv5q2m5ZmoL+aWsOaJi+S4ieexu+eahFxuICAgICAgLy8gZml2ZVN0YXJHdWFyYW50ZWVLaW5kIOWIpOWumuS+neaNruS4jlwi5peg5a6e5rWL5L6d5o2uXCLmoIfms6jpg73lnKjpgqPph4zvvInjgIJcbiAgICAgIGd1YXJhbnRlZTogV1VXQV9GSVZFX1NUQVJfR1VBUkFOVEVFX0JZX0tJTkRbcG9vbC5maXZlU3Rhckd1YXJhbnRlZUtpbmRdLFxuICAgICAgLy8gcGl0eVRhcmdldCDkuI3loavvvJrlm57okL0gcmFyaXR5LnBpdHlUYXJnZXQgPSBcIjVcIuOAglxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBgJHtwb29sLmlkfS00c3RhcmAsXG4gICAgICBtZW1iZXJzOiBbcG9vbC5pZF0sXG4gICAgICBoYXJkUGl0eTogV1VXQV80U1RBUl9IQVJEX1BJVFksXG4gICAgICBwaXR5VGFyZ2V0OiBcIjRcIixcbiAgICAgIC8vIDTimIUg6L2v5L+d5bqVL+a4kOi/m+amgueOh+aVsOWAvOayoeacieS7u+S9leadpea6kOe7meWHuuWIhuahtuWRveS4reeOh++8iOecn+WunuWtmOaho+Wunua1i1xuICAgICAgLy8g5Y+q57uf6K6h5LqGIDTimIUg5Ye66LSn6Ze06ZqU55qE5pyA5bCPL+acgOWkpy/lnYflgLzvvIzop4FcbiAgICAgIC8vIGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCpzMuMu+8jOayoeacieWDjyA14piFIOmCo+agt+eahFxuICAgICAgLy8g6YCQ5oq95ZG95Lit546H5YiG5qG25pWw5o2u77yJ77yM55SoIGN1c3RvbSDljaDkvY3igJTigJTkuI3nvJbpgKDmsqHmnInliIbmobbmlbDmja7mlK/mkpHnmoRcbiAgICAgIC8vIOabsue6v+W9oueKtuOAglxuICAgICAgY3VydmU6IHsga2luZDogXCJjdXN0b21cIiBhcyBjb25zdCwgaWQ6IGB3dXdhLXVuY29uZmlybWVkLTRzdGFyLXBvb2wtJHtwb29sLmlkfWAgfSxcbiAgICAgIC8vIDTimIUg5piv5ZCm5pyJ57G75Ly8IDXimIUg55qEXCLop5LoibIv5q2m5Zmo5b+F5Lit5LiN5q2qXCLop4TliJnmnKrnu4/or4Hlrp7vvIzkuI3lpZfnlKggNeKYhSDnmoRcbiAgICAgIC8vIOinhOWIme+8jOWmguWunuagh+azqOS4uuacquefpeOAglxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwibm9uZVwiIGFzIGNvbnN0IH0sXG4gICAgfSxcbiAgXSksXG5cbiAgcmFyaXR5OiB7IGxhZGRlcjogW1wiM1wiLCBcIjRcIiwgXCI1XCJdLCBwaXR5VGFyZ2V0OiBcIjVcIiB9LFxuXG4gIHRpbWU6IHtcbiAgICAvLyDorrDlvZXml7bpl7TlsLHmmK/mnI3liqHlmajov5Tlm57nmoTmjILpkp/ml7bpl7TlrZfnrKbkuLLjgIHmnKrnu4/lrqLmiLfnq6/mnKzlnLDljJbigJTigJRcbiAgICAvLyBgTW9kZWxzL0dhY2hhRGF0YS5jc2Ag55qEIGBUaW1lYCDlrZfmrrXkuI4gZml4dHVyZSDmoLfmnKznmoTlvaLmgIHkuIDoh7TvvIzov5nkuIDngrlcbiAgICAvLyDkuI5cIuaYr+WQpuefpemBk+WFt+S9k+aXtuWMuuWBj+enu1wi5piv5Lik5Zue5LqL77yM5LiN5Y+X5LiL6Z2i6L+Z5p2h57y65Y+j5b2x5ZON77yM5LqI5Lul5L+d55WZ44CCXG4gICAgcmF3VGltZUNvbnZlbnRpb246IFwic2VydmVyTG9jYWxcIixcblxuICAgIC8vIHJhd0Zvcm1hdDogXCJpc29Mb2NhbFwiIOKAlOKAlCDlj5blgLzmnaXoh6ogYGZpeHR1cmVzL3d1d2EvcmF3X3Jlc3BvbnNlLyouanNvbmBcbiAgICAvLyDkuI4gYGZpeHR1cmVzL3d1d2EvYXJjaGl2ZS93d2dhY2hhX2FyY2hpdmUuanNvbmAg55qE5b2i54q277yIYFwiMjEwMC0wMS0wNlxuICAgIC8vIFQyMjo1MzowN1wiYCDov5nnsbsgYFlZWVktTU0tRERUSEg6TU06U1Ng77yJ77yM5Y2z5pys5Zyw5a2Y5qGj5a2X5q6177yIQyNcbiAgICAvLyBgRGF0ZVRpbWVg77yMTmV3dG9uc29mdCDpu5jorqTluo/liJfljJbkuqfnianvvInnmoTlvaLmgIHjgIJcbiAgICAvL1xuICAgIC8vIOKaoO+4jyAqKkFQSSDnnJ/lrp7nur/moLzlvI/ku43mnKrpqozor4EqKu+8jOi/meS4jeaYr+mBl+a8j++8jOaYr+WmguWunuagh+azqOeahOepuueZveKAlOKAlOWujOaVtFxuICAgIC8vIOafpeivgei/h+eoi+ingSBgZml4dHVyZXMvd3V3YS9tZXRhLnRvbWxgXCLlt7Lnn6XmnKrpqozor4HpobnvvJpBUEkg55qEIFRpbWVcbiAgICAvLyDnur/moLzlvI9cIuS4gOiKgu+8mmBNb2RlbHMvR2FjaGFEYXRhLmNzYCDph4wgYFRpbWVgIOaYryBgRGF0ZVRpbWVgIOW8uuexu+Wei++8jFxuICAgIC8vIEFQSSDlj5HmnaXnmoTljp/lp4vnur/moLzlvI/lnKjlj43luo/liJfljJbpgqPkuIDliLvlsLHooqvlkIPmjonkuobvvIzlj43mjqjkuI3lh7rmnaXvvJtcbiAgICAvLyBgZG9jcy9faW50ZXJuYWwvY2FwdHVyZS9gIOS4i+ayoeaciem4o+a9ruaKk+WMheagt+acrOOAguWjsOaYjiBgaXNvTG9jYWxgIOi1jOeahOaYr1xuICAgIC8vIFwi5pys5Zyw5a2Y5qGj55qE5qC85byP5aSn5qaC546H5LiOIEFQSSDkuIDoh7RcIu+8jOWmguaenOi/meS4quWBh+iuvumUmeS6hu+8jFJ1c3Qg5L6nXG4gICAgLy8gYHBhcnNlX3JlY29yZF90aW1lYCDnjrDlnKjmlLnmiJDkuobkuKXmoLzljLnphY3vvIjkuI3lho3kvp3mrKHlsJ3or5XlpJrnp43moLzlvI/vvInvvIzkvJrlnKhcbiAgICAvLyDpppbmrKHnnJ/lrp7ph4fpm4bml7bmmI7noa7miqXplJnvvIzogIzkuI3mmK/ooqvpnZnpu5jlhZzlupXlkLjmlLbmjonigJTigJTlj4Lop4EgZ3MtY29yZTo6XG4gICAgLy8gUmF3VGltZUZvcm1hdCDmlofmoaNcIuS4uuS7gOS5iOaUueaIkOS4peagvOWMuemFjVwi5LiA6IqC44CCXG4gICAgLy9cbiAgICAvLyDimqDvuI8gKirlt7Lnn6XopLbnmrEqKu+8mum4o+a9ruWQjOaXtuacieS4pOadoeaVsOaNruadpea6kOWFseeUqOi/meS4gOS7veWjsOaYjuKAlOKAlOmHh+mbhui1sCBBUElcbiAgICAvLyDvvIjmoLzlvI/mnKrpqozor4HvvInvvIzlr7zlhaXotbDmnKzlnLDlrZjmoaPvvIhJU0/vvIznoa7lrprvvInjgILoi6XlsIbmnaXor4Hlrp4gQVBJIOWPkeeahOaYr1xuICAgIC8vIOWIq+eahOagvOW8j++8jOi/meS4gOS4qiByYXdGb3JtYXQg5bCx5LiN5aSf55So5LqG77yM6ZyA6KaB5oyJ5pWw5o2u5p2l5rqQ5YiG5Yir5aOw5piO77yb546w5ZyoXG4gICAgLy8g5qC35pys5pWw5Li6IDHvvIzmjInkuInmrKHms5XliJnkuI3kuLrmraTorr7orqHmnLrliLbvvIzlj6rlnKjov5nph4zorrDkuIDnrJTjgIJcbiAgICByYXdGb3JtYXQ6IHsga2luZDogXCJpc29Mb2NhbFwiIH0sXG5cbiAgICAvLyDimqDvuI8gdGltZXpvbmVTb3VyY2Ug5Yi75oSP5LiN5aOw5piO77yI6ICM5LiN5piv5aGrIFwiY29tcHV0ZWRcIu+8ieOAguS4ieS4quWPr+mAieW9ouaAgemAkOS4gFxuICAgIC8vIOaOkumZpO+8jOS4jeaYr+a8j+Whq++8mlxuICAgIC8vICAgLSBhcGlGaWVsZO+8mmBNb2RlbHMvR2FjaGFBUEkuY3NgIOeahCBLUkFQSUl0ZW0g5Y+q5pyJIDcg5Liq5a2X5q6177yM5rKh5pyJ5Lu75L2VXG4gICAgLy8gICAgIOaXtuWMui/lgY/np7vph4/lrZfmrrXvvIzlk43lupTkvZPph4zmsqHmnInog73or7vnmoTlgLzjgIJcbiAgICAvLyAgIC0gc3RhdGljVGFibGXvvJpgZmllbGRgIOivreS5ieaYr1wi5ZON5bqU5L2T6YeM5ZOq5Liq5a2X5q615piv5p+l6KGo6ZSuXCLvvIjkuI4gYXBpRmllbGRcbiAgICAvLyAgICAg5a+556ew77yM6KeBIHBhY2thZ2VzL2dzLXBsdWdpbi1raXQvdHlwZXMvZ2VuZXJhdGVkLnRzIOWvueW6lOWtl+auteazqOmHiu+8ie+8jFxuICAgIC8vICAgICDkvYbmn6XooajplK7lkIzmoLflv4XpobvmnaXoh6rlk43lupTkvZPigJTigJTlk43lupTkvZPmsqHmnIkgcmVnaW9uL3N2ciDnsbvlrZfmrrXvvIxcbiAgICAvLyAgICAg6L+Z5Liq5b2i5oCB5Zyo6bij5r2u6Lqr5LiK5peg5a2X5q615Y+v5p+l77yM5LiN5pivXCLooajkuI3lhahcIueahOmXrumimOOAglxuICAgIC8vICAgLSBjb21wdXRlZO+8muacrOacuuWPquacieWbveacje+8iHN2cl9hcmVhPWNu77yJ5qC35pys77yMYFRpbWV6b25lQ29udGV4dGAg6IO957uZXG4gICAgLy8gICAgIOWIsCBob29rIOeahOi0puWPt+S+p+S/oeWPt+WPquaciSB1aWQvcmVnaW9uIOS4pOS4quWtl+aute+8m2Bob29rcy5yZXNvbHZlVGltZXpvbmVgXG4gICAgLy8gICAgIOeahOetvuWQjeimgeaxguWvueS7u+aEj+i+k+WFpemDvei/lOWbnuS4gOS4quehruWumueahCBudW1iZXLvvIzlm73pmYXmnI3nmoTljLrmnI3liJLliIbkuI5cbiAgICAvLyAgICAg5pe25Yy65rKh5pyJ5Lu75L2V5Y+v6aqM6K+B5L6d5o2u77yM6KaB5LmI57yW5LiA5byg5p+l5peg5a6e5o2u55qE5pig5bCE6KGo77yM6KaB5LmI5a+55pyq55+lXG4gICAgLy8gICAgIHJlZ2lvbiDnm7TmjqXmipvplJnkuK3mlq3ph4fpm4bigJTigJTkuKTogIXpg73mr5RcIuWmguWunuWjsOaYjuS4jeefpemBk1wi5pu057Of44CCXG4gICAgLy9cbiAgICAvLyDnnIHnlaUgdGltZXpvbmVTb3VyY2Ug5ZCO6LWw55qE5piv5a6/5Li75bey57uP6K6+6K6h5aW955qE5YWc5bqV6Lev5b6E77yI5LiN5piv5pys5o+S5Lu25Y+m5byAXG4gICAgLy8g55qE5Y+j5a2Q77yJ77yaYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2Ag55qEXG4gICAgLy8gYHJlc29sdmVfcGFnZV9sZXZlbF90aW1lem9uZV9vZmZzZXRfaG91cnNgIOWvuSBgTm9uZWAg5bCx6L+U5ZueXG4gICAgLy8gYE9rKE5vbmUpYO+8jGBub3JtYWxpemVfdGltZWAg5Zyo5YGP56e76YeP5Li6IGBOb25lYCDml7bmiormjILpkp/ml7bpl7Tljp/moLflvZPmiJBcbiAgICAvLyBVVEMg5a2Y5YWlIGBvY2N1cnJlZF9hdGDjgIFgdHpfb3JpZ2luYCDmoIforrDkuLogYEFzc3VtZWRg4oCU4oCU5Y2zXCLmlbDlrZfnhafmioTvvIxcbiAgICAvLyDmmI7noa7moIfms6jkuI3kv53nnJ9cIu+8jOS4jeaYr+mdmem7mOS6p+WHuuS4gOS4quiHquS/oeS9huWPr+iDvemUmeivr+eahOaXtumXtOaIs+OAglxuICAgIC8vXG4gICAgLy8g5a+555So5oi355qE55yf5a6e5ZCO5p6c77yI5aaC5a6e5YaZ77yM5LiN57KJ6aWw77yJ77ya5LiN5Yy65YiG5Zu95pyNL+WbvemZheacje+8jCoq5omA5pyJKirpuKPmva5cbiAgICAvLyDotKblj7fnmoQgb2NjdXJyZWRfYXQg6YO95Lya5bim552A6L+Z5LiqXCLmnKrnn6XlgY/np7tcIuagh+iusOKAlOKAlOS4jeaYr+WbvemZheacjeavlOWbveacjeabtOW3ru+8jFxuICAgIC8vIOiAjOaYr+S4pOiAheS4gOagt+S4jeS/neecn+OAguWbveacjeeUqOaIt+eci+WIsOeahOaMgumSn+aVsOWtl+Wkp+amgueOh+WwseaYr+acrOWcsOaXtumXtO+8iOWboOS4ulxuICAgIC8vIFwiYXNzdW1lZCBVVENcIiDmgbDlpb3nuqbnrYnkuo5cIuS4jeWBmuaNoueul++8jOWOn+agt+aYvuekulwi77yJ77yM5L2G5Y+q6KaB54m15raJ6Leo5pe25Yy6XG4gICAgLy8g5o2i566X5oiW5LiO5YW25a6D5bey55+l5pe25Yy65p2l5rqQ55qE5ri45oiP5YGa5pe26Ze057q/5q+U5a+577yM6L+Z5Liq5a2X5q616YO95LiN5Y+v5L+h44CC562JXG4gICAgLy8g5ou/5YiwIHN2cl9pZC9zdnJfYXJlYSDihpIgVVRDIOWBj+enu+mHj+eahOecn+WunumqjOivgeS+neaNru+8iOWTquaAleWPquaYr+WbveacjeS4gOadoe+8ie+8jFxuICAgIC8vIOW6lOaUueWbniBgY29tcHV0ZWRgIOW5tuihpeS4iiBgaG9va3MucmVzb2x2ZVRpbWV6b25lYOOAglxuICB9LFxuXG4gIHByZWNvbmRpdGlvbnM6IFtcbiAgICB7XG4gICAgICBpZDogXCJ3dXdhLmNyZWRlbnRpYWwubG9nSGFzR2FjaGFMaW5rXCIsXG4gICAgICBjYXBhYmlsaXR5OiBcImNyZWRlbnRpYWxcIixcbiAgICAgIGxldmVsOiBcInJlcXVpcmVkXCIsXG4gICAgICBkZXNjcmliZToge1xuICAgICAgICBcInpoLUNOXCI6IFwi6Ieq5Yqo6I635Y+W5ZSk5Y+W6K6w5b2V6KaB5rGC5omT5byA6L+H5LiA5qyh5ri45oiP5YaF55qE5ZSk5Y+W6K+m5oOF6aG177yM5LiU6ZyA6KaB5Zyo6ZO+5o6l5pyJ5pWI5pyf5YaF56uL5Y2z5a+85Ye6XCIsXG4gICAgICB9LFxuICAgICAgLy8g5ZCM5Y6f56We5YWI5L6L77yaSG9zdEVudiDnm67liY3msqHmnIlcIuaXpeW/l+aWh+S7tuaYr+WQpuW3suWMheWQq+WMuemFjSBVUkxcIui/meS4quS/oeWPt++8jFxuICAgICAgLy8gY2hlY2sg5Y+q6IO96L+U5ZueIHVua25vd27jgIJcbiAgICAgIGNoZWNrOiAoKSA9PiAoeyBraW5kOiBcInVua25vd25cIiB9KSxcbiAgICAgIHJlbWVkeToge1xuICAgICAgICBcInpoLUNOXCI6IFwi6K+35Zyo5ri45oiP5YaF5omT5byA5ZSk5Y+W6K+m5oOF6aG15ZCO77yM56uL5Y2z5Zue5Yiw5pys5bqU55So6YeN6K+V77yI6ZO+5o6l5pyJ5pWI5pyf5pyq57uP5a6e5rWL56Gu6K6k77yM5oyJ5pyA55+t5oOF5Ya15aSE55CG77yJXCIsXG4gICAgICB9LFxuICAgIH0sXG4gIF0sXG5cbiAgLy8gYmFzZWxpbmUg5LiN5aOw5piO77ya6bij5r2u5o6l5Y+j5LiN5YiG6aG144CB5Lmf5rKh5pyJ5bey55+l55qE5p2D5aiB6IGa5ZCI57uf6K6h5o6l5Y+j77yMXG4gIC8vIGBpbkdhbWVQYWdlQ291bnRgL2BhdXRob3JpdGF0aXZlQXBpYCDkuKTkuKrlj5jkvZPlpZfnlKjpuKPmva7nmoTmg4XlhrXpg73kvJrlkI3kuI3lia/lrp7jgIJcblxuICAvLyByZXRlbnRpb24g5LiN5aOw5piO77ya5rKh5pyJ5Lu75L2V5p2l5rqQ57uZ5Ye66bij5r2u5a6Y5pa56K6w5b2V5L+d55WZ5pyf77yM5LiN6Leo5ri45oiP5oyq55SoXG4gIC8vIOexs+WTiOa4uOS4iea4uFwiNiDkuKrmnIhcIueahOivtOazleOAglxuXG4gIC8vIGl0ZW1JZFNvdXJjZSDkuI3lo7DmmI7vvIzpu5jorqQgXCJuYXRpdmVcIuKAlOKAlHJlc291cmNlSWQg5pivIEFQSSDljp/nlJ/lrZfmrrXvvIzkuI3mmK9cbiAgLy8g5pys5Zyw5YyW54mp5ZOB5ZCN77yM5LiO5pif6ZOBL+e7neWMuumbtuWQjOeQhuOAglxuXG4gIC8vIG1ldGFkYXRhIOS4jeWjsOaYju+8muWTjeW6lOiusOW9leiHquW4piBuYW1lL3Jlc291cmNlVHlwZS9xdWFsaXR5TGV2ZWzvvIzkuI3pnIDopoFcbiAgLy8g5Y+N5p+l5a2X5YW444CCXG5cbiAgLy8gZHJhd0NvdW50aW5nIOS4jeWjsOaYju+8jOm7mOiupCBwZXJSZWNvcmTvvIjop4HkuIrmlrkgdG9Db3VudCDlh73mlbDms6jph4rvvInjgIJcbn0gc2F0aXNmaWVzIFBsdWdpbk1hbmlmZXN0O1xuIiwiLyoqXG4gKiDnu53ljLrpm7bmj5Lku7bnmoTpgIPnlJ/oiLEgaG9va3PjgIJcbiAqXG4gKiDlj6rpnIDopoHkuIDkuKogaG9va++8mlxuICpcbiAqIC0gYGRlcml2ZVJlY29yZEtleWDvvJrkuI7ljp/npZ7lkIznkIbvvIznsbPlk4jmuLjkuInmuLjkuIDlvovkuI3lvpfnnIHnlaXmnKwgaG9va++8iOingVxuICogICBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag6YeMIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlgXG4gKiAgIOaWh+aho++8ieKAlOKAlOacjeWKoeerr+mbquiKsSBJRCDkuI3lkKvljaHmsaDnu7TluqbvvIzot6jnq6/ngrnlnLrmma/kuIvoo7jnlKggYHN0YWJsZUlkYCDmnIlcbiAqICAg5pKe6ZSu6aOO6Zmp77ybSG9Zby5HYWNoYSDkuLrmraTlnKjljp/npZ7ogZTliqjmsaDkuIrnur/kuIDlubTlkI7ku5jlh7rov4fkuIDmrKHmlbTooajph43lu7rov4Hnp7vvvIxcbiAqICAg5pys5o+S5Lu25LuO56ys5LiA5aSp5bCx5oqK5Y2h5rGg57u05bqm5bm26L+bIGtlee+8jOeQhueUseS4jiBgcGx1Z2lucy9nZW5zaGluL2hvb2tzLnRzYFxuICogICDlrozlhajkuIDoh7TjgIJcbiAqIC0gYHJlc29sdmVUaW1lem9uZWAg5LiN6ZyA6KaB77yaYG1hbmlmZXN0LnRzYCDnmoQgYHRpbWUudGltZXpvbmVTb3VyY2Uua2luZGBcbiAqICAg5pivIGBcInN0YXRpY1RhYmxlXCJg77yI5ZON5bqUIGByZWdpb25gIOWtl+auteafpeihqO+8ie+8jOS4jeaYryBgXCJjb21wdXRlZFwiYO+8jOaXtuWMulxuICogICDmjaLnrpfkuI3pnIDopoHmj5Lku7bku6PnoIHlj4LkuI7jgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Ib29rcyB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCBjb25zdCBob29rczogUGx1Z2luSG9va3MgPSB7XG4gIGRlcml2ZVJlY29yZEtleTogKHJlY29yZCkgPT4ge1xuICAgIGlmICghcmVjb3JkLnN0YWJsZUlkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGDnu53ljLrpm7borrDlvZXnvLrlsJEgc3RhYmxlSWTvvIjmnI3liqHnq6/pm6roirEgSUTvvInvvIzml6Dms5XnlJ/miJDnqLPlrprnmoQgcmVjb3JkX2tlee+8mml0ZW1JZD1cIiR7cmVjb3JkLml0ZW1JZH1cImAsXG4gICAgICApO1xuICAgIH1cbiAgICByZXR1cm4gYCR7cmVjb3JkLmJhbm5lcklkfToke3JlY29yZC5zdGFibGVJZH1gO1xuICB9LFxufTtcbiIsIi8qKlxuICog57ud5Yy66Zu25o+S5Lu2IG1hbmlmZXN044CCXG4gKlxuICog6YeH6ZuG6IyD5byP77yaY3JlZGVudGlhbGVkQXBp77yIYGdzLXAtYXV0aGtleWDvvInvvIzlh63mja7mnaXmupDkuI7ljp/npZ7lkIzmrL7igJTigJTnjqnlrrbmiZPlvIBcbiAqIOiur+WPt++8iOaKveWNoe+8ieiusOW9lemhteaXtu+8jOWuouaIt+erryB3ZWJ2aWV3IOS8muWRveS4reWumOaWuSBgZ2V0R2FjaGFMb2dgIOaOpeWPo+W5tuW4puS4ilxuICogYXV0aGtlee+8jOivt+axgiBVUkwg6KKr5YaZ5YWlIGB3ZWJDYWNoZXNgIOebruW9leS4iyBgQ2FjaGUvQ2FjaGVfRGF0YS9kYXRhXzJgIOe8k+WtmFxuICog57Si5byV5paH5Lu277yI5ZCMIGBwbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHNgIOmhtumDqOivtOaYju+8jOS4pOiAheaYr+WQjOS4gOWll+WHreaNruiOt+WPllxuICog5py65Yi277yM5Y+q5pivIGBnYW1lRGlyYCDniYfmrrXkuI3lkIzvvInjgIJcbiAqXG4gKiDmnKzmlofku7bmmK8gYGRyaWxscy96enovbWFuaWZlc3QudHNg77yITTEtUzcg57q46Z2i5aGr6KGo5ryU57uD6I2J56i/77yJ55qE5Y+v6L+Q6KGM54mI5pys77yMXG4gKiDovazljJbml7bmjInku6XkuIvotYTmlpnph43mlrDmoKHlh4bvvIzojYnnqL/ph4zmoIfms6jkuLrjgIzmnKropobnm5YgLyDpnIDlrp7mtYvjgI3nmoTlh6DlpITlt7LnlKjnnJ/lrp5cbiAqIOa6kOeggeihpem9kO+8iOivpuingeWQhOWtl+auteaXgeazqOmHiu+8ie+8jOS4jeWGjeaYr+aOqOaWre+8mlxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NDktNTBgXG4gKiAgIO+8iGBhbGxvd2VkSG9zdHNgIOS4pOS4quWfn+WQjSArIOm7mOiupOerr+eCueWujOaVtOi3r+W+hCBgL2NvbW1vbi9nYWNoYV9yZWNvcmQvYXBpL2dldEdhY2hhTG9nYO+8iVxuICogLSBgZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9saWIucnM6MTQ1LTE0OSwyMDAtMjA0YFxuICogICDvvIhgdGltZXpvbmVTb3VyY2UudGFibGVgIOS6lOadoeWMuuacjeeggeWIsCBVVEMg5YGP56e76YeP55qE5a6M5pW05pig5bCE77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjYwLTE2MGBcbiAqICAg77yIYEdhY2hhTG9nYCDnu5PmnoTkvZPvvJpgZ2FjaGFfdHlwZWAvYGl0ZW1faWRgL2BpdGVtX3R5cGVgL2ByYW5rX3R5cGVgL2BnYWNoYV9pZGBcbiAqICAg5Zub5qy+57Gz5ZOI5ri45ri45oiP5YWx55So5ZCM5LiA5aWX5a2X5q615a6a5LmJ77yM57ud5Yy66Zu25rKh5pyJ5Lu75L2V5a2X5q615ZCN54m55L6L77yJXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjMtMzksMTk5LTI0OSw0NzctNDc4YFxuICogICDvvIhgcmVhbF9nYWNoYV90eXBlYCDliIbpobXlj4LmlbDlkI3jgIHpmZDpgJ/kuI7ph43or5XnmoTnnJ/lrp7lrp7njrDjgIHlk43lupTorrDlvZUgOSDplK7nu5PmnoTjgIFcbiAqICAg5Y2h5rGg57G75Yir56CB6KGo77yJXG4gKiAtIOecn+WunuaKveWNoeWtmOaho+Wunua1i++8iOacrOWcsOiEseaVj+agt+acrO+8jOingSBgZml4dHVyZXMvenp6L21ldGEudG9tbGDvvInvvJpcbiAqICAgYGdhY2hhX2lkYCDmgZLkuLogYCcwJ2DjgIFgY291bnRgIOaBkuS4uiBgJzEnYOOAgWBpZGAg5oGS5Li6IDE5IOS9jeaVsOWtl+Wtl+espuS4suOAgVxuICogICBgaXRlbV90eXBlYC9gcmFua190eXBlYCDnu4TlkIjkuI3mmK/nrJvljaHlsJTnp6/vvIjpn7Pmk47ni6zmnIkgQiDnuqfvvIlcbiAqIC0g5a6Y5pa55L+d5bqV5qaC546H5YWs56S6IEpTT07vvIhgb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vbmFwLy4uLmDvvInvvIxcbiAqICAg6KeB5LiL5pa5IGBwaXR5R3JvdXBzYCDml4Hms6jph4pcbiAqXG4gKiBleGNoYW5nZUZvcm1hdHMg5LiN5aOw5piO77ya57ud5Yy66Zu255qEIFVJR0Yg5a2X5q615pig5bCE5pyq57uP55yf5a6e5a6e546w5qCh5YeG77yM5pysIFN0YWdlXG4gKiDkuI3lnKjmsqHmnInmoKHlh4bnmoTmg4XlhrXkuIvnvJbpgKDlr7zlh7rmoLzlvI/mlK/mjIHvvIjkuI4gYGRyaWxscy96enovbWFuaWZlc3QudHNgIOeahOWIpOaWrVxuICog5LiA6Ie077yM5Y6f56We5bey5a6e546w55qEIGB1aWdmLXY0YCDkuI3ku6Pooajnu53ljLrpm7blj6/ku6Xnm7TmjqXnhafmioTlkIzkuIDku73lo7DmmI7vvInjgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5NYW5pZmVzdCB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqXG4gKiDku44gYGdldEdhY2hhTG9nYCDlk43lupTkvZPph4zlj5blh7rmnKzpobXorrDlvZXmlbDnu4TjgIJcbiAqXG4gKiDnnJ/lrp7lk43lupTlvaLmgIEgYHsgcmV0Y29kZSwgbWVzc2FnZSwgZGF0YTogeyBsaXN0OiBbLi4uXSwgcmVnaW9uIH0gfWAg5LiO5Y6f56WeXG4gKiDlrozlhajlkIzmnoTvvIzlt7LnlKggYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIwMy0yMDRgXG4gKiDvvIhgcmVzPy5kYXRhPy5saXN0YCDliKTnqbrjgIFgcmVzLnJlZ2lvbmAg5Y+W5YC877yJ5qC45a6e77yM5LiN5piv57G75q+U5o6o5pat44CC6Ziy5b6h5byPXG4gKiDop6PmnpDvvJrku7vkvZXkuIDlsYLlvaLnirbkuI3lr7nlsLHov5Tlm57nqbrmlbDnu4TogIzkuI3mmK/mipvlvILluLjvvIzkuqTnu5nliIbpobXlvJXmk47mjInnqbrpobXlpITnkIbjgIJcbiAqL1xuZnVuY3Rpb24gZXh0cmFjdEdhY2hhTG9nTGlzdChyZXNwb25zZTogdW5rbm93bik6IHVua25vd25bXSB7XG4gIGlmICh0eXBlb2YgcmVzcG9uc2UgIT09IFwib2JqZWN0XCIgfHwgcmVzcG9uc2UgPT09IG51bGwpIHJldHVybiBbXTtcbiAgY29uc3QgZGF0YSA9IChyZXNwb25zZSBhcyB7IGRhdGE/OiB1bmtub3duIH0pLmRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSAhPT0gXCJvYmplY3RcIiB8fCBkYXRhID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGxpc3QgPSAoZGF0YSBhcyB7IGxpc3Q/OiB1bmtub3duIH0pLmxpc3Q7XG4gIHJldHVybiBBcnJheS5pc0FycmF5KGxpc3QpID8gbGlzdCA6IFtdO1xufVxuXG4vKiog5Y+v6YCJ5L2G5LiN5o6l5Y+X56m65Liy4oCU4oCU56m65Liy5b+F6aG76KKr5b2T5oiQ44CM5rKh5pyJ5YC844CN77yM5LiN6IO95YaS5YWF44CM5pyJ5YC844CN44CCICovXG5mdW5jdGlvbiB0b05vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG59XG5cbi8qKiDlrpjmlrnlk43lupTph4znmoQgYGNvdW50YCDmmK/mlbDlrZflrZfnrKbkuLLvvIjnnJ/lrp7lrZjmoaPlrp7mtYvmgZLkuLogYFwiMVwiYO+8ie+8jOmYsuW+oeW8j+i9rOaNou+8jOW8guW4uOi+k+WFpeWFnOW6leS4uiAx44CCICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyA14piF77yIUyDnuqfvvInkv53lupXmm7Lnur9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIGJhc2UgLyBoYXJkUGl0eSAvIGd1YXJhbnRlZSDkuInpobnlj5boh6rlrpjmlrnkv53lupXmpoLnjoflhaznpLogSlNPTu+8iOS4gOaJi+aVsOaNru+8jFxuLy8gYGh0dHBzOi8vb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vbmFwL3Byb2RfZ2ZfY24vPGlkPi96aC1jbi5qc29uYO+8ie+8m1xuLy8gc3RhcnQgLyBzdGVwIOWumOaWueS7juacquWFrOekuu+8jOaMieWQjOS6uuekvuWMuuWPo+W+hOaOqOeul+KAlOKAlOS4jlxuLy8gYHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50czoxNjEtMTY0YCDlkIzkuIDlpITnkIbmlrnlvI/vvIg5MCDnoazkv53lupXmsr/nlKjljp/npZ5cbi8vIOOAjDc0IOaKvei1t+avj+aKvSArNiXjgI3nmoTlj6PlvoTvvJs4MCDnoazkv53lupXmjInmr5TkvovmjaLnrpfvvIzlj5YgYHN0YXJ0OiA2NSwgc3RlcDogMC4wN2DvvIxcbi8vICoq6L+Z5Lik5Liq5pWw5a2X5pys6Lqr5rKh5pyJ5a6Y5pa55p2l5rqQ77yM57qv57K55piv5oyJIDkw4oaSNzQvMC4wNiDnmoTmr5TkvovlpJbmjqgqKu+8ieOAglxuLy8g4pqg77iPIOS4jeimgeaKiiBzdGFydC9zdGVwIOivr+W9k+WumOaWueaVsOWAvOS9v+eUqOOAglxuY29uc3QgRVhDTFVTSVZFX0NVUlZFID0geyBraW5kOiBcInNvZnRQaXR5XCIsIGJhc2U6IDAuMDA2LCBzdGFydDogNzQsIHN0ZXA6IDAuMDYgfSBhcyBjb25zdDtcbmNvbnN0IFdfRU5HSU5FX0NVUlZFID0geyBraW5kOiBcInNvZnRQaXR5XCIsIGJhc2U6IDAuMDEsIHN0YXJ0OiA2NSwgc3RlcDogMC4wNyB9IGFzIGNvbnN0O1xuXG5leHBvcnQgY29uc3QgbWFuaWZlc3QgPSB7XG4gIGlkOiBcInp6elwiLFxuICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi57ud5Yy66Zu2XCIgfSxcbiAgc2RrVmVyc2lvbjogXCIxLjAuMFwiLFxuICBwbGF0Zm9ybXM6IFtcIndpbmRvd3NcIl0sXG4gIG1haW50YWluZXJzOiBbXCJnYWNoYS1zdHVkaW9cIl0sXG5cbiAgY29sbGVjdDoge1xuICAgIHBhcmFkaWdtOiBcImNyZWRlbnRpYWxlZEFwaVwiLFxuICAgIHBhcmFtczoge1xuICAgICAgY3JlZGVudGlhbDoge1xuICAgICAgICBraW5kOiBcImNocm9taXVtQ2FjaGVcIixcbiAgICAgICAgLy8g4pqg77iPIOebuOWvueeJh+aute+8jOS4jeaYr+e7neWvuei3r+W+hOOAguadpea6kCByZXNlYXJjaC8wMeOAjOaVsOaNrumHh+mbhuWOn+eQhuWIhuWxguOAjVxuICAgICAgICAvLyDojIPlvI8gQSDpgJrnlKjnu5PorrrvvJp75a6J6KOF55uu5b2VfS9aZW5sZXNzWm9uZVplcm9fRGF0YS93ZWJDYWNoZXMve+eJiOacrH0vXG4gICAgICAgIC8vIENhY2hlL0NhY2hlX0RhdGEvZGF0YV8y44CCXG4gICAgICAgIGdhbWVEaXI6IFwiWmVubGVzc1pvbmVaZXJvX0RhdGEvd2ViQ2FjaGVzXCIsXG4gICAgICAgIC8vIOerr+eCueacgOWQjuS4gOauteaYryBcImdldEdhY2hhTG9nXCLvvIjkuI7ljp/npZ4v5pif6ZOB5ZCM5ZCN77yJ77yM5bey55SoXG4gICAgICAgIC8vIEhvWW8uR2FjaGEgYGNyYXRlcy9nYW1lX2Jpei9zcmMvYXBpLnJzOjQ5LTUwYCDnmoTlrozmlbTot6/lvoRcbiAgICAgICAgLy8gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24tbmFwKC1zZykuLi4vY29tbW9uL2dhY2hhX3JlY29yZC9hcGkvZ2V0R2FjaGFMb2dcIlxuICAgICAgICAvLyDmoLjlrp7igJTigJRkcmlsbHMg6I2J56i/6YeMXCLnq6/ngrnlrZfpnaLlkI3mnKropobnm5bvvIzpnIDlrp7mtYtcIui/meadoSBUT0RPIOW3suino+WGs+OAglxuICAgICAgICB1cmxQYXR0ZXJuOiAvaHR0cHM6XFwvXFwvLis/Z2V0R2FjaGFMb2dbXlwiXSsvLFxuICAgICAgfSxcbiAgICAgIHJlcXVlc3Q6IHtcbiAgICAgICAgLy8g4piFIOW3ruW8gueCue+8muWIhumhteWPguaVsOWQjeaYryByZWFsX2dhY2hhX3R5cGXvvIzkuI3mmK8gZ2FjaGFfdHlwZeKAlOKAlOebtOaOpeWGmVxuICAgICAgICAvLyDov5vov5nkuIDooYzlrZfnrKbkuLLmqKHmnb/vvIzkuI3pnIDopoHku7vkvZXpop3lpJblo7DmmI7lrZfmrrXjgILov5nmmK/lr7lcbiAgICAgICAgLy8gYENyZWRlbnRpYWxlZEFwaVBpcGVsaW5lUGFyYW1zLnBhZ2VTaXplYCDmlofmoaPph4zpgqPmnaFcIue7neWMuumbtueahFxuICAgICAgICAvLyByZWFsX2dhY2hhX3R5cGUg5beu5byC54Wn5qC35Y+q5pS56Ieq5bex6YKj5LiA6KGM5qih5p2/XCLnu5PorrrnmoTlrp7pmYXokL3lnLDvvIzmnaXmupBcbiAgICAgICAgLy8gYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjIwMmDvvJpcbiAgICAgICAgLy8gICBgJHt1cmx9JnJlYWxfZ2FjaGFfdHlwZT0ke2tleX0mcGFnZT0ke3BhZ2V9JnNpemU9JHsyMH0uLi5gXG4gICAgICAgIC8vXG4gICAgICAgIC8vIGVuZF9pZD0w77ya5LiO5Y6f56WeL+aYn+mTgeeahOWGmeazleS4gOiHtO+8jOS9nOS4uuavj+mhteWbuuWumui/veWKoOeahOW4uOmHj+WPguaVsOOAglxuICAgICAgICAvLyDimqDvuI8g55yf5a6e5Y+C6ICD5a6e546w6YeMIGVuZF9pZCDlhbblrp7mmK/kvJrlj5jljJbnmoTmuLjmoIfvvIjlkIzmlofku7blkIzkuIDooYznmoRcbiAgICAgICAgLy8gYCR7ZW5kSWQgPyAnJmVuZF9pZD0nICsgZW5kSWQgOiAnJ31g77yM5Y+W5LiK5LiA6aG15pyA5ZCO5LiA5p2h6K6w5b2V55qEXG4gICAgICAgIC8vIGlk77yJ77yM5L2G5pys6aG555uu55qEIEwxIOWIhumhteW8leaTjuaMiemhteeggemAkuWinue/u+mhteOAgeS4jei/vei4qua4uOagh++8iOacquWjsOaYjlxuICAgICAgICAvLyBgZXh0cmFjdEN1cnNvcmAg5pe255qE57y655yB6KGM5Li677yJ77yM5Zu65a6a5LygIDAg5piv5rK/55So5ZCM5peP57qm5a6a77yM5pyq6ZKI5a+5XG4gICAgICAgIC8vIOe7neWMuumbtueLrOeri+mqjOivgVwi5pyN5Yqh56uv5ZyoIGVuZF9pZCDmgZLkuLogMCDml7bmmK/lkKbku43og73mraPnoa7nv7vpobVcIuKAlOKAlOS4jlxuICAgICAgICAvLyBgZHJpbGxzL3p6ei9tYW5pZmVzdC50c2Ag5a+56L+Z5Liq5Y+C5pWw55qE5oCB5bqm5LiA6Ie077yI5pyq54us56uL5a6e5rWL77yJ44CCXG4gICAgICAgIHVybDogXCJ7e2NyZWRlbnRpYWx9fSZwYWdlPXt7cGFnZX19JnJlYWxfZ2FjaGFfdHlwZT17e2dhY2hhVHlwZX19JnNpemU9e3twYWdlU2l6ZX19JmVuZF9pZD0wXCIsXG4gICAgICB9LFxuICAgICAgLy8g5Lik5LiqIGhvc3Qg6YO95b+F6aG75aGr77yadXJsUGF0dGVybiDmnKzouqvkuI3ljLrliIbln5/lkI3vvIzlj6ropoEgVVJMIOmHjOWHuueOsFxuICAgICAgLy8gXCJnZXRHYWNoYUxvZ1wiIOWwseS8muWMuemFje+8jOWbveacjS/lm73pmYXmnI3lrqLmiLfnq6/nvJPlrZjpg73lj6/og73lkb3kuK3igJTigJTlj6rloavlm73mnI1cbiAgICAgIC8vIOS8muaKiuWbvemZheacjeeOqeWutueahOato+W4uOivt+axguivr+WIpOS4uuaKleavku+8iOWQjOWOn+elniBtYW5pZmVzdCA3OS04OCDooYznmoTmlZnorq3vvInjgIJcbiAgICAgIC8vIOS4pOS4quWfn+WQjeS4jum7mOiupOerr+eCuei3r+W+hOW3sueUqCBIb1lvLkdhY2hhIOa6kOeggeaguOWunu+8iOmdnuacrOaPkuS7tueLrOeri+Wunua1i++8jFxuICAgICAgLy8g5LuF5L2c5LqL5a6e5byV55So77yJ77yaXG4gICAgICAvLyAgIGNyYXRlcy9nYW1lX2Jpei9zcmMvYXBpLnJzOjQ5XG4gICAgICAvLyAgICAgKChOYXAsIE9mZmljaWFsKSwgU3RhbmRhcmQpIC0+IFwiaHR0cHM6Ly9wdWJsaWMtb3BlcmF0aW9uLW5hcC5taWhveW8uY29tL2NvbW1vbi9nYWNoYV9yZWNvcmQvYXBpL2dldEdhY2hhTG9nXCJcbiAgICAgIC8vICAgY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6NTBcbiAgICAgIC8vICAgICAoKE5hcCwgT3ZlcnNlYSksICBTdGFuZGFyZCkgLT4gXCJodHRwczovL3B1YmxpYy1vcGVyYXRpb24tbmFwLXNnLmhveW92ZXJzZS5jb20vY29tbW9uL2dhY2hhX3JlY29yZC9hcGkvZ2V0R2FjaGFMb2dcIlxuICAgICAgLy8g5LiOIGB6enotc2lnbmFsLXNlYXJjaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczoxNWDvvIjlm73mnI3ln5/lkI3vvInjgIFcbiAgICAgIC8vIGA6MzIyLTMyNGDvvIjlm73pmYXmnI3ln5/lkI3liIfmjaLliIbmlK/vvInkupLnm7jljbDor4HjgIJcbiAgICAgIGFsbG93ZWRIb3N0czogW1wicHVibGljLW9wZXJhdGlvbi1uYXAubWlob3lvLmNvbVwiLCBcInB1YmxpYy1vcGVyYXRpb24tbmFwLXNnLmhveW92ZXJzZS5jb21cIl0sXG4gICAgICBleHRyYWN0TGlzdDogZXh0cmFjdEdhY2hhTG9nTGlzdCxcblxuICAgICAgLy8g6ZmQ6YCf562W55Wl77ya5a6/5Li75oyJ5a2X5q616YCQ5LiA5Y+WXCLmm7TmuKnlkozogIVcIuS4jue8uuecgeWAvOWQiOW5tu+8jOS4jeaYr+aVtOS9k+imhuebllxuICAgICAgLy8g77yI6KeBIGBDcmVkZW50aWFsZWRBcGlQaXBlbGluZVBhcmFtcy5yYXRlTGltaXRgIOaWh+aho++8ieOAguaVsOWAvOebtOaOpeWPluiHqlxuICAgICAgLy8g5Y+C6ICD5a6e546wIGB6enotc2lnbmFsLXNlYXJjaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qc2DvvJpcbiAgICAgIC8vICAgOjIzNO+8iGBhd2FpdCBzbGVlcCgwLjMpYO+8jOavj+mhteivt+axguWQjuWbuuWumuetieW+he+8iVxuICAgICAgLy8gICA6MjI3LTIzMO+8iGBpZiAocGFnZSAlIDEwID09PSAwKSB7IC4uLjsgYXdhaXQgc2xlZXAoMSkgfWDvvIzmr48gMTAg6aG1XG4gICAgICAvLyAgICAg6aKd5aSW5aSa562JIDEg56eS77yJXG4gICAgICAvLyAgIDoxOTktMjEy77yIYGdldEdhY2hhTG9nYCDpgJLlvZLph43or5XvvIzliJ3lp4sgYHJldHJ5Q291bnQ6IDVg77yM6YeN6K+V6Ze06ZqUXG4gICAgICAvLyAgICAgYGF3YWl0IHNsZWVwKDUpYO+8iVxuICAgICAgLy8gcGVyUGFnZURlbGF5TXMvcmV0cnkubWF4QXR0ZW1wdHMg5oGw5aW95LiO5a6/5Li757y655yB5YC855u45ZCM77yM6L+Z6YeM5LuN54S25pi+5byPXG4gICAgICAvLyDlo7DmmI7igJTigJTnkIbnlLHmmK9cIui/meS4quaVsOWtl+acieWHuuWkhFwi5pys6Lqr5bCx5piv5paH5qGj77yM5LiN5piv5Li65LqG5pS55Y+Y57y655yB6KGM5Li644CCXG4gICAgICByYXRlTGltaXQ6IHtcbiAgICAgICAgcGVyUGFnZURlbGF5TXM6IDMwMCxcbiAgICAgICAgYmF0Y2hTaXplOiAxMCxcbiAgICAgICAgYmF0Y2hEZWxheU1zOiAxMDAwLFxuICAgICAgICByZXRyeTogeyBtYXhBdHRlbXB0czogNSwgZGVsYXlNczogNTAwMCB9LFxuICAgICAgfSxcblxuICAgICAgLy8gYmFubmVySWRlbnRpdHkg5LiN5aOw5piO77yM57y655yBIFwicmVzcG9uc2VcIuKAlOKAlOexs+WTiOa4uOS4iea4uOmDveWPr+iDvea3t+axoO+8iOWOn+elnlxuICAgICAgLy8g5bey5a6e5rWLIDMwMSDlk43lupTph4zmt7flm54gNDAwIOeahOiusOW9le+8jOingSBgcGx1Z2lucy9nZW5zaGluL21hbmlmZXN0LnRzYFxuICAgICAgLy8gYmFubmVycyDms6jph4rvvInvvIznu53ljLrpm7bomb3nhLbmnKzmj5Lku7blsJrmnKrmi7/liLBcIuWTjeW6lOa3t+axoFwi55qE55u05o6l6K+B5o2u77yM5L2GXG4gICAgICAvLyDkuZ/msqHmnInor4Hmja7mjpLpmaTvvIzmjInlkIzml4/kv53lrojlgYforr7nu6fnu63kv6Hlk43lupTvvIzkuI3otLjnhLblo7DmmI4gXCJxdWVyeVwi4oCU4oCUXG4gICAgICAvLyBgYmFubmVySWRlbnRpdHlgIOaWh+aho+aYjuehruitpuWRiui/h++8mlwi6Iul5p+Q5ri45oiP5YW25a6e5Lya5re35rGg5Y205aOw5piO5LqGXG4gICAgICAvLyBxdWVyee+8jOiiq+a3t+i/m+adpeeahOiusOW9leS8muiiq+mdmem7mOmUmeivr+W9kuaxoFwi77yM5Luj5Lu35LiN5a+556ew77yM5Zug5q2k5LiN5YaZ6L+ZXG4gICAgICAvLyDkuIDooYzvvIjnvLrnnIHljbPmraPnoa7pgInmi6nvvInvvIzku4XlnKjmraTms6jph4rph4zor7TmmI7kuLrku4DkuYjkuI3lhpnjgIJcbiAgICB9LFxuICB9LFxuXG4gIGZpZWxkczoge1xuICAgIGV4dHJhY3RSZWNvcmQ6IChyYXcpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgcmF3ICE9PSBcIm9iamVjdFwiIHx8IHJhdyA9PT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCLnu53ljLrpm7YgZXh0cmFjdFJlY29yZCDmlLbliLDpnZ7lr7nosaHlvaLmgIHnmoTljp/lp4vorrDlvZVcIik7XG4gICAgICB9XG4gICAgICBjb25zdCByZWNvcmQgPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbiAgICAgIC8vIOWTjeW6lOiusOW9lSAxMSDplK7vvIjnnJ/lrp7lrZjmoaPlrp7mtYsgKyBgenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6NDc3LTQ3OGBcbiAgICAgIC8vIOWPjOadpea6kOehruiupOS4gOiHtO+8ie+8mmlkIC8gdWlkIC8gZ2FjaGFfdHlwZSAvIGdhY2hhX2lkIC8gaXRlbV9pZCAvIGNvdW50IC9cbiAgICAgIC8vIHRpbWUgLyBuYW1lIC8gaXRlbV90eXBlIC8gcmFua190eXBlIC8gbGFuZ+OAguS4juWOn+elnuS4jeWQjO+8jOe7neWMuumbtiBBUElcbiAgICAgIC8vIOebtOaOpei/lOWbniBpdGVtX2lk77yISG9Zby5HYWNoYSBgY3JhdGVzL3VybF9zY3JhcGVyL3NyYy90eXBlcy5yczoxNDQtMTQ5YO+8mlxuICAgICAgLy8gXCJFeGNlcHQgZm9yICdHZW5zaGluIEltcGFjdCdcIu+8jOWNs+e7neWMuumbtuOAgeaYn+mTgeWdh+acieatpOWtl+aute+8ie+8jOWboOatpCBpdGVtSWRcbiAgICAgIC8vIOWPliBpdGVtX2lk77yM5LiN6LWw5Y6f56We6YKj5p2hXCLmnKzlnLDljJbnianlk4HlkI3lhZzlupVcIueahOeJueS+i+i3r+W+hO+8jOS5n+S4jemcgOimgeWjsOaYjlxuICAgICAgLy8gYGl0ZW1JZFNvdXJjZWDvvIjnvLrnnIEgXCJuYXRpdmVcIiDljbPmraPnoa7vvInjgIJcbiAgICAgIGNvbnN0IGl0ZW1JZCA9IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLml0ZW1faWQpO1xuICAgICAgaWYgKCFpdGVtSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi57ud5Yy66Zu2IGV4dHJhY3RSZWNvcmTvvJrorrDlvZXnvLrlsJEgaXRlbV9pZO+8jOaXoOazleehruWumiBpdGVtSWRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGl0ZW1JZCxcbiAgICAgICAgdGltZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQudGltZSkgPz8gXCJcIixcbiAgICAgICAgLy8g4pqg77iPICoq5o6o5pat77yM6Z2e5a6e5rWLKirvvJrmn6Xor6Llj4LmlbDlkI3lt7Lnoa7orqTmlLnmiJDkuoYgcmVhbF9nYWNoYV90eXBlXG4gICAgICAgIC8vIO+8iGBnZXREYXRhLmpzOjIwMmDvvInvvIzkvYblk43lupTorrDlvZXph4zlr7nlupTlrZfmrrXnmoTplK7lkI3mmK/lkKbkuZ/lj6tcbiAgICAgICAgLy8gcmVhbF9nYWNoYV90eXBl44CB6L+Y5piv5LuN54S25Y+rIGdhY2hhX3R5cGXvvIxyZXNlYXJjaC8wM+OAgTA0IOWdh+acquebtOaOpVxuICAgICAgICAvLyDnu5nlh7rjgILov5nph4zpgInmi6nnu6fnu63or7sgcmVjb3JkLmdhY2hhX3R5cGXigJTigJTmnIDlvLrml4Hor4HmmK8gSG9Zby5HYWNoYVxuICAgICAgICAvLyBgY3JhdGVzL3VybF9zY3JhcGVyL3NyYy90eXBlcy5yczo4MC05MGAg55qEIGBHYWNoYUxvZy5nYWNoYV90eXBlYFxuICAgICAgICAvLyDlrZfmrrXvvJrlm5vmrL7nsbPlk4jmuLjmuLjmiI/vvIjlkKvnu53ljLrpm7bvvInlhbHnlKjlkIzkuIDkuKogYGdhY2hhX3R5cGVgIOWPjeW6j+WIl+WMllxuICAgICAgICAvLyDnm67moIfvvIxkb2MgY29tbWVudCDmsqHmnInkuLrnu53ljLrpm7bnlZnku7vkvZXlrZfmrrXlkI3nibnkvovvvIjllK/kuIDnmoTnibnkvovms6jph4rmmK9cbiAgICAgICAgLy8gXCJHZW5zaGluIEltcGFjdDogTWlsaWFzdHJhIFdvbmRlcmxhbmRcIu+8jOS4jue7neWMuumbtuaXoOWFs++8ieOAguaYr+aXgeivge+8jFxuICAgICAgICAvLyDkuI3mmK/nm7TmjqXlrp7mtYvnu53ljLrpm7bmn5DkuIDmnaHnnJ/lrp7lk43lupTmiqXmloflvpflh7rnmoTnu5PorrrvvIzlpoLlrp7moIfms6jjgIJcbiAgICAgICAgYmFubmVySWQ6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmdhY2hhX3R5cGUpID8/IFwiXCIsXG4gICAgICAgIGNvdW50OiB0b0NvdW50KHJlY29yZC5jb3VudCksXG4gICAgICAgIG5hbWU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLm5hbWUpLFxuICAgICAgICAvLyDnrKzkuInmoaPnianlk4HliIbnsbtcIumCpuW4g1wi4oCU4oCUaXRlbVR5cGUg5pys5p2l5bCx5piv6Ieq55Sx5a2X56ym5LiyXG4gICAgICAgIC8vIO+8iGBVbmlmaWVkUmVjb3JkRmllbGRzLml0ZW1UeXBlPzogc3RyaW5nYO+8ie+8jOijheS4pOaho+i/mOaYr+S4ieaho+Wvueexu+Wei1xuICAgICAgICAvLyDns7vnu5/msqHmnInljLrliKvvvIzkuI3pnIDopoHku7vkvZXmlrDlrZfmrrXjgIJcbiAgICAgICAgaXRlbVR5cGU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLml0ZW1fdHlwZSksXG4gICAgICAgIHJhcml0eTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQucmFua190eXBlKSxcbiAgICAgICAgc3RhYmxlSWQ6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmlkKSxcbiAgICAgICAgLy8gZ2FjaGFfaWQg5oGS5Li6ICcwJ++8iOecn+WunuWtmOaho+Wunua1i+WFqOmHj+iusOW9leS4gOiHtO+8ie+8jOWIu+aEj+S4jeivu+WPluKAlOKAlFxuICAgICAgICAvLyBVbmlmaWVkUmVjb3JkRmllbGRzIOayoeacieaJv+i9vSBnYWNoYV9pZCDnmoTlrZfmrrXvvIzljaHmsaDmnJ/mrKHlvZLlsZ7lrozlhajkuqRcbiAgICAgICAgLy8g57uZIGJhbm5lcklk77yIZ2FjaGFfdHlwZSDnsbvliKvnoIHvvIkrIOWklumDqCBiYW5uZXIg5YWD5pWw5o2u5o6o5a+877yM6L+Z5p2h6Lev5b6EXG4gICAgICAgIC8vIOS4jeimgeaxgiBnYWNoYV9pZCDmnInmhI/kuYnjgILimqDvuI8g5LiN6KaB5oqKIFwi5oGS5Li6ICcwJ1wiIOW9k+aIkOiDveS+nei1lueahOaWreiogOWOu1xuICAgICAgICAvLyDlhpnmoKHpqozpgLvovpHvvJpIb1lvLkdhY2hhIGBjcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJzOjk3LTEwMmAg5a+5XG4gICAgICAgIC8vIOi/meS4quWtl+auteeUqOeahOaYr1wi5a655b+N56m65a2X56ym5LiyXCLnmoTlj43luo/liJfljJbvvIhgZ2FjaGFfbG9nX2VtcHR5X3N0cmluZ19udW1iZXJfaW50b2DvvInvvIxcbiAgICAgICAgLy8g6K+05piO55yf5a6e5ZON5bqU6YeM6L+Z5Liq5a2X5q615Y+v6IO95piv56m65Liy77yM5LiN5rC46L+c5piv5a2X6Z2i6YePIFwiMFwi44CCXG4gICAgICB9O1xuICAgIH0sXG4gIH0sXG5cbiAgLy8g5Y2h5rGg57G75Yir56CB5LiO5pi+56S65ZCN77yM5Y+M5p2l5rqQ56Gu6K6k5LiA6Ie077ya55yf5a6e5a2Y5qGjIGB0eXBlTWFwYCDlrZfmrrUgK1xuICAvLyBgenp6LXNpZ25hbC1zZWFyY2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanM6MjMtMzBgIOeahCBgZGVmYXVsdFR5cGVNYXBg77yMXG4gIC8vIDYg6aG56YCQ5p2h5a+55LiK77yM6Zu25YiG5q2n44CCXG4gIC8vXG4gIC8vIOKaoO+4jyDot6jmuLjmiI/lpI3nlKjpmbfpmLHvvJppZCBcIjJcIiDlnKjmmJ/pk4HmmK9cIuaWsOaJi+axoFwi77yM5Zyo57ud5Yy66Zu25pivXCLni6zlrrbpopHmrrVcIlxuICAvLyDvvIjop5LoibIgVVAg5rGg77yM562J5Lu35LqO5Y6f56We55qE6KeS6Imy5rS75Yqo56WI5oS/77yJ4oCU4oCU5ZCM5LiA5LiqIGlkIOWcqOS4pOS4quaPkuS7tumHjOivreS5iVxuICAvLyDnm7jlj43vvIzkuI3og73miormn5DkuKrmuLjmiI/nmoQgYmFubmVyIGlkIOW4uOmHj+W9k+aIkFwi6Leo5ri45oiP6YCa55SoXCLljrvlpI3nlKjjgIJcbiAgLy9cbiAgLy8g5Z2H5LiN6ZyA6KaBIGVuZHBvaW50T3ZlcnJpZGXigJTigJRyZXNlYXJjaC8wNCDkuI7mnKzmrKHmoLjlrp7nmoTmupDnoIHlnYfmnKrop4LmtYvliLDnu53ljLrpm7ZcbiAgLy8g5a2Y5Zyo57G75Ly85pif6ZOBIDIxLzIyIOeahOerr+eCueWIhua1geOAglxuICBiYW5uZXJzOiBbXG4gICAgeyBpZDogXCIxXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLluLjpqbvpopHmrrVcIiB9IH0sXG4gICAgeyBpZDogXCIyXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLni6zlrrbpopHmrrVcIiB9IH0sXG4gICAgeyBpZDogXCIzXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLpn7Pmk47popHmrrVcIiB9IH0sXG4gICAgeyBpZDogXCI1XCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLpgqbluIPpopHmrrVcIiB9IH0sXG4gICAgeyBpZDogXCIxMDJcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIueLrOWutumHjeaYoFwiIH0gfSxcbiAgICB7IGlkOiBcIjEwM1wiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6Z+z5pOO5Zue5ZONXCIgfSB9LFxuICBdLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBwaXR5R3JvdXBz77yaYmFzZS9oYXJkUGl0eS9ndWFyYW50ZWUg5Y+W6Ieq5a6Y5pa55L+d5bqV5qaC546H5YWs56S6IEpTT05cbiAgLy8g77yIb3BlcmF0aW9uLXdlYnN0YXRpYy5taWhveW8uY29tL2dhY2hhX2luZm8vbmFwL3Byb2RfZ2ZfY24vPGlkPi96aC1jbi5qc29u77yMXG4gIC8vIOS4gOaJi+aVsOaNru+8ie+8m3N0YXJ0L3N0ZXAg5piv56S+5Yy65o6o566X77yM6Z2e5a6Y5pa577yM6KeB5LiK5pa5IEVYQ0xVU0lWRV9DVVJWRSAvXG4gIC8vIFdfRU5HSU5FX0NVUlZFIOWjsOaYjuaXgeeahOivtOaYjuOAguacrOi9ruWPquWjsOaYjiBTIOe6p++8iHJhcml0eS5waXR5VGFyZ2V0IOWvueW6lOaho++8iVxuICAvLyDkv53lupXnu4TvvIzkuI3lo7DmmI4gQSDnuqfnu4TigJTigJTln7rnur8gYHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50c2Ag5ZCM5qC35Y+q5pyJ5LiA5LiqXG4gIC8vIHBpdHlHcm91cO+8jOS/neaMgeWPr+avlO+8jEEg57qn5L+d5bqV5pys6L2u5pyq6KaG55uW44CCXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBwaXR5R3JvdXBzOiBbXG4gICAge1xuICAgICAga2V5OiBcImV4Y2x1c2l2ZUNoYW5uZWxcIixcbiAgICAgIG1lbWJlcnM6IFtcIjJcIl0sXG4gICAgICBoYXJkUGl0eTogOTAsXG4gICAgICBjdXJ2ZTogRVhDTFVTSVZFX0NVUlZFLFxuICAgICAgLy8g54us5a626aKR5q6177yaUyDnuqcgNTAlIOamgueOh+ebtOaOpeaYryBVUCDop5LoibLvvIzmrarkuIDmrKHlkI7kuIvkuIDmrKHlv4XlrpogVVDjgIJcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAga2V5OiBcIndFbmdpbmVDaGFubmVsXCIsXG4gICAgICBtZW1iZXJzOiBbXCIzXCJdLFxuICAgICAgaGFyZFBpdHk6IDgwLFxuICAgICAgY3VydmU6IFdfRU5HSU5FX0NVUlZFLFxuICAgICAgLy8g6Z+z5pOO6aKR5q6177yaNzUlIOebtOaOpSBVUO+8iOS4jeaYryA1MCXvvInvvIzlhaznpLogSlNPTiDljp/mlodcbiAgICAgIC8vIHVwX3Byb2Ig5a+55bqU6L+Z5LiA5qGj77yM55SoIHdlaWdodGVkIOiAjOS4jeaYryBmaWZ0eUZpZnR5IOihqOi+vumdnuWvueensOavlOS+i+OAglxuICAgICAgZ3VhcmFudGVlOiB7IGtpbmQ6IFwid2VpZ2h0ZWRcIiwgcmF0ZVVwQ2hhbmNlOiAwLjc1IH0sXG4gICAgfSxcbiAgICB7XG4gICAgICBrZXk6IFwic3RhbmRhcmRDaGFubmVsXCIsXG4gICAgICBtZW1iZXJzOiBbXCIxXCJdLFxuICAgICAgaGFyZFBpdHk6IDkwLFxuICAgICAgY3VydmU6IEVYQ0xVU0lWRV9DVVJWRSxcbiAgICAgIC8vIOW4uOmpu+mikeaute+8muayoeaciSBVUCDop5LoibLnmoTmpoLlv7XvvIzmir3liLAgUyDnuqflsLHmmK/mir3liLAgUyDnuqfvvIzkuI3lrZjlnKhcIuatqlwi44CCXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJub25lXCIgfSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogXCJiYW5nYm9vQ2hhbm5lbFwiLFxuICAgICAgbWVtYmVyczogW1wiNVwiXSxcbiAgICAgIGhhcmRQaXR5OiA4MCxcbiAgICAgIGN1cnZlOiBXX0VOR0lORV9DVVJWRSxcbiAgICAgIC8vIOmCpuW4g+mikeaute+8mueOqeWutumihOWFiOaMh+Wumuebruagh+mCpuW4g++8jOinpuWPkSBTIOe6p+aXtuWumOaWueWFrOekuiB1cF9wcm9iIOaYr1xuICAgICAgLy8gXCIxMDAuMDAwJVwi4oCU4oCU5rKh5pyJXCLmrapcIueahOamguW/te+8jOeUqCBhbHdheXNSYXRlVXAg6ICM5LiN5pivIHdlaWdodGVkOjFcbiAgICAgIC8vIOabtOWHhuehruWcsOihqOi+vlwi6L+Z5Liq5rGg5a2Q57uT5p6E5LiK5LiN5a2Y5Zyo6Z2eIFVQIOe7k+aenFwi44CCXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJhbHdheXNSYXRlVXBcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAgLy8g4pqg77iPIDEwMu+8iOeLrOWutumHjeaYoO+8ieS4jiAy77yI54us5a626aKR5q6177yJ5piv5ZCm5YWx5Lqr5L+d5bqV6K6h5pWw4oCU4oCUKirmnKrnoa7or4EqKuOAglxuICAgICAgLy8g5a6Y5pa55qaC546H5YWs56S66aG155So55qE5piv5Y+m5LiA5aWX5YaF6YOo57yW5Y+377yM5LiO5oq95Y2h6K6w5b2VIEFQSSDnmoQgZ2FjaGFfdHlwZVxuICAgICAgLy8g5a+55LiN5LiK77yM5peg5rOV55u05o6l5q+U5a+577yb56ys5LiJ5pa5IHdpa2kg56ew54us56uL5L2G5rKh5pyJ5a6Y5pa556Gu6K6k44CC6L+Z6YeM5oyJXG4gICAgICAvLyBcIueLrOeri+S/neW6lee7hFwi5aSE55CG77yM5piv5L+d5a6I6YCJ5oup6ICM6Z2e5bey6aqM6K+B57uT6K664oCU4oCU6Iul5ZCO57ut6K+B5a6eIDEwMiDkuI4gMlxuICAgICAgLy8g5a6e6ZmF5YWx5Lqr5L+d5bqV6K6h5pWw77yM6ZyA6KaB5oqK6L+Z6YeM5ZCI5bm25oiQ5ZCM5LiA5LiqIFBpdHlHcm91cO+8iOaUuSBtZW1iZXJzOlxuICAgICAgLy8gW1wiMlwiLCBcIjEwMlwiXe+8ie+8jOeOsOWcqOWFiOWIhuW8gOW7uue7hO+8jOmBv+WFjee8lumAoOS4gOS4quacque7j+mqjOivgeeahOWQiOW5tuWFs+ezu+OAglxuICAgICAga2V5OiBcImV4Y2x1c2l2ZUNoYW5uZWxSZXJ1blwiLFxuICAgICAgbWVtYmVyczogW1wiMTAyXCJdLFxuICAgICAgaGFyZFBpdHk6IDkwLFxuICAgICAgY3VydmU6IEVYQ0xVU0lWRV9DVVJWRSxcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcImZpZnR5RmlmdHlcIiB9LFxuICAgIH0sXG4gICAge1xuICAgICAgLy8g5ZCM5LiK77yaMTAz77yI6Z+z5pOO5Zue5ZON77yJ5LiOIDPvvIjpn7Pmk47popHmrrXvvInnmoTkv53lupXlhbHkuqvlhbPns7vlkIzmoLfmnKrnoa7or4HvvIxcbiAgICAgIC8vIOeLrOeri+W7uue7hO+8jOeQhueUseS4jiAxMDIg5a6M5YWo5LiA6Ie044CCXG4gICAgICBrZXk6IFwid0VuZ2luZUNoYW5uZWxFY2hvXCIsXG4gICAgICBtZW1iZXJzOiBbXCIxMDNcIl0sXG4gICAgICBoYXJkUGl0eTogODAsXG4gICAgICBjdXJ2ZTogV19FTkdJTkVfQ1VSVkUsXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJ3ZWlnaHRlZFwiLCByYXRlVXBDaGFuY2U6IDAuNzUgfSxcbiAgICB9LFxuICBdLFxuXG4gIC8vIOKYhSDmnKzmj5Lku7bmnIDph43opoHnmoTpqozor4HngrnvvJrnqIDmnInluqbpmLbmoq/mmK8gMi8zLzTvvIzkuI3mmK8gMy80LzXigJTigJTnnJ/lrp7lrZjmoaPlhajph49cbiAgLy8g6K6w5b2V5a6e5rWLIHJhbmtfdHlwZSDlj6rlh7rnjrDov5nkuInkuKrlgLzvvIzmnIDpq5jmoaPmmK8gNO+8iFMg57qn77yJ5LiN5pivIDXjgILlrr/kuLvmn6Xor6JcbiAgLy8g5L+d5bqV5ZG95Lit5b+F6aG76LWwIGBXSEVSRSByYXJpdHkgPSA6cGl0eV90YXJnZXRg77yM5LiN6IO95pyJ5Lu75L2VIFwiPSA1XCIg5a2X6Z2i6YeP44CCXG4gIHJhcml0eTogeyBsYWRkZXI6IFtcIjJcIiwgXCIzXCIsIFwiNFwiXSwgcGl0eVRhcmdldDogXCI0XCIgfSxcblxuICB0aW1lOiB7XG4gICAgLy8g55u06L+e5a6Y5pa5IEFQSSDlvpfliLDnmoTmmK/mnI3liqHlmajmnKzlnLDml7bpl7TvvIzkuI3nu4/ov4fku7vkvZXnrKzkuInmlrnlt6XlhbfnmoTkuozmrKFcbiAgICAvLyDmnKzlnLDljJblpITnkIbigJTigJTlt7LnlKggYHp6ei1zaWduYWwtc2VhcmNoLWV4cG9ydC9zcmMvbWFpbi9nZXREYXRhLmpzOjQ2MC00NzRgXG4gICAgLy8g5rqQ56CB5qC45a6e77ya6K+l5bel5YW35Lya5oqKIGBpdGVtLnRpbWVgIOS7jiBgcmVnaW9uX3RpbWVfem9uZWAg5o2i566X5YiwXG4gICAgLy8gYGxvY2FsVGltZVpvbmVg77yI5aSa6LSm5Y+35ZCI5bm25Zy65pmv5LiL5Lik6ICF5Y+v6IO95LiN5ZCM77yJ77yb5L2G5pys5o+S5Lu25LiN57uP6L+H6L+Z5bGCXG4gICAgLy8g5bel5YW35aSE55CG77yM55u06L+eIEFQSSDmi7/liLDnmoTlsLHmmK/ljp/lp4vmnI3liqHlmajmnKzlnLDml7bpl7TlrZfnrKbkuLLvvIzkuI3pgILnlKjov5nmnaFcbiAgICAvLyDmjaLnrpfpo47pmanjgIJcbiAgICByYXdUaW1lQ29udmVudGlvbjogXCJzZXJ2ZXJMb2NhbFwiLFxuICAgIC8vIOW3ruW8gueCue+8muaXtuWMuuadpea6kOaYryByZWdpb24g5a2X5q61ICsg5a6i5oi356uv6Z2Z5oCB6KGo77yM5LiN5pivIGFwaUZpZWxk4oCU4oCUXG4gICAgLy8gQVBJIOWPqui/lOWbniByZWdpb27vvIjlpoIgXCJwcm9kX2dmX2NuXCLvvInvvIzkuI3ov5Tlm57ku7vkvZXlvaLlvI/nmoQgVVRDIOWBj+enu+mHj++8jFxuICAgIC8vIOaNoueul+ihqOeUseWuouaIt+err+e7tOaKpOOAglxuICAgIHRpbWV6b25lU291cmNlOiB7XG4gICAgICBraW5kOiBcInN0YXRpY1RhYmxlXCIsXG4gICAgICBmaWVsZDogXCJyZWdpb25cIixcbiAgICAgIC8vIOS6lOadoeWMuuacjeeggeWIsCBVVEMg5YGP56e76YeP55qE5a6M5pW05pig5bCE77yM5Y+M5p2l5rqQ6YCQ6aG55qC45a+55LiA6Ie077yM6Zu25YiG5q2n77yaXG4gICAgICAvLyAgIGB6enotc2lnbmFsLXNlYXJjaC1leHBvcnQvc3JjL21haW4vZ2V0RGF0YS5qczozMy0zOWDvvIhzZXJ2ZXJUaW1lWm9uZe+8iVxuICAgICAgLy8gICBgSG9Zby5HYWNoYS9jcmF0ZXMvZ2FtZV9iaXovc3JjL2xpYi5yczoxNDUtMTQ5YO+8iOWMuuacjeeggeWtl+espuS4suW4uOmHj++8iVxuICAgICAgLy8gICAgIOS4jiBgOjIwMC0yMDRg77yITkFQX0NOL05BUF9HTE9CQUxfSlAvRVUvVVMvU0cg5LqU5Liq5Y+Y5L2T57uR5a6a55qE5YGP56e76YeP77yJXG4gICAgICAvLyDimqDvuI8gcHJvZF9nZl9qcCDlkI3lrZflg4/ml6XmnI3vvIzlrp7pmYXmmK/kuprmnI3igJTigJRIb1lvLkdhY2hhIOa6kOeggeWcqOi/meS4gOihjOeahFxuICAgICAgLy8g6KGM5bC+5rOo6YeK55u05LmmIFwiLy8gQXNpYVwi77yIbGliLnJzOjIwMe+8ie+8jOS4jeimgeaMieWtl+mdouWQjeivr+WIpOaIkOaXpeacrOaXtuWMuuOAglxuICAgICAgdGFibGU6IHtcbiAgICAgICAgcHJvZF9nZl9jbjogOCxcbiAgICAgICAgcHJvZF9nZl9qcDogOCxcbiAgICAgICAgcHJvZF9nZl91czogLTUsXG4gICAgICAgIHByb2RfZ2ZfZXU6IDEsXG4gICAgICAgIHByb2RfZ2Zfc2c6IDgsXG4gICAgICB9LFxuICAgIH0sXG4gICAgLy8gcmF3Rm9ybWF0IOS4jeWjsOaYjuKAlOKAlOWTjeW6lCB0aW1lIOWtl+auteaYr+epuuagvOWIhumalOeahCBcIllZWVktTU0tREQgSEg6bW06c3NcIlxuICAgIC8vIO+8iOecn+WunuWtmOaho+Wunua1i+S4gOiHtO+8ie+8jOato+WlveaYryBMMSDojIPlvI/lsYLnmoTnvLrnnIHlgLwgc3BhY2VTZXBhcmF0ZWTvvIzkuI3pnIDopoFcbiAgICAvLyDmmL7lvI/opobnm5bjgIJcbiAgfSxcblxuICAvLyDkuI7ljp/npZ7kuIDoh7TnmoTojIPlvI8gQSDpgJrnlKjln7rnur/nrZbnlaXvvIzpnZ7nu53ljLrpm7bkuJPlsZ7lt67lvILngrnvvJrliIbpobXlk43lupTog73mi7/liLDnmoRcbiAgLy8g5Y+q5piv44CM6L+Z5LiA6aG15pyJ5rKh5pyJ5pu05aSa44CN77yM5a6Y5pa55Lmf5rKh5pyJ5Y+m5aSW55qE5p2D5aiB6IGa5ZCI57uf6K6h5o6l5Y+j77yM5Zug5q2k55SoXG4gIC8vIGluR2FtZVBhZ2VDb3VudO+8iOmbtuaIkOacrOOAgeWFqOimhuebluOAgeaXoOmineWkluWHreaNrumjjumZqe+8ie+8jOS4jeaYr+e7neWMuumbtueJueacieWGs+etluOAglxuICBiYXNlbGluZTogeyBraW5kOiBcImluR2FtZVBhZ2VDb3VudFwiIH0sXG5cbiAgcmV0ZW50aW9uOiB7XG4gICAgZGlzcGxheVRleHQ6IHsgXCJ6aC1DTlwiOiBcIjYg5Liq5pyIXCIgfSxcbiAgICBjb25zZXJ2YXRpdmVEYXlzOiA2ICogMjgsXG4gIH0sXG5cbiAgLy8gaXRlbUlkU291cmNlIOS4jeWjsOaYju+8jOe8uuecgSBcIm5hdGl2ZVwi4oCU4oCU6KeB5LiK5pa5IGV4dHJhY3RSZWNvcmQg6YeMIGl0ZW1JZFxuICAvLyDml4HnmoTor7TmmI7vvJrnu53ljLrpm7YgQVBJIOebtOaOpei/lOWbniBpdGVtX2lk77yM5LiN5piv5Y6f56We6YKj56eNXCLmnKzlnLDljJbnianlk4HlkI1cIueJueS+i+OAglxuXG4gIC8vIHByZWNvbmRpdGlvbnMgLyBtZXRhZGF0YSDlnYfkuI3lo7DmmI7igJTigJTljp/npZ7pgqPmnaFcIua4uOaIj+iHs+Wwkei/kOihjOi/h+S4gOasoe+8jOe8k+WtmFxuICAvLyDnm67lvZXmiY3kvJrooqvliJvlu7pcIueahOWJjee9ruadoeS7tuacuuWItuS4iuWvuee7neWMuumbtuWQjOagt+aIkOeri++8iOWQjOS4gOWllyBjaHJvbWl1bUNhY2hlXG4gIC8vIOWHreaNruiOt+WPluacuuWItu+8ie+8jOS9huacrOasoeS7u+WKoeeahOi1hOaWmeiMg+WbtO+8iHJlc2VhcmNoLzAx44CBMDPjgIEwNCArXG4gIC8vIOS4iumdouWIl+WHuueahOa6kOeggeW8leeUqO+8ieayoeacieimhueblue7neWMuumbtuS4k+WxnueahOWJjee9ruadoeS7tuW3ruW8gu+8jOS4jemineWklue8lumAoO+8jFxuICAvLyDliKTmlq3kuI4gYGRyaWxscy96enovbWFuaWZlc3QudHNgIOS4gOiHtOOAglxufSBzYXRpc2ZpZXMgUGx1Z2luTWFuaWZlc3Q7XG4iXSwibWFwcGluZ3MiOiI7OztDQWtCQSxNQUFhQSxVQUFxQjtFQUNoQyxrQkFBa0IsU0FBUyxRQUFRO0dBQ2pDLE1BQU0sYUFBYSxJQUFJLElBQUksS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDO0dBQzFDLElBQUksZUFBZSxLQUFLLE9BQU87R0FDL0IsSUFBSSxlQUFlLEtBQUssT0FBTztHQUMvQixPQUFPO0VBQ1Q7RUFFQSxrQkFBa0IsV0FBVztHQUMzQixJQUFJLENBQUMsT0FBTyxVQUNWLE1BQU0sSUFBSSxNQUNSLHdEQUF3RCxPQUFPLE9BQU8sRUFDeEU7R0FJRixPQUFPLEdBQUcsT0FBTyxTQUFTLEdBQUcsT0FBTztFQUN0QztDQUNGOzs7Ozs7Ozs7Ozs7O0NDSkEsU0FBU0Msc0JBQW9CLFVBQThCO0VBQ3pELElBQUksT0FBTyxhQUFhLFlBQVksYUFBYSxNQUFNLE9BQU8sQ0FBQztFQUMvRCxNQUFNLE9BQVEsU0FBZ0M7RUFDOUMsSUFBSSxPQUFPLFNBQVMsWUFBWSxTQUFTLE1BQU0sT0FBTyxD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