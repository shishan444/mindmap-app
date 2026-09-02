import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import "./GlassDialog.css";

/**
 * 玻璃对话框 — 原生 alert/confirm 的替代
 *
 * 背景:深色玻璃应用弹系统原生白框是视觉断裂重灾区(P1-3 整改),
 * 且原生 confirm 阻塞主线程、样式不可控。
 *
 * 接口(Promise 化,调用点可 await):
 *   await showAlert("保存失败", String(e), "error")
 *   if (!(await showConfirm("删除提醒", { message: "...", danger: true }))) return
 *
 * 实现:模块级队列 + 单一 Host(App 渲染一次) + Portal 挂 body
 * (吸取 v0.3.1 浮层劫持教训:浮层物理脱离 .app-root)。
 * 多个请求依次展示(FIFO)。
 */

export type DialogKind = "info" | "error";

interface QueueItem {
  type: "alert" | "confirm";
  title: string;
  message?: string;
  kind?: DialogKind;
  danger?: boolean;
  confirmText?: string;
  cancelText?: string;
  resolve: (v?: any) => void;
}

const queue: QueueItem[] = [];
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}

export function showAlert(
  title: string,
  message?: string,
  kind: DialogKind = "info",
): Promise<void> {
  return new Promise((resolve) => {
    queue.push({ type: "alert", title, message, kind, resolve: resolve as any });
    notify();
  });
}

export function showConfirm(
  title: string,
  opts: { message?: string; danger?: boolean; confirmText?: string; cancelText?: string } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({
      type: "confirm",
      title,
      message: opts.message,
      danger: opts.danger,
      confirmText: opts.confirmText,
      cancelText: opts.cancelText,
      resolve,
    });
    notify();
  });
}

function kindIcon(kind: DialogKind, danger?: boolean): ReactElement {
  const s = (d: string, color: string) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
  if (kind === "error" || danger) {
    return (
      <>
        {s("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "var(--p0)")}
        {s("M15 9l-6 6M9 9l6 6", "var(--p0)")}
      </>
    );
  }
  return (
    <>
      {s("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "var(--accent)")}
      {s("M12 16v-4M12 8h.01", "var(--accent)")}
    </>
  );
}

export function GlassDialogHost() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const current = queue[0];

  const settle = (ok: boolean) => {
    const item = queue.shift();
    // alert 无返回值语义;confirm 返回用户选择
    item?.resolve(item.type === "confirm" ? ok : undefined);
    notify();
  };

  // 键盘:Enter=确认,Escape=取消/关闭
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        settle(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        settle(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current]);

  if (!current) return null;

  return createPortal(
    <div
      className="glass-dialog-overlay"
      role="presentation"
      onMouseDown={(e) => {
        // alert 点遮罩关闭;confirm 需显式选择,不关
        if (e.target === e.currentTarget && current.type === "alert") settle(false);
      }}
    >
      <div
        className="glass-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
      >
        <div className={`glass-dialog-icon${current.kind === "error" || current.danger ? " gd-err" : ""}`}>
          {kindIcon(current.kind ?? "info", current.danger)}
        </div>
        <div className="glass-dialog-body">
          <div className="glass-dialog-title">{current.title}</div>
          {current.message && <div className="glass-dialog-message">{current.message}</div>}
        </div>
        <div className="glass-dialog-actions">
          {current.type === "confirm" && (
            <button className="gd-btn" onClick={() => settle(false)}>
              {current.cancelText ?? "取消"}
            </button>
          )}
          <button
            className={`gd-btn gd-primary${current.danger ? " gd-danger" : ""}`}
            autoFocus
            onClick={() => settle(true)}
          >
            {current.type === "confirm" ? current.confirmText ?? "确定" : "知道了"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
