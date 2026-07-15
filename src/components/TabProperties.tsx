import { useMindMapStore } from "../store";
import type { Priority } from "../types";

export default function TabProperties() {
  const content = useMindMapStore((s) => s.content);
  const selectedId = useMindMapStore((s) => s.selectedNodeId);

  if (!content) return <div className="tab-empty">未打开文档</div>;
  const node = findNode(content.root, selectedId);
  if (!node) return <div className="tab-empty">未选中节点</div>;

  return (
    <div className="tab-pane">
      <h3 className="section-title">节点属性</h3>

      <label className="field">
        <span className="field-label">主题</span>
        <input
          className="field-input"
          type="text"
          value={node.topic}
          readOnly
        />
      </label>

      <label className="field">
        <span className="field-label">节点 ID</span>
        <input
          className="field-input monospace"
          type="text"
          value={node.id}
          readOnly
        />
      </label>

      <div className="field">
        <span className="field-label">优先级</span>
        <div className="priority-row">
          {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => (
            <span
              key={p}
              className={`priority-chip ${
                node.priority === p ? "active" : ""
              } priority-chip-${p.toLowerCase()}`}
            >
              {p}
            </span>
          ))}
          {!node.priority && (
            <span className="priority-chip empty">未设置</span>
          )}
        </div>
      </div>

      <label className="field">
        <span className="field-label">备注</span>
        <textarea
          className="field-textarea"
          value={node.note || ""}
          placeholder="无备注"
          readOnly
          rows={4}
        />
      </label>

      <div className="field">
        <span className="field-label">图标</span>
        <div className="icons-row">
          {(node.icons || []).length === 0 ? (
            <span className="muted">无</span>
          ) : (
            (node.icons || []).map((ic: string, i: number) => (
              <span key={i} className="icon-chip">
                {ic}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function findNode(
  root: any,
  id: string | null,
): any | null {
  if (!id) return null;
  function dfs(node: any): any | null {
    if (!node) return null;
    if (node.id === id) return node;
    const children = node.children ?? [];
    for (const c of children) {
      const found = dfs(c);
      if (found) return found;
    }
    return null;
  }
  return dfs(root);
}
