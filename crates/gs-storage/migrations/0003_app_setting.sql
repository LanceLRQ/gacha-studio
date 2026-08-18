-- 应用设置 kv 表：宿主侧持久化的通用设置项，第一个真实消费者是主题偏好
-- （web/src/pages/Settings.tsx「通用」tab，此前只落 localStorage，见该文件
-- 里被本迁移解决的 TODO）。
--
-- key 由 Rust 侧受控枚举生成（见 src/repository.rs 的 SettingKey），不接受
-- 任意字符串——HC-2 能力窄口「窄口参数只能是标识符，不能是裸值」的同一条
-- 纪律延伸到这里：写路径不能做成 `set_setting(anyKey, anyValue)` 这种开放
-- 接口，否则前端就能借这张表把任意键值对写进宿主数据库，等价于一个通用
-- KV 存储后门。
--
-- value 存成不透明 TEXT：不同设置项的取值形状不同（主题偏好是三选一
-- 字符串，将来可能出现别的形状），存储层不理解任何具体设置项的取值语义，
-- 只负责原样存取——语义校验交给调用方（gs-host::settings）。
--
-- 不建时间戳/审计列，也不做「多版本历史」设计：当前只有「读最新值、写
-- 覆盖旧值」这一种访问模式，且只有主题偏好一个真实需求，三次法则约束下
-- 不预先设计一套没有真实需求撑腰的能力。
CREATE TABLE app_setting (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
