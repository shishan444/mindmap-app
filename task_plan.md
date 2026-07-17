# Task Plan: 思维导图桌面客户端

## 目标

交付一个 macOS 桌面思维导图应用：仿 XMind 二栏布局 + 节点编辑 + 优先级 + 撤销重做 + 文件 I/O + 自动保存 + Markdown/OPML 互通 + PNG 导出 + 图片嵌入 + 偏好设置 + 提醒系统 + macOS 托盘 + 拖动改层级 + 右键菜单 + 开发模式日志。

## 技术栈（已锁定）

- **后端**：Rust + Tauri 2.x（macOS only）
- **前端**：React 19 + TypeScript + Vite
- **思维导图**：mind-elixir 5.14（含 fallback 事件）
- **状态**：zustand + zundo（撤销重做）
- **测试**：vitest + cargo test + chrome-devtools E2E
- **日志**：JSONL 结构化（~/Library/Application Support/MindMap/logs/）

## 项目位置

- 项目根：`/Users/ss/works/git/aicode/demo/mindmap-app/`
- 设计草稿：`../docs/思维导图桌面客户端设计思路草稿.md`（23 个决策）
- LLM 指引：`docs/llm-guidelines.md`（8 条守则）

---

## 已完成（32 commits，329 测试）

### Phase 1-8：MVP 核心

| Phase | 内容 | Status |
|-------|------|--------|
| 1 | 环境准备（Rust + Tauri CLI + PATH） | ✅ |
| 2 | 项目脚手架（Tauri + React + TS + mind-elixir） | ✅ |
| 3 | 后端核心（.mmap zip 读写 + 原子写入 + 备份 + 16 commands） | ✅ |
| 4 | 前端布局（仿 XMind 二栏 + 工具栏 + Tab 侧边栏 + 状态栏） | ✅ |
| 5 | 节点编辑（Tab/Enter/F2/Delete + P0-P3 优先级 + 撤销重做） | ✅ |
| 6 | 文件操作（新建/打开/保存/最近文件/自动保存防抖 2s） | ✅ |
| 6.5 | 启动状态恢复（窗口位置/大小/侧栏 tab） | ✅ |
| 7 | PNG 导出（html-to-image 2x） | ✅ |
| 8 | macOS 托盘 + 打包 .app + .dmg | ✅ |

### Phase 9-12：工程化

| Phase | 内容 | Status |
|-------|------|--------|
| 9 | 测试基础设施（vitest + cargo test + 集成测试 + pre-commit hook） | ✅ |
| 10 | 自动化回归（predev 预检 + watch + 覆盖率） | ✅ |
| 11.1-11.5 | 增强（Markdown/OPML 互通 + 偏好设置 + 图片嵌入 + 提醒 CRUD+调度器+Toast） | ✅ |
| 12 | 开发模式 JSONL 操作日志 | ✅ |

### Phase 13-27：Bug 修复 + 交互增强

| Phase | 内容 | Status |
|-------|------|--------|
| 13 | Vec 字段 skip_serializing 导致启动崩溃 | ✅ |
| 14 | mind-elixir 5.14 Nt noop → fallback 事件全绑 | ✅ |
| 15 | 根节点居中 + 图标统一 + 输入框宽度 | ✅ |
| 16 | 启动预检自动清理僵尸 vite | ✅ |
| 17 | mind-elixir CSS 未加载（package.json exports） | ✅ |
| 18 | Tab 自动进入编辑困用户 | ✅ |
| 19 | 节点 id 空字符串 + selectedNodeId 不同步 | ✅ |
| 20 | keydown 绑 document 修焦点丢失 | ✅ |
| 21 | click 计数兜底双击 + Tab 不跳侧边栏 | ✅ |
| 22 | addChild 后恢复焦点到 map-container | ✅ |
| 23 | me-parent 点击穿透（WebKit 差异，JSONL 日志定位） | ✅ |
| 24-25 | 节点拖动改层级（吸附式 + ghost 预览 + elementFromPoint） | ✅ |
| 26-27 | 右键上下文菜单（禁用内置双层） | ✅ |

---

## 剩余计划

### P1（已完成 ✅）

| 功能 | 状态 |
|------|------|
| ✅ 右键上下文菜单 | 添加子/兄弟/编辑/删除 + 禁用内置双层 |
| ✅ TabStyle 节点样式 | 字号/颜色/粗体/下划线/边框/宽度 |
| ✅ 图标库 | emoji 选择器（4 分类：常用/状态/优先级/事物） |
| ✅ 大纲视图编辑 | 单击跳转 + 双击编辑 |

### P2（已完成 ✅）

| 功能 | 状态 |
|------|------|
| ✅ 全文搜索 | Cmd+F 搜索 + Enter 导航 + 结果计数 |
| ✅ SVG 导出 | mind.exportSvg() → save_bytes |
| ✅ FreeMind .mm 导入 | XML 解析器 + 4 个测试 |
| ✅ 明暗主题 | CSS 变量覆盖（dark-theme class） |
| ✅ 节点折叠/展开 | Cmd+. 切换 |

### P3（部分完成）

| 功能 | 状态 |
|------|------|
| ✅ 单例检测 | tauri-plugin-single-instance |
| ✅ 自动布局 | Cmd+Shift+L → mind.layout() |
| ⏭️ 大型图虚拟滚动 | 跳过（需 fork mind-elixir 渲染层） |
| ⏭️ 小地图 | 跳过（需自己画 SVG 缩略图） |
| ⏭️ 节点关联线 | 跳过（mind-elixir createArrow 在 5.14 可能不工作） |

---

## 关键踩坑（精简版）

| 问题 | 根因 | 修复 |
|------|------|------|
| 启动崩溃 TypeError: undefined | Rust Vec skip_serializing_if 导致空时不序列化 | 去掉 skip_serializing_if |
| 节点完全不响应 | mind-elixir 5.14 Nt() 返回 noop（事件没绑） | fallback 自己绑 click/dblclick/keydown/drag |
| mind-elixir CSS 不加载 | package.json exports 限制 ./dist/*.css | index.html 用 `<link>` 绕过 |
| Chromium 测试通过 WebKit 不工作 | WebKit 下点击 target=me-parent（不是 me-tpc） | getMeTpc 支持向下找 + JSONL 日志验证 |
| addChild 后 Tab 失效 | blur input-box 焦点丢到 body | blur 后 focus map-container |
| 拖动子树脱离 | WebKit mouseup 的 e.target 不对 | document.elementFromPoint 替代 e.target |

---

## 测试矩阵

```
✓ 前端单元（vitest）        232
✓ Rust 单元（cargo test）    80
✓ Rust 集成                  17
✓ TypeScript build            ✅
─────────────────────────────────
✓ 合计                      329
```
