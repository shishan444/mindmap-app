import { useMindMapStore } from "../store";
import type { MindNode } from "../types";
import "./Common.css";

// 从 content 树中查找节点
function findNode(root: MindNode | null, id: string | null): MindNode | null {
  if (!root || !id) return null;
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export default function TabStyle() {
  const mind = useMindMapStore((s) => s.mindInstance);
  const selectedNodeId = useMindMapStore((s) => s.selectedNodeId);
  const content = useMindMapStore((s) => s.content);

  const node = findNode(content?.root ?? null, selectedNodeId);
  // mind-elixir style 格式：{ fontSize: "16px", color: "#fff", ... }
  const style = (node?.style ?? {}) as Record<string, string>;

  if (!node) {
    return (
      <div className="tab-pane">
        <h3 className="section-title">样式</h3>
        <p className="tab-empty">未选中节点</p>
      </div>
    );
  }

  const applyStyle = (key: string, value: string | undefined) => {
    if (!mind || !selectedNodeId) return;
    const tpc =
      typeof mind.findEle === "function"
        ? mind.findEle(selectedNodeId)
        : mind.currentNodes?.[0];
    if (!tpc) return;
    const newStyle = { ...style };
    if (value === undefined || value === "") {
      delete newStyle[key];
    } else {
      newStyle[key] = value;
    }
    try {
      mind.reshapeNode(tpc, { style: newStyle });
    } catch (e) {
      console.error("[TabStyle] reshapeNode 失败", e);
    }
  };

  return (
    <div className="tab-pane">
      <h3 className="section-title">样式</h3>

      <div className="field">
        <label className="field-label">字号</label>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="range"
            min={10}
            max={32}
            defaultValue={parseInt(style.fontSize) || 14}
            onChange={(e) => applyStyle("fontSize", e.target.value + "px")}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 12, color: "#666", minWidth: 32 }}>
            {parseInt(style.fontSize) || 14}px
          </span>
        </div>
      </div>

      <div className="field">
        <label className="field-label">文字颜色</label>
        <input
          type="color"
          value={style.color || "#333333"}
          onChange={(e) => applyStyle("color", e.target.value)}
          style={{ width: "100%", height: 30, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer" }}
        />
      </div>

      <div className="field">
        <label className="field-label">背景颜色</label>
        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="color"
            value={style.background || "#ffffff"}
            onChange={(e) => applyStyle("background", e.target.value)}
            style={{ flex: 1, height: 30, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer" }}
          />
          <button
            onClick={() => applyStyle("background", undefined)}
            style={{ padding: "4px 8px", fontSize: 11, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer", background: "#fff" }}
          >
            清除
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">字体粗细</label>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => applyStyle("fontWeight", style.fontWeight === "bold" ? "normal" : "bold")}
            style={{
              flex: 1, padding: "4px 8px", fontSize: 12, cursor: "pointer",
              border: "1px solid #d1d1d1", borderRadius: 4,
              background: style.fontWeight === "bold" ? "#4dc4ff" : "#fff",
              color: style.fontWeight === "bold" ? "#fff" : "#333",
              fontWeight: style.fontWeight === "bold" ? "bold" : "normal",
            }}
          >
            {style.fontWeight === "bold" ? "✓ 粗体" : "粗体"}
          </button>
          <button
            onClick={() => applyStyle("textDecoration", style.textDecoration === "underline" ? undefined : "underline")}
            style={{
              flex: 1, padding: "4px 8px", fontSize: 12, cursor: "pointer",
              border: "1px solid #d1d1d1", borderRadius: 4,
              background: style.textDecoration === "underline" ? "#4dc4ff" : "#fff",
              color: style.textDecoration === "underline" ? "#fff" : "#333",
              textDecoration: style.textDecoration === "underline" ? "underline" : "none",
            }}
          >
            {style.textDecoration === "underline" ? "✓ 下划线" : "下划线"}
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">边框</label>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="color"
            value={style.border?.match(/#[0-9a-f]{6}/i)?.[0] || "#cccccc"}
            onChange={(e) => applyStyle("border", `2px solid ${e.target.value}`)}
            style={{ width: 40, height: 30, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer" }}
          />
          <button
            onClick={() => applyStyle("border", undefined)}
            style={{ padding: "4px 8px", fontSize: 11, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer", background: "#fff" }}
          >
            清除
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">节点宽度</label>
        <input
          type="range"
          min={60}
          max={300}
          defaultValue={parseInt(style.width) || 0}
          onChange={(e) => applyStyle("width", e.target.value + "px")}
          style={{ width: "100%" }}
          disabled={!style.width}
        />
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <button
            onClick={() => applyStyle("width", "fit-content")}
            style={{ flex: 1, padding: "3px 6px", fontSize: 11, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer", background: style.width === "fit-content" ? "#e8f4ff" : "#fff" }}
          >
            自动
          </button>
          <button
            onClick={() => applyStyle("width", "200px")}
            style={{ flex: 1, padding: "3px 6px", fontSize: 11, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer", background: style.width === "200px" ? "#e8f4ff" : "#fff" }}
          >
            固定 200px
          </button>
          <button
            onClick={() => applyStyle("width", undefined)}
            style={{ flex: 1, padding: "3px 6px", fontSize: 11, border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer", background: "#fff" }}
          >
            清除
          </button>
        </div>
      </div>
    </div>
  );
}
