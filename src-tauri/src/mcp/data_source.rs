//! MCP tool 的数据源抽象
//!
//! 设计:tool 通过 trait 拿数据,不直接依赖 Tauri AppHandle。
//! - 测试时:用 mock 实现
//! - 生产时:用 TauriStateDatasource 包装真实状态

use crate::models::{Content, Reminder};
use serde::{Deserialize, Serialize};

/// 当前编辑状态(用于 get_edit_state tool)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditState {
    /// 当前编辑者:"human" / "llm" / "idle"
    pub editor: String,
    /// LLM 会话信息(若 editor == "llm")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<LlmSessionInfo>,
    /// 当前打开的文件路径(若有)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmSessionInfo {
    pub session_id: String,
    pub client_name: String,
    pub expires_at_ms: i64,
}

/// MCP tool 数据源
///
/// 所有方法返回克隆(不返回引用),避免生命周期复杂度。
/// 数据量小(content 通常 < 100KB,reminders < 1KB),克隆成本低。
pub trait MindmapDataSource: Send + Sync {
    /// 当前打开的文档 content(若没打开返回 None)
    fn current_content(&self) -> Option<Content>;

    /// 当前文件路径(若没保存返回 None)
    fn current_file_path(&self) -> Option<String>;

    /// 所有提醒(跨所有文档,全局)
    fn all_reminders(&self) -> Vec<Reminder>;

    /// 当前编辑状态
    fn edit_state(&self) -> EditState;
}

/// Mock 数据源(测试用)
#[cfg(test)]
pub struct MockDataSource {
    pub content: Option<Content>,
    pub file_path: Option<String>,
    pub reminders: Vec<Reminder>,
    pub edit_state: EditState,
}

#[cfg(test)]
impl MindmapDataSource for MockDataSource {
    fn current_content(&self) -> Option<Content> {
        self.content.clone()
    }
    fn current_file_path(&self) -> Option<String> {
        self.file_path.clone()
    }
    fn all_reminders(&self) -> Vec<Reminder> {
        self.reminders.clone()
    }
    fn edit_state(&self) -> EditState {
        self.edit_state.clone()
    }
}
