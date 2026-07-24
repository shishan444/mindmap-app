//! LLM 操作审计日志
//!
//! 每次 llm-operation emit 时记录到 ~/Library/.../MindMap/llm-audit.jsonl
//! 格式:每行一个 JSON,含 timestamp / session_id / op_type / payload

use crate::mcp::event_emitter::{EventEmitter, LlmOperation, SessionChange};
use crate::mcp::protocol::RpcError;
use chrono::Utc;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AuditLogger {
    file: Mutex<PathBuf>,
}

impl AuditLogger {
    pub fn new(path: PathBuf) -> Self {
        // 确保父目录存在
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        Self {
            file: Mutex::new(path),
        }
    }

    /// 默认路径:~/Library/Application Support/MindMap/llm-audit.jsonl
    pub fn default_path() -> PathBuf {
        let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        base.join("MindMap").join("llm-audit.jsonl")
    }

    fn append(&self, record: serde_json::Value) {
        let path = self.file.lock().unwrap().clone();
        let line = serde_json::to_string(&record).unwrap_or_default();
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(f, "{}", line);
        }
    }
}

impl EventEmitter for AuditLogger {
    fn emit_llm_operation(&self, op: LlmOperation) -> Result<(), RpcError> {
        let record = serde_json::json!({
            "ts": Utc::now().to_rfc3339(),
            "type": "llm_operation",
            "op_id": op.op_id,
            "session_id": op.session_id,
            "op_type": op.op_type,
            "payload": op.payload,
        });
        self.append(record);
        Ok(())
    }
    fn emit_session_changed(&self, change: SessionChange) -> Result<(), RpcError> {
        let record = serde_json::json!({
            "ts": Utc::now().to_rfc3339(),
            "type": "session_change",
            "reason": change.reason,
            "session": change.session,
        });
        self.append(record);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::event_emitter::LlmOperation;
    use serde_json::json;

    fn make_logger() -> (AuditLogger, PathBuf, tempfile::TempDir) {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test-audit.jsonl");
        (AuditLogger::new(path.clone()), path, tmp)
    }

    #[test]
    fn test_emit_llm_operation_appends_line() {
        let (logger, path, _tmp) = make_logger();
        let op = LlmOperation {
            op_id: "op-1".to_string(),
            session_id: "s1".to_string(),
            op_type: "create_node".to_string(),
            payload: json!({"parent_id": "root"}),
            is_first_in_session: false,
            is_last_in_session: false,
        };
        logger.emit_llm_operation(op).unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("op-1"));
        assert!(content.contains("create_node"));
        assert!(content.contains("llm_operation"));
    }

    #[test]
    fn test_emit_session_change_appends_line() {
        let (logger, path, _tmp) = make_logger();
        logger
            .emit_session_changed(SessionChange {
                session: None,
                reason: "expired".to_string(),
            })
            .unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("session_change"));
        assert!(content.contains("expired"));
    }

    #[test]
    fn test_multiple_ops_append_separate_lines() {
        let (logger, path, _tmp) = make_logger();
        for i in 0..3 {
            let op = LlmOperation {
                op_id: format!("op-{}", i),
                session_id: "s1".to_string(),
                op_type: "create_node".to_string(),
                payload: json!({}),
                is_first_in_session: false,
                is_last_in_session: false,
            };
            logger.emit_llm_operation(op).unwrap();
        }
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content.lines().count(), 3);
    }
}
