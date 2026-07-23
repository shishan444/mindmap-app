//! 会话管理 tool:acquire_session / heartbeat / release_session
//!
//! 配合 EditorMode + SessionRegistry + EventEmitter 工作。

use crate::mcp::editor_mode::{EditorMode, DEFAULT_TTL_MS};
use crate::mcp::event_emitter::{EventEmitter, SessionChange};
use crate::mcp::protocol::{RpcError, Tool};
use crate::mcp::session::SessionRegistry;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

/// 会话 tool 共享上下文
#[derive(Clone)]
pub struct SessionToolContext {
    pub editor: EditorMode,
    pub registry: SessionRegistry,
    pub emitter: Arc<dyn EventEmitter>,
}

impl SessionToolContext {
    pub fn new(
        editor: EditorMode,
        registry: SessionRegistry,
        emitter: Arc<dyn EventEmitter>,
    ) -> Self {
        Self {
            editor,
            registry,
            emitter,
        }
    }
}

// ============================================================
// acquire_session
// ============================================================

pub struct AcquireSessionTool {
    ctx: SessionToolContext,
}

impl AcquireSessionTool {
    pub fn new(ctx: SessionToolContext) -> Self {
        Self { ctx }
    }
}

impl Tool for AcquireSessionTool {
    fn name(&self) -> &str {
        "acquire_session"
    }
    fn description(&self) -> &str {
        "申请 LLM 写锁。必须在任何写 tool(create/update/delete/move_node)之前调用。返回 session_id + expires_at。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "client_name": {
                    "type": "string",
                    "description": "客户端名称(便于 UI 显示)"
                },
                "ttl_sec": {
                    "type": "integer",
                    "description": "TTL 秒数(默认 60,最大 300)",
                    "default": 60,
                    "minimum": 1,
                    "maximum": 300
                },
                "intent": {
                    "type": "string",
                    "description": "本次会话的目的(便于用户判断是否允许)"
                }
            },
            "required": ["client_name"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let client_name = args
            .get("client_name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'client_name'"))))?;
        let ttl_sec = args
            .get("ttl_sec")
            .and_then(|v| v.as_u64())
            .unwrap_or(60);
        let ttl_ms = ttl_sec.saturating_mul(1000);
        let intent = args
            .get("intent")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // 生成 session_id
        let session_id = Uuid::new_v4().to_string();

        // 尝试持锁
        self.ctx
            .editor
            .try_acquire_llm(&session_id, client_name, ttl_ms)?;

        // 注册到 registry
        let info = self.ctx.registry.register(&session_id, client_name, ttl_ms);

        // 通知前端(显示 banner)
        let _ = self.ctx.emitter.emit_session_changed(SessionChange {
            session: Some(info.clone()),
            reason: "acquired".to_string(),
        });

        Ok(json!({
            "session_id": session_id,
            "acquired_at_ms": info.acquired_at_ms,
            "expires_at_ms": info.expires_at_ms,
            "ttl_ms": ttl_ms,
            "intent": intent,
            "hint": "请在 ttl 内完成操作,可调 heartbeat 续约。用户可随时点接管按钮中断。"
        }))
    }
}

// ============================================================
// heartbeat
// ============================================================

pub struct HeartbeatTool {
    ctx: SessionToolContext,
}

impl HeartbeatTool {
    pub fn new(ctx: SessionToolContext) -> Self {
        Self { ctx }
    }
}

impl Tool for HeartbeatTool {
    fn name(&self) -> &str {
        "heartbeat"
    }
    fn description(&self) -> &str {
        "续约 LLM 会话 TTL。每次写 tool 调用会自动续约,不需要显式调 heartbeat。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "ttl_sec": {"type": "integer", "default": 60, "minimum": 1, "maximum": 300}
            },
            "required": ["session_id"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'session_id'"))))?;
        let ttl_sec = args.get("ttl_sec").and_then(|v| v.as_u64()).unwrap_or(60);
        let ttl_ms = ttl_sec.saturating_mul(1000);

        // EditorMode 心跳
        let new_expiry = self.ctx.editor.heartbeat(session_id, ttl_ms)?;

        // Registry 心跳
        let info = self
            .ctx
            .registry
            .heartbeat(session_id, ttl_ms)
            .ok_or_else(|| RpcError::mcp_error("session not in registry", None))?;

        Ok(json!({
            "session_id": session_id,
            "expires_at_ms": new_expiry,
            "last_heartbeat_ms": info.last_heartbeat_ms,
        }))
    }
}

// ============================================================
// release_session
// ============================================================

pub struct ReleaseSessionTool {
    ctx: SessionToolContext,
}

impl ReleaseSessionTool {
    pub fn new(ctx: SessionToolContext) -> Self {
        Self { ctx }
    }
}

impl Tool for ReleaseSessionTool {
    fn name(&self) -> &str {
        "release_session"
    }
    fn description(&self) -> &str {
        "LLM 主动释放会话。会话结束时应调用,让用户恢复编辑。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"}
            },
            "required": ["session_id"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'session_id'"))))?;

        // EditorMode 释放
        self.ctx.editor.release_llm(session_id)?;

        // Registry 移除
        let info = self.ctx.registry.remove(session_id);

        // 通知前端
        let _ = self.ctx.emitter.emit_session_changed(SessionChange {
            session: info,
            reason: "released".to_string(),
        });

        Ok(json!({
            "session_id": session_id,
            "released": true,
        }))
    }
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::event_emitter::MockEmitter;

    fn make_ctx() -> (SessionToolContext, Arc<MockEmitter>) {
        let editor = EditorMode::new();
        let registry = SessionRegistry::new();
        let emitter = Arc::new(MockEmitter::new());
        let ctx = SessionToolContext::new(editor, registry, emitter.clone());
        (ctx, emitter)
    }

    // --- acquire_session ---

    #[test]
    fn test_acquire_returns_session_id_and_expiry() {
        let (ctx, _) = make_ctx();
        let tool = AcquireSessionTool::new(ctx);
        let result = tool.call(json!({"client_name": "Claude"})).unwrap();
        assert!(result["session_id"].as_str().unwrap().len() > 0);
        assert!(result["expires_at_ms"].as_u64().unwrap() > 0);
        assert_eq!(result["ttl_ms"], (DEFAULT_TTL_MS as u64));
    }

    #[test]
    fn test_acquire_default_ttl_60s() {
        let (ctx, _) = make_ctx();
        let tool = AcquireSessionTool::new(ctx);
        let result = tool.call(json!({"client_name": "Claude"})).unwrap();
        // 默认 60s
        let ttl = result["ttl_ms"].as_u64().unwrap();
        assert_eq!(ttl, 60_000);
    }

    #[test]
    fn test_acquire_custom_ttl() {
        let (ctx, _) = make_ctx();
        let tool = AcquireSessionTool::new(ctx);
        let result = tool
            .call(json!({"client_name": "Claude", "ttl_sec": 120}))
            .unwrap();
        assert_eq!(result["ttl_ms"], 120_000);
    }

    #[test]
    fn test_acquire_missing_client_name() {
        let (ctx, _) = make_ctx();
        let tool = AcquireSessionTool::new(ctx);
        let err = tool.call(json!({})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_acquire_emits_session_changed() {
        let (ctx, emitter) = make_ctx();
        let tool = AcquireSessionTool::new(ctx);
        tool.call(json!({"client_name": "Claude"})).unwrap();
        let changes = emitter.session_changes_snapshot();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].reason, "acquired");
        assert!(changes[0].session.is_some());
    }

    #[test]
    fn test_acquire_second_fails_when_one_active() {
        let (ctx, _) = make_ctx();
        let tool = AcquireSessionTool::new(ctx.clone());
        tool.call(json!({"client_name": "Claude"})).unwrap();
        let err = tool.call(json!({"client_name": "Cursor"})).unwrap_err();
        assert_eq!(err.code, -32000);
        assert!(err.message.contains("held by another"));
    }

    // --- heartbeat ---

    #[test]
    fn test_heartbeat_extends_expiry() {
        let (ctx, _) = make_ctx();
        let acquire = AcquireSessionTool::new(ctx.clone());
        let result = acquire.call(json!({"client_name": "Claude", "ttl_sec": 30})).unwrap();
        let session_id = result["session_id"].as_str().unwrap();

        let hb = HeartbeatTool::new(ctx);
        let hb_result = hb
            .call(json!({"session_id": session_id, "ttl_sec": 60}))
            .unwrap();
        assert!(hb_result["expires_at_ms"].as_u64().unwrap() > 0);
    }

    #[test]
    fn test_heartbeat_unknown_session_fails() {
        let (ctx, _) = make_ctx();
        let hb = HeartbeatTool::new(ctx);
        let err = hb.call(json!({"session_id": "nonexistent"})).unwrap_err();
        assert_eq!(err.code, -32000);
    }

    #[test]
    fn test_heartbeat_missing_session_id() {
        let (ctx, _) = make_ctx();
        let hb = HeartbeatTool::new(ctx);
        let err = hb.call(json!({})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    // --- release_session ---

    #[test]
    fn test_release_lets_other_acquire() {
        let (ctx, _) = make_ctx();
        let acquire = AcquireSessionTool::new(ctx.clone());
        let release = ReleaseSessionTool::new(ctx.clone());

        let r1 = acquire.call(json!({"client_name": "Claude"})).unwrap();
        let sid = r1["session_id"].as_str().unwrap();
        release.call(json!({"session_id": sid})).unwrap();

        // 现在第二个能成功
        let r2 = acquire.call(json!({"client_name": "Cursor"})).unwrap();
        assert_ne!(
            r1["session_id"].as_str().unwrap(),
            r2["session_id"].as_str().unwrap()
        );
    }

    #[test]
    fn test_release_wrong_session_fails() {
        let (ctx, _) = make_ctx();
        let acquire = AcquireSessionTool::new(ctx.clone());
        let release = ReleaseSessionTool::new(ctx);

        acquire.call(json!({"client_name": "Claude"})).unwrap();
        let err = release.call(json!({"session_id": "wrong-id"})).unwrap_err();
        assert_eq!(err.code, -32000);
    }

    #[test]
    fn test_release_emits_session_changed() {
        let (ctx, emitter) = make_ctx();
        let acquire = AcquireSessionTool::new(ctx.clone());
        let release = ReleaseSessionTool::new(ctx);

        let r = acquire.call(json!({"client_name": "Claude"})).unwrap();
        let sid = r["session_id"].as_str().unwrap();
        release.call(json!({"session_id": sid})).unwrap();

        let changes = emitter.session_changes_snapshot();
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].reason, "acquired");
        assert_eq!(changes[1].reason, "released");
    }

    // --- 完整流程 ---

    #[test]
    fn test_full_session_lifecycle() {
        let (ctx, emitter) = make_ctx();
        let acquire = AcquireSessionTool::new(ctx.clone());
        let heartbeat = HeartbeatTool::new(ctx.clone());
        let release = ReleaseSessionTool::new(ctx);

        // 1. acquire
        let r1 = acquire.call(json!({"client_name": "Claude", "ttl_sec": 30})).unwrap();
        let sid = r1["session_id"].as_str().unwrap();

        // 2. heartbeat
        heartbeat.call(json!({"session_id": sid, "ttl_sec": 60})).unwrap();

        // 3. release
        release.call(json!({"session_id": sid})).unwrap();

        // emitter 应该收到 2 个 session_changed
        let changes = emitter.session_changes_snapshot();
        assert_eq!(changes.len(), 2);
    }

    #[test]
    fn test_all_session_tools_have_correct_names() {
        let (ctx, _) = make_ctx();
        let tools: Vec<Box<dyn Tool>> = vec![
            Box::new(AcquireSessionTool::new(ctx.clone())),
            Box::new(HeartbeatTool::new(ctx.clone())),
            Box::new(ReleaseSessionTool::new(ctx)),
        ];
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert_eq!(names, vec!["acquire_session", "heartbeat", "release_session"]);
    }
}
