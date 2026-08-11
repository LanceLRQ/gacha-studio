-- 初始建表：8 张表 + 2 个视图，对应存储数据模型设计文档 §3、§4.4、§5.2。
-- 版本号由 crates/gs-storage/src/migrations.rs 通过 PRAGMA user_version 管理，
-- 本文件对应版本 1，不在文件内自行 BEGIN/COMMIT——事务与 SAVEPOINT 由
-- migrations.rs 在应用迁移时统一包裹（见该文件的 apply_migrations）。

-- =============================================================================
-- 账号
-- =============================================================================
CREATE TABLE account (
    id                  INTEGER PRIMARY KEY,
    plugin_id           TEXT    NOT NULL,
    game_uid            TEXT    NOT NULL,
    region              TEXT    NOT NULL,
    display_name        TEXT,
    -- 插件声明的保留期「保守估计天数」（RetentionPolicy.conservativeDays）。
    -- ⚠️ 不是精确天数，也不是官方原文：官方措辞是「6 个月」，月长不一，
    -- 按 6×28 这类较短值取，告警宁早勿晚。展示文案一律用「6 个月」，
    -- 不得把本列直接渲染给用户。
    retention_days      INTEGER,
    last_collected_at   INTEGER,
    earliest_record_at  INTEGER,
    created_at          INTEGER NOT NULL,
    UNIQUE(plugin_id, game_uid, region)
);

-- =============================================================================
-- L1 · 逐抽明细
-- =============================================================================
CREATE TABLE gacha_record (
    id            INTEGER PRIMARY KEY,
    account_id    INTEGER NOT NULL REFERENCES account(id),
    banner_key    TEXT    NOT NULL,
    pity_group    TEXT    NOT NULL,
    -- 插件生成的稳定唯一键，已由插件在合成时纳入卡池维度
    -- （如 `${gachaType}:${id}`），不得是裸服务端 ID——详见下方 UNIQUE 约束的说明。
    record_key    TEXT    NOT NULL,
    -- 采集时的游戏语言（如 'zh-cn'），可空。用途是归一化溯源，不是名称存储：
    -- 本表不存 name，名称由 item_catalog 按 (plugin_id, item_id, lang) JOIN 得到。
    -- 原神的 name→item_id 反查依赖当时的 locale，字典更新后要重放校正就需要
    -- 知道当初是用哪个语言反查的，不记源语言就无从谈起。
    lang          TEXT,

    -- 时间三元组：三个米哈游参考工具的时间字段一律不带时区，而时区可得性
    -- 完全不一致（星铁有 region + region_time_zone，绝区零只有
    -- region_time_zone，原神两者都没有）。只存换算后的 UTC，一旦推断错误就
    -- 永久污染数据且无从追溯，因此原始串与来源标记必须与 UTC 值一起留底。
    occurred_at   INTEGER NOT NULL,
    occurred_raw  TEXT    NOT NULL,
    tz_origin     TEXT    NOT NULL,
    tz_offset_min INTEGER,

    -- 同一原始时间戳内的批次序位，鸣潮/异环这类同秒可能多条记录的场景需要。
    seq_in_batch  INTEGER,
    item_id       TEXT    NOT NULL,
    item_type     TEXT,
    -- 稀有度存"码"不存"星数"，且必须允许 NULL：
    -- ① 绝区零 rank_type 实测取值 ['2','3','4']，最高档是 4 不是 5，
    --    任何 `rarity = 5` 的查询在绝区零上会静默返回空集；
    -- ② 星铁存在字典未同步导致 name/item_type/rank_type 全为空串的记录，
    --    空串必须在写入前转换为 NULL——空串会一路通过非空校验，
    --    只有 NULL 才强制每个消费点显式处理。
    rarity        TEXT,
    -- 本条记录获得的物品数量（不是抽数）：异环 count 实测取值
    -- 1/4/5/16/30/50，米哈游三游恒为 1。抽数的计算方式由插件的
    -- DrawCountingConfig 声明，宿主不得默认 COUNT(*)。
    qty           INTEGER NOT NULL DEFAULT 1,
    meta_state    TEXT    NOT NULL DEFAULT 'complete',
    source        TEXT    NOT NULL,
    captured_at   INTEGER NOT NULL,
    raw_ref       INTEGER REFERENCES raw_payload(id),
    extra         TEXT,
    -- 去重契约：只按 (account_id, record_key) 唯一。不叠加 banner_key——
    -- 卡池是可变维度，焊进去重契约会让"合并保底组"这类操作变得别扭；
    -- 卡池语义已由插件在合成 record_key 时纳入，宿主不需要再理解一遍。
    UNIQUE(account_id, record_key)
);

CREATE INDEX idx_record_banner_time ON gacha_record(account_id, banner_key, occurred_at);
CREATE INDEX idx_record_rarity      ON gacha_record(account_id, rarity, occurred_at);
-- 部分索引：待回填记录的扫描入口。meta_state='complete' 是绝大多数记录的
-- 稳态，索引只覆盖非常态子集，正常情况下这个索引几乎为空。
CREATE INDEX idx_record_meta_pending ON gacha_record(account_id, meta_state)
    WHERE meta_state != 'complete';

-- =============================================================================
-- L2 · 出金事件
-- =============================================================================
CREATE TABLE rare_event (
    id           INTEGER PRIMARY KEY,
    account_id   INTEGER NOT NULL REFERENCES account(id),
    banner_key   TEXT    NOT NULL,
    pity_group   TEXT    NOT NULL,
    occurred_at  INTEGER NOT NULL,
    item_id      TEXT    NOT NULL,
    rarity       TEXT    NOT NULL,
    -- 距上次出金的抽数（塔吉多 rareCount）。单独存而不是每次从 L1 算：
    -- 官方直接给了这个值，而 L1 缺页时本地根本算不出来，是官方数据的独有价值。
    pity_count   INTEGER,
    -- 1/0/NULL(未知)。不能用布尔默认 0——那会把"不知道"伪装成"没歪"，
    -- 污染歪率统计。
    is_rate_up   INTEGER,
    -- 'authoritative'（官方直给，不可重算，必须持久化）/ 'derived'（从 L1 推导，
    -- 可随时重算，不做增量维护）。
    origin       TEXT    NOT NULL,
    source       TEXT    NOT NULL,
    record_id    INTEGER REFERENCES gacha_record(id),
    extra        TEXT,
    UNIQUE(account_id, banner_key, occurred_at, item_id)
);

-- =============================================================================
-- L3 · 卡池统计快照
-- =============================================================================
CREATE TABLE banner_snapshot (
    id           INTEGER PRIMARY KEY,
    account_id   INTEGER NOT NULL REFERENCES account(id),
    banner_key   TEXT    NOT NULL,
    captured_at  INTEGER NOT NULL,
    draw_count   INTEGER,
    rare_count   INTEGER,
    pity_current INTEGER,
    pity_max     INTEGER,
    origin       TEXT    NOT NULL,
    source       TEXT    NOT NULL,
    -- 页码基准（source='pagination'）把 draw_count 存成区间下界，
    -- 并在这里记录 {"page_count":…, "page_size":…, "precision":"page"}，
    -- 供 v_integrity 区分"缺 5~9 条"与"缺 23 条"两种表述，不得显示成伪精确值。
    extra        TEXT,
    -- 存成时间序列而非单行覆盖：每次采集追加一条快照，能画增长曲线，
    -- 也能在数据异常时回溯对比。
    UNIQUE(account_id, banner_key, captured_at, source)
);

-- =============================================================================
-- 物品目录（多语言）
-- =============================================================================
CREATE TABLE item_catalog (
    plugin_id  TEXT NOT NULL,
    item_id    TEXT NOT NULL,
    lang       TEXT NOT NULL,
    name       TEXT NOT NULL,
    rarity     TEXT,
    item_type  TEXT,
    icon_url   TEXT,
    -- 支持远程增量更新：字典比对 data_ver 判断是否需要拉取新版本。
    data_ver   INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, item_id, lang)
);

-- =============================================================================
-- 卡池元数据（远程可更新）
-- =============================================================================
CREATE TABLE banner_meta (
    plugin_id      TEXT NOT NULL,
    banner_key     TEXT NOT NULL,
    pity_group     TEXT NOT NULL,
    name           TEXT,
    start_at       INTEGER,
    end_at         INTEGER,
    rate_up_items  TEXT,
    pity_max       INTEGER,
    curve_type     TEXT,
    guarantee_rule TEXT,
    data_ver       INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, banner_key)
);

-- =============================================================================
-- 采集会话（诊断用）
-- =============================================================================
CREATE TABLE collect_session (
    id           INTEGER PRIMARY KEY,
    -- 设计文档 §3.7 的原始 DDL 这一列没写外键，与其余三张账号维度表
    -- （gacha_record / rare_event / banner_snapshot）不一致。判定为文档疏漏而非
    -- 有意设计：raw_payload.session_id 已经外键指向本表，
    -- 若本表不指回 account，raw_payload → collect_session → account 这条
    -- 溯源链就在中间断了一环，孤儿会话也就无从检出。故补上。
    account_id   INTEGER NOT NULL REFERENCES account(id),
    started_at   INTEGER NOT NULL,
    ended_at     INTEGER,
    method       TEXT NOT NULL,
    status       TEXT NOT NULL,
    records_new  INTEGER DEFAULT 0,
    -- JSON：丢包数/缺失段/失败原因。抓包路径必须往这里写 segment 缺号信息，
    -- 这是定向补采的依据。
    diagnostics  TEXT
);

-- =============================================================================
-- 原始报文留底
-- =============================================================================
CREATE TABLE raw_payload (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES collect_session(id),
    seq        INTEGER NOT NULL,
    payload    BLOB NOT NULL,
    encoding   TEXT,
    created_at INTEGER NOT NULL
    -- 入库前必须剥离凭据（authkey / accessToken / Authorization）。
    -- 这是最后一道机械防线，由 repository.rs 的 insert_raw_payload 强制执行，
    -- 命中即拒绝写入——即使 L0/L1 已经剥离过，这里也不单点信任。
);

-- =============================================================================
-- 视图：完整性校验
-- =============================================================================
-- 在存储数据模型设计文档 §5.2 基础上补 precision 字段（'exact' / 'page'）：
-- 页码基准的 draw_count 是区间下界，UI 不得把区间估计显示成精确值，必须能
-- 区分"缺 5~9 条"与"缺 23 条"两种表述。extra 里没有 precision 键时视为
-- 'exact'——只有页码基准（source='pagination'）的写入路径会显式打上
-- 'page' 标记，权威接口（如塔吉多）给的是精确值，省略即代表精确。
CREATE VIEW v_integrity AS
SELECT
    s.account_id,
    s.banner_key,
    s.draw_count                              AS official_draws,
    (SELECT COUNT(*) FROM gacha_record r
       WHERE r.account_id = s.account_id
         AND r.banner_key = s.banner_key)     AS local_draws,
    s.rare_count                              AS official_rares,
    (SELECT COUNT(*) FROM rare_event e
       WHERE e.account_id = s.account_id
         AND e.banner_key = s.banner_key
         AND e.origin = 'derived')            AS local_rares,
    COALESCE(json_extract(s.extra, '$.precision'), 'exact') AS precision
FROM banner_snapshot s
WHERE s.origin = 'authoritative'
  AND s.captured_at = (
        SELECT MAX(captured_at) FROM banner_snapshot
         WHERE account_id = s.account_id
           AND banner_key = s.banner_key
           AND origin = 'authoritative'
  );

-- =============================================================================
-- 视图：未收录卡池
-- =============================================================================
-- 必须 LEFT JOIN：INNER JOIN 会让未收录卡池的记录从结果里彻底消失，而
-- "元数据缺失不得阻塞记录写入、不得让数据消失"正是这个设计的要点
-- （同一理由下，gacha_record.banner_key 也不设外键约束到 banner_meta，
-- 见上方 gacha_record 定义）。
--
-- 按 (plugin_id, banner_key) 两列联接 banner_meta——它的主键就是这两列的
-- 组合，只按 banner_key 单列联接会在理论上跨插件撞键时给出错误结果，
-- 两列联接才是与 banner_meta 主键形状一致的联接方式。
CREATE VIEW v_unknown_banner AS
SELECT
    r.account_id,
    a.plugin_id,
    r.banner_key,
    COUNT(*)           AS record_count,
    MAX(r.occurred_at) AS last_occurred_at
FROM gacha_record r
JOIN account a ON a.id = r.account_id
LEFT JOIN banner_meta m
       ON m.plugin_id  = a.plugin_id
      AND m.banner_key = r.banner_key
WHERE m.banner_key IS NULL
GROUP BY r.account_id, a.plugin_id, r.banner_key;
