import { useMindMapStore } from "../store";
import "./StatusBar.css";

export default function StatusBar() {
  const nodeCount = useMindMapStore((s) => s.nodeCount);
  const dirty = useMindMapStore((s) => s.dirty);
  const saveStatus = useMindMapStore((s) => s.saveStatus);
  const lastSavedAt = useMindMapStore((s) => s.lastSavedAt);
  const filePath = useMindMapStore((s) => s.filePath);
  const reminders = useMindMapStore((s) => s.allReminders);

  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-item status-save">
          {saveStatus === "saving" ? (
            "保存中…"
          ) : saveStatus === "error" ? (
            <span className="error">保存失败</span>
          ) : dirty ? (
            "● 未保存"
          ) : lastSavedAt ? (
            <>
              <span className="status-dot"></span>已保存 {formatTime(lastSavedAt)}
            </>
          ) : (
            "—"
          )}
        </span>
        <span className="status-divider">·</span>
        <span className="status-item">{nodeCount} 节点</span>
        {filePath && (
          <>
            <span className="status-divider">·</span>
            <span className="status-item status-file-path" title={filePath}>
              {filePath}
            </span>
          </>
        )}
      </div>
      <div className="status-right">
        <span className="status-item">就绪</span>
        <span className="status-divider">·</span>
        <span className="status-item">{reminders?.length ?? 0} 提醒</span>
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
