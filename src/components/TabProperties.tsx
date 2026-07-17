import { useState } from "react";
import { useMindMapStore } from "../store";
import type { Priority } from "../types";

const EMOJI_SETS: { label: string; emojis: string[] }[] = [
  { label: "常用", emojis: ["⭐", "❤️", "✅", "❌", "🔥", "💡", "📌", "⚠️", "🎯", "🚀", "✨", "💪"] },
  { label: "状态", emojis: ["✓", "✗", "❓", "❗", "⏰", "🔒", "🔓", "🔄", "⚡", "🎉"] },
  { label: "优先级", emojis: ["🔴", "🟠", "🟡", "🟢", "🔵", "🟣"] },
  { label: "事物", emojis: ["📚", "💻", "🎵", "🖼️", "📊", "🔧", "🏠", "💰", "📈", "📅"] },
];

export default function TabProperties() {
  const content = useMindMapStore((s) => s.content);
  const selectedId = useMindMapStore((s) => s.selectedNodeId);
  const mind = useMindMapStore((s) => s.mindInstance);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const node = findNode(content?.root ?? null, selectedId);
  if (!node) {
    return (
      <div className="tab-pane">
        <h3 className="section-title">节点属性</h3>
        <p className="tab-empty">未选中节点</p>
      </div>
    );
  }

  const applyIcons = (icons: string[]) => {
    if (!mind || !selectedId) return;
    const tpc = mind.findEle?.(selectedId) || mind.currentNodes?.[0];
    if (!tpc) return;
    try {
      mind.reshapeNode(tpc, { icons });
    } catch (e) {
      console.error("[TabProperties] reshapeNode icons 失败", e);
    }
  };

  const toggleIcon = (emoji: string) => {
    const current = node.icons || [];
    if (current.includes(emoji)) {
      applyIcons(current.filter((e) => e !== emoji));
    } else {
      applyIcons([...current, emoji]);
    }
  };

  return (
    <div className="tab-pane">
      <h3 className="section-title">节点属性</h3>

      <label className="field">
        <span className="field-label">主题</span>
        <input className="field-input" value={node.topic || ""} readOnly />
      </label>

      <label className="field">
        <span className="field-label">节点 ID</span>
        <input className="field-input monospace" value={node.id} readOnly />
      </label>

      <div className="field">
        <span className="field-label">优先级</span>
        <div className="priority-row">
          {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => (
            <span
              key={p}
              className={`priority-chip priority-chip-${p.toLowerCase()} ${
                node.priority === p ? "active" : ""
              } ${!node.priority ? "empty" : ""}`}
            >
              {p}
            </span>
          ))}
          {!node.priority && <span className="priority-chip empty active">未设置</span>}
        </div>
      </div>

      <label className="field">
        <span className="field-label">备注</span>
        <textarea
          className="field-textarea"
          value={node.note || ""}
          readOnly
          placeholder="无备注"
        />
      </label>

      <div className="field">
        <span className="field-label">图标</span>
        <div className="icons-row">
          {(node.icons || []).length === 0 ? (
            <span className="muted">无</span>
          ) : (
            (node.icons || []).map((ic: string, i: number) => (
              <span
                key={i}
                className="icon-chip"
                style={{ cursor: "pointer" }}
                onClick={() => toggleIcon(ic)}
                title="点击移除"
              >
                {ic} ✕
              </span>
            ))
          )}
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            style={{
              padding: "2px 6px", fontSize: 11, border: "1px solid #d1d1d1",
              borderRadius: 4, cursor: "pointer", background: "#fff",
            }}
          >
            {showEmojiPicker ? "收起" : "+ 添加"}
          </button>
        </div>
        {showEmojiPicker && (
          <div style={{ marginTop: 8, padding: 8, background: "#f9f9f9", borderRadius: 4, border: "1px solid #e8e8e8" }}>
            {EMOJI_SETS.map((set) => (
              <div key={set.label} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>{set.label}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                  {set.emojis.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => toggleIcon(emoji)}
                      style={{
                        width: 28, height: 28, fontSize: 16, border: "none",
                        borderRadius: 4, cursor: "pointer",
                        background: (node.icons || []).includes(emoji) ? "#e8f4ff" : "transparent",
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function findNode(root: any, id: string | null): any | null {
  if (!root || !id) return null;
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}
