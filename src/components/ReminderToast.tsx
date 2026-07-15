import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
          onClick={() => dismiss(t.id)}
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
