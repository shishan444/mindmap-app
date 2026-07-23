//! Phase 3 Prompts 模板
//!
//! - F-P3-02 expand_topic:扩展一个节点为子结构(LLM 给候选)
//! - F-P3-03 from_meeting_notes:从会议纪要生成思维导图
//! - F-P3-04 summarize_to_outline:把导图压缩成 3 层大纲

use crate::mcp::protocol::{Prompt, PromptArg, RpcError};
use serde_json::{json, Value};

// ============================================================
// expand_topic
// ============================================================

pub struct ExpandTopicPrompt;

impl Prompt for ExpandTopicPrompt {
    fn name(&self) -> &str {
        "expand_topic"
    }
    fn description(&self) -> &str {
        "扩展指定节点为子结构。LLM 先 read_mindmap 看上下文,再为该节点生成 5-10 个候选子主题。"
    }
    fn arguments(&self) -> Vec<PromptArg> {
        vec![
            PromptArg {
                name: "node_id".to_string(),
                description: "要扩展的节点 id".to_string(),
                required: true,
            },
            PromptArg {
                name: "depth".to_string(),
                description: "建议的子主题数量(默认 6)".to_string(),
                required: false,
            },
        ]
    }
    fn render(&self, args: Value) -> Result<Value, RpcError> {
        let node_id = args
            .get("node_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'node_id'"))))?;
        let depth = args.get("depth").and_then(|v| v.as_u64()).unwrap_or(6);

        let text = format!(
            "请帮我扩展思维导图中的节点 `{node_id}`。\n\n\
             步骤:\n\
             1. 调用 `read_mindmap` 看当前结构,理解 `{node_id}` 在树中的位置和它的兄弟节点\n\
             2. 调用 `acquire_session` 申请 60 秒写锁\n\
             3. 调用 `get_node` 查看 `{node_id}` 的 topic 和现有子节点\n\
             4. 生成约 {depth} 个有意义的子主题(每个简洁、互补、不重复)\n\
             5. 逐个调用 `create_node` 添加为 `{node_id}` 的子节点\n\
             6. 调用 `release_session` 释放锁\n\n\
             约束:\n\
             - 子主题要具体,不要泛泛(避免 '其他'、'备注' 这种)\n\
             - 如果节点已有子节点,在现有基础上扩展,不要重复\n\
             - 完成后简短总结你添加了什么"
        );

        Ok(json!([{
            "role": "user",
            "content": {"type": "text", "text": text}
        }]))
    }
}

// ============================================================
// from_meeting_notes
// ============================================================

pub struct FromMeetingNotesPrompt;

impl Prompt for FromMeetingNotesPrompt {
    fn name(&self) -> &str {
        "from_meeting_notes"
    }
    fn description(&self) -> &str {
        "从用户提供的会议纪要文本生成思维导图。"
    }
    fn arguments(&self) -> Vec<PromptArg> {
        vec![PromptArg {
            name: "meeting_notes".to_string(),
            description: "会议纪要的完整文本(markdown 或纯文本)".to_string(),
            required: true,
        }]
    }
    fn render(&self, args: Value) -> Result<Value, RpcError> {
        let notes = args
            .get("meeting_notes")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RpcError::invalid_params(Some(json!("missing 'meeting_notes'"))))?;

        let text = format!(
            "请基于下面的会议纪要生成思维导图。\n\n\
             会议纪要:\n\
             ---\n\
             {notes}\n\
             ---\n\n\
             步骤:\n\
             1. 调用 `read_mindmap` 查看当前文档结构\n\
             2. 调用 `acquire_session` 申请 90 秒写锁(任务较复杂)\n\
             3. 从纪要中识别出:会议主题、参会人、关键议题、决议、行动项\n\
             4. 在 root 下创建主分支(议题),每个议题下创建子节点(细节)\n\
             5. 行动项标记为 P0 优先级(用 create_node 的 priority 参数)\n\
             6. 调用 `release_session`\n\n\
             约束:\n\
             - 结构清晰,深度不超过 3 层\n\
             - 行动项用 P0,待跟进用 P1,普通议题用 P2\n\
             - 完成后总结思维导图的主要分支"
        );

        Ok(json!([{
            "role": "user",
            "content": {"type": "text", "text": text}
        }]))
    }
}

// ============================================================
// summarize_to_outline
// ============================================================

pub struct SummarizeToOutlinePrompt;

impl Prompt for SummarizeToOutlinePrompt {
    fn name(&self) -> &str {
        "summarize_to_outline"
    }
    fn description(&self) -> &str {
        "把当前思维导图压缩成 3 层大纲(markdown 格式输出)。"
    }
    fn arguments(&self) -> Vec<PromptArg> {
        vec![PromptArg {
            name: "max_root_children".to_string(),
            description: "顶层分支数量上限(默认 7,符合人的短时记忆)".to_string(),
            required: false,
        }]
    }
    fn render(&self, args: Value) -> Result<Value, RpcError> {
        let max_children = args
            .get("max_root_children")
            .and_then(|v| v.as_u64())
            .unwrap_or(7);

        let text = format!(
            "请把当前的思维导图压缩成 3 层大纲。\n\n\
             步骤:\n\
             1. 调用 `read_mindmap` 读取完整结构\n\
             2. 分析树的所有节点,聚类成最多 {max_children} 个顶层分支\n\
             3. 每个分支下最多 5 个子节点(进一步压缩)\n\
             4. 用 markdown 大纲格式输出:\n\
                # 主题\n\
                ## 分支 1\n\
                - 子点 1\n\
                - 子点 2\n\
                ## 分支 2\n\
                ...\n\n\
             约束:\n\
             - 这是只读任务,只调 read/export 类工具,不要修改树结构\n\
             - 不要丢失关键信息,但可以合并相似的\n\
             - 输出后简短解释你做了哪些聚类决策"
        );

        Ok(json!([{
            "role": "user",
            "content": {"type": "text", "text": text}
        }]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_topic_renders_with_node_id() {
        let p = ExpandTopicPrompt;
        let result = p.render(json!({"node_id": "n1"})).unwrap();
        let messages = result.as_array().unwrap();
        assert_eq!(messages[0]["role"], "user");
        let text = messages[0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("n1"));
        assert!(text.contains("acquire_session"));
        assert!(text.contains("release_session"));
    }

    #[test]
    fn test_expand_topic_default_depth() {
        let p = ExpandTopicPrompt;
        let result = p.render(json!({"node_id": "n1"})).unwrap();
        let text = result[0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("6 个"));
    }

    #[test]
    fn test_expand_topic_custom_depth() {
        let p = ExpandTopicPrompt;
        let result = p.render(json!({"node_id": "n1", "depth": 10})).unwrap();
        let text = result[0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("10 个"));
    }

    #[test]
    fn test_expand_topic_missing_node_id() {
        let p = ExpandTopicPrompt;
        let err = p.render(json!({})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_expand_topic_metadata() {
        let p = ExpandTopicPrompt;
        assert_eq!(p.name(), "expand_topic");
        assert!(!p.description().is_empty());
        let args = p.arguments();
        assert_eq!(args.len(), 2);
        assert_eq!(args[0].name, "node_id");
        assert!(args[0].required);
        assert!(!args[1].required); // depth
    }

    #[test]
    fn test_from_meeting_notes_renders() {
        let p = FromMeetingNotesPrompt;
        let result = p
            .render(json!({"meeting_notes": "讨论了 Q3 目标"}))
            .unwrap();
        let text = result[0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("讨论了 Q3 目标"));
        assert!(text.contains("P0"));
        assert!(text.contains("acquire_session"));
    }

    #[test]
    fn test_from_meeting_notes_missing_notes() {
        let p = FromMeetingNotesPrompt;
        let err = p.render(json!({})).unwrap_err();
        assert_eq!(err.code, -32602);
    }

    #[test]
    fn test_summarize_to_outline_renders() {
        let p = SummarizeToOutlinePrompt;
        let result = p.render(json!({})).unwrap();
        let text = result[0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("markdown"));
        assert!(text.contains("聚类"));
        // 只读,不应包含 acquire_session
        assert!(!text.contains("acquire_session"));
    }

    #[test]
    fn test_summarize_custom_max_children() {
        let p = SummarizeToOutlinePrompt;
        let result = p.render(json!({"max_root_children": 5})).unwrap();
        let text = result[0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("5 个顶层分支"));
    }

    #[test]
    fn test_all_prompts_have_correct_names() {
        let prompts: Vec<Box<dyn Prompt>> = vec![
            Box::new(ExpandTopicPrompt),
            Box::new(FromMeetingNotesPrompt),
            Box::new(SummarizeToOutlinePrompt),
        ];
        let names: Vec<&str> = prompts.iter().map(|p| p.name()).collect();
        assert_eq!(
            names,
            vec!["expand_topic", "from_meeting_notes", "summarize_to_outline"]
        );
    }
}
