import { useMindMapStore } from "../store";
import { logUserAction } from "../utils/devLogger";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./Toolbar.css";

interface Props {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
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
  searchQuery,
  onSearchChange,
  onSearchNext,
  searchResultCount,
  searchCurrentIndex,
}: Props) {
  const dirty = useMindMapStore((s) => s.dirty);
  const content = useMindMapStore((s) => s.content);

  // 窗口拖动 JS 兜底:与 data-tauri-drag-region 双保险。
  // 仅当 mousedown 落在容器/grip 本身(非按钮等子元素)且为主键时启动原生拖动。
  const dragWindow = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    getCurrentWindow().startDragging().catch(() => { /* 浏览器/测试环境忽略 */ });
  };

  return (
    <div className="toolbar-wrap">
      {/* 单导航:高频操作精简栏(新建/打开/保存/搜索/拖动抓手)。
          文档级低频能力(导入/导出/最近文件/优先级)走系统菜单栏。 */}
      <div className="toolbar" data-tauri-drag-region onMouseDown={dragWindow}>
        <button
          className="tb-primary"
          title="新建文档"
          onClick={() => { logUserAction("toolbar.click", { target: "new" }); onNew(); }}
        >
          新建文档
        </button>
        <button
          className="tb-btn"
          title="打开"
          onClick={() => { logUserAction("toolbar.click", { target: "open" }); onOpen(); }}
        >
          打开
        </button>
        <button
          className="tb-btn"
          title="保存"
          onClick={() => { logUserAction("toolbar.click", { target: "save" }); onSave(); }}
          disabled={!content}
        >
          {dirty && <span className="dirty-dot"></span>}保存
        </button>

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
