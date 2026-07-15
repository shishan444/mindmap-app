import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  initDevLogger,
  setDevLoggerEnabled,
  isDevLoggerEnabled,
  log,
  logUserAction,
  logIPC,
  logIPCResult,
  logError,
  logPerf,
  loggedInvoke,
} from "./devLogger";

beforeEach(() => {
  // 默认禁用，每个 it 单独控制
  setDevLoggerEnabled(false);
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValue(null as any);
});

describe("FE-LOG: 启用/禁用控制", () => {
  it("FE-LOG-01: 默认禁用时 log 是 no-op", () => {
    log({ op: "test" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("FE-LOG-02: setDevLoggerEnabled(true) 后 log 触发 invoke", () => {
    setDevLoggerEnabled(true);
    log({ op: "test" });
    expect(invoke).toHaveBeenCalledWith("log_event", {
      entry: expect.objectContaining({ op: "test" }),
    });
  });

  it("FE-LOG-03: isDevLoggerEnabled 反映当前状态", () => {
    expect(isDevLoggerEnabled()).toBe(false);
    setDevLoggerEnabled(true);
    expect(isDevLoggerEnabled()).toBe(true);
  });
});

describe("FE-LOG: initDevLogger", () => {
  it("FE-LOG-04: forceEnable=true 启用并记录 session.start", () => {
    initDevLogger(true);
    expect(isDevLoggerEnabled()).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "log_event",
      expect.objectContaining({
        entry: expect.objectContaining({
          op: "session.start",
          cat: "system",
          level: "info",
          sessionId: expect.any(String),
          seq: 1,
        }),
      }),
    );
  });

  it("FE-LOG-05: forceEnable=false 且 DEV=false 时不启用", () => {
    vi.stubEnv("DEV", false);
    initDevLogger(false);
    expect(isDevLoggerEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("FE-LOG: log 字段", () => {
  beforeEach(() => setDevLoggerEnabled(true));

  it("FE-LOG-06: 自动加 ts（ISO 8601）", () => {
    log({ op: "test" });
    const entry = vi.mocked(invoke).mock.calls[0][1] as any;
    expect(entry.entry.ts).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it("FE-LOG-07: seq 递增", () => {
    log({ op: "a" });
    log({ op: "b" });
    log({ op: "c" });
    const e1 = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    const e2 = (vi.mocked(invoke).mock.calls[1][1] as any).entry;
    const e3 = (vi.mocked(invoke).mock.calls[2][1] as any).entry;
    expect(e1.seq).toBeLessThan(e2.seq);
    expect(e2.seq).toBeLessThan(e3.seq);
  });

  it("FE-LOG-08: 同一会话 sessionId 一致", () => {
    initDevLogger(true);
    log({ op: "x" });
    log({ op: "y" });
    const sessionStartEntry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    const e2 = (vi.mocked(invoke).mock.calls[1][1] as any).entry;
    expect(e2.sessionId).toBe(sessionStartEntry.sessionId);
  });

  it("FE-LOG-09: level 默认 info，cat 默认 system", () => {
    log({ op: "test" });
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.level).toBe("info");
    expect(entry.cat).toBe("system");
  });

  it("FE-LOG-10: 自定义 level/cat/payload/error/stack/duration_ms 都保留", () => {
    log({
      level: "error",
      cat: "ipc",
      op: "save.failed",
      payload: { path: "/x.mmap" },
      error: "Disk full",
      stack: "at line 1\n  at line 2",
      duration_ms: 42,
    });
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.level).toBe("error");
    expect(entry.cat).toBe("ipc");
    expect(entry.payload).toEqual({ path: "/x.mmap" });
    expect(entry.error).toBe("Disk full");
    expect(entry.stack).toBe("at line 1\n  at line 2");
    expect(entry.duration_ms).toBe(42);
  });
});

describe("FE-LOG: 便捷方法", () => {
  beforeEach(() => setDevLoggerEnabled(true));

  it("FE-LOG-11: logUserAction 用 user-action 分类", () => {
    logUserAction("toolbar.click", { target: "save" });
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.cat).toBe("user-action");
    expect(entry.op).toBe("toolbar.click");
  });

  it("FE-LOG-12: logIPC 默认 debug 级别", () => {
    logIPC("save_mmap", { path: "/x" });
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.cat).toBe("ipc");
    expect(entry.level).toBe("debug");
  });

  it("FE-LOG-13: logIPCResult ok=true debug 级别 + duration", () => {
    logIPCResult("save_mmap", 120, true);
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.op).toBe("save_mmap.result");
    expect(entry.duration_ms).toBe(120);
    expect(entry.level).toBe("debug");
  });

  it("FE-LOG-14: logIPCResult ok=false error 级别 + error 信息", () => {
    logIPCResult("save_mmap", 50, false, "IO error");
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.level).toBe("error");
    expect(entry.error).toBe("IO error");
  });

  it("FE-LOG-15: logError 包含 error + stack", () => {
    logError("crash", "nullpointer", "at f() {}", { file: "a.ts" });
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.cat).toBe("error");
    expect(entry.error).toBe("nullpointer");
    expect(entry.stack).toBe("at f() {}");
    expect(entry.payload).toEqual({ file: "a.ts" });
  });

  it("FE-LOG-16: logPerf 记录耗时", () => {
    logPerf("export.png", 850, { size: "1024x768" });
    const entry = (vi.mocked(invoke).mock.calls[0][1] as any).entry;
    expect(entry.cat).toBe("perf");
    expect(entry.duration_ms).toBe(850);
  });
});

describe("FE-LOG: loggedInvoke 包装", () => {
  beforeEach(() => {
    setDevLoggerEnabled(true);
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "log_event") return null;
      if (cmd === "ping") return "ok";
      throw new Error("disk full");
    });
  });

  it("FE-LOG-17: 成功时记录 invoke + result", async () => {
    const result = await loggedInvoke("ping", {});
    expect(result).toBe("ok");
    // invoke 被调用至少 2 次（log_event logIPC + cmd ping），最后还有 logIPCResult
    const logEventCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "log_event");
    expect(logEventCalls.length).toBeGreaterThanOrEqual(2);
    const firstLog = (logEventCalls[0][1] as any).entry;
    const lastLog = (logEventCalls[logEventCalls.length - 1][1] as any).entry;
    expect(firstLog.op).toBe("ping");
    expect(lastLog.op).toBe("ping.result");
  });

  it("FE-LOG-18: 失败时记录 error + rethrow", async () => {
    await expect(loggedInvoke("save_mmap", {})).rejects.toThrow("disk full");
    const logEventCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "log_event");
    const lastEntry = (logEventCalls[logEventCalls.length - 1][1] as any).entry;
    expect(lastEntry.op).toBe("save_mmap.result");
    expect(lastEntry.error).toContain("disk full");
    expect(lastEntry.level).toBe("error");
  });
});

describe("FE-LOG: invoke 失败时降级", () => {
  it("FE-LOG-19: 多次 log 不会让 invoke 失败前停止（fire-and-forget）", async () => {
    setDevLoggerEnabled(true);
    vi.mocked(invoke).mockImplementation(async () => {
      throw new Error("not in tauri");
    });
    log({ op: "first" });
    log({ op: "second" });
    await new Promise((r) => setTimeout(r, 50));
    expect(invoke).toHaveBeenCalled();
    // 不会因为一次失败就停（fire-and-forget 异步 catch）
    // 但 invokeAvailable 会被设为 false，第三次调用会被跳过
  });
});
