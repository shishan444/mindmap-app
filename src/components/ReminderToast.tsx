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

  // 点击 Toast 跳转到对应节点
  // 策略:
  //   1. 直接尝试在当前画布找 node_id,找到就 __centerNode 居中
  //   2. 找不到(节点不在当前文件)→ 检查 source_file,如不同则忽略(不跨文件)
  //   3. 跨文件场景:filePath 为 null 或 source_file 不匹配时静默忽略
  //
  // 历史问题:之前严格要求 filePath === source_file,但 reminder 创建时
  // 如果 filePath=null(用户还没保存),source_file="",后续即使保存了
  // filePath 也不等于 "",跳转被拦截。改为先尝试 findEle,失败再 fallback。
  const jumpToNode = async (reminder: Reminder) => {
    const state = useMindMapStore.getState();
    const filePath = state.filePath;
    // 跨文件检查:source_file 非空且与当前 filePath 不同 → 不跳
    if (reminder.source_file && filePath && reminder.source_file !== filePath) {
      console.log("[ReminderToast] 跨文件,不跳转:", reminder.source_file, "≠", filePath);
      return;
    }
    // 用 __centerNode(MindMapCanvas 暴露),让节点真正居中到画布中央
    const centerFn = (window as any).__centerNode;
    if (typeof centerFn === "function") {
      const ok = centerFn(reminder.node_id);
      if (ok) {
        console.log("[ReminderToast] 跳转成功:", reminder.node_id);
        // 触发跳转后,刷新 reminders 缓存
        try {
          const idx = await invoke<{ reminders: Reminder[] }>("get_reminders");
          useMindMapStore.getState().setAllReminders(idx.reminders || []);
        } catch {}
        return;
      }
      console.log("[ReminderToast] __centerNode 返回 false(节点不在当前画布)");
    }
    // fallback:mind.focusNode
    const mind = state.mindInstance;
    if (!mind) return;
    const tpc =
      (typeof mind.findEle === "function" && mind.findEle(reminder.node_id)) || null;
    if (!tpc) {
      console.log("[ReminderToast] 节点未找到:", reminder.node_id);
      return;
    }
    try {
      if (mind.selectNode) mind.selectNode(tpc);
      if (mind.focusNode) mind.focusNode(tpc);
      console.log("[ReminderToast] fallback focusNode 跳转:", reminder.node_id);
    } catch (e) {
      console.error("[ReminderToast] 跳转失败", e);
    }
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
