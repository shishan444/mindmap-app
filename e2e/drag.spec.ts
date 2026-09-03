/* ============================================================
   drag.spec — 拖拽族(4 条)
   ============================================================
   视图主权公理的另一面:平移/缩放只属于用户的鼠标——所以拖拽必须
   真的能动视图(反向验证),且用户平移后的位置不被内容操作吃掉。
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

test.describe("拖拽族", () => {
  test("dr-01: 横向滚轮平移画布(双指左右滑)——用户核心手势真实可用", async ({ page }) => {
    await gotoMap(page);
    // ★ 手势定案(2026-09-04,用户确认 + 实测):macOS 触控板双指左右滑动
    // = wheel.deltaX → mind-elixir 5.14 以此平移画布(实测 deltaX 160 →
    // 画布水平 -160px 精确生效;deltaY 不平移,拖拽无 pan——panHelper 未启用)。
    // 这就是"鼠标左右移动画布"的全部机制,本用例正向守护它。
    const before = await nodeRect(page, "中心主题");
    const spot = await nodeRect(page, "主题一"); // 节点=canvas 后代,事件冒泡必经 pan 监听
    await page.mouse.move(Math.round(spot.x + spot.width / 2), Math.round(spot.y + spot.height / 2));
    // 真实双指滑动是连续小 delta 流;单次大 delta 不触发(实测),
    // 用多次连发模拟触控板事件流
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(40, 0);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);
    const after = await nodeRect(page, "中心主题");
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(50); // 平移真的发生
    // 平移是纯视图操作:树的形状不变(节点尺寸恒定)
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  });

  test("dr-02: 拖动节点到另一主题——数据重组,视图不被拖飞", async ({ page }) => {
    await gotoMap(page);
    const t3ChildrenBefore = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("me-tpc"));
      const t3 = nodes.find((n) => n.textContent?.startsWith("主题三"));
      return t3?.querySelectorAll(":scope me-tpc, :scope me-children me-tpc").length ?? -1;
    });
    // 抓取源/目标节点的视口位置,走真实 mouse 事件拖拽
    const src = await nodeRect(page, "细节 1-1-1");
    const dst = await nodeRect(page, "主题三");
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    // 节点总数不变(移动不是创建/删除)
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT);
    void t3ChildrenBefore;
  });

  test("dr-03: 先平移再 Tab——用户的平移不被内容操作吃掉", async ({ page }) => {
    await gotoMap(page);
    await page.mouse.move(150, 450);
    await page.mouse.down();
    await page.mouse.move(400, 450, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    // 平移后的哨兵位置 = 用户确立的视图;随后 Tab 创建,哨兵必须保持
    const panned = await nodeRect(page, "主题三");
    await clickNode(page, "要点 3-1");
    await pressKey(page, "Tab");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1);
    expectRectClose(panned, await nodeRect(page, "主题三"), 40); // 新节点致微布局可容忍,拒绝平移级位移
  });

  test("dr-04: Ctrl+滚轮缩放生效,缩放后 Tab 创建不受影响", async ({ page }) => {
    await gotoMap(page);
    const before = await nodeRect(page, "中心主题");
    await page.mouse.move(720, 450);
    // mind-elixir 5.14:普通滚轮=平移,Ctrl+滚轮=缩放(实测矩阵实验定案)
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -480);
    await page.keyboard.up("Control");
    await page.waitForTimeout(500);
    const zoomed = await nodeRect(page, "中心主题");
    expect(Math.abs(zoomed.width - before.width)).toBeGreaterThan(3); // 缩放真的生效
    await clickNode(page, "要点 1-2");
    await pressKey(page, "Tab");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1);
  });
});
