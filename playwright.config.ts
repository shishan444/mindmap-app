import { defineConfig } from "@playwright/test";

// E2E 核心旅程矩阵(测试重构方案 L3)
// - webServer 起测试专用 vite(1430,与 tauri dev 的 1420 隔离)
// - 全部用例加载 ?testMode=1(mock Tauri,见 src/testing/)
// - 断言体系源自视图主权公理:内容操作 ⇒ 锚点(操作节点)视口 rect 恒定;
//   map-canvas 的 transform 是补偿的中间量,不作断言对象
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1430",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npx vite --port 1430 --strictPort",
    port: 1430,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
