//! EditorMode Mutex:全局写者锁
//!
//! 同一时刻只有一个写者(human or LLM session)。
//! Rust 端 `require_llm_session()` guard 是前置 check,
//! 即使前端 UI 防护失败,Rust 这层也能拦住。

use crate::mcp::protocol::RpcError;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub enum Editor {
    Human,
    Llm {
        session_id: String,
        client_name: String,
        /// ms since UNIX epoch
        acquired_at_ms: i64,
        /// TTL 毫秒(默认 60000)
        ttl_ms: u64,
    },
}

impl Editor {
    pub fn is_llm(&self) -> bool {
        matches!(self, Editor::Llm { .. })
    }

    pub fn is_human(&self) -> bool {
        matches!(self, Editor::Human)
    }

    pub fn session_id(&self) -> Option<&str> {
        if let Editor::Llm { session_id, .. } = self {
            Some(session_id)
        } else {
            None
        }
    }
}

/// 默认 TTL:60 秒
pub const DEFAULT_TTL_MS: u64 = 60_000;
/// 最大 TTL:5 分钟(防止 LLM 长时间持锁)
pub const MAX_TTL_MS: u64 = 300_000;

#[derive(Clone)]
pub struct EditorMode {
    inner: Arc<RwLock<Editor>>,
}

impl EditorMode {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(Editor::Human)),
        }
    }

    /// 当前 Editor(读锁,拿克隆)
    pub fn current(&self) -> Editor {
        self.inner.read().unwrap().clone()
    }

    /// LLM 尝试持锁。失败返回 RpcError(给 MCP 客户端)。
    pub fn try_acquire_llm(
        &self,
        session_id: &str,
        client_name: &str,
        ttl_ms: u64,
    ) -> Result<(), RpcError> {
        // TTL 上限检查
        let ttl = ttl_ms.clamp(1, MAX_TTL_MS);

        let mut guard = self.inner.write().unwrap();
        match &*guard {
            Editor::Human => {
                *guard = Editor::Llm {
                    session_id: session_id.to_string(),
                    client_name: client_name.to_string(),
                    acquired_at_ms: now_ms(),
                    ttl_ms: ttl,
                };
                Ok(())
            }
            Editor::Llm { session_id: s, .. } if s == session_id => {
                // 同 session 重复 acquire:刷新 TTL(等同 heartbeat)
                *guard = Editor::Llm {
                    session_id: session_id.to_string(),
                    client_name: client_name.to_string(),
                    acquired_at_ms: now_ms(),
                    ttl_ms: ttl,
                };
                Ok(())
            }
            Editor::Llm {
                session_id: existing,
                client_name: existing_client,
                ..
            } => Err(RpcError::mcp_error(
                "Editor is held by another LLM session",
                Some(serde_json::json!({
                    "current_session_id": existing,
                    "current_client": existing_client,
                    "hint": "wait and retry, or call force_release from UI",
                })),
            )),
        }
    }

    /// LLM 主动释放(必须 session_id 匹配)
    pub fn release_llm(&self, session_id: &str) -> Result<(), RpcError> {
        let mut guard = self.inner.write().unwrap();
        match &*guard {
            Editor::Llm { session_id: s, .. } if s == session_id => {
                *guard = Editor::Human;
                Ok(())
            }
            Editor::Llm { session_id: s, .. } => Err(RpcError::mcp_error(
                "Cannot release: session_id mismatch",
                Some(serde_json::json!({
                    "current_session_id": s,
                    "provided_session_id": session_id,
                })),
            )),
            Editor::Human => {
                // 已经是 Human,释放是 noop
                Ok(())
            }
        }
    }

    /// 用户强制释放(无视 session_id,总是成功)
    /// 这是"逃生舱"机制,UI 接管按钮调用
    pub fn force_release(&self) -> Option<String> {
        let mut guard = self.inner.write().unwrap();
        let old_session = match &*guard {
            Editor::Llm { session_id, .. } => Some(session_id.clone()),
            _ => None,
        };
        *guard = Editor::Human;
        old_session
    }

    /// 前置 guard:emit llm-operation 前必须 check
    pub fn require_llm_session(&self, session_id: &str) -> Result<(), RpcError> {
        let guard = self.inner.read().unwrap();
        match &*guard {
            Editor::Llm { session_id: s, .. } if s == session_id => Ok(()),
            Editor::Llm { session_id: s, .. } => Err(RpcError::mcp_error(
                "Not authorized: held by different session",
                Some(serde_json::json!({
                    "current_session_id": s,
                    "hint": "需重新 acquire_session",
                })),
            )),
            Editor::Human => Err(RpcError::mcp_error(
                "Not authorized: no active LLM session",
                Some(serde_json::json!({
                    "hint": "需先 acquire_session",
                })),
            )),
        }
    }

    /// TTL 过期检查(后台 task 调用)
    /// 返回 Some(session_id) 如果刚过期被自动释放
    pub fn check_ttl_expiry(&self) -> Option<String> {
        let mut guard = self.inner.write().unwrap();
        if let Editor::Llm {
            session_id,
            acquired_at_ms,
            ttl_ms,
            ..
        } = &*guard
        {
            let elapsed = now_ms() - acquired_at_ms;
            if elapsed > *ttl_ms as i64 {
                let sid = session_id.clone();
                *guard = Editor::Human;
                return Some(sid);
            }
        }
        None
    }

    /// 心跳:刷新 TTL(必须 session_id 匹配)
    pub fn heartbeat(&self, session_id: &str, ttl_ms: u64) -> Result<i64, RpcError> {
        let ttl = ttl_ms.clamp(1, MAX_TTL_MS);
        let mut guard = self.inner.write().unwrap();
        match &mut *guard {
            Editor::Llm {
                session_id: s,
                client_name,
                acquired_at_ms,
                ttl_ms: existing_ttl,
            } if s == session_id => {
                *acquired_at_ms = now_ms();
                *existing_ttl = ttl;
                let _ = client_name; // borrow to satisfy match
                Ok(*acquired_at_ms + ttl as i64)
            }
            _ => Err(RpcError::mcp_error(
                "Cannot heartbeat: no matching LLM session",
                None,
            )),
        }
    }
}

impl Default for EditorMode {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_starts_as_human() {
        let m = EditorMode::new();
        assert!(m.current().is_human());
        assert!(!m.current().is_llm());
    }

    #[test]
    fn test_acquire_changes_to_llm() {
        let m = EditorMode::new();
        assert!(m.try_acquire_llm("s1", "Claude", 60000).is_ok());
        assert!(m.current().is_llm());
        assert_eq!(m.current().session_id(), Some("s1"));
    }

    #[test]
    fn test_second_session_acquire_fails() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        let err = m.try_acquire_llm("s2", "Cursor", 60000).unwrap_err();
        assert_eq!(err.code, -32000);
        assert!(err.message.contains("held by another"));
    }

    #[test]
    fn test_same_session_re_acquire_refreshes_ttl() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        // 同 session 再次 acquire 应该成功(刷新)
        assert!(m.try_acquire_llm("s1", "Claude", 30000).is_ok());
        assert_eq!(m.current().session_id(), Some("s1"));
    }

    #[test]
    fn test_release_returns_to_human() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        assert!(m.release_llm("s1").is_ok());
        assert!(m.current().is_human());
    }

    #[test]
    fn test_release_wrong_session_fails() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        let err = m.release_llm("s2").unwrap_err();
        assert!(err.message.contains("mismatch"));
        // 锁未释放
        assert!(m.current().is_llm());
    }

    #[test]
    fn test_release_when_human_is_noop() {
        let m = EditorMode::new();
        assert!(m.release_llm("any").is_ok());
        assert!(m.current().is_human());
    }

    #[test]
    fn test_force_release_always_succeeds() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        let released = m.force_release();
        assert_eq!(released, Some("s1".to_string()));
        assert!(m.current().is_human());
    }

    #[test]
    fn test_force_release_when_human_returns_none() {
        let m = EditorMode::new();
        let released = m.force_release();
        assert_eq!(released, None);
    }

    #[test]
    fn test_require_llm_session_succeeds_when_held_by_same() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        assert!(m.require_llm_session("s1").is_ok());
    }

    #[test]
    fn test_require_llm_session_fails_when_held_by_other() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        let err = m.require_llm_session("s2").unwrap_err();
        assert!(err.message.contains("held by different"));
    }

    #[test]
    fn test_require_llm_session_fails_when_human() {
        let m = EditorMode::new();
        let err = m.require_llm_session("s1").unwrap_err();
        assert!(err.message.contains("no active LLM session"));
    }

    #[test]
    fn test_heartbeat_refreshes_ttl() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        let new_expiry = m.heartbeat("s1", 30000).unwrap();
        // 应该是 now + 30000ms 左右(允许误差)
        let now = now_ms();
        assert!((new_expiry - now - 30000).abs() < 1000);
    }

    #[test]
    fn test_heartbeat_wrong_session_fails() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        assert!(m.heartbeat("s2", 30000).is_err());
    }

    #[test]
    fn test_heartbeat_when_human_fails() {
        let m = EditorMode::new();
        assert!(m.heartbeat("any", 30000).is_err());
    }

    #[test]
    fn test_ttl_expiry_releases_session() {
        let m = EditorMode::new();
        // 用 1ms TTL,acquire 后立即过期
        m.try_acquire_llm("s1", "Claude", 1).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let expired = m.check_ttl_expiry();
        assert_eq!(expired, Some("s1".to_string()));
        assert!(m.current().is_human());
    }

    #[test]
    fn test_ttl_expiry_noop_when_not_expired() {
        let m = EditorMode::new();
        m.try_acquire_llm("s1", "Claude", 60000).unwrap();
        let expired = m.check_ttl_expiry();
        assert_eq!(expired, None);
        assert!(m.current().is_llm());
    }

    #[test]
    fn test_ttl_expiry_noop_when_human() {
        let m = EditorMode::new();
        let expired = m.check_ttl_expiry();
        assert_eq!(expired, None);
    }

    #[test]
    fn test_ttl_clamped_to_max() {
        let m = EditorMode::new();
        // 请求 999999ms(超过 MAX),应被限制
        assert!(m.try_acquire_llm("s1", "Claude", 999_999).is_ok());
        if let Editor::Llm { ttl_ms, .. } = m.current() {
            assert_eq!(ttl_ms, MAX_TTL_MS);
        } else {
            panic!("should be Llm");
        }
    }

    #[test]
    fn test_concurrent_acquire_only_one_wins() {
        let m = Arc::new(EditorMode::new());
        let mut handles = vec![];
        let success_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

        for i in 0..10 {
            let m_clone = m.clone();
            let sc = success_count.clone();
            handles.push(std::thread::spawn(move || {
                if m_clone
                    .try_acquire_llm(&format!("s{}", i), &format!("c{}", i), 60000)
                    .is_ok()
                {
                    sc.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        // 必须只有 1 个成功
        assert_eq!(
            success_count.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "only one LLM should acquire"
        );
    }

    #[test]
    fn test_editor_helpers() {
        let human = Editor::Human;
        assert!(human.is_human());
        assert!(!human.is_llm());
        assert_eq!(human.session_id(), None);

        let llm = Editor::Llm {
            session_id: "s1".to_string(),
            client_name: "Claude".to_string(),
            acquired_at_ms: 0,
            ttl_ms: 60000,
        };
        assert!(!llm.is_human());
        assert!(llm.is_llm());
        assert_eq!(llm.session_id(), Some("s1"));
    }
}
