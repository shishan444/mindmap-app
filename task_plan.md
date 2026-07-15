# Task Plan: 思维导图桌面客户端 Phase 1 MVP

## Goal

交付一个**可运行**的 macOS 思维导图桌面客户端 MVP：能新建/打开/保存 `.mmap` 文件，支持基础节点编辑（创建/删除/拖拽/优先级 P0-P3）、自动保存（防抖 2 秒）、撤销重做、仿 XMind 二栏布局、托盘常驻、PNG 导出。

> 提醒系统、图片、图标、Markdown/OPML 导入导出、全局提醒面板 → Phase 2/3，不在本次范围。

## Current Phase

Phase 8（托盘 + 集成测试 + 打包）

## 项目位置

- 项目根：`/Users/ss/works/git/aicode/demo/mindmap-app/`
- 设计草稿：`/Users/ss/works/git/aicode/demo/docs/思维导图桌面客户端设计思路草稿.md`（23 个决策已落盘）

## 技术栈（已锁定，不可变）

- **后端**：Rust + Tauri 2.x
- **前端**：React 18 + TypeScript + Vite
- **思维导图渲染**：mind-elixir
- **状态管理**：zustand（轻量，免 Provider）
- **样式**：TailwindCSS（可选，先用 CSS Module 起步）
- **目标平台**：仅 macOS

## Phases

### Phase 1: 环境准备
- [x] 安装 Rust 工具链（Homebrew rustup formula + ~/.cargo/bin proxy symlinks）
- [x] 安装 Tauri CLI 2.11.4（npm 全局安装 @tauri-apps/cli，比 cargo install 快）
- [x] 验证 `rustc 1.97.0` 和 `tauri-cli 2.11.4`
- [x] PATH 配置持久化到 `~/.zshenv` + `~/.zshrc`
- **Status:** complete

### Phase 2: 项目脚手架
- [x] 用 `create-tauri-app` 创建 Tauri + React + TS 项目（mind-elixir 5.x + React 19 + Vite 7）
- [x] 安装 mind-elixir 5.14.0、zustand 5.0.14、uuid 14.0.1、@tauri-apps/plugin-dialog/fs
- [x] 配置 Cargo.toml（tauri tray-icon feature + zip/chrono/uuid/dirs/thiserror）
- [x] 配置 tauri.conf.json（1280x800 窗口、标题"思维导图"、identifier com.ss.mindmap）
- [x] cargo check 通过（54s）
- [x] npm run build 通过
- [x] tauri dev 启动成功（编译 18s 后窗口弹出）
- **Status:** complete

### Phase 3: 后端核心（Rust）
- [x] 定义数据模型（11 个 struct：Node/Content/Meta/Config/RecentFiles 等），完整 serde 标注
- [x] 实现 `.mmap` 读写（zip + json），预留 assets/ 目录与 add_asset API
- [x] 实现 config.json / recent-files.json 读写（原子写入 .tmp → rename）
- [x] 实现单份备份（`*.backup.mmap` 覆盖式）
- [x] 暴露 15 个 Tauri commands 给前端
- [x] 2 个单元测试通过（roundtrip_basic_mmap + asset_dedup）
- [ ] macOS 托盘（挪到 Phase 4 与 UI 一起做）
- **Status:** complete（核心完成，托盘随 Phase 4）

### Phase 4: 前端基础布局 + 文件操作
- [x] 顶部工具栏（新建/打开/保存/优先级下拉/导出 PNG）
- [x] 右侧 Tab 侧边栏（属性/提醒/样式/大纲 4 个 tab，可折叠）
- [x] 底部状态栏（节点数/保存状态/文件路径/提醒数）
- [x] mind-elixir 5.x 主画布集成（RIGHT 布局、可编辑、可拖拽、上下文菜单）
- [x] 仿 XMind 二栏布局 CSS
- [x] 配置加载 + 启动恢复 last_opened_file
- [x] 基础文件操作（新建/打开/保存 + 路径记忆 + 最近文件更新）
- [x] TypeScript 编译通过（50 模块）
- [x] tauri dev 启动成功（窗口弹出，数据目录创建）
- [ ] macOS 托盘（基础图标 + 显示/隐藏窗口）
- [ ] 用户验证 UI（等用户启动 tauri dev 后反馈）
- **Status:** in_progress（核心完成，等用户验证 + 托盘补完）

### Phase 5: 节点编辑能力
- [x] Tab 加子节点、Enter 加兄弟节点、Shift+Enter 上方加兄弟（mind-elixir 内置）
- [x] F2 / 双击编辑节点文字（mind-elixir 内置）
- [x] Delete 删除节点（mind-elixir 内置）
- [x] 拖拽改层级（mind-elixir 内置，自带视觉反馈）
- [x] 优先级 P0-P3 标记（store action + 工具栏 + TabProperties 显示）
- [x] 撤销/重做栈（zundo temporal middleware，limit 50，Cmd+Z/Shift+Z/Y）
- [x] mind-elixir → store 数据同步（保留 priority/note 等扩展字段）
- [x] 测试：20 个新增（store.test.ts Phase 5 用例）
- **Status:** complete

### Phase 6: 文件操作流程
- [x] 新建（默认名 `新建思维导图-NNN.mmap`，由 saveDialog 默认路径）
- [x] 打开（系统对话框，路径记忆 last_open_dir）
- [x] 保存 / 另存为（原子写入 + 备份）
- [x] 最近打开列表（最多 20，支持置顶 📌）
- [x] 自动保存（防抖 2 秒 + 状态栏指示）—— useAutoSave hook + 9 个测试
- [ ] 启动恢复 window_state（窗口位置/大小）—— 需 Tauri window API
- [ ] 同实例重复打开检测 → 激活已有窗口
- **Status:** 部分完成（核心完成，window 恢复与单例待 Phase 8）

### Phase 7: PNG 导出
- [x] html-to-image 渲染容器为 PNG
- [x] 默认 2x 分辨率（读 config.export.png_scale）
- [x] 导出对话框路径记忆（last_export_dir 自动更新）
- [x] 工具栏入口（PNG 按钮）
- [x] 后端 save_bytes command 写入文件
- [x] 测试：10 个 usePngExport 用例
- **Status:** complete

### Phase 8: 托盘 + 集成测试 + 打包
- [x] macOS 托盘：图标 + 菜单（显示/隐藏/新建/退出）+ 左键切换显隐
- [x] 窗口关闭按钮改为隐藏（托盘常驻策略）
- [x] tray-action 事件（前端可监听做"新建"等）
- [x] cargo check + tauri dev 启动验证通过
- [x] 端到端：新建 → 编辑 → 保存 → 重启恢复（通过 Rust 集成测试覆盖）
- [x] 验证 .mmap 结构（zip_structure 测试）
- [x] 验证配置文件正确（config_save_load_roundtrip 测试）
- [ ] cargo tauri build 打包 .app（待运行）
- **Status:** 核心完成，打包待用户决定

### Phase 9: 测试框架（自动化回归基础设施）
- [x] 9.1 需求→测试映射文档（`tests/specs/requirements.md`，70 用例：23 决策 + 23 后端 + 19 前端 + 5 E2E）
- [x] 9.2 Rust 单元测试扩展（models 14 + mmap 11 + config 8 + 其他 = 40 个，全过）
- [x] 9.3 Vitest 前端测试框架（vitest 4 + @testing-library/react + jsdom + 全局 Tauri mock）
- [x] 9.4 前端核心单元测试（store 14 + StatusBar 8 + Toolbar 7 + TabOutline 4 + TabProperties 9 + Sidebar 7 = 62 个，全过）
- [x] 9.5 Tauri command 集成测试（14 个端到端用例，用 MINDMAP_TEST_DATA_DIR 隔离）
- [x] 9.6 统一测试入口（`npm run test:all` + `test:regression` + `test:watch:all`）
- **Status:** complete

### Phase 10: 自动化回归（每次改动自动验证）
- [x] pre-commit hook（`.githooks/pre-commit`，npm prepare 自动注册 core.hooksPath）
- [x] 开发时文件监听（`test:watch:all` 用 concurrently 并行 vitest + cargo watch）
- [x] 文档：README 加测试章节、git 准备、工作流
- [ ] cargo-tarpaulin（Rust 覆盖率，后续）
- **Status:** complete（覆盖率报告留到后续）

## Key Questions

1. macOS minimum version target？ → 默认 10.15 (Catalina)，Tauri 默认值
2. mind-elixir 是否支持当前 React 18 + Vite 环境？ → Phase 2 验证
3. Tauri 2.x 的 tray API 与 1.x 不同，需要查文档确认
4. macOS Application Support 目录权限是否需要特殊配置？ → 标准 NSApplicationSupportDirectory

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| 仅 macOS | 用户决策 1：当前在 macOS，深度集成系统能力 |
| Tauri + React | 用户决策 5：包小性能好，复用 JS 思维导图生态 |
| 单文件 .mmap | 用户决策 3：一张图一个文件，可独立搬运 |
| P0-P3 四级优先级 | 用户决策 11：工程化语义清晰 |
| 不绑定优先级快捷键 | 用户决策 20：避免与 Cmd+1/2/3/4 窗口切换冲突 |
| 防抖 2 秒自动保存 | 用户决策 18：不打断思路 |
| 仅 1 份备份覆盖 | 用户决策 19：节省空间 |
| 恢复上次状态启动 | 用户决策 17：直接打开上次文件 |
| 托盘显示数字角标 | 用户决策 21：信息密度高 |
| 不做开机自启 | 用户决策 6：用户手动启动 |
| 不做快捷键自定义 | 用户决策 22：MVP 简化 |
| 数据模型 7 个默认 | UUID v4 / 哈希命名 / 双写提醒 / 样式继承 / ISO 8601 / 标准路径 |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Homebrew rustup 没创建 `~/.cargo/bin/` shim | 1 | 手动建立 symlinks 指向 `/opt/homebrew/opt/rustup/bin/`（稳定路径，brew upgrade 后仍可用） |
| `/opt/homebrew/bin/rustup` 是 wrapper script，symlink 到它无法触发 proxy dispatch | 2 | symlinks 改为指向 `/opt/homebrew/opt/rustup/bin/{cargo,rustc,...}` 直接 binary |
| Bash 工具 non-interactive zsh 不读 `~/.zshrc`，cargo not found | 3 | PATH 写入 `~/.zshenv`（zsh 所有模式都读）；Bash 调用时前缀 `source ~/.zshenv &&` |
| 安全护栏拦截 `curl \| sh` | 1 | 改用 `brew install rustup-init`（指向 rustup formula）|
| `setState({...}, true)` 第二参数 `true` 会覆盖 actions，导致 "toggleSidebar is not a function" | 1 | 去掉 `true`，用合并模式 `setState({...})`；actions 保留 |
| npm 子进程 `test:be` 找不到 cargo | 1 | package.json 显式 `export PATH="$HOME/.cargo/bin:$PATH"` |
| tsc 把测试文件也类型检查（noUnusedLocals 触发） | 1 | tsconfig.json 加 `exclude: ["src/**/*.test.*"]` |
| 集成测试污染真实 ~/Library/Application Support | 1 | config.rs 支持 `MINDMAP_TEST_DATA_DIR` 环境变量覆盖；集成测试用 Mutex 串行 |
| commands 测试不可见（模块是 `mod` 不是 `pub mod`） | 1 | lib.rs 所有模块改为 `pub mod` |
| **工具栏按钮点击无反应（Tauri macOS）** | 4 | 移除 `.toolbar { -webkit-app-region: drag }`——Tauri 2 macOS 下 no-drag 子元素可能失效，整个区域作为窗口拖动区吞掉 click |
| **画布不显示节点**：mind-elixir 5.x 给 el 注入 `style="position: relative"` 覆盖 CSS absolute，导致容器高度 0、init 时无法渲染 | 5 | wrapper 结构：`.mind-elixir-wrap`（absolute 撑满） > `.mind-elixir-inner`（mind-elixir 操作此层，inline style 不破坏外层布局） |
| **mind-elixir DOM 不渲染**：切换文档时 `containerRef.innerHTML = ""` 清空破坏 mind-elixir 内部节点引用 | 6 | 移除 innerHTML 清空——让 mind-elixir.init() 自己管理 DOM |
| React StrictMode 双调用 useEffect 与 mind-elixir destroy/init 冲突 | 7 | main.tsx 去掉 `<React.StrictMode>`（注释说明原因）|
| 浏览器环境 invoke 不可用，无法 E2E 测试 Tauri 链路 | 8 | chrome-devtools MCP 注入 `window.__TAURI_INTERNALS__.invoke` mock（initScript），完整模拟 Tauri 调用 |
| makeNode 用 `\|\|` 导致空字符串被替换为默认值 | 1 | 改用 `??`（仅 null/undefined 时才用默认）|

## Notes

- 严格按 Phase 顺序执行，每完成一个 Phase 更新 status 和 progress.md
- 遇到错误立即记录到上表，3 次失败升级到用户
- 每次重大决策前重读本文件
- 设计草稿在 `docs/思维导图桌面客户端设计思路草稿.md`，是决策来源的 single source of truth
