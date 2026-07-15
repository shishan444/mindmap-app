//! OPML 导入导出（Outline Processor Markup Language）
//!
//! OPML 是 XML 格式，与 XMind、WorkFlowy、OmniOutliner 等软件互通。
//!
//! ```xml
//! <?xml version="1.0" encoding="UTF-8"?>
//! <opml version="2.0">
//!   <head><title>思维导图</title></head>
//!   <body>
//!     <outline text="根节点">
//!       <outline text="子1">
//!         <outline text="孙1"/>
//!       </outline>
//!       <outline text="子2"/>
//!     </outline>
//!   </body>
//! </opml>
//! ```
//!
//! 实现：手写最小扫描器，避免 XML 依赖（OPML 结构简单：仅 outline 一种标签）。

use crate::error::{AppError, Result};
use crate::models::{Content, Node};

const XML_HEADER: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>"#;

const XML_FOOTER: &str = "</title>\n  </head>\n  <body>\n";
const XML_END: &str = "  </body>\n</opml>";

/// 把 Content 序列化为 OPML 字符串
pub fn export_opml(content: &Content) -> String {
    let mut buf = String::new();
    buf.push_str(XML_HEADER);
    buf.push_str(&xml_escape(&content.root.topic));
    buf.push_str(XML_FOOTER);
    write_outline(&content.root, 1, &mut buf);
    buf.push_str(XML_END);
    buf
}

fn write_outline(node: &Node, depth: usize, buf: &mut String) {
    let indent = "    ".repeat(depth);
    if node.children.is_empty() {
        buf.push_str(&indent);
        buf.push_str("<outline text=\"");
        buf.push_str(&xml_escape(&node.topic));
        buf.push_str("\"/>\n");
    } else {
        buf.push_str(&indent);
        buf.push_str("<outline text=\"");
        buf.push_str(&xml_escape(&node.topic));
        buf.push_str("\">\n");
        for child in &node.children {
            write_outline(child, depth + 1, buf);
        }
        buf.push_str(&indent);
        buf.push_str("</outline>\n");
    }
}

/// 从 OPML 字符串解析为 Content
pub fn import_opml(opml: &str) -> Result<Content> {
    if opml.trim().is_empty() {
        return Err(AppError::InvalidFormat("OPML 为空".to_string()));
    }

    // 找到 <body> 起点
    let body_start = opml
        .find("<body>")
        .ok_or_else(|| AppError::InvalidFormat("OPML 缺 <body> 标签".to_string()))?;
    let body_end = opml
        .find("</body>")
        .ok_or_else(|| AppError::InvalidFormat("OPML 缺 </body> 标签".to_string()))?;
    if body_end <= body_start {
        return Err(AppError::InvalidFormat(
            "<body></body> 顺序错误".to_string(),
        ));
    }
    let body = &opml[body_start + 6..body_end];

    // 在 body 内扫描所有 outline 标签
    let tokens = scan_outline_tokens(body)?;
    if tokens.is_empty() {
        return Err(AppError::InvalidFormat(
            "body 内无 outline 元素".to_string(),
        ));
    }

    // 用栈构建树
    // 第一个 OPEN 必须是根
    let mut stack: Vec<Node> = Vec::new();
    let mut root: Option<Node> = None;

    for token in tokens {
        match token {
            Token::Open(topic) => {
                let node = Node::new(topic);
                stack.push(node);
            }
            Token::SelfClosed(topic) => {
                let node = Node::new(topic);
                if stack.is_empty() {
                    // 根是自闭合（叶子）
                    if root.is_none() {
                        root = Some(node);
                    } else {
                        // 已经有根，但 body 内只允许一个根元素
                        return Err(AppError::InvalidFormat(
                            "OPML body 内有多个根 outline".to_string(),
                        ));
                    }
                } else {
                    stack.last_mut().unwrap().children.push(node);
                }
            }
            Token::Close => {
                let node = stack.pop().expect("栈不平衡");
                if stack.is_empty() {
                    // 这是根
                    if root.is_none() {
                        root = Some(node);
                    } else {
                        return Err(AppError::InvalidFormat(
                            "OPML body 内有多个根 outline".to_string(),
                        ));
                    }
                } else {
                    stack.last_mut().unwrap().children.push(node);
                }
            }
        }
    }

    if !stack.is_empty() {
        return Err(AppError::InvalidFormat(format!(
            "outline 标签未闭合（栈剩 {}）",
            stack.len()
        )));
    }

    let root = root.ok_or_else(|| AppError::InvalidFormat("未解析到根 outline".to_string()))?;
    Ok(Content {
        version: "1.0.0".to_string(),
        root,
        canvas_state: Default::default(),
    })
}

#[derive(Debug, Clone)]
enum Token {
    Open(String),
    SelfClosed(String),
    Close,
}

fn scan_outline_tokens(s: &str) -> Result<Vec<Token>> {
    let mut tokens = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        // 看是不是 </outline>
        if s[i..].starts_with("</outline>") {
            tokens.push(Token::Close);
            i += "</outline>".len();
            continue;
        }
        // 看是不是 <outline ...
        if s[i..].starts_with("<outline") {
            // 先找当前标签的 >（注意必须是当前标签的，不是后面其他标签的）
            let rest = &s[i..];
            let gt_pos = rest.find('>').ok_or_else(|| {
                AppError::InvalidFormat(format!(
                    "outline 标签未关闭: {}",
                    &rest[..rest.len().min(80)]
                ))
            })?;
            let full_end = i + gt_pos + 1;
            let tag = &s[i..full_end];
            // 判断是不是自闭合（标签以 /> 结尾）
            let is_self_closed = tag.ends_with("/>");
            let topic = extract_text_attr(tag).unwrap_or_default();
            if is_self_closed {
                tokens.push(Token::SelfClosed(topic));
            } else {
                tokens.push(Token::Open(topic));
            }
            i = full_end;
            continue;
        }
        i += 1;
    }
    Ok(tokens)
}

fn extract_text_attr(tag: &str) -> Option<String> {
    let key = "text=\"";
    let start = tag.find(key)? + key.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    let raw = &rest[..end];
    Some(xml_unescape(raw))
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

fn xml_unescape(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&gt;", ">")
        .replace("&lt;", "<")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CanvasState, Node as MNode};

    fn make_node_with(topic: &str, children: Vec<MNode>) -> MNode {
        let mut n = MNode::new(topic);
        n.children = children;
        n
    }

    fn make_content(root: MNode) -> Content {
        Content {
            version: "1.0.0".to_string(),
            root,
            canvas_state: CanvasState::default(),
        }
    }

    // ===== 导出 =====

    #[test]
    fn export_single_root() {
        let c = make_content(MNode::new("根"));
        let opml = export_opml(&c);
        assert!(opml.contains("<?xml version=\"1.0\""));
        assert!(opml.contains("<opml version=\"2.0\">"));
        assert!(opml.contains("<title>根</title>"));
        assert!(opml.contains("<outline text=\"根\"/>"));
        assert!(opml.contains("</opml>"));
    }

    #[test]
    fn export_root_with_children() {
        let c = make_content(make_node_with(
            "根",
            vec![MNode::new("子1"), MNode::new("子2")],
        ));
        let opml = export_opml(&c);
        assert!(opml.contains("<outline text=\"根\">"));
        assert!(opml.contains("</outline>"));
        assert!(opml.contains("<outline text=\"子1\"/>"));
        assert!(opml.contains("<outline text=\"子2\"/>"));
    }

    #[test]
    fn export_nested() {
        let c = make_content(make_node_with(
            "根",
            vec![make_node_with(
                "子1",
                vec![MNode::new("孙1")],
            )],
        ));
        let opml = export_opml(&c);
        assert!(opml.contains("<outline text=\"子1\">"));
        assert!(opml.contains("<outline text=\"孙1\"/>"));
    }

    #[test]
    fn export_xml_special_chars() {
        let c = make_content(MNode::new("含 < 大于 > 和 & 与 \" 引号"));
        let opml = export_opml(&c);
        // 注意 title 区和 outline 区都应转义
        assert!(opml.contains("含 &lt; 大于 &gt; 和 &amp; 与 &quot; 引号"));
    }

    #[test]
    fn export_has_xml_header() {
        let c = make_content(MNode::new("x"));
        let opml = export_opml(&c);
        assert!(opml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
    }

    // ===== 导入 =====

    #[test]
    fn import_single_root_self_closed() {
        let opml = r#"<?xml version="1.0"?>
<opml version="2.0">
  <head><title>测试</title></head>
  <body>
    <outline text="根"/>
  </body>
</opml>"#;
        let c = import_opml(opml).unwrap();
        assert_eq!(c.root.topic, "根");
        assert!(c.root.children.is_empty());
    }

    #[test]
    fn import_with_children() {
        let opml = r#"<?xml version="1.0"?>
<opml version="2.0">
  <head><title>x</title></head>
  <body>
    <outline text="根">
      <outline text="子1"/>
      <outline text="子2"/>
    </outline>
  </body>
</opml>"#;
        let c = import_opml(opml).unwrap();
        assert_eq!(c.root.topic, "根");
        assert_eq!(c.root.children.len(), 2);
        assert_eq!(c.root.children[0].topic, "子1");
        assert_eq!(c.root.children[1].topic, "子2");
    }

    #[test]
    fn import_nested() {
        let opml = r#"<?xml version="1.0"?>
<opml version="2.0">
  <head><title>x</title></head>
  <body>
    <outline text="根">
      <outline text="子1">
        <outline text="孙1"/>
        <outline text="孙2"/>
      </outline>
      <outline text="子2"/>
    </outline>
  </body>
</opml>"#;
        let c = import_opml(opml).unwrap();
        assert_eq!(c.root.children.len(), 2);
        assert_eq!(c.root.children[0].topic, "子1");
        assert_eq!(c.root.children[0].children.len(), 2);
        assert_eq!(c.root.children[0].children[0].topic, "孙1");
    }

    #[test]
    fn import_unescape_special_chars() {
        let opml = r#"<?xml version="1.0"?>
<opml version="2.0"><head><title>x</title></head>
<body>
  <outline text="含 &lt; tag &amp; 符号"/>
</body></opml>"#;
        let c = import_opml(opml).unwrap();
        assert_eq!(c.root.topic, "含 < tag & 符号");
    }

    #[test]
    fn import_empty_errors() {
        assert!(import_opml("").is_err());
        assert!(import_opml("   ").is_err());
    }

    #[test]
    fn import_no_body_errors() {
        assert!(import_opml("<opml><head><title>x</title></head></opml>").is_err());
    }

    #[test]
    fn import_no_outline_errors() {
        let opml = "<opml><head/><body></body></opml>";
        assert!(import_opml(opml).is_err());
    }

    #[test]
    fn import_unclosed_errors() {
        let opml = "<opml><head/><body><outline text=\"根\"></opml>";
        assert!(import_opml(opml).is_err());
    }

    #[test]
    fn import_multiple_roots_errors() {
        let opml = "<opml><head/><body><outline text=\"A\"/><outline text=\"B\"/></body></opml>";
        assert!(import_opml(opml).is_err());
    }

    #[test]
    fn import_generates_uuids() {
        let opml = r#"<opml><head/><body>
          <outline text="根"><outline text="子"/></outline>
        </body></opml>"#;
        let c = import_opml(opml).unwrap();
        assert_ne!(c.root.id, c.root.children[0].id);
        assert_eq!(c.root.id.len(), 36);
    }

    // ===== 往返一致性 =====

    #[test]
    fn roundtrip_complex_tree() {
        let original = make_content(make_node_with(
            "学习计划",
            vec![
                make_node_with(
                    "React",
                    vec![MNode::new("Hooks"), MNode::new("Perf")],
                ),
                Node::new("Vue"),
                make_node_with(
                    "项目",
                    vec![make_node_with(
                        "v1",
                        vec![MNode::new("上线")],
                    )],
                ),
            ],
        ));
        let opml = export_opml(&original);
        let restored = import_opml(&opml).unwrap();
        assert_eq!(restored.root.topic, "学习计划");
        assert_eq!(restored.root.children.len(), 3);
        assert_eq!(restored.root.children[0].topic, "React");
        assert_eq!(restored.root.children[0].children.len(), 2);
        assert_eq!(restored.root.children[2].children[0].children[0].topic, "上线");
    }
}
