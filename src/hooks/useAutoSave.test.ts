import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import { useAutoSave } from "./useAutoSave";
import { makeContent, makeConfig, makeNode } from "../test/helpers";

// 用 fake timers 才能测防抖
beforeEach(() => {
  vi.useFakeTimers();
  useMindMapStore.setState(
    {
      content: null,
      filePath: null,
      dirty: false,
      config: makeConfig({ auto_save_interval_sec: 2 }),
      saveStatus: "idle",
      lastSavedAt: null,
    },
  );
  useMindMapStore.temporal.getState().clear();
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValue(null as any);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FE-AUTOSAVE: useAutoSave", () => {
  it("FE-AUTOSAVE-01: dirty + content + filePath 时，2 秒后自动保存", async () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());

    // 推进 1 秒（未到时间）
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(invoke).not.toHaveBeenCalled();

    // 再推进 1 秒（满 2 秒，触发）
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(invoke).toHaveBeenCalledWith("save_mmap", {
      path: "/tmp/test.mmap",
      content: expect.any(Object),
    });
    expect(useMindMapStore.getState().saveStatus).toBe("saved");
    unmount();
  });

  it("FE-AUTOSAVE-02: 无 filePath 时不触发", async () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath(null);
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(invoke).not.toHaveBeenCalled();
    unmount();
  });

  it("FE-AUTOSAVE-03: 无 content 时不触发", async () => {
    useMindMapStore.getState().setContent(null);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(invoke).not.toHaveBeenCalled();
    unmount();
  });

  it("FE-AUTOSAVE-04: 未 dirty 时不触发", async () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    // 不 markDirty

    const { unmount } = renderHook(() => useAutoSave());
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(invoke).not.toHaveBeenCalled();
    unmount();
  });

  it("FE-AUTOSAVE-05: 防抖——2 秒内重复改动只保存一次", async () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());

    // 1 秒后再触发 dirty（重置计时器）
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    useMindMapStore.getState().markDirty();

    await act(async () => {
      vi.advanceTimersByTime(1500); // 总共 2.5 秒，但计时器被重置
    });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000); // 再 1 秒，达到 2 秒
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("FE-AUTOSAVE-06: save 失败时 saveStatus='error'", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(useMindMapStore.getState().saveStatus).toBe("error");
    unmount();
  });

  it("FE-AUTOSAVE-07: 遵循 config.auto_save_interval_sec", async () => {
    useMindMapStore.getState().setConfig(
      makeConfig({ auto_save_interval_sec: 5 }),
    );
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(4000); // 4 秒还没到
    });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2000); // 共 6 秒
    });
    expect(invoke).toHaveBeenCalled();
    unmount();
  });

  it("FE-AUTOSAVE-08: 保存中不重复触发", async () => {
    // 让 invoke 卡住，模拟保存中
    let resolveSave: () => void;
    const pending = new Promise<void>((r) => {
      resolveSave = r;
    });
    vi.mocked(invoke).mockReturnValueOnce(pending as any);

    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());

    // 触发第一次保存（pending 中）
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useMindMapStore.getState().saveStatus).toBe("saving");

    // 在第一次未完成时，markDirty 并推进时间——不应该触发第二次
    useMindMapStore.getState().markDirty();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    // 解除第一次
    await act(async () => {
      resolveSave!();
      await Promise.resolve();
    });
    unmount();
  });

  it("FE-AUTOSAVE-09: unmount 时清理计时器", async () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    unmount();

    // unmount 后再推进时间不应触发
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  // === 回归测试: 保存期间发生新改动,不应丢失 (bug: markSaved 覆盖) ===
  // 用户场景: 改 topic → 自动保存触发 → 保存期间又改 → markSaved 把新改动吞掉 → 数据丢失
  it("FE-AUTOSAVE-10: ★bug 复现★ invoke 期间 content 变化,dirty 不应被清零", async () => {
    // 让 invoke 卡住,模拟保存进行中
    let resolveSave: () => void;
    const pending = new Promise<void>((r) => { resolveSave = r; });
    vi.mocked(invoke).mockReturnValueOnce(pending as any);

    const content = makeContent({ root: makeNode({ id: "n1", topic: "v1" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());

    // 触发自动保存(invoke pending 中)
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    // ★ invoke 期间,用户改了 topic(或 syncFromMindElixir 触发 setContent)
    // 用 updateContent 模拟"用户改动"(会创建新 content 引用 + 设 dirty=true)
    await act(async () => {
      useMindMapStore.getState().updateContent((c) => {
        c.root.topic = "v2";
      });
    });

    // 当前 store 状态:content 引用已变,dirty=true
    const stateBeforeResolve = useMindMapStore.getState();
    expect(stateBeforeResolve.dirty).toBe(true);

    // ★ resolve invoke
    await act(async () => {
      resolveSave!();
      await Promise.resolve();
    });

    // ★ 关键断言:dirty 不应被清零(因为 invoke 期间有新改动)
    // 旧 bug: invoke 完成后无条件 markSaved → dirty=false → 新改动永远不会被保存
    const stateAfterResolve = useMindMapStore.getState();
    expect(stateAfterResolve.dirty).toBe(true);

    // 还应该再次触发自动保存(因为 dirty 还是 true)
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(invoke).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("FE-AUTOSAVE-11: invoke 期间 content 未变化,正常 markSaved", async () => {
    // 对照组:invoke 期间没改动,正常 markSaved
    const content = makeContent({ root: makeNode({ id: "n1", topic: "x" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    useMindMapStore.getState().markDirty();

    const { unmount } = renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // invoke 完成,无新改动 → dirty=false
    expect(useMindMapStore.getState().dirty).toBe(false);
    expect(useMindMapStore.getState().saveStatus).toBe("saved");
    unmount();
  });
});
