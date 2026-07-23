//! MCP(Model Context Protocol)server 模块
//!
//! 模块结构:
//! - `protocol`:JSON-RPC 2.0 + MCP 标准方法(pure logic,无 IO 依赖)
//! - `server`:axum HTTP server 启动(Phase 1 T2)
//! - `editor_mode`:EditorMode Mutex + Rust guard(Phase 2 T1)
//! - `session`:SessionRegistry + TTL(Phase 2 T2)
//! - `tools`:具体 tool 实现(Phase 1 T3 / Phase 2 T3)
//!
//! 设计原则:协议层是 pure function(Request → Response),
//! IO 和 Tauri 集成在更上层做,方便单元测试。

pub mod protocol;
pub mod server;
pub mod data_source;
pub mod tools_readonly;
pub mod tauri_source;
pub mod editor_mode;
pub mod session;

pub use protocol::{
    McpServer, Prompt, PromptArg, Request, Resource, RpcError, Response, Tool,
};
pub use server::{start_server, AppState, McpHttpHandle};
pub use data_source::{EditState, LlmSessionInfo, MindmapDataSource};
pub use tools_readonly::{
    ExportMindmapTool, GetEditStateTool, GetNodeTool, ListRemindersTool, ReadMindmapTool,
    SearchNodesTool,
};
pub use tauri_source::{shared_mirror, McpStateMirror};
pub use editor_mode::{Editor, EditorMode, DEFAULT_TTL_MS, MAX_TTL_MS};
pub use session::{run_ttl_loop, SessionInfo, SessionRegistry};
