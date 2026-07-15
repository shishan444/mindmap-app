import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  applyWindowState,
  readWindowState,
  saveCurrentWindowState,
  useWindowState,
  type TauriWindowLike,
  type TauriWindowGetter,
} from "./useWindowState";
import { useMindMapStore } from "../store";
import { makeConfig } from "../test/helpers";

function makeMockWindow(overrides: Partial<TauriWindowLike> = {}): TauriWindowLike {
  return {
    setPosition: vi.fn().mockResolvedValue(undefined),
    setSize: vi.fn().mockResolvedValue(undefined),
    outerPosition: vi.fn().mockResolvedValue({ x: 200, y: 300 }),
    outerSize: vi.fn().mockResolvedValue({ width: 1280, height: 800 }),
    isMaximized: vi.fn().mockResolvedValue(false),
    maximize: vi.fn().mockResolvedValue(undefined),
    onCloseRequested: vi.fn().mockResolvedValue(vi.fn()),
    ...overrides,
  };
}

function makeMockGetter(win: TauriWindowLike): TauriWindowGetter {
  return { getCurrentWindow: () => win };
}

beforeEach(() => {
  useMindMapStore.setState({
    config: null,
    content: null,
    sidebarWidth: 280,
    sidebarCollapsed: false,
    activeTab: "properties",
  });
});

describe("FE-WIN: applyWindowState", () => {
  it("FE-WIN-01: 非最大化时设置位置和大小", async () => {
    const win = makeMockWindow();
    await applyWindowState(win, {
      x: 100,
      y: 200,
      width: 1280,
      height: 800,
      is_maximized: false,
      sidebar_width: 280,
      sidebar_collapsed: false,
      active_tab: "properties",
    });
    expect(win.setPosition).toHaveBeenCalledWith({ x: 100, y: 200 });
    expect(win.setSize).toHaveBeenCalledWith({ width: 1280, height: 800 });
    expect(win.maximize).not.toHaveBeenCalled();
  });

  it("FE-WIN-02: is_maximized=true 时只 maximize", async () => {
    const win = makeMockWindow();
    await applyWindowState(win, {
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
      is_maximized: true,
      sidebar_width: 280,
      sidebar_collapsed: false,
      active_tab: "properties",
    });
    expect(win.maximize).toHaveBeenCalled();
    expect(win.setPosition).not.toHaveBeenCalled();
    expect(win.setSize).not.toHaveBeenCalled();
  });
});

describe("FE-WIN: readWindowState", () => {
  it("FE-WIN-03: 读取窗口位置/大小/最大化状态", async () => {
    const win = makeMockWindow({
      outerPosition: vi.fn().mockResolvedValue({ x: 50, y: 60 }),
      outerSize: vi.fn().mockResolvedValue({ width: 1000, height: 700 }),
      isMaximized: vi.fn().mockResolvedValue(true),
    });
    const state = await readWindowState(win);
    expect(state).toEqual({
      x: 50,
      y: 60,
      width: 1000,
      height: 700,
      is_maximized: true,
    });
  });
});

describe("FE-WIN: saveCurrentWindowState", () => {
  it("FE-WIN-04: 无 config 时 no-op", async () => {
    const win = makeMockWindow();
    const getter = makeMockGetter(win);
    const invoke = vi.fn();
    useMindMapStore.setState({ config: null });
    await saveCurrentWindowState(getter, invoke);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("FE-WIN-05: 保存时同步窗口几何 + 侧栏状态到 config", async () => {
    const win = makeMockWindow({
      outerPosition: vi.fn().mockResolvedValue({ x: 111, y: 222 }),
      outerSize: vi.fn().mockResolvedValue({ width: 999, height: 666 }),
      isMaximized: vi.fn().mockResolvedValue(false),
    });
    const getter = makeMockGetter(win);
    const invoke = vi.fn().mockResolvedValue(null);
    const cfg = makeConfig();
    useMindMapStore.setState({
      config: cfg,
      sidebarWidth: 350,
      sidebarCollapsed: true,
      activeTab: "outline",
    });

    await saveCurrentWindowState(getter, invoke);

    expect(invoke).toHaveBeenCalledWith("save_config_command", {
      cfg: expect.objectContaining({
        window_state: expect.objectContaining({
          x: 111,
          y: 222,
          width: 999,
          height: 666,
          is_maximized: false,
          sidebar_width: 350,
          sidebar_collapsed: true,
          active_tab: "outline",
        }),
      }),
    });
  });

  it("FE-WIN-06: 保存后 store.config 更新", async () => {
    const win = makeMockWindow();
    const getter = makeMockGetter(win);
    const invoke = vi.fn().mockResolvedValue(null);
    useMindMapStore.setState({ config: makeConfig() });
    await saveCurrentWindowState(getter, invoke);
    const updated = useMindMapStore.getState().config;
    expect(updated?.window_state.x).toBe(200);
    expect(updated?.window_state.y).toBe(300);
  });
});

describe("FE-WIN: useWindowState hook", () => {
  it("FE-WIN-07: 有 config 时启动调用 applyWindowState", async () => {
    const win = makeMockWindow();
    const getter = makeMockGetter(win);
    const invoke = vi.fn();
    useMindMapStore.setState({
      config: makeConfig({
        window_state: {
          x: 10,
          y: 20,
          width: 800,
          height: 600,
          is_maximized: false,
          sidebar_width: 280,
          sidebar_collapsed: false,
          active_tab: "properties",
        },
      }),
    });
    renderHook(() => useWindowState(getter, invoke));
    // 等异步 effect
    await new Promise((r) => setTimeout(r, 50));
    expect(win.setPosition).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(win.setSize).toHaveBeenCalledWith({ width: 800, height: 600 });
  });

  it("FE-WIN-08: 无 config 时不调用 setPosition", async () => {
    const win = makeMockWindow();
    const getter = makeMockGetter(win);
    useMindMapStore.setState({ config: null });
    renderHook(() => useWindowState(getter));
    await new Promise((r) => setTimeout(r, 50));
    expect(win.setPosition).not.toHaveBeenCalled();
  });

  it("FE-WIN-09: 注册 onCloseRequested，卸载时取消监听", async () => {
    const win = makeMockWindow();
    const unlisten = vi.fn();
    win.onCloseRequested = vi.fn().mockResolvedValue(unlisten);
    const getter = makeMockGetter(win);
    useMindMapStore.setState({ config: makeConfig() });
    const { unmount } = renderHook(() => useWindowState(getter));
    await new Promise((r) => setTimeout(r, 50));
    expect(win.onCloseRequested).toHaveBeenCalled();
    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
