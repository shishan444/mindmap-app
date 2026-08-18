import { useEffect, useState } from "react";
import { useMindMapStore } from "../store";
import type { Priority } from "../types";
import { PRIORITY_LABELS } from "../types";
import { logUserAction } from "../utils/devLogger";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
    <>
      <div className="dd-sep" />
      <div className="dd-group-label">最近文件</div>
      {recentFiles.map((f) => (
        <button
          key={f.path}
          className="dd-item"
          onClick={() => {
            logUserAction("toolbar.openRecent", { path: f.path });
            openRecent(f.path, f.name);
          }}
          title={f.path}
        >
          <span className="dd-label">{f.name}</span>
        </button>
      ))}
    </>
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
  searchQuery,
  onSearchChange,
  onSearchNext,
  searchResultCount,
  searchCurrentIndex,
}: Props) {
  // 窗口拖动 JS 兜底:与 data-tauri-drag-region 双保险。
  // 仅当 mousedown 落在容器/grip 本身(非按钮等子元素)且为主键时启动原生拖动。
  const dragWindow = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    getCurrentWindow().startDragging().catch(() => { /* 浏览器/测试环境忽略 */ });
  };


  const dirty = useMindMapStore((s) => s.dirty);
  const content = useMindMapStore((s) => s.content);

  return (
    <div className="toolbar-wrap">


      {/* ============ 层2:工具栏(高频操作,文字按钮) ============ */}
      <div className="toolbar" data-tauri-drag-region onMouseDown={dragWindow}>
        <button
          className="tb-primary"
          title="新建文档"
          onClick={() => { logUserAction("toolbar.click", { target: "new" }); onNew(); }}
        >
          新建文档
        </button>
        <div className="priority-dropdown">
          <button
            className="tb-btn"
            title="打开"
            onClick={() => { logUserAction("toolbar.click", { target: "open" }); onOpen(); }}
          >
            打开
          </button>
          <div className="dropdown-menu">
            <OpenDropdown />
          </div>
        </div>
        <button
          className="tb-btn"
          title="保存"
          onClick={() => { logUserAction("toolbar.click", { target: "save" }); onSave(); }}
          disabled={!content}
        >
          {dirty && <span className="dirty-dot"></span>}保存
        </button>
        <div className="tb-divider" />
        <div className="priority-dropdown">
          <button className="tb-btn" title="优先级" disabled={!content}>
            优先级 <span className="caret">▾</span>
          </button>
          <div className="dropdown-menu">
            {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => (
              <button
                key={p}
                className="dropdown-item"
                onClick={() => { logUserAction("priority.set", { priority: p }); onSetPriority(p); }}
              >
                <span className={`priority-dot priority-${p.toLowerCase()}`}></span>
                {PRIORITY_LABELS[p]}
              </button>
            ))}
            <div className="dropdown-divider" />
            <button className="dropdown-item" onClick={() => onSetPriority("P3" as Priority)}>
              清除
            </button>
          </div>
        </div>
        <div className="priority-dropdown">
          <button className="tb-btn" title="导出" disabled={!content}>
            导出 <span className="caret">▾</span>
          </button>
          <div className="dropdown-menu">
            <button className="dropdown-item" onClick={onExportPng}>PNG 图片</button>
            <button className="dropdown-item" onClick={onExportSvg}>SVG 矢量</button>
            <button className="dropdown-item" onClick={onExportMarkdown}>Markdown (.md)</button>
            <button className="dropdown-item" onClick={onExportOpml}>OPML (.opml)</button>
          </div>
        </div>
        <div className="priority-dropdown">
          <button className="tb-btn" title="导入">
            导入 <span className="caret">▾</span>
          </button>
          <div className="dropdown-menu">
            <button className="dropdown-item" onClick={onImportMarkdown}>Markdown (.md)</button>
            <button className="dropdown-item" onClick={onImportOpml}>OPML (.opml)</button>
          </div>
        </div>

        <div className="toolbar-spacer" />

        <div className="search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            id="search-input"
            type="text"
            placeholder="搜索节点…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearchNext();
              if (e.key === "Escape") {
                onSearchChange("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchResultCount > 0 && (
            <span className="search-count">{searchCurrentIndex + 1}/{searchResultCount}</span>
          )}
        </div>

        {/* 拖动抓手:视觉标识窗口拖动区(Overlay 标题栏下唯一明确抓手) */}
        <div className="tb-grip" data-tauri-drag-region title="拖动窗口" aria-label="拖动窗口" onMouseDown={dragWindow}></div>
      </div>
    </div>
  );
}
