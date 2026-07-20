# Task Plan: 思维导图桌面客户端

## 目标

macOS 桌面思维导图应用，覆盖思维导图核心能力 + 文件互通 + 提醒 + 拖拽 + 样式 + 主题 + 日志。

## 技术栈

- **后端**：Rust + Tauri 2.x（macOS only）
- **前端**：React 19 + TypeScript + Vite
- **思维导图**：mind-elixir 5.14（含 fallback 事件系统）
- **状态**：zustand + zundo（撤销重做 + store→mind 反向同步）
- **测试**：vitest + cargo test + chrome-devtools E2E
- **日志**：JSONL 结构化

---

## 已完成（38 commits，371 测试）

### 核心功能

| 功能 | 状态 |
|------|------|
| 仿 XMind 二栏布局（工具栏 + Tab 侧边栏 + 状态栏 + 主画布） | ✅ |
| 节点编辑（Tab/Enter/F2/Delete + Cmd+.折叠 + Cmd+Shift+L 自动布局） | ✅ |
| 优先级 P0-P3 标记 | ✅ |
| 撤销重做（50 步 + store→mind 反向同步） | ✅ |
| 拖动改层级（吸附式 + ghost 预览 + elementFromPoint 修 WebKit） | ✅ |
| 右键上下文菜单（添加子/兄弟/编辑/删除） | ✅ |
| 双击编辑（click 计数兜底 dblclick WebKit 不触发） | ✅ |
| 全文搜索（Cmd+F + Enter 导航 + 结果计数） | ✅ |

### 文件操作

| 功能 | 状态 |
|------|------|
| .mmap 目录机制(Package 目录 + meta/content/assets/thumbnails + 原子写 + 单份备份) | ✅ |
| 新建/打开/保存/另存为 + 最近文件（含置顶） | ✅ |
| 自动保存（防抖 2s） | ✅ |
| 启动恢复上次状态（窗口位置/大小/侧栏 tab） | ✅ |
| 单例检测（重复打开激活已有窗口） | ✅ |
| 附加文件(7 类型:图片/PDF/PPT/Word/Excel/视频/音频) | ✅ |
| 缩略图差异化(图片/PDF/Office 用 qlmanage;视频/音频用图标) | ✅ |
| 双击节点调用系统工具打开附件 | ✅ |
| 右键附件菜单(打开/Finder 显示/替换/移除) | ✅ |
| 不向后兼容旧 .mmap 单文件(zip 格式) | ✅ |

### 导入导出

| 功能 | 状态 |
|------|------|
| PNG 导出（html-to-image 2x） | ✅ |
| SVG 矢量导出 | ✅ |
| Markdown 导入导出（17 Rust 测试） | ✅ |
| OPML 导入导出（16 Rust 测试） | ✅ |
| FreeMind .mm 导入（4 Rust 测试） | ✅ |

### 侧边栏

| 功能 | 状态 |
|------|------|
| 面板（优先级 + 图标，可操作） | ✅ |
| TabStyle 样式编辑（字号/颜色/粗体/下划线/边框/宽度） | ✅ |
| 大纲视图（单击跳转 + 双击编辑） | ✅ |
| 提醒 CRUD(增/查/**改**/删) + 重复规则 + 调度器 + Toast + 系统通知 | ✅ |
| Toast 点击真居中跳转(centerNode,误差 ≤5px) | ✅ |
| 沙漏状态标识（自定义 SVG 图形 + 状态色 + reduced-motion） | ✅ |
| Toast 点击跳转节点（同文件内） | ✅ |
| emoji 图标库（4 分类选择器） | ✅ |

### 系统能力

| 功能 | 状态 |
|------|------|
| macOS 托盘 + 关闭改隐藏 | ✅ |
| 偏好设置面板（通用/提醒/外观/导出） | ✅ |
| 明暗主题（CSS 变量覆盖） | ✅ |
| 开发模式 JSONL 操作日志 | ✅ |
| 启动预检自动清理僵尸进程 | ✅ |
| macOS 系统通知（tauri-plugin-notification + 偏好开关） | ✅ |

### 工程化

| 功能 | 状态 |
|------|------|
| 测试框架（vitest + cargo test + 集成测试 + pre-commit hook） | ✅ |
| 测试覆盖矩阵（tests/coverage.md） | ✅ |
| LLM 工程指引（docs/llm-guidelines.md，8 条守则） | ✅ |
| 踩坑经验（关键修复含 JSONL 日志定位） | ✅ |

---

## 未完成（需 fork mind-elixir 或大改动）

| 功能 | 原因 |
|------|------|
| 大型图虚拟滚动（1000+ 节点） | 需改 mind-elixir 渲染层 |
| 小地图 minimap | 需自己画 SVG 缩略图 |
| 节点关联线（非父子箭头） | mind-elixir createArrow 在 5.14 可能不工作 |

---

## 关键踩坑

| 问题 | 根因 | 修复 |
|------|------|------|
| 启动崩溃 TypeError | Rust Vec skip_serializing_if | 去掉 skip_serializing_if |
| 节点完全不响应 | mind-elixir 5.14 Nt() noop | fallback 自己绑全部事件 |
| CSS 不加载 | package.json exports 限制 | index.html `<link>` 绕过 |
| Chromium 通过 WebKit 不工作 | 点击 target=me-parent（不是 me-tpc） | getMeTpc 向下找 + JSONL 日志 |
| addChild 后 Tab 失效 | blur input-box 焦点丢到 body | blur 后 focus map-container |
| 拖动子树脱离 | WebKit mouseup e.target 不对 | elementFromPoint 替代 |
| 撤销不生效 | store→mind 反向同步缺失 | needStoreToMindSync + mind.refresh |
| 切换节点后 priority 视觉标记丢失 | 1. store 扩展字段未同步到 mind nodeObj；2. mind-elixir selectNode 内部用 `className=` 直接覆盖（不是 classList.add），priority-p0 class 被 "selected" 替换掉 | 1. `updateSelectedNode` 调用 `syncToMindNodeObj` 把 priority/note/reminder_ids/style 同步到 nodeObj；2. MindMapCanvas 在 init 后 hook `mind.selectNode`，调用前快照 priority class，调用后恢复 |
| 删除提醒后依然会触发 | reminder_scheduler 与 commands::delete_reminder 各自走 `load → modify → save`,非原子。调度器 load V1(含 A)→ 用户删除 save V2(不含 A)→ 调度器 save 基于 V1 的修改版(含 A)→ **A 又被写回 reminders.json** | 引入 `AppState(Mutex<ReminderIndex>)` 作为单一数据源,所有读写通过 Mutex 串行化;启动时 load 一次到内存,save 命令/调度器都用 state.modify_reminders 闭包操作 |
| 删除后提醒仍触发 + 内容是 "a"(测试污染) | state::tests 通过 `std::env::set_var("MINDMAP_TEST_DATA_DIR", ...)` 隔离写盘路径,但 set_var 在多线程不安全 + `.cargo/config.toml [env]` 某些场景不生效,测试并发跑时 set_var 互相覆盖,save_reminders 写到真实 `~/Library/.../reminders.json`,污染 100+ 个 title="a" 的测试 reminder。**根因是测试代码与生产代码共享 save_reminders 路径,缺少依赖注入** | 1. AppState 改为依赖注入:`save_fn: Option<Box<...>>`,生产 `new()` 注入真实 save,测试 `new_in_memory()` 用 None 完全跳过写盘;2. 加 `in_memory_never_writes_to_disk` 测试守卫(检查文件系统不应有 reminders.json + 真实数据目录不应含测试标记字符串);3. 加 `concurrent_in_memory_states_are_isolated` 测试多 state 并发隔离;4. 移除 `.cargo/config.toml`(不再需要 RUST_TEST_THREADS=1) |

---

## 测试矩阵

```
✓ 前端单元（vitest）        238
✓ Rust 单元（cargo test）    100
✓ Rust 集成                  17
✓ TypeScript 类型检查       0 错误
✓ E2E 真实 CDP 事件 + Tauri mock 注入   56
✓ E2E 人类模拟(真实鼠标轨迹 + 逐字符按键)   8
─────────────────────────────────
✓ 合计                      419
```

### E2E 验证方式

- **CDP 协议直连**：Chrome headless + `--remote-debugging-port=9333`
- **Tauri mock**：通过 `Page.addScriptToEvaluateOnNewDocument` 在页面加载前注入 `window.__TAURI_INTERNALS__.invoke`，模拟 new_mmap / save_mmap / get_config 等 20+ 命令
- **真实事件**：`Input.dispatchKeyEvent` (rawKeyDown/keyUp) + `Input.dispatchMouseEvent` + `Input.insertText`
- **场景覆盖**：启动渲染 / Tab 多级创建 / F2 编辑 / 优先级 P0 视觉标记（CSS class + ::before SVG）/ 撤销重做 / Enter 兄弟节点 / Tab 切换 / 搜索 / 偏好设置（含 Esc 关闭）/ Delete 删除
- **样式验证**：`window.getComputedStyle(el, "::before")` 直接读取伪元素 border / left / width / background-image

### 人类模拟验证(human-sim.mjs)

- **真实鼠标轨迹**:`humanMove` 用 12 步 mouseMoved 线性插值 + 微抖动(±0.4px)模拟物理移动
- **真实按键**:`humanType` 逐字符 dispatchKeyEvent,带 `text` 字段产生真实字符(非一次性 insertText)
- **真实点击**:hover → mousePressed → mouseReleased,带随机延迟(100-300ms 反应时间)
- **截图验证**:每个场景后 `Page.captureScreenshot` 保存 PNG 到 `/Users/ss/works/tmp/24071720-e2e回归/`
- **覆盖**:H1 新建 / H2 Tab 创建 / H3 F2+逐字符输入 / H4 添加 reminder(真实点击+输入) / H5 ✏️ 编辑 reminder(本轮新加) / H6 centerNode 居中(误差 dx=0 dy=0) / H7 P0 优先级
