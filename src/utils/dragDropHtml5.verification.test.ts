/**
 * 根因验证 + 修复守卫测试
 *
 * 历史:
 *  - 用户在 mindmap-app 拖动节点时看到"黑屏,只有一个亮点"
 *  - 经 look-think 三层分析 + 代码层验证,定位根因是 HTML5 drag-and-drop 冲突
 *    (mind-elixir 5.14 me-tpc 内部 <img>/<a> 默认 draggable=true,
 *     项目无 dragstart 拦截 → 浏览器启动 HTML5 drag → drag image + WKWebView drag state)
 *
 * 测试两部分:
 *  1. 验证 1-6:浏览器 HTML5 drag 标准行为(永远成立,作为根因证据)
 *  2. 守卫 7-9:项目代码必须保留 dragstart 拦截 + preventDefault + -webkit-user-drag: none
 *     (防回归守卫,任何意外移除都会立即失败)
 */

import { describe, it, expect } from "vitest";

describe("根因验证: HTML5 drag-and-drop 触发路径", () => {
  it("验证 1: <img> 元素默认 draggable=true(HTML 标准)", () => {
    const img = document.createElement("img");
    // HTML 标准:img 默认 draggable=true
    // 显式设为 false 才能阻止 HTML5 drag
    expect(img.draggable).toBe(true);
  });

  it("验证 2: <span> 元素默认 draggable=false(不会单独触发 drag)", () => {
    const span = document.createElement("span");
    expect(span.draggable).toBe(false);
  });

  it("验证 3: <a> 元素默认 draggable=true(HTML 标准,带 href 的链接可拖)", () => {
    const a = document.createElement("a");
    a.href = "https://example.com";
    // HTML 标准: <a href> 默认 draggable=true
    expect(a.draggable).toBe(true);
  });

  it("验证 4: 模拟 mind-elixir me-tpc 节点结构 → 含 img 子元素", () => {
    // 模拟 mind-elixir 5.14 Mt 函数(MindElixir.js:364)
    const meTpc = document.createElement("me-tpc");
    meTpc.nodeObj = { id: "test-node", topic: "测试节点", image: { url: "data:image/png;base64,xxx", width: 80, height: 80 } };

    // 模拟 mind-elixir createTopic 内部(MindElixir.js:323-326)
    const img = document.createElement("img");
    img.src = meTpc.nodeObj.image.url;
    meTpc.appendChild(img);

    // 模拟 text span
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = meTpc.nodeObj.topic;
    meTpc.appendChild(text);

    // ★ 核心断言 ★
    // me-tpc custom element 默认 draggable=false(HTMLElement 默认),mind-elixir 没改
    expect(meTpc.draggable).toBe(false);
    // 但内部 img 默认 draggable=true ← 这就是 HTML5 drag 的触发源!
    expect((meTpc.querySelector("img") as HTMLImageElement).draggable).toBe(true);
  });

  it("验证 5: 静态分析 — MindMapCanvas.css 设了 pointer-events: none 但不影响 draggable", () => {
    // CSS pointer-events: none 阻止鼠标事件(click/mousedown)穿透到子元素
    // 但不影响 HTML 标准 draggable 属性
    // 浏览器 drag-and-drop 系统独立于 pointer-events 运行
    const meTpc = document.createElement("me-tpc");
    const img = document.createElement("img");
    meTpc.appendChild(img);

    // 模拟 CSS 设的 pointer-events: none
    img.style.pointerEvents = "none";

    // pointer-events 不影响 draggable 属性
    expect(img.draggable).toBe(true); // 仍是 true!
  });

  it("验证 6: 必须显式 img.draggable=false 才能阻止 HTML5 drag", () => {
    const img = document.createElement("img");
    img.draggable = false; // 显式关闭
    expect(img.draggable).toBe(false);
  });
});

describe("根因修复后的守卫(防回归)", () => {
  it("守卫 7: MindMapCanvas.tsx 必须有 dragstart 监听器(根因修复后)", () => {
    const fs = require("fs");
    const path = require("path");
    const code = fs.readFileSync(
      path.join(__dirname, "../components/MindMapCanvas.tsx"),
      "utf-8",
    );

    // 修复后:必须有 dragstart 拦截(防止 HTML5 drag 触发 drag image + drag state)
    const hasDragstartListener =
      code.includes("addEventListener('dragstart'") ||
      code.includes('addEventListener("dragstart"') ||
      /addEventListener\(['"]dragstart['"]/.test(code);

    expect(hasDragstartListener).toBe(true);
  });

  it("守卫 8: MindMapCanvas.tsx onDragStart(mousedown)必须 preventDefault(根因修复后)", () => {
    const fs = require("fs");
    const path = require("path");
    const code = fs.readFileSync(
      path.join(__dirname, "../components/MindMapCanvas.tsx"),
      "utf-8",
    );

    const onDragStartMatch = code.match(
      /onDragStart\s*=\s*\(e:\s*MouseEvent\)\s*=>\s*{([\s\S]*?)^      };/m,
    );
    expect(onDragStartMatch).not.toBeNull();
    const handlerBody = onDragStartMatch![1];
    expect(handlerBody.includes("preventDefault")).toBe(true);
  });

  it("守卫 9: CSS 必须有 -webkit-user-drag: none(me-tpc 子元素)", () => {
    const fs = require("fs");
    const path = require("path");
    const css = fs.readFileSync(
      path.join(__dirname, "../components/MindMapCanvas.css"),
      "utf-8",
    );
    expect(css.includes("-webkit-user-drag: none")).toBe(true);
  });
});
