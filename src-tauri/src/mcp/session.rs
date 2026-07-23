//! SessionRegistry:LLM session 管理和 TTL 自动释放
//!
//! 配合 EditorMode Mutex 工作:
//! - EditorMode 负责"当前谁持锁"
//! - SessionRegistry 负责"历史 session 记录 + TTL task"
//!
//! TTL task:每 1s 调 EditorMode.check_ttl_expiry(),
//! 过期则 emit "llm-session-expired" Tauri event 让前端 banner 消失

use crate::mcp::editor_mode::EditorMode;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub client_name: String,
    pub acquired_at_ms: i64,
    pub expires_at_ms: i64,
    pub last_heartbeat_ms: i64,
    pub operations_count: u32,
}

#[derive(Default)]
struct RegistryInner {
    /// 所有活跃 session 的元信息
    sessions: HashMap<String, SessionInfo>,
}

#[derive(Clone)]
pub struct SessionRegistry {
    inner: Arc<Mutex<RegistryInner>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryInner::default())),
        }
    }

    /// 注册新 session(在 EditorMode.try_acquire_llm 成功后调)
    pub fn register(&self, session_id: &str, client_name: &str, ttl_ms: u64) -> SessionInfo {
        let now = now_ms();
        let info = SessionInfo {
            session_id: session_id.to_string(),
            client_name: client_name.to_string(),
            acquired_at_ms: now,
            expires_at_ms: now + ttl_ms as i64,
            last_heartbeat_ms: now,
            operations_count: 0,
        };
        let mut guard = self.inner.lock().unwrap();
        guard.sessions.insert(session_id.to_string(), info.clone());
        info
    }

    /// 心跳(刷新 expires_at)
    pub fn heartbeat(&self, session_id: &str, ttl_ms: u64) -> Option<SessionInfo> {
        let mut guard = self.inner.lock().unwrap();
        if let Some(info) = guard.sessions.get_mut(session_id) {
            let now = now_ms();
            info.last_heartbeat_ms = now;
            info.expires_at_ms = now + ttl_ms as i64;
            return Some(info.clone());
        }
        None
    }

    /// 记录一次操作(写 tool 调用时计数)
    pub fn record_operation(&self, session_id: &str) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(info) = guard.sessions.get_mut(session_id) {
            info.operations_count += 1;
        }
    }

    /// 主动移除 session(release / force_release 时调)
    pub fn remove(&self, session_id: &str) -> Option<SessionInfo> {
        let mut guard = self.inner.lock().unwrap();
        guard.sessions.remove(session_id)
    }

    /// 列出所有活跃 session(快照)
    pub fn list_active(&self) -> Vec<SessionInfo> {
        let guard = self.inner.lock().unwrap();
        guard.sessions.values().cloned().collect()
    }

    /// 找指定 session
    pub fn get(&self, session_id: &str) -> Option<SessionInfo> {
        let guard = self.inner.lock().unwrap();
        guard.sessions.get(session_id).cloned()
    }
}

impl Default for SessionRegistry {
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

/// 启动 TTL 检查 task
///
/// 每 1s 调用 `editor_mode.check_ttl_expiry()`,
/// 过期时从 registry 移除 + 返回 session_id 让调用方 emit event。
///
/// 用法:
/// ```ignore
/// let expiry_tx = tokio::spawn(spawn_ttl_task(editor_mode, registry));
/// // expiry_rx 收到过期 session_id 时 emit "llm-session-expired"
/// ```
pub async fn run_ttl_loop(
    editor_mode: EditorMode,
    registry: SessionRegistry,
    on_expiry: impl Fn(String) + Send + 'static,
) {
    let interval = std::time::Duration::from_secs(1);
    loop {
        tokio::time::sleep(interval).await;
        if let Some(expired_session) = editor_mode.check_ttl_expiry() {
            registry.remove(&expired_session);
            on_expiry(expired_session);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_creates_session() {
        let r = SessionRegistry::new();
        let info = r.register("s1", "Claude", 60000);
        assert_eq!(info.session_id, "s1");
        assert_eq!(info.client_name, "Claude");
        assert!(info.expires_at_ms > info.acquired_at_ms);
        assert_eq!(r.list_active().len(), 1);
    }

    #[test]
    fn test_heartbeat_updates_expiry() {
        let r = SessionRegistry::new();
        let info1 = r.register("s1", "Claude", 1000);
        std::thread::sleep(std::time::Duration::from_millis(10));
        let info2 = r.heartbeat("s1", 30000).unwrap();
        assert!(info2.expires_at_ms > info1.expires_at_ms);
    }

    #[test]
    fn test_heartbeat_unknown_session() {
        let r = SessionRegistry::new();
        assert!(r.heartbeat("nonexistent", 30000).is_none());
    }

    #[test]
    fn test_record_operation_increments() {
        let r = SessionRegistry::new();
        r.register("s1", "Claude", 60000);
        r.record_operation("s1");
        r.record_operation("s1");
        let info = r.get("s1").unwrap();
        assert_eq!(info.operations_count, 2);
    }

    #[test]
    fn test_remove_clears_session() {
        let r = SessionRegistry::new();
        r.register("s1", "Claude", 60000);
        assert!(r.remove("s1").is_some());
        assert!(r.get("s1").is_none());
        assert_eq!(r.list_active().len(), 0);
    }

    #[test]
    fn test_remove_unknown_returns_none() {
        let r = SessionRegistry::new();
        assert!(r.remove("nonexistent").is_none());
    }

    #[test]
    fn test_list_active_returns_all() {
        let r = SessionRegistry::new();
        r.register("s1", "Claude", 60000);
        r.register("s2", "Cursor", 60000);
        let list = r.list_active();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_multiple_sessions_independent() {
        let r = SessionRegistry::new();
        r.register("s1", "Claude", 1000);
        r.register("s2", "Cursor", 60000);
        // 只心跳 s2,s1 的 expires_at 不变
        let s1_before = r.get("s1").unwrap().expires_at_ms;
        std::thread::sleep(std::time::Duration::from_millis(5));
        r.heartbeat("s2", 60000);
        let s1_after = r.get("s1").unwrap().expires_at_ms;
        assert_eq!(s1_before, s1_after);
    }

    // === TTL 后台 task 集成测试 ===

    #[tokio::test]
    async fn test_ttl_loop_expires_session() {
        let editor = EditorMode::new();
        let registry = SessionRegistry::new();
        editor.try_acquire_llm("s1", "Claude", 1).unwrap(); // 1ms TTL
        registry.register("s1", "Claude", 1);

        let expired_session = Arc::new(Mutex::new(None::<String>));
        let expired_clone = expired_session.clone();

        let handle = tokio::spawn(run_ttl_loop(
            editor.clone(),
            registry.clone(),
            move |sid| {
                *expired_clone.lock().unwrap() = Some(sid);
            },
        ));

        // 等 2s 让 TTL loop 跑两次
        tokio::time::sleep(std::time::Duration::from_millis(2100)).await;
        handle.abort();

        let result = expired_session.lock().unwrap().clone();
        assert_eq!(result, Some("s1".to_string()));
        // editor 应该已经释放
        assert!(editor.current().is_human());
        // registry 也应该移除了
        assert!(registry.get("s1").is_none());
    }

    #[tokio::test]
    async fn test_ttl_loop_no_expiry_when_session_active() {
        let editor = EditorMode::new();
        let registry = SessionRegistry::new();
        editor.try_acquire_llm("s1", "Claude", 60000).unwrap();
        registry.register("s1", "Claude", 60000);

        let fired = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let fired_clone = fired.clone();
        let handle = tokio::spawn(run_ttl_loop(
            editor.clone(),
            registry.clone(),
            move |_| {
                fired_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            },
        ));

        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        handle.abort();

        // 不应该 fire
        assert_eq!(
            fired.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "TTL should not fire for active session"
        );
    }
}
