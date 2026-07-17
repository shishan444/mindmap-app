use crate::error::{AppError, Result};
use crate::models::{Content, Node};

pub fn import_freemind(xml: &str) -> Result<Content> {
    let trimmed = xml.trim();
    if !trimmed.contains("<map") || !trimmed.contains("<node") {
        return Err(AppError::InvalidFormat("不是有效的 FreeMind .mm 文件".into()));
    }
    let start = trimmed.find("<node")
        .ok_or_else(|| AppError::InvalidFormat("缺少 node 标签".into()))?;
    let root = parse_node(&trimmed[start..])?;
    Ok(Content {
        version: "1.0.0".to_string(),
        root,
        canvas_state: crate::models::CanvasState {
            zoom: 1.0, pan_x: 0.0, pan_y: 0.0, selected_node_id: None,
        },
    })
}

fn parse_node(xml: &str) -> Result<Node> {
    let text = extract_attr(xml, "TEXT").unwrap_or_default();
    let mut node = Node::new(decode_xml(&text));

    let self_close = xml.find("/>");
    let open_close = xml.find(">");

    // 自闭合标签，无子节点
    if let Some(sc) = self_close {
        if open_close.is_none() || sc <= open_close.unwrap() {
            return Ok(node);
        }
    }

    // 开放标签：在 > 之后找子 <node
    let gt = open_close.ok_or_else(|| AppError::InvalidFormat("标签未闭合".into()))?;
    let inner = &xml[gt + 1..];
    let mut pos = 0;

    while pos < inner.len() {
        if let Some(rel) = inner[pos..].find("<node") {
            let abs = pos + rel;
            let rest = &inner[abs..];
            if let Some(sc2) = rest.find("/>") {
                if sc2 < rest.find(">").unwrap_or(usize::MAX) {
                    // 子自闭合
                    node.children.push(parse_node(&rest[..sc2 + 2])?);
                    pos = abs + sc2 + 2;
                    continue;
                }
            }
            // 子开放标签，找 </node>
            if let Some(oc2) = rest.find(">") {
                let after = abs + oc2 + 1;
                if let Some(end) = inner[after..].find("</node>") {
                    let sub = &inner[abs..after + end + 7];
                    node.children.push(parse_node(sub)?);
                    pos = after + end + 7;
                    continue;
                }
            }
            break;
        } else {
            break;
        }
    }

    Ok(node)
}

fn extract_attr(xml: &str, attr: &str) -> Option<String> {
    let p = format!("{}=\"", attr);
    let s = xml.find(&p)? + p.len();
    let rest = &xml[s..];
    let e = rest.find('"')?;
    Some(rest[..e].to_string())
}

fn decode_xml(s: &str) -> String {
    s.replace("&amp;", "&").replace("&lt;", "<")
     .replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn import_simple() {
        let xml = r#"<map><node TEXT="根"><node TEXT="子1"/><node TEXT="子2"/></node></map>"#;
        let c = import_freemind(xml).unwrap();
        assert_eq!(c.root.topic, "根");
        assert_eq!(c.root.children.len(), 2);
    }
    #[test]
    fn import_nested() {
        let xml = r#"<map><node TEXT="根"><node TEXT="A"><node TEXT="B"/></node></node></map>"#;
        let c = import_freemind(xml).unwrap();
        assert_eq!(c.root.children[0].children[0].topic, "B");
    }
    #[test]
    fn import_entities() {
        assert_eq!(import_freemind(r#"<map><node TEXT="a &amp; b"/></map>"#).unwrap().root.topic, "a & b");
    }
    #[test]
    fn import_invalid() { assert!(import_freemind("not xml").is_err()); }
}
