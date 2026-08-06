/**
 * OB-022 浏览器模式优雅降级测试
 *
 * 历史 bug:681713e 修复了 7 处 IPC 报错(dev 模式浏览器加载时 window.__TAURI_INTERNALS__ 不存在)
 * a3a2d37 删除了浏览器模式默认数据(方案 C)
 *
 * 本测试覆盖:
 * - isTauri() 在有/无 __TAURI_INTERNALS__ 时的返回值
 * - warnBrowserModeOnce() 只提示一次
 * - 各 hook 入口(App/mcpBridge/operationBridge/ReminderToast)在浏览器模式不抛错
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 测试隔离:每个 test 重新 import tauriEnv,避免 cachedIsTauri 跨 test 污染
async function loadFreshModule() {
  vi.resetModules();
  return await import("./tauriEnv");
}

beforeEach(() => {
  // 清理 __TAURI_INTERNALS__
  delete (window as any).__TAURI_INTERNALS__;
});

afterEach(() => {
  delete (window as any).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe("OB-022 tauriEnv: isTauri", () => {
  it("无 __TAURI_INTERNALS__ 时 isTauri 返回 false(浏览器模式)", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    const { isTauri } = await loadFreshModule();
    expect(isTauri()).toBe(false);
  });

  it("有 __TAURI_INTERNALS__ 时 isTauri 返回 true(Tauri 模式)", async () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: () => {} };
    const { isTauri } = await loadFreshModule();
    expect(isTauri()).toBe(true);
  });

  it("__TAURI_INTERNALS__ = undefined 时按 false 处理(显式 undefined)", async () => {
    (window as any).__TAURI_INTERNALS__ = undefined;
    const { isTauri } = await loadFreshModule();
    expect(isTauri()).toBe(false);
  });

  it("isTauri 结果会被缓存(第二次调用不再检查 window)", async () => {
    (window as any).__TAURI_INTERNALS__ = { invoke: () => {} };
    const { isTauri } = await loadFreshModule();
    expect(isTauri()).toBe(true);
    // 删掉 INTERNALS 后,因为缓存,isTauri 仍应返回 true
    delete (window as any).__TAURI_INTERNALS__;
    expect(isTauri()).toBe(true);
  });
});

describe("OB-022 tauriEnv: warnBrowserModeOnce", () => {
  it("非 Tauri + DEV 模式只提示一次(不刷屏)", async () => {
    vi.stubEnv("DEV", true);
    delete (window as any).__TAURI_INTERNALS__;
    const { warnBrowserModeOnce } = await loadFreshModule();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    warnBrowserModeOnce();
    warnBrowserModeOnce();
    warnBrowserModeOnce();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toContain("浏览器模式");
    vi.unstubAllEnvs();
  });

  it("Tauri 模式不提示(isTauri=true 短路)", async () => {
    vi.stubEnv("DEV", true);
    (window as any).__TAURI_INTERNALS__ = { invoke: () => {} };
    const { warnBrowserModeOnce } = await loadFreshModule();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    warnBrowserModeOnce();
    expect(infoSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("非 DEV 模式不提示(避免生产环境污染)", async () => {
    vi.stubEnv("DEV", false);
    delete (window as any).__TAURI_INTERNALS__;
    const { warnBrowserModeOnce } = await loadFreshModule();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    warnBrowserModeOnce();
    expect(infoSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("OB-022 各 hook 入口浏览器模式守卫(集成)", () => {
  it("mcpBridge 在浏览器模式不调 invoke(静默跳过)", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.resetModules();

    const invokeMod = await import("@tauri-apps/api/core");
    const invokeSpy = vi.mocked(invokeMod.invoke);
    invokeSpy.mockClear();

    const { useMcpBridge } = await import("../mcp/mcpBridge");
    const { renderHook } = await import("@testing-library/react");
    renderHook(() => useMcpBridge());

    // 等一下确保 effect 跑完
    await new Promise((r) => setTimeout(r, 50));

    const updateCalls = invokeSpy.mock.calls.filter(([cmd]) => cmd === "mcp_update_state");
    expect(updateCalls.length).toBe(0);
  });

  it("operationBridge initLlmBridge 在浏览器模式跳过 listen 注册", async () => {
    delete (window as any).__TAURI_INTERNALS__;
    vi.resetModules();

    const eventMod = await import("@tauri-apps/api/event");
    const listenSpy = vi.mocked(eventMod.listen);
    listenSpy.mockClear();

    const { initLlmBridge, shutdownLlmBridge } = await import("../mcp/operationBridge");
    shutdownLlmBridge();
    await initLlmBridge();

    // listen 不应被调用(浏览器模式直接 return)
    expect(listenSpy).not.toHaveBeenCalled();
  });
});
