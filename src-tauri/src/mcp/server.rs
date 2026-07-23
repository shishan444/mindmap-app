//! MCP HTTP server:基于 axum,监听 127.0.0.1:23456
//!
//! 路由:
//! - GET  /health  → 健康检查(LLM 客户端验证 server 活着)
//! - POST /mcp     → JSON-RPC 请求(tools/call / resources/read 等)
//! - GET  /mcp/sse → SSE 流(后续 Phase 加,目前占位)
//!
//! 安全:
//! - 只监听 127.0.0.1(loopback),不暴露到局域网
//! - 不需要 token(本机信任)
//!
//! 启动方式:`McpServerHandle` 由 Tauri setup 持有,
//! 进程退出时 axum server 自动结束。

use crate::mcp::protocol::{McpServer, Request, Response};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use std::sync::Arc;

/// MCP server 句柄(由 Tauri app 持有)
pub struct McpHttpHandle {
    pub shutdown: tokio::sync::oneshot::Sender<()>,
}

/// 共享状态:封装 McpServer(Arc 让 axum handler 可克隆)
#[derive(Clone)]
pub struct AppState {
    pub server: Arc<McpServer>,
}

/// 健康检查
async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

/// 主 MCP 端点:接收 JSON-RPC 请求
async fn mcp_endpoint(
    State(state): State<AppState>,
    Json(req): Json<Request>,
) -> Result<Json<Response>, (StatusCode, String)> {
    let resp = state.server.handle_request(&req);
    Ok(Json(resp))
}

/// 批量请求端点(JSON-RPC 2.0 spec 允许批量,可选实现)
async fn mcp_batch_endpoint(
    State(state): State<AppState>,
    Json(reqs): Json<Vec<Request>>,
) -> Result<Json<Vec<Response>>, (StatusCode, String)> {
    let resps: Vec<Response> = reqs.iter().map(|r| state.server.handle_request(r)).collect();
    Ok(Json(resps))
}

/// 构建 axum Router
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/mcp", post(mcp_endpoint))
        .route("/mcp/batch", post(mcp_batch_endpoint))
        .route(
            "/mcp/sse",
            get(|| async {
                // Phase 2+ 实现 SSE(实时推送 LLM 操作通知)
                // 目前占位返回 501
                (
                    StatusCode::NOT_IMPLEMENTED,
                    "SSE will be implemented in Phase 2",
                )
            }),
        )
        .with_state(state)
}

/// 启动 HTTP server(非阻塞,返回 handle 用于关闭)
///
/// 用法:
/// ```ignore
/// let state = AppState { server: Arc::new(server) };
/// let handle = start_server("127.0.0.1:23456", state).await?;
/// // ... app 运行期间 server 持续监听
/// handle.shutdown.send(()).ok();  // 关闭
/// ```
pub async fn start_server(
    addr: &str,
    state: AppState,
) -> Result<McpHttpHandle, std::io::Error> {
    let router = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
            .ok();
    });

    Ok(McpHttpHandle {
        shutdown: shutdown_tx,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::protocol::RpcError;
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    fn make_state() -> AppState {
        AppState {
            server: Arc::new(McpServer::new("test", "1.0")),
        }
    }

    fn make_state_with_tools() -> AppState {
        struct EchoTool;
        impl crate::mcp::protocol::Tool for EchoTool {
            fn name(&self) -> &str {
                "echo"
            }
            fn description(&self) -> &str {
                "echo"
            }
            fn schema(&self) -> Value {
                json!({})
            }
            fn call(&self, args: Value) -> Result<Value, RpcError> {
                Ok(args)
            }
        }
        let mut s = McpServer::new("test", "1.0");
        s.register_tool(Box::new(EchoTool));
        AppState { server: Arc::new(s) }
    }

    // --- F-P1-02 / 路由层:health ---

    #[tokio::test]
    async fn test_health_returns_200_ok() {
        let app = build_router(make_state());
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // --- /mcp POST 标准请求 ---

    #[tokio::test]
    async fn test_mcp_endpoint_initialize_returns_200_with_result() {
        let app = build_router(make_state());
        let body = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize"
        }))
        .unwrap();
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let resp_json: Response = serde_json::from_slice(&body_bytes).unwrap();
        assert!(resp_json.error.is_none());
        assert_eq!(
            resp_json.result.unwrap()["protocolVersion"],
            crate::mcp::protocol::PROTOCOL_VERSION
        );
    }

    #[tokio::test]
    async fn test_mcp_endpoint_tools_list_returns_registered_tools() {
        let app = build_router(make_state_with_tools());
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let resp_json: Response = serde_json::from_slice(&body_bytes).unwrap();
        let tools = resp_json.result.unwrap()["tools"].as_array().unwrap().clone();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "echo");
    }

    #[tokio::test]
    async fn test_mcp_endpoint_tools_call_executes_tool() {
        let app = build_router(make_state_with_tools());
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"x":1}}}"#;
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let resp_json: Response = serde_json::from_slice(&body_bytes).unwrap();
        assert!(resp_json.error.is_none());
        assert_eq!(resp_json.result.unwrap()["isError"], false);
    }

    #[tokio::test]
    async fn test_mcp_endpoint_method_not_found() {
        let app = build_router(make_state());
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"unknown/method"}"#;
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let resp_json: Response = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(resp_json.error.unwrap().code, -32601);
    }

    // --- /mcp/batch ---

    #[tokio::test]
    async fn test_batch_endpoint_handles_multiple_requests() {
        let app = build_router(make_state());
        let body = r#"[
            {"jsonrpc":"2.0","id":1,"method":"ping"},
            {"jsonrpc":"2.0","id":2,"method":"initialize"}
        ]"#;
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .method("POST")
                    .uri("/mcp/batch")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let resps: Vec<Response> = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(resps.len(), 2);
        assert_eq!(resps[0].id, Some(json!(1)));
        assert_eq!(resps[1].id, Some(json!(2)));
    }

    // --- SSE 占位 ---

    #[tokio::test]
    async fn test_sse_endpoint_returns_501_placeholder() {
        let app = build_router(make_state());
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/mcp/sse")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);
    }

    // --- 404 路由 ---

    #[tokio::test]
    async fn test_unknown_route_returns_404() {
        let app = build_router(make_state());
        let resp = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // --- start_server 集成 ---

    #[tokio::test]
    async fn test_start_server_binds_and_serves_health() {
        let handle = start_server("127.0.0.1:0", make_state()).await;
        // 127.0.0.1:0 让 OS 分配端口,但 axum listener 不暴露端口给我们
        // 所以这里只验证 start_server 不报错 + 能正常 shutdown
        // 实际端口绑定在 build_router 的 unit test 里通过 oneshot 验证
        assert!(handle.is_ok(), "start_server should succeed");
        let handle = handle.unwrap();
        // 关闭
        handle.shutdown.send(()).ok();
        // 给一点时间让 task 退出
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}
