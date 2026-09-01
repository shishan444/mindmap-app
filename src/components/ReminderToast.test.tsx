import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import ReminderToast from "./ReminderToast";
import { useMindMapStore } from "../store";
import type { Reminder } from "../types";

// isTauri() 有模块级缓存且 jsdom 环境恒为 false(无 __TAURI_INTERNALS__),
// 会导致 listen 永不注册 → 事件驱动测试全部失效。强制按 Tauri 环境处理。
vi.mock("../utils/tauriEnv", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../utils/tauriEnv")>();
  return { ...orig, isTauri: () => true };
});

// 构造最小合法 Reminder
function makeReminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    node_id: "node-1",
    source_file: "",
    title: "提醒标题",
    message: "提醒内容",
    trigger_at: new Date().toISOString(),
    repeat_rule: null,
    priority: null,
    enabled: true,
    status: "pending",
    last_triggered_at: null,
    snoozed_until: null,
    next_trigger_at: null,
    created_at: new Date().toISOString(),
    ...over,
  } as Reminder;
}

/** 渲染并返回事件触发器(从 listen mock 捕获 callback) */
async function renderWithTrigger() {
  render(<ReminderToast />);
  await waitFor(() =>
    expect(vi.mocked(listen).mock.calls.some((c) => c[0] === "reminder-triggered")).toBe(true),
  );
  const call = vi.mocked(listen).mock.calls.find((c) => c[0] === "reminder-triggered");
  const fire = (payload: Reminder) =>
    act(async () => {
      call![1]({ event: "reminder-triggered", id: 1, payload });
    });
  return { fire };
}

describe("FE-TOAST: ReminderToast", () => {
  it("FE-TOAST-01: 初始渲染无 toast（listen 异步，无浮层）", () => {
    render(<ReminderToast />);
    expect(document.querySelector(".reminder-toast-container")).toBeNull();
  });

  it("FE-TOAST-02: 渲染不抛错（listen mock 已在 setup.ts 配置）", () => {
    expect(() => render(<ReminderToast />)).not.toThrow();
  });

  it("FE-TOAST-03: reminder-triggered 事件 → toast 渲染标题与内容", async () => {
    const { fire } = await renderWithTrigger();
    await fire(makeReminder({ title: "季度汇报", message: "还有 10 分钟" }));
    expect(await screen.findByText("季度汇报")).toBeInTheDocument();
    expect(screen.getByText("还有 10 分钟")).toBeInTheDocument();
  });

  it("FE-TOAST-04: 跨文件提醒被过滤(filePath 与 source_file 不匹配)", async () => {
    act(() => {
      useMindMapStore.setState({ filePath: "/current/a.mmap" });
    });
    const { fire } = await renderWithTrigger();
    await fire(makeReminder({ source_file: "/other/doc.mmap" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("FE-TOAST-05: 点击 toast → 调用 __centerNode 跳转 + toast 消失", async () => {
    const centerFn = vi.fn(() => true);
    (window as any).__centerNode = centerFn;
    const { fire } = await renderWithTrigger();
    await fire(makeReminder({ node_id: "node-9" }));
    const toast = await screen.findByRole("alert");
    await act(async () => {
      fireEvent.click(toast);
    });
    expect(centerFn).toHaveBeenCalledWith("node-9");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("FE-TOAST-06: 点击 × 只关闭本条(不触发跳转)", async () => {
    const centerFn = vi.fn(() => true);
    (window as any).__centerNode = centerFn;
    const { fire } = await renderWithTrigger();
    await fire(makeReminder());
    await screen.findByRole("alert");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("关闭"));
    });
    expect(centerFn).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("FE-TOAST-07: 多条 toast 堆叠渲染", async () => {
    const { fire } = await renderWithTrigger();
    await fire(makeReminder({ id: "r1", title: "第一条" }));
    await fire(makeReminder({ id: "r2", title: "第二条" }));
    expect(await screen.findAllByRole("alert")).toHaveLength(2);
  });

  it("FE-TOAST-08: 8 秒后自动过期消失", async () => {
    vi.useFakeTimers();
    try {
      render(<ReminderToast />);
      // flush 微任务:异步 IIFE 内完成 listen 注册(不用 waitFor,fake timers 会冻结它)
      await act(async () => {});
      const call = vi.mocked(listen).mock.calls.find((c) => c[0] === "reminder-triggered");
      expect(call).toBeDefined();
      await act(async () => {
        call![1]({ event: "reminder-triggered", id: 1, payload: makeReminder() });
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(8500);
      });
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

beforeEach(() => {
  useMindMapStore.setState({ filePath: null });
  delete (window as any).__centerNode;
});

afterEach(() => {
  cleanup();
  vi.mocked(listen).mockClear();
});
