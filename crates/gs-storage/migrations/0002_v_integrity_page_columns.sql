-- 补 v_integrity 的 page_size / page_count 两列。
--
-- 写入页码基准时 banner_snapshot.extra 里本来就同时带了
-- {"page_count":…, "page_size":…, "precision":"page"} 三个键（见
-- 0001_initial.sql 里 v_integrity 上方的注释），但初版视图只
-- json_extract 出了 precision，调用方要算"缺口区间的宽度"还得自己再解一遍
-- extra JSON——视图对它自己的用途并不自足。这里补上另外两列，其余列与
-- 0001 保持一致。
--
-- 只能 DROP 后 CREATE 重建：SQLite 没有 ALTER VIEW 语法，视图定义只能整个
-- 替换。这不是"改主键"那类需要 rename→create new→INSERT...SELECT→drop old
-- 四步搬迁数据的场景——视图不持有数据，DROP 它不会丢任何东西。
DROP VIEW v_integrity;

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
    COALESCE(json_extract(s.extra, '$.precision'), 'exact') AS precision,
    -- 两者只在 source='pagination' 的页码基准快照上有值；权威基准
    -- （如塔吉多）没有分页概念，extra 里没有这两个键，json_extract 对
    -- 缺失键或 extra 本身为 NULL 都返回 NULL，不需要 COALESCE 默认值——
    -- NULL 在这里就是正确的语义（"这条基准没有分页信息"，不是"分 0 页"）。
    json_extract(s.extra, '$.page_size')  AS page_size,
    json_extract(s.extra, '$.page_count') AS page_count
FROM banner_snapshot s
WHERE s.origin = 'authoritative'
  AND s.captured_at = (
        SELECT MAX(captured_at) FROM banner_snapshot
         WHERE account_id = s.account_id
           AND banner_key = s.banner_key
           AND origin = 'authoritative'
  );
