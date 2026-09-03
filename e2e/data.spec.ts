/* ============================================================
   data.spec — 数据族(3 条)
   ============================================================
   守护对象:单一数据源(undo 栈完整、自动保存落盘、内存态与保存态
   一致)。断言借助 __testMock 的调用记录与内存文件系统,不依赖 UI 呈现。
   ============================================================ */

import { test, expect } from "@playwright/test";
import {
  gotoMap,
  clickNode,
  nodeCount,
  pressKey,
  PRESET_NODE_COUNT,
} from "./helpers";

function countNodesInContent(c: { root: { children?: unknown[] } }): number {
  const walk = (n: { children?: unknown[] }): number =>
    1 + (n.children ?? []).reduce((s: number, ch) => s + walk(ch as { children?: unknown[] }), 0);
  return walk(c.root);
}

test.describe("数据族", () => {
  test("da-01: undo——Tab×3 后 Cmd+Z×3,节点数回原", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "要点 1-2");
    for (let i = 0; i < 3; i++) await pressKey(page, "Tab");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 3);

    for (let i = 0; i < 3; i++) await pressKey(page, "Meta+z");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT);
  });

  test("da-02: redo——撤销后再重做,操作历史可恢复", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "要点 1-2");
    for (let i = 0; i < 2; i++) await pressKey(page, "Tab");
    for (let i = 0; i < 2; i++) await pressKey(page, "Meta+z");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT);

    for (let i = 0; i < 2; i++) await pressKey(page, "Meta+Shift+z");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 2);
  });

  test("da-03: 自动保存落盘——防抖后 save_mmap 收到与画布一致的树", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "要点 1-2");
    await pressKey(page, "Tab");
    const canvasCount = await nodeCount(page);

    // useAutoSave 防抖默认 2s;等 3s 确保触发
    await page.waitForTimeout(3000);

    const saved = await page.evaluate(() => {
      const m = window.__testMock;
      if (!m) throw new Error("__testMock 丢失");
      const saves = m.callsOf("save_mmap");
      const last = saves[saves.length - 1];
      return {
        saveCount: saves.length,
        content: last?.args as { content: { root: { children?: unknown[] } } } | undefined,
      };
    });
    expect(saved.saveCount).toBeGreaterThan(0);
    expect(countNodesInContent(saved.content!.content)).toBe(canvasCount);
  });
});
