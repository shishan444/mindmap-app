import { useState } from "react";
import { useMindMapStore } from "../store";
import "./LlmOperationHistory.css";

const OP_LABELS: Record<string, string> = {
  create_node: "新建节点",
  update_node: "修改节点",
  delete_node: "删除节点",
  move_node: "移动节点",
  attach_file: "附加文件",
};

const OP_ICONS: Record<string, string> = {
  create_node: "➕",
  update_node: "✏️",
  delete_node: "🗑",
  move_node: "📦",
  attach_file: "📎",
};

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

  return (
    <div className="llm-history-panel" role="log" aria-label="LLM 操作历史">
      <div className="llm-history-header">
        <span className="llm-history-title">🤖 LLM 操作</span>
        <span className="llm-history-count">{ops.length}</span>
        <button
          className="llm-history-close"
          onClick={() => setVisible(false)}
          title="关闭操作历史"
        >
          ✕
        </button>
      </div>
      <ul className="llm-history-list">
        {display.map((op: any) => (
          <li key={op.op_id} className="llm-history-item">
            <span className="llm-history-icon">{OP_ICONS[op.op_type] ?? "•"}</span>
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
    </div>
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
