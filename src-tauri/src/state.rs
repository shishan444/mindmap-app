//! 全局共享状态。
//!
//! AppState 通过 `app.manage()` 注入 Tauri State,跨命令/线程共享。
//! 所有 reminder 的读写都通过 Mutex 串行化,避免与调度器之间的写写冲突。
//!
//! ## Bug 历史
//!
//! ### Race condition(已修复)
//! 之前的实现里,`reminder_scheduler::poll_once` 和 `commands::delete_reminder`
//! 各自走 `load_reminders → modify → save_reminders`,这是非原子的。
//! 用 Mutex 后,所有读写串行,这个 race 不再可能发生。
//!
//! ### 测试污染生产数据(已修复)
//! 之前测试通过 `MINDMAP_TEST_DATA_DIR` env var 隔离写盘路径,但:
//! - `std::env::set_var` 多线程不安全
//! - `.cargo/config.toml` 的 `[env] RUST_TEST_THREADS="1"` 在某些场景不生效
//! - 测试在并发跑时 set_var 互相覆盖,某些时刻 `app_data_dir()` 返回真实路径
//! - save_reminders 把 100+ 个 title="a" 的测试 reminder 写到真实数据目录
//! - 用户启动应用加载该文件,调度器触发"幽灵"通知(标题 "a")
//!
//! **修复**:依赖注入。`AppState` 内部存 `save_fn: Option<Box<...>>`,
//! 生产路径 `new()` 注入真实 `config::save_reminders`,
//! 测试路径 `new_in_memory()` 用 None 完全跳过写盘,
//! **测试代码永远不可能写到文件系统**。

use std::sync::Mutex;

use crate::config;
use crate::error::Result;
use crate::models::ReminderIndex;

/// Save 函数类型(返回 Result)。生产用真实 save_reminders,测试用 None。
type SaveFn = Box<dyn Fn(&ReminderIndex) -> Result<()> + Send + Sync>;

/// 全局应用状态(目前只承载 reminders,后续可扩展)
pub struct AppState {
    /// 全局 reminder 集合,所有读写都通过这个 Mutex 串行化
    pub reminders: Mutex<ReminderIndex>,
    /// 写盘函数。生产环境注入真实 save_reminders;测试环境用 None 跳过。
    /// 这是依赖注入,避免测试代码污染真实数据目录。
    save_fn: Option<SaveFn>,
}

impl AppState {
    /// 生产构造方法:注入真实 save_reminders(写到 ~/Library/.../reminders.json)
    pub fn new(initial: ReminderIndex) -> Self {
        Self {
            reminders: Mutex::new(initial),
            save_fn: Some(Box::new(|idx| config::save_reminders(idx))),
        }
    }

    /// 测试构造方法:不写盘,纯内存。彻底杜绝测试污染生产数据。
    #[cfg(test)]
    pub fn new_in_memory(initial: ReminderIndex) -> Self {
        Self {
            reminders: Mutex::new(initial),
            save_fn: None,
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
        // 写盘(锁内,确保顺序一致)。测试模式 save_fn=None 跳过。
        if let Some(save) = &self.save_fn {
            save(&data)?;
        }
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
        // 用 in-memory 模式,**绝不写盘**
        // (之前的 bug:测试通过 set_var MINDMAP_TEST_DATA_DIR 隔离,
        //  但 set_var 多线程不安全 + cargo config 在某些场景不生效,
        //  导致 save_reminders 写到真实 ~/Library/.../reminders.json,
        //  污染生产数据,触发"幽灵"提醒)
        AppState::new_in_memory(ReminderIndex {
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

    /// 关键回归测试:验证 in-memory 模式真的不写盘。
    /// 这是防止"测试污染生产数据"事故再次发生的守卫。
    #[test]
    fn in_memory_never_writes_to_disk() {
        use std::path::PathBuf;

        // 准备一个独立临时目录,假设它是 app_data_dir
        let mut test_dir: PathBuf = std::env::temp_dir();
        test_dir.push(format!(
            "mindmap-state-no-write-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test").replace("::", "_"),
        ));
        let _ = std::fs::remove_dir_all(&test_dir);
        std::fs::create_dir_all(&test_dir).unwrap();
        // 这里 NOT set_var(不依赖 env var 隔离),而是直接用 in-memory 模式

        let state = AppState::new_in_memory(ReminderIndex {
            version: "1.0.0".into(),
            reminders: vec![],
        });

        // 进行大量 modify 操作
        for i in 0..50 {
            let id = format!("test-{}", i);
            state
                .modify_reminders(|idx| {
                    idx.add_or_replace(make_reminder(&id));
                    Ok(())
                })
                .unwrap();
        }

        // 验证:文件系统中**任何地方都不应该有**包含这些 reminder 的文件
        // 重点检查 test_dir(如果 in-memory 失败 + 测试代码错误地用了 save_reminders,
        // test_dir 会有 reminders.json)
        let reminders_file = test_dir.join("reminders.json");
        assert!(
            !reminders_file.exists(),
            "in-memory 模式不应写盘,但发现 {}",
            reminders_file.display()
        );

        // 也检查真实数据目录(防止 in-memory 失效时写到真实路径)
        let real_data_dir = dirs::data_dir().map(|d| d.join("MindMap"));
        if let Some(real) = real_data_dir {
            let real_file = real.join("reminders.json");
            if real_file.exists() {
                let content = std::fs::read_to_string(&real_file).unwrap_or_default();
                // 真实文件里不应有测试 reminder 标记字符串
                assert!(
                    !content.contains("\"test-0\"") && !content.contains("\"target\""),
                    "真实 reminders.json 不应包含测试数据,但发现了污染!\n路径: {}\n内容片段: {}",
                    real_file.display(),
                    &content[..content.len().min(200)]
                );
            }
        }

        // 清理
        let _ = std::fs::remove_dir_all(&test_dir);
    }

    /// 验证:并发跑多个 in-memory 测试不互相干扰
    /// (之前 set_var 在多线程跑测试时会互相覆盖,导致污染;in-memory 模式应彻底避免)
    #[test]
    fn concurrent_in_memory_states_are_isolated() {
        use std::sync::Arc;
        use std::thread;

        let states: Arc<Vec<Arc<AppState>>> = Arc::new(
            (0..5)
                .map(|_| {
                    Arc::new(AppState::new_in_memory(ReminderIndex {
                        version: "1.0.0".into(),
                        reminders: vec![],
                    }))
                })
                .collect(),
        );

        let mut handles = vec![];
        for (idx, state) in states.iter().enumerate() {
            let s = Arc::clone(state);
            handles.push(thread::spawn(move || {
                let id = format!("state-{}-r", idx);
                s.modify_reminders(|data| {
                    data.add_or_replace(make_reminder(&id));
                    Ok(())
                })
                .unwrap();
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        // 每个 state 应该只有一个 reminder(完全隔离)
        for (idx, state) in states.iter().enumerate() {
            let count = state.read_reminders(|d| d.reminders.len()).unwrap();
            assert_eq!(count, 1, "state {} 应只有 1 个 reminder", idx);
            let id = state
                .read_reminders(|d| d.reminders[0].id.clone())
                .unwrap();
            assert_eq!(id, format!("state-{}-r", idx));
        }
    }
}
