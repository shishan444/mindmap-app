/* ============================================================
   context-menu.spec — 右键菜单族(3 条)
   ============================================================
   守护对象:菜单路径的内容操作(与键盘路径不同源,走
   settleCanvasFocus(anchor) 补偿)——同样遵守视图主权。
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  gotoMap,
  layoutFingerprint,
  nodeRect,
  nodeCount,
  expectRectClose,
  PRESET_NODE_COUNT,
} from "./helpers";

/** 在指定节点上派发右键(应用监听 contextmenu) */
async function contextMenuOn(page: import("@playwright/test").Page, topic: string): Promise<void> {
  await page.evaluate((t) => {
    const el = Array.from(document.querySelectorAll("me-tpc")).find((n) =>
      n.textContent?.startsWith(t),
    ) as HTMLElement;
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
    );
  }, topic);
}

test.describe("右键菜单族", () => {
  test("cm-01: 节点右键 → 中文菜单出现,布局零位移", async ({ page }) => {
    await gotoMap(page);
    const fp = await layoutFingerprint(page);
    const sentinel = await nodeRect(page, "中心主题");

    await contextMenuOn(page, "要点 1-2");
    const menu = page.locator(".ctx-menu");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("添加子节点");
    expectRectClose(sentinel, await nodeRect(page, "中心主题"));
    (await layoutFingerprint(page)).forEach((r, i) => expectRectClose(r, fp[i]));
    await page.keyboard.press("Escape");
  });

  test("cm-02: 菜单'添加子节点'——节点 +1,锚点纹丝不动(菜单路径补偿)", async ({ page }) => {
    await gotoMap(page);
    const anchor = await nodeRect(page, "要点 1-2");
    await contextMenuOn(page, "要点 1-2");
    await page.locator(".ctx-menu").getByText("添加子节点").click();
    await page.waitForTimeout(600);
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1);
    expectRectClose(anchor, await nodeRect(page, "要点 1-2"));
  });

  test("cm-03: 菜单'删除节点'——节点 -1", async ({ page }) => {
    await gotoMap(page);
    await contextMenuOn(page, "细节 2-1-1");
    await page.locator(".ctx-menu").getByText("删除节点").click();
    await page.waitForTimeout(600);
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT - 1);
  });
});
