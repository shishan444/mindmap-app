import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest 配置：jsdom 环境 + 全局 matchers + React 插件
//
// 设计注记(测试重构 L2):曾尝试 vitest browser mode 双项目,在 4.1.11 上
// 遇到 config 加载器丢失 provider.serverFactory 的兼容问题(版本全对齐、
// 对象双路径验证均完好,问题在 vitest 内部加载链)。改道:真实浏览器测试
// 统一走 Playwright(e2e/),画布真实几何用例在 e2e/canvas-geometry.spec.ts
// 中通过 dev server 的模块服务(page.evaluate + import 源模块)实现——
// 一套浏览器基建同时承担 L2 几何层与 L3 旅程层,存量 807 个 jsdom 测试零改动。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/testing/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      reporter: ["text", "html"],
    },
  },
});
