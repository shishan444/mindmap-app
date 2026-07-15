// 全局测试 setup：在所有测试前导入
import "@testing-library/jest-dom";

// jest-dom matchers 的 TypeScript 类型扩展（自动可用，无需导入）
// 包含 toBeInTheDocument、toHaveTextContent、toBeDisabled 等

// 全局 mock Tauri invoke，避免测试时调用真实 Rust 后端
// 单个测试可用 vi.mocked 或 vi.fn() 覆盖具体返回值
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    // 提供安全默认值，避免未 mock 调用导致 reject
    if (cmd === "ping") return Promise.resolve("pong");
    if (cmd === "path_exists") return Promise.resolve(false);
    if (cmd === "get_config") return Promise.resolve(null);
    if (cmd === "get_recent_files")
      return Promise.resolve({ version: "1.0.0", files: [] });
    return Promise.resolve(null);
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// 模拟 matchMedia（jsdom 不自带）
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// 模拟 ResizeObserver（jsdom 不自带）
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverMock;
