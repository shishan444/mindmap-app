//! 开发模式日志：结构化 JSONL 日志写入 ~/Library/Application Support/MindMap/logs/
//!
//! 文件命名：session-YYYYMMDD-HHMMSS.jsonl（每个会话一个文件）
//! 格式：每行一个 JSON 对象（机器/LLM 友好，可直接 jq 解析）
//!
//! 测试时用 MINDMAP_TEST_DATA_DIR 环境变量重定向，避免污染真实日志。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub ts: String,
    pub level: String,
    pub cat: String,
    pub op: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(default)]
    pub seq: u64,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub session_id: String,
}

static LOG_FILE: Mutex<Option<File>> = Mutex::new(None);

/// 初始化日志（创建 logs/ 目录 + 打开 session 文件）
/// 可重入：每次调用都会创建新 session 文件（便于测试）
pub fn init() -> Result<()> {
    let dir = crate::config::app_data_dir()?.join("logs");
    std::fs::create_dir_all(&dir)?;
    let now = Utc::now();
    let filename = format!("session-{}.jsonl", now.format("%Y%m%d-%H%M%S-%3f"));
    let path = dir.join(filename);
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;

    let mut guard = LOG_FILE
        .lock()
        .map_err(|_| crate::error::AppError::Config("dev_logger 锁失败".to_string()))?;
    *guard = Some(file);
    Ok(())
}

/// 写一条日志（JSONL）
pub fn write(entry: &LogEntry) -> Result<()> {
    let mut guard = LOG_FILE
        .lock()
        .map_err(|_| crate::error::AppError::Config("dev_logger 锁失败".to_string()))?;
    let file = guard
        .as_mut()
        .ok_or_else(|| crate::error::AppError::Config("日志文件未初始化".to_string()))?;
    let line = serde_json::to_string(entry)?;
    writeln!(file, "{}", line)?;
    // 每条立即 flush（开发模式看重实时性）
    file.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    pub(crate) static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    /// 获取测试用全局锁，让 dev_logger 测试串行（避免 env var + Mutex 状态污染）
    /// Guard 返回 'static lifetime（unsafe transmute，但测试用安全）
    fn lock_for_test() -> std::sync::MutexGuard<'static, ()> {
        // SAFETY: 测试间没有 'static 数据依赖，guard 在测试函数返回时正常 drop
        unsafe {
            std::mem::transmute::<
                std::sync::MutexGuard<'_, ()>,
                std::sync::MutexGuard<'static, ()>,
            >(TEST_LOCK.lock().unwrap())
        }
    }

    fn setup_test_env(_label: &str) {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "mindmap-log-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        std::env::set_var("MINDMAP_TEST_DATA_DIR", &p);
    }

    fn make_entry(op: &str) -> LogEntry {
        LogEntry {
            ts: "2026-07-15T08:00:00.000Z".to_string(),
            level: "info".to_string(),
            cat: "test".to_string(),
            op: op.to_string(),
            payload: Some(serde_json::json!({ "key": "value" })),
            duration_ms: Some(42),
            error: None,
            stack: None,
            seq: 1,
            session_id: "test-session".to_string(),
        }
    }

    #[test]
    fn log_entry_serializes_all_fields() {
        let e = make_entry("test.op");
        let s = serde_json::to_string(&e).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed["ts"], "2026-07-15T08:00:00.000Z");
        assert_eq!(parsed["level"], "info");
        assert_eq!(parsed["cat"], "test");
        assert_eq!(parsed["op"], "test.op");
        assert_eq!(parsed["payload"]["key"], "value");
        assert_eq!(parsed["duration_ms"], 42);
        assert_eq!(parsed["seq"], 1);
        assert_eq!(parsed["session_id"], "test-session");
    }

    #[test]
    fn log_entry_skips_none_fields() {
        let mut e = make_entry("test");
        e.error = None;
        e.stack = None;
        let s = serde_json::to_string(&e).unwrap();
        assert!(!s.contains("\"error\""));
        assert!(!s.contains("\"stack\""));
    }

    #[test]
    fn log_entry_with_error_includes_all() {
        let mut e = make_entry("error.op");
        e.level = "error".to_string();
        e.error = Some("disk full".to_string());
        e.stack = Some("at line 1".to_string());
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains("\"level\":\"error\""));
        assert!(s.contains("\"error\":\"disk full\""));
        assert!(s.contains("\"stack\":\"at line 1\""));
    }

    #[test]
    fn init_creates_logs_dir() {
        let _g = lock_for_test();
        setup_test_env("init_creates");
        init().unwrap();
        let test_dir = std::env::var("MINDMAP_TEST_DATA_DIR").unwrap();
        let logs_dir = std::path::PathBuf::from(test_dir).join("logs");
        assert!(logs_dir.exists(), "logs/ 应被创建");
        let entries: Vec<_> = std::fs::read_dir(&logs_dir).unwrap().collect();
        assert!(!entries.is_empty(), "应至少有一个 session 文件");
    }

    #[test]
    fn write_appends_lines_to_session_file() {
        let _g = lock_for_test();
        setup_test_env("write_appends");
        init().unwrap();
        write(&make_entry("first")).unwrap();
        write(&make_entry("second")).unwrap();
        write(&make_entry("third")).unwrap();

        let logs_dir = crate::config::app_data_dir().unwrap().join("logs");
        let mut files: Vec<_> = std::fs::read_dir(&logs_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        files.sort_by_key(|f| f.metadata().unwrap().modified().unwrap());
        let latest = files.last().unwrap().path();
        let content = std::fs::read_to_string(&latest).unwrap();
        let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 3);
        for line in &lines {
            let parsed: serde_json::Value = serde_json::from_str(line).unwrap();
            assert!(parsed["op"].is_string());
            assert!(parsed["ts"].is_string());
        }
    }

    #[test]
    fn write_includes_payload_serialized() {
        let _g = lock_for_test();
        setup_test_env("payload_serialized");
        init().unwrap();
        let mut e = make_entry("with.payload");
        e.payload = Some(serde_json::json!({
            "user": "test",
            "nested": { "key": [1, 2, 3] }
        }));
        write(&e).unwrap();

        let logs_dir = crate::config::app_data_dir().unwrap().join("logs");
        let mut files: Vec<_> = std::fs::read_dir(&logs_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        files.sort_by_key(|f| f.metadata().unwrap().modified().unwrap());
        let latest = files.last().unwrap().path();
        let content = std::fs::read_to_string(&latest).unwrap();
        let last_line = content.lines().last().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(last_line).unwrap();
        assert_eq!(parsed["payload"]["user"], "test");
        assert_eq!(parsed["payload"]["nested"]["key"][0], 1);
    }

    #[test]
    fn jsonl_format_machine_friendly() {
        let _g = lock_for_test();
        setup_test_env("jsonl_format");
        init().unwrap();
        write(&make_entry("op1")).unwrap();
        write(&make_entry("op2")).unwrap();

        let logs_dir = crate::config::app_data_dir().unwrap().join("logs");
        let mut files: Vec<_> = std::fs::read_dir(&logs_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        files.sort_by_key(|f| f.metadata().unwrap().modified().unwrap());
        let latest = files.last().unwrap().path();
        let content = std::fs::read_to_string(&latest).unwrap();

        for line in content.lines() {
            if line.is_empty() {
                continue;
            }
            let _: serde_json::Value = serde_json::from_str(line)
                .expect("每行必须是合法 JSON");
        }
        let first_line = content.lines().next().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(first_line).unwrap();
        let op = parsed["op"].as_str().expect("op 字段必须是 string");
        assert_eq!(op, "op1");
    }
}
