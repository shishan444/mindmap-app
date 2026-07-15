//! Markdown 导入导出
//!
//! 格式约定：用 `- topic` 列表项表示节点，每 2 个前导空格表示一级深度。
//!
//! ```markdown
//! - 根节点
//!   - 子1
//!     - 孙1
//!     - 孙2
//!   - 子2
//! ```
//!
//! 同一行内 topic 后的 markdown 语法（*, _, ` 等）原样保留。

use crate::error::{AppError, Result};
use crate::models::{Content, Node};

/// 把 Content 序列化为 Markdown 字符串
pub fn export_markdown(content: &Content) -> String {
    let mut buf = String::new();
    export_node(&content.root, 0, &mut buf);
    // 去掉末尾多余换行
    if buf.ends_with('\n') {
        buf.pop();
    }
    buf
}

fn export_node(node: &Node, depth: usize, buf: &mut String) {
    for _ in 0..depth {
        buf.push_str("  ");
    }
    buf.push_str("- ");
    buf.push_str(&node.topic);
    buf.push('\n');
    for child in &node.children {
        export_node(child, depth + 1, buf);
    }
}

/// 从 Markdown 字符串解析为 Content
pub fn import_markdown(md: &str) -> Result<Content> {
    if md.trim().is_empty() {
        return Err(AppError::InvalidFormat(
            "Markdown 为空".to_string(),
        ));
    }
    let lines: Vec<&str> = md.lines().collect();
    if lines.is_empty() {
        return Err(AppError::InvalidFormat(
            "Markdown 无内容".to_string(),
        ));
    }

    // 解析所有 (depth, topic) 对
    let mut parsed: Vec<(usize, String)> = Vec::new();
    for raw in &lines {
        let trimmed = raw.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        if !trimmed.contains("- ") && !trimmed.contains("* ") {
            continue;
        }
        if let Some((depth, topic)) = parse_list_line(trimmed) {
            parsed.push((depth, topic));
        }
    }

    if parsed.is_empty() {
        return Err(AppError::InvalidFormat(
            "Markdown 中未找到列表项".to_string(),
        ));
    }

    let root_depth = parsed[0].0;
    let (root, _next_idx) = build_tree(&parsed, 0, root_depth);

    Ok(Content {
        version: "1.0.0".to_string(),
        root,
        canvas_state: Default::default(),
    })
}

/// 递归构建树，返回 (node, next_index_in_parsed)
/// 从 parsed[start_idx] 开始，构造深度为 target_depth 的节点 + 其子树。
/// 容错：深度突变（如 0 → 3，缺中间层）时，把突变项当作直接子。
fn build_tree(parsed: &[(usize, String)], start_idx: usize, target_depth: usize) -> (Node, usize) {
    let mut node = Node::new(parsed[start_idx].1.clone());
    let mut i = start_idx + 1;
    while i < parsed.len() {
        let (depth, _) = &parsed[i];
        if *depth <= target_depth {
            break;
        }
        // 任何比 target_depth 深的都作为子（容错突变）
        let (child, next_i) = build_tree(parsed, i, *depth);
        node.children.push(child);
        i = next_i;
    }
    (node, i)
}

fn parse_list_line(line: &str) -> Option<(usize, String)> {
    // 计算前导空格
    let leading_spaces = line.chars().take_while(|&c| c == ' ').count();
    let depth = leading_spaces / 2;
    let rest = &line[leading_spaces..];
    // 必须以 - 或 * 开头
    let after_marker = rest
        .strip_prefix("- ")
        .or_else(|| rest.strip_prefix("* "))
        .or_else(|| rest.strip_prefix("-"))
        .or_else(|| rest.strip_prefix("*"))?;
    let topic = after_marker.trim().to_string();
    if topic.is_empty() {
        None
    } else {
        Some((depth, topic))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CanvasState, Node};

    fn make_node_with(topic: &str, children: Vec<Node>) -> Node {
        let mut n = Node::new(topic);
        n.children = children;
        n
    }

    fn make_content(root: Node) -> Content {
        Content {
            version: "1.0.0".to_string(),
            root,
            canvas_state: CanvasState::default(),
        }
    }

    // ===== 导出测试 =====

    #[test]
    fn export_single_root() {
        let c = make_content(Node::new("根"));
        let md = export_markdown(&c);
        assert_eq!(md, "- 根");
    }

    #[test]
    fn export_root_with_children() {
        let c = make_content(make_node_with(
            "根",
            vec![Node::new("子1"), Node::new("子2")],
        ));
        let md = export_markdown(&c);
        assert_eq!(md, "- 根\n  - 子1\n  - 子2");
    }

    #[test]
    fn export_nested() {
        let c = make_content(make_node_with(
            "根",
            vec![make_node_with(
                "子1",
                vec![Node::new("孙1"), Node::new("孙2")],
            )],
        ));
        let md = export_markdown(&c);
        assert_eq!(md, "- 根\n  - 子1\n    - 孙1\n    - 孙2");
    }

    #[test]
    fn export_empty_topic() {
        let c = make_content(Node::new(""));
        let md = export_markdown(&c);
        assert_eq!(md, "- ");
    }

    #[test]
    fn export_special_chars() {
        let c = make_content(Node::new("含 * 星号 _ 下划线 ` 反引号"));
        let md = export_markdown(&c);
        assert_eq!(md, "- 含 * 星号 _ 下划线 ` 反引号");
    }

    #[test]
    fn export_no_trailing_newline() {
        let c = make_content(Node::new("根"));
        let md = export_markdown(&c);
        assert!(!md.ends_with('\n'));
    }

    // ===== 导入测试 =====

    #[test]
    fn import_single_line() {
        let md = "- 根";
        let c = import_markdown(md).unwrap();
        assert_eq!(c.root.topic, "根");
        assert!(c.root.children.is_empty());
    }

    #[test]
    fn import_root_with_children() {
        let md = "- 根\n  - 子1\n  - 子2";
        let c = import_markdown(md).unwrap();
        assert_eq!(c.root.topic, "根");
        assert_eq!(c.root.children.len(), 2);
        assert_eq!(c.root.children[0].topic, "子1");
        assert_eq!(c.root.children[1].topic, "子2");
    }

    #[test]
    fn import_nested() {
        let md = "- 根\n  - 子1\n    - 孙1\n    - 孙2\n  - 子2";
        let c = import_markdown(md).unwrap();
        assert_eq!(c.root.topic, "根");
        assert_eq!(c.root.children.len(), 2);
        assert_eq!(c.root.children[0].topic, "子1");
        assert_eq!(c.root.children[0].children.len(), 2);
        assert_eq!(c.root.children[0].children[0].topic, "孙1");
        assert_eq!(c.root.children[0].children[1].topic, "孙2");
    }

    #[test]
    fn import_skips_blank_lines() {
        let md = "- 根\n\n  - 子1\n\n  - 子2";
        let c = import_markdown(md).unwrap();
        assert_eq!(c.root.children.len(), 2);
    }

    #[test]
    fn import_supports_star_marker() {
        let md = "* 根\n  * 子1";
        let c = import_markdown(md).unwrap();
        assert_eq!(c.root.topic, "根");
        assert_eq!(c.root.children[0].topic, "子1");
    }

    #[test]
    fn import_empty_string_errors() {
        assert!(import_markdown("").is_err());
        assert!(import_markdown("   ").is_err());
    }

    #[test]
    fn import_no_list_items_errors() {
        assert!(import_markdown("just text\nno list").is_err());
    }

    #[test]
    fn import_extra_spaces() {
        let md = "- 根\n      - 子（3 级深度但无中间层）";
        let c = import_markdown(md).unwrap();
        // 子的深度=3，根深度=0，stack 弹到空，子变成根的"远方兄弟"——简化为：根的 child
        assert_eq!(c.root.children.len(), 1);
        assert_eq!(c.root.children[0].topic, "子（3 级深度但无中间层）");
    }

    #[test]
    fn import_generates_uuid_for_nodes() {
        let md = "- 根\n  - 子";
        let c = import_markdown(md).unwrap();
        assert_ne!(c.root.id, c.root.children[0].id);
        assert_eq!(c.root.id.len(), 36);
    }

    #[test]
    fn import_skips_non_list_lines() {
        let md = "# 标题（被忽略）\n- 根\n说明文字（被忽略）\n  - 子";
        let c = import_markdown(md).unwrap();
        assert_eq!(c.root.topic, "根");
        assert_eq!(c.root.children[0].topic, "子");
    }

    // ===== 往返一致性 =====

    #[test]
    fn roundtrip_complex_tree() {
        let original = make_content(make_node_with(
            "学习计划",
            vec![
                make_node_with(
                    "React 进阶",
                    vec![
                        Node::new("Hooks"),
                        Node::new("性能优化"),
                        Node::new("并发模式"),
                    ],
                ),
                make_node_with(
                    "Vue 进阶",
                    vec![Node::new("Composition API")],
                ),
                Node::new("项目实战"),
            ],
        ));
        let md = export_markdown(&original);
        let restored = import_markdown(&md).unwrap();
        assert_eq!(restored.root.topic, original.root.topic);
        assert_eq!(restored.root.children.len(), 3);
        assert_eq!(restored.root.children[0].children.len(), 3);
        assert_eq!(restored.root.children[1].children.len(), 1);
    }
}
