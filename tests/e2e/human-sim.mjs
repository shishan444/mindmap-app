// 人类模拟验证脚本
// 与 cdp-regression.mjs 的区别:
//   - 真实鼠标移动(多步 mouseMoved 轨迹采集,不是直接 click)
//   - 真实按键(逐字符 keyDown/keyUp,不是 insertText 一次性)
//   - 随机延迟(200-500ms 模拟人类反应)
//   - 截图视觉验证
// 覆盖本轮新加的 reminder 编辑 + centerNode 居中跳转

import WebSocket from "ws";
import { writeFileSync } from "fs";

const TAURI_MOCK = `
(function() {
  function uuid() { return 'mock-' + Math.random().toString(36).slice(2, 10); }
  const state = {
    config: {
      version: "1", last_open_dir: null, last_export_dir: null, last_import_dir: null,
      default_new_file_dir: null, last_opened_file: null,
      window_state: { x: 100, y: 100, width: 1440, height: 900, is_maximized: false, sidebar_width: 280, sidebar_collapsed: false, active_tab: "properties" },
      ui: { theme: "light", language: "zh-CN", font_family: "", font_size: 14, show_minimap: false, show_toolbar: true },
      auto_save_interval_sec: 30, recent_files_max: 20,
      reminder: { sound_enabled: true, sound_file: "", default_priority: "P2", snooze_minutes: 5, show_modal_when_background: true, system_notification_enabled: true },
      export: { png_scale: 2, markdown_indent: "  " },
    },
    reminders: [],
    savedFiles: {},
  };
  function makeContent(topic) {
    return {
      version: "1",
      root: { id: "root", topic: topic || "中心主题", children: [] },
      canvas_state: { zoom: 1, pan_x: 0, pan_y: 0 },
    };
  }
  window.__TAURI_INTERNALS__ = {
    invoke: async function(cmd, args) {
      switch (cmd) {
        case "ping": return "pong";
        case "get_config": return state.config;
        case "save_config_command": if (args?.cfg) state.config = args.cfg; return null;
        case "path_exists": return false;
        case "new_mmap": return makeContent(args?.topic);
        case "open_mmap": return state.savedFiles[args?.path] || makeContent("已加载");
        case "save_mmap": if (args?.path && args?.content) state.savedFiles[args.path] = args.content; return null;
        case "save_bytes": return null;
        case "add_recent_file":
        case "set_last_opened_file":
        case "update_last_dirs":
        case "log_event": return null;
        case "get_reminders_for_node": return state.reminders.filter(r => r.node_id === args?.nodeId);
        case "get_reminders": return { version: "1", reminders: state.reminders };
        case "upsert_reminder":
          if (args?.reminder) {
            const i = state.reminders.findIndex(r => r.id === args.reminder.id);
            if (i >= 0) state.reminders[i] = args.reminder;
            else state.reminders.push(args.reminder);
          }
          return { version: "1", reminders: state.reminders };
        case "delete_reminder":
          state.reminders = state.reminders.filter(r => r.id !== args?.id);
          return { version: "1", reminders: state.reminders };
        case "attach_file_to_node":
        case "replace_attached_file": {
          const ext = (args?.srcPath || args?.newSrc || "").split(".").pop() || "pdf";
          return {
            uuid: uuid(), original_name: "mock.pdf", ext, file_type: "pdf",
            size_bytes: 1024, attached_at: new Date().toISOString(),
          };
        }
        case "remove_attached_file":
        case "open_attached_file":
        case "reveal_attached_file": return null;
        case "read_thumbnail": return null;
        default: return null;
      }
    },
    transformCallback: function() { return "cb"; },
    unregisterCallback: function() {},
    convertFileSrc: function(p) { return p; },
  };

  // === Tauri event 系统 mock(让 listen/emit 真实工作)===
  // @tauri-apps/api/event 的 listen 通过 invoke("plugin:event|listen") 注册
  // 我们拦截这个命令,维护 event -> [callbackId] 映射
  window.__TAURI_EVENT_LISTENERS__ = {}; // event -> [callbackId]
  window.__TAURI_CALLBACKS__ = {}; // callbackId -> { cb, once }
  window.__TAURI_INTERNALS__.transformCallback = function(cb, once) {
    const id = "cb_" + Math.random().toString(36).slice(2);
    window.__TAURI_CALLBACKS__[id] = { cb, once: !!once };
    return id;
  };
  window.__TAURI_INTERNALS__.unregisterCallback = function(id) {
    delete window.__TAURI_CALLBACKS__[id];
  };

  const origInvoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async function(cmd, args) {
    if (cmd === "plugin:event|listen") {
      const ev = args?.event;
      const handlerId = args?.handler;
      if (ev && handlerId) {
        if (!window.__TAURI_EVENT_LISTENERS__[ev]) {
          window.__TAURI_EVENT_LISTENERS__[ev] = [];
        }
        window.__TAURI_EVENT_LISTENERS__[ev].push(handlerId);
      }
      return Math.random().toString(36).slice(2); // listener id
    }
    if (cmd === "plugin:event|unlisten") {
      return null;
    }
    return origInvoke(cmd, args);
  };

  // 手动触发 event(测试用)
  window.__mockEmitTauriEvent = function(event, payload) {
    const ids = window.__TAURI_EVENT_LISTENERS__[event] || [];
    for (const id of ids) {
      const entry = window.__TAURI_CALLBACKS__[id];
      if (entry?.cb) {
        entry.cb({ event, payload, id: 0, windowLabel: "" });
        if (entry.once) delete window.__TAURI_CALLBACKS__[id];
      }
    }
  };
})();
`;

async function getTargets() { return (await fetch(`http://localhost:9333/json`)).json(); }

class HumanSim {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    // 当前鼠标位置(模拟物理状态)
    this.cursorX = 720;
    this.cursorY = 450;
  }

  static async connect() {
    const targets = await getTargets();
    const page = targets.find(t => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
    return new HumanSim(ws);
  }

  async send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }

  // === 人类化鼠标移动(多步轨迹,模拟物理鼠标)===
  async humanMove(toX, toY, steps = 12) {
    const fromX = this.cursorX;
    const fromY = this.cursorY;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // 线性插值 + 极小抖动(模拟手抖,但确保不偏出小按钮)
      const jitter = (Math.random() - 0.5) * 0.8;
      const x = fromX + (toX - fromX) * t + jitter;
      const y = fromY + (toY - fromY) * t + jitter;
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x, y,
      });
      await sleep(16);
    }
    this.cursorX = toX;
    this.cursorY = toY;
  }

  // 真实点击:先移动到目标,停顿,然后 press + release
  async humanClick(x, y, { delay = 100 + Math.random() * 200 } = {}) {
    await this.humanMove(x, y);
    await sleep(delay);
    // 关键:hover 一下(模拟读 UI)
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x, y,
    });
    await sleep(20);
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", clickCount: 1,
    });
    await sleep(50 + Math.random() * 50);
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 1,
    });
  }

  // 双击:两次 click,间隔短
  async humanDoubleClick(x, y) {
    await this.humanClick(x, y, { delay: 50 });
    await sleep(100); // 双击间隔
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", clickCount: 2,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 2,
    });
  }

  // 逐字符真实按键(每个字符 keyDown + keyUp)
  // 关键:必须带 text 字段,CDP 才会产生真实字符(否则只是按键事件,不产生输入)
  async humanType(text, { delay = 60 } = {}) {
    for (const ch of text) {
      const code = charToCode(ch);
      const vk = ch.charCodeAt(0);
      await this.send("Input.dispatchKeyEvent", {
        type: "keyDown", key: ch, code, text: ch, windowsVirtualKeyCode: vk,
      });
      await sleep(30 + Math.random() * 30);
      await this.send("Input.dispatchKeyEvent", {
        type: "keyUp", key: ch, code, windowsVirtualKeyCode: vk,
      });
      await sleep(delay + Math.random() * 40);
    }
  }

  // 单键
  async humanKey(key, code, vk, { modifiers = 0 } = {}) {
    await this.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", modifiers, key, code, windowsVirtualKeyCode: vk,
    });
    await sleep(50 + Math.random() * 30);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp", modifiers, key, code, windowsVirtualKeyCode: vk,
    });
  }

  // 截图(视觉验证)
  async screenshot(path) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(r.data, "base64"));
  }

  // 找元素中心点(供 humanClick 用)
  async centerOf(selector) {
    return this.evaluate(`(function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height };
    })()`);
  }

  async close() { this.ws.close(); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function charToCode(ch) {
  // 简化映射
  if (ch === " ") return "Space";
  if (ch === "\n") return "Enter";
  return "Key" + ch.toUpperCase();
}

const rand = (min, max) => min + Math.random() * (max - min);

async function main() {
  const c = await HumanSim.connect();
  console.log("[HumanSim] 连接成功");

  await c.send("Page.enable");
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: TAURI_MOCK });
  await c.send("Page.reload");
  await sleep(3000);

  const results = [];
  function record(id, name, ok, detail = "") {
    results.push({ id, name, ok, detail });
    console.log(`  ${ok ? "✓" : "✗"} ${id} ${name}${detail ? " — " + detail : ""}`);
  }

  // === H1. 新建思维导图(人类点击) ===
  console.log("\n=== H1. 新建思维导图 ===");
  const newBtnPos = await c.centerOf('button[title="新建"]');
  if (newBtnPos) {
    await c.humanClick(newBtnPos.x, newBtnPos.y);
    await sleep(1500);
  }
  const h1Topic = await c.evaluate(`document.querySelector("me-tpc .text")?.textContent`);
  record("H1-新建", "点击新建按钮,中心主题渲染", h1Topic === "中心主题", `topic=${h1Topic}`);
  await c.screenshot("/Users/ss/works/tmp/24071720-e2e回归/h1-new.png");

  // === H2. Tab 创建子节点 ===
  console.log("\n=== H2. Tab 创建子节点(键盘) ===");
  // 先单击根节点选中
  const rootPos = await c.centerOf("me-tpc");
  if (rootPos) {
    await c.humanClick(rootPos.x, rootPos.y);
    await sleep(400);
  }
  // 把焦点放到 map-container(inCanvas 检查需要)
  await c.evaluate(`(function(){ const mc = document.querySelector(".map-container"); if (mc) mc.focus(); })()`);
  await sleep(200);
  // 按 Tab(真实键盘)
  await c.humanKey("Tab", "Tab", 9);
  await sleep(700);
  const h2Count = await c.evaluate(`document.querySelectorAll("me-tpc").length`);
  record("H2-Tab", "Tab 真实按键创建子节点", h2Count === 2, `节点数=${h2Count}`);
  await c.screenshot("/Users/ss/works/tmp/24071720-e2e回归/h2-tab.png");

  // === H3. F2 编辑节点 topic(逐字符输入) ===
  console.log("\n=== H3. F2 编辑(逐字符输入) ===");
  // 选中刚创建的子节点
  const childPos = await c.evaluate(`(function() {
    const tpcs = Array.from(document.querySelectorAll("me-tpc"));
    const child = tpcs[tpcs.length - 1];
    if (!child) return null;
    const r = child.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
  if (childPos) {
    await c.humanClick(childPos.x, childPos.y);
    await sleep(400);
  }
  // 关键:focus 到 map-container(inCanvas 检查需要)
  await c.evaluate(`(function(){ const mc = document.querySelector(".map-container"); if (mc) mc.focus(); })()`);
  await sleep(200);
  await c.humanKey("F2", "F2", 113);
  await sleep(500);
  const inputBoxVisible = await c.evaluate(`!!document.querySelector("#input-box, input-box")`);
  let h3Typed = false;
  if (inputBoxVisible) {
    // focus 输入框
    await c.evaluate(`(function(){ const ib = document.querySelector("#input-box") || document.querySelector("input-box"); if (ib) { ib.focus(); const inp = ib.querySelector("input, textarea, [contenteditable]"); if (inp) inp.focus(); } })()`);
    await sleep(200);
    await c.humanType("EDITED");
    await sleep(300);
    h3Typed = await c.evaluate(`(function(){ const ib = document.querySelector("#input-box") || document.querySelector("input-box"); return !!ib && /EDITED/.test(ib.textContent || ib.querySelector("input")?.value || ""); })()`);
    await c.humanKey("Enter", "Enter", 13);
    await sleep(500);
  }
  const h3Text = await c.evaluate(`Array.from(document.querySelectorAll("me-tpc .text")).map(t => t.textContent).join("|")`);
  record("H3-F2", "F2 + 逐字符输入 + Enter", h3Text.includes("EDITED"), `节点文本=${h3Text}, inputVisible=${inputBoxVisible}, typed=${h3Typed}`);

  // === H4. 切到"提醒"tab + 添加 reminder ===
  console.log("\n=== H4. 添加 reminder(真实点击) ===");
  // 先选中根节点(确保 selectedId 有值)
  const rootForRem = await c.centerOf("me-tpc");
  if (rootForRem) {
    await c.humanClick(rootForRem.x, rootForRem.y);
    await sleep(400);
  }
  await c.evaluate(`(function(){ const mc = document.querySelector(".map-container"); if (mc) mc.focus(); })()`);
  // 点"提醒"tab
  const remindTabPos = await c.evaluate(`(function() {
    const tabs = Array.from(document.querySelectorAll(".sidebar-tab"));
    const t = tabs.find(t => /提醒/.test(t.textContent || ""));
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
  if (remindTabPos) {
    await c.humanClick(remindTabPos.x, remindTabPos.y);
    await sleep(500);
  }
  // 调试:看当前 activeTab 和 selectedId
  const h4Debug1 = await c.evaluate(`({
    activeTab: window.__store?.getState?.().activeTab,
    selectedNodeId: window.__store?.getState?.().selectedNodeId,
    hasAddBtn: !!document.querySelector(".rem-add-btn"),
    emptyText: document.querySelector(".reminders-empty")?.textContent,
    tabEmpty: document.querySelector(".tab-empty")?.textContent,
  })`);
  console.log("  [debug] H4 状态:", JSON.stringify(h4Debug1));

  // 点"+ 添加"按钮
  const addBtnPos = await c.centerOf(".rem-add-btn");
  if (addBtnPos) {
    await c.humanClick(addBtnPos.x, addBtnPos.y);
    await sleep(500);
  }
  // 调试:表单是否出现
  const h4FormVisible = await c.evaluate(`!!document.querySelector(".rem-add-form")`);
  console.log("  [debug] 添加表单出现:", h4FormVisible);

  // 在标题输入框逐字符输入
  if (h4FormVisible) {
    const titlePos = await c.centerOf(".rem-add-form input[type=text]");
    if (titlePos) {
      await c.humanClick(titlePos.x, titlePos.y);
      await sleep(200);
      await c.humanType("HumanSim");
      await sleep(200);
    }
    // 调试:输入框值
    const h4InputVal = await c.evaluate(`document.querySelector(".rem-add-form input[type=text]")?.value`);
    console.log("  [debug] 输入框值:", h4InputVal);

    // 点"保存"按钮
    const savePos = await c.centerOf(".rem-save");
    if (savePos) {
      await c.humanClick(savePos.x, savePos.y);
      await sleep(600);
    }
  }
  const h4Title = await c.evaluate(`(function() {
    const titles = Array.from(document.querySelectorAll(".rem-title")).map(t => t.textContent);
    return titles;
  })()`);
  record("H4-添加", "添加 reminder(真实点击 + 输入)", h4Title.some(t => /HumanSim/.test(t || "")), JSON.stringify(h4Title));
  await c.screenshot("/Users/ss/works/tmp/24071720-e2e回归/h4-add-reminder.png");

  // === H5. 点 ✏️ 编辑 reminder(本轮新加功能) ===
  console.log("\n=== H5. 编辑 reminder(本轮新加) ===");
  // 找 ✏️ 按钮
  const editBtnPos = await c.evaluate(`(function() {
    const btns = Array.from(document.querySelectorAll(".tab-reminders button"));
    const editBtn = btns.find(b => /✏️|编辑/.test(b.title + b.textContent));
    if (!editBtn) return null;
    const r = editBtn.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
  let h5EditOpened = false;
  if (editBtnPos) {
    await c.humanClick(editBtnPos.x, editBtnPos.y);
    await sleep(400);
    h5EditOpened = await c.evaluate(`!!document.querySelector(".rem-add-form")`);
    if (h5EditOpened) {
      // 改 title:清空 + 输入新值
      const titlePos = await c.centerOf(".rem-add-form input[type=text]");
      if (titlePos) {
        await c.humanClick(titlePos.x, titlePos.y);
        await sleep(200);
        // 全选 + 删除
        await c.humanKey("a", "KeyA", 65, { modifiers: 4 }); // Meta+A
        await sleep(100);
        await c.humanKey("Backspace", "Backspace", 8);
        await sleep(200);
        await c.humanType("EDITED-Reminder");
        await sleep(200);
      }
      const savePos = await c.centerOf(".rem-save");
      if (savePos) {
        await c.humanClick(savePos.x, savePos.y);
        await sleep(500);
      }
    }
  }
  const h5Title = await c.evaluate(`(function() {
    return Array.from(document.querySelectorAll(".rem-title")).map(t => t.textContent);
  })()`);
  record("H5-编辑", "✏️ 按钮 + 改 title + 保存", h5Title.some(t => /EDITED-Reminder/.test(t || "")), JSON.stringify(h5Title));
  await c.screenshot("/Users/ss/works/tmp/24071720-e2e回归/h5-edit-reminder.png");

  // === H6. centerNode 居中跳转验证 ===
  console.log("\n=== H6. centerNode 居中跳转 ===");
  // 先切换到面板 tab,让画布可见
  const propsTabPos = await c.evaluate(`(function() {
    const tabs = Array.from(document.querySelectorAll(".sidebar-tab"));
    const t = tabs.find(t => /面板/.test(t.textContent || ""));
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
  if (propsTabPos) {
    await c.humanClick(propsTabPos.x, propsTabPos.y);
    await sleep(300);
  }
  // 调用 __centerNode(根节点 id)
  const rootId = await c.evaluate(`window.__store?.getState?.().content?.root?.id`);
  const h6Before = await c.evaluate(`(function() {
    const inner = document.querySelector(".mind-elixir-inner");
    const root = document.querySelector("me-root");
    if (!inner || !root) return null;
    const ir = inner.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return {
      innerCx: ir.x + ir.width/2, innerCy: ir.y + ir.height/2,
      rootCx: rr.x + rr.width/2, rootCy: rr.y + rr.height/2,
    };
  })()`);
  // 故意把节点拖到角落(改 transform)模拟"节点不在中心"
  await c.evaluate(`(function() {
    const mc = document.querySelector(".map-canvas");
    if (mc) mc.style.transform = "translate3d(-500px, -300px, 0) scale(1)";
  })()`);
  await sleep(300);
  // 调用 __centerNode
  const h6Centered = await c.evaluate(`window.__centerNode(${JSON.stringify(rootId)})`);
  await sleep(500);
  const h6After = await c.evaluate(`(function() {
    const inner = document.querySelector(".mind-elixir-inner");
    const root = document.querySelector("me-root");
    if (!inner || !root) return null;
    const ir = inner.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const dx = Math.abs((ir.x + ir.width/2) - (rr.x + rr.width/2));
    const dy = Math.abs((ir.y + ir.height/2) - (rr.y + rr.height/2));
    return { dx: Math.round(dx), dy: Math.round(dy), centered: dx <= 5 && dy <= 5 };
  })()`);
  record("H6-居中", "centerNode 把根节点居中", h6After?.centered === true, `dx=${h6After?.dx}, dy=${h6After?.dy}`);
  await c.screenshot("/Users/ss/works/tmp/24071720-e2e回归/h6-centered.png");

  // === H7. 优先级 P0 按钮(真实点击) ===
  console.log("\n=== H7. 优先级 P0 视觉标记 ===");
  // 选中根节点
  const rootPos2 = await c.centerOf("me-tpc");
  if (rootPos2) {
    await c.humanClick(rootPos2.x, rootPos2.y);
    await sleep(400);
  }
  // 找 P0 按钮(在面板)
  const p0BtnPos = await c.evaluate(`(function() {
    const btns = Array.from(document.querySelectorAll("button"));
    const p0 = btns.find(b => b.textContent.trim() === "P0");
    if (!p0) return null;
    const r = p0.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
  if (p0BtnPos) {
    await c.humanClick(p0BtnPos.x, p0BtnPos.y);
    await sleep(500);
  }
  const h7HasP0 = await c.evaluate(`!!document.querySelector("me-tpc.priority-p0")`);
  record("H7-P0", "点击 P0 按钮,节点显示 priority-p0", h7HasP0);
  await c.screenshot("/Users/ss/works/tmp/24071720-e2e回归/h7-priority.png");

  // === H8. Toast 点击跳转(完整人类模拟:真实 emit event → 真实鼠标点 Toast)===
  console.log("\n=== H8. Toast 点击跳转(完整链路) ===");
  // 先把节点拖到角落,确保跳转有视觉变化
  await c.evaluate(`(function() {
    const mc = document.querySelector(".map-canvas");
    if (mc) mc.style.transform = "translate3d(-300px, -200px, 0) scale(1)";
  })()`);
  await sleep(300);
  const h8Before = await c.evaluate(`(function() {
    const inner = document.querySelector(".mind-elixir-inner");
    const root = document.querySelector("me-root");
    if (!inner || !root) return null;
    const ir = inner.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return {
      dx: Math.round(Math.abs((ir.x + ir.width/2) - (rr.x + rr.width/2))),
      dy: Math.round(Math.abs((ir.y + ir.height/2) - (rr.y + rr.height/2))),
    };
  })()`);
  console.log("  [debug] H8 跳转前 dx/dy:", JSON.stringify(h8Before));

  // 真实 emit "reminder-triggered" event(走完整 Tauri event 链路)
  // ReminderToast 的 listen("reminder-triggered", handler) 应该收到
  await c.evaluate(`(function() {
    const reminder = {
      id: "h8-test", node_id: ${JSON.stringify(rootId)},
      source_file: window.__store?.getState?.().filePath || "",
      title: "H8-Toast测试", message: "请点击跳转",
      trigger_at: "2099-01-01T00:00:00",
      repeat_rule: null, priority: null, enabled: true, status: "pending",
      last_triggered_at: null, snoozed_until: null, next_trigger_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    window.__mockEmitTauriEvent("reminder-triggered", reminder);
  })()`);
  await sleep(500);

  // 验证 Toast 真的显示了
  const h8ToastVisible = await c.evaluate(`!!document.querySelector(".reminder-toast")`);
  console.log("  [debug] Toast 显示:", h8ToastVisible);
  if (!h8ToastVisible) {
    // 调试:看 listeners
    const debugListeners = await c.evaluate(`JSON.stringify(Object.keys(window.__TAURI_EVENT_LISTENERS__ || {}))`);
    console.log("  [debug] 已注册 listeners:", debugListeners);
  }

  // 真实鼠标点击 Toast(非 JS click,触发 React onClick)
  let h8Clicked = false;
  if (h8ToastVisible) {
    const toastPos = await c.evaluate(`(function() {
      const t = document.querySelector(".reminder-toast");
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    })()`);
    if (toastPos) {
      console.log("  [debug] Toast 位置:", JSON.stringify(toastPos));
      await c.humanClick(toastPos.x, toastPos.y);
      await sleep(500);
      h8Clicked = true;
    }
  }

  // 验证节点居中
  const h8After = await c.evaluate(`(function() {
    const inner = document.querySelector(".mind-elixir-inner");
    const root = document.querySelector("me-root");
    if (!inner || !root) return null;
    const ir = inner.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return {
      dx: Math.round(Math.abs((ir.x + ir.width/2) - (rr.x + rr.width/2))),
      dy: Math.round(Math.abs((ir.y + ir.height/2) - (rr.y + rr.height/2))),
    };
  })()`);
  const h8Centered = h8After && h8After.dx <= 5 && h8After.dy <= 5;
  record("H8-Toast显示", "emit event 后 Toast 渲染", h8ToastVisible);
  record("H8-Toast点击", "真实鼠标点击 Toast", h8Clicked);
  record("H8-节点居中", "Toast 点击触发 __centerNode 居中", h8Centered === true, `跳转前 dx=${h8Before?.dx}/dy=${h8Before?.dy}, 跳转后 dx=${h8After?.dx}/dy=${h8After?.dy}`);
  await c.screenshot("/Users/ss/works/tmp/24071720-e2e回归/h8-toast-jump.png");

  // === 汇总 ===
  console.log("\n=== 汇总 ===");
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`✓ 通过: ${passed}  ✗ 失败: ${failed}  合计: ${results.length}`);
  if (failed > 0) {
    console.log("\n失败明细:");
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.id} ${r.name}: ${r.detail}`));
  }

  writeFileSync("/Users/ss/works/tmp/24071720-e2e回归/human-sim-result.json",
    JSON.stringify({ passed, failed, total: results.length, results }, null, 2));

  await c.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("HumanSim 失败:", e); process.exit(1); });
