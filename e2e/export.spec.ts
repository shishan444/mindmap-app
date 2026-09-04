/* ============================================================
   export.spec — 导出管道族(2 条)
   ============================================================
   守护对象:导出是纯读管道——菜单动作把当前树送进导出器、
   落盘命令收到字节,且全程画布零副作用。
   (mock 的 dialog save 返回默认路径,管道得以完整走通)
   ============================================================ */

import { test, expect } from "@playwright/test";
import { gotoMap, clickNode, nodeRect, pressKey, expectRectClose } from "./helpers";

test.describe("导出管道族", () => {
  test("ex-01: 菜单导出 markdown——export_markdown 收到当前树,save_bytes 落盘", async ({ page }) => {
    await gotoMap(page);
    await clickNode(page, "要点 1-2");
    await pressKey(page, "Tab"); // 树 +1,导出应携带最新状态
    const sentinel = await nodeRect(page, "中心主题");

    await page.evaluate(() => window.__testMock?.emitMenuAction("export-markdown"));
    await page.waitForTimeout(600);

    const trace = await page.evaluate(() => {
      const m = window.__testMock!;
      const exp = m.callsOf("export_markdown");
      const save = m.callsOf("plugin:dialog|save");
      const bytes = m.callsOf("save_bytes");
      return {
        exportCalled: exp.length,
        exportedRootTopic: (exp[0]?.args as { content?: { root?: { topic?: string } } })?.content
          ?.root?.topic,
        dialogCalled: save.length,
        saveBytesCalled: bytes.length,
      };
    });
    expect(trace.exportCalled).toBe(1);
    expect(trace.exportedRootTopic).toBe("中心主题");
    expect(trace.dialogCalled).toBe(1);
    expect(trace.saveBytesCalled).toBe(1); // 完整管道:导出→选路径→落盘
    expectRectClose(sentinel, await nodeRect(page, "中心主题")); // 纯读,零副作用
  });

  test("ex-02: 导出后画布可继续编辑(管道不残留状态)", async ({ page }) => {
    await gotoMap(page);
    await page.evaluate(() => window.__testMock?.emitMenuAction("export-markdown"));
    await page.waitForTimeout(400);
    // 导出后 Tab 仍正常创建
    await clickNode(page, "要点 1-2");
    await pressKey(page, "Tab");
    const count = await page.evaluate(() => document.querySelectorAll("me-tpc").length);
    expect(count).toBe(12);
  });
});
