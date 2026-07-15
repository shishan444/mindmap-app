import { useMindMapStore } from "../store";
import type { Priority } from "../types";
import { PRIORITY_LABELS } from "../types";
import "./Toolbar.css";

interface Props {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExportPng: () => void;
  onSetPriority: (p: Priority) => void;
}

export default function Toolbar({
  onNew,
  onOpen,
  onSave,
  onExportPng,
  onSetPriority,
}: Props) {
  const dirty = useMindMapStore((s) => s.dirty);
  const content = useMindMapStore((s) => s.content);

  return (
    <div className="toolbar">
      <div className="toolbar-group brand">
        <span className="brand-icon">🧠</span>
      </div>

      <div className="toolbar-group">
        <button className="tb-btn" onClick={onNew} title="新建">
          📝
        </button>
        <button className="tb-btn" onClick={onOpen} title="打开">
          📂
        </button>
        <button
          className="tb-btn"
          onClick={onSave}
          title="保存"
          disabled={!content}
        >
          💾{dirty ? "*" : ""}
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <div className="priority-dropdown" title="设置优先级">
          <button className="tb-btn" disabled={!content}>
            🏷 优先级 ▾
          </button>
          <div className="dropdown-menu">
            {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => (
              <button
                key={p}
                className="dropdown-item"
                onClick={() => onSetPriority(p)}
              >
                <span className={`priority-dot priority-${p.toLowerCase()}`}></span>
                {PRIORITY_LABELS[p]}
              </button>
            ))}
            <div className="dropdown-divider" />
            <button
              className="dropdown-item"
              onClick={() => onSetPriority("P3" as Priority)}
            >
              清除
            </button>
          </div>
        </div>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          className="tb-btn"
          onClick={onExportPng}
          title="导出 PNG"
          disabled={!content}
        >
          📤 PNG
        </button>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <span className="tb-shortcut-hint">Tab=子节点 · Enter=兄弟 · F2=编辑</span>
      </div>
    </div>
  );
}
