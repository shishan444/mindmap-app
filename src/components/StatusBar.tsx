import { useMindMapStore } from "../store";
import "./StatusBar.css";

export default function StatusBar() {
  const nodeCount = useMindMapStore((s) => s.nodeCount);
  const dirty = useMindMapStore((s) => s.dirty);
  const saveStatus = useMindMapStore((s) => s.saveStatus);
  const lastSavedAt = useMindMapStore((s) => s.lastSavedAt);
  const filePath = useMindMapStore((s) => s.filePath);

  return (
    <div className="status-bar">
      <div className="status-left">
        <span>{nodeCount} 节点</span>
        <span className="status-divider">|</span>
        <span className="status-save">
          {saveStatus === "saving"
            ? "💾 保存中..."
            : saveStatus === "error"
            ? "⚠ 保存失败"
            : dirty
            ? "● 未保存"
            : lastSavedAt
            ? `💾 已保存 ${formatTime(lastSavedAt)}`
            : "—"}
        </span>
      </div>
      <div className="status-right">
        {filePath && (
          <span className="status-file-path" title={filePath}>
            {filePath}
          </span>
        )}
        <span className="status-divider">|</span>
        <span>⏰ 0 提醒</span>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
