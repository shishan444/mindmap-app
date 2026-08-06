/**
 * OB-016 / VP-MULTIWINDOW-CLOSE 回归测试
 *
 * 历史 bug:
 * - 7b21334 子窗口关闭按钮失效
 * - 4886a58 子窗口 close 无限循环 → prevent + 异步 destroy 修复
 *
 * 本测试覆盖前端三重保险中的 onCloseRequested 注册 + prevent + destroy。
 * Rust 端 handle_window_event 的对应行为需要 L3 真机测试覆盖。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { useSubWindowCloseGuard } from "./useSubWindowCloseGuard";

// Mock isTauri 默认返回 true(Tauri 模式)
vi.mock("../utils/tauriEnv", () => ({
  isTauri: () => true,
  warnBrowserModeOnce: () => {},
}));

function makeMockWindow(label: string) {
  const listeners: { destroy: () => Promise<void>; close: () => Promise<void> } = {
    destroy: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  let registeredHandler: ((event: { preventDefault: () => void }) => void | Promise<void>) | null = null;
  const unlisten = vi.fn();
  const win = {
    label,
    onCloseRequested: vi.fn(async (handler: any) => {
      registeredHandler = handler;
      return unlisten;
    }),
    destroy: listeners.destroy,
    close: listeners.close,
  };
  return { win, registeredHandler: () => registeredHandler, unlisten };
}

beforeEach(() => {
  // 清理 window.__forceCloseWindow
  delete (window as any).__forceCloseWindow;
});

describe("OB-016 useSubWindowCloseGuard", () => {
  it("★bug 回归★ 子窗口注册 onCloseRequested,触发时 prevent + destroy", async () => {
    const { win, registeredHandler } = makeMockWindow("doc-1");
    const preventDefault = vi.fn();
    renderHook(() =>
      useSubWindowCloseGuard({ getCurrentWindow: () => win as any }),
    );

    // 等异步注册完成
    await vi.waitFor(() => {
      expect(win.onCloseRequested).toHaveBeenCalledTimes(1);
    });

    const handler = registeredHandler();
    expect(handler).not.toBeNull();
    await handler!({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(win.destroy).toHaveBeenCalledTimes(1);
    // fallback 不应被调用
    expect(win.close).not.toHaveBeenCalled();
  });

  it("★bug 回归★ destroy 失败时 fallback 调用 close", async () => {
    const { win, registeredHandler } = makeMockWindow("doc-2");
    win.destroy = vi.fn().mockRejectedValueOnce(new Error("destroy failed"));
    const preventDefault = vi.fn();
    renderHook(() =>
      useSubWindowCloseGuard({ getCurrentWindow: () => win as any }),
    );

    await vi.waitFor(() => expect(win.onCloseRequested).toHaveBeenCalled());
    const handler = registeredHandler();
    await handler!({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(win.destroy).toHaveBeenCalled();
    expect(win.close).toHaveBeenCalled();
  });

  it("主窗口不注册 onCloseRequested(label=main)", async () => {
    const { win } = makeMockWindow("main");
    renderHook(() =>
      useSubWindowCloseGuard({ getCurrentWindow: () => win as any }),
    );
    // 主窗口应该完全跳过注册
    await new Promise((r) => setTimeout(r, 50));
    expect(win.onCloseRequested).not.toHaveBeenCalled();
  });

  it("★bug 回归★ 暴露 window.__forceCloseWindow 作为 DevTools 兜底", async () => {
    const { win } = makeMockWindow("doc-3");
    renderHook(() =>
      useSubWindowCloseGuard({ getCurrentWindow: () => win as any }),
    );
    await vi.waitFor(() => {
      expect((window as any).__forceCloseWindow).toBeDefined();
    });
    await (window as any).__forceCloseWindow();
    expect(win.destroy).toHaveBeenCalled();
  });

  it("卸载时清理监听 + 删除 __forceCloseWindow", async () => {
    const { win, unlisten } = makeMockWindow("doc-4");
    const { unmount } = renderHook(() =>
      useSubWindowCloseGuard({ getCurrentWindow: () => win as any }),
    );
    await vi.waitFor(() => expect(win.onCloseRequested).toHaveBeenCalled());
    expect((window as any).__forceCloseWindow).toBeDefined();

    unmount();

    expect(unlisten).toHaveBeenCalled();
    expect((window as any).__forceCloseWindow).toBeUndefined();
  });

  it("浏览器模式(非 Tauri)跳过所有 IPC 注册", async () => {
    // 局部覆盖 isTauri 返回 false
    const tauriEnv = await import("../utils/tauriEnv");
    const original = (tauriEnv as any).isTauri;
    (tauriEnv as any).isTauri = () => false;

    const { win } = makeMockWindow("doc-5");
    renderHook(() =>
      useSubWindowCloseGuard({ getCurrentWindow: () => win as any }),
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(win.onCloseRequested).not.toHaveBeenCalled();
    expect((window as any).__forceCloseWindow).toBeUndefined();

    (tauriEnv as any).isTauri = original;
  });
});
