/* ============================================================
   mcp.spec — MCP 协作族(3 条)
   ============================================================
   守护对象:LLM 协作产品红线——会话横幅实时可见、画布锁定、
   用户接管必然成功。事件经 mock 的 Tauri 事件通道派发
   (__testMock.emit),与 Rust 真实广播同一条前端处理链。
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

/** 模拟 Rust 侧 acquire 成功后的会话广播 */
function emitAcquired(page: import("@playwright/test").Page, name = "Claude"): Promise<void> {
  return page.evaluate((client) => {
    window.__testMock?.emit("llm-session-changed", {
      session: {
        id: "test-session-1",
        client_name: client,
        acquired_at_ms: Date.now(),
        expires_at_ms: Date.now() + 60000,
        ttl_ms: 60000,
      },
      reason: "acquired",
    });
  }, name);
}

test.describe("MCP 协作族", () => {
  test("mcp-01: LLM 持锁 → 横幅出现+画布锁定+布局零位移", async ({ page }) => {
    await gotoMap(page);
    const fp = await layoutFingerprint(page);
    const sentinel = await nodeRect(page, "中心主题");

    await emitAcquired(page, "测试助手");
    await expect(page.locator(".llm-banner")).toBeVisible();
    await expect(page.locator(".llm-banner")).toContainText("测试助手");
    // 画布锁定:llm-active 态(pointer-events: none)
    const locked = await page.evaluate(() =>
      document.querySelector(".mind-elixir-inner")?.classList.contains("llm-active"),
    );
    expect(locked).toBe(true);
    expectRectClose(sentinel, await nodeRect(page, "中心主题"));
    (await layoutFingerprint(page)).forEach((r, i) => expectRectClose(r, fp[i]));
  });

  test("mcp-02: 用户接管 → llm_force_release 下发+横幅消失+画布解锁", async ({ page }) => {
    await gotoMap(page);
    await emitAcquired(page, "测试助手");
    await expect(page.locator(".llm-banner")).toBeVisible();

    await page.locator(".llm-banner-takeover").click();
    await expect(page.locator(".llm-banner")).toBeHidden();
    const unlocked = await page.evaluate(() =>
      document.querySelector(".mind-elixir-inner")?.classList.contains("llm-active"),
    );
    expect(unlocked).toBe(false);
    const released = await page.evaluate(
      () => window.__testMock?.callsOf("llm_force_release").length ?? 0,
    );
    expect(released).toBeGreaterThan(0); // 中断权真的下发了
  });

  test("mcp-03: 会话结束(released) → 画布满血,Tab 恢复创建", async ({ page }) => {
    await gotoMap(page);
    await emitAcquired(page, "测试助手");
    await expect(page.locator(".llm-banner")).toBeVisible();
    await page.evaluate(() => {
      window.__testMock?.emit("llm-session-changed", { session: null, reason: "released" });
    });
    await expect(page.locator(".llm-banner")).toBeHidden();

    await clickNode(page, "要点 1-2");
    await pressKey(page, "Tab");
    expect(await nodeCount(page)).toBe(PRESET_NODE_COUNT + 1);
  });
});
