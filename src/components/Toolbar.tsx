import { useEffect, useState } from "react";
import { useMindMapStore } from "../store";
import type { Priority } from "../types";
import { PRIORITY_LABELS } from "../types";
import { logUserAction } from "../utils/devLogger";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
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

function OpenDropdown() {
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; name: string; pinned?: boolean }>>([]);
  const dirty = useMindMapStore((s) => s.dirty);

  useEffect(() => {
    invoke<{ files: Array<{ path: string; name: string; pinned?: boolean }> }>("get_recent_files")
      .then((r) => setRecentFiles(r.files?.slice(0, 5) ?? []))
      .catch(() => {});
  }, []);

  const checkDirty = (): boolean => {
    if (dirty && !confirm("当前文档有未保存的修改,是否继续打开?")) return false;
    return true;
  };

  const openRecent = async (path: string, name: string) => {
    if (!checkDirty()) return;
    try {
      const windows = await invoke<Array<{ label: string; title: string }>>("list_windows");
      const existing = windows.find((w) => w.title.includes(name));
      if (existing) {
        await invoke("focus_window", { label: existing.label });
        return;
      }
      await invoke("add_recent_file", { path, name });
      await invoke("set_last_opened_file", { path });
      await invoke("create_new_window", { mode: "open", mmapPath: path });
    } catch (e) {
      console.error("[Toolbar] 打开最近文件失败", e);
      alert("打开失败: " + e);
    }
  };

  if (recentFiles.length === 0) return null;

  return (
    <div className="dropdown-menu">
      <div className="dropdown-divider" />
      <div style={{ padding: "4px 12px", fontSize: 11, color: "#999" }}>🕐 最近文件</div>
      {recentFiles.map((f) => (
        <button
          key={f.path}
          className="dropdown-item"
          onClick={() => {
            logUserAction("toolbar.openRecent", { path: f.path });
            openRecent(f.path, f.name);
          }}
          title={f.path}
        >
          📄 {f.name}
        </button>
      ))}
    </div>
  );
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
  // 子窗口判断(macOS 关闭按钮失效时,工具栏显示"关闭窗口"兜底按钮)
  const isChildWindow = (() => {
    try {
      return getCurrentWindow().label !== "main";
    } catch {
      return false;
    }
  })();

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
        <div className="priority-dropdown" title="打开文件">
          <button
            className="tb-btn"
            onClick={() => {
              logUserAction("toolbar.click", { target: "open" });
              onOpen();
            }}
          >
            📂
          </button>
          <OpenDropdown />
        </div>
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
        {/* 子窗口专属:显示"关闭窗口"按钮(macOS 关闭按钮失效时的兜底) */}
        {isChildWindow && (
          <button
            className="tb-btn"
            onClick={async () => {
              try {
                const { getCurrentWindow } = await import("@tauri-apps/api/window");
                await getCurrentWindow().destroy();
              } catch (e) {
                console.error("[Toolbar] 关闭窗口失败", e);
                alert("关闭失败: " + e);
              }
            }}
            title="关闭此窗口(子窗口专用)"
            style={{ color: "#e74c3c" }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
