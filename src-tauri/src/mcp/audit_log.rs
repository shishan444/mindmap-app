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
    path: PathBuf,
    /// 串行化文件 append 操作,避免并发写丢失(O_APPEND 在某些平台不保证
    /// 多次 write 调用原子,writeln! 内部可能是多次 write,需用锁串行化)。
    lock: Mutex<()>,
}

impl AuditLogger {
    pub fn new(path: PathBuf) -> Self {
        // 确保父目录存在
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    /// 默认路径:~/Library/Application Support/MindMap/llm-audit.jsonl
    pub fn default_path() -> PathBuf {
        let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        base.join("MindMap").join("llm-audit.jsonl")
    }

    fn append(&self, record: serde_json::Value) {
        // 关键:整个 open + writeln 在锁内,避免并发丢行
        let _guard = self.lock.lock().unwrap();
        let line = serde_json::to_string(&record).unwrap_or_default();
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&self.path) {
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

    // === OB-025 审计日志业务层完整性 ===

    fn make_op(op_id: &str, op_type: &str, payload: serde_json::Value) -> LlmOperation {
        LlmOperation {
            op_id: op_id.to_string(),
            session_id: "s1".to_string(),
            op_type: op_type.to_string(),
            payload,
            is_first_in_session: false,
            is_last_in_session: false,
        }
    }

    #[test]
    fn test_ob025_every_op_has_complete_schema() {
        // 每个 audit entry 必须有完整 schema:ts / type / op_id / session_id / op_type / payload
        let (logger, path, _tmp) = make_logger();
        logger
            .emit_llm_operation(make_op(
                "op-1",
                "create_node",
                json!({"parent_id": "root", "topic": "测试"}),
            ))
            .unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let record: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        assert!(record.get("ts").is_some(), "缺 ts 字段");
        assert_eq!(record.get("type").unwrap(), "llm_operation");
        assert_eq!(record.get("op_id").unwrap(), "op-1");
        assert_eq!(record.get("session_id").unwrap(), "s1");
        assert_eq!(record.get("op_type").unwrap(), "create_node");
        assert_eq!(
            record.get("payload").unwrap().get("parent_id").unwrap(),
            "root"
        );
        assert_eq!(
            record.get("payload").unwrap().get("topic").unwrap(),
            "测试"
        );
    }

    #[test]
    fn test_ob025_payload_preserves_complex_nested_data() {
        // payload 含嵌套结构时必须完整保留(icons 数组 + priority)
        let (logger, path, _tmp) = make_logger();
        logger
            .emit_llm_operation(make_op(
                "op-x",
                "create_node",
                json!({
                    "parent_id": "root",
                    "topic": "复杂节点",
                    "priority": "P0",
                    "icons": ["🔥", "⚡", "➕"]
                }),
            ))
            .unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let record: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        let payload = record.get("payload").unwrap();
        assert_eq!(payload.get("priority").unwrap(), "P0");
        let icons = payload.get("icons").unwrap().as_array().unwrap();
        assert_eq!(icons.len(), 3);
        assert_eq!(icons[0], "🔥");
    }

    #[test]
    fn test_ob025_session_change_acquired_logs_full_session_info() {
        // acquired 时 audit 必须含完整 session 信息(session_id/client_name/expires_at_ms)
        use crate::mcp::session::SessionInfo;
        let (logger, path, _tmp) = make_logger();
        let session_info = SessionInfo {
            session_id: "s-acquire".to_string(),
            client_name: "Claude Desktop".to_string(),
            acquired_at_ms: 1234567890,
            expires_at_ms: 1234627890,
            last_heartbeat_ms: 1234567890,
            operations_count: 0,
        };
        logger
            .emit_session_changed(SessionChange {
                session: Some(session_info.clone()),
                reason: "acquired".to_string(),
            })
            .unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let record: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(record.get("type").unwrap(), "session_change");
        assert_eq!(record.get("reason").unwrap(), "acquired");
        assert_eq!(
            record.get("session").unwrap().get("session_id").unwrap(),
            "s-acquire"
        );
        assert_eq!(
            record.get("session").unwrap().get("client_name").unwrap(),
            "Claude Desktop"
        );
    }

    #[test]
    fn test_ob025_mixed_ops_and_sessions_in_order() {
        // 业务场景:acquire → 多 op → release,审计日志应按时间顺序完整记录
        use crate::mcp::session::SessionInfo;
        let (logger, path, _tmp) = make_logger();
        let session_info = SessionInfo {
            session_id: "s1".to_string(),
            client_name: "Claude".to_string(),
            acquired_at_ms: 1000,
            expires_at_ms: 61000,
            last_heartbeat_ms: 1000,
            operations_count: 0,
        };
        logger
            .emit_session_changed(SessionChange {
                session: Some(session_info.clone()),
                reason: "acquired".to_string(),
            })
            .unwrap();
        logger.emit_llm_operation(make_op("op-1", "create_node", json!({}))).unwrap();
        logger.emit_llm_operation(make_op("op-2", "update_node", json!({}))).unwrap();
        logger.emit_llm_operation(make_op("op-3", "delete_node", json!({}))).unwrap();
        logger
            .emit_session_changed(SessionChange {
                session: None,
                reason: "released".to_string(),
            })
            .unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let records: Vec<serde_json::Value> = content
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(records.len(), 5);
        assert_eq!(records[0].get("reason").unwrap(), "acquired");
        assert_eq!(records[1].get("op_id").unwrap(), "op-1");
        assert_eq!(records[2].get("op_id").unwrap(), "op-2");
        assert_eq!(records[3].get("op_id").unwrap(), "op-3");
        assert_eq!(records[4].get("reason").unwrap(), "released");
    }

    #[test]
    fn test_ob025_concurrent_emits_dont_corrupt_file() {
        // 并发 emit 不应导致 jsonl 文件损坏(每行一个完整 JSON)
        let (logger, path, _tmp) = make_logger();
        let logger = std::sync::Arc::new(logger);
        let mut handles = vec![];
        for i in 0..10 {
            let l = logger.clone();
            handles.push(std::thread::spawn(move || {
                l.emit_llm_operation(make_op(
                    &format!("op-{}", i),
                    "create_node",
                    json!({"idx": i}),
                ))
                .unwrap();
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 10);
        // 每行必须是合法 JSON
        for line in &lines {
            let _: serde_json::Value = serde_json::from_str(line).unwrap();
        }
    }

    #[test]
    fn test_ob025_ts_is_rfc3339_format() {
        // ts 字段必须是 RFC 3339 格式(可被 chrono 解析)
        let (logger, path, _tmp) = make_logger();
        logger.emit_llm_operation(make_op("op-1", "create_node", json!({}))).unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let record: serde_json::Value = serde_json::from_str(content.trim()).unwrap();
        let ts = record.get("ts").unwrap().as_str().unwrap();
        let parsed: chrono::DateTime<chrono::FixedOffset> =
            chrono::DateTime::parse_from_rfc3339(ts).unwrap();
        let _: chrono::DateTime<chrono::Utc> = parsed.into();
    }
}
