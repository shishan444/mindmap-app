import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import type { Reminder } from "../types";
import "./ReminderToast.css";

interface ToastItem {
  id: string;
  reminder: Reminder;
  shownAt: number;
}

export default function ReminderToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    (async () => {
      try {
        unlistenFn = await listen<Reminder>("reminder-triggered", (event) => {
          const item: ToastItem = {
            id: `${event.payload.id}-${Date.now()}`,
            reminder: event.payload,
            shownAt: Date.now(),
          };
          setToasts((prev) => [...prev, item]);
        });
      } catch (e) {
        // 浏览器/测试环境忽略
        console.warn("[ReminderToast] listen failed:", e);
      }
    })();
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // 点击 Toast 跳转到对应节点(仅当前文件;跨文件不处理)
  const jumpToNode = async (reminder: Reminder) => {
    const filePath = useMindMapStore.getState().filePath;
    if (!filePath || filePath !== reminder.source_file) {
      // 不跨文件 — 静默忽略
      return;
    }
    const mind = useMindMapStore.getState().mindInstance;
    if (!mind) return;
    // node_id 在 DOM 上有 "me" 前缀(mind-elixir 内部)
    const tpc =
      (typeof mind.findEle === "function" && mind.findEle(reminder.node_id)) || null;
    if (!tpc) return;
    try {
      if (mind.selectNode) mind.selectNode(tpc);
      if (mind.focusNode) mind.focusNode(tpc);
      else if (mind.scrollIntoView) mind.scrollIntoView(tpc);
    } catch (e) {
      console.error("[ReminderToast] 跳转失败", e);
    }
    // 触发跳转后,刷新 reminders 缓存(可能用户已读)
    try {
      const idx = await invoke<{ reminders: Reminder[] }>("get_reminders");
      useMindMapStore.getState().setAllReminders(idx.reminders || []);
    } catch {}
  };

  // 自动 8 秒后消失
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.shownAt < 8000));
    }, 1000);
    return () => clearInterval(timer);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div className="reminder-toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="reminder-toast"
          role="alert"
          onClick={() => {
            jumpToNode(t.reminder);
            dismiss(t.id);
          }}
        >
          <div className="reminder-toast-icon">⏰</div>
          <div className="reminder-toast-body">
            <div className="reminder-toast-title">{t.reminder.title}</div>
            {t.reminder.message && (
              <div className="reminder-toast-message">{t.reminder.message}</div>
            )}
          </div>
          <button
            className="reminder-toast-close"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
