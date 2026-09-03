/* ============================================================
   helpers — E2E 旅程矩阵共用工具
   ============================================================
   两条断言纪律(全部用例必须遵守):
   1. 视图零变化 = 锚点节点视口 rect 恒定(me-tpc.getBoundingClientRect),
      不是 map-canvas 的 transform——补偿的本质就是改 transform 抵消推飞。
   2. 布局零位移 = 底部状态栏与工具栏 rect 恒定(浮层不得挤压布局)。
   ============================================================ */

import type { Page, Locator } from "@playwright/test";

/** 深树预置节点数(mockTauri 的 deepTestTree) */
export const PRESET_NODE_COUNT = 11;

export async function gotoMap(page: Page): Promise<void> {
  await page.goto("/?testMode=1");
  // 反假绿的第一道闸:深树真的渲染出来,画布真的可交互
  await page.waitForFunction(
    (n) => document.querySelectorAll(".mind-elixir-inner me-tpc").length === n,
    PRESET_NODE_COUNT,
    { timeout: 15_000 },
  );
}

export function nodeByTopic(page: Page, topic: string): Locator {
  return page.locator(".mind-elixir-inner me-tpc", { hasText: topic }).first();
}

export async function clickNode(page: Page, topic: string): Promise<void> {
  // 深树节点常在视口外(右侧布局超宽),Playwright 原生 click 会因不可见超时。
  // mind-elixir 用事件委托监听 click——派发冒泡 MouseEvent 走同一处理链
  // (与取证台同机制,且 waitForFunction 验证选中真实生效)。
  await nodeByTopic(page, topic).evaluate((el) => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(
    (t) =>
      document.querySelector("me-tpc.selected")?.textContent?.includes(t as string) ?? false,
    topic,
  );
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 节点视口 rect(视图主权断言的度量) */
export async function nodeRect(page: Page, topic: string): Promise<Rect> {
  return nodeByTopic(page, topic).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** 布局指纹:状态栏+工具栏 rect(浮层不得改变它) */
export async function layoutFingerprint(page: Page): Promise<Rect[]> {
  return page.evaluate(() => {
    const picks = [".status-bar", ".toolbar-wrap"];
    return picks.map((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error(`layoutFingerprint: 未找到 ${sel}`);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
  });
}

export async function nodeCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll(".mind-elixir-inner me-tpc").length);
}

/** 真键盘按键后等补偿结算(settle 60ms + 复检余量) */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(450);
}

/** rect 近似相等(≤tolerance px) */
export function expectRectClose(a: Rect, b: Rect, tolerance = 1.5): void {
  if (
    Math.abs(a.x - b.x) > tolerance ||
    Math.abs(a.y - b.y) > tolerance ||
    Math.abs(a.width - b.width) > tolerance ||
    Math.abs(a.height - b.height) > tolerance
  ) {
    throw new Error(
      `rect 不匹配(容差 ${tolerance}px):\n  before: ${JSON.stringify(a)}\n  after:  ${JSON.stringify(b)}`,
    );
  }
}
