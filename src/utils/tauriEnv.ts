/**
 * Tauri 运行时环境检测。
 *
 * `npm run dev` 在纯浏览器加载时 window.__TAURI_INTERNALS__ 不存在,
 * 直接调 invoke/listen 会抛 "Cannot read properties of undefined"。
 * isTauri() 让各入口在浏览器模式显式失败,不调 IPC。
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

let cachedIsTauri: boolean | null = null;
let browserModeWarned = false;

export function isTauri(): boolean {
  if (cachedIsTauri === null) {
    cachedIsTauri =
      typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
  }
  return cachedIsTauri;
}

/**
 * dev 模式 + 浏览器环境时,提示一次,不刷屏。
 */
export function warnBrowserModeOnce(): void {
  if (browserModeWarned) return;
  if (isTauri()) return;
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    browserModeWarned = true;
    console.info(
      "%c[dev] 浏览器模式(无 Tauri 运行时):IPC 已禁用,画布为空。完整功能请用 `npm run tauri dev`。",
      "color:#f5a623;font-weight:bold",
    );
  }
}
