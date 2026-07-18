# E2E 回归测试

> 通过 CDP (Chrome DevTools Protocol) 直连 Chrome headless,注入 Tauri mock,模拟真实人工操作。

## 运行方式

```bash
# 1. 启动 Vite dev server
npm run dev &

# 2. 启动带远程调试的 Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9333 \
  --user-data-dir=/tmp/chrome-debug-mindmap \
  --no-first-run --headless=new --disable-gpu \
  --window-size=1440,900 'http://localhost:1420/' &

# 3. 安装 ws 依赖（临时）
npm install --no-save ws

# 4. 运行回归脚本
node tests/e2e/cdp-regression.mjs
```

## 场景覆盖（32 项）

- **MOCK**: Tauri mock 注入成功
- **P0**: 点击新建按钮 + invoke("new_mmap")
- **A (6 项)**: 启动渲染验证（me-root / mind 实例 / 工具栏 / 侧边栏 / 搜索 / 状态栏）
- **B (3 项)**: Tab 多级创建（1/2/3 级）
- **C (2 项)**: F2 编辑 + Enter 保存
- **D (5 项)**: 优先级 P0 视觉标记（按钮 / CSS 类 / 全包围边框 / ::before 图标 / 清除）
- **E (2 项)**: 撤销/重做（Cmd+Z / Cmd+Shift+Z）
- **F (1 项)**: Enter 创建兄弟节点
- **G (4 项)**: Tab 切换（大纲/样式/提醒/面板）
- **H (1 项)**: 搜索框输入
- **J (2 项)**: 偏好设置（打开 / Esc 关闭）
- **K (1 项)**: store 状态可读
- **L (1 项)**: Delete 删除节点

## 关键技巧

### Tauri mock 注入

浏览器没有 Tauri IPC,所有 `invoke()` 调用会失败。通过 `Page.addScriptToEvaluateOnNewDocument` 在页面加载前注入 mock:

```js
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => { /* 根据 cmd 返回假数据 */ },
  transformCallback: (cb, once) => { /* ... */ },
};
```

### 真实键盘事件

`Input.dispatchKeyEvent` 类型必须是 `rawKeyDown`(而非 `keyDown`),否则部分组合键不触发。

### 焦点管理

`__mind.selectNode(tpc)` 只改变 mind-elixir 内部状态,不改变 DOM focus。Tab 键的 inCanvas 检查需要焦点在画布,所以需要主动 `mc.focus()`:

```js
const mc = document.querySelector(".map-container");
if (mc) mc.focus();
```

### 样式验证

CSS 类 + `::before` 伪元素验证,直接读取 computed style:

```js
const before = window.getComputedStyle(el, "::before");
const border = window.getComputedStyle(el).border;
```
