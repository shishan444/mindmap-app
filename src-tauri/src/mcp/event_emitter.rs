//! EventEmitter 抽象:让 tool 不直接依赖 Tauri AppHandle
//!
//! 生产用 TauriEmitter(emit 真实 Tauri event),
//! 测试用 MockEmitter(收集到 Vec 检查)。

use crate::mcp::protocol::RpcError;
use crate::mcp::session::SessionInfo;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;

/// LLM 操作事件(emit 给前端 operationBridge)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmOperation {
    /// 唯一 op id(便于前端幂等处理)
    pub op_id: String,
    /// LLM session id
    pub session_id: String,
    /// 操作类型:create_node / update_node / delete_node / move_node / attach_file
    pub op_type: String,
    /// 操作参数(具体结构因 op_type 而异)
    pub payload: Value,
    /// 会话首操作(前端 pause zundo)
    pub is_first_in_session: bool,
    /// 会话尾操作(前端 resume zundo + wrap)
    pub is_last_in_session: bool,
}

/// 会话变更事件(emit 给前端 banner UI)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionChange {
    /// 持有 session(Some=Llm 持锁,None=Human)
    pub session: Option<SessionInfo>,
    /// 变更原因:acquired / released / expired / forced
    pub reason: String,
}

pub trait EventEmitter: Send + Sync {
    fn emit_llm_operation(&self, op: LlmOperation) -> Result<(), RpcError>;
    fn emit_session_changed(&self, change: SessionChange) -> Result<(), RpcError>;
}

/// 测试用 mock:收集所有事件
pub struct MockEmitter {
    pub operations: Mutex<Vec<LlmOperation>>,
    pub session_changes: Mutex<Vec<SessionChange>>,
}

impl MockEmitter {
    pub fn new() -> Self {
        Self {
            operations: Mutex::new(vec![]),
            session_changes: Mutex::new(vec![]),
        }
    }

    pub fn operations_snapshot(&self) -> Vec<LlmOperation> {
        self.operations.lock().unwrap().clone()
    }

    pub fn session_changes_snapshot(&self) -> Vec<SessionChange> {
        self.session_changes.lock().unwrap().clone()
    }
}

impl Default for MockEmitter {
    fn default() -> Self {
        Self::new()
    }
}

impl EventEmitter for MockEmitter {
    fn emit_llm_operation(&self, op: LlmOperation) -> Result<(), RpcError> {
        self.operations.lock().unwrap().push(op);
        Ok(())
    }
    fn emit_session_changed(&self, change: SessionChange) -> Result<(), RpcError> {
        self.session_changes.lock().unwrap().push(change);
        Ok(())
    }
}

/// 生成唯一 op id
pub fn gen_op_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_mock_emitter_collects_operations() {
        let m = MockEmitter::new();
        let op = LlmOperation {
            op_id: gen_op_id(),
            session_id: "s1".to_string(),
            op_type: "create_node".to_string(),
            payload: json!({"parent_id": "root"}),
            is_first_in_session: true,
            is_last_in_session: false,
        };
        m.emit_llm_operation(op.clone()).unwrap();
        let ops = m.operations_snapshot();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op_type, "create_node");
    }

    #[test]
    fn test_mock_emitter_collects_session_changes() {
        let m = MockEmitter::new();
        m.emit_session_changed(SessionChange {
            session: None,
            reason: "expired".to_string(),
        })
        .unwrap();
        let changes = m.session_changes_snapshot();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].reason, "expired");
    }

    #[test]
    fn test_gen_op_id_unique() {
        let id1 = gen_op_id();
        let id2 = gen_op_id();
        assert_ne!(id1, id2);
    }
}
