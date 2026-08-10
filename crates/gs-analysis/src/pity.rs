//! 保底计数：与具体游戏的概率曲线无关，只做"计数 + 命中即清零"。

/// 记录自上一次命中保底目标以来经过的抽数。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PityCounter {
    since_last_hit: u32,
}

impl PityCounter {
    /// 创建一个从零开始计数的保底计数器。
    pub fn new() -> Self {
        Self::default()
    }

    /// 记录一次抽取结果，返回记录后的计数值。
    ///
    /// `is_target` 为 `true` 表示本次命中保底目标稀有度，计数器随之清零；
    /// 否则计数加一。
    pub fn record_pull(&mut self, is_target: bool) -> u32 {
        if is_target {
            self.since_last_hit = 0;
        } else {
            self.since_last_hit += 1;
        }
        self.since_last_hit
    }

    /// 当前计数值，不修改状态。
    pub fn current(&self) -> u32 {
        self.since_last_hit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn increments_on_miss_and_resets_on_hit() {
        let mut counter = PityCounter::new();
        assert_eq!(counter.record_pull(false), 1);
        assert_eq!(counter.record_pull(false), 2);
        assert_eq!(counter.record_pull(true), 0);
        assert_eq!(counter.record_pull(false), 1);
        assert_eq!(counter.current(), 1);
    }
}
