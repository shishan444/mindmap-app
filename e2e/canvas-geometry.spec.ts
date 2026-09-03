/* ============================================================
   canvas-geometry.spec — L2 真实几何层(改道自 vitest browser mode)
   ============================================================
   jsdom 无 layout(getBoundingClientRect 恒 0/无 DOMMatrix),Tab bug
   修复的核心链路(keepAnchorInPlace 位置保持补偿)在 jsdom 物理不可测。
   本文件在真实 Chromium 里挂最小 DOM 场景,经 dev server 的模块服务
   import 源模块,验证补偿几何的三个环节:反向平移/冻结过渡/复检解冻。
   ============================================================ */

import { test, expect, type Page } from "@playwright/test";
import { gotoMap } from "./helpers";

async function runGeometry(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    // dev server 直接服务源模块(与取证台同机制)
    const ca = await import("/src/utils/canvasActions.ts");

    const inner = document.createElement("div");
    inner.className = "mind-elixir-inner";
    inner.style.cssText = "position:fixed; inset:0; overflow:hidden;";
    const canvas = document.createElement("div");
    canvas.className = "map-canvas";
    canvas.style.cssText =
      "position:absolute; width:3000px; height:3000px; transition: transform 0.3s;";
    const tpc = document.createElement("div");
    tpc.style.cssText =
      "position:absolute; left:300px; top:200px; width:120px; height:30px;";
    canvas.appendChild(tpc);
    inner.appendChild(canvas);
    document.body.appendChild(inner);

    const out: Record<string, unknown> = {};
    out.rectWidth = tpc.getBoundingClientRect().width; // jsdom 下恒 0

    // BR-02: 推飞 → restoreAnchorPosition 恰好抵消
    // 注意:场景 canvas 带 0.3s transition,同步读 rect 时渐进动画未发生
    // (flown=0)——这正是当年取证发现的"渐进推飞"现象。按生产语义先冻结,
    // 推飞瞬时完成,几何可同步断言。
    const unfreeze2 = ca.freezeCanvasTransition(inner);
    const before = ca.snapshotAnchor(tpc);
    canvas.style.transform = "translate3d(-295px, 5px, 0px)";
    out.flown = tpc.getBoundingClientRect().x - before.rect.x;
    out.driftAfterRestore = ca.restoreAnchorPosition(null, inner, before);
    unfreeze2();

    // BR-03: 冻结/解冻 computed transition
    const unfreeze = ca.freezeCanvasTransition(inner);
    out.frozenTransition = getComputedStyle(canvas).transitionDuration;
    unfreeze();
    out.unfrozenTransition = getComputedStyle(canvas).transitionDuration;

    // BR-04: keepAnchorInPlace 全链路
    const before2 = ca.snapshotAnchor(tpc);
    ca.keepAnchorInPlace(null, inner, before2, { settleDelayMs: 40, recheckDelayMs: 100 });
    setTimeout(() => {
      canvas.style.transform = "translate3d(-295px, 5px, 0px)";
    }, 20);
    await new Promise((r) => setTimeout(r, 500));
    const after = tpc.getBoundingClientRect();
    out.keepInPlaceDrift = Math.max(
      Math.abs(after.x - before2.rect.x),
      Math.abs(after.y - before2.rect.y),
    );
    out.keepInPlaceTransition = getComputedStyle(canvas).transitionDuration;

    inner.remove();
    return out;
  });
}

test.describe("L2 几何:位置保持补偿链路(真实 layout)", () => {
  test("真浏览器下 rect/补偿/冻结全链路成立", async ({ page }) => {
    await gotoMap(page); // 复用同一 dev server;app 就绪证明环境可信
    const out = await runGeometry(page);

    expect(out.rectWidth).toBe(120); // 真实 layout 生效
    expect(out.flown as number).toBeLessThan(-280); // 推飞真的发生
    expect(out.driftAfterRestore as number).toBeLessThanOrEqual(1); // 恰好抵消
    expect(out.frozenTransition).toBe("0s"); // 冻结生效
    expect(out.unfrozenTransition).toBe("0.3s"); // 解冻恢复
    expect(out.keepInPlaceDrift as number).toBeLessThanOrEqual(1); // 净位移零
    expect(out.keepInPlaceTransition).toBe("0.3s"); // 全链路后动画能力在
  });
});
