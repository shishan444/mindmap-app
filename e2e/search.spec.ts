/* ============================================================
   search.spec — 搜索跳转族(3 条)
   ============================================================
   守护对象:视图主权公理的唯一例外——用户显式跳转(搜索定位)
   允许移动视图;且例外之外的一切内容操作仍然不动画布。
   ============================================================ */

import { test, expect } from "@playwright/test";
import { gotoMap, clickNode, nodeRect, nodeCount, pressKey, expectRectClose, PRESET_NODE_COUNT } from "./helpers";

test.describe("搜索跳转族", () => {
  test("sr-01: Cmd+F 搜索——实时匹配+计数+选中跳转到第一个", async ({ page }) => {
    await gotoMap(page);
    await page.locator(".map-container").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("Meta+f");
    const input = page.locator("#search-input");
    await expect(input).toBeFocused();
    await input.fill("细节");
    await page.waitForTimeout(400);
    // 预置深树有两个"细节"节点(1-1-1 / 2-1-1)
    await expect(page.locator(".search-count")).toHaveText("1/2");
    const selected = await page.evaluate(
      () => document.querySelector("me-tpc.selected")?.textContent ?? "",
    );
    expect(selected).toContain("细节");
  });

  test("sr-02: Enter 循环下一个匹配——选中推进", async ({ page }) => {
    await gotoMap(page);
    await page.locator(".map-container").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("Meta+f");
    const input = page.locator("#search-input");
    await input.fill("细节");
    await page.waitForTimeout(300);
    await input.press("Enter");
    await page.waitForTimeout(300);
    await expect(page.locator(".search-count")).toHaveText("2/2");
    await input.press("Enter");
    await page.waitForTimeout(300);
    await expect(page.locator(".search-count")).toHaveText("1/2"); // 循环回绕
  });

  test("sr-03: 跳转后的内容操作仍守视图主权——Tab 创建锚点恒定", async ({ page }) => {
    await gotoMap(page);
    await page.locator(".map-container").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("Meta+f");
    const input = page.locator("#search-input");
    await input.fill("细节");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape"); // 退出搜索
    await page.waitForTimeout(300);
    // Escape 后焦点不在画布——真实点击目标节点(归焦+选中,与用户操作一致)
    await clickNode(page, "细节 1-1-1");
    const anchor = await page.evaluate(() => {
      const el = document.querySelector("me-tpc.selected") as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await pressKey(page, "Tab");
    const after = await page.evaluate(() => {
      const els = document.querySelectorAll("me-tpc");
      const el = Array.from(els).find((n) => n.textContent?.includes("细节 1-1-1")) as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expectRectClose(anchor, after);
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1);
  });
});
