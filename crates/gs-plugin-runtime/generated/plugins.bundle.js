// 本文件由 scripts/gs-bundle-plugins.mjs 生成，禁止手改。
// 修改请改动 plugins/<game>/manifest.ts 或 hooks.ts 后重跑该脚本。
// 不压缩、保留函数名与行号，文件末尾的 inline sourcemap 映射回原始 .ts 行号。
(function() {

//#region plugins/genshin/hooks.ts
	const hooks$1 = {
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
	function extractGachaLogList(response) {
		if (typeof response !== "object" || response === null) return [];
		const data = response.data;
		if (typeof data !== "object" || data === null) return [];
		const list = data.list;
		return Array.isArray(list) ? list : [];
	}
	/** 可选但不接受空串——空串必须被当成「没有值」，不能冒充「有值」。 */
	function toNonEmptyString$1(value) {
		if (typeof value !== "string") return void 0;
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : void 0;
	}
	/** 官方响应里的 `count` 是数字字符串（如 `"1"`），防御式转换，异常输入兜底为 1。 */
	function toCount$1(value) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 1;
	}
	const manifest$1 = {
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
				extractList: extractGachaLogList
			}
		},
		fields: { extractRecord: (raw) => {
			if (typeof raw !== "object" || raw === null) throw new Error("原神 extractRecord 收到非对象形态的原始记录");
			const record = raw;
			const name = toNonEmptyString$1(record.name);
			const stableId = toNonEmptyString$1(record.id);
			const itemId = name ?? stableId;
			if (!itemId) throw new Error("原神 extractRecord：记录既无 name 也无 id，无法确定 itemId");
			return {
				itemId,
				time: toNonEmptyString$1(record.time) ?? "",
				bannerId: toNonEmptyString$1(record.gacha_type) ?? "",
				count: toCount$1(record.count),
				name,
				itemType: toNonEmptyString$1(record.item_type),
				rarity: toNonEmptyString$1(record.rank_type),
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
	const hooks = { deriveRecordKeys: (records) => {
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
	function toNonEmptyString(value) {
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
	function toCount(value) {
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
	const manifest = {
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
				time: toNonEmptyString(record.time) ?? "",
				bannerId: "wuwa-banner-identity-not-derivable-from-response",
				count: toCount(record.count),
				name: toNonEmptyString(record.name),
				itemType: toNonEmptyString(record.resourceType),
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
//#region \0gs-plugins-entry
	globalThis.__gs_plugins = globalThis.__gs_plugins || {};
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiX2dzLXBsdWdpbnMtZW50cnkuanMiLCJuYW1lcyI6WyJob29rcyIsInRvTm9uRW1wdHlTdHJpbmciLCJ0b0NvdW50IiwibWFuaWZlc3QiXSwic291cmNlcyI6WyIuLi9wbHVnaW5zL2dlbnNoaW4vaG9va3MudHMiLCIuLi9wbHVnaW5zL2dlbnNoaW4vbWFuaWZlc3QudHMiLCIuLi9wbHVnaW5zL3d1d2EvaG9va3MudHMiLCIuLi9wbHVnaW5zL3d1d2EvbWFuaWZlc3QudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiDljp/npZ7mj5Lku7bnmoTpgIPnlJ/oiLEgaG9va3PjgIJcbiAqXG4gKiDkuKTkuKogaG9vayDlnYfkuI3lj6/nnIHnlaXvvJpcbiAqXG4gKiAtIGByZXNvbHZlVGltZXpvbmVg77ya57Gz5ZOI5ri4IGBnZXRHYWNoYUxvZ2Ag5ZON5bqU5LiN5bim5Lu75L2V5pe25Yy65a2X5q6177yI5pei5pegIGByZWdpb25gXG4gKiAgIOS5n+aXoCBgcmVnaW9uX3RpbWVfem9uZWDvvInvvIzlj6rog73mjIkgVUlEIOmmluS9jeaVsOWtl+aOqOaWreacjeWKoeWZqOaJgOWcqOaXtuWMuuOAglxuICogICDlj4LogIPlrp7njrDlt7LnlKjkuInmlrnlt6XlhbfmupDnoIHmoLjlrp7vvJpgdWlkWzBdPT09JzYn4oaSLTUsICc3J+KGkjEsIGVsc2UgOGBcbiAqICAg77yIZG9jcy9faW50ZXJuYWwvcmVzZWFyY2gvMDQt5ZCM5peP5bel5YW35LiJ5pa55rqQ56CB5a+55q+ULm1kIMKnNC4077yJ44CCXG4gKiAtIGBkZXJpdmVSZWNvcmRLZXlg77ya5pyN5Yqh56uv6Zuq6IqxIElEIOS4jeWQq+WNoeaxoOe7tOW6puOAguWPguiAg+WunueOsCBIb1lvLkdhY2hhIOS4iue6v+aXtlxuICogICDkuLvplK7mmK8gYChidXNpbmVzcywgdWlkLCBpZClg77yM5LiA5bm05ZCO5Li65pif6ZOB6IGU5Yqo5rGgIGBnZXRMZEdhY2hhTG9nYCDooaXkuobkuIDmrKFcbiAqICAg5pW06KGo6YeN5bu66L+B56e777yM5pS55oiQIGAoYnVzaW5lc3MsIHVpZCwgaWQsIGdhY2hhX3R5cGUpYOKAlOKAlFNRTGl0ZSDmlLnkuI3kuobkuLvplK7vvIxcbiAqICAg6L+Z5Liq5Luj5Lu35LiN6K+l55WZ5Yiw5Lul5ZCO5omN6KGl44CC57Gz5ZOI5ri45LiJ5ri45LiA5b6L5oyJ5ZCM5LiA6KeE5YiZ5a6e546w5pysIGhvb2vvvIzljbPkvb/ljp/npZ5cbiAqICAg55uu5YmN5Y+q5pyJ5Y2V5LiA56uv54K544CB5bCa5pyq6KeC5rWL5Yiw6Leo56uv54K56Zuq6IqxIElEIOeisOaSnu+8jOS5n+S4jeS+i+WkllxuICogICDvvIhwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L21hbmlmZXN0LnRzIOeahCBgUGx1Z2luSG9va3MuZGVyaXZlUmVjb3JkS2V5YCDmlofmoaPvvInjgIJcbiAqL1xuaW1wb3J0IHR5cGUgeyBQbHVnaW5Ib29rcyB9IGZyb20gXCJncy1wbHVnaW4ta2l0XCI7XG5cbmV4cG9ydCBjb25zdCBob29rczogUGx1Z2luSG9va3MgPSB7XG4gIHJlc29sdmVUaW1lem9uZTogKF9yZWNvcmQsIGN0eCkgPT4ge1xuICAgIGNvbnN0IGZpcnN0RGlnaXQgPSBjdHgudWlkLnRyaW0oKS5jaGFyQXQoMCk7XG4gICAgaWYgKGZpcnN0RGlnaXQgPT09IFwiNlwiKSByZXR1cm4gLTU7IC8vIOe+juacjVxuICAgIGlmIChmaXJzdERpZ2l0ID09PSBcIjdcIikgcmV0dXJuIDE7IC8vIOasp+acjVxuICAgIHJldHVybiA4OyAvLyDlm73mnI0gLyDkuprmnI3nrYnlhbbkvZnljLrmnI3vvIzlkKvmnKrnn6XljLrmnI3nmoTkv53lrojpu5jorqTlgLxcbiAgfSxcblxuICBkZXJpdmVSZWNvcmRLZXk6IChyZWNvcmQpID0+IHtcbiAgICBpZiAoIXJlY29yZC5zdGFibGVJZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBg5Y6f56We6K6w5b2V57y65bCRIHN0YWJsZUlk77yI5pyN5Yqh56uv6Zuq6IqxIElE77yJ77yM5peg5rOV55Sf5oiQ56iz5a6a55qEIHJlY29yZF9rZXnvvJppdGVtSWQ9XCIke3JlY29yZC5pdGVtSWR9XCJgLFxuICAgICAgKTtcbiAgICB9XG4gICAgLy8g5Y6f5aeLIGdhY2hhX3R5cGXvvIjlj6/og73mmK8gXCI0MDBcIiDov5nnsbvkuI3lj6/ljZXni6zmn6Xor6LnmoTlkIjlubblrZDnsbvlnovvvIkrIOacjeWKoeerr+mbquiKsSBJRO+8jFxuICAgIC8vIOaKiuWNoeaxoOe7tOW6puW5tui/m+WOu++8jOmBv+WFjei3qOerr+eCueWcuuaZr+S4i+ijuOmbquiKsSBJRCDmkp7plK7lkI7ooqsgSU5TRVJUIE9SIElHTk9SRSDpnZnpu5jkuKLlvIPjgIJcbiAgICByZXR1cm4gYCR7cmVjb3JkLmJhbm5lcklkfToke3JlY29yZC5zdGFibGVJZH1gO1xuICB9LFxufTtcbiIsIi8qKlxuICog5Y6f56We5o+S5Lu2IG1hbmlmZXN044CCXG4gKlxuICog6YeH6ZuG6IyD5byP77yaYXV0aGtlee+8iGBncy1wLWF1dGhrZXlg77yJ77yM5Yet5o2u5p2l5rqQ5piv5ri45oiP5YaF572uIENocm9taXVtIOe7hOS7tueahFxuICog56OB55uY57yT5a2Y4oCU4oCU546p5a625omT5byA56WI5oS/6K6w5b2V6aG15pe277yM5a6i5oi356uv5Lya5LulIHdlYnZpZXcg5Yqg6L296K6w5b2V6aG16Z2i77yM5YW25Lit5LiA5qyhXG4gKiDor7fmsYLkvJrlkb3kuK3lrpjmlrkgYGdldEdhY2hhTG9nYCDmjqXlj6PlubbluKbkuIogYGF1dGhrZXlg77yM6L+Z5Liq6K+35rGCIFVSTCDkvJrooqvlhpnlhaVcbiAqIGB3ZWJDYWNoZXNgIOebruW9leS4i+afkOS4queJiOacrOWPt+WtkOebruW9leWGheeahCBgQ2FjaGUvQ2FjaGVfRGF0YS9kYXRhXzJgIOe8k+WtmOe0ouW8leaWh+S7tlxuICog77yI5rOo5oSP77yaSlNEb2Mg5rOo6YeK6YeM5LiN6IO95Ye6546w5a2X6Z2i6YePIFwi5pif5Y+3K+aWnOadoFwi77yM5pWF5q2k5aSE5LiN5YaZ6YCa6YWN56ym5b2i5byP55qE6Lev5b6E77yJ44CCXG4gKlxuICog5a2X5q615b2i54q25LiO55yf5a6e6KGM5Li65bey5a+554Wn5Lul5LiL6LWE5paZ5qCh5YeG77yM6YG/5YWN6YeN6LmIIGBDTEFVREUubG9jYWwubWRgIOiusOW9lei/h+eahFxuICog44CM5pyq5qCh5YeG5bCx5YaZ5a6e546w44CN55qE6ZSZ6K+v77yI6bij5r2u5Yet5o2u6Lev5b6E5LiJ5aSE5o6o57+755qE5pWZ6K6t77yJ77yaXG4gKiAtIGRvY3MvX2ludGVybmFsL3Jlc2VhcmNoLzAzLeecn+WunuWvvOWHuuaVsOaNruagvOW8j+Wunua1iy5tZCDCp+S4gOOAgcKn5LqMXG4gKiAtIGRvY3MvX2ludGVybmFsL3Jlc2VhcmNoLzA0LeWQjOaXj+W3peWFt+S4ieaWuea6kOeggeWvueavlC5tZCDCpzQuMe+9nsKnNC45XG4gKiAtIGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9nZW5zaGluLXdpc2gtZXhwb3J0L3NyYy9tYWluL2dldERhdGEuanPvvIjliIbpobUv5ZCI5bm2L+mZkOmAn+WunueOsO+8iVxuICogLSBkb2NzL2V4YW1wbGUtcHJvamVjdHMvSG9Zby5HYWNoYS9jcmF0ZXMvdXJsX3NjcmFwZXIvc3JjL3R5cGVzLnJz77yIYEdhY2hhTG9nYCDlrZfmrrXlrprkuYnvvIxcbiAqICAg56Gu6K6k5Y6f56WeIEFQSSDlk43lupTph4zmsqHmnIkgYGl0ZW1faWRgIOWtl+auteKAlOKAlOS4juaYn+mTgS/nu53ljLrpm7bkuI3lkIzvvIlcbiAqIC0gZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL3VybF9maW5kZXIvc3JjL2xpYi5yc++8iGBSRUdFWF9HQUNIQV9VUkxg77yMXG4gKiAgIOehruiupOe8k+WtmOmHjOWRveS4reeahOaYryBgLi4uL2dhY2hhX2luZm8vYXBpL2dldEdhY2hhTG9nPy4uLmF1dGhrZXk9Li4uYCDov5nmnaHnnJ/lrp7or7fmsYIgVVJM77yJXG4gKi9cbmltcG9ydCB0eXBlIHsgUGx1Z2luTWFuaWZlc3QgfSBmcm9tIFwiZ3MtcGx1Z2luLWtpdFwiO1xuXG5leHBvcnQgeyBob29rcyB9IGZyb20gXCIuL2hvb2tzLnRzXCI7XG5cbi8qKlxuICog5LuOIGBnZXRHYWNoYUxvZ2Ag5ZON5bqU5L2T6YeM5Y+W5Ye65pys6aG16K6w5b2V5pWw57uE44CCXG4gKlxuICog55yf5a6e5ZON5bqU5b2i5oCB5pivIGB7IHJldGNvZGUsIG1lc3NhZ2UsIGRhdGE6IHsgbGlzdDogWy4uLl0sIHJlZ2lvbiB9IH1gXG4gKiDvvIhIb1lvLkdhY2hhIGBNaWhveW9SZXNwb25zZTxHYWNoYUxvZ3M+YCAvIGdlbnNoaW4td2lzaC1leHBvcnRcbiAqIGBnZXRHYWNoYUxvZ2Ag6YeM55qEIGByZXMuZGF0YS5saXN0YO+8ieOAgumYsuW+oeW8j+ino+aekO+8muS7u+S9leS4gOWxguW9oueKtuS4jeWvueWwsei/lOWbnlxuICog56m65pWw57uE6ICM5LiN5piv5oqb5byC5bi44oCU4oCU5YiG6aG15byV5pOO5Lya5oqK56m65pWw57uE5b2T5L2cIGBlbXB0eVBhZ2VgIOe7iOatouadoeS7tuWkhOeQhu+8jFxuICog6L+Z5q+U6K6p5LiA5qyh5YG25Y+R55qE55W45b2i5ZON5bqU5Lit5pat5pW05p2h6YeH6ZuG5rWB56iL5pu05a6J5YWo44CCXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RHYWNoYUxvZ0xpc3QocmVzcG9uc2U6IHVua25vd24pOiB1bmtub3duW10ge1xuICBpZiAodHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiIHx8IHJlc3BvbnNlID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGRhdGEgPSAocmVzcG9uc2UgYXMgeyBkYXRhPzogdW5rbm93biB9KS5kYXRhO1xuICBpZiAodHlwZW9mIGRhdGEgIT09IFwib2JqZWN0XCIgfHwgZGF0YSA9PT0gbnVsbCkgcmV0dXJuIFtdO1xuICBjb25zdCBsaXN0ID0gKGRhdGEgYXMgeyBsaXN0PzogdW5rbm93biB9KS5saXN0O1xuICByZXR1cm4gQXJyYXkuaXNBcnJheShsaXN0KSA/IGxpc3QgOiBbXTtcbn1cblxuLyoqIOWPr+mAieS9huS4jeaOpeWPl+epuuS4suKAlOKAlOepuuS4suW/hemhu+iiq+W9k+aIkOOAjOayoeacieWAvOOAje+8jOS4jeiDveWGkuWFheOAjOacieWAvOOAjeOAgiAqL1xuZnVuY3Rpb24gdG9Ob25FbXB0eVN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0cmltbWVkIDogdW5kZWZpbmVkO1xufVxuXG4vKiog5a6Y5pa55ZON5bqU6YeM55qEIGBjb3VudGAg5piv5pWw5a2X5a2X56ym5Liy77yI5aaCIGBcIjFcImDvvInvvIzpmLLlvqHlvI/ovazmjaLvvIzlvILluLjovpPlhaXlhZzlupXkuLogMeOAgiAqL1xuZnVuY3Rpb24gdG9Db3VudCh2YWx1ZTogdW5rbm93bik6IG51bWJlciB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgcmV0dXJuIHZhbHVlO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgcGFyc2VkID0gTnVtYmVyKHZhbHVlKTtcbiAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiBwYXJzZWQ7XG4gIH1cbiAgcmV0dXJuIDE7XG59XG5cbmV4cG9ydCBjb25zdCBtYW5pZmVzdCA9IHtcbiAgaWQ6IFwiZ2Vuc2hpblwiLFxuICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi5Y6f56WeXCIgfSxcbiAgc2RrVmVyc2lvbjogXCIxLjAuMFwiLFxuICBwbGF0Zm9ybXM6IFtcIndpbmRvd3NcIl0sXG4gIG1haW50YWluZXJzOiBbXCJnYWNoYS1zdHVkaW9cIl0sXG4gIGV4Y2hhbmdlRm9ybWF0czogW1widWlnZi12NFwiXSxcblxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwiY2hyb21pdW1DYWNoZVwiLFxuICAgICAgICAvLyDimqDvuI8g55u45a+554mH5q6177yM5LiN5piv57ud5a+56Lev5b6E4oCU4oCU57ud5a+55a6J6KOF55uu5b2V5p2l6Ieq55So5oi36YWN572u77yM55SxIFJ1c3Qg5L6n5ou85o6l44CCXG4gICAgICAgIGdhbWVEaXI6IFwiWXVhblNoZW5fRGF0YS93ZWJDYWNoZXNcIixcbiAgICAgICAgdXJsUGF0dGVybjogL2h0dHBzOlxcL1xcLy4rP2dldEdhY2hhTG9nW15cIl0rLyxcbiAgICAgIH0sXG4gICAgICByZXF1ZXN0OiB7XG4gICAgICAgIHVybDogXCJ7e2NyZWRlbnRpYWx9fSZwYWdlPXt7cGFnZX19JmdhY2hhX3R5cGU9e3tnYWNoYVR5cGV9fSZzaXplPXt7cGFnZVNpemV9fSZlbmRfaWQ9MFwiLFxuICAgICAgfSxcbiAgICAgIC8vIOWbveacjSArIOWbvemZheacjeS4pOS4qiBob3N0IOmDveimgeaUtuW9le+8mnVybFBhdHRlcm7vvIjkuIrmlrnvvInmnKzouqvkuI3ljLrliIbln5/lkI3vvIxcbiAgICAgIC8vIOWPquimgSBVUkwg6YeM5Ye6546wIFwiZ2V0R2FjaGFMb2dcIiDlsLHkvJrljLnphY3igJTigJTkuZ/lsLHmmK/or7TvvIzlkIzkuIDku73mj5Lku7bml6LkvJpcbiAgICAgIC8vIOS7juWbveacjeWuouaIt+err+S5n+S8muS7juWbvemZheacjeWuouaIt+err+eahOe8k+WtmOmHjOaJq+WHuuWHreaNriBVUkzvvIzoi6Xlj6rlo7DmmI7lm73mnI1cbiAgICAgIC8vIGhvc3TvvIzlm73pmYXmnI3njqnlrrbnmoTmraPluLjor7fmsYLkvJrooqvov5nph4zmlrDliqDnmoTnmb3lkI3ljZXor6/liKTkuLrmipXmr5LogIzmi5Lnu53jgIJcbiAgICAgIC8vIOS4pOS4quWfn+WQjeW3sueUqCBIb1lvLkdhY2hhIOa6kOeggeaguOWunu+8iOmdnuacrOaPkuS7tueLrOeri+Wunua1i++8jOS7heS9nOS6i+WunuW8leeUqO+8ie+8mlxuICAgICAgLy8gZG9jcy9leGFtcGxlLXByb2plY3RzL0hvWW8uR2FjaGEvY3JhdGVzL2dhbWVfYml6L3NyYy9hcGkucnM6MzUtMzZcbiAgICAgIC8vICAgKChIazRlLCBPZmZpY2lhbCksIFN0YW5kYXJkKSAtPiBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1oazRlLm1paG95by5jb20vLi4uXCJcbiAgICAgIC8vICAgKChIazRlLCBPdmVyc2VhKSwgIFN0YW5kYXJkKSAtPiBcImh0dHBzOi8vcHVibGljLW9wZXJhdGlvbi1oazRlLXNnLmhveW92ZXJzZS5jb20vLi4uXCJcbiAgICAgIC8vIOS4jiBmaXh0dXJlcy9nZW5zaGluL2NyZWRlbnRpYWwvZGF0YV8yLnNhbXBsZSDph4znmoTnpLrkvosgVVJM77yI5Zu95pyN77yMXG4gICAgICAvLyBwdWJsaWMtb3BlcmF0aW9uLWhrNGUubWlob3lvLmNvbe+8ieS6kuebuOWNsOivge+8jGRhdGFfMi5zYW1wbGUg5pys6Lqr5Y+qXG4gICAgICAvLyDopobnm5bkuoblm73mnI3ov5nkuIDnp43vvIzlm73pmYXmnI0gaG9zdCDooaXlhYXoh6rkuIrpnaLov5nku73mupDnoIHlvJXnlKjjgIJcbiAgICAgIGFsbG93ZWRIb3N0czogW1wicHVibGljLW9wZXJhdGlvbi1oazRlLm1paG95by5jb21cIiwgXCJwdWJsaWMtb3BlcmF0aW9uLWhrNGUtc2cuaG95b3ZlcnNlLmNvbVwiXSxcbiAgICAgIGV4dHJhY3RMaXN0OiBleHRyYWN0R2FjaGFMb2dMaXN0LFxuICAgIH0sXG4gIH0sXG5cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIuWOn+elniBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgY29uc3QgbmFtZSA9IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLm5hbWUpO1xuICAgICAgY29uc3Qgc3RhYmxlSWQgPSB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5pZCk7XG4gICAgICAvLyDimqDvuI8g5Y6f56WeIEFQSSDkuI3ov5Tlm54gaXRlbV9pZOKAlOKAlOW3sueUqOa6kOeggeaguOWunu+8mkhvWW8uR2FjaGEg55qEXG4gICAgICAvLyBgY3JhdGVzL3VybF9zY3JhcGVyL3NyYy90eXBlcy5yczoxNTBgIOaYryBgaXRlbV9pZDogT3B0aW9uPHUzMj5g77yMXG4gICAgICAvLyDkuJQgYGhhc19pdGVtX2lkKClgIOeahCBkb2MgY29tbWVudCDnm7TkuaYgXCJFeGNlcHQgZm9yICdHZW5zaGluIEltcGFjdCdcIuOAglxuICAgICAgLy9cbiAgICAgIC8vIOWboOatpOi/memHjOeahCBpdGVtSWQg5pivKirkuLTml7blgLzvvJrmnKzlnLDljJbnianlk4HlkI0qKu+8jOS4jeaYr+ecn+ato+eahOeJqeWTgeagh+ivhuOAglxuICAgICAgLy8g5ZCO5p6c5b+F6aG76K+05riF5qWa77yM5ZCm5YiZ5LiL5LiA5Liq6K+76L+Z5q615Luj56CB55qE5Lq65Lya5Lul5Li65a6D5bey57uP5a+55LqG77yaXG4gICAgICAvLyAgIOKRoCBpdGVtX2NhdGFsb2cg5Li76ZSu5pivIChwbHVnaW5faWQsIGl0ZW1faWQsIGxhbmcp44CCaXRlbUlkIOiLpeaYr+acrOWcsOWMluWQje+8jFxuICAgICAgLy8gICAgICDlkIzkuIDkuKrop5LoibLlnKggemgtY24g5LiOIGVuLXVzIOS4i+S8muS6p+WHuuS4pOS4quS4jeWQjOeahCBpdGVtX2lk77yM6Leo6K+t6KiA6IGa5ZCI5aSx5pWI77ybXG4gICAgICAvLyAgIOKRoSBgZ2FjaGFfcmVjb3JkLmxhbmdgIOi/meS4gOWIl+eahOiuvuiuoeaEj+Wbvu+8iHJlc2VhcmNoLzA1IMKnMi4y77yJ5q2j5pivXG4gICAgICAvLyAgICAgIOOAjG5hbWXihpJpdGVtX2lkIOWPjeafpeS+nei1liBsb2NhbGXvvIzlrZflhbjmm7TmlrDlkI7opoHog73ph43mlL7moKHmraPjgI3igJTigJRcbiAgICAgIC8vICAgICAg6ICM5Y+N5p+l6L+Z5LiA5q2l546w5Zyo5qC55pys5rKh5Y+R55Sf77ybXG4gICAgICAvLyAgIOKRoiDmm7TopoHlkb3nmoTmmK8gbmFtZSDkuI4gcmFyaXR5IOmDveacieWAvO+8jOW9kuS4gOWMluWxguaMieeOsOacieinhOWImeS8muaKiui/meexu+iusOW9leagh+aIkFxuICAgICAgLy8gICAgICBtZXRhX3N0YXRlPSdjb21wbGV0ZSfvvIzkuo7mmK8gaWR4X3JlY29yZF9tZXRhX3BlbmRpbmcg6YKj5p2h6YOo5YiG57Si5byVXG4gICAgICAvLyAgICAgIOawuOi/nOaJq+S4jeWIsOWug+S7rOKAlOKAlCoq6ZSZ55qE5pWw5o2u6KKr5qCH6K6w5Li65a6M5pW077yM5rKh5pyJ5Lu75L2V5py65Yi25Lya5p2l57qg5q2jKirjgIJcbiAgICAgIC8vXG4gICAgICAvLyDkuI3lnKjmnKwgU3RhZ2Ug57yW6YCgIG1ldGFkYXRhLnBhcnNlUmVzcG9uc2XvvIhVSUdGIOWtl+WFuCBBUEkg55qE5ZON5bqU5b2i54q25bCa5pyqXG4gICAgICAvLyDnlKjnnJ/lrp7lrp7njrDmoKHlh4bvvIznoaznuqbmnZ/npoHmraLmnKrmoKHlh4blsLHlhpnlrp7njrDvvInjgILkvYbov5nkuKrnvLrlj6PkuI3og73lgZzlnKjms6jph4rph4zvvJpcbiAgICAgIC8vIOW3suWIl+S4uiBNMS1TMyDlvZLkuIDljJblsYLkuI4gTTEtUzUg5YWD5pWw5o2u5raI6LS555qE6Zi75aGe6aG577yM6KeBXG4gICAgICAvLyBgbWlsZXN0b25lcy8wMi1NMS3ljp/npZ7mj5Lku7blhajpk77ot68ubWRgIFMz44CBUzUg55qEIGNoZWNrbGlzdOOAglxuICAgICAgY29uc3QgaXRlbUlkID0gbmFtZSA/PyBzdGFibGVJZDtcbiAgICAgIGlmICghaXRlbUlkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIuWOn+elniBleHRyYWN0UmVjb3Jk77ya6K6w5b2V5pei5pegIG5hbWUg5Lmf5pegIGlk77yM5peg5rOV56Gu5a6aIGl0ZW1JZFwiKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbUlkLFxuICAgICAgICB0aW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC50aW1lKSA/PyBcIlwiLFxuICAgICAgICAvLyDkv53nlZnmr4/mnaHorrDlvZXoh6rlt7HnmoTljp/lp4sgZ2FjaGFfdHlwZe+8iOiAjOS4jeaYr+acrOasoeafpeivoueUqOeahOaxoOWtkCBpZO+8ieKAlOKAlFxuICAgICAgICAvLyAzMDEg5YiG57uE6YeM5re35pyJIGdhY2hhX3R5cGU6IFwiNDAwXCIg55qE6K6w5b2V5piv5Y6f56We55qE55yf5a6e6KGM5Li6XG4gICAgICAgIC8vIO+8iHJlc2VhcmNoLzAzIMKnMi4y77yMNjE3MCDmnaHnu4TlhoXmt7fmnInkuKTnp43lj5blgLzvvInvvIzlv4Xpobvljp/moLfkv53nlZnmiY3og73orqlcbiAgICAgICAgLy8gcGl0eUdyb3VwcyDnmoQgMzAxLzQwMCDlkIjlubbnlJ/mlYjvvIzkuZ/mmK/nlZnlupXjgIHlj6/ph43mlL7nmoTliY3mj5DjgIJcbiAgICAgICAgYmFubmVySWQ6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLmdhY2hhX3R5cGUpID8/IFwiXCIsXG4gICAgICAgIGNvdW50OiB0b0NvdW50KHJlY29yZC5jb3VudCksXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGl0ZW1UeXBlOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5pdGVtX3R5cGUpLFxuICAgICAgICByYXJpdHk6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLnJhbmtfdHlwZSksXG4gICAgICAgIHN0YWJsZUlkLFxuICAgICAgfTtcbiAgICB9LFxuICB9LFxuXG4gIGJhbm5lcnM6IFtcbiAgICB7IGlkOiBcIjMwMVwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6KeS6Imy5rS75Yqo56WI5oS/XCIgfSB9LFxuICAgIHsgaWQ6IFwiMzAyXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLmrablmajmtLvliqjnpYjmhL9cIiB9IH0sXG4gICAgeyBpZDogXCIyMDBcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuW4uOmpu+eliOaEv1wiIH0gfSxcbiAgICB7IGlkOiBcIjUwMFwiLCBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6ZuG5b2V56WI5oS/XCIgfSB9LFxuICAgIHsgaWQ6IFwiMTAwXCIsIGRpc3BsYXlOYW1lOiB7IFwiemgtQ05cIjogXCLmlrDmiYvnpYjmhL9cIiB9IH0sXG4gICAgLy8gNDAwIOS4jeaYr+S4gOS4quWPr+WNleeLrOafpeivoueahOaxoOWtkO+8iOS4jeS8muS7pSA0MDAg5L2c5Li65Y2h5rGg5Y+W5YC85Y+R6LW36K+35rGC77yJ77yMXG4gICAgLy8g5L2G5a6D5pivIDMwMSDlk43lupTph4znnJ/lrp7lh7rnjrDnmoQgZ2FjaGFfdHlwZSDlj5blgLzvvIzlv4Xpobvlo7DmmI7kuLrni6znq4sgQmFubmVyU3BlY++8jFxuICAgIC8vIHBpdHlHcm91cHNbXS5tZW1iZXJzIOaJjeiDveWQiOazleW8leeUqOWug+KAlOKAlOWQpuWImSBiYW5uZXJJZD1cIjQwMFwiIOeahOiusOW9leS8muaMh+WQkVxuICAgIC8vIOS4gOS4quS4jeWtmOWcqOeahCBCYW5uZXJTcGVj77yM6KeB5pys5paH5Lu25pyr5bC+44CM5YGP5beu5LiO5Y+R546w44CN6K+05piO44CCXG4gICAgeyBpZDogXCI0MDBcIiwgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBcIuinkuiJsua0u+WKqOeliOaEv++8iDQwMCDlrZDnsbvlnovvvIzpmo8gMzAxIOS4gOW5tui/lOWbnu+8iVwiIH0gfSxcbiAgXSxcblxuICBwaXR5R3JvdXBzOiBbXG4gICAge1xuICAgICAga2V5OiBcImNoYXJhY3RlckV2ZW50V2lzaFwiLFxuICAgICAgbWVtYmVyczogW1wiMzAxXCIsIFwiNDAwXCJdLFxuICAgICAgaGFyZFBpdHk6IDkwLFxuICAgICAgLy8gYmFzZS9zdGFydCDlj5boh6rlhazlvIDnmoTnpYjmhL/mpoLnjofor7TmmI7vvJs3NCDmir3otbfnur/mgKfmj5DljYfjgIE4NiDmir3lpJbln7rmnKzlsIHpobbvvIxcbiAgICAgIC8vIDkwIOaKveW/heWHuuKAlOKAlHN0ZXAg6YeH55So5ZCM5Lq656S+5Yy65bm/5rOb5byV55So55qE44CMNzQg5oq96LW35q+P5oq9ICs2JeOAjeWPo+W+hOOAglxuICAgICAgY3VydmU6IHsga2luZDogXCJzb2Z0UGl0eVwiLCBiYXNlOiAwLjAwNiwgc3RhcnQ6IDc0LCBzdGVwOiAwLjA2IH0sXG4gICAgICBndWFyYW50ZWU6IHsga2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgICB9LFxuICBdLFxuXG4gIHJhcml0eTogeyBsYWRkZXI6IFtcIjNcIiwgXCI0XCIsIFwiNVwiXSwgcGl0eVRhcmdldDogXCI1XCIgfSxcblxuICB0aW1lOiB7IHRpbWV6b25lU291cmNlOiB7IGtpbmQ6IFwiY29tcHV0ZWRcIiB9IH0sXG5cbiAgcHJlY29uZGl0aW9uczogW1xuICAgIHtcbiAgICAgIGlkOiBcImdlbnNoaW4uY3JlZGVudGlhbC5jYWNoZURpckV4aXN0c1wiLFxuICAgICAgY2FwYWJpbGl0eTogXCJjcmVkZW50aWFsXCIsXG4gICAgICBsZXZlbDogXCJyZXF1aXJlZFwiLFxuICAgICAgZGVzY3JpYmU6IHtcbiAgICAgICAgXCJ6aC1DTlwiOiBcIuiHquWKqOiOt+WPluaKveWNoemTvuaOpeimgeaxgua4uOaIj+WuouaIt+err+iHs+Wwkei/kOihjOi/h+S4gOasoe+8jOe8k+WtmOebruW9leaJjeS8muiiq+WIm+W7ulwiLFxuICAgICAgfSxcbiAgICAgIC8vIEhvc3RFbnYg55uu5YmN5Y+q5pyJIGdhbWVDbGllbnRTaXplIC8gaW5zdGFsbGVkRGVwZW5kZW5jaWVzIOS4pOS4quWtl+aute+8jOacquaQuuW4plxuICAgICAgLy8g44CMY3JlZGVudGlhbC5nYW1lRGlyIOWjsOaYjueahOe8k+WtmOebruW9leaYr+WQpuW3suiiq+ingua1i+WIsOOAjei/meS4gOS6i+WunuKAlOKAlOi/meato+aYr1xuICAgICAgLy8gZml4dHVyZSDlpZHnuqbmtYvor5XpmLbmrrXlsLHog73lj5HnjrDnmoTlpZHnuqbnvLrlj6PvvIzkuI3mmK/ov5DooYzml7bmiY3mmrTpnLLjgILop4Hmlofku7bmnKvlsL5cbiAgICAgIC8vIOOAjOWBj+W3ruS4juWPkeeOsOOAje+8jOeVmee7mSBncy1ob3N0IOaJqeWxlSBIb3N0RW52IOaXtuihpeS4iuOAglxuICAgICAgY2hlY2s6ICgpID0+ICh7IGtpbmQ6IFwidW5rbm93blwiIH0pLFxuICAgICAgcmVtZWR5OiB7IFwiemgtQ05cIjogXCLor7flhYjlkK/liqjmuLjmiI/lubbmiZPlvIDkuIDmrKHmir3ljaHorrDlvZXpobXvvIzlho3lm57liLDmnKzlupTnlKjph43or5VcIiB9LFxuICAgIH0sXG4gIF0sXG5cbiAgYmFzZWxpbmU6IHsga2luZDogXCJpbkdhbWVQYWdlQ291bnRcIiB9LFxuXG4gIHJldGVudGlvbjoge1xuICAgIGRpc3BsYXlUZXh0OiB7IFwiemgtQ05cIjogXCI2IOS4quaciFwiIH0sXG4gICAgY29uc2VydmF0aXZlRGF5czogNiAqIDI4LFxuICB9LFxuXG4gIC8vIOKaoO+4jyDljp/npZ4gQVBJIOS4jei/lOWbniBpdGVtX2lk77yMZXh0cmFjdFJlY29yZCDnmoQgaXRlbUlkIOaYr+acrOWcsOWMlueJqeWTgeWQjVxuICAvLyDvvIjop4HkuIrmlrkgZXh0cmFjdFJlY29yZCDlhoXnmoTor6bnu4bor7TmmI7kuI4gTTEtUzMg6Zi75aGe6aG55byV55So77yJ44CC5aOw5piO6L+Z5Liq5L+h5Y+3XG4gIC8vIOWQju+8jOWuv+S4u+eahOW9kuS4gOWMluWxguS8muaKiui/meexu+iusOW9leagh+aIkCBtZXRhX3N0YXRlPSdwZW5kaW5nJ++8jOiAjOS4jeaYr+WboOS4ulxuICAvLyBuYW1lL3Jhcml0eSDpg73mnInlgLzlsLHor6/liKTmiJAgY29tcGxldGXigJTigJTplJnnmoQgaXRlbV9pZCDkuI3or6XooqvmoIforrDkuLrlrozmlbTjgIJcbiAgaXRlbUlkU291cmNlOiBcImRpc3BsYXlOYW1lXCIsXG5cbiAgLy8gbWV0YWRhdGEg5a2X5q615pysIFN0YWdlIOWIu+aEj+S4jeWjsOaYju+8jOeQhueUseingeaWh+S7tuacq+WwvuOAjOWBj+W3ruS4juWPkeeOsOOAjeOAglxufSBzYXRpc2ZpZXMgUGx1Z2luTWFuaWZlc3Q7XG4iLCIvKipcbiAqIOm4o+a9ruaPkuS7tueahOmAg+eUn+iIsSBob29rc+OAglxuICpcbiAqIOWPquWunueOsCBgZGVyaXZlUmVjb3JkS2V5c2Ag5LiA5LiqIGhvb2vigJTigJRgcmVzb2x2ZVRpbWV6b25lYCDnvLrlsJFcbiAqIHN2cl9pZC9zdnJfYXJlYSDliLAgVVRDIOWBj+enu+mHj+eahOecn+WunuaYoOWwhOihqO+8jGBjb3VudERyYXdzYCDkuI3pnIDopoHvvIjpuKPmva5cbiAqIGBkcmF3Q291bnRpbmdgIOacquWjsOaYju+8jOi1sOm7mOiupCBgcGVyUmVjb3JkYO+8ie+8jOingSBgLi9tYW5pZmVzdC50c2Ag5a+55bqU5a2X5q61XG4gKiDml4HnmoTms6jph4rjgIJcbiAqXG4gKiAjIyDkuLrku4DkuYjlv4XpobvmmK/mibnlpITnkIbniYjmnKzvvIhgZGVyaXZlUmVjb3JkS2V5c2DvvInvvIzkuI3og73nlKggYGRlcml2ZVJlY29yZEtleWBcbiAqXG4gKiDpuKPmva7lk43lupTorrDlvZXmsqHmnInku7vkvZXlvaLlvI/nmoTnqLPlrpogSUTvvIjop4EgYC4vbWFuaWZlc3QudHNgIOeahFxuICogYGZpZWxkcy5leHRyYWN0UmVjb3JkYCDms6jph4rvvInvvIxgcmVjb3JkX2tleWAg562W55Wl5pivXG4gKiBgaGFzaCjml7bpl7QgKyDnianlk4EgKyDlkIzmibnmrKHlhoXluo/kvY0pYOKAlOKAlFwi5ZCM5om55qyh5YaF5bqP5L2NXCLov5nkuKrkv6Hmga8qKue7k+aehOS4iuWPquaciVxuICog5ZCM5pe255yL5YiwXCLov5nkuIDmibnph4znmoTlhbbkvZnorrDlvZVcIuaJjeeul+W+l+WHuuadpSoq77yM5Y2V6K6w5b2V562+5ZCNXG4gKiBgKHJlY29yZCkgPT4gc3RyaW5nYCDlgZrkuI3liLDvvIzlm6DmraTlv4XpobvnlKjmibnlpITnkIbniYjmnKzjgIJcbiAqXG4gKiAjIyDnnJ/lrp7lrZjmoaPlrp7mtYvnmoTkuKTkuKrnmb7liIbmr5TvvIjkuI3opoHmt7fnlKjvvIlcbiAqXG4gKiBgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqfkuIDlr7kgMzM3MSDmnaHnnJ/lrp7orrDlvZXmjIlcbiAqIGAo5Y2h5rGgLCDml7bpl7QsIOeJqeWTgSlgIOWIhue7hOe7n+iuoeWHuuS4pOS4quS4jeWQjOWQq+S5ieeahOeZvuWIhuavlO+8jOihjOaWh+aXtuW/hemhu+WIhua4healmlxuICog5oyH55qE5piv5ZOq5LiA5Liq77yaXG4gKiAtICoqMzIuNjAl77yIMTA5OS8zMzcx77yJKirigJTigJRrZXkg55qE5q2j56Gu5oCnKirkvp3otZbluo/kvY0qKueahOiusOW9leavlOS+i++8iOeisOaSnue7hFxuICogICDlhajpg6jmiJDlkZjvvJrnu4TlhoXlj6ropoHmnIkg4omlMiDmnaHorrDlvZXvvIzmlbTnu4Tpg73nrpflnKjlhoXvvIzlm6DkuLrnu4TlhoXku7vkvZXkuIDmnaHnmoQga2V5XG4gKiAgIOaYr+WQpuato+ehrumDveWPluWGs+S6juW6j+S9jeeul+W+l+WvueS4jeWvue+8ieOAglxuICogLSAqKjE3LjUzJe+8iDU5MS8zMzcx77yJKirigJTigJTkuI3nlKjluo/kvY3jgIHlj6rmjIkgYCjljaHmsaAsIOaXtumXtCwg54mp5ZOBKWAg5LiJ5YWD57uE566XXG4gKiAgIGtleSDml7bvvIzkvJrooqsgYElOU0VSVCBPUiBJR05PUkVgICoq6Z2Z6buY5Lii5byDKirnmoTorrDlvZXmr5TkvovvvIjmr4/kuKrnorDmkp7nu4Tph4xcbiAqICAgXCLmiqLliLBcIuS4ieWFg+e7hCBrZXkg55qE6YKj5LiA5p2h6IO95rS75LiL5p2l77yM57uE5YaF5YW25L2Z5oiQ5ZGY5YWo6YOo5pKe6ZSu5Lii5aSx77yJ44CCXG4gKlxuICog56Kw5pKe57uE5YWxIDUwOCDnu4TjgII1MDgg5Liq56Kw5pKe57uE5YaFKirpgJDlrZfmrrXlrozlhajnm7jlkIwqKu+8iOWQjOS4gOS4qiBgKOWNoeaxoCwg56eSKWBcbiAqIOWGheeahOWNgei/nuaJueasoeWkqeeEtuWmguatpO+8ieKAlOKAlOm4o+a9riBBUEkg5LiN5YiG6aG144CB5LiA5qyh6L+U5Zue5pW05rGg5YWo6YeP77yM6L+Z5piv5pys5paH5Lu2XG4gKiDkuKTkuKrorr7orqHpmr7ngrnvvIjmlrnlkJHjgIHluo/kvY3lronlhajmgKfvvInllK/kuIDnmoTlrrnplJnmnaXmupDvvIzkuIvpnaLpgJDkuIDor7TmmI7jgIJcbiAqXG4gKiAjIyDorr7orqHpmr7ngrnkuIDvvJrmlbDnu4TmlrnlkJHkuI3lj6/kv6HvvIzlv4XpobvlvZLkuIDljJZcbiAqXG4gKiDlj4LogIPlrp7njrAgYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2Ag6YeMIGBhcGlEYXRhLkRhdGEuUmV2ZXJzZSgpYFxuICog6K+B5a6e77yaQVBJIOWTjeW6lOacrOi6q+aYryoq5YCS5bqPKirvvIjmnIDmlrDnmoTorrDlvZXmjpLmnIDliY3pnaLvvInvvIzlj4LogIPlrp7njrDmi7/liLDlk43lupTlkI5cbiAqIOaVtOS9k+WPjei9rOS4gOasoeaJjeS9v+eUqOOAgmBleHRyYWN0TGlzdGDvvIjop4EgYC4vbWFuaWZlc3QudHNg77yJ5LiN5pS55Y+Y5pWw57uE6aG65bqP77yMXG4gKiDljp/moLfmiorov5nkuKrlgJLluo/mlbDnu4TkuqTnu5kgYGZpZWxkcy5leHRyYWN0UmVjb3JkYO+8jOWGjeS6pOe7meacrOaWh+S7tueahFxuICogYGRlcml2ZVJlY29yZEtleXNg4oCU4oCU5Lmf5bCx5piv6K+077yM5pysIGhvb2sg5ou/5Yiw55qE6K6w5b2V6aG65bqPKirnu6fmib/oh6ogQVBJIOeahFxuICog55yf5a6e6L+U5Zue6aG65bqP77yM5pa55ZCR5LiN55Sx5o+S5Lu26Ieq5bex5o6n5Yi2KirjgIJcbiAqXG4gKiDoi6Xluo/kvY3nm7TmjqXmjInovpPlhaXmlbDnu4TkuIvmoIforqHnrpfvvIzogIzkuKTmrKHph4fpm4bkuYvpl7TmlbDnu4TmlrnlkJHlj5HnlJ/lj5jljJbvvIjkvovlpoLmnKrmnaVcbiAqIOacieS7o+eggeWcqCBgZXh0cmFjdExpc3RgIOS4juacrCBob29rIOS5i+mXtOaPkuWFpeS6huS4gOasoeWPjei9rOOAgeaIliBBUEkg5pys6Lqr55qE5o6S5bqPXG4gKiDnuqblrprlj5HnlJ/lj5jljJbvvInvvIzlkIzkuIDmibnorrDlvZXkvJrnrpflh7rkuI3lkIznmoTluo/kvY3vvIxgcmVjb3JkX2tleWAg5bCx5Lya5ryC56e7XG4gKiDigJTigJTov5nmraPmmK8gYFBsdWdpbkhvb2tzLmRlcml2ZVJlY29yZEtleXNgIOW5guetieaAp+imgeaxgu+8iFwi5ZCM5LiA5p2h5a6e6ZmF6K6w5b2V77yMXG4gKiDku7vmhI/ml7bpl7Tku7vmhI/mrKHph4fpm4bpg73lv4Xpobvkuqflh7rnm7jlkIznmoQga2V5XCLvvInkvJrooqvmiZPnoLTnmoTlnLDmlrnjgIJcbiAqXG4gKiAqKuino+WGs+aWueahiO+8muaYvuW8j+W9kuS4gOWMlu+8jOS4jeWBh+iuvuaWueWQkeS4jeWPmOOAgioqIOavlOi+g+aVsOe7hOmmluWwvuS4pOadoeiusOW9leeahOaXtumXtO+8jFxuICog6Iul6aaWID4g5bC+77yI5YCS5bqP77yJ77yM5YWI5oqK5pW05Liq5pWw57uE5Y+N6L2s5oiQXCLml6fihpLmlrBcIueahOato+W6j+WGjeiuoeeul+W6j+S9je+8m+iLpemmliA8PVxuICog5bC+77yI5bey57uP5piv5q2j5bqP77yM5oiW5pWw57uE6ZW/5bqmIDw9IDEg5peg5rOV5Yik5pat5pa55ZCR77yJ77yM5oyJ5Y6f5qC35aSE55CG44CC6L+Z5Liq5b2S5LiA5YyWXG4gKiDkuYvmiYDku6XmraPnoa7jgIHkuJTkuI3pnIDopoHlr7lcIue7hOWGhemhuuW6j+aYr+WQpuS5n+iiq+ato+ehrui/mOWOn1wi5Y+m5L2c6K+B5piO77yaQVBJIOWTjeW6lOaYr+WvuVxuICogKirmlbTkuKrmlbDnu4QqKuWBmuS4gOasoeWNleS4gOaWueWQkeeahOaOkuW6j++8iOS4jeaYr1wi57uE6Ze05YCS5bqP44CB57uE5YaF5Y+m5pyJ54us56uL6aG65bqPXCLvvInvvIxcbiAqIGBhcGlEYXRhLkRhdGEuUmV2ZXJzZSgpYCDor4Hlrp7lj4LogIPlrp7njrDlpITnkIbnmoTmmK/lr7nmlbTkuKrmlbDnu4TnmoTmlbTkvZPlj43ovazigJTigJRcbiAqIOaVtOS9k+WPjei9rOaYr+iHqui6q+eahOmAhuaTjeS9nO+8jOavlOi+g+mmluWwvuWIpOaWreaWueWQkeWQjuaMiemcgOaVtOS9k+WPjei9rOS4gOasoe+8jOW+l+WIsOeahOato+W6j1xuICog5pWw57uE5LiOXCJBUEkg5LiA5byA5aeL5bCx6L+U5Zue5q2j5bqPXCLml7bpgJDkvY3nva7lrozlhajkuIDoh7TvvIzljIXmi6znu4TlhoXmiJDlkZjnmoTnm7jlr7npobrluo/jgIJcbiAqXG4gKiDlvZLkuIDljJbkuYvlkI7lho3mjInvvIjnjrDlt7Lkv53or4HmmK/mraPluo/nmoTvvInmlbDnu4TkuIvmoIfpobrluo/nu5nmr4/kuKogYChiYW5uZXJJZCwgdGltZSlgXG4gKiDliIbnu4TlhoXnmoTorrDlvZXnvJblj7fvvIzmnIDlkI7miornrpflh7rnmoQga2V5IOWGmeWbnioq5Y6f5aeL6L6T5YWl5LiL5qCHKirlr7nlupTnmoTkvY3nva7igJTigJRcbiAqIOi/lOWbnuWAvOW/hemhu+S4jui+k+WFpSBgcmVjb3Jkc2Ag6YCQ5L2N572u5a+55bqU77yM6L+Z5pivIGBQbHVnaW5Ib29rcy5kZXJpdmVSZWNvcmRLZXlzYFxuICog55qE5aWR57qm77yIXCLov5Tlm57lgLzlv4XpobvkuI7ovpPlhaXnrYnplb/jgIHmjInovpPlhaXpobrluo/kuIDkuIDlr7nlupRcIu+8ieOAglxuICpcbiAqICMjIOiuvuiuoemavueCueS6jO+8mkFQSSDlk43lupTnur/moLzlvI/mnKrnu4/mipPljIXpqozor4HvvIxrZXkg5LiN6IO955u05o6l5ZOI5biM5Y6f5aeL5a2X56ym5LiyXG4gKlxuICog5Y+C6ICD5a6e546w5Y+N5bqP5YiX5YyWIEFQSSDlk43lupTml7bvvIxgTW9kZWxzL0dhY2hhRGF0YS5jc2Ag55qEIGBUaW1lYCDlrZfmrrXmmK/lvLpcbiAqIOexu+WeiyBgRGF0ZVRpbWVg4oCU4oCU57q/5qC85byP5Zyo5Y+N5bqP5YiX5YyW6YKj5LiA5q2l5bCx6KKr6K+t6KiA6L+Q6KGM5pe25ZCD5o6J5LqG77yM5rqQ56CB6YeM55yLXG4gKiDkuI3lh7ogQVBJIOWIsOW6leWPkeeahOaYryBgMjAyNC0wNi0wNlQxMDoyMzo0OGDvvIhJU0/vvInov5jmmK9cbiAqIGAyMDI0LzA2LzA2IDEwOjIzOjQ4YO+8iOaWnOadoO+8iei/mOaYr+WIq+eahOWGmeazle+8m+acrOWcsOWtmOaho+mHjOWHuueOsOeahCBJU08g5qC85byP5pivXG4gKiBOZXd0b25zb2Z0IOW6j+WIl+WMliBgRGF0ZVRpbWVgIOeahOm7mOiupOS6p+eJqe+8jOS4jeS7o+ihqCBBUEkg5ZON5bqU5pys6Lqr55qE57q/5qC85byP77ybXG4gKiBgRGF0ZUZvcm1hdFN0cmluZyA9IFwieXl5eS9NTS9kZCBoaDptbTpzc1wiYCDlj6rlnKjlj43luo/liJfljJbot6/lvoTkuIrnlJ/mlYjnmoTor4Hmja5cbiAqIOW+iOW8se+8jOS4jei2s+S7peWumuiuuu+8m+acrOS7k+W6k+ayoeaciem4o+a9riBBUEkg55qE55yf5a6e5oqT5YyF5qC35pys6IO96aqM6K+B44CCXG4gKlxuICog6IulIGBkZXJpdmVSZWNvcmRLZXlzYCDnm7TmjqXmioogYHJlY29yZC50aW1lYCDljp/lp4vlrZfnrKbkuLLmi7zov5vlk4jluIzovpPlhaXvvIzkuIDml6ZcbiAqIOe6v+agvOW8j+eMnOmUmeKAlOKAlOaIluiAheaXpeWQjiBBUEkg5o2i5LqG5Liq5YiG6ZqU56ym4oCU4oCU5omA5pyJIGtleSDpg73kvJrkuI7pooTmnJ/kuI3lkIzvvJrkuI3kvJpcbiAqIOaKpemUme+8jOWPquS8mumdmem7mOmHjeWkjeWFpeW6k++8jOaIluiAheiuqeW3suWFpeW6k+eahCBrZXkg5LiO5paw6YeH6ZuG566X5Ye655qEIGtleSDlr7nkuI3kuIrvvIxcbiAqIOS4jiBIb1lvLkdhY2hhIOWboOS4uiBgcmVjb3JkX2tleWAg6K6+6K6h5LiN5Yiw5L2N5LuY5Ye66L+H5LiA5qyh5pW06KGo6YeN5bu66L+B56e75piv5ZCM5LiA57G7XG4gKiDku6Pku7fjgIJcbiAqXG4gKiAqKuino+WGs+aWueahiO+8muWFiOaKiiBgdGltZWAg6KeE6IyD5YyW5oiQ5LiO57q/5qC85byP5peg5YWz55qE5b2i5byP77yM5YaN5Y+C5LiO5ZOI5biMKirvvIzop4HkuIvmlrlcbiAqIGBub3JtYWxpemVUaW1lRm9yS2V5YOOAglxuICovXG5pbXBvcnQgdHlwZSB7IFBsdWdpbkhvb2tzLCBVbmlmaWVkUmVjb3JkRmllbGRzIH0gZnJvbSBcImdzLXBsdWdpbi1raXRcIjtcblxuLyoqXG4gKiDmioogQVBJIOWTjeW6lOeahCBgdGltZWAg5a2X5q616KeE6IyD5YyW5oiQ5LiO57q/5qC85byP5peg5YWz44CB5Y+v55u05o6l5oyJ5a2X56ym5Liy5q+U6L6D5aSn5bCP55qEXG4gKiDlvaLlvI/vvIhgWVlZWU1NRERISG1tc3Ng77yMMTQg5L2N57qv5pWw5a2X77yJ44CCXG4gKlxuICogYDIwMjQtMDYtMDZUMTA6MjM6NDhgIOS4jiBgMjAyNC8wNi8wNiAxMDoyMzo0OGAg5b2S5LiA5ZCO6YO95pivXG4gKiBgXCIyMDI0MDYwNjEwMjM0OFwiYOKAlOKAlOeUqOato+WImeaLhuWHuuW5tC/mnIgv5pelL+aXti/liIYv56eS5YWt5Liq5pWw5a2X5YiG6YeP5YaN5ou85o6l77yMXG4gKiDliIbpmpTnrKbmnKzouqvvvIhgLWAvYC9gL2BUYC/nqbrmoLzvvInooqvmraPliJnnm7TmjqXlkIPmjonjgIHkuI3lvbHlk43lvZLkuIDljJbnu5PmnpzjgIJcbiAqXG4gKiDimqDvuI8gKirkuI3nlKggYG5ldyBEYXRlKC4uLilgIOino+aekCoq77yaYERhdGVgIOaehOmAoOWHveaVsOWvueS4jeW4puaXtuWMuuWQjue8gOeahOWtl+espuS4slxuICog5oyJKui/kOihjOeOr+Wig+acrOWcsOaXtuWMuirop6Pph4rvvIzlkIzkuIDkuKrlrZfnrKbkuLLlnKjkuI3lkIzmnLrlmagv5LiN5ZCM5pe25Yy65LiK6LeR5Ye655qEXG4gKiBgRGF0ZWAg5a+56LGh5Luj6KGo55qE57ud5a+55pe25Yi75LiN5ZCM4oCU4oCU6L+Z5LiOXCLnuq/lh73mlbDjgIHnu5Pmnpzlj6rlj5blhrPkuo7ovpPlhaVcIui/meadoeehrFxuICog57qm5p2f55u05o6l5Yay56qB77yIYFBsdWdpbkhvb2tzLmRlcml2ZVJlY29yZEtleXNgIOW/hemhu+aYr+e6r+WHveaVsO+8jFRTIOi/kOihjOeOr+Wig1xuICog54mp55CG5LiK5Lmf5LiN5o+Q5L6b6IO95pu/5LujIGBEYXRlYCDmnKzlnLDml7bljLrooYzkuLrnmoTml7bljLrmlbDmja7lupPvvInjgILmlLnnlKjmraPliJnnm7TmjqXmi4ZcbiAqIOaVsOWtl+WIhumHj++8jOS4jee7j+i/hyBgRGF0ZWDvvIzop4TojIPljJbnu5PmnpzkuI7ov5DooYznjq/looPml6DlhbPjgIJcbiAqXG4gKiDimqDvuI8gKirml6Dms5Xor4bliKvnmoTmoLzlvI/lv4XpobvmiqXplJnvvIzkuI3og73pnZnpu5jlm57okL3liLDljp/lp4vlrZfnrKbkuLIqKu+8mumdmem7mOWbnuiQveetieS6jlxuICogXCLlhYjlvZLkuIDljJblho3lk4jluIxcIui/meWxguS/neaKpOWujOWFqOS4jeWtmOWcqOKAlOKAlOacrOmhueebruW3sue7j+WkmuasoeaKk+WIsFwi55yL6LW35p2l5pyJ6Ziy5oqk44CBXG4gKiDlrp7pmYXku4DkuYjpg73msqHlgZpcIui/meS4gOexu+WkseaViOaooeW8j++8jOi/memHjOS4jeiDvemHjei5iOOAglxuICpcbiAqIOebruWJjeWPquiupOS4pOenjeW3suefpeWAmemAieagvOW8j++8iElTTyDnmoQgYC1gL2BUYCDliIbpmpTjgIHlj4LogIPlrp7njrDmmpfnpLrnmoQgYC9gL+epuuagvFxuICog5YiG6ZqU77yJ77yb6Iul5pyq5p2l55yf5a6e5oqT5YyF5Y+R546w56ys5LiJ56eN5qC85byP77yM6L+Z6YeM6ZyA6KaB5ZCM5q2l5omp5bGV5q2j5YiZ77yM6ICM5LiN5piv5pS+5a69XG4gKiDliLBcIumaj+S+v+S7gOS5iOmDveaUtlwi44CCXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVRpbWVGb3JLZXkodGltZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbWF0Y2ggPSAvXihcXGR7NH0pWy0vXShcXGR7Mn0pWy0vXShcXGR7Mn0pW1QgXShcXGR7Mn0pOihcXGR7Mn0pOihcXGR7Mn0pJC8uZXhlYyh0aW1lKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGDpuKPmva4gZGVyaXZlUmVjb3JkS2V5c++8muaXoOazleivhuWIq+eahOaXtumXtOagvOW8jyBcIiR7dGltZX1cIuKAlOKAlOe6v+agvOW8j+acque7j+aKk+WMhemqjOivge+8jOaLkue7neWcqOeMnOa1i+eahOagvOW8j+S4iuiuoeeulyByZWNvcmRfa2V5YCxcbiAgICApO1xuICB9XG4gIGNvbnN0IFssIHllYXIsIG1vbnRoLCBkYXksIGhvdXIsIG1pbnV0ZSwgc2Vjb25kXSA9IG1hdGNoO1xuICByZXR1cm4gYCR7eWVhcn0ke21vbnRofSR7ZGF5fSR7aG91cn0ke21pbnV0ZX0ke3NlY29uZH1gO1xufVxuXG4vKipcbiAqIEZOVi0xYSAzMiDkvY3lk4jluIzvvIznuq/kvY3ov5Dnrpflrp7njrDvvIzkuI3kvp3otZbku7vkvZUgTm9kZS9XZWIg5Yqg5a+GIEFQSeKAlOKAlFRTIOS+p+i/kOihjFxuICog546v5aKD54mp55CG5LiK5LiN5o+Q5L6bIGBjcnlwdG9g77yM5o+S5Lu25Luj56CB5Y+q6IO955So6K+t6KiA5YaF572u6IO95Yqb77yIYGNoYXJDb2RlQXRgL1xuICogYE1hdGguaW11bGAv56e75L2N6L+Q566X77yMRVMyMDIyIOagh+WHhiBKU++8jOS7u+S9lemBteW+quinhOiMg+eahOW8leaTjumDveiDvei3ke+8jOWMheaLrOWuv+S4u1xuICog5YaF5bWM55qEIFF1aWNrSlPvvInjgIJcbiAqXG4gKiDlj6rlr7kgQVNDSUkg5a2X56ym5q2j56Gu77ya5pys5paH5Lu25ZSv5LiA55qE6LCD55So54K55Lyg5YWl55qE5pivXG4gKiBgSlNPTi5zdHJpbmdpZnkoW2Jhbm5lcklkLCBub3JtYWxpemVkVGltZSwgaXRlbUlkLCBzZXFJbkdyb3VwXSlg77yM5Zub5LiqXG4gKiDliIbph4/liIbliKvmmK/nuq/mlbDlrZflrZfnrKbkuLLvvIhQb29sVHlwZSBpZOOAgWBub3JtYWxpemVUaW1lRm9yS2V5YCDnmoTovpPlh7rjgIFcbiAqIGByZXNvdXJjZUlkYCDovaznmoTlrZfnrKbkuLLjgIHmibnmrKHlhoXluo/kvY3vvInliqAgSlNPTiDmnKzouqvnmoTmoIfngrnvvIzpgJDlrZfnrKbpg73lnKhcbiAqIEFTQ0lJIOiMg+WbtOWGhe+8jGBjaGFyQ29kZUF0YCDkuI7lrZfoioLlgLzkuIDkuIDlr7nlupTvvIzkuI3pnIDopoHlpITnkIblpJrlrZfoioLlrZfnrKbjgIJcbiAqL1xuZnVuY3Rpb24gZm52MWEzMihpbnB1dDogc3RyaW5nLCBvZmZzZXRCYXNpczogbnVtYmVyKTogc3RyaW5nIHtcbiAgbGV0IGhhc2ggPSBvZmZzZXRCYXNpcyA+Pj4gMDtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBpbnB1dC5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGhhc2ggXj0gaW5wdXQuY2hhckNvZGVBdChpKTtcbiAgICBoYXNoID0gTWF0aC5pbXVsKGhhc2gsIDB4MDEwMDAxOTMpID4+PiAwO1xuICB9XG4gIHJldHVybiBoYXNoLnRvU3RyaW5nKDE2KS5wYWRTdGFydCg4LCBcIjBcIik7XG59XG5cbi8qKiDmoIflh4YgRk5WLTFhIDMyIOS9jeWBj+enu+WfuuWHhuOAgiAqL1xuY29uc3QgRk5WX09GRlNFVF9CQVNJU19BID0gMHg4MTFjOWRjNTtcbi8qKlxuICog56ys5LqM5Liq5YGP56e75Z+65YeG77yM5Y+q6KaB5rGC5LiOIEEg5LiN5ZCM4oCU4oCU55So5p2l5oqK5Lik5qyh54us56uL55qEIDMyIOS9jeWTiOW4jOaLvOaIkOS4gOS4qlxuICogMTYg5L2N5Y2B5YWt6L+b5Yi277yINjQg5L2N77yJ55qE5aSN5ZCIIGtlee+8jOmZjeS9juWNleeLrOS4gOS4qiAzMiDkvY3lk4jluIzlnKjlh6DljYPmnaHorrDlvZVcbiAqIOinhOaooeS4i+eahOeUn+aXpeeisOaSnuamgueOh++8iGBzcXJ0KDJeMzIpIOKJiCA2NTUzNmDvvIzkuIDkuKrotKblj7fnmoTorrDlvZXmlbDph4/nuqflt7Lnu49cbiAqIOWkn+S4jeS4iuaUvuW/g+WPqueUqCAzMiDkvY3vvInjgILlj5blgLzmnKzouqvmsqHmnInnibnmrorlkKvkuYnvvIzlj6ropoHmsYLmmK/kuIDkuKrkuI4gQSDkuI3lkIznmoRcbiAqIOWbuuWumuW4uOmHj+OAglxuICovXG5jb25zdCBGTlZfT0ZGU0VUX0JBU0lTX0IgPSAweDllMzc3OWI5O1xuXG4vKipcbiAqIOiuoeeul+WNleadoeiusOW9leeahCBgcmVjb3JkX2tleWDjgIJcbiAqXG4gKiDnlKggYEpTT04uc3RyaW5naWZ5YCDmiorlm5vkuKrliIbph4/luo/liJfljJbmiJDkuIDkuKrmlbDnu4TlrZfnrKbkuLLvvIzogIzkuI3mmK/nlKjliIbpmpTnrKZcbiAqIO+8iOWmgiBgOmDvvInmiYvlt6Xmi7zmjqXigJTigJRgbm9ybWFsaXplZFRpbWVgIOWGhemDqOWFqOaYr+aVsOWtl+ayoeacieatp+S5ie+8jOS9hiBKU09OIOeahFxuICog6L2s5LmJ6KeE5YiZ6IO95L+d6K+BXCLkuI3lkIznmoTovpPlhaXlhYPnu4TkuI3kvJrmi7zlh7rlkIzkuIDkuKrlrZfnrKbkuLJcIui/meadoeaAp+i0qOWcqOS7u+S9leacquadpVxuICog5YiG6YeP57G75Z6L5Y+Y5YyW5pe25L6d54S25oiQ56uL77yM5q+U5omL5bel5oyR5LiA5LiqXCLnnIvotbfmnaXkuI3kvJrlh7rnjrDlnKjlrZfmrrXph4xcIueahOWIhumalOesplxuICog5pu05Y+v6Z2g44CCXG4gKi9cbmZ1bmN0aW9uIGhhc2hSZWNvcmRLZXkoYmFubmVySWQ6IHN0cmluZywgbm9ybWFsaXplZFRpbWU6IHN0cmluZywgaXRlbUlkOiBzdHJpbmcsIHNlcUluR3JvdXA6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IGNhbm9uaWNhbCA9IEpTT04uc3RyaW5naWZ5KFtiYW5uZXJJZCwgbm9ybWFsaXplZFRpbWUsIGl0ZW1JZCwgc2VxSW5Hcm91cF0pO1xuICByZXR1cm4gYCR7Zm52MWEzMihjYW5vbmljYWwsIEZOVl9PRkZTRVRfQkFTSVNfQSl9JHtmbnYxYTMyKGNhbm9uaWNhbCwgRk5WX09GRlNFVF9CQVNJU19CKX1gO1xufVxuXG5leHBvcnQgY29uc3QgaG9va3M6IFBsdWdpbkhvb2tzID0ge1xuICBkZXJpdmVSZWNvcmRLZXlzOiAocmVjb3JkczogVW5pZmllZFJlY29yZEZpZWxkc1tdKTogc3RyaW5nW10gPT4ge1xuICAgIGNvbnN0IHRvdGFsID0gcmVjb3Jkcy5sZW5ndGg7XG4gICAgaWYgKHRvdGFsID09PSAwKSByZXR1cm4gW107XG5cbiAgICAvLyDml7bpl7Tnur/moLzlvI/ml6DlhbPvvJrlhYjnu5/kuIDop4TojIPljJbvvIzlh7rnjrDml6Dms5Xor4bliKvnmoTmoLzlvI/nq4vliLvmiqXplJnvvIjop4FcbiAgICAvLyBub3JtYWxpemVUaW1lRm9yS2V5IOaWh+aho++8ie+8jOS4jeWFgeiuuOafkOS4gOadoeiusOW9leaChOaChOeUqOWOn+Wni+Wtl+espuS4suWPguS4juWTiOW4jOOAglxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUaW1lcyA9IHJlY29yZHMubWFwKChyZWNvcmQpID0+IG5vcm1hbGl6ZVRpbWVGb3JLZXkocmVjb3JkLnRpbWUpKTtcblxuICAgIC8vIOaWueWQkeW9kuS4gOWMlu+8muavlOi+g+mmluWwvuS4pOadoeiusOW9leeahOinhOiMg+WMluaXtumXtOOAgummliA+IOWwvuivtOaYjuaVsOe7hOaYr+WAkuW6j1xuICAgIC8vIO+8iEFQSSDnnJ/lrp7ov5Tlm57nmoTpobrluo/vvIzlj4LogIPlrp7njrDnlKggYXBpRGF0YS5EYXRhLlJldmVyc2UoKSDlpITnkIbvvInvvIzpnIDopoFcbiAgICAvLyDmjIlcIuWOn+Wni+i+k+WFpeS4i+agh1wi5YiwXCLmraPluo/pgY3ljobpobrluo9cIuW7uueri+S4gOS7veaYoOWwhO+8m+WQpuWIme+8iOW3sue7j+aYr+ato+W6j++8jOaIllxuICAgIC8vIOmVv+W6piA8PSAxIOaXoOazleWIpOaWreaWueWQke+8ieebtOaOpeaMieWOn+Wni+S4i+agh+mBjeWOhuOAguingeaWh+S7tuWktOmDqFwi6K6+6K6h6Zq+54K55LiAXCLjgIJcbiAgICAvL1xuICAgIC8vIOS4i+agh+iuv+mXruWcqCBub1VuY2hlY2tlZEluZGV4ZWRBY2Nlc3Mg5LiL57G75Z6L5pivIGBzdHJpbmcgfCB1bmRlZmluZWRg4oCU4oCUXG4gICAgLy8g6L+Z6YeM5LiN55So6Z2e56m65pat6KiAL+exu+Wei+i9rOaNouWBh+ijhVwi6IKv5a6a5LiN5Lya6ZSZXCLvvIzogIzmmK/mmL7lvI/liKTnqbrlkI7mipvlhoXpg6jplJnor69cbiAgICAvLyDvvIjkuI4gcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC90ZXN0a2l0L2luZGV4LnRzIOWkhOeQhuWQjOexu+aDheW9oueahOWGmeazleS4gOiHtO+8ie+8jFxuICAgIC8vIOeQhuiuuuS4iuS4jeS8muinpuWPke+8mmZpcnN0VGltZS9sYXN0VGltZSDnmoTkuIvmoIfmgZLlnKggWzAsIHRvdGFsKSDlhoXjgIJcbiAgICBjb25zdCBmaXJzdFRpbWUgPSBub3JtYWxpemVkVGltZXNbMF07XG4gICAgY29uc3QgbGFzdFRpbWUgPSBub3JtYWxpemVkVGltZXNbdG90YWwgLSAxXTtcbiAgICBpZiAoZmlyc3RUaW1lID09PSB1bmRlZmluZWQgfHwgbGFzdFRpbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwi6bij5r2uIGRlcml2ZVJlY29yZEtleXMg5YaF6YOo6ZSZ6K+v77ya5peg5rOV5Y+W5Yiw6aaWL+WwvuiusOW9leeahOinhOiMg+WMluaXtumXtFwiKTtcbiAgICB9XG4gICAgY29uc3QgaXNEZXNjZW5kaW5nID0gdG90YWwgPiAxICYmIGZpcnN0VGltZSA+IGxhc3RUaW1lO1xuXG4gICAgY29uc3QgYXNjZW5kaW5nT3JkZXI6IG51bWJlcltdID0gbmV3IEFycmF5KHRvdGFsKTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRvdGFsOyBpICs9IDEpIHtcbiAgICAgIGFzY2VuZGluZ09yZGVyW2ldID0gaXNEZXNjZW5kaW5nID8gdG90YWwgLSAxIC0gaSA6IGk7XG4gICAgfVxuXG4gICAgLy8g5oyJ77yI5bey5L+d6K+B5q2j5bqP55qE77yJ6YGN5Y6G6aG65bqP77yM5a+55q+P5LiqIChiYW5uZXJJZCwg6KeE6IyD5YyW5pe26Ze0KSDliIbnu4TlhoXnmoRcbiAgICAvLyDorrDlvZXnvJblj7fvvIznvJblj7fljbNcIuaJueasoeWGheW6j+S9jVwi77yb566X5Ye655qEIGtleSDlhpnlm57ljp/lp4vovpPlhaXkuIvmoIflr7nlupTnmoTkvY3nva7jgIJcbiAgICBjb25zdCBzZXFCeUdyb3VwID0gbmV3IE1hcDxzdHJpbmcsIG51bWJlcj4oKTtcbiAgICBjb25zdCBrZXlzID0gbmV3IEFycmF5PHN0cmluZz4odG90YWwpO1xuICAgIGZvciAoY29uc3Qgb3JpZ2luYWxJbmRleCBvZiBhc2NlbmRpbmdPcmRlcikge1xuICAgICAgY29uc3QgcmVjb3JkID0gcmVjb3Jkc1tvcmlnaW5hbEluZGV4XTtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRUaW1lID0gbm9ybWFsaXplZFRpbWVzW29yaWdpbmFsSW5kZXhdO1xuICAgICAgaWYgKHJlY29yZCA9PT0gdW5kZWZpbmVkIHx8IG5vcm1hbGl6ZWRUaW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgLy8g5LiN5bqU5Y+R55Sf77yab3JpZ2luYWxJbmRleCDnlLHkuIrpnaLnmoTlvqrnjq/nlJ/miJDvvIzlj5blgLzojIPlm7TmgZLlnKggWzAsIHRvdGFsKeOAglxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYOm4o+a9riBkZXJpdmVSZWNvcmRLZXlzIOWGhemDqOmUmeivr++8muS4i+aghyAke29yaWdpbmFsSW5kZXh9IOWkhOeahOiusOW9leaIluinhOiMg+WMluaXtumXtOe8uuWksWApO1xuICAgICAgfVxuICAgICAgLy8g4piFIOWIhue7hOmUruW/hemhu+WMheWQqyBpdGVtSWTvvIzkuI3og73lj6rmjIkgKGJhbm5lcklkLCDml7bpl7QpIOWIhue7hOOAglxuICAgICAgLy9cbiAgICAgIC8vIOW6j+S9jeWtmOWcqOeahOWUr+S4gOebrueahO+8jOaYr+WMuuWIhioq6YCQ5a2X5q615a6M5YWo55u45ZCM44CB5ZCm5YiZ5peg5rOV5Yy65YiGKirnmoTorrDlvZXjgIJcbiAgICAgIC8vIOecn+WunuWtmOaho+Wunua1i++8iGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCp+S4gO+8iemHjOWQjOenklxuICAgICAgLy8g56Kw5pKe57uE5YWxIDUwOCDnu4TjgIHnu4TlhoXorrDlvZXpgJDlrZfmrrXlhajnrYnvvJvor6XlrqHorqEgwqcxLjcg4pGiIOe7meWHuueahOWuieWFqOaAp+iuuuivgVxuICAgICAgLy8g5Lmf5q2j5piv44CM57uE5YaF6K6w5b2V6YCQ5a2X5q615a6M5YWo55u45ZCMIOKGkiDkuqTmjaLlroPku6zkuqflh7rnmoQga2V5IOWkmumHjembhuS4jeWPmOOAjeOAglxuICAgICAgLy8g6L+Z5p2h6K666K+B5oiQ56uL55qE5YmN5o+Q77yM5piv5YiG57uE5oyJKirlhajnrYnlrZfmrrUqKuWIkuWIhuOAglxuICAgICAgLy9cbiAgICAgIC8vIOiLpeWIhue7hOmUrua8j+aOiSBpdGVtSWTvvIzkuIDmrKHljYHov57vvIgxMCDmnaHlkIznp5LjgIHkvYbnianlk4HlkITkuI3nm7jlkIznmoTorrDlvZXvvInkvJrooqtcbiAgICAgIC8vIOWhnui/m+WQjOS4gOe7hOaLv+WIsOW6j+S9jSAwfjnvvIzkuo7mmK/mr4/mnaHorrDlvZXnmoQga2V5IOmDveWPluWGs+S6juWug+WcqOaVsOe7hOmHjOeahOS9jee9ruOAglxuICAgICAgLy8g5ZCO5p6c5bey5Zyo5YWo6YeP55yf5a6e5pWw5o2u77yIMzM3MSDmnaHvvInkuIrlrp7mtYvvvJpcbiAgICAgIC8vICAgLSDmlrnlkJHov53kvosgMTAg5p2h4oCU4oCUUG9vbFR5cGU9MTIg5pW05om55YWx55So5ZCM5LiA5Liq5pe26Ze05oiz77yM6aaW5bC+55u4562J77yMXG4gICAgICAvLyAgICAg5LiK6Z2i6YKj5aWXXCLmr5TovoPpppblsL7liKTmlrnlkJFcIueahOmAu+i+keWkseaViO+8jOato+W6jy/lgJLluo/lloLlhaXkuqflh7rkuKTlpZcga2V577ybXG4gICAgICAvLyAgIC0gKirlop7plb/nqLPlrprmgKfov53kvosgMjAg5p2hKirigJTigJTov5nmnaHmiY3nnJ/mraPkvJrkvKTliLDnlKjmiLfvvJrmlbTmsaDlhajph4/mi4nlj5bkuIvvvIxcbiAgICAgIC8vICAgICDlkI7kuIDmrKHph4fpm4blv4XnhLbmr5TliY3kuIDmrKHorrDlvZXmm7TlpJrvvIzkuIDml6borrDlvZXlj5jlpJrorqnmlrnlkJHliKTlrprku45cIuWIpOS4jeWHulwiXG4gICAgICAvLyAgICAg57+76L2s5oiQXCLliKTlvpflh7pcIu+8jOaXqeWFiOmCo+aJueiusOW9leeahOW6j+S9jeS8muaVtOS9k+WPjei9rOOAgWtleSDlhajlj5jvvIzkuo7mmK/ooqtcbiAgICAgIC8vICAgICDlvZPmiJDmlrDorrDlvZUqKumHjeWkjeWFpeW6kyoq44CCXG4gICAgICAvLyDmioogaXRlbUlkIOW5tui/m+WIhue7hOmUruWQju+8jOS4iui/sOS4pOmhueWunua1i+WIhuWIq+mZjeS4uiAyIOS4jiAw77yb5Ymp5LiL6YKjIDIg5p2h57uPXG4gICAgICAvLyDmoLjlr7npg73mmK/jgIzkuI7lj6bkuIDmnaHpgJDlrZfmrrXlhajnrYnjgI3nmoTorrDlvZXkupLmjaLkuoYga2V54oCU4oCU6K6w5b2V5pys6Lqr5LiN5Y+v5Yy65YiG77yMXG4gICAgICAvLyDlhajpg6ggNSDkuKrpnZ7nqbrmsaDnmoQga2V5IOWkmumHjembhuWdh+S4gOiHtO+8jOWOu+mHjee7k+aenOWujOWFqOetieS7t+OAglxuICAgICAgLy9cbiAgICAgIC8vIOWIhumalOespueUqOaZrumAmuepuuagvOWNs+WPr++8mmJhbm5lcklkIOaYr+e6r+aVsOWtlyBQb29sVHlwZSBpZO+8jG5vcm1hbGl6ZWRUaW1lXG4gICAgICAvLyDmmK8gbm9ybWFsaXplVGltZUZvcktleSDkuqflh7rnmoQgMTQg5L2N57qv5pWw5a2X5a2X56ym5Liy77yMaXRlbUlkIOaYr+e6r+aVsOWtl1xuICAgICAgLy8gcmVzb3VyY2VJZO+8jOS4ieiAhemDveS4jeWPr+iDveWQq+epuuagvO+8jOS4jeS8muWHuueOsOaLvOaOpeatp+S5ieOAglxuICAgICAgY29uc3QgZ3JvdXBLZXkgPSBgJHtyZWNvcmQuYmFubmVySWR9ICR7bm9ybWFsaXplZFRpbWV9ICR7cmVjb3JkLml0ZW1JZH1gO1xuICAgICAgY29uc3Qgc2VxSW5Hcm91cCA9IHNlcUJ5R3JvdXAuZ2V0KGdyb3VwS2V5KSA/PyAwO1xuICAgICAgc2VxQnlHcm91cC5zZXQoZ3JvdXBLZXksIHNlcUluR3JvdXAgKyAxKTtcbiAgICAgIGtleXNbb3JpZ2luYWxJbmRleF0gPSBoYXNoUmVjb3JkS2V5KHJlY29yZC5iYW5uZXJJZCwgbm9ybWFsaXplZFRpbWUsIHJlY29yZC5pdGVtSWQsIHNlcUluR3JvdXApO1xuICAgIH1cblxuICAgIHJldHVybiBrZXlzO1xuICB9LFxufTtcbiIsIi8qKlxuICog6bij5r2u5o+S5Lu2IG1hbmlmZXN044CCXG4gKlxuICog5pys5paH5Lu255SxIE0yLVMxL1MyIOeahOe6uOmdouWhq+ihqOa8lOe7g+iNieeov++8iGBkcmlsbHMvd3V3YS9tYW5pZmVzdC50c2DvvInovazljJbogIzmnaVcbiAqIOKAlOKAlOa8lOe7g+mqjOivgeeahOaYr1wiUzIg5pS56L+H55qE5o+S5Lu25aWR57qm57G75Z6L5piv5ZCm6KOF5b6X5LiL6bij5r2u55qE55yf5a6e5beu5byC54K5XCLvvIzmnKzmlofku7ZcbiAqIOaYr+aKiumqjOivgee7k+iuuuiQveWcsOaIkOecn+ato+aOpeWFpSBgcGx1Z2lucy9pbmRleC50c2Ag55qE5Y+v6L+Q6KGM5o+S5Lu244CC6L2s5YyW6L+H56iL5LitXG4gKiDliKDmjonkuobmvJTnu4Pmlofku7bph4zlpKfmrrVcIuS4uuS7gOS5iOW9k+aXtuWhq+S4jeS4i1wi55qE6L+H56iL5oCn5rOo6YeK77yI6YKj5Lqb56m655m95bey57uP6KKrXG4gKiBTMi9TMyDnmoTlpZHnuqbmlLnliqjloavlubPvvIznu6fnu63kv53nlZnkvJror6/lr7zor7vogIXku6XkuLrlrZfmrrXku43nhLbnvLrlpLHvvInvvIzlj6rkv53nlZnku43nhLZcbiAqIOaIkOeri+eahOmihuWfn+efpeivhu+8m+W3suiOt+W+l+ecn+WunuWPguaVsOeahOWtl+aute+8iOivt+axgiBib2R5IOWFt+WQjeWNoOS9jeespuOAgVxuICogYGFsbG93ZWRIb3N0c2DjgIFgc3RvcENvbmRpdGlvbmDvvInmjInkuIvmlrnms6jph4rph4znmoTmnaXmupDph43mlrDmoKHlh4bloavlhpnjgIJcbiAqXG4gKiDmlbDmja7mnaXmupDvvIjkuI3lh63orq3nu4PorrDlv4bnvJbpgKDlrZfmrrXlkI0v5pWw5YC877yJ77yaXG4gKiAtIGBkb2NzL2V4YW1wbGUtcHJvamVjdHMvV1dHYWNoYUV4cG9ydC9XV0dhY2hhRXhwb3J0L1NlcnZpY2VzL0NvbmZpZ1NlcnZpY2UuY3M6MjktNDNgXG4gKiAgIO+8iDEzIOmhuSBgUG9vbFR5cGVgIOihqO+8jOaehOmAoOWHveaVsOetvuWQjSBgR2FjaGFQb29sSW5mbyhwb29sVHlwZSwgbmFtZSwgbm9vYlBvb2wsXG4gKiAgIGxldmVsRml2ZU1heERyYXcsIGxldmVsRm91ck1heERyYXcsIGluaGVyaXQgPSB0cnVlKWDvvIzmnKzmlofku7blrp7njrDliY3lt7LpgJDooYzmoLjlr7nmupDnoIHljp/mlofvvIlcbiAqIC0gYGRvY3MvZXhhbXBsZS1wcm9qZWN0cy9XV0dhY2hhRXhwb3J0L1dXR2FjaGFFeHBvcnQvVmlld01vZGVscy9EaWFsb2dzL1VwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2BcbiAqICAg77yI5pel5b+X6Lev5b6E5ou85o6l44CB5byC5oiW6Kej5re35reG5Y+C5pWw44CBcXVlcnkg5Y+C5pWwIOKGkiBQT1NUIGJvZHkg5a2X5q615pig5bCE44CBXG4gKiAgIGBjYXJkUG9vbFR5cGVgL2BwbGF5ZXJJZGAg55qEIEMjIOexu+Wei+OAgVVzZXItQWdlbnTjgIHor7fmsYIgaG9zdCDkuozpgInkuIDpgLvovpHjgIFcbiAqICAgYGFwaURhdGEuRGF0YS5SZXZlcnNlKClgIOeahOiwg+eUqOS9jee9ru+8jOacrOaWh+S7tuWunueOsOWJjeW3sumAkOihjOaguOWvuea6kOeggeWOn+aWh++8iVxuICogLSBgZG9jcy9faW50ZXJuYWwvYXVkaXQvQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGDvvIgzMzcxIOadoVxuICogICDnnJ/lrp7lrZjmoaPnmoTlrZfmrrXnsbvlnovnu5/orqHjgIFgcmVjb3JkX2tleWAg56Kw5pKe546H5a6e5rWL44CB5L+d5bqV6Ze06ZqU5LiO6YCQ5oq95ZG95Lit546H77yJXG4gKiAtIGBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L21hbmlmZXN0LnRzYOOAgWBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L3R5cGVzL2dlbmVyYXRlZC50c2BcbiAqICAg77yIUzMg5LmL5ZCO55qE5aWR57qm57G75Z6L77ya5YW35ZCN5Y2g5L2N56ymIGB7e2NyZWRlbnRpYWwuPHF1ZXJ5UGFyYW0+fX1g44CBXG4gKiAgIGBSZXF1ZXN0VGVtcGxhdGUubWV0aG9kYC9gaGVhZGVyc2AvYGJvZHlg44CBYFN0b3BDb25kaXRpb24uc2luZ2xlUmVxdWVzdGDvvIlcbiAqIC0gYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2DvvIhgUmVxdWVzdFRlbXBsYXRlSnNvbmAg5LiK5pa5XG4gKiAgIFwi5bey55+l57y65Y+jIEM4XCIg5rOo6YeK77ya5Zu96ZmF5pyNIGhvc3Qg5peg5rOV5LuOIGBzdnJfYXJlYWAg5o6o5Ye6IFRMRO+8jOWIu+aEj+S4jemihOaUvlxuICogICBgLm5ldGDvvJtgc3Vic3RpdHV0ZV9uYW1lZF9jcmVkZW50aWFsX3BsYWNlaG9sZGVyc2Ag55qE5LiJ5p2hIGZhaWwtY2xvc2VkIOinhOWIme+8iVxuICpcbiAqIOS7jeacquino+WGs+OAgeWmguWunuagh+azqOOAgeS4jee8lumAoOeahOe8uuWPo+ingeWvueW6lOWtl+auteaXgeeahOazqOmHiu+8mjTimIUv5aSa5pWwIDXimIUg5rGg55qE5riQ6L+bXG4gKiDmpoLnjofnsr7noa7mlbDlgLzmnKzmnLrmoLfmnKzkuI3otrPku6XmoIflrprjgIFgcmVzb2x2ZVRpbWV6b25lYCDnvLrlsJEgc3ZyX2lkL3N2cl9hcmVhIOWIsFxuICogVVRDIOWBj+enu+mHj+eahOecn+WunuaYoOWwhOihqOOAgeiBlOWKqOaxoOeahFwi5pyf5qyh5YaF5L+d5bqV6YeN572uXCLlj4LogIPlrp7njrDlnKjnnJ/lrp7mlbDmja7kuIrlt7JcbiAqIOWkseaViOWboOiAjOacrOaPkuS7tuS4jeWunueOsOOAglxuICovXG5pbXBvcnQgdHlwZSB7IFBsdWdpbk1hbmlmZXN0IH0gZnJvbSBcImdzLXBsdWdpbi1raXRcIjtcblxuLy8g5omT5YyF6ISa5pys77yIc2NyaXB0cy9ncy1idW5kbGUtcGx1Z2lucy5tanPvvInku44gbWFuaWZlc3QudHMg6L+Z5LiA5Liq5YWl5Y+j5ZCM5pe25Y+WXG4vLyBtYW5pZmVzdCDkuI4gaG9va3Mg5Lik5Liq5a+85Ye677yM5LiOIHBsdWdpbnMvZ2Vuc2hpbi9tYW5pZmVzdC50cyDnmoTlhpnms5XkuIDoh7TjgIJcbmV4cG9ydCB7IGhvb2tzIH0gZnJvbSBcIi4vaG9va3MudHNcIjtcblxuLyoqIOWPr+mAieS9huS4jeaOpeWPl+epuuS4suKAlOKAlOepuuS4suW/hemhu+iiq+W9k+aIkOOAjOayoeacieWAvOOAje+8jOS4jeiDveWGkuWFheOAjOacieWAvOOAjeOAgiAqL1xuZnVuY3Rpb24gdG9Ob25FbXB0eVN0cmluZyh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKCk7XG4gIHJldHVybiB0cmltbWVkLmxlbmd0aCA+IDAgPyB0cmltbWVkIDogdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIOWTjeW6lOiusOW9leeahCBgcmVzb3VyY2VJZGAvYHF1YWxpdHlMZXZlbGAg5pivIEpTT04gbnVtYmVy77yIYE1vZGVscy9HYWNoYUFQSS5jc2BcbiAqIOeahCBgcmVzb3VyY2VJZDogaW50YOOAgWBxdWFsaXR5TGV2ZWw6IGludGDvvIzkuJTlt7LooqtcbiAqIGBBVURJVC0yMDI2LTA4LTEyLU0y6bij5r2u55yf5a6e5a2Y5qGj5a6e5rWLLm1kYCDCpzIuMSDnmoTnnJ/lrp7lrZjmoaPlrZfmrrXnsbvlnovnu5/orqFcbiAqIOeLrOeri+ivgeWunu+8ie+8jOS4juexs+WTiOa4uOS4iea4uFwi5pWw5a2X5a2X56ym5LiyXCLkuI3lkIzvvIzlm6DmraTljZXni6zkuIDkuKrovazmjaLlh73mlbDjgIJcbiAqL1xuZnVuY3Rpb24gbnVtZXJpY1RvU3RyaW5nKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIikge1xuICAgIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKCk7XG4gICAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID4gMCA/IHRyaW1tZWQgOiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBgY291bnQ6IGludGDvvIhgTW9kZWxzL0dhY2hhQVBJLmNzYO+8jOWQjOS4iuW3suiiq+ecn+WunuWtmOaho+e7n+iuoeeLrOeri+ivgeWunuaBkuS4uuWQjOS4gFxuICog5pW05pWw5Y+W5YC877yJ44CC6Ziy5b6h5byP6L2s5o2iICsg5byC5bi45YWc5bqV5Li6IDHvvIzlrrnlv43lk43lupTlvaLmgIHkuI7mnKzmnLrmoLjlrp7nmoTmoLfmnKzkuI3lrozlhahcbiAqIOS4gOiHtOeahOaDheWGteOAglxuICovXG5mdW5jdGlvbiB0b0NvdW50KHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiAmJiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpKSByZXR1cm4gdmFsdWU7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBwYXJzZWQgPSBOdW1iZXIodmFsdWUpO1xuICAgIGlmIChOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHBhcnNlZDtcbiAgfVxuICByZXR1cm4gMTtcbn1cblxuLyoqXG4gKiDku44gYFBPU1QgZ21zZXJ2ZXItYXBpLmFraS1nYW1lMi5jb20vZ2FjaGEvcmVjb3JkL3F1ZXJ5YCDlk43lupTkvZPlj5blh7ror6VcbiAqIFBvb2xUeXBlIOeahOWFqOmDqOiusOW9leaVsOe7hOOAglxuICpcbiAqIOKaoO+4jyAqKuWTjeW6lOWkluWxguS/oeWwgeW9ouaAgeacrOi6q+eglOeptuacquimhueblioq77yaYE1vZGVscy9HYWNoYUFQSS5jc2Ag57uZ5Ye655qE5piv5Y2V5p2hXG4gKiDorrDlvZXnmoQgRFRPIOWtl+aute+8jOayoeaciee7meWHuuWTjeW6lOWkluWxguS/oeWwgeeahOWujOaVtCBKU09OIOW9ouaAge+8m+acrOacuuayoeaciem4o+a9riBBUElcbiAqIOeahOecn+WunuaKk+WMheagt+acrOOAgui/memHjOmYsuW+oeW8j+WFvOWuueexs+WTiOa4uOS4iea4uOWQjOaXj+aPkuS7tuW4uOingeeahOS4pOenjeS/oeWwgVxuICog77yIYHsgZGF0YTogWy4uLl0gfWAg5LiOIGB7IGRhdGE6IHsgbGlzdDogWy4uLl0gfSB9YO+8ie+8jOS4pOiAhemDveaYryoq57G75q+UKirvvIxcbiAqIOS4jeaYr+W3suaguOWunuS6i+Wunu+8jOS7u+S9leS4gOWxguW9oueKtuS4jeWvueWwsei/lOWbnuepuuaVsOe7hOiAjOS4jeaYr+aKm+W8guW4uOKAlOKAlOWIhumhteW8leaTjuS8muaKilxuICog56m65pWw57uE5b2T5L2c57uI5q2i5p2h5Lu25aSE55CG77yM5q+U6K6p5LiA5qyh5ZON5bqU5b2i5oCB5LiN56ym55u05o6l5Lit5pat5pW05p2h6YeH6ZuG5rWB56iL5pu05a6J5YWo44CCXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RHYWNoYVJlY29yZExpc3QocmVzcG9uc2U6IHVua25vd24pOiB1bmtub3duW10ge1xuICBpZiAodHlwZW9mIHJlc3BvbnNlICE9PSBcIm9iamVjdFwiIHx8IHJlc3BvbnNlID09PSBudWxsKSByZXR1cm4gW107XG4gIGNvbnN0IGRhdGEgPSAocmVzcG9uc2UgYXMgeyBkYXRhPzogdW5rbm93biB9KS5kYXRhO1xuICBpZiAoQXJyYXkuaXNBcnJheShkYXRhKSkgcmV0dXJuIGRhdGE7XG4gIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiBkYXRhICE9PSBudWxsKSB7XG4gICAgY29uc3QgbGlzdCA9IChkYXRhIGFzIHsgbGlzdD86IHVua25vd24gfSkubGlzdDtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShsaXN0KSkgcmV0dXJuIGxpc3Q7XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG4vKipcbiAqIDEzIOmhuSBgUG9vbFR5cGVgIOihqO+8jOmAkOWtl+auteWPluiHqiBgU2VydmljZXMvQ29uZmlnU2VydmljZS5jczoyOS00M2Ag5Y6f5qC36KGo5qC877yaXG4gKiAgIGAoUG9vbFR5cGUsIOWQjeensCwg5piv5ZCm5paw5omL5rGgLCA14piF56Gs5L+d5bqVLCA04piF56Gs5L+d5bqVLCDkv53lupXmmK/lkKbnu6fmib8pYFxuICpcbiAqIOacrOihqOS/neeVmeecn+ato+eUqOW+l+S4iueahOS4ieWIl++8mmlkIC8gZGlzcGxheU5hbWUgLyBoYXJkUGl0eTVTdGFy77yM5aSW5YqgXG4gKiBgZml2ZVN0YXJHdWFyYW50ZWVLaW5kYO+8iOacrOaPkuS7tuiHquihjOW9kue6s++8jOS4jeWcqCBgQ29uZmlnU2VydmljZS5jc2Ag5Y6f6KGo6YeM77yMXG4gKiDop4HkuIvmlrnljZXni6zor7TmmI7vvInjgII04piFIOehrOS/neW6leaBkuS4uiAxMO+8iOingeS4i+aWuSBgV1VXQV80U1RBUl9IQVJEX1BJVFlg77yJ77yM5LiN5YaNXG4gKiDpnIDopoHpgJDooYzljLrliIbjgILjgIzmmK/lkKbmlrDmiYvmsaDjgI3jgIzkv53lupXmmK/lkKbnu6fmib/jgI3kuKTliJfnm67liY3nmoTmj5Lku7blpZHnuqbph4zmsqHmnInlr7nlupRcbiAqIOWtl+auteWPr+S7peaJv+i9ve+8jOOAjOaYr+WQpue7p+aJv+OAjei/meS4gOWIl+WNs+S9v+acieWtl+auteS5n+aXoOazleato+ehruWunueOsO+8jOingeS4i+aWuVxuICogYHBpdHlHcm91cHNgIOS4gOiKgueahFwi5bey55+l57y65Y+jXCLor7TmmI7jgIJcbiAqXG4gKiBgZml2ZVN0YXJHdWFyYW50ZWVLaW5kYCDlj5blgLzkvp3mja7vvIhgZG9jcy9faW50ZXJuYWwvbWlsZXN0b25lcy9cbiAqIDAzLU0yLem4o+a9ruaPkuS7tuS4juaKveixoeivgeS8qi5tZGAgwqc0LjTvvJpcIuinkuiJsuaxoCA1MC81MO+8jOatpuWZqOaxoOW/heS4reS4jeatqlwi77yJ77yaXG4gKiAgIC0gNSDkuKrjgIzop5LoibLjgI3msaDvvIhpZCAxLzMvOC8xMC8xMu+8ieWPliBgZmlmdHlGaWZ0eWDigJTigJTkvp3mja7mmK/mioogwqc0LjTjgIzop5LoibLmsaBcbiAqICAgICA1MC81MOOAjei/meadoemAmueUqOe7k+iuuuaMieOAjOinkuiJsuWNoeaxoOOAjeWkp+exu+W6lOeUqO+8jOS4jeaYr+WvueW4uOmpuy/mlrDml4Uv6IGU5YqoL+W/huaXhVxuICogICAgIOi/meS6m+WtkOexu+Wei+mAkOS4gOWNleeLrOmqjOivgei/h+OAglxuICogICAtIDUg5Liq44CM5q2m5Zmo44CN5rGg77yIaWQgMi80LzkvMTEvMTPvvInlj5YgYGFsd2F5c1JhdGVVcGDigJTigJTlkIzkuIrvvIzmjInjgIzmrablmajljaHmsaDjgI1cbiAqICAgICDlpKfnsbvlupTnlKjjgIJcbiAqXG4gKiAgIOKaoO+4jyDkuKXmoLzor7TvvIzlj6rmnInjgIzop5LoibLmtLvliqjllKTlj5bjgI3jgIzmrablmajmtLvliqjllKTlj5bjgI3vvIhpZCAxLzLvvInov5nkuKTkuKrlrZDnsbvlnotcbiAqICAg5ZyoIMKnNC40IOmHjOacieebtOaOpeWvueeFp++8jOWFtuS9mSA4IOS4quaYryoq5ZCM57G75o6o5bm/KirjgILmjqjlub/mnKzouqvmmK/lkIjnkIbnmoTpoobln5/mjqjmlq1cbiAqICAg77yI5ouF5L+d6KeE5YiZ5Zyo6bij5r2u6YeM5oyJ54mp5ZOB5aSn57G76ICM6Z2e5oyJ5Y2h5rGg5a2Q57G75Z6L5YiS5YiG77yJ77yM5L2G5a6D5rKh5pyJ6YCQ5rGg5a6e5rWLXG4gKiAgIOiDjOS5puKAlOKAlOiLpeaXpeWQjuafkOS4quWtkOexu+Wei+iiq+WPkeeOsOinhOWImeS4jeWQjO+8jOaUuei/meS4gOWIl+WNs+WPr++8jOS4jeW/heWKqOS7u+S9lemAu+i+keOAglxuICogICAtIDMg5Liq44CM5paw5omL44CN5rGg77yIaWQgNS82LzfvvInlj5YgYG5vbmVg4oCU4oCUKirmsqHmnInku7vkvZXlrp7mtYvkvp3mja4qKu+8jOWPquaYr+ayv+eUqFxuICogICAgIOatpOWJjeeUqOaxoOWQjeWtl+espuS4suWMuemFjeaXtueahOeOsOeKtu+8iOaxoOWQjeS4jeWQq1wi6KeS6ImyXCLkuZ/kuI3lkKtcIuatpuWZqFwi77yM5Yy56YWN5LiN5LiKXG4gKiAgICAg5Lu75L2V5LiA5pSv5omN6JC95YiwIGBub25lYO+8ie+8jOmAkOihjOagh+azqCBgLy8g5peg5a6e5rWL5L6d5o2u77yM5rK/55So546w54q2YOOAglxuICpcbiAqIOS5i+WJjeaYr+S7jiBgcG9vbC5uYW1lYCDnlKggYC5pbmNsdWRlcyhcIuinkuiJslwiKWAvYC5pbmNsdWRlcyhcIuatpuWZqFwiKWAg546w5Zy65o6o5a+8XG4gKiDov5nkuKrlgLzvvIzov5nph4zmlLnmiJDmmL7lvI/liJflh7rigJTigJTmmL7npLrlkI3mmK/nu5nkurrnnIvnmoTvvIzkuI3or6Xmib/mi4VcIuWGs+WumuS/neW6leivreS5iVwi6L+Z5LiqXG4gKiDogYzotKPvvJrmlLnkuIDkuKrlrZfjgIHmiJblh7rnjrDlkIzml7blkKsv6YO95LiN5ZCr6L+Z5Lik5Liq6K+N55qE5rGg5ZCN77yM6K+t5LmJ5Lya6Z2Z6buY5pS55Y+Y77yb5Zu65YyWXG4gKiDmiJDooajmoLzlkI7mr4/kuIDooYznmoTlj5blgLznm7TmjqXlj6/or7vvvIzkuI3nlKjot7PliLDliKvlpITlj43mjqjjgIJcbiAqL1xuY29uc3QgV1VXQV9QT09MX1RZUEVTID0gW1xuICB7IGlkOiBcIjFcIiwgbmFtZTogXCLop5LoibLmtLvliqjllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgeyBpZDogXCIyXCIsIG5hbWU6IFwi5q2m5Zmo5rS75Yqo5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiYWx3YXlzUmF0ZVVwXCIgfSxcbiAgeyBpZDogXCIzXCIsIG5hbWU6IFwi6KeS6Imy5bi46am75ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gIHsgaWQ6IFwiNFwiLCBuYW1lOiBcIuatpuWZqOW4uOmpu+WUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImFsd2F5c1JhdGVVcFwiIH0sXG4gIHsgaWQ6IFwiNVwiLCBuYW1lOiBcIuaWsOaJi+WUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA1MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcIm5vbmVcIiB9LCAvLyDml6Dlrp7mtYvkvp3mja7vvIzmsr/nlKjnjrDnirZcbiAgeyBpZDogXCI2XCIsIG5hbWU6IFwi5paw5omL6Ieq6YCJ5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwibm9uZVwiIH0sIC8vIOaXoOWunua1i+S+neaNru+8jOayv+eUqOeOsOeKtlxuICB7IGlkOiBcIjdcIiwgbmFtZTogXCLmlrDmiYvoh6rpgInllKTlj5bvvIjmhJ/mganlrprlkJHllKTlj5bvvIlcIiwgaGFyZFBpdHk1U3RhcjogMSwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcIm5vbmVcIiB9LCAvLyDml6Dlrp7mtYvkvp3mja7vvIzmsr/nlKjnjrDnirZcbiAgeyBpZDogXCI4XCIsIG5hbWU6IFwi6KeS6Imy5paw5peF5ZSk5Y+WXCIsIGhhcmRQaXR5NVN0YXI6IDgwLCBmaXZlU3Rhckd1YXJhbnRlZUtpbmQ6IFwiZmlmdHlGaWZ0eVwiIH0sXG4gIHsgaWQ6IFwiOVwiLCBuYW1lOiBcIuatpuWZqOaWsOaXheWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImFsd2F5c1JhdGVVcFwiIH0sXG4gIHsgaWQ6IFwiMTBcIiwgbmFtZTogXCLop5LoibLogZTliqjllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgeyBpZDogXCIxMVwiLCBuYW1lOiBcIuatpuWZqOiBlOWKqOWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImFsd2F5c1JhdGVVcFwiIH0sXG4gIHsgaWQ6IFwiMTJcIiwgbmFtZTogXCLop5LoibLlv4bml4XllKTlj5ZcIiwgaGFyZFBpdHk1U3RhcjogODAsIGZpdmVTdGFyR3VhcmFudGVlS2luZDogXCJmaWZ0eUZpZnR5XCIgfSxcbiAgeyBpZDogXCIxM1wiLCBuYW1lOiBcIuatpuWZqOW/huaXheWUpOWPllwiLCBoYXJkUGl0eTVTdGFyOiA4MCwgZml2ZVN0YXJHdWFyYW50ZWVLaW5kOiBcImFsd2F5c1JhdGVVcFwiIH0sXG5dIGFzIGNvbnN0O1xuXG4vKiogNOKYhSDnoazkv53lupXvvIzlhajpg6ggMTMg6aG5IFBvb2xUeXBlIOWFseeUqOWQjOS4gOS4quWAvO+8iGBDb25maWdTZXJ2aWNlLmNzYCDnrKwgNSDliJfmgZLkuLogMTDvvInjgIIgKi9cbmNvbnN0IFdVV0FfNFNUQVJfSEFSRF9QSVRZID0gMTA7XG5cbi8qKiBgZml2ZVN0YXJHdWFyYW50ZWVLaW5kYCDihpIg5a6e6ZmFIGBHdWFyYW50ZWVSdWxlYCDlrZfpnaLph4/lr7nosaHvvIhQMiDooajvvInjgIIgKi9cbmNvbnN0IFdVV0FfRklWRV9TVEFSX0dVQVJBTlRFRV9CWV9LSU5EID0ge1xuICBmaWZ0eUZpZnR5OiB7IGtpbmQ6IFwiZmlmdHlGaWZ0eVwiIGFzIGNvbnN0IH0sXG4gIGFsd2F5c1JhdGVVcDogeyBraW5kOiBcImFsd2F5c1JhdGVVcFwiIGFzIGNvbnN0IH0sXG4gIG5vbmU6IHsga2luZDogXCJub25lXCIgYXMgY29uc3QgfSxcbn0gYXMgY29uc3Q7XG5cbi8qKlxuICog5LuO5pel5b+X6KGM5o+Q5Y+WIGdhY2hhTGluayDnmoTmraPliJnvvIzpgJDlrZflj5boh6rlj4LogIPlrp7njrBcbiAqIO+8iGBVcGRhdGVHYWNoYURhdGFEaWFsb2dWaWV3TW9kZWwuY3NgIOeahCBgUmVnZXguTWF0Y2hgIOiwg+eUqO+8ie+8mlxuICogICBgKGh0dHBzPy4qXFwvYWtpXFwvZ2FjaGFcXC9pbmRleFxcLmh0bWwjXFwvcmVjb3JkW1xcPz0mXFx3XFwtXSspYFxuICpcbiAqIOaMieihjCoq5YCS5bqPKirmiavmj4/jgIHlkb3kuK3nrKzkuIDkuKrljbPlgZzov5nku7bkuovlrozlhajmmK8gUnVzdCBMMVxuICog77yIYGNyYXRlOjpjYWNoZV9zY2FuYO+8ieeahOWunueOsOe7huiKgu+8jOacrOato+WImeWPquWjsOaYjuWMuemFjeaooeW8j+acrOi6q++8jOaPkuS7tuS+p+S4jemcgOimgVxuICog77yI5Lmf5LiN6IO977yJ5aOw5piO5omr5o+P5pa55ZCR44CCXG4gKi9cbmNvbnN0IFdVV0FfR0FDSEFfTElOS19QQVRURVJOID0gLyhodHRwcz8uKlxcL2FraVxcL2dhY2hhXFwvaW5kZXhcXC5odG1sI1xcL3JlY29yZFtcXD89Jlxcd1xcLV0rKS87XG5cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gNeKYhSDmuJDov5vmpoLnjofmm7Lnur9cbi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy9cbi8vIOKaoO+4jyDov5nkuKTkuKrlo7DmmI7lv4XpobvmlL7lnKggYGV4cG9ydCBjb25zdCBtYW5pZmVzdGAg5LmL5YmN4oCU4oCU5LiL6Z2iIGBtYW5pZmVzdC5waXR5R3JvdXBzYFxuLy8g55qEIGBmbGF0TWFwYCDlnKgqKuaooeWdl+axguWAvOacnyoq5bCx5Lya6LCD55SoIGBmaXZlU3RhckN1cnZlYO+8jOiLpeaKilxuLy8gYFdVV0FfRklWRV9TVEFSX1BST0dSRVNTSVZFX0NVUlZFYCDlo7DmmI7mlL7lnKggYG1hbmlmZXN0YCDkuYvlkI7vvIxgY29uc3RgIOS4jeS8mlxuLy8g6KKr5o+Q5Y2H5Yid5aeL5YyW77yI5pqC5pe25oCn5q275Yy677yJ77yM5Lya5Zyo5rGC5YC8IGBtYW5pZmVzdGAg5pe255u05o6l5oqbXG4vLyBcIkNhbm5vdCBhY2Nlc3MgYmVmb3JlIGluaXRpYWxpemF0aW9uXCLjgIJcblxuLyoqXG4gKiA14piFIOa4kOi/m+amgueOh+absue6v+eahCoq57KX57KS5bqm6L+R5Ly8KirvvIzlj6rlr7nnoazkv53lupUgODAg55qE5rGg5a2Q5oiQ56uLXG4gKiDvvIgxLzIvMy80LzYvOC85LzEwLzExLzEyLzEz4oCU4oCU5Y2z6ZmkIDXjgIE3IOS5i+WklueahOWFqOmDqO+8ieOAglxuICpcbiAqIOaVsOWAvOebtOaOpeWPluiHqiBgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqczLjPvvIhQb29sVHlwZVxuICogMS8yLzQg5ZCI5bm244CB5oyJIDEwIOaKveWIhuahtueahOecn+WunuWRveS4reeOh++8jOS4jeaYr+mAkOaKveaLn+WQiOWHuuadpeeahOabsue6v++8ie+8mlxuICogICAxfjYwIOaKve+8muWRveS4reeOh+WcqCAwLjUlfjEuOSUg5LmL6Ze05rOi5Yqo77yM6K+l5paH5qGj5Yik5a6a5Li65bCP5qC35pys5Zmq5aOw77yMXG4gKiAgICAgICAgICAgIOWFreS4quWIhuahtuWdh+WAvCDiiYgwLjkzJe+8jOWbm+iIjeS6lOWFpeWPliAxJSDkvZzkuLogYmFzZVxuICogICA2MX43MCDmir3vvJo2Ljkl77yIMzE3IOS4quagt+acrOOAgTIyIOasoeWRveS4re+8iVxuICogICA3MX44MCDmir3vvJo0OC4xJe+8iDI3IOS4quagt+acrOOAgTEzIOasoeWRveS4re+8jCoq572u5L+h5Yy66Ze05p6B5a69KirigJTigJTmoLfmnKzph4/lsI/vvIxcbiAqICAgICAgICAgICAgIOi/meS4quaVsOWtl+acrOi6q+WwseacieW+iOWkp+S4jeehruWumuaAp++8jOS4jeimgeW9k+aIkOeyvuehruWAvOS9v+eUqO+8iVxuICpcbiAqIGBjcmF0ZXMvZ3MtYW5hbHlzaXMvc3JjL3BpdHkucnNgIOeahCBgZXZhbHVhdGVfY3VydmVgIOWvuSBgUHJvZ3Jlc3NpdmVgIOeahFxuICog6K+t5LmJ5piv44CMYHRhYmxlYCDmr4/kuKrlhYPntKDlr7nlupTkuIDmir3jgI3vvJpgcHVsbF9pbmRleCA8PSBzdGFydGAg5pe25Y+WIGBiYXNlYO+8jFxuICogYHB1bGxfaW5kZXggPiBzdGFydGAg5pe25Y+WIGB0YWJsZVtwdWxsX2luZGV4IC0gc3RhcnQgLSAxXWDvvIjljbMgYHRhYmxlWzBdYFxuICog5a+55bqU56ysIGBzdGFydCArIDFgIOaKve+8ie+8jOS4i+agh+i2iueVjOmSs+WItuWIsOacgOWQjuS4gOS4quWFg+e0oOKAlOKAlOi/meadoeabsue6v+eOsOWcqOS8muiiq1xuICog55yf5a6e5raI6LS577yM5LiN5YaN5piv5Y2g5L2N5aOw5piO44CC5oyJ6L+Z5Liq6K+t5LmJ77yM5LiL6Z2iIDIwIOS4quWFg+e0oOaYr+aKiuS4iumdouS4pOS4qiAxMCDmir1cbiAqIOWIhuahtioq6YCQ5oq95bGV5byAKirvvJrnrKwgNjF+NzAg5oq977yIYHRhYmxlWzAuLjldYO+8ieWPliA2Ljkl77yM56ysIDcxfjgwIOaKvVxuICog77yIYHRhYmxlWzEwLi4xOV1g77yJ5Y+WIDQ4LjEl44CCXG4gKlxuICog4pqg77iPICoq6L+Z5piv5YiG5q615bi45pWw5bGV5byA77yM5LiN5piv6YCQ5oq95qCH5a6aKirvvJrmobblhoXmr4/kuIDmir3lj5blkIzkuIDkuKrlgLzmmK/kuIDkuKrmmL7lvI/nmoRcbiAqIOW7uuaooemAieaLqe+8jOS/oeaBr+mHj+S4juWOn+Wni+WIhuahtuaVsOaNruWujOWFqOebuOWQjO+8jOayoeacieWHreepuue8lumAoOS7u+S9leaWsOS/oeaBr++8m+S9huecn+WunlxuICog5puy57q/5Zyo5qG25YaF5aSn5qaC546H5piv5Y2V6LCD5LiK5Y2H55qE77yI6LaK5o6l6L+R5L+d5bqV5ZG95Lit546H6LaK6auY77yJ77yM5YiG5q615bi45pWw5Lya6K6p5qG255qEXG4gKiDliY3lh6Dmir3mpoLnjoflgY/pq5jjgIHlkI7lh6Dmir3lgY/kvY7vvIzov5nmmK/lt7Lnn6XnmoTov5HkvLzor6/lt67vvIzkuI3mmK/plJnor6/mlbDmja7jgILnrYnmnInpgJDmir1cbiAqIOeyvue7huagt+acrO+8iOWwpOWFtuaYryA3MX44MCDmir3ov5nkuIDmobbvvIwyNyDkuKrmoLfmnKzmkpHkuI3otbfnsr7noa7mm7Lnur/vvInlho3mm7/mjaLjgIJcbiAqL1xuY29uc3QgV1VXQV9GSVZFX1NUQVJfUFJPR1JFU1NJVkVfQ1VSVkUgPSB7XG4gIGtpbmQ6IFwicHJvZ3Jlc3NpdmVcIiBhcyBjb25zdCxcbiAgYmFzZTogMC4wMSxcbiAgc3RhcnQ6IDYwLFxuICAvLyAxMCDkuKogNi45Je+8iOesrCA2MX43MCDmir3vvIkrIDEwIOS4qiA0OC4xJe+8iOesrCA3MX44MCDmir3vvInvvIzlr7nlupTkuIrmlrnms6jph4rnmoRcbiAgLy8g5YiG5q615bi45pWw5bGV5byA44CC55SoIEFycmF5LmZpbGwg5ou85o6l6ICM6Z2e5omL5YaZIDIwIOS4quWtl+mdoumHj++8jOmBv+WFjeaVsOmUmeS4quaVsO+8jFxuICAvLyDkuZ/orqnjgIwxMCArIDEw44CN6L+Z5Liq5YiG5qG257uT5p6E5Zyo5Luj56CB6YeM5L+d5oyB5Y+v6KeB44CCXG4gIHRhYmxlOiBbLi4uQXJyYXkoMTApLmZpbGwoMC4wNjkpLCAuLi5BcnJheSgxMCkuZmlsbCgwLjQ4MSldLFxufTtcblxuLyoqXG4gKiDmjIkgUG9vbFR5cGUg5YiG5rS+IDXimIUg5puy57q/44CCXG4gKlxuICogLSBQb29sVHlwZSA377yI5paw5omL6Ieq6YCJ5ZSk5Y+WwrfmhJ/osKLlrprlkJHllKTlj5bvvInvvJrnoazkv53lupUgPSAx77yM5pWw5a2m5LiK55u05o6l562J5Lu35LqOXG4gKiAgIFwi5q+P5qyh5ZSk5Y+W6YO95b+F5Ye6IDXimIVcIu+8jOS4jeaYr+eMnOa1i+KAlOKAlOehrOS/neW6leaVsOWAvOacrOi6q+WGs+WumueahO+8jOS4jeS+nei1luS7u+S9leWunua1i1xuICogICDmoLfmnKzjgIJcbiAqIC0gUG9vbFR5cGUgNe+8iOaWsOaJi+WUpOWPlu+8jOehrOS/neW6lSA1MO+8ie+8muecn+WunuWtmOaho+Wunua1i+ivpeaxoCAqKjAg5p2h6K6w5b2VKipcbiAqICAg77yIYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKnMS4yIFwi56m65qe95L2NXCLliJflh7ogNSDlnKjlhoXvvInvvIxcbiAqICAg6ICMIGBXVVdBX0ZJVkVfU1RBUl9QUk9HUkVTU0lWRV9DVVJWRWAg55qE5puy57q/5b2i54q25piv5LuO56Gs5L+d5bqVIDgwIOeahOS4ieS4quaxoFxuICogICDvvIgxLzIvNO+8ieWunua1i+aVsOaNrumHjOaOqOWHuueahOKAlOKAlOa4kOi/m+absue6v+eQhuW6lOmaj+ehrOS/neW6leS9jee9ruacrOi6q+WPmOWMlu+8iOS/neW6lSA1MFxuICogICDnmoTmsaDlrZDkuI3lj6/og73lnKjnrKwgNjAg5oq95omN5byA5aeLXCLot4PljYdcIu+8jOmCo+W3sue7j+i2hei/h+ehrOS/neW6leacrOi6q++8ie+8jOaKiiA4MCDnoaxcbiAqICAg5L+d5bqV5rGg5a2Q55qE5puy57q/55u05o6l5aWX5YiwIDUwIOehrOS/neW6leeahOaxoOWtkOS4iuaYr+ayoeacieivgeaNruaUr+aMgeeahOWkluaOqO+8jOWboOatpFxuICogICDmnKzmsaDku43nlKggY3VzdG9tIOWNoOS9je+8jOS4jeWkluaOqOOAglxuICogLSDlhbbkvZnlhajpg6jnoazkv53lupUgODAg55qE5rGg5a2Q77ya5YWx55So5ZCM5LiA5p2hIGBXVVdBX0ZJVkVfU1RBUl9QUk9HUkVTU0lWRV9DVVJWRWBcbiAqICAg4oCU4oCU5Y+q5pyJIDEvMi80IOS4ieS4quaxoOacieecn+Wunuagt+acrO+8jOWFtuS9meWQjOehrOS/neW6leaxoOWtkOayoeacieeLrOeri+agt+acrO+8jOS9huS5n+ayoeaciVxuICogICDku7vkvZXnkIbnlLHorqTkuLrlroPku6znmoTmm7Lnur/lvaLnirbkuI3lkIzvvIznlKjlkIzkuIDmnaHmm7Lnur/mmK9cIueUqOS7heacieeahOivgeaNruS4gOiHtOWcsOW6lOeUqFwi77yMXG4gKiAgIOS4jeaYr+mAkOaxoOe8lumAoOWHuuS6kuS4jeebuOWQjOeahOaVsOWtl+OAglxuICovXG5mdW5jdGlvbiBmaXZlU3RhckN1cnZlKHBvb2w6ICh0eXBlb2YgV1VXQV9QT09MX1RZUEVTKVtudW1iZXJdKSB7XG4gIGlmIChwb29sLmhhcmRQaXR5NVN0YXIgPT09IDEpIHtcbiAgICByZXR1cm4geyBraW5kOiBcImZsYXRcIiBhcyBjb25zdCwgYmFzZTogMSB9O1xuICB9XG4gIGlmIChwb29sLmhhcmRQaXR5NVN0YXIgIT09IDgwKSB7XG4gICAgcmV0dXJuIHsga2luZDogXCJjdXN0b21cIiBhcyBjb25zdCwgaWQ6IGB3dXdhLXVuY29uZmlybWVkLTVzdGFyLXBvb2wtJHtwb29sLmlkfWAgfTtcbiAgfVxuICByZXR1cm4gV1VXQV9GSVZFX1NUQVJfUFJPR1JFU1NJVkVfQ1VSVkU7XG59XG5cbmV4cG9ydCBjb25zdCBtYW5pZmVzdCA9IHtcbiAgaWQ6IFwid3V3YVwiLFxuICBkaXNwbGF5TmFtZTogeyBcInpoLUNOXCI6IFwi6bij5r2uXCIgfSxcbiAgc2RrVmVyc2lvbjogXCIxLjAuMFwiLFxuICBwbGF0Zm9ybXM6IFtcIndpbmRvd3NcIl0sXG4gIG1haW50YWluZXJzOiBbXCJnYWNoYS1zdHVkaW9cIl0sXG4gIC8vIGV4Y2hhbmdlRm9ybWF0cyDkuI3lo7DmmI7vvJrpuKPmva7msqHmnInlt7Lnn6XnmoTlhazlvIDmoIflh4bkuqTmjaLmoLzlvI/vvIhXV0dGIOS5i+exu+eahOivtOazlVxuICAvLyDmnKrnu4/or4Hlrp7vvIxgcmVzZWFyY2gvMDFgIMKnMy4yIOW3suehruiupOWPguiAg+WunueOsOeahOacrOWcsOWtmOaho+aYr+iHquWumuS5iSBKU09OIOe7k+aehFxuICAvLyDogIzpnZ7ku7vkvZXmoIflh4bmoLzlvI/vvInvvIzlo7DmmI7kuIDkuKrkuI3lrZjlnKjnmoTmoLzlvI/mr5TkuI3lo7DmmI7mm7TmnInlrrPjgIJcblxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy8gY29sbGVjdO+8muWFiOS7jiBDbGllbnQubG9nIOaLv+WHreaNru+8iGdhY2hhTGlua++8ie+8jOWGjeiwgyByZWNvcmQvcXVlcnkg5o6l5Y+jXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICBjb2xsZWN0OiB7XG4gICAgcGFyYWRpZ206IFwiY3JlZGVudGlhbGVkQXBpXCIsXG4gICAgcGFyYW1zOiB7XG4gICAgICBjcmVkZW50aWFsOiB7XG4gICAgICAgIGtpbmQ6IFwibG9nRmlsZVwiLFxuICAgICAgICAvLyDimqDvuI8g55u45a+554mH5q6177yM5LiN5piv57ud5a+56Lev5b6E4oCU4oCUYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jczo2Ni02N2BcbiAgICAgICAgLy8g5pi+56S65a6Y5pa55ZCv5Yqo5Zmo5LiOIFdlR2FtZSDlkK/liqjlmajnmoTml6Xlv5fnm7jlr7not6/lvoTkuI3lkIzvvIjlrpjmlrnlkK/liqjlmajlnKjmuLjmiI9cbiAgICAgICAgLy8g55uu5b2V5LiL5aSa5aWX5LiA5bGCIFwiV3V0aGVyaW5nIFdhdmVzIEdhbWUvXCLvvIxXZUdhbWUg5rKh5pyJ6L+Z5LiA5bGC77yJ44CCXG4gICAgICAgIC8vIGBsb2dQYXRoYCDnm67liY3ku43mmK/ljZXkuKrlrZfnrKbkuLLlrZfmrrXvvIzoo4XkuI3kuIvkuKTkuKrlgJnpgInvvJtSdXN0IOS+p1xuICAgICAgICAvLyBgbG9jYXRlX2xvZ19jYW5kaWRhdGVzYCDkvJrlkIzml7blsJ3or5VcIuebtOaOpeWRveS4rVwi5LiOXCLmgbDlpb3kuIDlsYLlrZDnm67lvZVcIuS4pOenjVxuICAgICAgICAvLyDlgJnpgInot6/lvoTvvIzlm6DmraTov5nph4wqKuS4jeimgSoq5oqKIFwiV3V0aGVyaW5nIFdhdmVzIEdhbWVcIiDliY3nvIDlhpnov5vmnaXigJTigJRcbiAgICAgICAgLy8g5YaZ5LqG5Y+N6ICM5Y+q6IO95Yy56YWN5a6Y5pa55ZCv5Yqo5Zmo6L+Z5LiA56eN77yMUnVzdCDkvqfnmoTlj4zlgJnpgInmnLrliLblsLHnlKjkuI3kuIrkuobjgIJcbiAgICAgICAgbG9nUGF0aDogXCJDbGllbnQvU2F2ZWQvTG9ncy9DbGllbnQubG9nXCIsXG4gICAgICAgIHVybFBhdHRlcm46IFdVV0FfR0FDSEFfTElOS19QQVRURVJOLFxuICAgICAgICAvLyDlrZfoioLnuqfop6Pmt7fmt4blj4LmlbDvvJrot7Pov4fliY0gMyDlrZfoioLvvIzmraTlkI7pgJDlrZfoioLmjIkqKuivpeWtl+iKguiHqui6q+eahOWAvCoqXG4gICAgICAgIC8vIO+8iOS4jeaYr+S4i+agh++8ieeahOWlh+WBtuWIhuWIq+W8guaIliAweEE1LzB4RUbjgILmupDnoIHkvp3mja5cbiAgICAgICAgLy8gYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2Ag56ysIDExOH4xMjMg6KGM77yaXG4gICAgICAgIC8vICAgYGJ5dGUgYiA9IGVuY3J5cHRlZFtpXTsgaWYgKChiICYgMSkgPT0gMSkgYiBePSAweEE1OyBlbHNlIGIgXj0gMHhFRjtgXG4gICAgICAgIC8vIOWIpOaNruaYryBi77yI5a2X6IqC5YC877yJ77yM5b6q546v5Y+Y6YePIGkg5Y+q55So5LqO5Y+W5YC85ZKM5YaZ5Zue77yM5LiO5LiL5qCH5peg5YWz4oCU4oCU6L+Z5p2hXG4gICAgICAgIC8vIOW3sue7j+iiq+ivgeS8qui/h+S4gOasoeS6jOaJi+i9rOi/sO+8iGByZXNlYXJjaC8wMWAg5Y6f6K6w6L296bij5r2u5pel5b+X5piv5piO5paH77yM5Y6L5qC5XG4gICAgICAgIC8vIOayoeaPj+i/sOi/h+ino+egge+8ie+8jOWboOatpOWPquiupOi/meautea6kOeggeWOn+aWh++8jOS4jeiupOS7u+S9lei9rOi/sOOAglxuICAgICAgICBkZWNvZGU6IHsga2luZDogXCJ4b3JCeUxvd0JpdFwiLCBza2lwQnl0ZXM6IDMsIG1hc2tXaGVuT2RkOiAweGE1LCBtYXNrV2hlbkV2ZW46IDB4ZWYgfSxcbiAgICAgIH0sXG5cbiAgICAgIC8vIFBPU1QgKyBKU09OIGJvZHnjgILlrZfmrrXmmKDlsITpgJDlrZflj5boh6pcbiAgICAgIC8vIGBVcGRhdGVHYWNoYURhdGFEaWFsb2dWaWV3TW9kZWwuY3M6MTYzLTE5NmDvvIhxdWVyeSDlj4LmlbDop6PmnpDvvInkuI5cbiAgICAgIC8vIGA6MjM5LTI1M2DvvIjmnoTpgKDor7fmsYLkvZPvvInvvJpcbiAgICAgIC8vICAgcmVzb3VyY2VzX2lkIOKGkiBjYXJkUG9vbElkICAgIGxhbmcgICAgICDihpIgbGFuZ3VhZ2VDb2RlXG4gICAgICAvLyAgIHBsYXllcl9pZCAgICDihpIgcGxheWVySWQgICAgICByZWNvcmRfaWQg4oaSIHJlY29yZElkXG4gICAgICAvLyAgIHN2cl9pZCAgICAgICDihpIgc2VydmVySWQgICAgICDvvIjpmo/ljaHmsaDlj5jljJbvvInihpIgY2FyZFBvb2xUeXBlXG4gICAgICAvL1xuICAgICAgLy8g4pqg77iPICoq5byV5Y+36Zm36Zix77yM5YWt5Liq5a2X5q616YeM5Lik5Liq5LiN6IO95Yqg5byV5Y+3KirvvJpgY2FyZFBvb2xJZGAvYGxhbmd1YWdlQ29kZWAvXG4gICAgICAvLyBgcmVjb3JkSWRgL2BzZXJ2ZXJJZGAg5ZyoIEMjIOmHjOaYryBgc3RyaW5nYO+8jOW6j+WIl+WMluWQjuaYryBKU09OIOWtl+espuS4su+8jFxuICAgICAgLy8gYm9keSDmqKHmnb/ph4zlr7nlupTnmoTljaDkvY3nrKbopoHliqDlvJXlj7fvvJvkvYYgYGNhcmRQb29sVHlwZWAg55u05o6l6LWL5YC8XG4gICAgICAvLyBgZ2FjaGFQb29sLlBvb2xUeXBlYO+8iGBpbnRg77yJ77yMYHBsYXllcklkYCDmmK8gYGxvbmcuUGFyc2UoLi4uKWAg55qE57uT5p6cXG4gICAgICAvLyDvvIhgbG9uZ2DvvInigJTigJTov5nkuKTkuKrlnKggQyMg5L6n6YO95piv5pWw5YC857G75Z6L77yMYEpzb25Db252ZXJ0LlNlcmlhbGl6ZU9iamVjdGBcbiAgICAgIC8vIOS8muaKiuWug+S7rOW6j+WIl+WMluaIkOS4jeW4puW8leWPt+eahCBKU09OIOaVsOWtl+OAguWNoOS9jeespuabv+aNouaYr+e6r+Wtl+espuS4suaLvOaOpVxuICAgICAgLy8g77yIYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2Ag55qEXG4gICAgICAvLyBgc3Vic3RpdHV0ZV9wbGFjZWhvbGRlcnNg77yJ77yM5qih5p2/6YeM57uZIGB7e2dhY2hhVHlwZX19YC9cbiAgICAgIC8vIGB7e2NyZWRlbnRpYWwucGxheWVyX2lkfX1gIOWll+S4iuW8leWPt+S8muS6p+WHuiBgXCJjYXJkUG9vbFR5cGVcIjpcIjFcImDigJTigJRcbiAgICAgIC8vIOacjeWKoeerr+aUtuWIsOeahOaYr+Wtl+espuS4siBcIjFcIiDogIzkuI3mmK/mlbDlrZcgMe+8jOS4juecn+WunuWuouaIt+err+WPkemAgeeahOivt+axguW9ouaAgVxuICAgICAgLy8g5LiN5LiA6Ie077yM5Zug5q2k5LiL6Z2iIGJvZHkg5qih5p2/6YeM6L+Z5Lik5aSEKirmlYXmhI/kuI3liqDlvJXlj7cqKuOAglxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICB1cmw6IFwiaHR0cHM6Ly9nbXNlcnZlci1hcGkuYWtpLWdhbWUyLmNvbS9nYWNoYS9yZWNvcmQvcXVlcnlcIixcbiAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICAgIC8vIOWPguiAg+WunueOsOWbuuWumumZhOW4pueahCBVc2VyLUFnZW5077yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2BcbiAgICAgICAgICAvLyBgY2xpZW50LkRlZmF1bHRSZXF1ZXN0SGVhZGVycy5BZGQoXCJVc2VyLUFnZW50XCIsIC4uLilgIOiwg+eUqOWkhO+8jOWOn+agt+aKhOW9le+8ieOAglxuICAgICAgICAgIFwiVXNlci1BZ2VudFwiOlxuICAgICAgICAgICAgXCJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCA2LjI7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS85Mi4wLjQ1MTUuMTA3IFNhZmFyaS81MzcuMzZcIixcbiAgICAgICAgfSxcbiAgICAgICAgYm9keTpcbiAgICAgICAgICAne1wiY2FyZFBvb2xJZFwiOlwie3tjcmVkZW50aWFsLnJlc291cmNlc19pZH19XCIsXCJjYXJkUG9vbFR5cGVcIjp7e2dhY2hhVHlwZX19LCcgK1xuICAgICAgICAgICdcImxhbmd1YWdlQ29kZVwiOlwie3tjcmVkZW50aWFsLmxhbmd9fVwiLFwicGxheWVySWRcIjp7e2NyZWRlbnRpYWwucGxheWVyX2lkfX0sJyArXG4gICAgICAgICAgJ1wicmVjb3JkSWRcIjpcInt7Y3JlZGVudGlhbC5yZWNvcmRfaWR9fVwiLFwic2VydmVySWRcIjpcInt7Y3JlZGVudGlhbC5zdnJfaWR9fVwifScsXG4gICAgICB9LFxuXG4gICAgICAvLyDimqDvuI8gKirlj6rmlL7lm73mnI0gYC5jb21g77yM5Yi75oSP5LiN6aKE5pS+5Zu96ZmF5pyNIGAubmV0YCoq77ya5Y+C6ICD5a6e546w5oyJ5Yet5o2uXG4gICAgICAvLyBgc3ZyX2FyZWFgIOWcqOS4pOS4qiBob3N0IOS5i+mXtOS6jOmAieS4gO+8iGBVcGRhdGVHYWNoYURhdGFEaWFsb2dWaWV3TW9kZWwuY3NgXG4gICAgICAvLyBgc2VydmVyQ04gPyBcIi4uLi5jb21cIiA6IFwiLi4uLm5ldFwiYO+8ie+8jOS9huacrOmhueebruacrOacuuWPquacieWbveacjeWtmOaho+agt+acrO+8jFxuICAgICAgLy8g5Zu96ZmF5pyN5YiG5pSv5peg5rOV6aqM6K+B44CCYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2BcbiAgICAgIC8vIOmHjCBgUmVxdWVzdFRlbXBsYXRlSnNvbmAg5LiK5pa555qEXCLlt7Lnn6XnvLrlj6MgQzhcIuazqOmHiuW3sue7j+aKiui/meadoemSieatu++8mlxuICAgICAgLy8gXCJjb2xsZWN0LnBhcmFtcy5hbGxvd2VkSG9zdHMg6YeM5ZCM5qC35LiN6aKE5pS+IC5uZXTvvJrpooTmlL7nrYnkuo7lo7DmmI7kuIDkuKrot5HkuI3liLBcbiAgICAgIC8vIOeahOiDveWKm1wi44CC6aKE5pS+5LiA5Liq5pyq57uP6aqM6K+B44CB5b2T5YmN6K+35rGC5qih5p2/5Lmf5omT5LiN5Yiw55qEIGhvc3TvvIzlj6rkvJrliLbpgKDkuIDnp41cbiAgICAgIC8vIFwi55yL6LW35p2l5pSv5oyB5Zu96ZmF5pyNXCLnmoTlgYfosaHjgILnrYnnnJ/nmoTmnInlm73pmYXmnI3moLfmnKzml7bvvIzpnIDopoHlkIzml7booaVcbiAgICAgIC8vIOivt+axguerr+eCueWIhuaUr+acuuWItuS4jui/memHjOeahOeZveWQjeWNle+8jOS4pOiAhee8uuS4gOS4jeWPr+OAglxuICAgICAgYWxsb3dlZEhvc3RzOiBbXCJnbXNlcnZlci1hcGkuYWtpLWdhbWUyLmNvbVwiXSxcblxuICAgICAgZXh0cmFjdExpc3Q6IGV4dHJhY3RHYWNoYVJlY29yZExpc3QsXG5cbiAgICAgIC8vIOaOpeWPo+acrOi6q+S4jeWIhumhte+8jOS4gOasoeivt+axguWNs+aLv+WIsOivpeWNoeaxoOWFqOmDqOiusOW9lVxuICAgICAgLy8g77yIYFVwZGF0ZUdhY2hhRGF0YURpYWxvZ1ZpZXdNb2RlbC5jc2Ag6YeM5q+P5Liq5Y2h5rGg5Y+q5Y+R5LiA5qyhIFBPU1TvvIzmsqHmnIlcbiAgICAgIC8vIOS7u+S9leWIhumhteWPguaVsO+8ieOAgueUqOe8uuecgeeahCBgZW1wdHlQYWdlYCDkvJrlr7nlkIzkuIDku73lhajph4/lk43lupTmrbvlvqrnjq/jgIJcbiAgICAgIC8vXG4gICAgICAvLyDimqDvuI8g6L+Z5LiN5Y+q5pivXCLmjqXlj6PlvaLmgIHlpoLmraRcIui/meS5iOeugOWNleKAlOKAlGBob29rcy5kZXJpdmVSZWNvcmRLZXlzYO+8iOingVxuICAgICAgLy8gYC4vaG9va3MudHNg77yJ5L6d6LWWXCLmr4/mrKHpg73mmK/mlbTmsaDlhajph4/mi4nlj5ZcIui/meadoeWJjeaPkOiuoeeul+aJueasoeWGheW6j+S9je+8jFxuICAgICAgLy8g6Iul5pel5ZCO6K+v5pS55oiQ5aKe6YePL+WIhumhtemHh+mbhu+8jOW6j+S9jeS8muWcqOWxgOmDqOmbhuWQiOS4iuiuoeeul++8jFxuICAgICAgLy8gYEFVRElULTIwMjYtMDgtMTItTTLpuKPmva7nnJ/lrp7lrZjmoaPlrp7mtYsubWRgIMKnMS44IOWunua1i+eahCAzMi42MCVcbiAgICAgIC8vIO+8iDEwOTkvMzM3Me+8jGtleSDmraPnoa7mgKfkvp3otZbluo/kvY3nmoTorrDlvZXvvInkvJrnq4vliLvlh7rnjrAga2V5IOa8guenu+OAglxuICAgICAgc3RvcENvbmRpdGlvbjogeyBraW5kOiBcInNpbmdsZVJlcXVlc3RcIiB9LFxuXG4gICAgICAvLyDljaHmsaDlvZLlsZ7ku6XmnKzmrKHmn6Xor6LnlKjnmoQgYmFubmVyIOS4uuWHhu+8jOS4jeS/oeWTjeW6lOKAlOKAlOm4o+a9ruWTjeW6lOiusOW9lemHjOeahFxuICAgICAgLy8gYGNhcmRQb29sVHlwZWAg5piv5LiN5Y+v6L+Y5Y6f55qE5Lit5paH5bGV56S65qCH562+77yI6KeB5LiL5pa5XG4gICAgICAvLyBgZmllbGRzLmV4dHJhY3RSZWNvcmRgIOmHjCBgYmFubmVySWRgIOWtl+auteaXgeeahOivpue7huivtOaYju+8ie+8jOiAjOm4o+a9rlxuICAgICAgLy8g5LiA5qyh5p+l6K+i5Y+q6L+U5Zue5LiA5Liq5rGg55qE5YWo6YeP6K6w5b2V77yM5LiN5a2Y5Zyo5re35rGg77yM5Zug5q2k5p+l6K+i5pe255qEIGJhbm5lclxuICAgICAgLy8g5bCx5piv5ZSv5LiA5p2D5aiB5p2l5rqQ44CC5LiO5Y6f56We55u45Y+N4oCU4oCU5Y6f56We5LiA5qyh5p+l6K+i5Lya5re35Zue5YW25a6D5Y2h5rGg55qE6K6w5b2VXG4gICAgICAvLyDvvIhgZml4dHVyZXMvZ2Vuc2hpbi9yYXdfcmVzcG9uc2UvMzAxX3BhZ2VfMS5qc29uYCDlrp7mtYvvvInvvIzlv4Xpobvkv6FcbiAgICAgIC8vIOWTjeW6lOOAguWujOaVtOWvueeFp+ingSBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag6YeMXG4gICAgICAvLyBgQ3JlZGVudGlhbGVkQXBpUGlwZWxpbmVQYXJhbXMuYmFubmVySWRlbnRpdHlgIOeahOaWh+aho+OAglxuICAgICAgYmFubmVySWRlbnRpdHk6IFwicXVlcnlcIixcbiAgICB9LFxuICB9LFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBmaWVsZHPvvJrlk43lupTorrDlvZUg4oaSIOe7n+S4gOWtl+autVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgZmllbGRzOiB7XG4gICAgZXh0cmFjdFJlY29yZDogKHJhdykgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByYXcgIT09IFwib2JqZWN0XCIgfHwgcmF3ID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIum4o+a9riBleHRyYWN0UmVjb3JkIOaUtuWIsOmdnuWvueixoeW9ouaAgeeahOWOn+Wni+iusOW9lVwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHJlY29yZCA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcblxuICAgICAgLy8g5ZON5bqU6K6w5b2V5a2X5q6177yIYE1vZGVscy9HYWNoYUFQSS5jc2DvvInvvJpcbiAgICAgIC8vICAgY2FyZFBvb2xUeXBlOiBzdHJpbmcgICByZXNvdXJjZUlkOiBpbnQgICAgICBxdWFsaXR5TGV2ZWw6IGludFxuICAgICAgLy8gICByZXNvdXJjZVR5cGU6IHN0cmluZyAgIG5hbWU6IHN0cmluZyAgICAgICAgIGNvdW50OiBpbnRcbiAgICAgIC8vICAgdGltZTogRGF0ZVRpbWVcbiAgICAgIC8vIOayoeacieS7u+S9leW9ouW8j+eahOiusOW9lSBJRO+8iOaXoCBpZC91dWlkL2luZGV477yJ77yM5LiO55yf5a6e5a2Y5qGj5a6e5rWL57uT6K665LiA6Ie0XG4gICAgICAvLyDvvIhgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqfkuIDvvInigJTigJTlm6DmraQgc3RhYmxlSWQg5LiN5aGr77yMXG4gICAgICAvLyBgaG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5b+F6aG75a6e546w77yI6KeBIGAuL2hvb2tzLnRzYO+8ie+8jOS4jeiDveS+nei1luWuv+S4u1xuICAgICAgLy8g5YWc5bqV55SoIHN0YWJsZUlk44CCXG4gICAgICBjb25zdCBpdGVtSWQgPSBudW1lcmljVG9TdHJpbmcocmVjb3JkLnJlc291cmNlSWQpO1xuICAgICAgaWYgKCFpdGVtSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwi6bij5r2uIGV4dHJhY3RSZWNvcmTvvJrorrDlvZXnvLrlsJEgcmVzb3VyY2VJZO+8jOaXoOazleehruWumiBpdGVtSWRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB7XG4gICAgICAgIGl0ZW1JZCxcbiAgICAgICAgdGltZTogdG9Ob25FbXB0eVN0cmluZyhyZWNvcmQudGltZSkgPz8gXCJcIixcbiAgICAgICAgLy8g4pqg77iPICoq5pys5a2X5q615LiN55Sx5ZON5bqU5Yaz5a6aKirigJTigJRgZml4dHVyZXMvd3V3YS9yYXdfcmVzcG9uc2UvMV9wYWdlXzEuanNvbmBcbiAgICAgICAgLy8g55yf5a6e5qC35pys6K+B5a6e77yMUG9vbFR5cGU9MSDnmoTlk43lupTorrDlvZXph4wgYGNhcmRQb29sVHlwZWAg5Y+W5YC85piv5Lit5paHXG4gICAgICAgIC8vIOWxleekuuagh+etviBgXCLop5LoibLnsr7lh4bosIPosJBcImDvvIwqKuS4jeaYryoqIGBcIjFcImDvvJvlj6rmnIkgYDEwX3BhZ2VfMS5qc29uYFxuICAgICAgICAvLyDvvIhQb29sVHlwZT0xMO+8ieaBsOWlvemZjee6p+aIkOS6huaVsOWtl+Wtl+espuS4siBgXCIxMFwiYOOAguS5n+WwseaYr+ivtFxuICAgICAgICAvLyBgY2FyZFBvb2xUeXBlYCDlpJrmlbDmg4XlhrXkuIvkuI3mmK8gYFdVV0FfUE9PTF9UWVBFU2Ag6KGo55qEIGlk77yM55u05o6l5ou/5a6DXG4gICAgICAgIC8vIOW9kyBiYW5uZXJJZCDkvJrkuqflh7rkuIDkuKrkuI3ljLnphY3ku7vkvZUgYGJhbm5lcnNbXS5pZGAvXG4gICAgICAgIC8vIGBwaXR5R3JvdXBzW10ubWVtYmVyc2Ag55qE5a2X56ym5Liy77yM5L+d5bqV57uf6K6h5Lya5a+56L+Z5Lqb6K6w5b2V6Z2Z6buY5aSx5pWI44CCXG4gICAgICAgIC8vXG4gICAgICAgIC8vIOi/meS4jeaYr1wi5YC85Y+W6ZSZ5LqGXCLov5nkuYjnroDljZXvvJpgRmllbGRNYXBwaW5nLmV4dHJhY3RSZWNvcmRgIOeahOetvuWQjeaYr1xuICAgICAgICAvLyBgKHJhdzogdW5rbm93bikgPT4gVW5pZmllZFJlY29yZEZpZWxkc2DvvIwqKuayoeacieS7u+S9leWPguaVsOiDveWRiuivieWug1xuICAgICAgICAvLyDov5nmibnorrDlvZXmmK/mn6Xor6Llk6rkuKogUG9vbFR5cGUg5b6X5Yiw55qEKirigJTigJTov5nmmK/nu5PmnoTmgKfpmZDliLbvvIzkuI3mmK/og73lnKhcbiAgICAgICAgLy8g6L+Z5Liq5Ye95pWw5YaF6YOo5L+u5aW955qE5a6e546w57uG6IqC77yIUE9TVCBib2R5IOmHjOWPkeeahCBgY2FyZFBvb2xUeXBlYCDmmK9cbiAgICAgICAgLy8g5oiR5Lus6Ieq5bex5oyH5a6a55qE5p+l6K+i5Y+C5pWw77yM5ZON5bqU6YeM5ZCM5ZCN5a2X5q615Y205piv5pyN5Yqh56uv6Ieq5bex55qE5bGV56S65YC877yMXG4gICAgICAgIC8vIOS4pOiAheS4jeS/neivgeS4gOiHtO+8jOecn+WunuaVsOaNruW3sue7j+ivgeS8qlwi5LiA6Ie0XCLov5nkuKrlgYforr7vvInjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g5Zug5q2k6L+Z6YeM5LiN5YaN5bCd6K+V5LuO5ZON5bqU6Kej5p6Q5Y2h5rGg5b2S5bGe77yM5pS555So5a6/5Li75L6n6KaG55uW77yaXG4gICAgICAgIC8vIGBjb2xsZWN0LnBhcmFtcy5iYW5uZXJJZGVudGl0eTogXCJxdWVyeVwiYO+8iOingeS4iuaWueWjsOaYju+8ieiuqeWuv+S4uyoq5ZyoXG4gICAgICAgIC8vIOacrOWHveaVsOi/lOWbnuS5i+WQjuOAgeiwg+eUqCBgaG9va3MuZGVyaXZlUmVjb3JkS2V5c2Ag5LmL5YmNKirvvIzlsLHmiorov5nkuKrlrZfmrrVcbiAgICAgICAgLy8g5o2i5oiQ5Y+R6LW35pys5qyh5p+l6K+i5pe25a6e6ZmF5L2/55So55qEIGJhbm5lciBpZOKAlOKAlOWujOaVtOWGs+etluS+neaNruingVxuICAgICAgICAvLyBgcGFja2FnZXMvZ3MtcGx1Z2luLWtpdC9tYW5pZmVzdC50c2Ag6YeMXG4gICAgICAgIC8vIGBDcmVkZW50aWFsZWRBcGlQaXBlbGluZVBhcmFtcy5iYW5uZXJJZGVudGl0eWAg55qE5paH5qGj77yI5Y6f56We5Lya5re35rGgXG4gICAgICAgIC8vIOW/hemhu+S/oeWTjeW6lO+8jOm4o+a9ruS4jea3t+axoOW/hemhu+S/oeafpeivou+8jOS4pOiAheWvueeFp++8ieOAglxuICAgICAgICAvL1xuICAgICAgICAvLyDimqDvuI8g6KaG55uW5pe25py65piv44CM5ZyoIGhvb2tzIOS5i+WJjeOAjeiAjOS4jeaYr+OAjOiQveW6k+aXtuOAje+8jOi/meS4gOeCueWvuVxuICAgICAgICAvLyBgcmVjb3JkX2tleWAg55qE5q2j56Gu5oCn5piv5b+F6KaB55qE77yaYGhvb2tzLmRlcml2ZVJlY29yZEtleXNg77yI6KeBXG4gICAgICAgIC8vIGAuL2hvb2tzLnRzYO+8ieS8muivuyBgYmFubmVySWRgIOWPguS4juWTiOW4jO+8jOiLpeWug+eci+WIsOeahOaYr+S4i+mdoui/meS4quS4juWNoeaxoFxuICAgICAgICAvLyDml6DlhbPnmoTljaDkvY3lgLzvvIxrZXkg5bCx5bCR5LqG5Y2h5rGg6L+Z5LiA57u04oCU4oCU6bij5r2u5Y2B6L+e5pW057uE5YWx55So5ZCM5LiA5Liq5pe26Ze05oiz77yMXG4gICAgICAgIC8vIOiAjCAz4piFIOatpuWZqOWQjOaXtuWHuueOsOWcqOinkuiJsuaxoOS4juatpuWZqOaxoO+8jOS4pOaxoOWQjOS4gOenkuWQhOWHuuS4gOasoeWQjOS4gOS7tiAz4piFIOS4lFxuICAgICAgICAvLyDnu4TlhoXluo/kvY3nm7jlkIzml7bkvJrnrpflh7rnm7jlkIznmoQga2V577yM6KKrIGBVTklRVUUoYWNjb3VudF9pZCwgcmVjb3JkX2tleSlgXG4gICAgICAgIC8vICsgYElOU0VSVCBPUiBJR05PUkVgIOmdmem7mOWQnuaOieS4gOadoeOAguWuv+S4u+S+p+WvueW6lOWunueOsOS4jumSieS9j+ivpeaXtuacuueahOaWreiogFxuICAgICAgICAvLyDop4EgYGNyYXRlcy9wYXJhZGlnbXMvZ3MtcC1hdXRoa2V5L3NyYy9waXBlbGluZS5yc2DjgIJcbiAgICAgICAgLy9cbiAgICAgICAgLy8g6YKj5Li65LuA5LmI6L+Z6YeM6L+Y6KaB5aGr5LiA5Liq5Y2g5L2N5YC86ICM5LiN5piv6ZqP5L6/5aGrIGBjYXJkUG9vbFR5cGVg77yf5Zug5Li6XG4gICAgICAgIC8vIGBVbmlmaWVkUmVjb3JkRmllbGRzLmJhbm5lcklkYCDmmK/lv4XloavlrZfmrrXvvIzmgLvlvpfov5Tlm57ngrnku4DkuYjvvJvogIzov5nkuKrlgLxcbiAgICAgICAgLy8g5ZSv5LiA5Lya55yf5q2j55Sf5pWI55qE5Zy65pmv77yM5pivKirmnInkurror6/liKDkuobkuIrpnaLnmoQgYGJhbm5lcklkZW50aXR5OiBcInF1ZXJ5XCJgXG4gICAgICAgIC8vIOWjsOaYjioq4oCU4oCU6YKj5pe25Y2g5L2N5YC85Lya6K6p5q+P5p2h6K6w5b2V6YO96JC95Yiw5LiA5Liq5LiN5Yy56YWN5Lu75L2VIGBiYW5uZXJzW10uaWRgXG4gICAgICAgIC8vIOeahOWNoeaxoOS4iu+8jOmXrumimOW9k+WcuuaYvuW9ou+8m+iLpeaUueWhqyBgY2FyZFBvb2xUeXBlYO+8jOiQveW6k+eahOS8muaYr1wi6KeS6Imy57K+5YeGXG4gICAgICAgIC8vIOiwg+iwkFwi6L+Z57G755yL552A5oy65ZCI55CG44CB5a6e6ZmF5ZCM5qC35Yy56YWN5LiN5LiK55qE5YC877yM5Y+N6ICM5pu06Zq+5Y+R546w44CCXG4gICAgICAgIGJhbm5lcklkOiBcInd1d2EtYmFubmVyLWlkZW50aXR5LW5vdC1kZXJpdmFibGUtZnJvbS1yZXNwb25zZVwiLFxuICAgICAgICBjb3VudDogdG9Db3VudChyZWNvcmQuY291bnQpLFxuICAgICAgICBuYW1lOiB0b05vbkVtcHR5U3RyaW5nKHJlY29yZC5uYW1lKSxcbiAgICAgICAgaXRlbVR5cGU6IHRvTm9uRW1wdHlTdHJpbmcocmVjb3JkLnJlc291cmNlVHlwZSksXG4gICAgICAgIHJhcml0eTogbnVtZXJpY1RvU3RyaW5nKHJlY29yZC5xdWFsaXR5TGV2ZWwpLFxuICAgICAgICAvLyBzdGFibGVJZCDnlZnnqbrvvJrop4HkuIrmlrnms6jph4rvvIxBUEkg5ZON5bqU5rKh5pyJ5Lu75L2V6K6w5b2VIElEIOWtl+auteOAglxuICAgICAgfTtcbiAgICB9LFxuICB9LFxuXG4gIC8vIOWNoeaxoOihqO+8mjEzIOS4qiBQb29sVHlwZSDmp73kvY3vvIzmsqHmnInku7vkvZXkuIDmnaHlo7DmmI4gZW5kcG9pbnRPdmVycmlkZeKAlOKAlDEzIOS4quaxoFxuICAvLyDlhbHnlKjlkIzkuIDkuKrnq6/ngrnvvIzljLrliKvlrozlhajlnKggUE9TVCBib2R5IOeahCBjYXJkUG9vbFR5cGUg5a2X5q615YC844CCXG4gIGJhbm5lcnM6IFdVV0FfUE9PTF9UWVBFUy5tYXAoKHBvb2wpID0+ICh7XG4gICAgaWQ6IHBvb2wuaWQsXG4gICAgZGlzcGxheU5hbWU6IHsgXCJ6aC1DTlwiOiBwb29sLm5hbWUgfSxcbiAgfSkpLFxuXG4gIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAvLyBwaXR5R3JvdXBz77yaNeKYhS804piFIOWPjOaho+S/neW6lVxuICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgLy9cbiAgLy8g5q+P5LiqIFBvb2xUeXBlIOWjsOaYjuS4pOS4qiBQaXR5R3JvdXDvvIxtZW1iZXJzIOmDveaMh+WQkeWQjOS4gOS4quWNoeaxoCBpZO+8mlxuICAvLyAgIC0gNeKYhSDpgqPku73kuI3loasgcGl0eVRhcmdldO+8jOWbnuiQvSByYXJpdHkucGl0eVRhcmdldCA9IFwiNVwi77ybXG4gIC8vICAgLSA04piFIOmCo+S7veaYvuW8jyBwaXR5VGFyZ2V0OiBcIjRcIu+8jGhhcmRQaXR5IOWPliBXVVdBXzRTVEFSX0hBUkRfUElUWeOAglxuICAvL1xuICAvLyDimqDvuI8gKio14piFIOe7hOW/hemhu+aOkuWcqOaVsOe7hOWJjemdoioq77ya5a6/5Li76JC95bqT5pe2IGBwaXR5X2dyb3VwX2ZvcigpYFxuICAvLyDvvIhgcGlwZWxpbmUucnNg77yJ5Y+WXCLlo7DmmI7pobrluo/nrKzkuIDkuKpcIuS9nOS4uuWGmeWFpSBgR2FjaGFSZWNvcmQucGl0eV9ncm91cGBcbiAgLy8g5Y2V5YC85YiX55qE6YKj5LiA5Liq4oCU4oCU6L+Z5Liq6ZqQ5byP6K+t5LmJ5bey55+l5pyJ6Zeu6aKY77yIUzUg5b6F6Kej5Yaz77yJ77yM5L2G5b2T5YmN6KGM5Li65aaC5q2k77yMXG4gIC8vIOmhuuW6j+S4jeiDveS5seOAguS4i+mdoiBgZmxhdE1hcGAg5a+55q+P5LiqIFBvb2xUeXBlIOWFiOS6p+WHuiA14piFIOWIhue7hOOAgeWGjeS6p+WHuiA04piFXG4gIC8vIOWIhue7hO+8jOS/neivgei/meS4gOeCueOAglxuICAvL1xuICAvLyDjgIzkv53lupXmmK/lkKbnu6fmib/jgI3vvIjlj4LogIPlrp7njrDph4zogZTliqjmsaAgMTAvMTEg5LygIGluaGVyaXQ9ZmFsc2XvvIzlhbbkvZnpu5jorqRcbiAgLy8gdHJ1Ze+8ieayoeacieWtl+auteaJv+i9ve+8jOS4lOWNs+S9v+acieWtl+auteS5n+WBmuS4jeWIsOKAlOKAlOingeS4i+aWueWkp+autVwi5bey55+l57y65Y+jXCLor7TmmI7jgIJcbiAgcGl0eUdyb3VwczogV1VXQV9QT09MX1RZUEVTLmZsYXRNYXAoKHBvb2wpID0+IFtcbiAgICB7XG4gICAgICBrZXk6IGAke3Bvb2wuaWR9LTVzdGFyYCxcbiAgICAgIG1lbWJlcnM6IFtwb29sLmlkXSxcbiAgICAgIGhhcmRQaXR5OiBwb29sLmhhcmRQaXR5NVN0YXIsXG4gICAgICBjdXJ2ZTogZml2ZVN0YXJDdXJ2ZShwb29sKSxcbiAgICAgIC8vIOWPluWAvOS+neaNruingeS4iuaWuSBXVVdBX1BPT0xfVFlQRVMg6KGo5qC85rOo6YeK77yI6KeS6ImyL+atpuWZqC/mlrDmiYvkuInnsbvnmoRcbiAgICAgIC8vIGZpdmVTdGFyR3VhcmFudGVlS2luZCDliKTlrprkvp3mja7kuI5cIuaXoOWunua1i+S+neaNrlwi5qCH5rOo6YO95Zyo6YKj6YeM77yJ44CCXG4gICAgICBndWFyYW50ZWU6IFdVV0FfRklWRV9TVEFSX0dVQVJBTlRFRV9CWV9LSU5EW3Bvb2wuZml2ZVN0YXJHdWFyYW50ZWVLaW5kXSxcbiAgICAgIC8vIHBpdHlUYXJnZXQg5LiN5aGr77ya5Zue6JC9IHJhcml0eS5waXR5VGFyZ2V0ID0gXCI1XCLjgIJcbiAgICB9LFxuICAgIHtcbiAgICAgIGtleTogYCR7cG9vbC5pZH0tNHN0YXJgLFxuICAgICAgbWVtYmVyczogW3Bvb2wuaWRdLFxuICAgICAgaGFyZFBpdHk6IFdVV0FfNFNUQVJfSEFSRF9QSVRZLFxuICAgICAgcGl0eVRhcmdldDogXCI0XCIsXG4gICAgICAvLyA04piFIOi9r+S/neW6lS/muJDov5vmpoLnjofmlbDlgLzmsqHmnInku7vkvZXmnaXmupDnu5nlh7rliIbmobblkb3kuK3njofvvIjnnJ/lrp7lrZjmoaPlrp7mtYtcbiAgICAgIC8vIOWPque7n+iuoeS6hiA04piFIOWHuui0p+mXtOmalOeahOacgOWwjy/mnIDlpKcv5Z2H5YC877yM6KeBXG4gICAgICAvLyBgQVVESVQtMjAyNi0wOC0xMi1NMum4o+a9ruecn+WunuWtmOaho+Wunua1iy5tZGAgwqczLjLvvIzmsqHmnInlg48gNeKYhSDpgqPmoLfnmoRcbiAgICAgIC8vIOmAkOaKveWRveS4reeOh+WIhuahtuaVsOaNru+8ie+8jOeUqCBjdXN0b20g5Y2g5L2N4oCU4oCU5LiN57yW6YCg5rKh5pyJ5YiG5qG25pWw5o2u5pSv5pKR55qEXG4gICAgICAvLyDmm7Lnur/lvaLnirbjgIJcbiAgICAgIGN1cnZlOiB7IGtpbmQ6IFwiY3VzdG9tXCIgYXMgY29uc3QsIGlkOiBgd3V3YS11bmNvbmZpcm1lZC00c3Rhci1wb29sLSR7cG9vbC5pZH1gIH0sXG4gICAgICAvLyA04piFIOaYr+WQpuacieexu+S8vCA14piFIOeahFwi6KeS6ImyL+atpuWZqOW/heS4reS4jeatqlwi6KeE5YiZ5pyq57uP6K+B5a6e77yM5LiN5aWX55SoIDXimIUg55qEXG4gICAgICAvLyDop4TliJnvvIzlpoLlrp7moIfms6jkuLrmnKrnn6XjgIJcbiAgICAgIGd1YXJhbnRlZTogeyBraW5kOiBcIm5vbmVcIiBhcyBjb25zdCB9LFxuICAgIH0sXG4gIF0pLFxuXG4gIHJhcml0eTogeyBsYWRkZXI6IFtcIjNcIiwgXCI0XCIsIFwiNVwiXSwgcGl0eVRhcmdldDogXCI1XCIgfSxcblxuICB0aW1lOiB7XG4gICAgLy8g6K6w5b2V5pe26Ze05bCx5piv5pyN5Yqh5Zmo6L+U5Zue55qE5oyC6ZKf5pe26Ze05a2X56ym5Liy44CB5pyq57uP5a6i5oi356uv5pys5Zyw5YyW4oCU4oCUXG4gICAgLy8gYE1vZGVscy9HYWNoYURhdGEuY3NgIOeahCBgVGltZWAg5a2X5q615LiOIGZpeHR1cmUg5qC35pys55qE5b2i5oCB5LiA6Ie077yM6L+Z5LiA54K5XG4gICAgLy8g5LiOXCLmmK/lkKbnn6XpgZPlhbfkvZPml7bljLrlgY/np7tcIuaYr+S4pOWbnuS6i++8jOS4jeWPl+S4i+mdoui/meadoee8uuWPo+W9seWTje+8jOS6iOS7peS/neeVmeOAglxuICAgIHJhd1RpbWVDb252ZW50aW9uOiBcInNlcnZlckxvY2FsXCIsXG5cbiAgICAvLyByYXdGb3JtYXQ6IFwiaXNvTG9jYWxcIiDigJTigJQg5Y+W5YC85p2l6IeqIGBmaXh0dXJlcy93dXdhL3Jhd19yZXNwb25zZS8qLmpzb25gXG4gICAgLy8g5LiOIGBmaXh0dXJlcy93dXdhL2FyY2hpdmUvd3dnYWNoYV9hcmNoaXZlLmpzb25gIOeahOW9oueKtu+8iGBcIjIxMDAtMDEtMDZcbiAgICAvLyBUMjI6NTM6MDdcImAg6L+Z57G7IGBZWVlZLU1NLUREVEhIOk1NOlNTYO+8ie+8jOWNs+acrOWcsOWtmOaho+Wtl+aute+8iEMjXG4gICAgLy8gYERhdGVUaW1lYO+8jE5ld3RvbnNvZnQg6buY6K6k5bqP5YiX5YyW5Lqn54mp77yJ55qE5b2i5oCB44CCXG4gICAgLy9cbiAgICAvLyDimqDvuI8gKipBUEkg55yf5a6e57q/5qC85byP5LuN5pyq6aqM6K+BKirvvIzov5nkuI3mmK/pgZfmvI/vvIzmmK/lpoLlrp7moIfms6jnmoTnqbrnmb3igJTigJTlrozmlbRcbiAgICAvLyDmn6Xor4Hov4fnqIvop4EgYGZpeHR1cmVzL3d1d2EvbWV0YS50b21sYFwi5bey55+l5pyq6aqM6K+B6aG577yaQVBJIOeahCBUaW1lXG4gICAgLy8g57q/5qC85byPXCLkuIDoioLvvJpgTW9kZWxzL0dhY2hhRGF0YS5jc2Ag6YeMIGBUaW1lYCDmmK8gYERhdGVUaW1lYCDlvLrnsbvlnovvvIxcbiAgICAvLyBBUEkg5Y+R5p2l55qE5Y6f5aeL57q/5qC85byP5Zyo5Y+N5bqP5YiX5YyW6YKj5LiA5Yi75bCx6KKr5ZCD5o6J5LqG77yM5Y+N5o6o5LiN5Ye65p2l77ybXG4gICAgLy8gYGRvY3MvX2ludGVybmFsL2NhcHR1cmUvYCDkuIvmsqHmnInpuKPmva7mipPljIXmoLfmnKzjgILlo7DmmI4gYGlzb0xvY2FsYCDotYznmoTmmK9cbiAgICAvLyBcIuacrOWcsOWtmOaho+eahOagvOW8j+Wkp+amgueOh+S4jiBBUEkg5LiA6Ie0XCLvvIzlpoLmnpzov5nkuKrlgYforr7plJnkuobvvIxSdXN0IOS+p1xuICAgIC8vIGBwYXJzZV9yZWNvcmRfdGltZWAg546w5Zyo5pS55oiQ5LqG5Lil5qC85Yy56YWN77yI5LiN5YaN5L6d5qyh5bCd6K+V5aSa56eN5qC85byP77yJ77yM5Lya5ZyoXG4gICAgLy8g6aaW5qyh55yf5a6e6YeH6ZuG5pe25piO56Gu5oql6ZSZ77yM6ICM5LiN5piv6KKr6Z2Z6buY5YWc5bqV5ZC45pS25o6J4oCU4oCU5Y+C6KeBIGdzLWNvcmU6OlxuICAgIC8vIFJhd1RpbWVGb3JtYXQg5paH5qGjXCLkuLrku4DkuYjmlLnmiJDkuKXmoLzljLnphY1cIuS4gOiKguOAglxuICAgIC8vXG4gICAgLy8g4pqg77iPICoq5bey55+l6KS255qxKirvvJrpuKPmva7lkIzml7bmnInkuKTmnaHmlbDmja7mnaXmupDlhbHnlKjov5nkuIDku73lo7DmmI7igJTigJTph4fpm4botbAgQVBJXG4gICAgLy8g77yI5qC85byP5pyq6aqM6K+B77yJ77yM5a+85YWl6LWw5pys5Zyw5a2Y5qGj77yISVNP77yM56Gu5a6a77yJ44CC6Iul5bCG5p2l6K+B5a6eIEFQSSDlj5HnmoTmmK9cbiAgICAvLyDliKvnmoTmoLzlvI/vvIzov5nkuIDkuKogcmF3Rm9ybWF0IOWwseS4jeWkn+eUqOS6hu+8jOmcgOimgeaMieaVsOaNruadpea6kOWIhuWIq+WjsOaYju+8m+eOsOWcqFxuICAgIC8vIOagt+acrOaVsOS4uiAx77yM5oyJ5LiJ5qyh5rOV5YiZ5LiN5Li65q2k6K6+6K6h5py65Yi277yM5Y+q5Zyo6L+Z6YeM6K6w5LiA56yU44CCXG4gICAgcmF3Rm9ybWF0OiB7IGtpbmQ6IFwiaXNvTG9jYWxcIiB9LFxuXG4gICAgLy8g4pqg77iPIHRpbWV6b25lU291cmNlIOWIu+aEj+S4jeWjsOaYju+8iOiAjOS4jeaYr+WhqyBcImNvbXB1dGVkXCLvvInjgILkuInkuKrlj6/pgInlvaLmgIHpgJDkuIBcbiAgICAvLyDmjpLpmaTvvIzkuI3mmK/mvI/loavvvJpcbiAgICAvLyAgIC0gYXBpRmllbGTvvJpgTW9kZWxzL0dhY2hhQVBJLmNzYCDnmoQgS1JBUElJdGVtIOWPquaciSA3IOS4quWtl+aute+8jOayoeacieS7u+S9lVxuICAgIC8vICAgICDml7bljLov5YGP56e76YeP5a2X5q6177yM5ZON5bqU5L2T6YeM5rKh5pyJ6IO96K+755qE5YC844CCXG4gICAgLy8gICAtIHN0YXRpY1RhYmxl77yaYGZpZWxkYCDor63kuYnmmK9cIuWTjeW6lOS9k+mHjOWTquS4quWtl+auteaYr+afpeihqOmUrlwi77yI5LiOIGFwaUZpZWxkXG4gICAgLy8gICAgIOWvueensO+8jOingSBwYWNrYWdlcy9ncy1wbHVnaW4ta2l0L3R5cGVzL2dlbmVyYXRlZC50cyDlr7nlupTlrZfmrrXms6jph4rvvInvvIxcbiAgICAvLyAgICAg5L2G5p+l6KGo6ZSu5ZCM5qC35b+F6aG75p2l6Ieq5ZON5bqU5L2T4oCU4oCU5ZON5bqU5L2T5rKh5pyJIHJlZ2lvbi9zdnIg57G75a2X5q6177yMXG4gICAgLy8gICAgIOi/meS4quW9ouaAgeWcqOm4o+a9rui6q+S4iuaXoOWtl+auteWPr+afpe+8jOS4jeaYr1wi6KGo5LiN5YWoXCLnmoTpl67popjjgIJcbiAgICAvLyAgIC0gY29tcHV0ZWTvvJrmnKzmnLrlj6rmnInlm73mnI3vvIhzdnJfYXJlYT1jbu+8ieagt+acrO+8jGBUaW1lem9uZUNvbnRleHRgIOiDvee7mVxuICAgIC8vICAgICDliLAgaG9vayDnmoTotKblj7fkvqfkv6Hlj7flj6rmnIkgdWlkL3JlZ2lvbiDkuKTkuKrlrZfmrrXvvJtgaG9va3MucmVzb2x2ZVRpbWV6b25lYFxuICAgIC8vICAgICDnmoTnrb7lkI3opoHmsYLlr7nku7vmhI/ovpPlhaXpg73ov5Tlm57kuIDkuKrnoa7lrprnmoQgbnVtYmVy77yM5Zu96ZmF5pyN55qE5Yy65pyN5YiS5YiG5LiOXG4gICAgLy8gICAgIOaXtuWMuuayoeacieS7u+S9leWPr+mqjOivgeS+neaNru+8jOimgeS5iOe8luS4gOW8oOafpeaXoOWunuaNrueahOaYoOWwhOihqO+8jOimgeS5iOWvueacquefpVxuICAgIC8vICAgICByZWdpb24g55u05o6l5oqb6ZSZ5Lit5pat6YeH6ZuG4oCU4oCU5Lik6ICF6YO95q+UXCLlpoLlrp7lo7DmmI7kuI3nn6XpgZNcIuabtOezn+OAglxuICAgIC8vXG4gICAgLy8g55yB55WlIHRpbWV6b25lU291cmNlIOWQjui1sOeahOaYr+Wuv+S4u+W3sue7j+iuvuiuoeWlveeahOWFnOW6lei3r+W+hO+8iOS4jeaYr+acrOaPkuS7tuWPpuW8gFxuICAgIC8vIOeahOWPo+WtkO+8ie+8mmBjcmF0ZXMvcGFyYWRpZ21zL2dzLXAtYXV0aGtleS9zcmMvcGlwZWxpbmUucnNgIOeahFxuICAgIC8vIGByZXNvbHZlX3BhZ2VfbGV2ZWxfdGltZXpvbmVfb2Zmc2V0X2hvdXJzYCDlr7kgYE5vbmVgIOWwsei/lOWbnlxuICAgIC8vIGBPayhOb25lKWDvvIxgbm9ybWFsaXplX3RpbWVgIOWcqOWBj+enu+mHj+S4uiBgTm9uZWAg5pe25oqK5oyC6ZKf5pe26Ze05Y6f5qC35b2T5oiQXG4gICAgLy8gVVRDIOWtmOWFpSBgb2NjdXJyZWRfYXRg44CBYHR6X29yaWdpbmAg5qCH6K6w5Li6IGBBc3N1bWVkYOKAlOKAlOWNs1wi5pWw5a2X54Wn5oqE77yMXG4gICAgLy8g5piO56Gu5qCH5rOo5LiN5L+d55yfXCLvvIzkuI3mmK/pnZnpu5jkuqflh7rkuIDkuKroh6rkv6HkvYblj6/og73plJnor6/nmoTml7bpl7TmiLPjgIJcbiAgICAvL1xuICAgIC8vIOWvueeUqOaIt+eahOecn+WunuWQjuaenO+8iOWmguWunuWGme+8jOS4jeeyiemlsO+8ie+8muS4jeWMuuWIhuWbveacjS/lm73pmYXmnI3vvIwqKuaJgOaciSoq6bij5r2uXG4gICAgLy8g6LSm5Y+355qEIG9jY3VycmVkX2F0IOmDveS8muW4puedgOi/meS4qlwi5pyq55+l5YGP56e7XCLmoIforrDigJTigJTkuI3mmK/lm73pmYXmnI3mr5Tlm73mnI3mm7Tlt67vvIxcbiAgICAvLyDogIzmmK/kuKTogIXkuIDmoLfkuI3kv53nnJ/jgILlm73mnI3nlKjmiLfnnIvliLDnmoTmjILpkp/mlbDlrZflpKfmpoLnjoflsLHmmK/mnKzlnLDml7bpl7TvvIjlm6DkuLpcbiAgICAvLyBcImFzc3VtZWQgVVRDXCIg5oGw5aW957qm562J5LqOXCLkuI3lgZrmjaLnrpfvvIzljp/moLfmmL7npLpcIu+8ie+8jOS9huWPquimgeeJtea2iei3qOaXtuWMulxuICAgIC8vIOaNoueul+aIluS4juWFtuWug+W3suefpeaXtuWMuuadpea6kOeahOa4uOaIj+WBmuaXtumXtOe6v+avlOWvue+8jOi/meS4quWtl+autemDveS4jeWPr+S/oeOAguetiVxuICAgIC8vIOaLv+WIsCBzdnJfaWQvc3ZyX2FyZWEg4oaSIFVUQyDlgY/np7vph4/nmoTnnJ/lrp7pqozor4Hkvp3mja7vvIjlk6rmgJXlj6rmmK/lm73mnI3kuIDmnaHvvInvvIxcbiAgICAvLyDlupTmlLnlm54gYGNvbXB1dGVkYCDlubbooaXkuIogYGhvb2tzLnJlc29sdmVUaW1lem9uZWDjgIJcbiAgfSxcblxuICBwcmVjb25kaXRpb25zOiBbXG4gICAge1xuICAgICAgaWQ6IFwid3V3YS5jcmVkZW50aWFsLmxvZ0hhc0dhY2hhTGlua1wiLFxuICAgICAgY2FwYWJpbGl0eTogXCJjcmVkZW50aWFsXCIsXG4gICAgICBsZXZlbDogXCJyZXF1aXJlZFwiLFxuICAgICAgZGVzY3JpYmU6IHtcbiAgICAgICAgXCJ6aC1DTlwiOiBcIuiHquWKqOiOt+WPluWUpOWPluiusOW9leimgeaxguaJk+W8gOi/h+S4gOasoea4uOaIj+WGheeahOWUpOWPluivpuaDhemhte+8jOS4lOmcgOimgeWcqOmTvuaOpeacieaViOacn+WGheeri+WNs+WvvOWHulwiLFxuICAgICAgfSxcbiAgICAgIC8vIOWQjOWOn+elnuWFiOS+i++8mkhvc3RFbnYg55uu5YmN5rKh5pyJXCLml6Xlv5fmlofku7bmmK/lkKblt7LljIXlkKvljLnphY0gVVJMXCLov5nkuKrkv6Hlj7fvvIxcbiAgICAgIC8vIGNoZWNrIOWPquiDvei/lOWbniB1bmtub3du44CCXG4gICAgICBjaGVjazogKCkgPT4gKHsga2luZDogXCJ1bmtub3duXCIgfSksXG4gICAgICByZW1lZHk6IHtcbiAgICAgICAgXCJ6aC1DTlwiOiBcIuivt+WcqOa4uOaIj+WGheaJk+W8gOWUpOWPluivpuaDhemhteWQju+8jOeri+WNs+WbnuWIsOacrOW6lOeUqOmHjeivle+8iOmTvuaOpeacieaViOacn+acque7j+Wunua1i+ehruiupO+8jOaMieacgOefreaDheWGteWkhOeQhu+8iVwiLFxuICAgICAgfSxcbiAgICB9LFxuICBdLFxuXG4gIC8vIGJhc2VsaW5lIOS4jeWjsOaYju+8mum4o+a9ruaOpeWPo+S4jeWIhumhteOAgeS5n+ayoeacieW3suefpeeahOadg+WogeiBmuWQiOe7n+iuoeaOpeWPo++8jFxuICAvLyBgaW5HYW1lUGFnZUNvdW50YC9gYXV0aG9yaXRhdGl2ZUFwaWAg5Lik5Liq5Y+Y5L2T5aWX55So6bij5r2u55qE5oOF5Ya16YO95Lya5ZCN5LiN5Ymv5a6e44CCXG5cbiAgLy8gcmV0ZW50aW9uIOS4jeWjsOaYju+8muayoeacieS7u+S9leadpea6kOe7meWHuum4o+a9ruWumOaWueiusOW9leS/neeVmeacn++8jOS4jei3qOa4uOaIj+aMqueUqFxuICAvLyDnsbPlk4jmuLjkuInmuLhcIjYg5Liq5pyIXCLnmoTor7Tms5XjgIJcblxuICAvLyBpdGVtSWRTb3VyY2Ug5LiN5aOw5piO77yM6buY6K6kIFwibmF0aXZlXCLigJTigJRyZXNvdXJjZUlkIOaYryBBUEkg5Y6f55Sf5a2X5q6177yM5LiN5pivXG4gIC8vIOacrOWcsOWMlueJqeWTgeWQje+8jOS4juaYn+mTgS/nu53ljLrpm7blkIznkIbjgIJcblxuICAvLyBtZXRhZGF0YSDkuI3lo7DmmI7vvJrlk43lupTorrDlvZXoh6rluKYgbmFtZS9yZXNvdXJjZVR5cGUvcXVhbGl0eUxldmVs77yM5LiN6ZyA6KaBXG4gIC8vIOWPjeafpeWtl+WFuOOAglxuXG4gIC8vIGRyYXdDb3VudGluZyDkuI3lo7DmmI7vvIzpu5jorqQgcGVyUmVjb3Jk77yI6KeB5LiK5pa5IHRvQ291bnQg5Ye95pWw5rOo6YeK77yJ44CCXG59IHNhdGlzZmllcyBQbHVnaW5NYW5pZmVzdDtcbiJdLCJtYXBwaW5ncyI6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