/**
 * 开发模式日志器：结构化 JSONL 日志，对机器/LLM 友好。
 *
 * 格式：每条日志是一个 JSON 对象，写入后端日志文件（JSON Lines）。
 *   {
 *     "ts": "2026-07-15T08:10:23.456Z",
 *     "level": "info",
 *     "cat": "user-action",
 *     "op": "toolbar.click",
 *     "payload": { "target": "save" },
 *     "duration_ms": 12,
 *     "error": "...",
 *     "stack": "...",
 *     "seq": 42,
 *     "sessionId": "abc123"
 *   }
 *
 * 仅在 dev 模式启用（import.meta.env.DEV），生产模式静默 no-op。
 * 也支持运行时强制启用/禁用（用于生产环境调试）。
 */

import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory =
  | "system"
  | "user-action"
  | "ipc"
  | "state"
  | "mind-elixir"
  | "error"
  | "perf";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  cat: LogCategory;
  op: string;
  payload?: unknown;
  duration_ms?: number;
  error?: string;
  stack?: string;
  seq: number;
  sessionId: string;
}

let sessionId = "";
let seq = 0;
let enabled = false;
let invokeAvailable = true;

/** 初始化：检测环境，生成 sessionId */
export function initDevLogger(forceEnable = false): void {
  enabled = forceEnable || import.meta.env?.DEV === true;
  if (!enabled) return;
  sessionId = generateSessionId();
  seq = 0;
  invokeAvailable = true;
  log({
    level: "info",
    cat: "system",
    op: "session.start",
    payload: {
      sessionId,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      timestamp: Date.now(),
    },
  });
}

/** 会话结束时记录（关闭窗口/退出） */
export function logSessionEnd(): void {
  if (!enabled) return;
  log({
    level: "info",
    cat: "system",
    op: "session.end",
    payload: { sessionId, duration_ms: Date.now() - sessionStartedAt },
  });
}

let sessionStartedAt = Date.now();

export function isDevLoggerEnabled(): boolean {
  return enabled;
}

/** 运行时强制开启（用于生产环境调试） */
export function setDevLoggerEnabled(v: boolean): void {
  enabled = v;
}

/** 主日志函数 */
export function log(
  partial: Omit<Partial<LogEntry>, "ts" | "seq" | "sessionId">,
): void {
  if (!enabled) return;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: partial.level ?? "info",
    cat: partial.cat ?? "system",
    op: partial.op ?? "unknown",
    payload: partial.payload,
    duration_ms: partial.duration_ms,
    error: partial.error,
    stack: partial.stack,
    seq: ++seq,
    sessionId,
  };

  // 同步打印到 console（便于 devtools 查看）
  // 控制台用前缀 + JSON 串
  const consoleMsg = `[dev:${entry.cat}] ${entry.op}`;
  if (entry.level === "error") {
    console.error(consoleMsg, entry);
  } else if (entry.level === "warn") {
    console.warn(consoleMsg, entry);
  } else {
    console.log(consoleMsg, entry);
  }

  // 异步写文件（fire-and-forget）
  if (!invokeAvailable) return;
  invoke("log_event", { entry }).catch((e) => {
    // invoke 失败（非 Tauri 环境），停止后续尝试
    invokeAvailable = false;
    console.warn("[devLogger] invoke failed, disabling file write:", e);
  });
}

// ===== 便捷方法 =====

export const logUserAction = (op: string, payload?: unknown) =>
  log({ cat: "user-action", op, payload, level: "info" });

export const logIPC = (
  op: string,
  payload?: unknown,
  level: LogLevel = "debug",
) => log({ cat: "ipc", op, payload, level });

export const logIPCResult = (
  op: string,
  durationMs: number,
  ok: boolean,
  errorMsg?: string,
) =>
  log({
    cat: "ipc",
    op: `${op}.result`,
    payload: { ok, duration_ms: durationMs },
    level: ok ? "debug" : "error",
    error: ok ? undefined : errorMsg,
    duration_ms: durationMs,
  });

export const logState = (op: string, payload?: unknown) =>
  log({ cat: "state", op, payload, level: "debug" });

export const logMindElixir = (op: string, payload?: unknown) =>
  log({ cat: "mind-elixir", op, payload, level: "debug" });

export const logError = (
  op: string,
  error: string,
  stack?: string,
  payload?: unknown,
) =>
  log({
    cat: "error",
    op,
    error,
    stack,
    payload,
    level: "error",
  });

export const logPerf = (op: string, durationMs: number, payload?: unknown) =>
  log({
    cat: "perf",
    op,
    duration_ms: durationMs,
    payload,
    level: "info",
  });

/** 包装 invoke，自动记录开始 + 结果 + 耗时 */
export async function loggedInvoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  logIPC(cmd, args);
  try {
    const result = await invoke<T>(cmd, args);
    logIPCResult(cmd, Date.now() - start, true);
    return result;
  } catch (e) {
    logIPCResult(cmd, Date.now() - start, false, String(e));
    throw e;
  }
}

function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}
