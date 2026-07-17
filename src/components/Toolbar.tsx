import { useMindMapStore } from "../store";
import type { Priority } from "../types";
import { PRIORITY_LABELS } from "../types";
import { logUserAction } from "../utils/devLogger";
import "./Toolbar.css";

interface Props {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onExportMarkdown: () => void;
  onExportOpml: () => void;
  onImportMarkdown: () => void;
  onImportOpml: () => void;
  onSetPriority: (p: Priority) => void;
  onOpenPreferences: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchNext: () => void;
  searchResultCount: number;
  searchCurrentIndex: number;
}

export default function Toolbar({
  onNew,
  onOpen,
  onSave,
  onExportPng,
  onExportSvg,
  onExportMarkdown,
  onExportOpml,
  onImportMarkdown,
  onImportOpml,
  onSetPriority,
  onOpenPreferences,
  searchQuery,
  onSearchChange,
  onSearchNext,
  searchResultCount,
  searchCurrentIndex,
}: Props) {
  const dirty = useMindMapStore((s) => s.dirty);
  const content = useMindMapStore((s) => s.content);

  return (
    <div className="toolbar">
      <div className="toolbar-group brand">
        <span className="brand-icon">🧠</span>
      </div>

      <div className="toolbar-group">
        <button
          className="tb-btn"
          onClick={() => {
            logUserAction("toolbar.click", { target: "new" });
            onNew();
          }}
          title="新建"
        >
          📝
        </button>
        <button
          className="tb-btn"
          onClick={() => {
            logUserAction("toolbar.click", { target: "open" });
            onOpen();
          }}
          title="打开"
        >
          📂
        </button>
        <button
          className="tb-btn"
          onClick={() => {
            logUserAction("toolbar.click", { target: "save" });
            onSave();
          }}
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
                onClick={() => {
                  logUserAction("priority.set", { priority: p });
                  onSetPriority(p);
                }}
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
        <div className="priority-dropdown" title="导出">
          <button className="tb-btn" disabled={!content}>
            📤 导出 ▾
          </button>
          <div className="dropdown-menu">
            <button className="dropdown-item" onClick={onExportPng}>
              📷 PNG 图片
            </button>
            <button className="dropdown-item" onClick={onExportSvg}>
              📐 SVG 矢量
            </button>
            <button className="dropdown-item" onClick={onExportMarkdown}>
              📝 Markdown (.md)
            </button>
            <button className="dropdown-item" onClick={onExportOpml}>
              🌐 OPML (.opml)
            </button>
          </div>
        </div>
        <div className="priority-dropdown" title="导入">
          <button className="tb-btn">
            📥 导入 ▾
          </button>
          <div className="dropdown-menu">
            <button className="dropdown-item" onClick={onImportMarkdown}>
              📝 Markdown (.md)
            </button>
            <button className="dropdown-item" onClick={onImportOpml}>
              🌐 OPML (.opml)
            </button>
          </div>
        </div>
      </div>

      <div className="toolbar-spacer" />

      <div className="toolbar-group">
        <input
          id="search-input"
          type="text"
          placeholder="搜索... (Cmd+F)"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearchNext();
            if (e.key === "Escape") {
              onSearchChange("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{
            width: 160, padding: "3px 8px", fontSize: 12,
            border: "1px solid #d1d1d1", borderRadius: 4, outline: "none",
          }}
        />
        {searchResultCount > 0 && (
          <span style={{ fontSize: 11, color: "#888", minWidth: 30 }}>
            {searchCurrentIndex + 1}/{searchResultCount}
          </span>
        )}
      </div>

      <div className="toolbar-group">
        <span className="tb-shortcut-hint">Tab=子 · Enter=兄 · F2=编辑 · Cmd+.=折叠</span>
        <button className="tb-btn" onClick={onOpenPreferences} title="偏好设置">⚙</button>
      </div>
    </div>
  );
}
