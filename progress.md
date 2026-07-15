# Progress Log: 思维导图桌面客户端 MVP

> 本文件是会话级日志，记录每个 Phase 的执行情况、遇到的问题、决策变更。

## Session 1 — 2026-07-15（启动）

### 设计阶段（已完成）

- 完成 6 轮设计讨论，23 个决策全部落盘
- 设计草稿：`../docs/思维导图桌面客户端设计思路草稿.md`，v8
- 创建 8 个 TaskCreate 任务（核心 Phase）+ 7 个测试任务

### Phase 1-4：环境 + 脚手架 + 后端 + 前端（完成）

- Rust 1.97 + Tauri 2.11 + React 19 + mind-elixir 5.14
- 11 个数据模型 + .mmap zip 读写 + 原子写入 + 备份
- 15 → 16 个 Tauri commands
- 仿 XMind 二栏 UI（工具栏 + Tab 侧边栏 + 状态栏 + 主画布）
- 基础文件操作（新建/打开/保存/最近/路径记忆）

### Phase 5-7：节点编辑 + 自动保存 + PNG 导出（完成）

- **Phase 5**: 优先级 P0-P3 + 撤销重做（zundo temporal middleware）+ mind-elixir 数据双向同步
- **Phase 6**: useAutoSave 防抖 2 秒，监听 store.subscribe
- **Phase 7**: html-to-image 渲染 → save_bytes 写文件 + 路径记忆

### Phase 8: 托盘 + 打包（核心完成）

- macOS 托盘：图标 + 菜单（显示/隐藏/新建/退出）+ 左键切换显隐
- 窗口关闭按钮改为隐藏（托盘常驻）
- cargo check + tauri dev 验证通过
- 打包 .app：待运行 `cargo tauri build`

### Phase 9-10: 测试基础设施 + 自动化回归（完成）

- 需求→测试映射：`tests/specs/requirements.md`（70 用例）
- Rust 单元测试：40 个（models + mmap + config）
- Rust 集成测试：14 个（commands 端到端，用 `MINDMAP_TEST_DATA_DIR` 隔离）
- 前端单元测试：101 个（store + 5 组件 + useAutoSave + usePngExport）
- pre-commit hook：`.githooks/pre-commit` + npm prepare 自动注册
- 开发 watch：`npm run test:watch:all`（concurrently 并行 vitest + cargo watch）
- README 完整测试章节

## 测试矩阵快照（2026-07-15）

| 层级 | 工具 | 用例数 | 状态 |
|------|------|--------|------|
| 前端单元 | vitest + @testing-library | 101 | ✅ 全过 |
| Rust 单元 | cargo test | 40 | ✅ 全过 |
| Rust 集成 | cargo test --test integration | 14 | ✅ 全过 |
| 类型 + 构建 | tsc + vite build | — | ✅ |
| **合计** | | **155** | **✅ 全过** |

## 关键踩坑

| 问题 | 解决 |
|------|------|
| Homebrew rustup 没创建 ~/.cargo/bin shim | 手动建立 symlinks 指向 `/opt/homebrew/opt/rustup/bin/` |
| Bash 工具 non-interactive zsh 不读 .zshrc | PATH 写入 `~/.zshenv`（zsh 所有模式都读） |
| 安全护栏拦 `curl \| sh` | 改用 `brew install rustup-init` |
| zundo v2.3 用 `redo()` 不是 `revert()` | 改 `temporal.redo()` |
| setState({...}, true) 覆盖 actions | 去掉 true，用合并模式 |
| npm 子进程找不到 cargo | package.json 显式 `export PATH="$HOME/.cargo/bin:$PATH"` |
| tsconfig 把测试文件也类型检查 | exclude `src/**/*.test.*` |
| 集成测试污染真实数据 | `MINDMAP_TEST_DATA_DIR` 环境变量覆盖路径 |
| Tauri 2 on_window_event 接收 `&Window` 非 `&WebviewWindow` | 修签名 |
| Tauri 2 tray 事件需要 `TrayIcon.app_handle()` 拿 AppHandle | 用 `tray.app_handle()` |
| Tauri 2 emit 需要 `use tauri::Emitter` | 加 import |

## 文件清单

| Path | Purpose |
|------|---------|
| `task_plan.md` | Phase 计划 + 决策表 + 错误日志 |
| `findings.md` | 研究发现 + API 笔记 |
| `progress.md` | 本文件 |
| `tests/specs/requirements.md` | 70 测试用例映射 |
| `../docs/思维导图桌面客户端设计思路草稿.md` | 23 个设计决策（v8） |
| `.githooks/pre-commit` | 提交前自动跑全量测试 |
| `README.md` | 项目说明 + 测试章节 |

## 下一步候选

1. `npm run tauri dev` —— 验证 UI + 托盘 + 优先级 + 撤销重做 + 自动保存 + PNG 导出
2. `npm run tauri build` —— 打包 .app（10-15 分钟）
3. Phase 11（未来）：图片嵌入、Markdown/OPML 导入导出、提醒系统、偏好设置面板
