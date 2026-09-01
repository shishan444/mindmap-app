import { useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useMindMapStore } from "../store";
import "./LlmOperationHistory.css";

const OP_LABELS: Record<string, string> = {
  create_node: "新建节点",
  update_node: "修改节点",
  delete_node: "删除节点",
  move_node: "移动节点",
  attach_file: "附加文件",
};

// 操作类型 → 线性 SVG 图标(玻璃浮层体系,emoji 已按设计纪律清零)
function opIconSvg(opType: string): ReactElement {
  const p = (d: string, extra?: ReactElement) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {extra}
    </svg>
  );
  switch (opType) {
    case "create_node":
      return p("M12 5v14M5 12h14");
    case "update_node":
      return p("M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z");
    case "delete_node":
      return p("M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6");
    case "move_node":
      return p("M5 12h14M13 6l6 6-6 6");
    case "attach_file":
      return p("M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48");
    default:
      return p("M12 12h.01");
  }
}

// LLM 语义图标(bot)
function botIconSvg(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 8V4M8 4h8" />
      <path d="M9 13v2M15 13v2" />
    </svg>
  );
}

const COLLAPSED_COUNT = 3;
const PAGE_SIZE = 10;

export default function LlmOperationHistory() {
  const ops = useMindMapStore((s) => s.llmOperations ?? []);
  const collapsed = useMindMapStore((s) => s.sidebarCollapsed);
  const [visible, setVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);

  if (collapsed || ops.length === 0 || !visible) return null;

  const recent = ops.slice().reverse();
  const display = expanded
    ? recent.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    : recent.slice(0, COLLAPSED_COUNT);
  const totalPages = expanded ? Math.ceil(recent.length / PAGE_SIZE) : 1;

  // ★ 根因修复(浮层布局劫持):App.css 的 `.app-root > *:not(.stage-fx)`
  // 把 app-root 所有直接子元素强制 position:relative(特异性 0,2,0 > 本组件
  // 类选择器 0,1,0),fixed 被覆盖 → 面板变流内元素挤压 status-bar。
  // 修复:Portal 挂 document.body,物理脱离 .app-root(浮窗的语义正解)。
  return createPortal(
    <div className="llm-history-panel" role="log" aria-label="LLM 操作历史">
      <div className="llm-history-header">
        <span className="llm-history-title">{botIconSvg()} LLM 操作</span>
        <span className="llm-history-count">{ops.length}</span>
        <button
          className="llm-history-close"
          onClick={() => setVisible(false)}
          title="关闭操作历史"
        >
          ×
        </button>
      </div>
      <ul className="llm-history-list">
        {display.map((op: any) => (
          <li key={op.op_id} className="llm-history-item">
            <span className="llm-history-icon">{opIconSvg(op.op_type)}</span>
            <span className="llm-history-label">{OP_LABELS[op.op_type] ?? op.op_type}</span>
            <span className="llm-history-detail">{describeOp(op)}</span>
            <span className="llm-history-time">{formatTime(op.received_at_ms)}</span>
          </li>
        ))}
      </ul>
      <div className="llm-history-footer">
        {!expanded && ops.length > COLLAPSED_COUNT && (
          <button
            className="llm-history-more"
            onClick={() => setExpanded(true)}
          >
            全部({ops.length}) ▾
          </button>
        )}
        {expanded && (
          <>
            <button
              className="llm-history-more"
              onClick={() => setExpanded(false)}
            >
              收起 ▴
            </button>
            {totalPages > 1 && (
              <span className="llm-history-pager">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  ‹
                </button>
                <span>{page + 1}/{totalPages}</span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                >
                  ›
                </button>
              </span>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function describeOp(op: any): string {
  switch (op.op_type) {
    case "create_node":
      return `"${op.payload?.topic ?? "?"}"`;
    case "update_node":
      return op.payload?.node_id ?? "?";
    case "delete_node":
      return op.payload?.node_id ?? "?";
    case "move_node":
      return `${op.payload?.node_id ?? "?"} → ${op.payload?.to_parent_id ?? "?"}`;
    case "attach_file":
      return (op.payload?.file_path ?? "").split("/").pop() ?? "?";
    default:
      return "";
  }
}

function formatTime(ms?: number): string {
  if (!ms) return "";
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  return `${Math.floor(diff / 3600)}h 前`;
}
