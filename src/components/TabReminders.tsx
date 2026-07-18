import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import type { Reminder } from "../types";
import "./TabReminders.css";

export default function TabReminders() {
  const content = useMindMapStore((s) => s.content);
  const selectedId = useMindMapStore((s) => s.selectedNodeId);
  const filePath = useMindMapStore((s) => s.filePath);
  const setAllReminders = useMindMapStore((s) => s.setAllReminders);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    trigger_at: defaultTrigger(),
    repeat: "none",
  });

  useEffect(() => {
    if (!selectedId) {
      setReminders([]);
      return;
    }
    invoke<Reminder[]>("get_reminders_for_node", { nodeId: selectedId })
      .then(setReminders)
      .catch((e) => console.error("[TabReminders] load", e));
  }, [selectedId, content]);

  if (!content) return <div className="tab-empty">未打开文档</div>;
  if (!selectedId) return <div className="tab-empty">未选中节点</div>;

  const handleAdd = async () => {
    if (!draft.title || !draft.trigger_at) return;
    const trigger = `${draft.trigger_at}:00`; // 加秒
    const reminder: Reminder = {
      id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      node_id: selectedId,
      source_file: filePath || "",
      title: draft.title,
      message: null,
      trigger_at: trigger,
      repeat_rule:
        draft.repeat === "daily"
          ? {
              type: "daily",
              time: draft.trigger_at.split("T")[1]?.substring(0, 5) || "09:00",
            }
          : draft.repeat === "interval"
          ? { type: "interval", value: 3, unit: "hours" }
          : null,
      priority: null,
      enabled: true,
      status: "pending",
      last_triggered_at: null,
      snoozed_until: null,
      next_trigger_at: trigger,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      const idx = await invoke<{ reminders: Reminder[] }>("upsert_reminder", { reminder });
      setReminders(idx.reminders.filter((r) => r.node_id === selectedId));
      setAllReminders(idx.reminders); // 同步全局缓存(画布沙漏)
      setAdding(false);
      setDraft({ title: "", trigger_at: defaultTrigger(), repeat: "none" });
    } catch (e) {
      alert("添加提醒失败: " + e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此提醒？")) return;
    try {
      const idx = await invoke<{ reminders: Reminder[] }>("delete_reminder", { id });
      setReminders(idx.reminders.filter((r) => r.node_id === selectedId));
      setAllReminders(idx.reminders);
    } catch (e) {
      alert("删除失败: " + e);
    }
  };

  const handleToggle = async (r: Reminder) => {
    const updated = { ...r, enabled: !r.enabled, updated_at: new Date().toISOString() };
    try {
      const idx = await invoke<{ reminders: Reminder[] }>("upsert_reminder", { reminder: updated });
      setReminders(idx.reminders.filter((x) => x.node_id === selectedId));
      setAllReminders(idx.reminders);
    } catch (e) {
      alert("切换失败: " + e);
    }
  };

  return (
    <div className="tab-pane tab-reminders">
      <div className="reminders-header">
        <h3 className="section-title">提醒（{reminders.length}）</h3>
        {!adding && (
          <button className="rem-add-btn" onClick={() => setAdding(true)}>
            + 添加
          </button>
        )}
      </div>

      {adding && (
        <div className="rem-add-form">
          <input
            type="text"
            placeholder="标题（如：复习 React）"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            autoFocus
          />
          <input
            type="datetime-local"
            value={draft.trigger_at}
            onChange={(e) =>
              setDraft({ ...draft, trigger_at: e.target.value })
            }
          />
          <select
            value={draft.repeat}
            onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}
          >
            <option value="none">单次</option>
            <option value="daily">每日</option>
            <option value="interval">间隔（默认 3 小时）</option>
          </select>
          <div className="rem-add-actions">
            <button className="rem-cancel" onClick={() => setAdding(false)}>
              取消
            </button>
            <button
              className="rem-save"
              onClick={handleAdd}
              disabled={!draft.title}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {reminders.length === 0 && !adding && (
        <p className="muted reminders-empty">该节点暂无提醒</p>
      )}

      {reminders.length > 0 && (
        <ul className="rem-list">
          {reminders.map((r) => (
            <li key={r.id} className={`rem-item ${!r.enabled ? "disabled" : ""}`}>
              <div className="rem-item-main">
                <div className="rem-title">⏰ {r.title}</div>
                <div className="rem-meta">
                  {formatTrigger(r.trigger_at)}
                  {r.repeat_rule && (
                    <span className="rem-repeat">
                      {" "}
                      · {describeRepeat(r.repeat_rule)}
                    </span>
                  )}
                </div>
              </div>
              <div className="rem-item-actions">
                <button
                  className="rem-toggle"
                  onClick={() => handleToggle(r)}
                  title={r.enabled ? "暂停" : "启用"}
                >
                  {r.enabled ? "⏸" : "▶"}
                </button>
                <button
                  className="rem-del"
                  onClick={() => handleDelete(r.id)}
                  title="删除"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rem-help">
        提醒系统将在 Phase 11.5.2 实现自动触发（系统通知 + 应用内弹窗）。
      </div>
    </div>
  );
}

function defaultTrigger(): string {
  // 默认 1 小时后
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTrigger(iso: string): string {
  // iso 可能是 "2026-07-15T15:30:00" 或 "2026-07-15 15:30:00"
  const normalized = iso.replace(" ", "T");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describeRepeat(rule: any): string {
  if (!rule) return "";
  if (rule.type === "daily") return `每日 ${rule.time || ""}`.trim();
  if (rule.type === "interval") {
    const unitName =
      rule.unit === "minutes" ? "分钟" : rule.unit === "hours" ? "小时" : "天";
    return `每 ${rule.value || 1} ${unitName}`;
  }
  return JSON.stringify(rule);
}
