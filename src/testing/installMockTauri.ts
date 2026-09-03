/* ============================================================
   installMockTauri — 测试模式装配入口(L2 测试基建)
   ============================================================
   必须作为 main.tsx 的第一个 import(ES 模块副作用按 import 顺序
   执行,先于 App 及任何调用 isTauri()/invoke() 的模块)。

   条件:?testMode=1 且无真实 Tauri 运行时。
   与 ?view=preferences 同构——query 参数分流是本工程既有模式。
   生产(无参数/真 Tauri)零干预。
   ============================================================ */

import { createMockTauri } from "./mockTauri";

declare global {
  interface Window {
    __testMock?: import("./mockTauri").TestMockHooks;
  }
}

(function installMockTauri(): void {
  try {
    const params = new URL(window.location.href).searchParams;
    if (params.get("testMode") !== "1") return;
    if (typeof window.__TAURI_INTERNALS__ !== "undefined") return; // 真 Tauri 不干预

    const { internals, hooks } = createMockTauri();
    window.__TAURI_INTERNALS__ = internals;
    window.__testMock = hooks;
    console.info(
      "%c[testMode] mock Tauri 已安装(IPC 走 in-memory 命令表)",
      "color:#22c55e;font-weight:bold",
    );
  } catch (e) {
    console.error("[testMode] mock 安装失败", e);
  }
})();

export {};
