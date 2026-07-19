//! 全局共享状态。
//!
//! AppState 通过 `app.manage()` 注入 Tauri State,跨命令/线程共享。
//! 所有 reminder 的读写都通过 Mutex 串行化,避免与调度器之间的写写冲突。
//!
//! ## Bug 历史
//!
//! 之前的实现里,`reminder_scheduler::poll_once` 和 `commands::delete_reminder`
//! 各自走 `load_reminders → modify → save_reminders`,这是非原子的。
//! 时序:
//! ```text
//! T0: poll_once: load V1 (含 A)
//! T1: poll_once: 处理 A 触发(改 last_triggered_at)
//! T2: delete_reminder: load V1 → remove A → save V2 (不含 A)
//! T3: poll_once: save 基于 V1 修改的 new_idx(含 A) → A 又回来了!
//! ```
//!
//! 用 Mutex 后,所有读写串行,这个 race 不再可能发生。

use std::sync::Mutex;

use crate::config;
use crate::error::Result;
use crate::models::ReminderIndex;

/// 全局应用状态(目前只承载 reminders,后续可扩展)
pub struct AppState {
    /// 全局 reminder 集合,所有读写都通过这个 Mutex 串行化
    pub reminders: Mutex<ReminderIndex>,
}

impl AppState {
    pub fn new(initial: ReminderIndex) -> Self {
        Self {
            reminders: Mutex::new(initial),
        }
    }

    /// 加锁 + 修改 + 同步到磁盘 + 返回克隆。
    /// 用于 commands 写操作(delete/upsert)
    pub fn modify_reminders<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut ReminderIndex) -> Result<T>,
    {
        let mut data = self
            .reminders
            .lock()
            .map_err(|e| crate::error::AppError::Other(format!("锁失败: {}", e)))?;
        let result = f(&mut data)?;
        // 写盘(锁内,确保顺序一致)
        config::save_reminders(&data)?;
        Ok(result)
    }

    /// 加锁 + 只读访问。
    /// 用于 commands 读操作(get/get_for_node)
    pub fn read_reminders<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&ReminderIndex) -> T,
    {
        let data = self
            .reminders
            .lock()
            .map_err(|e| crate::error::AppError::Other(format!("锁失败: {}", e)))?;
        Ok(f(&data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Reminder, ReminderIndex};

    fn make_state() -> AppState {
        // 测试时设置隔离数据目录,避免污染真实 ~/Library/Application Support/MindMap/
        // 用 PID + 时间戳保证唯一(多个测试函数并发跑时不互相干扰)
        let mut p = std::env::temp_dir();
        p.push(format!(
            "mindmap-state-test-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        std::fs::create_dir_all(&p).unwrap();
        std::env::set_var("MINDMAP_TEST_DATA_DIR", &p);
        AppState::new(ReminderIndex {
            version: "1.0.0".into(),
            reminders: vec![],
        })
    }

    fn make_reminder(id: &str) -> Reminder {
        let mut r = Reminder::new("node-1", "/tmp/test.mmap", id, "2026-07-19T10:00:00");
        r.id = id.to_string();
        r
    }

    /// 集成测试:覆盖所有场景(modify/read/delete/并发/race)。
    #[test]
    fn state_full_coverage() {
        // 全局锁,避免与其他依赖 MINDMAP_TEST_DATA_DIR 的测试并发跑
        let _guard = crate::test_support::lock_env_test();
        use std::sync::Arc;
        use std::thread;

        // === 场景 1:modify → read 往返 ===
        let state = make_state();
        state
            .modify_reminders(|idx| {
                idx.add_or_replace(make_reminder("a"));
                Ok(())
            })
            .unwrap();
        let count = state.read_reminders(|idx| idx.reminders.len()).unwrap();
        assert_eq!(count, 1, "场景1: 加 1 个 reminder 后总数应为 1");

        // === 场景 2:加 + 删除 ===
        state
            .modify_reminders(|idx| {
                idx.add_or_replace(make_reminder("b"));
                idx.remove("a");
                Ok(())
            })
            .unwrap();
        let ids: Vec<_> = state
            .read_reminders(|idx| idx.reminders.iter().map(|r| r.id.clone()).collect())
            .unwrap();
        assert_eq!(ids, vec!["b".to_string()], "场景2: 删除 a 后只剩 b");

        // === 场景 3:多线程并发 modify,不丢数据 ===
        let state = Arc::new(make_state());
        let mut handles = vec![];
        for t_id in 0..5 {
            let s = Arc::clone(&state);
            handles.push(thread::spawn(move || {
                for i in 0..20 {
                    let id = format!("t{}-r{}", t_id, i);
                    s.modify_reminders(|idx| {
                        idx.add_or_replace(make_reminder(&id));
                        Ok(())
                    })
                    .unwrap();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let count = state.read_reminders(|idx| idx.reminders.len()).unwrap();
        assert_eq!(count, 100, "场景3: 5 线程×20 写入 = 100,无丢失");

        // === 场景 4(关键):调度器写回 vs 用户删除的 race ===
        // 预置 target reminder
        state
            .modify_reminders(|idx| {
                idx.add_or_replace(make_reminder("target"));
                Ok(())
            })
            .unwrap();
        let s1 = Arc::clone(&state);
        let s2 = Arc::clone(&state);
        let h1 = thread::spawn(move || {
            s1.modify_reminders(|idx| {
                if let Some(r) = idx.reminders.iter_mut().find(|r| r.id == "target") {
                    r.last_triggered_at = Some("2026-07-19T10:00:00".into());
                }
                Ok(())
            })
        });
        let h2 = thread::spawn(move || {
            s2.modify_reminders(|idx| {
                idx.remove("target");
                Ok(())
            })
        });
        h1.join().unwrap().unwrap();
        h2.join().unwrap().unwrap();
        let exists = state
            .read_reminders(|idx| idx.reminders.iter().any(|r| r.id == "target"))
            .unwrap();
        assert!(!exists, "场景4: 并发场景下删除必须生效,不能被调度器写回覆盖");
    }
}
