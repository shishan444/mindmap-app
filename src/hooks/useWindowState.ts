import { useEffect } from "react";
import type { Config, WindowState } from "../types";
import { useMindMapStore } from "../store";

/**
 * 窗口状态恢复/保存 hook
 *
 * 启动时：读 config.window_state，应用窗口位置/大小（Tauri window API）
 * 关闭时：保存当前窗口位置/大小 + 侧栏 tab/宽度/折叠 + 选中的节点 等到 config
 *
 * 在非 Tauri 环境（jsdom 测试 / 浏览器）下，所有 Tauri API 调用走 try-catch 静默忽略。
 */

// 这些类型从 @tauri-apps/api/window 引入会带入副作用，用最小 mock 类型
interface TauriWindowLike {
  setPosition: (pos: { x: number; y: number }) => Promise<void>;
  setSize: (size: { width: number; height: number }) => Promise<void>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  outerSize: () => Promise<{ width: number; height: number }>;
  isMaximized: () => Promise<boolean>;
  maximize: () => Promise<void>;
  onCloseRequested: (
    handler: () => void | Promise<void>,
  ) => Promise<() => void>;
}

export interface TauriWindowGetter {
  getCurrentWindow: () => TauriWindowLike;
}

export async function applyWindowState(
  win: TauriWindowLike,
  state: WindowState,
): Promise<void> {
  if (state.is_maximized) {
    await win.maximize();
    return;
  }
  await win.setPosition({ x: state.x, y: state.y });
  await win.setSize({ width: state.width, height: state.height });
}

export async function readWindowState(
  win: TauriWindowLike,
): Promise<{ x: number; y: number; width: number; height: number; is_maximized: boolean }> {
  const pos = await win.outerPosition();
  const size = await win.outerSize();
  const is_maximized = await win.isMaximized();
  return {
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    is_maximized,
  };
}

export function useWindowState(
  tauriGetter?: TauriWindowGetter,
  invoke?: (cmd: string, args?: any) => Promise<any>,
): void {
  // 启动时恢复窗口位置
  useEffect(() => {
    (async () => {
      const cfg = useMindMapStore.getState().config;
      if (!cfg?.window_state) return;
      try {
        const getter =
          tauriGetter ||
          (await import("@tauri-apps/api/window" as any)).default ||
          (await import("@tauri-apps/api/window" as any));
        const win = getter.getCurrentWindow();
        await applyWindowState(win, cfg.window_state);
      } catch (e) {
        // 非 Tauri 环境（测试 / 浏览器）静默忽略
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 关闭时保存窗口状态
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const getter =
          tauriGetter ||
          (await import("@tauri-apps/api/window" as any)).default ||
          (await import("@tauri-apps/api/window" as any));
        const win = getter.getCurrentWindow();
        unlisten = await win.onCloseRequested(async () => {
          await saveCurrentWindowState(tauriGetter, invoke);
        });
      } catch (e) {
        // 静默
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export async function saveCurrentWindowState(
  tauriGetter?: TauriWindowGetter,
  invoke?: (cmd: string, args?: any) => Promise<any>,
): Promise<void> {
  const store = useMindMapStore.getState();
  const cfg = store.config;
  if (!cfg) return;

  try {
    const getter =
      tauriGetter ||
      (await import("@tauri-apps/api/window" as any)).default ||
      (await import("@tauri-apps/api/window" as any));
    const win = getter.getCurrentWindow();
    const geometry = await readWindowState(win);

    const newWindowState: WindowState = {
      ...cfg.window_state,
      ...geometry,
      sidebar_width: store.sidebarWidth,
      sidebar_collapsed: store.sidebarCollapsed,
      active_tab: store.activeTab,
    };

    const newCfg: Config = { ...cfg, window_state: newWindowState };
    const invokeFn =
      invoke ||
      (await import("@tauri-apps/api/core" as any)).invoke ||
      (await import("@tauri-apps/api/core" as any)).default?.invoke;
    await invokeFn("save_config_command", { cfg: newCfg });

    // 同步到 store
    useMindMapStore.setState({ config: newCfg });
  } catch (e) {
    console.error("[useWindowState] save failed:", e);
  }
}
