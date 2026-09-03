/* ============================================================
   focus.spec — 焦点族(3 条)
   ============================================================
   守护对象:浏览器焦点环劫持(画布外 Tab 放行 → scrollIntoView 移动
   视图,"画布找不到节点")。核心断言:任意焦点状态流转,页面零滚动、
   视图零变化;文本输入类的 Tab 正常放行(编辑语义)。
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  gotoMap,
  clickNode,
  nodeRect,
  nodeCount,
  pressKey,
  expectRectClose,
  PRESET_NODE_COUNT,
} from "./helpers";

test.describe("焦点族", () => {
  test("fo-01: 搜索框内 Tab(输入类放行)——焦点移出,但视图零变化", async ({ page }) => {
    await gotoMap(page);
    const before = await nodeRect(page, "中心主题");
    const scroll = () => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const s0 = await scroll();

    await page.locator("#search-input").focus();
    await page.keyboard.type("主题");
    await pressKey(page, "Tab"); // isTextEntryTarget → 放行(焦点流转)
    await pressKey(page, "Tab");

    expectRectClose(before, await nodeRect(page, "中心主题"));
    expect(await scroll()).toEqual(s0); // 页面零滚动(焦点环劫持的旧病灶)
  });

  test("fo-02: F2 编辑态 Tab——不创建节点,退出编辑后恢复创建", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "要点 1-2");
    await pressKey(page, "F2");
    await expect(page.locator("#input-box")).toBeVisible();
    const count = await nodeCount(page);

    await pressKey(page, "Tab"); // 编辑态一切放行——不该创建节点
    expect(await nodeCount(page)).toBe(count);

    await page.keyboard.press("Escape"); // 退出编辑
    await page.waitForTimeout(300);
    await pressKey(page, "Tab");
    expect(await nodeCount(page)).toBe(count + 1);
  });

  test("fo-03: Cmd+F 聚焦搜索 → Esc → Tab——焦点全旅程视图零变化", async ({ page }) => {
    await gotoMap(page);
    const before = await nodeRect(page, "中心主题");

    // Cmd+F 的拦截在画布 fallback(焦点须在画布);先点击画布空白归焦
    await page.locator(".map-container").click({ position: { x: 100, y: 100 } });
    await page.keyboard.press("Meta+f");
    await expect(page.locator("#search-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await pressKey(page, "Tab");

    expectRectClose(before, await nodeRect(page, "中心主题"));
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT); // 无选中 Tab 零副作用
  });
});
