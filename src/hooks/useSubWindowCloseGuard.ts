/**
 * 子窗口关闭三重保险的前端层(对应 Rust lib.rs handle_window_event 的子窗口分支)。
 *
 * 历史 bug:
 * - 7b21334 子窗口关闭按钮失效(只能 kill 进程)
 * - 4886a58 子窗口 close 无限循环(prevent + 异步 destroy 修复)
 *
 * 本 hook 提取自 App.tsx 的 inline useEffect,目标是可测试:
 * - 不传参 → 使用真实 @tauri-apps/api/window
 * - 传 tauriGetter → 用于测试注入 mock
 *
 * 行为契约:
 * - 主窗口(label="main"):跳过,不注册监听
 * - 子窗口:注册 onCloseRequested
 *   - 触发时 event.preventDefault + win.destroy
 *   - destroy 失败 fallback win.close
 * - 兜底:暴露 window.__forceCloseWindow 用于 DevTools 调试
 */

import { useEffect } from "react";
import { isTauri } from "../utils/tauriEnv";

export interface CloseGuardWindowLike {
  label: string;
  onCloseRequested: (
    handler: (event: { preventDefault: () => void }) => void | Promise<void>,
  ) => Promise<() => void>;
  destroy: () => Promise<void>;
  close: () => Promise<void>;
}

export interface CloseGuardTauriGetter {
  getCurrentWindow: () => CloseGuardWindowLike;
}

let lastForceCloseRef: (() => Promise<void>) | null = null;

export function useSubWindowCloseGuard(
  tauriGetter?: CloseGuardTauriGetter,
): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      if (!isTauri()) return;
      try {
        const win = tauriGetter
          ? tauriGetter.getCurrentWindow()
          : (await import("@tauri-apps/api/window" as any)).getCurrentWindow();

        if (cancelled) return;

        if (win.label === "main") {
          return;
        }

        unlisten = await win.onCloseRequested(async (event: { preventDefault: () => void }) => {
          event.preventDefault();
          try {
            await win.destroy();
          } catch (e) {
            console.error("[close-guard] destroy 失败, fallback close", e);
            try {
              await win.close();
            } catch (e2) {
              console.error("[close-guard] close 也失败", e2);
            }
          }
        });

        // 兜底:暴露手动关闭函数(DevTools 可调)
        lastForceCloseRef = async () => {
          try {
            await win.destroy();
          } catch (e) {
            console.error(e);
          }
        };
        if (typeof window !== "undefined") {
          (window as any).__forceCloseWindow = lastForceCloseRef;
        }
      } catch (e) {
        console.warn("[close-guard] 注册失败", e);
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (lastForceCloseRef && typeof window !== "undefined") {
        delete (window as any).__forceCloseWindow;
        lastForceCloseRef = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
