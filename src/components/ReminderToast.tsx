import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import { isTauri } from "../utils/tauriEnv";
import type { Reminder } from "../types";
import { logMindElixir } from "../utils/devLogger";
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
      if (!isTauri()) return;
      try {
        unlistenFn = await listen<Reminder>("reminder-triggered", (event) => {
          // 多窗口模式:只显示归属当前窗口的 reminder
          // 通过 source_file 匹配 store.filePath(本窗口的当前文档)
          const currentFilePath = useMindMapStore.getState().filePath;
          const sourceFile = event.payload.source_file;
          if (sourceFile && currentFilePath && sourceFile !== currentFilePath) {
            return;
          }
          const item: ToastItem = {
            id: `${event.payload.id}-${Date.now()}`,
            reminder: event.payload,
            shownAt: Date.now(),
          };
          setToasts((prev) => [...prev, item]);
        });
      } catch (e) {
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
      logMindElixir("toast.jump-skip-crossfile", { source: reminder.source_file });
      return;
    }
    // 用 __centerNode(MindMapCanvas 暴露),让节点真正居中到画布中央
    const centerFn = (window as any).__centerNode;
    if (typeof centerFn === "function") {
      const ok = centerFn(reminder.node_id);
      if (ok) {
        logMindElixir("toast.jump-ok", { node_id: reminder.node_id });
        // 触发跳转后,刷新 reminders 缓存
        try {
          const idx = await invoke<{ reminders: Reminder[] }>("get_reminders");
          useMindMapStore.getState().setAllReminders(idx.reminders || []);
        } catch {}
        return;
      }
      logMindElixir("toast.jump-not-in-canvas");
    }
    // fallback:mind.focusNode
    const mind = state.mindInstance;
    if (!mind) return;
    const tpc =
      (typeof mind.findEle === "function" && mind.findEle(reminder.node_id)) || null;
    if (!tpc) {
      logMindElixir("toast.jump-node-not-found", { node_id: reminder.node_id });
      return;
    }
    try {
      if (mind.selectNode) mind.selectNode(tpc);
      if (mind.focusNode) mind.focusNode(tpc);
      logMindElixir("toast.jump-fallback-ok", { node_id: reminder.node_id });
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

  // ★ 根因修复(浮层布局劫持):同 LlmOperationHistory — Portal 挂 body,
  // 免疫 `.app-root > *:not(.stage-fx)` 的 position:relative 覆盖。
  return createPortal(
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
          <div className="reminder-toast-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
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
    </div>,
    document.body,
  );
}
