#!/usr/bin/env node
// pnpm gs:sanitize <目录> [--write]
//
// fixture 脱敏工具。插件 PR 必须附带脱敏 fixture（插件 SDK 文档 §7.3），但指望
// 贡献者人工 review 抓住每一处泄漏是不现实的——必须有自动化工具兜底。
//
// 默认 dry-run：只报告命中位置（文件:行号），不改任何文件。加 `--write` 才会
// 真的落盘替换——脱敏工具本身如果误伤了别人精心构造的样本数据，这个损失是
// 不可逆的，所以默认必须是"只报告"。
//
// 扫描并替换：
//   - authkey=<值>            → authkey=FAKE_AUTHKEY_FOR_FIXTURE_ONLY
//   - authkey_ver=<值>        → authkey_ver=1
//   - sign_type=<值>          → sign_type=2
//   - 19 位及以上纯数字串     → 按首次出现顺序编号的占位族（覆盖雪花 ID，
//     见 long-numeric-id 规则定义处：不同原值必须映射到不同占位值，否则
//     fixture 测不出去重与 record_key 稳定性）
//   - uid/player_id 字段的数字值（4 位及以上，不限位数）→ 固定占位值
//     （覆盖米哈游/库洛的玩家 UID；按字段名锚定，位数不设上限——见该规则
//     定义处的复核订正记录）
//   - ServerID 字段的十六进制串（16 位及以上，不限位数）→ 固定占位值
//   - accessToken 字段        → 占位值
//   - Authorization 头        → 占位值
//   - cookie 字段             → 占位值
//
// ⚠️ AUDIT-2026-08-12-M2鸣潮真实存档实测.md §四：early 版本的 long-numeric-id
// 规则下限定在 19 位，完全覆盖不到米哈游/库洛的 9 位玩家 UID 与鸣潮 ServerID
// 这类 32 位十六进制标识符——合成样本实测「已扫描 1 个文件，命中 0 处」，
// 是假阴性不是安全证明。uid-field / server-id-hex 两条规则就是补这个洞，
// 详见各自规则定义处的注释。首版曾把这两条规则的取值宽度也写死（恰好 9 位 /
// 恰好 32 位），复核指出这是同一个洞换了个数字——已改为只设下限、不设上限。
//
// 零新增 npm 依赖，只用 node:fs / node:path，风格照 scripts/gs-check/ ：
// 全中文输出、命中位置精确到「文件:行号」。

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 每条规则：`pattern` 必须恰好一个捕获组，捕获「要保留的前缀」（键名 + 分隔符），
 * 真正敏感的部分是紧跟在捕获组之后、被规则整体匹配但未被捕获的部分——
 * 替换时只需要拼回前缀 + 占位值，不需要理解原始敏感值的具体格式。
 *
 * `long-numeric-id` 例外：它没有固定 `placeholder` 字段，取而代之的是
 * `createLongNumericIdMapper` 产出的顺序映射表，由 `applyRules` 对该规则
 * id 做特判驱动，见下方定义与 `applyRules` 实现。
 */

// long-numeric-id 占位族：前缀（15 位）+ 4 位十进制序号，共 19 位。
// 覆盖 1000000000000000000 ~ 1000000000000009999，容量 10000 个不同占位值。
const LONG_NUMERIC_ID_PLACEHOLDER_PREFIX = '100000000000000'; // 15 位：1 后接 14 个 0
const LONG_NUMERIC_ID_SERIAL_WIDTH = 4; // 4 位十进制序号，容量 10000
const LONG_NUMERIC_ID_SERIAL_CAPACITY = 10 ** LONG_NUMERIC_ID_SERIAL_WIDTH;

/**
 * 序号 0 对应的占位值恰好是 `1000000000000000000`——这不是巧合，是刻意设计：
 * 旧版工具把所有命中都折叠成这一个固定值，新占位族把它收编为族内第 0 号
 * 成员，保证在旧版工具下已经脱敏过的历史 fixture，在新逻辑下仍然落在占位族
 * 区间内、仍然被下面的负向先行断言幂等排除（不会被当成"新发现的敏感值"
 * 再次改写）。
 *
 * 为什么占位族不会跟真实雪花 ID 产生歧义：服务端雪花 ID（时间戳位 + 机器位 +
 * 序列位）分布在整个 19 位数字空间，量级约 10^18 ~ 10^19，不会精确落在
 * "10^18 起的连续 10000 个值"这个极窄区间内——占位族只占这个空间的十万分之
 * 一量级，真实 id 撞进占位族的概率可忽略。10000 的容量也留了充分余量：
 * 当前已知最大样本是星铁 fixture 的 23 个不同 id，10000 是它的 400 多倍。
 */
function formatLongNumericIdPlaceholder(serial) {
  if (serial < 0 || serial >= LONG_NUMERIC_ID_SERIAL_CAPACITY) {
    throw new Error(
      `long-numeric-id 占位族容量耗尽（上限 ${LONG_NUMERIC_ID_SERIAL_CAPACITY} 个不同值）：当前扫描到的不同 19 位以上数字超过占位族预留容量，需要扩宽 LONG_NUMERIC_ID_SERIAL_WIDTH。`,
    );
  }
  return `${LONG_NUMERIC_ID_PLACEHOLDER_PREFIX}${String(serial).padStart(LONG_NUMERIC_ID_SERIAL_WIDTH, '0')}`;
}

/**
 * 创建 long-numeric-id 规则专用的顺序映射器：调用生命周期内，每个不同的原始
 * 数字串按首次出现顺序分配一个不同的占位值，重复出现的原值复用已分配的占位值。
 *
 * 不用哈希：哈希在密码学意义上应当不可逆，但对 19~20 位十进制数这种短小的数字
 * 空间，暴力枚举完全可行，哈希等价于没加密——纯粹按出现顺序编号才是真正不可逆
 * 的方案：占位值只携带"这是第几个不同值"这一信息，原值的任何一位都不出现在
 * 占位值里。
 *
 * 主进程实测复现：修复前所有原值折叠成同一个占位值——星铁 fixture 23 个不同
 * id 变成 1 个、原神 fixture 8 个变成 1 个，record_key（`${bannerId}:${stableId}`）
 * 因此全部相同，fixture 测不出去重与 record_key 稳定性。这个映射器就是修复点。
 */
function createLongNumericIdMapper() {
  const assigned = new Map();
  let nextSerial = 0;
  return function mapLongNumericId(originalValue) {
    const existing = assigned.get(originalValue);
    if (existing !== undefined) return existing;
    const placeholder = formatLongNumericIdPlaceholder(nextSerial);
    nextSerial += 1;
    assigned.set(originalValue, placeholder);
    return placeholder;
  };
}

const RULES = [
  {
    id: 'authkey',
    pattern: /(authkey=)(?!FAKE_AUTHKEY_FOR_FIXTURE_ONLY\b)[^&"'\s]+/g,
    reason: '命中 authkey 参数，等价于临时账号凭证',
    placeholder: 'FAKE_AUTHKEY_FOR_FIXTURE_ONLY',
  },
  {
    id: 'authkey_ver',
    pattern: /(authkey_ver=)[^&"'\s]+/g,
    reason: '命中 authkey_ver 参数',
    placeholder: '1',
  },
  {
    id: 'sign_type',
    pattern: /(sign_type=)[^&"'\s]+/g,
    reason: '命中 sign_type 参数',
    placeholder: '2',
  },
  {
    // 这条规则没有固定占位值：靠 `createLongNumericIdMapper` 产出的映射表
    // 决定每个匹配替换成什么，`applyRules` 里对 `rule.id === 'long-numeric-id'`
    // 有特判分支，不走下面 `wholeMatchIsSensitive` 的通用替换路径。
    id: 'long-numeric-id',
    // 19 位及以上纯数字：覆盖服务端雪花 ID，以及贡献者可能误粘进来的长数字 UID。
    //
    // ⚠️ 主进程实测复现的真实缺陷（本次修复的起因）：修复前用固定占位值
    // `1000000000000000000` 整体替换，星铁 fixture 里 23 个不同的雪花 ID
    // `--write` 后全部折叠成同一个值，原神 fixture 里 8 个不同 id 也全部
    // 折叠成同一个值——这些 id 是插件推导 `record_key`
    //（形如 `${bannerId}:${stableId}`）用的服务端雪花 ID，折叠成同一个值后，
    // fixture 里一批记录的 record_key 全部相同，fixture 测不出去重逻辑，
    // 也测不出 record_key 稳定性，是真实的功能性缺陷，不是风格问题。
    //
    // 现在改用 `createLongNumericIdMapper`：每个不同的原值按首次出现顺序
    // 映射到占位族（`LONG_NUMERIC_ID_PLACEHOLDER_PREFIX` + 序号，定义见上方）
    // 里一个不同的占位值，保留原有的区分度。
    //
    // 负向先行断言排除的范围也从"单一固定值"扩成"整个占位族"——占位族是
    // `100000000000000` 后接 4 位数字（`\d{4}`）的连续区间，覆盖
    // `1000000000000000000` ~ `1000000000000009999`，保证对已经用占位族
    // 脱敏过的文件重复运行 `--write` 时，占位族内的任意成员都不会被误判为
    // "新发现的敏感值"再次改写，是幂等的。
    pattern: new RegExp(
      `(?<=^|[^\\d])(?!${LONG_NUMERIC_ID_PLACEHOLDER_PREFIX}\\d{${LONG_NUMERIC_ID_SERIAL_WIDTH}}(?:$|[^\\d]))(\\d{19,})(?=$|[^\\d])`,
      'g',
    ),
    reason: '命中 19 位及以上纯数字串（疑似雪花 ID / 长数字 UID）',
    // 这条规则的“前缀捕获组”语义与其它规则不同：整个数字串本身就是敏感内容，
    // 没有需要保留的前缀，替换时直接整体替换（见 applyRules 的特殊处理）。
    wholeMatchIsSensitive: true,
    // 本规则的占位值是一个族而非单值，因此不能用默认的 `=== rule.placeholder`
    // 判定（它没有 placeholder 字段）。显式给出族判定，让 isAlreadyPlaceholder
    // 对所有规则走同一套机制——不写这条也能"碰巧"成立（`value === undefined`
    // 恒假，靠上面 pattern 里的负向先行断言兜住），但那是巧合不是设计，
    // 自检里对 RULES 的循环断言也就失去了对这条规则的实际约束力。
    isPlaceholder: (value) =>
      new RegExp(
        `^${LONG_NUMERIC_ID_PLACEHOLDER_PREFIX}\\d{${LONG_NUMERIC_ID_SERIAL_WIDTH}}$`,
      ).test(value),
  },
  {
    id: 'uid-field',
    // 米哈游三游与库洛鸣潮的玩家 UID 均为 9 位数字（AUDIT-2026-08-12-
    // M2鸣潮真实存档实测.md §2.1、§4.1），但这条规则按**字段名**锚定
    // （uid / UID / player_id / playerId / PLAYER_ID 等大小写与下划线变体，
    // `\b` 词边界防止命中 "gameUid" 这类复合字段名的子串，也防止命中
    // "uid2" 这类后缀变体）——字段名已经把语义锁定为"玩家/账号标识"，与
    // 具体位数无关，因此取值宽度只设下限（防误伤 `"uid": 0` / `"uid": 1`
    // 这类哨兵值）、不设上限。
    //
    // ⚠️ 复核订正记录（保留过程，不静默改掉）：初版把宽度写死成"恰好 9 位"
    // （`\d{9}`），复核指出这就是本次要修的那个缺口本身换了个数字——
    // `long-numeric-id` 用宽度做判别依据是因为它没有字段名锚定，宽度是它
    // 唯一的防线；这条规则有字段名锚定，靠宽度兜底不提供任何额外保护，
    // 只会在下一个 UID 不是 9 位的游戏接入时重演"新规则静默漏掉"的原始问题。
    //
    // 同时覆盖三种真实会出现的形态：
    //   - JSON 数字形式：`"UID": 123456789`（鸣潮存档顶层实测就是 int，
    //     不是字符串——research/03 §三的字符串标注已被实测证伪）
    //   - JSON 字符串形式：`"uid": "123456789"`
    //   - TOML 无引号键形式：`uid = "123456789"`（fixture 的 meta.toml 用
    //     这种写法——贡献者最可能在这一行手填真实 UID，覆盖它比覆盖 JSON
    //     存档本身更要紧）
    //
    // 占位值沿用仓库既有约定（fixtures/genshin/meta.toml 的假 UID 就是
    // "100000000"），保持跨 fixture 一致。占位值本身是 9 位（≥ 4 位下限），
    // 对已脱敏文件重复运行时会被规则再次匹配、替换为自身，字节不变，见
    // 自检脚本的幂等性测试。
    //
    // 会漏掉什么（如实列出，不假装覆盖一切）：
    //   - 复合字段名：gameUid / roleId / openId / accountId 等不含独立
    //     "uid"/"player_id" 词边界的变体——按字段名锚定的代价就是要求字段名
    //     在贡献者登记表里，本规则登记表里没有的名字统统漏
    //   - 3 位及以下的纯数字值（下限 4 位是刻意的，见上）
    //   - 字段名与数值被换行分隔的罕见格式化风格（本规则按单行文本匹配，
    //     不做跨行结构解析）
    //
    // **正则里**不加"已是占位值就跳过"的负向先行断言：与下面 access-token /
    // authorization-header / cookie 三条规则同样的理由——前缀里的可选引号
    // `"?` 在有回溯空间时会让负向断言产生"伪命中"，那三条规则的注释已经
    // 记录了这个坑，这里不重踩。本规则对已脱敏文件重复 --write 仍然幂等
    // （前缀 + 占位值精确复现已有文本，见自检脚本的幂等性测试）。
    //
    // 「已是占位值就跳过」这件事本身仍然要做，只是落点在 `scanText` 的
    // `isAlreadyPlaceholder`——它作用于匹配结果、不参与回溯，因此没有上面
    // 那个伪命中问题。2026-08-14 之前这里的结论是"dry-run 持续报告命中是
    // 可接受的噪音"，那个判断已被推翻：代价是扫描模式永远不归零。
    pattern: /(\b(?:uid|player_?id)\b"?\s*[:=]\s*"?)(?<!\d)\d{4,}(?!\d)/gi,
    reason: '命中 uid/player_id 字段的数字 UID',
    placeholder: '100000000',
  },
  {
    id: 'server-id-hex',
    // 鸣潮存档的 ServerID 是 32 位十六进制字符串（research/03-真实导出数据
    // 格式实测.md §3.1），但这条规则按**字段名**锚定而非裸匹配"32 位
    // 十六进制"，因为 CardPoolId 同样是 32 位十六进制（AUDIT-2026-08-12-
    // M2鸣潮真实存档实测.md §2.2）却是跨账号共享的卡池标识（全库非空取值
    // 去重后只有 1 个），不是账号级敏感信息——裸匹配宽度会把它也替换掉，
    // 对贡献者的 fixture 造成不必要的改动。字段名已经把语义锁定为"服务器
    // 标识"，与具体位数无关，因此取值宽度只设下限（防误伤过短、明显不是
    // 标识符的 hex 片段）、不设上限，理由与 uid-field 的复核订正记录一致：
    // 有字段名锚定时，靠宽度兜底不提供额外保护，只会在长度不是 32 的实现
    // 上重演"新规则静默漏掉"。
    //
    // 会漏掉什么：
    //   - CardPoolId 等同形态但语义不同的字段（刻意不覆盖，理由见上）
    //   - 非 "ServerID" 命名的服务器标识字段（如某游戏改用 serverUid /
    //     regionId 之类，字段名登记表里没有就漏）
    //   - 15 位及以下的十六进制值（下限 16 位是刻意的，防误伤过短的
    //     hex 片段）
    //
    // 幂等性说明同 uid-field：**正则里**不加负向先行断言，理由一致（前缀含
    // 可选引号，断言会因回溯而误伤，详见下一条规则的注释）；占位值本身是
    // 32 位十六进制（≥ 16 位下限），仍会被正则匹配到、替换为自身、字节不变，
    // 但不再被 `scanText` 报告为命中——见 `isAlreadyPlaceholder`。
    pattern: /(\bserver[_-]?id\b"?\s*[:=]\s*"?)[0-9a-fA-F]{16,}(?![0-9a-fA-F])/gi,
    reason: '命中 ServerID 字段的十六进制标识符',
    placeholder: 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0',
  },
  {
    // JSON 里的键名通常自己也带引号（如 `"accessToken": "xxx"`），键名与冒号
    // 之间可能夹一个闭合引号，因此前缀允许 `"?` 出现在 `[:=]` 两侧。
    //
    // ⚠️ 这三条刻意**不在正则里**加“已是占位值就跳过”的负向先行断言，这条
    // 结论仍然有效，不要试图把判定挪回正则里：前缀里的 `"?` 是可选的，负向
    // 断言在这种有回溯空间的前缀上并不可靠——实测会在断言失败后回溯掉前缀里
    // 的可选引号，把断言检查点挪到一个不再匹配占位值字面量的位置，最终匹配到
    // 一个只含空白的“伪命中”，`--write` 时会把占位值和原有引号拆开重新拼接，
    // **破坏 JSON 结构**。
    //
    // 原先的处理是接受"dry-run 会一直把这三个字段报为命中"这个噪音。
    // 2026-08-14 更正：这个噪音的代价被低估了——9 条规则里 7 条如此，扫描模式
    // 对任何已脱敏目录都不归零，`gs-sanitize <dir>` 因此无法作为 CI 密钥扫描
    // 门禁。现在改由 `scanText` 里的 `isAlreadyPlaceholder` 统一处理：它作用于
    // **匹配之后的结果**，不参与正则回溯，因此上面那个 JSON 损坏问题在这条路
    // 上根本不存在。
    id: 'access-token',
    pattern: /((?:access[_-]?token)"?\s*[:=]\s*"?)[^"'\r\n,}]+/gi,
    reason: '命中 accessToken 字段',
    placeholder: 'FAKE_TOKEN_FOR_FIXTURE_ONLY',
  },
  {
    id: 'authorization-header',
    pattern: /(Authorization"?\s*[:=]\s*"?)[^"'\r\n,}]+/gi,
    reason: '命中 Authorization 头',
    placeholder: 'FAKE_AUTHORIZATION_FOR_FIXTURE_ONLY',
  },
  {
    id: 'cookie',
    pattern: /(Cookie"?\s*[:=]\s*"?)[^"'\r\n,}]+/gi,
    reason: '命中 cookie 字段',
    placeholder: 'FAKE_COOKIE_FOR_FIXTURE_ONLY',
  },
];

/** 把字符偏移量换算成 1-based 行号。 */
function offsetToLine(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * 扫描单个文件的文本内容，返回命中列表（不修改内容）。
 * 每条命中：{ rule, index, line, matchedText }
 *
 * `rules` 默认取全量 RULES；自检脚本会传入过滤掉某条规则的子集，用来
 * 在当前代码里重构"如果这条规则不存在会怎样"的反例（证明"不加规则会漏"），
 * 而不需要另外维护一份历史规则集的复制品。
 */
/**
 * 取出一处匹配里「真正敏感」的那一段：整体敏感的规则取全串，其余规则剥掉
 * 捕获组捕获的前缀（键名 + 分隔符）。
 */
function sensitivePortion(rule, match) {
  return rule.wholeMatchIsSensitive ? match[0] : match[0].slice(match[1].length);
}

/**
 * 这处匹配的敏感部分是否已经就是本规则自己的占位值。
 *
 * ⚠️ 这个判定是「扫描模式能不能归零」的唯一支点，起因是一个实测缺陷：
 * 9 条规则里有 7 条会把自己写出去的占位值当成新发现的敏感值再报一遍
 * （只有 `authkey` 写了显式排除断言、`long-numeric-id` 排除了整个占位族）。
 * 后果是**对任何已脱敏目录扫描都不为零**——starrail 报 98 处、genshin 报
 * 35 处，全是自己的占位值。这让扫描输出彻底失去信号：既建不成「贡献者
 * 要求」里承诺的 CI 密钥扫描门禁，维护者 review 时也没法在 98 条命中里
 * 挑出真正那一条真实 UID。
 *
 * 这是「门永远不绿所以没有信号」，和本项目反复踩的「门永远绿所以什么都
 * 没检查」是同一个问题的反面，同样致命。
 *
 * 为什么修在这里而不是给 7 条规则各写一条负向先行断言：那样要写 7 条几乎
 * 雷同、又各自不同的正则，每条都可能写错；更要命的是**第 10 条规则加进来
 * 时必然会忘**。判定收在一处，对现有和未来的规则一体生效，自检也能直接
 * 对 `RULES` 做循环断言（见自检里的「占位值不得被自身规则重新命中」）。
 *
 * ⚠️ 残留风险，如实写明：判定是字节相等，因此一个**真实**值若恰好等于占位
 * 值就会被跳过。逐条看，只有 `uid-field` 的 `100000000` 在理论上是一个可能
 * 存在的真实 9 位 UID（其余占位值形如 `FAKE_*_FOR_FIXTURE_ONLY` 或
 * `a0a0…`，真实值撞上的概率可忽略；而 `authkey_ver=1` / `sign_type=2` 本来
 * 就是真实取值，它们被规范化是为了一致性而非保密）。这个残留风险换来的是
 * 扫描有绿态，判断是值得的——但不要以为它不存在。
 */
function isAlreadyPlaceholder(rule, match) {
  const value = sensitivePortion(rule, match);
  if (rule.isPlaceholder) return rule.isPlaceholder(value);
  return value === rule.placeholder;
}

function scanText(text, rules = RULES) {
  const findings = [];
  for (const rule of rules) {
    for (const m of text.matchAll(rule.pattern)) {
      // 已经是本规则占位值的匹配不算命中——否则扫描永远不归零，见
      // isAlreadyPlaceholder 的文档注释。
      if (isAlreadyPlaceholder(rule, m)) continue;
      findings.push({
        rule,
        index: m.index,
        line: offsetToLine(text, m.index),
        matchedText: m[0],
      });
    }
  }
  findings.sort((a, b) => a.index - b.index);
  return findings;
}

/**
 * 对文本应用全部规则的替换，返回替换后的文本。`rules` 默认取全量 RULES，理由同 scanText。
 *
 * `longNumericIdMapper` 默认值是"每次调用不显式传入时创建一个全新映射器"——
 * JS 默认参数表达式每次调用都会重新求值，天然满足"未显式共享时各调用互不
 * 干扰"；跨文件需要共享同一映射器时（见 `main()`），调用方显式传入同一个
 * `createLongNumericIdMapper()` 实例即可。
 */
function applyRules(text, rules = RULES, longNumericIdMapper = createLongNumericIdMapper()) {
  let result = text;
  for (const rule of rules) {
    if (rule.id === 'long-numeric-id') {
      result = result.replace(rule.pattern, (matchedText) => longNumericIdMapper(matchedText));
    } else if (rule.wholeMatchIsSensitive) {
      result = result.replace(rule.pattern, () => rule.placeholder);
    } else {
      result = result.replace(rule.pattern, (full, prefix) => `${prefix}${rule.placeholder}`);
    }
  }
  return result;
}

/** 递归收集目录下所有普通文件的绝对路径。 */
function collectFiles(dir) {
  const results = [];
  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function isProbablyText(buffer) {
  // 简单启发式：出现 NUL 字节就当二进制处理，跳过（fixture 目录理论上不该有
  // 二进制文件，但防御一下比因为读取失败中断整个扫描更安全）。
  return !buffer.includes(0);
}

function main(argv) {
  const args = argv.slice(2);
  const write = args.includes('--write');
  const targetArg = args.find((a) => !a.startsWith('--'));

  if (!targetArg) {
    console.error('用法：pnpm gs:sanitize <目录> [--write]');
    process.exitCode = 1;
    return;
  }

  const targetDir = path.resolve(process.cwd(), targetArg);
  let stat;
  try {
    stat = statSync(targetDir);
  } catch {
    console.error(`目录不存在："${targetArg}"`);
    process.exitCode = 1;
    return;
  }
  if (!stat.isDirectory()) {
    console.error(`不是目录："${targetArg}"`);
    process.exitCode = 1;
    return;
  }

  console.log(`gs:sanitize —— 扫描 "${targetArg}"${write ? '（--write：命中即落盘替换）' : '（dry-run，不修改任何文件）'}`);
  console.log('');

  const files = collectFiles(targetDir);
  let totalFindings = 0;
  let changedFiles = 0;
  // 同一次 CLI 运行里所有文件共用一个映射器实例：A 文件和 B 文件出现同一个
  // 原始雪花 ID 时，两处必须得到同一个占位值，否则同一条记录在不同文件里
  // 会被脱敏成两个看起来不相关的值。
  const longNumericIdMapper = createLongNumericIdMapper();

  for (const filePath of files) {
    const buffer = readFileSync(filePath);
    if (!isProbablyText(buffer)) continue;
    const text = buffer.toString('utf8');
    const findings = scanText(text);
    if (findings.length === 0) continue;

    const relPath = path.relative(process.cwd(), filePath);
    totalFindings += findings.length;
    console.log(`${relPath}`);
    for (const finding of findings) {
      const preview =
        finding.matchedText.length > 60 ? `${finding.matchedText.slice(0, 57)}...` : finding.matchedText;
      console.log(`  行 ${finding.line}  [${finding.rule.id}]  ${finding.rule.reason}`);
      console.log(`    命中内容：${preview}`);
    }

    if (write) {
      const sanitized = applyRules(text, RULES, longNumericIdMapper);
      if (sanitized !== text) {
        writeFileSync(filePath, sanitized, 'utf8');
        changedFiles += 1;
        console.log('    已写回脱敏后的内容');
      }
    }
    console.log('');
  }

  console.log(`已扫描 ${files.length} 个文件，命中 ${totalFindings} 处。`);
  if (write) {
    console.log(`已写回 ${changedFiles} 个文件。`);
  } else if (totalFindings > 0) {
    console.log('当前为 dry-run，未修改任何文件。确认无误后加 --write 参数真正替换。');
  }

  process.exitCode = totalFindings > 0 && !write ? 1 : 0;
}

// `process.argv[1]` 在 `node -e` / `--input-type=module` 这类无脚本入口的场景下是
// undefined，`pathToFileURL(undefined)` 会抛 ERR_INVALID_ARG_TYPE——本模块被
// gs-check 门禁与自检脚本导入，也应当能被随手 `import` 进来临时验证规则行为，
// 因此守卫先判 argv[1] 存在再比对。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}

export { scanText, applyRules, RULES, createLongNumericIdMapper };
