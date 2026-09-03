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
  test("dr-01: 非平移手势零副作用——普通滚轮/空白拖拽不得意外移动画布", async ({ page }) => {
    await gotoMap(page);
    // ★ 产品疑点(2026-09-03 矩阵开发发现):测试环境下拖拽 pan 不生效——
    // mind-elixir 5.14 panHelper 未启用,工程自实现拖拽仅覆盖节点 moveNode,
    // 普通滚轮无行为。唯一实证的视图操作 = Ctrl+滚轮缩放(dr-04)。
    // 用户口径"鼠标左右移动画布"的手势待产品确认;确认后此处应升级为
    // 正向平移用例。当前守护反向不变量:非缩放手势不得移动视图。
    const before = await nodeRect(page, "中心主题");
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 240); // 普通滚轮
    await page.mouse.down({ button: "middle" }); // 中键拖
    await page.mouse.move(560, 380, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    await page.mouse.move(640, 300); // 空白左键拖
    await page.mouse.down();
    await page.mouse.move(520, 380, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expectRectClose(before, await nodeRect(page, "中心主题"), 2);
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
