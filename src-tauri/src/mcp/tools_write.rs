//! 写 tool:create_node / update_node / delete_node / move_node
//!
//! 设计:
//! - 每个 tool 进入前 require_llm_session guard check
//! - 通过 EventEmitter emit "llm-operation" event
//! - 前端 operationBridge listen event → 调 mind-elixir API(不调 store)
//! - 每次调用自动 heartbeat(刷新 TTL)
//! - registry.record_operation 计数

use crate::mcp::event_emitter::{gen_op_id, EventEmitter, LlmOperation};
use crate::mcp::protocol::{RpcError, Tool};
use crate::mcp::tools_session::SessionToolContext;
use serde_json::{json, Value};

/// 写 tool 共享上下文(扩展 SessionToolContext)
#[derive(Clone)]
pub struct WriteToolContext {
    pub session: SessionToolContext,
}

impl WriteToolContext {
    pub fn new(session: SessionToolContext) -> Self {
        Self { session }
    }

    /// 通用前置检查 + 自动 heartbeat + emit + 记录操作
    fn execute_op(
        &self,
        session_id: &str,
        op_type: &str,
        payload: Value,
    ) -> Result<Value, RpcError> {
        // 1. 持锁检查
        self.session.editor.require_llm_session(session_id)?;

        // 2. 自动 heartbeat(每次操作刷新 TTL)
        let ttl_ms = self
            .session
            .registry
            .get(session_id)
            .map(|s| (s.expires_at_ms - s.last_heartbeat_ms).max(0) as u64)
            .unwrap_or(60000);
        let _ = self.session.editor.heartbeat(session_id, ttl_ms);
        let _ = self.session.registry.heartbeat(session_id, ttl_ms);

        // 3. 生成 op_id + emit
        let op = LlmOperation {
            op_id: gen_op_id(),
            session_id: session_id.to_string(),
            op_type: op_type.to_string(),
            payload,
            is_first_in_session: false,
            is_last_in_session: false,
        };
        let op_id = op.op_id.clone();
        self.session.emitter.emit_llm_operation(op)?;

        // 4. 记录操作
        self.session.registry.record_operation(session_id);

        Ok(json!({
            "op_id": op_id,
            "op_type": op_type,
            "queued": true,
            "hint": "已通过 event 发送给前端 operationBridge,稍后 mind-elixir 会刷新画布"
        }))
    }
}

// ============================================================
// create_node
// ============================================================

pub struct CreateNodeTool {
    ctx: WriteToolContext,
}

impl CreateNodeTool {
    pub fn new(ctx: WriteToolContext) -> Self {
        Self { ctx }
    }
}

impl Tool for CreateNodeTool {
    fn name(&self) -> &str {
        "create_node"
    }
    fn description(&self) -> &str {
        "在指定父节点下创建子节点。必须先 acquire_session。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "parent_id": {"type": "string", "description": "父节点 id"},
                "topic": {"type": "string", "description": "节点标题"},
                "priority": {"type": "string", "enum": ["P0", "P1", "P2", "P3"]},
                "icons": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["session_id", "parent_id", "topic"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'session_id'"))))?;
        let parent_id = args
            .get("parent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'parent_id'"))))?;
        let topic = args
            .get("topic")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'topic'"))))?;

        let mut payload = json!({
            "parent_id": parent_id,
            "topic": topic,
        });
        if let Some(p) = args.get("priority") {
            payload["priority"] = p.clone();
        }
        if let Some(i) = args.get("icons") {
            payload["icons"] = i.clone();
        }

        self.ctx.execute_op(session_id, "create_node", payload)
    }
}

// ============================================================
// update_node
// ============================================================

pub struct UpdateNodeTool {
    ctx: WriteToolContext,
}

impl UpdateNodeTool {
    pub fn new(ctx: WriteToolContext) -> Self {
        Self { ctx }
    }
}

impl Tool for UpdateNodeTool {
    fn name(&self) -> &str {
        "update_node"
    }
    fn description(&self) -> &str {
        "更新节点字段(topic/priority/icons/style/attached_file 等)。必须先 acquire_session。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "node_id": {"type": "string"},
                "patch": {
                    "type": "object",
                    "description": "要更新的字段(部分更新,不传的字段不动)",
                    "properties": {
                        "topic": {"type": "string"},
                        "priority": {"type": ["string", "null"]},
                        "icons": {"type": "array", "items": {"type": "string"}}
                    }
                }
            },
            "required": ["session_id", "node_id", "patch"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'session_id'"))))?;
        let node_id = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'node_id'"))))?;
        let patch = args
            .get("patch")
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'patch'"))))?;

        self.ctx.execute_op(
            session_id,
            "update_node",
            json!({"node_id": node_id, "patch": patch}),
        )
    }
}

// ============================================================
// delete_node
// ============================================================

pub struct DeleteNodeTool {
    ctx: WriteToolContext,
}

impl DeleteNodeTool {
    pub fn new(ctx: WriteToolContext) -> Self {
        Self { ctx }
    }
}

impl Tool for DeleteNodeTool {
    fn name(&self) -> &str {
        "delete_node"
    }
    fn description(&self) -> &str {
        "删除节点(及其所有子节点)。不可删除 root。必须先 acquire_session。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "node_id": {"type": "string"}
            },
            "required": ["session_id", "node_id"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'session_id'"))))?;
        let node_id = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'node_id'"))))?;

        self.ctx
            .execute_op(session_id, "delete_node", json!({"node_id": node_id}))
    }
}

// ============================================================
// move_node
// ============================================================

pub struct MoveNodeTool {
    ctx: WriteToolContext,
}

impl MoveNodeTool {
    pub fn new(ctx: WriteToolContext) -> Self {
        Self { ctx }
    }
}

impl Tool for MoveNodeTool {
    fn name(&self) -> &str {
        "move_node"
    }
    fn description(&self) -> &str {
        "把节点移动到新父节点下。必须先 acquire_session。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "node_id": {"type": "string"},
                "to_parent_id": {"type": "string"}
            },
            "required": ["session_id", "node_id", "to_parent_id"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'session_id'"))))?;
        let node_id = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'node_id'"))))?;
        let to_parent_id = args
            .get("to_parent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'to_parent_id'"))))?;

        self.ctx.execute_op(
            session_id,
            "move_node",
            json!({"node_id": node_id, "to_parent_id": to_parent_id}),
        )
    }
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::editor_mode::EditorMode;
    use crate::mcp::event_emitter::MockEmitter;
    use crate::mcp::session::SessionRegistry;
    use crate::mcp::tools_session::{AcquireSessionTool, SessionToolContext};
    use std::sync::Arc;

    fn make_ctx() -> (WriteToolContext, Arc<MockEmitter>, String) {
        let editor = EditorMode::new();
        let registry = SessionRegistry::new();
        let emitter = Arc::new(MockEmitter::new());
        let session_ctx = SessionToolContext::new(editor, registry, emitter.clone());

        // 自动 acquire 一个 session
        let acquire = AcquireSessionTool::new(session_ctx.clone());
        let r = acquire
            .call(json!({"client_name": "test"}))
            .unwrap();
        let session_id = r["session_id"].as_str().unwrap().to_string();

        let ctx = WriteToolContext::new(session_ctx);
        (ctx, emitter, session_id)
    }

    // --- create_node ---

    #[test]
    fn test_create_node_emits_operation() {
        let (ctx, emitter, sid) = make_ctx();
        let tool = CreateNodeTool::new(ctx);
        let result = tool
            .call(json!({
                "session_id": sid,
                "parent_id": "root",
                "topic": "新节点"
            }))
            .unwrap();
        assert_eq!(result["op_type"], "create_node");
        assert!(result["queued"].as_bool().unwrap());

        let ops = emitter.operations_snapshot();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op_type, "create_node");
        assert_eq!(ops[0].payload["parent_id"], "root");
        assert_eq!(ops[0].payload["topic"], "新节点");
    }

    #[test]
    fn test_create_node_with_priority_and_icons() {
        let (ctx, emitter, sid) = make_ctx();
        let tool = CreateNodeTool::new(ctx);
        tool.call(json!({
            "session_id": sid,
            "parent_id": "root",
            "topic": "重要节点",
            "priority": "P0",
            "icons": ["🔥"]
        }))
        .unwrap();
        let ops = emitter.operations_snapshot();
        assert_eq!(ops[0].payload["priority"], "P0");
        assert_eq!(ops[0].payload["icons"][0], "🔥");
    }

    #[test]
    fn test_create_node_missing_session_id() {
        let (ctx, _, _) = make_ctx();
        let tool = CreateNodeTool::new(ctx);
        let err = tool
            .call(json!({"parent_id": "root", "topic": "x"}))
            .unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_create_node_missing_parent_id() {
        let (ctx, _, sid) = make_ctx();
        let tool = CreateNodeTool::new(ctx);
        let err = tool
            .call(json!({"session_id": sid, "topic": "x"}))
            .unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_create_node_without_session_fails_guard() {
        let (ctx, _, _) = make_ctx();
        let tool = CreateNodeTool::new(ctx);
        // 用一个无效的 session_id
        let err = tool
            .call(json!({
                "session_id": "invalid",
                "parent_id": "root",
                "topic": "x"
            }))
            .unwrap_err();
        assert_eq!(err.code, -32000);
        assert!(err.message.contains("no active LLM session") || err.message.contains("different"));
    }

    // --- update_node ---

    #[test]
    fn test_update_node_emits_patch() {
        let (ctx, emitter, sid) = make_ctx();
        let tool = UpdateNodeTool::new(ctx);
        tool.call(json!({
            "session_id": sid,
            "node_id": "n1",
            "patch": {"topic": "改后", "priority": "P1"}
        }))
        .unwrap();
        let ops = emitter.operations_snapshot();
        assert_eq!(ops[0].payload["patch"]["topic"], "改后");
        assert_eq!(ops[0].payload["patch"]["priority"], "P1");
    }

    #[test]
    fn test_update_node_missing_patch() {
        let (ctx, _, sid) = make_ctx();
        let tool = UpdateNodeTool::new(ctx);
        let err = tool
            .call(json!({"session_id": sid, "node_id": "n1"}))
            .unwrap_err();
        assert_eq!(err.code, -32602);
    }

    // --- delete_node ---

    #[test]
    fn test_delete_node_emits() {
        let (ctx, emitter, sid) = make_ctx();
        let tool = DeleteNodeTool::new(ctx);
        tool.call(json!({"session_id": sid, "node_id": "n1"})).unwrap();
        let ops = emitter.operations_snapshot();
        assert_eq!(ops[0].op_type, "delete_node");
        assert_eq!(ops[0].payload["node_id"], "n1");
    }

    #[test]
    fn test_delete_node_missing_node_id() {
        let (ctx, _, sid) = make_ctx();
        let tool = DeleteNodeTool::new(ctx);
        let err = tool.call(json!({"session_id": sid})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    // --- move_node ---

    #[test]
    fn test_move_node_emits() {
        let (ctx, emitter, sid) = make_ctx();
        let tool = MoveNodeTool::new(ctx);
        tool.call(json!({
            "session_id": sid,
            "node_id": "n1",
            "to_parent_id": "n2"
        }))
        .unwrap();
        let ops = emitter.operations_snapshot();
        assert_eq!(ops[0].op_type, "move_node");
        assert_eq!(ops[0].payload["to_parent_id"], "n2");
    }

    #[test]
    fn test_move_node_missing_to_parent() {
        let (ctx, _, sid) = make_ctx();
        let tool = MoveNodeTool::new(ctx);
        let err = tool
            .call(json!({"session_id": sid, "node_id": "n1"}))
            .unwrap_err();
        assert_eq!(err.code, -32602);
    }

    // --- 自动 heartbeat + 操作计数 ---

    #[test]
    fn test_op_increments_count() {
        let (ctx, _, sid) = make_ctx();
        let tool = CreateNodeTool::new(ctx.clone());
        tool.call(json!({"session_id": sid, "parent_id": "r", "topic": "1"})).unwrap();
        tool.call(json!({"session_id": sid, "parent_id": "r", "topic": "2"})).unwrap();

        let info = ctx.session.registry.get(&sid).unwrap();
        assert_eq!(info.operations_count, 2);
    }

    #[test]
    fn test_op_auto_heartbeats() {
        let (ctx, _, sid) = make_ctx();
        let before = ctx.session.registry.get(&sid).unwrap().last_heartbeat_ms;
        std::thread::sleep(std::time::Duration::from_millis(10));
        let tool = CreateNodeTool::new(ctx.clone());
        tool.call(json!({"session_id": sid, "parent_id": "r", "topic": "x"})).unwrap();
        let after = ctx.session.registry.get(&sid).unwrap().last_heartbeat_ms;
        assert!(after > before, "操作应自动 heartbeat");
    }

    // --- 多次 op ---

    #[test]
    fn test_multiple_ops_in_sequence() {
        let (ctx, emitter, sid) = make_ctx();
        let create = CreateNodeTool::new(ctx.clone());
        let update = UpdateNodeTool::new(ctx.clone());
        let del = DeleteNodeTool::new(ctx);

        create.call(json!({"session_id": &sid, "parent_id": "r", "topic": "1"})).unwrap();
        update.call(json!({"session_id": &sid, "node_id": "n1", "patch": {"topic": "改"}})).unwrap();
        del.call(json!({"session_id": &sid, "node_id": "n1"})).unwrap();

        let ops = emitter.operations_snapshot();
        assert_eq!(ops.len(), 3);
        assert_eq!(ops[0].op_type, "create_node");
        assert_eq!(ops[1].op_type, "update_node");
        assert_eq!(ops[2].op_type, "delete_node");
    }

    #[test]
    fn test_all_write_tools_have_correct_names() {
        let (ctx, _, _) = make_ctx();
        let tools: Vec<Box<dyn Tool>> = vec![
            Box::new(CreateNodeTool::new(ctx.clone())),
            Box::new(UpdateNodeTool::new(ctx.clone())),
            Box::new(DeleteNodeTool::new(ctx.clone())),
            Box::new(MoveNodeTool::new(ctx)),
        ];
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert_eq!(names, vec!["create_node", "update_node", "delete_node", "move_node"]);
    }
}
