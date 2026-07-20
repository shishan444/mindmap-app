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
  // editingId: null=不显示表单, "new"=添加模式, string=编辑该 id 的 reminder
  const [editingId, setEditingId] = useState<string | null>(null);
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

  // 进入"添加"模式:清空 draft,editingId="new"
  const startAdd = () => {
    setEditingId("new");
    setDraft({ title: "", trigger_at: defaultTrigger(), repeat: "none" });
  };

  // 进入"编辑"模式:预填现有 reminder 的值
  const startEdit = (r: Reminder) => {
    setEditingId(r.id);
    // datetime-local 需要 "YYYY-MM-DDTHH:MM"(无秒)
    const triggerLocal = (r.trigger_at || "").replace(" ", "T").substring(0, 16);
    let repeat = "none";
    if (r.repeat_rule) {
      if (r.repeat_rule.type === "daily") repeat = "daily";
      else if (r.repeat_rule.type === "interval") repeat = "interval";
    }
    setDraft({
      title: r.title,
      trigger_at: triggerLocal || defaultTrigger(),
      repeat,
    });
  };

  // 取消添加/编辑
  const handleCancel = () => {
    setEditingId(null);
    setDraft({ title: "", trigger_at: defaultTrigger(), repeat: "none" });
  };

  // 统一保存(添加或编辑)
  const handleSave = async () => {
    if (!draft.title || !draft.trigger_at) return;
    const trigger = `${draft.trigger_at}:00`;
    const repeat_rule =
      draft.repeat === "daily"
        ? {
            type: "daily" as const,
            time: draft.trigger_at.split("T")[1]?.substring(0, 5) || "09:00",
          }
        : draft.repeat === "interval"
        ? { type: "interval" as const, value: 3, unit: "hours" }
        : null;

    let reminder: Reminder;
    if (editingId && editingId !== "new") {
      // 编辑模式:保留 id / created_at / enabled,改其他字段
      const existing = reminders.find((r) => r.id === editingId);
      if (!existing) return;
      reminder = {
        ...existing,
        title: draft.title,
        trigger_at: trigger,
        repeat_rule,
        next_trigger_at: trigger,
        // 改时间 → 重置触发状态(下次会重新触发)
        status: "pending",
        last_triggered_at: null,
        snoozed_until: null,
        updated_at: new Date().toISOString(),
      };
    } else {
      // 添加模式:新 reminder
      reminder = {
        id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        node_id: selectedId,
        source_file: filePath || "",
        title: draft.title,
        message: null,
        trigger_at: trigger,
        repeat_rule,
        priority: null,
        enabled: true,
        status: "pending",
        last_triggered_at: null,
        snoozed_until: null,
        next_trigger_at: trigger,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    try {
      const idx = await invoke<{ reminders: Reminder[] }>("upsert_reminder", { reminder });
      setReminders(idx.reminders.filter((r) => r.node_id === selectedId));
      setAllReminders(idx.reminders);
      handleCancel();
    } catch (e) {
      alert(editingId && editingId !== "new" ? "修改提醒失败: " + e : "添加提醒失败: " + e);
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
        {editingId === null && (
          <button className="rem-add-btn" onClick={startAdd}>
            + 添加
          </button>
        )}
      </div>

      {editingId !== null && (
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
            <button className="rem-cancel" onClick={handleCancel}>
              取消
            </button>
            <button
              className="rem-save"
              onClick={handleSave}
              disabled={!draft.title}
            >
              {editingId && editingId !== "new" && reminders.find((r) => r.id === editingId) ? "保存修改" : "保存"}
            </button>
          </div>
        </div>
      )}

      {reminders.length === 0 && editingId === null && (
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
                  className="rem-edit"
                  onClick={() => startEdit(r)}
                  title="编辑"
                >
                  ✏️
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
