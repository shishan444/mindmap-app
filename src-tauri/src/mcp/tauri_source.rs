//! 生产环境数据源:从 Tauri AppState 读取
//!
//! 数据流:前端 store 变化 → invoke("mcp_update_state") → 写入此处 → MCP tool 读取
//! (Phase 1 只读,单向。Phase 2 加 LLM 写操作后,反向链路通过 Tauri event)

use crate::mcp::data_source::{EditState, MindmapDataSource};
use crate::models::{Content, Reminder};
use std::sync::{Arc, Mutex};

/// Tauri AppState 持有的 MCP 状态镜像
#[derive(Default)]
pub struct McpStateMirror {
    inner: Mutex<McpStateInner>,
}

#[derive(Default, Clone)]
struct McpStateInner {
    content: Option<Content>,
    file_path: Option<String>,
    reminders: Vec<Reminder>,
    edit_state: EditState,
}

impl McpStateMirror {
    pub fn new() -> Self {
        Self::default()
    }

    /// 前端推送状态(每次 store 变化触发)
    pub fn update(&self, content: Option<Content>, file_path: Option<String>, reminders: Vec<Reminder>, edit_state: EditState) {
        let mut inner = self.inner.lock().unwrap();
        inner.content = content;
        inner.file_path = file_path;
        inner.reminders = reminders;
        inner.edit_state = edit_state;
    }

    /// 拿一个克隆的 view(给 MCP tool 用)
    fn snapshot(&self) -> McpStateInner {
        self.inner.lock().unwrap().clone()
    }
}

impl MindmapDataSource for McpStateMirror {
    fn current_content(&self) -> Option<Content> {
        self.snapshot().content
    }
    fn current_file_path(&self) -> Option<String> {
        self.snapshot().file_path
    }
    fn all_reminders(&self) -> Vec<Reminder> {
        self.snapshot().reminders
    }
    fn edit_state(&self) -> EditState {
        self.snapshot().edit_state
    }
}

/// 帮助构造函数:用 Arc 包装
pub fn shared_mirror() -> Arc<McpStateMirror> {
    Arc::new(McpStateMirror::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Node;

    fn make_content() -> Content {
        let mut root = Node::new("root");
        root.id = "root".to_string();
        Content {
            version: "1.0".to_string(),
            root,
            canvas_state: Default::default(),
        }
    }

    #[test]
    fn test_mirror_starts_empty() {
        let m = McpStateMirror::new();
        assert!(m.current_content().is_none());
        assert!(m.current_file_path().is_none());
        assert_eq!(m.all_reminders().len(), 0);
        assert_eq!(m.edit_state().editor, "");
    }

    #[test]
    fn test_mirror_update_and_read() {
        let m = McpStateMirror::new();
        m.update(
            Some(make_content()),
            Some("/tmp/x.mmap".to_string()),
            vec![],
            EditState {
                editor: "human".to_string(),
                session: None,
                file_path: Some("/tmp/x.mmap".to_string()),
            },
        );
        assert_eq!(m.current_content().unwrap().root.id, "root");
        assert_eq!(m.current_file_path().unwrap(), "/tmp/x.mmap");
        assert_eq!(m.edit_state().editor, "human");
    }

    #[test]
    fn test_mirror_thread_safety() {
        // 模拟并发:多个线程同时 update / read
        let m = Arc::new(McpStateMirror::new());
        let mut handles = vec![];
        for i in 0..5 {
            let m_clone = m.clone();
            handles.push(std::thread::spawn(move || {
                m_clone.update(
                    Some(make_content()),
                    Some(format!("/tmp/{}.mmap", i)),
                    vec![],
                    EditState {
                        editor: "human".to_string(),
                        session: None,
                        file_path: None,
                    },
                );
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        // 最后一次写入的应该是某一个
        let path = m.current_file_path().unwrap();
        assert!(path.starts_with("/tmp/"));
        assert!(path.ends_with(".mmap"));
    }

    #[test]
    fn test_mirror_clear_state() {
        let m = McpStateMirror::new();
        m.update(
            Some(make_content()),
            Some("/tmp/x.mmap".to_string()),
            vec![],
            EditState {
                editor: "idle".to_string(),
                session: None,
                file_path: None,
            },
        );
        // 清空
        m.update(None, None, vec![], EditState {
            editor: "idle".to_string(),
            session: None,
            file_path: None,
        });
        assert!(m.current_content().is_none());
        assert!(m.current_file_path().is_none());
    }
}

// LlmSessionInfo test 在 data_source.rs 中 trait 测试覆盖
