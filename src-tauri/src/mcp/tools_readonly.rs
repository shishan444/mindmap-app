//! Phase 1 只读 tools 实现(6 个)
//!
//! - F-P1-06: read_mindmap
//! - F-P1-07: search_nodes
//! - F-P1-08: get_node
//! - F-P1-09: list_reminders
//! - F-P1-10: export_mindmap
//! - F-P1-11: get_edit_state

use crate::mcp::data_source::MindmapDataSource;
use crate::mcp::protocol::{RpcError, Tool};
use crate::markdown;
use crate::opml;
use serde_json::{json, Value};
use std::sync::Arc;

// ============================================================
// F-P1-06: read_mindmap
// ============================================================

pub struct ReadMindmapTool {
    source: Arc<dyn MindmapDataSource>,
}

impl ReadMindmapTool {
    pub fn new(source: Arc<dyn MindmapDataSource>) -> Self {
        Self { source }
    }
}

impl Tool for ReadMindmapTool {
    fn name(&self) -> &str {
        "read_mindmap"
    }
    fn description(&self) -> &str {
        "读取思维导图整树结构。如果不传 path,返回当前打开的文档。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "目标 .mmap 文件路径(可选,不传则读当前文档)"
                }
            }
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        // 如果传了 path,从磁盘读任意 .mmap 文件
        if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
            return self.read_from_path(path);
        }
        // 否则读当前打开的文档
        let content = self.source.current_content().ok_or_else(|| {
            RpcError::mcp_error("当前没有打开任何思维导图文档", None)
        })?;
        let path = self.source.current_file_path();
        let node_count = count_nodes(&content.root);
        Ok(json!({
            "file_path": path,
            "version": content.version,
            "node_count": node_count,
            "root": content.root,
            "canvas_state": content.canvas_state,
        }))
    }
}

impl ReadMindmapTool {
    fn read_from_path(&self, path: &str) -> Result<Value, RpcError> {
        // .mmap 是目录:含 content.json + meta.json + assets/ + thumbnails/
        let mmap_root = std::path::PathBuf::from(path);
        if !mmap_root.exists() {
            return Err(RpcError::mcp_error(
                &format!("文件不存在: {}", path),
                None,
            ));
        }
        if !mmap_root.is_dir() {
            return Err(RpcError::mcp_error(
                &format!("路径不是 .mmap 目录: {}", path),
                None,
            ));
        }
        let content_path = mmap_root.join("content.json");
        let content_str = std::fs::read_to_string(&content_path).map_err(|e| {
            RpcError::internal_error(Some(json!({
                "error": format!("{}", e),
                "hint": "无法读取 content.json(文件可能损坏)"
            })))
        })?;
        let content: crate::models::Content = serde_json::from_str(&content_str)
            .map_err(|e| {
                RpcError::mcp_error(
                    "解析 content.json 失败",
                    Some(json!({"error": format!("{}", e)})),
                )
            })?;
        let node_count = count_nodes(&content.root);
        Ok(json!({
            "file_path": path,
            "version": content.version,
            "node_count": node_count,
            "root": content.root,
            "canvas_state": content.canvas_state,
        }))
    }
}

fn count_nodes(node: &crate::models::Node) -> usize {
    1 + node.children.iter().map(count_nodes).sum::<usize>()
}

// ============================================================
// F-P1-07: search_nodes
// ============================================================

pub struct SearchNodesTool {
    source: Arc<dyn MindmapDataSource>,
}

impl SearchNodesTool {
    pub fn new(source: Arc<dyn MindmapDataSource>) -> Self {
        Self { source }
    }
}

impl Tool for SearchNodesTool {
    fn name(&self) -> &str {
        "search_nodes"
    }
    fn description(&self) -> &str {
        "在思维导图中按关键词搜索节点(大小写不敏感,匹配 topic)"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "搜索关键词"
                }
            },
            "required": ["query"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'query'"))))?;
        if query.trim().is_empty() {
            return Err(RpcError::invalid_params(Some(json!("query 不能为空"))));
        }
        let content = self.source.current_content().ok_or_else(|| {
            RpcError::mcp_error("当前没有打开任何思维导图文档", None)
        })?;
        let query_lower = query.to_lowercase();
        let mut matches: Vec<Value> = vec![];
        walk_nodes(&content.root, &mut |node, depth| {
            if node.topic.to_lowercase().contains(&query_lower) {
                matches.push(json!({
                    "id": node.id,
                    "topic": node.topic,
                    "depth": depth,
                    "priority": node.priority,
                    "has_attachment": node.attached_file.is_some(),
                }));
            }
        });
        Ok(json!({
            "query": query,
            "match_count": matches.len(),
            "matches": matches,
        }))
    }
}

fn walk_nodes<F>(node: &crate::models::Node, visitor: &mut F)
where
    F: FnMut(&crate::models::Node, usize),
{
    walk_inner(node, visitor, 0);
}

fn walk_inner<F>(node: &crate::models::Node, visitor: &mut F, depth: usize)
where
    F: FnMut(&crate::models::Node, usize),
{
    visitor(node, depth);
    for child in &node.children {
        walk_inner(child, visitor, depth + 1);
    }
}

// ============================================================
// F-P1-08: get_node
// ============================================================

pub struct GetNodeTool {
    source: Arc<dyn MindmapDataSource>,
}

impl GetNodeTool {
    pub fn new(source: Arc<dyn MindmapDataSource>) -> Self {
        Self { source }
    }
}

impl Tool for GetNodeTool {
    fn name(&self) -> &str {
        "get_node"
    }
    fn description(&self) -> &str {
        "按 id 获取单个节点的完整信息"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "目标节点 id"
                }
            },
            "required": ["node_id"]
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let node_id = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'node_id'"))))?;
        let content = self.source.current_content().ok_or_else(|| {
            RpcError::mcp_error("当前没有打开任何思维导图文档", None)
        })?;
        let node = find_node(&content.root, node_id).ok_or_else(|| {
            RpcError::mcp_error(
                &format!("节点 {} 不存在", node_id),
                None,
            )
        })?;
        Ok(json!({
            "node": node,
        }))
    }
}

fn find_node<'a>(
    root: &'a crate::models::Node,
    id: &str,
) -> Option<&'a crate::models::Node> {
    if root.id == id {
        return Some(root);
    }
    for child in &root.children {
        if let Some(n) = find_node(child, id) {
            return Some(n);
        }
    }
    None
}

// ============================================================
// F-P1-09: list_reminders
// ============================================================

pub struct ListRemindersTool {
    source: Arc<dyn MindmapDataSource>,
}

impl ListRemindersTool {
    pub fn new(source: Arc<dyn MindmapDataSource>) -> Self {
        Self { source }
    }
}

impl Tool for ListRemindersTool {
    fn name(&self) -> &str {
        "list_reminders"
    }
    fn description(&self) -> &str {
        "列出所有提醒(跨所有文档)"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "enabled_only": {
                    "type": "boolean",
                    "description": "只返回启用的提醒(默认 false)",
                    "default": false
                }
            }
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let enabled_only = args
            .get("enabled_only")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let mut reminders = self.source.all_reminders();
        if enabled_only {
            reminders.retain(|r| r.enabled);
        }
        Ok(json!({
            "count": reminders.len(),
            "reminders": reminders,
        }))
    }
}

// ============================================================
// F-P1-10: export_mindmap
// ============================================================

pub struct ExportMindmapTool {
    source: Arc<dyn MindmapDataSource>,
}

impl ExportMindmapTool {
    pub fn new(source: Arc<dyn MindmapDataSource>) -> Self {
        Self { source }
    }
}

impl Tool for ExportMindmapTool {
    fn name(&self) -> &str {
        "export_mindmap"
    }
    fn description(&self) -> &str {
        "导出思维导图为文本格式(markdown / opml / mermaid)"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "format": {
                    "type": "string",
                    "enum": ["markdown", "opml", "mermaid"],
                    "description": "导出格式(默认 markdown)"
                }
            }
        })
    }
    fn call(&self, args: Value) -> Result<Value, RpcError> {
        let format = args
            .get("format")
            .and_then(|v| v.as_str())
            .unwrap_or("markdown");
        let content = self.source.current_content().ok_or_else(|| {
            RpcError::mcp_error("当前没有打开任何思维导图文档", None)
        })?;
        let text = match format {
            "markdown" | "md" => markdown::export_markdown(&content),
            "opml" => opml::export_opml(&content),
            "mermaid" => export_mermaid(&content),
            _ => {
                return Err(RpcError::invalid_params(Some(json!(format!(
                    "未知 format: {}(支持 markdown/opml/mermaid)",
                    format
                )))))
            }
        };
        Ok(json!({
            "format": format,
            "text": text,
        }))
    }
}

/// 简易 mermaid mindmap 输出
fn export_mermaid(content: &crate::models::Content) -> String {
    let mut s = String::from("mindmap\n");
    mermaid_walk(&content.root, 1, &mut s);
    s
}

fn mermaid_walk(node: &crate::models::Node, depth: usize, out: &mut String) {
    let indent = "  ".repeat(depth);
    out.push_str(&format!("{}{}\n", indent, node.topic));
    for child in &node.children {
        mermaid_walk(child, depth + 1, out);
    }
}

// ============================================================
// F-P1-11: get_edit_state
// ============================================================

pub struct GetEditStateTool {
    source: Arc<dyn MindmapDataSource>,
}

impl GetEditStateTool {
    pub fn new(source: Arc<dyn MindmapDataSource>) -> Self {
        Self { source }
    }
}

impl Tool for GetEditStateTool {
    fn name(&self) -> &str {
        "get_edit_state"
    }
    fn description(&self) -> &str {
        "查询当前编辑状态(human / llm / idle),用于决定是否能写操作"
    }
    fn schema(&self) -> Value {
        json!({"type": "object", "properties": {}})
    }
    fn call(&self, _args: Value) -> Result<Value, RpcError> {
        Ok(json!(self.source.edit_state()))
    }
}

// ============================================================
// 单元测试
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::data_source::{EditState, MockDataSource};
    use crate::models::{Content, Node};
    use serde_json::json;

    fn make_node(id: &str, topic: &str, children: Vec<Node>) -> Node {
        let mut n = Node::new(topic);
        n.id = id.to_string();
        n.topic = topic.to_string();
        n.children = children;
        n
    }

    fn make_test_content() -> Content {
        // 树结构:root -> [A -> [A1], Meeting Notes (P0)]
        let a1 = make_node("a1", "Subtask A1", vec![]);
        let a = make_node("a", "Project A", vec![a1]);
        let meeting = make_node("mtg", "Meeting Notes", vec![]);
        meeting.clone().priority = Some(crate::models::Priority::P0);
        let root = make_node("root", "My Mind Map", vec![a, meeting]);
        Content {
            version: "1.0.0".to_string(),
            root,
            canvas_state: Default::default(),
        }
    }

    fn make_source() -> MockDataSource {
        MockDataSource {
            content: Some(make_test_content()),
            file_path: Some("/tmp/test.mmap".to_string()),
            reminders: vec![],
            edit_state: EditState {
                editor: "human".to_string(),
                session: None,
                file_path: Some("/tmp/test.mmap".to_string()),
            },
        }
    }

    fn make_arc_source() -> Arc<dyn MindmapDataSource> {
        Arc::new(make_source())
    }

    // --- F-P1-06 read_mindmap ---

    #[test]
    fn test_read_mindmap_returns_full_tree() {
        let tool = ReadMindmapTool::new(make_arc_source());
        let result = tool.call(json!({})).unwrap();
        assert_eq!(result["file_path"], "/tmp/test.mmap");
        assert_eq!(result["node_count"], 4);
        assert_eq!(result["root"]["topic"], "My Mind Map");
        assert_eq!(result["root"]["children"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_read_mindmap_no_document_returns_error() {
        let mut src = make_source();
        src.content = None;
        let tool = ReadMindmapTool::new(Arc::new(src));
        let err = tool.call(json!({})).unwrap_err();
        assert_eq!(err.code, -32000);
        assert!(err.message.contains("没有打开"));
    }

    #[test]
    fn test_read_mindmap_path_param_reads_from_disk() {
        let tool = ReadMindmapTool::new(make_arc_source());
        // 用 tmp 目录构造一个假 .mmap
        let tmp = std::env::temp_dir().join(format!(
            "mcp-test-{}-{}.mmap",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let content = make_test_content();
        std::fs::write(
            tmp.join("content.json"),
            serde_json::to_string_pretty(&content).unwrap(),
        )
        .unwrap();
        let result = tool.call(json!({"path": tmp.to_string_lossy()})).unwrap();
        assert_eq!(result["file_path"].as_str().unwrap(), tmp.to_string_lossy().as_ref());
        assert_eq!(result["node_count"], 4);
        assert_eq!(result["root"]["topic"], "My Mind Map");
        // 清理
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn test_read_mindmap_path_not_exist() {
        let tool = ReadMindmapTool::new(make_arc_source());
        let err = tool
            .call(json!({"path": "/definitely/not/exist.mmap"}))
            .unwrap_err();
        assert_eq!(err.code, -32000);
        assert!(err.message.contains("不存在"));
    }

    #[test]
    fn test_read_mindmap_path_not_directory() {
        let tool = ReadMindmapTool::new(make_arc_source());
        // 传一个文件路径而非目录
        let tmp_file = std::env::temp_dir().join(format!(
            "mcp-test-file-{}-{}.txt",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::write(&tmp_file, "not a mmap").unwrap();
        let err = tool
            .call(json!({"path": tmp_file.to_string_lossy()}))
            .unwrap_err();
        assert_eq!(err.code, -32000);
        assert!(err.message.contains("不是 .mmap 目录"));
        std::fs::remove_file(&tmp_file).ok();
    }

    // --- F-P1-07 search_nodes ---

    #[test]
    fn test_search_nodes_finds_matches_case_insensitive() {
        let tool = SearchNodesTool::new(make_arc_source());
        let result = tool.call(json!({"query": "meeting"})).unwrap();
        assert_eq!(result["match_count"], 1);
        let m = &result["matches"].as_array().unwrap()[0];
        assert_eq!(m["topic"], "Meeting Notes");
    }

    #[test]
    fn test_search_nodes_finds_multiple_matches() {
        let tool = SearchNodesTool::new(make_arc_source());
        // "a" 匹配 "Project A" 和 "Subtask A1"
        let result = tool.call(json!({"query": "a"})).unwrap();
        assert!(result["match_count"].as_u64().unwrap() >= 2);
    }

    #[test]
    fn test_search_nodes_empty_query_returns_error() {
        let tool = SearchNodesTool::new(make_arc_source());
        let err = tool.call(json!({"query": ""})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_search_nodes_missing_query_returns_error() {
        let tool = SearchNodesTool::new(make_arc_source());
        let err = tool.call(json!({})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_search_nodes_no_matches() {
        let tool = SearchNodesTool::new(make_arc_source());
        let result = tool.call(json!({"query": "zzzznotfound"})).unwrap();
        assert_eq!(result["match_count"], 0);
    }

    // --- F-P1-08 get_node ---

    #[test]
    fn test_get_node_returns_specific_node() {
        let tool = GetNodeTool::new(make_arc_source());
        let result = tool.call(json!({"node_id": "a"})).unwrap();
        assert_eq!(result["node"]["topic"], "Project A");
        assert_eq!(result["node"]["children"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_get_node_not_found_returns_error() {
        let tool = GetNodeTool::new(make_arc_source());
        let err = tool.call(json!({"node_id": "nonexistent"})).unwrap_err();
        assert_eq!(err.code, -32000);
    }

    #[test]
    fn test_get_node_missing_id_returns_error() {
        let tool = GetNodeTool::new(make_arc_source());
        let err = tool.call(json!({})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_get_node_finds_descendant() {
        let tool = GetNodeTool::new(make_arc_source());
        let result = tool.call(json!({"node_id": "a1"})).unwrap();
        assert_eq!(result["node"]["topic"], "Subtask A1");
    }

    // --- F-P1-09 list_reminders ---

    #[test]
    fn test_list_reminders_empty() {
        let tool = ListRemindersTool::new(make_arc_source());
        let result = tool.call(json!({})).unwrap();
        assert_eq!(result["count"], 0);
    }

    #[test]
    fn test_list_reminders_returns_all() {
        let mut src = make_source();
        let mut r1 = crate::models::Reminder::new("n1", "/a.mmap", "提醒1", "2026-08-01T10:00:00");
        r1.enabled = true;
        let mut r2 = crate::models::Reminder::new("n2", "/a.mmap", "提醒2", "2026-08-02T10:00:00");
        r2.enabled = false;
        src.reminders = vec![r1, r2];
        let tool = ListRemindersTool::new(Arc::new(src));

        let all = tool.call(json!({})).unwrap();
        assert_eq!(all["count"], 2);

        let enabled_only = tool.call(json!({"enabled_only": true})).unwrap();
        assert_eq!(enabled_only["count"], 1);
    }

    // --- F-P1-10 export_mindmap ---

    #[test]
    fn test_export_markdown_format() {
        let tool = ExportMindmapTool::new(make_arc_source());
        let result = tool.call(json!({"format": "markdown"})).unwrap();
        assert_eq!(result["format"], "markdown");
        let text = result["text"].as_str().unwrap();
        assert!(text.contains("My Mind Map"));
    }

    #[test]
    fn test_export_default_is_markdown() {
        let tool = ExportMindmapTool::new(make_arc_source());
        let result = tool.call(json!({})).unwrap();
        assert_eq!(result["format"], "markdown");
    }

    #[test]
    fn test_export_opml_format() {
        let tool = ExportMindmapTool::new(make_arc_source());
        let result = tool.call(json!({"format": "opml"})).unwrap();
        let text = result["text"].as_str().unwrap();
        assert!(text.contains("<opml") || text.contains("<?xml"));
    }

    #[test]
    fn test_export_mermaid_format() {
        let tool = ExportMindmapTool::new(make_arc_source());
        let result = tool.call(json!({"format": "mermaid"})).unwrap();
        let text = result["text"].as_str().unwrap();
        assert!(text.starts_with("mindmap"));
        assert!(text.contains("My Mind Map"));
    }

    #[test]
    fn test_export_unknown_format_returns_error() {
        let tool = ExportMindmapTool::new(make_arc_source());
        let err = tool.call(json!({"format": "pdf"})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    // --- F-P1-11 get_edit_state ---

    #[test]
    fn test_get_edit_state_human() {
        let tool = GetEditStateTool::new(make_arc_source());
        let result = tool.call(json!({})).unwrap();
        assert_eq!(result["editor"], "human");
        assert_eq!(result["file_path"], "/tmp/test.mmap");
    }

    #[test]
    fn test_get_edit_state_llm_with_session() {
        let mut src = make_source();
        src.edit_state.editor = "llm".to_string();
        src.edit_state.session = Some(crate::mcp::data_source::LlmSessionInfo {
            session_id: "s1".to_string(),
            client_name: "Claude Desktop".to_string(),
            expires_at_ms: 1784610000000,
        });
        let tool = GetEditStateTool::new(Arc::new(src));
        let result = tool.call(json!({})).unwrap();
        assert_eq!(result["editor"], "llm");
        assert_eq!(result["session"]["session_id"], "s1");
    }

    // --- Tool trait 元数据 ---

    #[test]
    fn test_all_tools_have_correct_names_and_schemas() {
        let s = make_arc_source();
        let tools: Vec<Box<dyn Tool>> = vec![
            Box::new(ReadMindmapTool::new(s.clone())),
            Box::new(SearchNodesTool::new(s.clone())),
            Box::new(GetNodeTool::new(s.clone())),
            Box::new(ListRemindersTool::new(s.clone())),
            Box::new(ExportMindmapTool::new(s.clone())),
            Box::new(GetEditStateTool::new(s)),
        ];
        let names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        assert_eq!(
            names,
            vec![
                "read_mindmap",
                "search_nodes",
                "get_node",
                "list_reminders",
                "export_mindmap",
                "get_edit_state",
            ]
        );
        // 每个 schema 必须是合法 JSON 对象
        for t in &tools {
            assert!(t.schema().is_object(), "{} schema should be object", t.name());
            assert!(!t.description().is_empty(), "{} description should not be empty", t.name());
        }
    }
}
