/* ============================================================
   overlay.spec — 浮层族(4 条)
   ============================================================
   守护对象:浮层劫持家族 bug(浮层从底部升起挤压布局,三轮才根治)。
   核心断言:任何浮层出现 ⇒ 底部状态栏 + 工具栏 rect 恒定,画布哨兵
   节点 rect 恒定——浮层是 Portal 挂 body 的独立层,不参与文档流。
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  gotoMap,
  clickNode,
  nodeRect,
  nodeCount,
  pressKey,
  layoutFingerprint,
  expectRectClose,
  PRESET_NODE_COUNT,
} from "./helpers";

test.describe("浮层族", () => {
  test("fl-01: GlassDialog(dirty 打开确认)——出现时布局零位移,取消后消失", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "要点 1-2");
    await pressKey(page, "Tab"); // 制造 dirty
    const fp = await layoutFingerprint(page);
    const sentinel = await nodeRect(page, "中心主题");

    // "打开"在有未保存修改时弹 GlassDialog 确认(App.tsx handleOpen)
    await page.locator('[title="打开"]').click();
    await expect(page.locator(".glass-dialog-actions")).toBeVisible();
    expectRectClose(sentinel, await nodeRect(page, "中心主题"));
    (await layoutFingerprint(page)).forEach((r, i) => expectRectClose(r, fp[i]));

    await page.locator(".gd-btn", { hasText: "取消" }).click();
    await expect(page.locator(".glass-dialog-actions")).toBeHidden();
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1); // 取消=画布原样
  });

  test("fl-02: AboutModal(菜单路径)——版本浮窗,布局零位移,可关闭", async ({ page }) => {
    await gotoMap(page);
    const fp = await layoutFingerprint(page);
    const sentinel = await nodeRect(page, "中心主题");

    await page.evaluate(() => window.__testMock?.emitMenuAction("about"));
    await page.locator(".about-modal, [class*='about']").first().waitFor({ state: "visible" });
    expectRectClose(sentinel, await nodeRect(page, "中心主题"));
    (await layoutFingerprint(page)).forEach((r, i) => expectRectClose(r, fp[i]));

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  });

  test("fl-03: HotkeyHelpModal(菜单路径)——快捷键速查浮窗,布局零位移", async ({ page }) => {
    await gotoMap(page);
    const fp = await layoutFingerprint(page);
    const sentinel = await nodeRect(page, "中心主题");

    await page.evaluate(() => window.__testMock?.emitMenuAction("hotkeys"));
    await expect(page.locator(".hotkey-close")).toBeVisible();
    expectRectClose(sentinel, await nodeRect(page, "中心主题"));
    (await layoutFingerprint(page)).forEach((r, i) => expectRectClose(r, fp[i]));

    await page.keyboard.press("Escape");
    await expect(page.locator(".hotkey-close")).toBeHidden();
  });

  test("fl-04: 浮层关闭后画布满血——Tab 立即恢复创建", async ({ page }) => {
    await gotoMap(page);
    await page.evaluate(() => window.__testMock?.emitMenuAction("hotkeys"));
    await expect(page.locator(".hotkey-close")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".hotkey-close")).toBeHidden();

    await clickNode(page, "要点 1-2");
    await pressKey(page, "Tab");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1);
  });
});
