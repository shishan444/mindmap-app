# 故障排查指南（Troubleshooting）

> 常见问题 + 解决方案 + 工具命令索引。**遇到问题先查这里。**

---

## 启动问题

### `npm run tauri dev` 失败：Port 1420 is already in use

**原因**：之前的 vite 进程没清理。

**解决**：
```bash
# 自动（推荐）
npm run precheck

# 手动
lsof -ti:1420 -sTCP:LISTEN | xargs kill
```

**预防**：`predev` / `pretauri` 钩子已自动调用 precheck。

---

### `cargo: command not found`

**原因**：Rust 工具链不在 PATH。

**解决**：
```bash
# 临时
source ~/.zshenv && cargo xxx

# 永久（已配）
# ~/.zshenv: export PATH="$HOME/.cargo/bin:$PATH"
```

**验证**：
```bash
which cargo
cargo --version  # 应输出 cargo 1.97.0
```

---

### `tauri dev` 报 "missing dependencies: Rust"

**忽略**：create-tauri-app 的 PATH 检测问题，Rust 实际已装。直接跑 `npm run tauri dev` 验证。

---

### Rust 编译失败：`unresolved import`

**原因**：lib.rs 的模块没声明 `pub mod`。

**解决**：集成测试访问的模块必须 `pub`：
```rust
// src-tauri/src/lib.rs
pub mod commands;
pub mod config;
pub mod models;
pub mod mmap;
pub mod markdown;
pub mod opml;
pub mod dev_logger;
pub mod reminder_scheduler;
mod error;  // 仅内部用的可以 private
```

---

### tsc 报 `noUnusedLocals` 在测试文件

**原因**：tsconfig 把测试文件也类型检查。

**解决**：`tsconfig.json` 加 exclude：
```json
{
  "exclude": ["src/**/*.test.*", "src/test/**"]
}
```

---

## mind-elixir 问题

### 节点点击没反应

**原因**：mind-elixir 5.14 内部 `Nt()` 返回 noop，鼠标事件没注册。

**解决**：检查 fallback 事件监听（MindMapCanvas.tsx 的 useEffect 内）：
```typescript
inner.addEventListener('click', onFallbackClick);
inner.addEventListener('dblclick', onFallbackDblClick);
inner.addEventListener('keydown', onFallbackKey);
```

### 双击编辑框位置错位

**原因**：mind-elixir CSS 没加载（`#input-box` position 变 static）。

**解决**：检查 index.html 的 link：
```html
<link rel="stylesheet" href="/node_modules/mind-elixir/dist/MindElixir.css" />
```

### 浮动 toolbar 遮挡节点

**原因**：mind-elixir 内部 toolbar 重复创建 + CSS layout 异常。

**解决**：构造时 `toolBar: false`：
```typescript
new MindElixir({
  toolBar: false,
  ...
});
```

### 根节点位置偏下

**原因**：mind-elixir `toCenter` 计算偏差 + `mind.move` 是 noop。

**解决**：直接操作 mapCanvas transform（见 MindMapCanvas.tsx 的 `centerRoot` 实现）。

### Tab 加节点后用户被困

**原因**：mind-elixir addChild 默认自动进入编辑模式。

**解决**：传 node 参数跳过：
```typescript
inst.addChild(selected, { topic: "New Node" });
```

---

## Tauri 问题

### invoke 失败：`Cannot read properties of undefined (reading 'invoke')`

**原因**：不在 Tauri 环境（浏览器/测试）。

**解决**：
- 测试环境：mock `@tauri-apps/api/core`
- 浏览器调试：注入 `window.__TAURI_INTERNALS__`

### `plugin:dialog|open` 报错

**原因**：dialog 插件没注册或权限不够。

**解决**：
1. `Cargo.toml` 加 `tauri-plugin-dialog = "2"`
2. `lib.rs` 加 `.plugin(tauri_plugin_dialog::init())`
3. `capabilities/default.json` 加 `"dialog:default"`

### 托盘不显示

**原因**：tray-icon feature 没启用。

**解决**：`Cargo.toml`：
```toml
tauri = { version = "2", features = ["tray-icon", "image-png", "image-ico"] }
```

---

## 测试问题

### vitest 测试间状态污染

**原因**：zustand store 是单例。

**解决**：每个 `beforeEach` 重置：
```typescript
beforeEach(() => {
  useMindMapStore.setState({ ...initialState });
  useMindMapStore.temporal.getState().clear();
});
```

### `setState({...}, true)` 后 actions 消失

**原因**：第二参数 `true` 是 replace 模式，覆盖整个 state。

**解决**：去掉 `true`，用合并模式。

### 集成测试污染真实 ~/Library/

**原因**：config.rs 用 `dirs::data_dir()` 获取真实路径。

**解决**：用 `MINDMAP_TEST_DATA_DIR` 环境变量重定向：
```rust
pub fn app_data_dir() -> Result<PathBuf> {
    if let Ok(test_dir) = std::env::var("MINDMAP_TEST_DATA_DIR") {
        return Ok(PathBuf::from(test_dir));
    }
    // ... 真实路径
}
```

### cargo test 并行失败

**原因**：env var 是全局的，并行测试互相覆盖。

**解决**：用 Mutex 串行：
```rust
static TEST_LOCK: Mutex<()> = Mutex::new(());

let _guard = TEST_LOCK.lock().unwrap();
// 测试代码
```

---

## 构建问题

### `tauri build` 失败：cargo metadata

**原因**：cargo 不在 PATH。

**解决**：
```bash
source ~/.zshenv && npm run tauri build
```

### 生产构建后 dev 模式日志还开

**原因**：dev 模式判断用 `import.meta.env.DEV`，生产应该是 false。

**解决**：检查 devLogger.ts 的 init：
```typescript
export async function initDevLogger() {
  enabled = import.meta.env.DEV;  // 生产自动 false
  if (!enabled) return;
  ...
}
```

### `.app` 启动崩溃

**诊断**：从命令行启动看错误：
```bash
./src-tauri/target/release/bundle/macos/mindmap-app.app/Contents/MacOS/mindmap-app
```

---

## Git / 部署问题

### pre-commit hook 阻止提交

**原因**：测试失败。

**解决**：
- **正确做法**：修复测试再提交
- **临时跳过**（紧急情况）：`git commit --no-verify`（不推荐）

### hooks 没生效

**原因**：core.hooksPath 没配。

**解决**：
```bash
git config --local core.hooksPath .githooks
chmod +x .githooks/*
```

或重跑 `npm install`（prepare 脚本会自动配）。

---

## 诊断工具索引

### 看日志（开发模式）

```bash
# 实时跟踪
tail -f ~/Library/Application\ Support/MindMap/logs/session-*.jsonl | jq .

# 只看 error
tail -f ... | jq 'select(.level=="error")'

# 统计用户操作
jq 'select(.cat=="user-action") | .op' session-*.jsonl | sort | uniq -c
```

### chrome-devtools 调试

```javascript
// 检查应用状态
evaluate_script(() => ({
  rootHTML: document.getElementById('root')?.innerHTML?.length,
  meTpc: document.querySelectorAll('me-tpc').length,
  activeElement: document.activeElement?.tagName,
  activeIsEditable: document.activeElement?.isContentEditable,
}));

// 看网络请求
list_network_requests({ pageSize: 50 });

// 看 console
list_console_messages({ types: ['error', 'warn'] });
```

### Rust 调试

```bash
# 跑特定测试
cargo test --lib models::tests::node_new_generates_uuid_v4_format

# 显示 println
cargo test -- --nocapture

# 单线程（env var 共享时）
cargo test -- --test-threads=1

# 看 clippy 警告
cargo clippy --all-targets
```

### 文件位置

| 用途 | 路径 |
|------|------|
| 用户数据 | `~/Library/Application Support/MindMap/` |
| 配置 | `~/Library/Application Support/MindMap/config.json` |
| 最近文件 | `~/Library/Application Support/MindMap/recent-files.json` |
| 提醒 | `~/Library/Application Support/MindMap/reminders.json` |
| 开发日志 | `~/Library/Application Support/MindMap/logs/session-*.jsonl` |
| .mmap 备份 | 同目录下的 `*.backup.mmap` |
| 应用打包 | `src-tauri/target/release/bundle/macos/mindmap-app.app` |
| DMG | `src-tauri/target/release/bundle/dmg/*.dmg` |

---

## 紧急回滚

```bash
# 看历史
git log --oneline

# 回到某个 commit（保留更改）
git reset --soft <hash>

# 完全回到某个 commit（丢弃更改）
git reset --hard <hash>

# 单文件回滚
git checkout <hash> -- path/to/file
```

---

## 求助

如果此文档没覆盖你的问题：
1. 查 `docs/debugging-notes.md`（按 Phase 组织的具体 bug）
2. 查 `docs/meta-rules.md`（11 条工程守则，看你违反了哪条）
3. 查 `docs/testing-methodology.md`（测试方法学）
4. 看 git log + commit message（每个修复都说了根因）
