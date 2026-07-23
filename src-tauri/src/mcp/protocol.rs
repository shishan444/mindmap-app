//! JSON-RPC 2.0 + MCP 标准方法实现
//!
//! 规范来源:
//! - JSON-RPC 2.0:https://www.jsonrpc.org/specification
//! - MCP:https://spec.modelcontextprotocol.io/specification/2024-11-05/
//!
//! 设计原则:**pure logic,无 IO 依赖**。Request 进来,Response 出去,
//! 中间没有任何文件/网络/Tauri 调用。所有副作用在调用方做。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;

// === JSON-RPC 2.0 核心类型 ===

/// JSON-RPC 请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    /// 必须是 "2.0"
    pub jsonrpc: String,
    /// 请求 id(notification 时为 None)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    /// 方法名
    pub method: String,
    /// 参数(可选)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

/// JSON-RPC 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Response {
    pub fn success(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Option<Value>, err: RpcError) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(err),
        }
    }
}

/// JSON-RPC 错误对象
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    /// -32700 Parse error
    pub fn parse_error() -> Self {
        Self {
            code: -32700,
            message: "Parse error".to_string(),
            data: None,
        }
    }

    /// -32600 Invalid Request
    pub fn invalid_request() -> Self {
        Self {
            code: -32600,
            message: "Invalid Request".to_string(),
            data: None,
        }
    }

    /// -32601 Method not found
    pub fn method_not_found() -> Self {
        Self {
            code: -32601,
            message: "Method not found".to_string(),
            data: None,
        }
    }

    /// -32602 Invalid params
    pub fn invalid_params(data: Option<Value>) -> Self {
        Self {
            code: -32602,
            message: "Invalid params".to_string(),
            data,
        }
    }

    /// -32603 Internal error
    pub fn internal_error(data: Option<Value>) -> Self {
        Self {
            code: -32603,
            message: "Internal error".to_string(),
            data,
        }
    }

    /// -32000 MCP 通用错误(server 自定义)
    pub fn mcp_error(message: &str, data: Option<Value>) -> Self {
        Self {
            code: -32000,
            message: message.to_string(),
            data,
        }
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

// === MCP capability traits(调用方注册具体实现)===

/// MCP Tool(可被 LLM 调用的函数)
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    /// JSON Schema 描述参数
    fn schema(&self) -> Value;
    /// 执行 tool,返回 serde_json::Value
    fn call(&self, args: Value) -> Result<Value, RpcError>;
}

/// MCP Resource(可被 LLM 读取的资源)
pub trait Resource: Send + Sync {
    fn uri(&self) -> &str;
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn mime_type(&self) -> &str;
    fn read(&self) -> Result<Value, RpcError>;
}

/// MCP Prompt(可被 LLM 调用的模板)
pub trait Prompt: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn arguments(&self) -> Vec<PromptArg>;
    fn render(&self, args: Value) -> Result<Value, RpcError>;
}

pub struct PromptArg {
    pub name: String,
    pub description: String,
    pub required: bool,
}

// === MCP Server ===

/// MCP 协议版本(本实现遵循的 spec)
pub const PROTOCOL_VERSION: &str = "2024-11-05";

pub struct McpServer {
    server_name: String,
    server_version: String,
    tools: Vec<Box<dyn Tool>>,
    resources: Vec<Box<dyn Resource>>,
    prompts: Vec<Box<dyn Prompt>>,
    initialized: Mutex<bool>,
}

impl McpServer {
    pub fn new(server_name: &str, server_version: &str) -> Self {
        Self {
            server_name: server_name.to_string(),
            server_version: server_version.to_string(),
            tools: vec![],
            resources: vec![],
            prompts: vec![],
            initialized: Mutex::new(false),
        }
    }

    pub fn register_tool(&mut self, tool: Box<dyn Tool>) {
        self.tools.push(tool);
    }

    pub fn register_resource(&mut self, resource: Box<dyn Resource>) {
        self.resources.push(resource);
    }

    pub fn register_prompt(&mut self, prompt: Box<dyn Prompt>) {
        self.prompts.push(prompt);
    }

    pub fn is_initialized(&self) -> bool {
        *self.initialized.lock().unwrap()
    }

    /// 主入口:处理一个 JSON-RPC 请求
    pub fn handle_request(&self, req: &Request) -> Response {
        // 校验 jsonrpc 版本
        if req.jsonrpc != "2.0" {
            return Response::error(req.id.clone(), RpcError::invalid_request());
        }

        match req.method.as_str() {
            // Lifecycle
            "initialize" => self.handle_initialize(req.id.clone()),
            "notifications/initialized" => self.handle_initialized_notification(),

            // Tools
            "tools/list" => self.handle_tools_list(req.id.clone()),
            "tools/call" => self.handle_tools_call(req.id.clone(), req.params.clone()),

            // Resources
            "resources/list" => self.handle_resources_list(req.id.clone()),
            "resources/read" => self.handle_resources_read(req.id.clone(), req.params.clone()),

            // Prompts
            "prompts/list" => self.handle_prompts_list(req.id.clone()),
            "prompts/get" => self.handle_prompts_get(req.id.clone(), req.params.clone()),

            // Ping
            "ping" => Response::success(req.id.clone(), json!({})),

            _ => Response::error(req.id.clone(), RpcError::method_not_found()),
        }
    }

    fn handle_initialize(&self, id: Option<Value>) -> Response {
        Response::success(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {"listChanged": false},
                    "resources": {"listChanged": false, "subscribe": false},
                    "prompts": {"listChanged": false},
                },
                "serverInfo": {
                    "name": self.server_name,
                    "version": self.server_version,
                },
            }),
        )
    }

    fn handle_initialized_notification(&self) -> Response {
        let mut init = self.initialized.lock().unwrap();
        *init = true;
        // notifications 不返回响应(按 JSON-RPC 规范)
        // 但因为我们的 API 要求返回 Response,返回一个标记为 notification 的特殊响应
        Response::success(None, json!({"_handled_notification": "notifications/initialized"}))
    }

    fn handle_tools_list(&self, id: Option<Value>) -> Response {
        let tools: Vec<Value> = self
            .tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name(),
                    "description": t.description(),
                    "inputSchema": t.schema(),
                })
            })
            .collect();
        Response::success(id, json!({"tools": tools}))
    }

    fn handle_tools_call(&self, id: Option<Value>, params: Option<Value>) -> Response {
        let params = match params {
            Some(p) => p,
            None => {
                return Response::error(
                    id,
                    RpcError::invalid_params(Some(json!("missing params"))),
                )
            }
        };

        let name = match params.get("name").and_then(|v| v.as_str()) {
            Some(n) => n.to_string(),
            None => {
                return Response::error(
                    id,
                    RpcError::invalid_params(Some(json!("missing 'name' field"))),
                )
            }
        };

        let args = params.get("arguments").cloned().unwrap_or(json!({}));

        let tool = self.tools.iter().find(|t| t.name() == name);
        match tool {
            Some(t) => match t.call(args) {
                Ok(result) => {
                    // MCP tools/call 成功响应格式:
                    // content: [{type: "text", text: ...}], isError: false
                    let text = serde_json::to_string_pretty(&result).unwrap_or_default();
                    Response::success(
                        id,
                        json!({
                            "content": [{"type": "text", "text": text}],
                            "isError": false,
                        }),
                    )
                }
                Err(e) => {
                    // tool 执行失败:not a JSON-RPC error,而是 tool-level error
                    Response::success(
                        id,
                        json!({
                            "content": [{"type": "text", "text": format!("Error: {}", e.message)}],
                            "isError": true,
                        }),
                    )
                }
            },
            None => Response::error(
                id,
                RpcError::invalid_params(Some(json!(format!(
                    "tool '{}' not found",
                    name
                )))),
            ),
        }
    }

    fn handle_resources_list(&self, id: Option<Value>) -> Response {
        let resources: Vec<Value> = self
            .resources
            .iter()
            .map(|r| {
                json!({
                    "uri": r.uri(),
                    "name": r.name(),
                    "description": r.description(),
                    "mimeType": r.mime_type(),
                })
            })
            .collect();
        Response::success(id, json!({"resources": resources}))
    }

    fn handle_resources_read(&self, id: Option<Value>, params: Option<Value>) -> Response {
        let params = match params {
            Some(p) => p,
            None => {
                return Response::error(
                    id,
                    RpcError::invalid_params(Some(json!("missing params"))),
                )
            }
        };

        let uri = match params.get("uri").and_then(|v| v.as_str()) {
            Some(u) => u.to_string(),
            None => {
                return Response::error(
                    id,
                    RpcError::invalid_params(Some(json!("missing 'uri' field"))),
                )
            }
        };

        let resource = self.resources.iter().find(|r| r.uri() == uri);
        match resource {
            Some(r) => match r.read() {
                Ok(content) => {
                    let text = serde_json::to_string_pretty(&content).unwrap_or_default();
                    Response::success(
                        id,
                        json!({
                            "contents": [{
                                "uri": r.uri(),
                                "mimeType": r.mime_type(),
                                "text": text,
                            }],
                        }),
                    )
                }
                Err(e) => Response::error(id, e),
            },
            None => Response::error(
                id,
                RpcError::invalid_params(Some(json!(format!(
                    "resource '{}' not found",
                    uri
                )))),
            ),
        }
    }

    fn handle_prompts_list(&self, id: Option<Value>) -> Response {
        let prompts: Vec<Value> = self
            .prompts
            .iter()
            .map(|p| {
                let args: Vec<Value> = p
                    .arguments()
                    .iter()
                    .map(|a| {
                        json!({
                            "name": a.name,
                            "description": a.description,
                            "required": a.required,
                        })
                    })
                    .collect();
                json!({
                    "name": p.name(),
                    "description": p.description(),
                    "arguments": args,
                })
            })
            .collect();
        Response::success(id, json!({"prompts": prompts}))
    }

    fn handle_prompts_get(&self, id: Option<Value>, params: Option<Value>) -> Response {
        let params = match params {
            Some(p) => p,
            None => {
                return Response::error(
                    id,
                    RpcError::invalid_params(Some(json!("missing params"))),
                )
            }
        };

        let name = match params.get("name").and_then(|v| v.as_str()) {
            Some(n) => n.to_string(),
            None => {
                return Response::error(
                    id,
                    RpcError::invalid_params(Some(json!("missing 'name' field"))),
                )
            }
        };

        let args = params.get("arguments").cloned().unwrap_or(json!({}));

        let prompt = self.prompts.iter().find(|p| p.name() == name);
        match prompt {
            Some(p) => match p.render(args) {
                Ok(rendered) => {
                    // rendered 应该是 {messages: [{role, content: {type: "text", text}}]}
                    Response::success(id, json!({"messages": rendered}))
                }
                Err(e) => Response::error(id, e),
            },
            None => Response::error(
                id,
                RpcError::invalid_params(Some(json!(format!(
                    "prompt '{}' not found",
                    name
                )))),
            ),
        }
    }
}

// === 单元测试 ===

#[cfg(test)]
mod tests {
    use super::*;

    // --- 测试夹具:mock tool / resource / prompt ---

    struct EchoTool;

    impl Tool for EchoTool {
        fn name(&self) -> &str {
            "echo"
        }
        fn description(&self) -> &str {
            "Echo back the input message"
        }
        fn schema(&self) -> Value {
            json!({
                "type": "object",
                "properties": {
                    "msg": {"type": "string"}
                },
                "required": ["msg"]
            })
        }
        fn call(&self, args: Value) -> Result<Value, RpcError> {
            let msg = args
                .get("msg")
                .and_then(|v| v.as_str())
                .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'msg'"))))?;
            Ok(json!({"echoed": msg}))
        }
    }

    struct FailingTool;

    impl Tool for FailingTool {
        fn name(&self) -> &str {
            "fail"
        }
        fn description(&self) -> &str {
            "Always fails"
        }
        fn schema(&self) -> Value {
            json!({"type": "object", "properties": {}})
        }
        fn call(&self, _args: Value) -> Result<Value, RpcError> {
            Err(RpcError::mcp_error("intentional failure", None))
        }
    }

    struct StaticResource;

    impl Resource for StaticResource {
        fn uri(&self) -> &str {
            "test://static"
        }
        fn name(&self) -> &str {
            "Static"
        }
        fn description(&self) -> &str {
            "A static test resource"
        }
        fn mime_type(&self) -> &str {
            "application/json"
        }
        fn read(&self) -> Result<Value, RpcError> {
            Ok(json!({"hello": "world"}))
        }
    }

    struct HelloPrompt;

    impl Prompt for HelloPrompt {
        fn name(&self) -> &str {
            "hello"
        }
        fn description(&self) -> &str {
            "Say hello to someone"
        }
        fn arguments(&self) -> Vec<PromptArg> {
            vec![PromptArg {
                name: "name".to_string(),
                description: "Person to greet".to_string(),
                required: true,
            }]
        }
        fn render(&self, args: Value) -> Result<Value, RpcError> {
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'name'"))))?;
            Ok(json!([{
                "role": "user",
                "content": {"type": "text", "text": format!("Hello, {}!", name)}
            }]))
        }
    }

    fn make_server() -> McpServer {
        let mut s = McpServer::new("test-server", "1.0.0");
        s.register_tool(Box::new(EchoTool));
        s.register_tool(Box::new(FailingTool));
        s.register_resource(Box::new(StaticResource));
        s.register_prompt(Box::new(HelloPrompt));
        s
    }

    fn req(method: &str, params: Option<Value>) -> Request {
        Request {
            jsonrpc: "2.0".to_string(),
            id: Some(json!(1)),
            method: method.to_string(),
            params,
        }
    }

    fn req_with_id(id: Option<Value>, method: &str, params: Option<Value>) -> Request {
        Request {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        }
    }

    // --- F-P1-01: initialize ---

    #[test]
    fn test_initialize_returns_protocol_version_and_capabilities() {
        let server = make_server();
        let resp = server.handle_request(&req("initialize", None));
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(result["serverInfo"]["name"], "test-server");
        assert_eq!(result["serverInfo"]["version"], "1.0.0");
        assert!(result["capabilities"]["tools"].is_object());
        assert!(result["capabilities"]["resources"].is_object());
        assert!(result["capabilities"]["prompts"].is_object());
    }

    #[test]
    fn test_initialize_preserves_request_id() {
        let server = make_server();
        let resp =
            server.handle_request(&req_with_id(Some(json!("abc-123")), "initialize", None));
        assert_eq!(resp.id, Some(json!("abc-123")));
    }

    #[test]
    fn test_initialized_notification_sets_flag() {
        let server = make_server();
        assert!(!server.is_initialized());
        let _ = server.handle_request(&req_with_id(None, "notifications/initialized", None));
        assert!(server.is_initialized());
    }

    // --- F-P1-02: tools/list ---

    #[test]
    fn test_tools_list_returns_all_registered_tools() {
        let server = make_server();
        let resp = server.handle_request(&req("tools/list", None));
        let tools = resp.result.unwrap()["tools"].as_array().unwrap().clone();
        assert_eq!(tools.len(), 2);
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"echo"));
        assert!(names.contains(&"fail"));
    }

    #[test]
    fn test_tools_list_includes_schema_and_description() {
        let server = make_server();
        let resp = server.handle_request(&req("tools/list", None));
        let result = resp.result.unwrap();
        let tools = result["tools"].as_array().unwrap();
        let echo = tools.iter().find(|t| t["name"] == "echo").unwrap();
        assert_eq!(echo["description"], "Echo back the input message");
        assert!(echo["inputSchema"]["properties"]["msg"].is_object());
    }

    #[test]
    fn test_tools_list_empty_when_no_tools_registered() {
        let server = McpServer::new("empty", "1.0");
        let resp = server.handle_request(&req("tools/list", None));
        assert_eq!(resp.result.unwrap()["tools"].as_array().unwrap().len(), 0);
    }

    // --- F-P1-03: tools/call ---

    #[test]
    fn test_tools_call_executes_tool_and_returns_content() {
        let server = make_server();
        let resp = server.handle_request(&req(
            "tools/call",
            Some(json!({"name": "echo", "arguments": {"msg": "hi"}})),
        ));
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["isError"], false);
        assert_eq!(result["content"][0]["type"], "text");
        // text 是 JSON 序列化的 tool 返回值
        let text = result["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("echoed"));
        assert!(text.contains("hi"));
    }

    #[test]
    fn test_tools_call_tool_failure_returns_is_error_true() {
        let server = make_server();
        let resp = server.handle_request(&req("tools/call", Some(json!({"name": "fail"}))));
        let result = resp.result.unwrap();
        assert_eq!(result["isError"], true);
        assert!(result["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("intentional failure"));
    }

    #[test]
    fn test_tools_call_unknown_tool_returns_invalid_params() {
        let server = make_server();
        let resp = server.handle_request(&req(
            "tools/call",
            Some(json!({"name": "nonexistent"})),
        ));
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32602);
        assert!(err.message.contains("Invalid params"));
    }

    #[test]
    fn test_tools_call_missing_name_returns_invalid_params() {
        let server = make_server();
        let resp = server.handle_request(&req("tools/call", Some(json!({}))));
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_tools_call_missing_params_returns_invalid_params() {
        let server = make_server();
        let resp = server.handle_request(&req("tools/call", None));
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32602);
    }

    // --- F-P1-04: resources/list ---

    #[test]
    fn test_resources_list_returns_all_resources() {
        let server = make_server();
        let resp = server.handle_request(&req("resources/list", None));
        let resources = resp.result.unwrap()["resources"].as_array().unwrap().clone();
        assert_eq!(resources.len(), 1);
        assert_eq!(resources[0]["uri"], "test://static");
        assert_eq!(resources[0]["mimeType"], "application/json");
    }

    #[test]
    fn test_resources_list_empty_when_none_registered() {
        let server = McpServer::new("empty", "1.0");
        let resp = server.handle_request(&req("resources/list", None));
        assert_eq!(resp.result.unwrap()["resources"].as_array().unwrap().len(), 0);
    }

    // --- F-P1-05: resources/read ---

    #[test]
    fn test_resources_read_returns_content() {
        let server = make_server();
        let resp = server.handle_request(&req(
            "resources/read",
            Some(json!({"uri": "test://static"})),
        ));
        let result = resp.result.unwrap();
        let contents = result["contents"].as_array().unwrap();
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0]["uri"], "test://static");
        assert_eq!(contents[0]["mimeType"], "application/json");
        assert!(contents[0]["text"].as_str().unwrap().contains("hello"));
    }

    #[test]
    fn test_resources_read_unknown_uri_returns_invalid_params() {
        let server = make_server();
        let resp = server.handle_request(&req(
            "resources/read",
            Some(json!({"uri": "test://nonexistent"})),
        ));
        assert_eq!(resp.error.unwrap().code, -32602);
    }

    #[test]
    fn test_resources_read_missing_uri_returns_invalid_params() {
        let server = make_server();
        let resp = server.handle_request(&req("resources/read", Some(json!({}))));
        assert_eq!(resp.error.unwrap().code, -32602);
    }

    // --- prompts/list & prompts/get ---

    #[test]
    fn test_prompts_list_returns_all_prompts_with_args() {
        let server = make_server();
        let resp = server.handle_request(&req("prompts/list", None));
        let prompts = resp.result.unwrap()["prompts"].as_array().unwrap().clone();
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0]["name"], "hello");
        let args = prompts[0]["arguments"].as_array().unwrap();
        assert_eq!(args[0]["name"], "name");
        assert_eq!(args[0]["required"], true);
    }

    #[test]
    fn test_prompts_get_renders_prompt_with_args() {
        let server = make_server();
        let resp = server.handle_request(&req(
            "prompts/get",
            Some(json!({"name": "hello", "arguments": {"name": "Alice"}})),
        ));
        let result = resp.result.unwrap();
        let messages = result["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "user");
        assert!(messages[0]["content"]["text"]
            .as_str()
            .unwrap()
            .contains("Hello, Alice!"));
    }

    #[test]
    fn test_prompts_get_unknown_prompt_returns_error() {
        let server = make_server();
        let resp = server.handle_request(&req(
            "prompts/get",
            Some(json!({"name": "nonexistent"})),
        ));
        assert_eq!(resp.error.unwrap().code, -32602);
    }

    // --- ping / method not found / invalid request ---

    #[test]
    fn test_ping_returns_empty_success() {
        let server = make_server();
        let resp = server.handle_request(&req("ping", None));
        assert!(resp.error.is_none());
        assert!(resp.result.unwrap().is_object());
    }

    #[test]
    fn test_unknown_method_returns_method_not_found() {
        let server = make_server();
        let resp = server.handle_request(&req("nonexistent/method", None));
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
    }

    #[test]
    fn test_invalid_jsonrpc_version_returns_invalid_request() {
        let server = make_server();
        let bad_req = Request {
            jsonrpc: "1.0".to_string(),
            id: Some(json!(1)),
            method: "initialize".to_string(),
            params: None,
        };
        let resp = server.handle_request(&bad_req);
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32600);
    }

    // --- RpcError 标准方法覆盖 ---

    #[test]
    fn test_rpc_error_standard_codes() {
        assert_eq!(RpcError::parse_error().code, -32700);
        assert_eq!(RpcError::invalid_request().code, -32600);
        assert_eq!(RpcError::method_not_found().code, -32601);
        assert_eq!(RpcError::invalid_params(None).code, -32602);
        assert_eq!(RpcError::internal_error(None).code, -32603);
        assert_eq!(RpcError::mcp_error("test", None).code, -32000);
    }

    #[test]
    fn test_rpc_error_display_format() {
        let e = RpcError::invalid_params(None);
        assert_eq!(format!("{}", e), "[-32602] Invalid params");
    }

    #[test]
    fn test_rpc_error_serialization_skips_none_data() {
        let e = RpcError::invalid_params(None);
        let s = serde_json::to_string(&e).unwrap();
        assert!(!s.contains("data"));

        let e2 = RpcError::invalid_params(Some(json!("detail")));
        let s2 = serde_json::to_string(&e2).unwrap();
        assert!(s2.contains("detail"));
    }

    // --- 响应序列化 ---

    #[test]
    fn test_response_success_serialization() {
        let r = Response::success(Some(json!(42)), json!({"ok": true}));
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"id\":42"));
        assert!(s.contains("\"result\""));
        assert!(!s.contains("\"error\""));
    }

    #[test]
    fn test_response_error_serialization() {
        let r = Response::error(Some(json!(1)), RpcError::method_not_found());
        let s = serde_json::to_string(&r).unwrap();
        assert!(s.contains("\"error\""));
        assert!(s.contains("\"code\":-32601"));
        assert!(!s.contains("\"result\""));
    }

    // --- 多工具 server 行为 ---

    #[test]
    fn test_multiple_tools_registered_all_callable() {
        let server = make_server();
        let r1 = server.handle_request(&req(
            "tools/call",
            Some(json!({"name": "echo", "arguments": {"msg": "a"}})),
        ));
        let r2 = server.handle_request(&req("tools/call", Some(json!({"name": "fail"}))));
        assert_eq!(r1.result.unwrap()["isError"], false);
        assert_eq!(r2.result.unwrap()["isError"], true);
    }
}
