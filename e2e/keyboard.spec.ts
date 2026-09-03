/* ============================================================
   keyboard.spec — 键盘族(6 条)
   ============================================================
   守护对象:Tab 双变体 bug(5.14 layout 推飞 + 焦点环劫持)。
   核心断言:每个内容操作,锚点(操作节点)视口 rect 恒定——
   视图主权公理的运行时表达。预置深树保证走到推飞路径。
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

test.describe("键盘族", () => {
  test("kb-01: Tab 连续创建(深树推飞路径)——链式生长,每步锚点纹丝不动", async ({ page }) => {
    await gotoMap(page);
    // 从最深叶子继续加:每次 Tab 在"当前选中"下建子,链式直达深度 4+
    await clickNode(page, "细节 1-1-1");

    // 锚点 = 每步的操作节点(注意:Tab 后 .selected 移到新节点,锚点要用元素引用)
    const rectOfAnchor = () =>
      page.evaluate(() => {
        const el = (window as unknown as { __anchorEl?: HTMLElement }).__anchorEl;
        if (!el) throw new Error("锚点元素丢失");
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });

    for (let i = 1; i <= 3; i++) {
      await page.evaluate(() => {
        (window as unknown as { __anchorEl?: HTMLElement }).__anchorEl =
          document.querySelector("me-tpc.selected") as HTMLElement;
      });
      const anchor = await rectOfAnchor();
      await pressKey(page, "Tab");
      // 补偿的不变量:操作节点(锚点)保持原位
      expectRectClose(anchor, await rectOfAnchor());
    }
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 3);
  });

  test("kb-02: Enter 建兄弟节点——锚点不动,节点数 +1", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "细节 1-1-1");
    const anchor = await nodeRect(page, "细节 1-1-1");
    await pressKey(page, "Enter");
    // 锚点是原操作节点(Enter 后 .selected 已移到新兄弟)
    const after = await nodeRect(page, "细节 1-1-1");
    expectRectClose(anchor, after);
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1);
  });

  test("kb-03: F2 编辑——输入框出现,改题生效,节点数不变", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "要点 1-2");
    await pressKey(page, "F2");
    const input = page.locator("#input-box");
    await expect(input).toBeVisible();
    await input.fill("改名后的要点");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    await expect(page.locator("me-tpc", { hasText: "改名后的要点" })).toBeVisible();
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT);
  });

  test("kb-04: Delete 删除叶子——节点数 -1,视图不侵入", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "细节 2-1-1");
    const sentinelBefore = await nodeRect(page, "主题三"); // 旁观哨兵
    await pressKey(page, "Delete");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT - 1);
    // 删除 1-1 的远端叶子,主题三分支的布局不应变化;画布不得整体平移
    const sentinelAfter = await nodeRect(page, "主题三");
    expectRectClose(sentinelBefore, sentinelAfter, 40); // 布局容忍,拒绝推飞级位移
  });

  test("kb-05: 无选中 Tab(变体 B)——零副作用:节点不建,视图不丢", async ({ page }) => {
    await gotoMap(page);
    // 制造"无选中":点击画布空白处
    const before = await nodeRect(page, "中心主题");
    const count = await nodeCount(page);
    await page.locator(".map-container").click({ position: { x: 60, y: 60 } });
    await page.waitForTimeout(200);
    await pressKey(page, "Tab");
    expect(await nodeCount(page)).toBe(count);
    const after = await nodeRect(page, "中心主题");
    expectRectClose(before, after);
  });

  test("kb-06: 焦点在工具栏时 Tab——视图零变化(焦点环接管)", async ({ page }) => {
    await gotoMap(page);
    await page.locator('[title="保存"]').focus();
    const before = await nodeRect(page, "中心主题");
    const layout = await page.evaluate(() => {
      const el = document.querySelector(".status-bar") as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await pressKey(page, "Tab");
    await pressKey(page, "Tab");
    const after = await nodeRect(page, "中心主题");
    expectRectClose(before, after);
    const layoutAfter = await page.evaluate(() => {
      const el = document.querySelector(".status-bar") as HTMLElement;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    expect(layoutAfter).toEqual(layout); // 页面无滚动(焦点环劫持的旧病灶)
  });
});
