# 踩坑知识库（Debugging Notes）

> 按 Phase 时间顺序记录的具体 bug + 诊断 + 修复。每条都附根因 + 修复 commit + 检测方法。
> **新 bug 出现时先查这里**——可能已有现成方案。

---

## 目录

- [Phase 1：环境搭建](#phase-1环境搭建)
- [Phase 2：脚手架](#phase-2脚手架)
- [Phase 9：测试基础设施](#phase-9测试基础设施)
- [Phase 12：开发模式日志](#phase-12开发模式日志)
- [Phase 13：Vec 字段 skip_serializing](#phase-13vec-字段-skip_serializing)
- [Phase 14：mind-elixir 5.14 Nt noop](#phase-14mind-elixir-514-nt-noop)
- [Phase 15：根节点偏下 + 图标大小](#phase-15根节点偏下--图标大小)
- [Phase 16：端口占用启动失败](#phase-16端口占用启动失败)
- [Phase 17：mind-elixir CSS 缺失](#phase-17mind-elixir-css-缺失)
- [Phase 18：Tab 自动进入编辑](#phase-18tab-自动进入编辑)
- [通用检测方法](#通用检测方法)

---

## Phase 1：环境搭建

### Bug：Homebrew rustup 不创建 `~/.cargo/bin/` shim

**现象**：`brew install rustup` 后 `cargo` / `rustc` 命令找不到。

**诊断**：Homebrew rustup formula 跳过了 init 步骤，未创建标准 shim 目录。

**修复**：
```bash
mkdir -p ~/.cargo/bin
for tool in cargo rustc rustup rustdoc rustfmt cargo-clippy; do
  ln -sf "/opt/homebrew/opt/rustup/bin/$tool" "$HOME/.cargo/bin/$tool"
done
```

**用 `/opt/homebrew/opt/rustup/bin/`**（稳定路径，brew upgrade 后仍可用），不用 `/opt/homebrew/Cellar/rustup/1.29.0_2/bin/`（含版本号）。

### Bug：Bash 工具 cargo 找不到

**现象**：`source ~/.zshrc` 后 `cargo` 可用，但 Claude Code Bash 工具调 `cargo` 报 not found。

**诊断**：Bash 工具用 non-interactive zsh，不读 `~/.zshrc`（仅 interactive shell 读）。

**修复**：PATH 写入 `~/.zshenv`（所有 zsh 实例都读）：
```bash
# ~/.zshenv
export PATH="$HOME/.cargo/bin:$PATH"
```

调用前缀：`source ~/.zshenv && cargo xxx`（保险）。

### Bug：curl | sh 被安全护栏拦

**现象**：`curl https://sh.rustup.rs | sh` 被 Claude Code 安全护栏阻止。

**修复**：用 Homebrew 等价命令：`brew install rustup-init`。

---

## Phase 2：脚手架

### Bug：tauri dev 启动失败 "missing dependencies: Rust"

**现象**：`create-tauri-app` 创建项目后警告 missing Rust。

**诊断**：create-tauri-app 在子进程中检测 PATH，PATH 不含 cargo。

**修复**：警告可忽略（Rust 已装）。直接 `npm run tauri dev` 验证。

### Bug：npm 子进程 cargo 找不到

**现象**：`package.json` 的 `"test:be": "cd src-tauri && cargo test"` 报 cargo not found。

**诊断**：npm 子进程不继承用户 shell 的 PATH。

**修复**：脚本显式 export PATH：
```json
"test:be": "export PATH=\"$HOME/.cargo/bin:$PATH\" && cd src-tauri && cargo test"
```

### Bug：tsc 把测试文件也类型检查

**现象**：`tsc` 编译时把 `*.test.ts` 也检查，noUnusedLocals 触发错误。

**修复**：`tsconfig.json` 加 exclude：
```json
{
  "exclude": ["src/**/*.test.*", "src/test/**"]
}
```

---

## Phase 9：测试基础设施

### Bug：setState({...}, true) 清空 actions

**现象**：`useMindMapStore.setState({...}, true)` 后 `toggleSidebar is not a function`。

**诊断**：第二参数 `true` 是 replace 模式，覆盖整个 state（含 actions）。

**修复**：去掉 `true`，用合并模式：
```typescript
// ❌ 错误
useMindMapStore.setState({ ...initialState }, true);

// ✅ 正确
useMindMapStore.setState({ ...initialState });
```

### Bug：集成测试污染真实用户数据

**现象**：集成测试写到 `~/Library/Application Support/MindMap/`，污染用户真实配置。

**修复**：
- Rust config.rs 加 `MINDMAP_TEST_DATA_DIR` 环境变量支持
- 测试用 `Mutex` 串行运行（避免 env var 冲突）
- 测试目录 `drop` 时自动清理

```rust
struct TestDir { path: PathBuf, _guard: MutexGuard<'static, ()> }
impl Drop for TestDir {
    fn drop(&mut self) {
        std::env::remove_var("MINDMAP_TEST_DATA_DIR");
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
```

### Bug：zundo temporal API 名字

**现象**：`temporal.revert()` 报 not a function。

**诊断**：zundo 2.3 用 `redo()` 不用 `revert()`（v1 用 revert，deprecated）。

**修复**：用 `temporal.redo()`。

---

## Phase 12：开发模式日志

### Bug：useFakeTimers + setTimeout 不触发

**现象**：测试用 `vi.useFakeTimers()` + `vi.advanceTimersByTime()`，但 invoke 没被调用。

**诊断**：subscribe 在 useEffect mount 时注册，测试 setState 在 subscribe 注册前，错过了 trigger。

**修复**：useEffect 首次跑时也调 scheduleSave（处理 hook 挂载时已 dirty 的情况）。

---

## Phase 13：Vec 字段 skip_serializing

### Bug：启动崩溃 "Cannot read properties of undefined (reading 'children')"

**现象**：日志显示 `TypeError: undefined is not an object (evaluating 'node.children')`，3 次会话全部 boot.failed。

**根因（关键）**：Rust `Node` struct 用 `#[serde(skip_serializing_if = "Vec::is_empty")]`：
```rust
#[serde(default, skip_serializing_if = "Vec::is_empty")]
pub children: Vec<Node>,
```
空 Vec 时 JSON 中**不含** children 字段。前端 TS 类型 `children: MindNode[]`（必填），运行时拿到 `undefined` → `countNodes` 崩溃 → set() 失败 → content 没写入 store → 所有按钮 disabled。

**诊断方法**：用户日志（开发模式 JSONL）直接给出 TypeError + 行号。

**修复**：
- 后端：去掉 `skip_serializing_if = "Vec::is_empty"`，Vec 总是序列化
- 前端：types.ts 的 Vec 字段标 optional + `countNodes` 等用 `?? []` 防御
- 测试：加 contract test（`node_always_serializes_vec_fields`）防回归

**反 Pattern 教训**：旧测试 `node_skip_serializing_if_none` **断言**了导致 bug 的行为（Vec 为空时不输出）。

---

## Phase 14：mind-elixir 5.14 Nt noop

### Bug：mind-elixir 节点点击/键盘全失效

**现象**：用户报告"画布完成后不能操作"。

**根因**：mind-elixir 5.14 dist 中 `Nt()` 返回 noop：
```javascript
function Nt(e) { return () => {}; }  // 空！
// init 内 disposable.push(Nt())  ← 鼠标事件 handler 没注册
```

加上 `ne(target)` 检查 `target.tagName === 'ME-TPC'`，但点击 span.text 子元素时 target=SPAN，selectNode 不触发。

**双重 bug**：原生 click 处理 + tab/enter keydown 全部失效。

**诊断方法**：读 `node_modules/mind-elixir/dist/MindElixir.js` 源码。

**修复**：
- CSS pointer-events 让 span.text 穿透到 me-tpc
- 自己绑 click/dblclick/keydown 作为 fallback（绕过 mind-elixir noop）

```typescript
inner.addEventListener('click', (e) => {
  const tpc = e.target.closest('me-tpc');
  if (tpc) mind.selectNode(tpc);
});
```

---

## Phase 15：根节点偏下 + 图标大小

### Bug：根节点位置偏下，画布上半空白过大

**现象**：视觉模型分析截图发现根节点偏下。

**诊断**：mind-elixir `toCenter` 计算偏差 + `mind.move` 是 noop（5.14 API bug）。

**修复**：直接操作 mapCanvas.style.transform：
```typescript
const t = mapCanvas.style.transform || "";
const m = t.match(/translate3d\(\s*([-\d.]+)px[\s,]+([-\d.]+)px/);
// 解析 + 加 dx/dy + 重组 transform
```

### Bug：mind-elixir 浮动 toolbar 图标大小不一

**修复**：构造时 `toolBar: false`（功能已由 fallback 覆盖）+ CSS display:none 防御。

---

## Phase 16：端口占用启动失败

### Bug：npm run tauri dev 报 "Port 1420 is already in use"

**现象**：用户跑命令失败。

**根因**：E2E 验证时后台启动的 vite 进程没清理。

**修复**：
- `scripts/precheck.sh`：检测 + kill 僵尸进程
- `package.json` 加 `predev` / `pretauri` 钩子

```bash
# scripts/precheck.sh
PID=$(lsof -ti:1420 -sTCP:LISTEN 2>/dev/null)
[ -n "$PID" ] && kill $PID
```

---

## Phase 17：mind-elixir CSS 缺失

### Bug：双击编辑框错位（在节点下方 175px）

**现象**：用户报告 + chrome-devtools 验证 input-box rect 与节点 rect 不一致。

**直接根因**：`#input-box` 的 position 是 static（应该 absolute），导致 left/top 失效。

**深层根因**：mind-elixir.css 完全没加载。

**最根因**：`import "mind-elixir/dist/MindElixir.css"` 失败——mind-elixir package.json 的 exports 字段没声明 `./dist/*.css`，vite 严格遵循 exports 报 500 错误。

**诊断方法**：
1. chrome-devtools 看 `Failed to load resource 500`
2. list_network_requests 找 reqid
3. curl URL 看具体错误（`Missing "./dist/MindElixir.css" specifier in "mind-elixir" package`）

**修复**：
- 删 tsx 内的 `import "mind-elixir/dist/MindElixir.css"`
- index.html 加 `<link rel="stylesheet" href="/node_modules/mind-elixir/dist/MindElixir.css">`

```html
<!-- 绕过 package.json exports 限制 -->
<link rel="stylesheet" href="/node_modules/mind-elixir/dist/MindElixir.css" />
```

---

## Phase 18：Tab 自动进入编辑

### Bug：用户报告"只能创建 3 级节点"、"节点无法编辑"、"无法继续创建子节点"

**现象**：3 个看似独立的 bug。

**根因（统一）**：mind-elixir addChild 默认调用 `editTopic(s.firstChild)` 自动进入编辑模式。用户不知道按 Enter 退出，后续 Tab/Enter 被 input-box 拦截（contenteditable 默认行为）。

**诊断关键**：
- `dispatchEvent` 模拟显示一切正常（contenteditable 默认行为被 preventDefault 拦截）
- 用 `take_snapshot` 看到 `uid=1_17 generic focusable focused value="New Node"`——焦点残留
- `document.activeElement.isContentEditable === true` 确认困在编辑

**修复**：
```typescript
// 传 node 参数跳过自动编辑
inst.addChild(selected, { topic: "New Node" });
```

addChild 内 `t || this.editTopic(...)` 中 `t` 是 node 参数，传了就跳过。

---

## 通用检测方法

### 1. 用 chrome-devtools MCP 完整诊断

```javascript
// 检查应用状态
evaluate_script(() => ({
  rootHTML: document.getElementById('root')?.innerHTML?.length,
  meTpc: document.querySelectorAll('me-tpc').length,
  activeElement: document.activeElement?.tagName,
  activeIsEditable: document.activeElement?.isContentEditable,
  inputBoxExists: !!document.querySelector('#input-box'),
}));
```

### 2. console 错误必查

```javascript
// chrome-devtools
list_console_messages({ types: ['error', 'warn'] })
```

### 3. 网络请求 500 必查

```bash
# 直接 curl 看错误响应
curl "http://localhost:1420/src/X.tsx?t=xxx" | head -10
```

### 4. 源码追踪

```bash
# 找具体函数实现
grep -n "functionName" node_modules/pkg/dist/*.js
sed -n 'START,ENDp' node_modules/pkg/dist/*.js
```

### 5. 视觉模型分析

```
analyze_image 截图 + prompt：
"从 UI/UX 角度分析这个应用：布局、视觉层次、对齐、明显 bug"
```

### 6. DOM 坐标验证

```javascript
const r = el.getBoundingClientRect();
return { x: r.x, y: r.y, w: r.width, h: r.height };
// 验证两个元素是否对齐：offset.dx < 30 && offset.dy < 30
```

---

## 维护

- 每次 commit 后更新对应 Phase 的踩坑记录
- 新 bug 出现时先 `grep` 此文档查关键词
- 修复完成后追加新条目（现象 + 根因 + 修复 + 检测方法）
