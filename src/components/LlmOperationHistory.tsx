/**
 * LLM Operation History 侧栏
 *
 * 显示最近 10 个 LLM 操作,让用户看到 AI 做了什么。
 * 数据从 store.llmOperations 取(operationBridge 维护)
 */

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

export default function LlmOperationHistory() {
  const ops = useMindMapStore((s) => s.llmOperations ?? []);
  const collapsed = useMindMapStore((s) => s.sidebarCollapsed);

  if (collapsed || ops.length === 0) return null;

  const recent = ops.slice(-10).reverse();

  return (
    <div className="llm-history-panel" role="log" aria-label="LLM 操作历史">
      <div className="llm-history-header">
        <span className="llm-history-title">🤖 LLM 操作</span>
        <span className="llm-history-count">{ops.length}</span>
      </div>
      <ul className="llm-history-list">
        {recent.map((op: any) => (
          <li key={op.op_id} className="llm-history-item">
            <span className="llm-history-icon">{OP_ICONS[op.op_type] ?? "•"}</span>
            <span className="llm-history-label">{OP_LABELS[op.op_type] ?? op.op_type}</span>
            <span className="llm-history-detail">{describeOp(op)}</span>
            <span className="llm-history-time">{formatTime(op.received_at_ms)}</span>
          </li>
        ))}
      </ul>
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
  const now = Date.now();
  const diff = Math.floor((now - ms) / 1000);
  if (diff < 60) return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  return `${Math.floor(diff / 3600)}h 前`;
}
