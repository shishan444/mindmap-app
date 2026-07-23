# 🧠 MindMap

> 一个为知识工作者打造的 macOS 桌面思维导图应用 —— 把节点、附件、提醒、优先级统一在一个画布里。

<p align="center">
  <strong>Tauri 2 · React 19 · TypeScript · mind-elixir · Rust</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-lightgrey.svg">
  <img alt="Tauri: 2.x" src="https://img.shields.io/badge/Tauri-2.x-orange.svg">
  <img alt="React: 19" src="https://img.shields.io/badge/React-19-61dafb.svg">
  <img alt="Tests: 254 passing" src="https://img.shields.io/badge/tests-254%20passing-brightgreen.svg">
</p>

---

## ✨ 特性

### 🎨 画布与节点
- **键盘优先操作**:`Tab` 加子节点 · `Enter` 加兄弟节点 · `F2` 编辑 · `Delete` 删除 · `Cmd+.` 折叠
- **拖拽重排**:层级拖拽(吸附式 `before/after/in`)
- **节点样式**:字号、文字色、背景色、粗体/下划线、边框、自定义宽度
- **节点图标**:Lucide 矢量图标库,按"任务进度/级别/类型/状态"4 大类分组

### 🏷️ 优先级系统
- **P0/P1/P2/P3 四级** —— 梯度加粗边框 + P0 红色发光,差异一眼可辨
- 与画布左侧图标联动(`🔥 ⚡ ● ○`)

### 📎 附件(Package 目录机制)
- **8 种文件类型识别**:图片 / PDF / 演示 / 文档 / 表格 / 视频 / 音频 / 其他
- **类型色编码**:每种类型一种色相(图片绿 / PDF 红 / 视频紫 …)+ 扩展名角标兜底
- **真实缩略图**:macOS Quick Look 自动生成
- **`.mmap` 包格式**:每个文档是独立目录,附件、缩略图、内容 JSON 内聚
- 双击附件节点 → 系统默认工具打开

### ⏰ 提醒系统
- 节点级提醒(单次 / 重复)
- **沙漏视觉标识**:未来(蓝)→ 临近(橙)→ 到期(红/闪烁)→ 已完成(灰)
- 系统通知 + 应用内 Toast,Toast 点击自动跳转到对应节点
- 后台调度器(30s 轮询),不阻塞 UI

### 🪟 多窗口模式(XMind 风格)
- **每个文档独立窗口** —— 同时打开多个思维导图,跨窗口拖拽不受影响
- 主窗口隐藏到托盘(应用常驻),子窗口关闭即销毁
- macOS 状态栏托盘:显示/隐藏/新建/退出

### 💾 数据可靠性
- **原子写入 + 单份备份**(`content.json` → `.bak`)
- **自动保存**(防抖 2 秒,可配置)
- **撤销/重做**(zundo,50 步历史)
- **保存竞争感知**:异步保存期间的新改动会被识别并重新调度(不会丢)

### 📤 导入导出
- Markdown / OPML 双向
- PNG(高清) / SVG(矢量)
- FreeMind 导入

### 🎨 主题与体验
- 明/暗/跟随系统
- 偏好设置:字体、字号、自动保存间隔、提醒铃声、PNG 倍率 ……
- 全局快捷键:`Cmd+Z` 撤销 · `Cmd+Shift+Z` 重做 · `Cmd+F` 搜索

---

## 🚀 快速开始

### 环境要求
- macOS 12+(目前仅支持 macOS,Windows/Linux 待社区贡献)
- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) stable
- [Tauri 2 前置依赖](https://v2.tauri.app/start/prerequisites/)

### 安装与运行

```bash
git clone https://github.com/shishan444/mindmap-app.git
cd mindmap-app
npm install
npm run tauri dev
```

`predev` 钩子会自动清理僵尸进程,避免端口占用。

### 打包

```bash
npm run tauri build    # 生成 .app + .dmg
```

产物在 `src-tauri/target/release/bundle/`。

---

## 🛠️ 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| **桌面壳** | [Tauri 2](https://v2.tauri.app/) | 跨平台 webview + Rust 后端 |
| **前端框架** | [React 19](https://react.dev/) + TypeScript | UI |
| **状态管理** | [Zustand](https://zustand.docs.pmnd.rs/) + [Zundo](https://github.com/charkour/zundo) | store + 撤销重做 |
| **画布** | [mind-elixir](https://github.com/ssshooter/mind-elixir) | 思维导图渲染 |
| **图标** | [lucide-react](https://lucide.dev/) | SVG 矢量图标 |
| **后端** | Rust + serde + chrono | 数据持久化、调度、附件 |
| **打包** | Tauri 2 bundle | .app / .dmg |

---

## 📁 项目结构

```
mindmap-app/
├── src/                       # React 前端
│   ├── components/            # UI 组件(Toolbar / Sidebar / MindMapCanvas / ...)
│   ├── hooks/                 # useAutoSave / usePngExport / useWindowState
│   ├── utils/                 # mindElixirAdapter / imageEmbed / devLogger
│   ├── store.ts               # zustand + zundo
│   ├── types.ts               # 与 Rust 模型对应的类型
│   └── App.tsx                # 主布局 + 文件操作
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── lib.rs             # 入口 + Tauri builder + 托盘
│   │   ├── models.rs          # 数据模型(serde)
│   │   ├── mmap.rs            # .mmap 包格式读写 + 原子写入 + 备份
│   │   ├── commands.rs        # Tauri commands
│   │   ├── markdown.rs        # Markdown 导入导出
│   │   ├── opml.rs            # OPML 导入导出
│   │   ├── freemind.rs        # FreeMind .mm 导入
│   │   ├── reminder_scheduler.rs  # 提醒调度器(后台线程)
│   │   ├── dev_logger.rs      # 开发模式 JSONL 日志
│   │   └── state.rs           # AppState(Mutex 共享状态)
│   └── tests/                 # 集成测试
├── scripts/precheck.sh        # 启动前清理僵尸进程
├── docs/                      # 设计文档
└── .githooks/                 # Git hooks(pre-commit 跑全量测试)
```

---

## 🧪 测试

| 层级 | 工具 | 规模 | 位置 |
|------|------|------|------|
| 前端单元 | Vitest + Testing Library | 254 tests | `src/**/*.test.{ts,tsx}` |
| Rust 单元 | `cargo test` | 100+ tests | `src-tauri/src/**/*.rs` 内 `#[cfg(test)]` |
| Rust 集成 | `cargo test --test '*'` | 全命令链路 | `src-tauri/tests/` |
| 类型检查 | `tsc --noEmit` | 全量 | — |

```bash
npm run test:all           # 全量回归(前端 + Rust + 类型 + 构建)
npm run test:fe            # 仅前端单元
npm run test:be            # 仅 Rust 单元 + 集成
npm run test:watch:all     # 双 watch 实时反馈(需 cargo install cargo-watch)
```

集成测试通过 `MINDMAP_TEST_DATA_DIR` 环境变量重定向数据目录,**不污染真实用户数据**。

---

## 🎯 设计理念

1. **数据可靠优先**:原子写入 + 备份 + 保存竞争感知。宁可慢一点,绝不丢用户工作。
2. **键盘优先**:思维导图的核心交互应该不看鼠标也能完成。
3. **本地优先**:所有数据在本地,无云端依赖,无账号要求。
4. **macOS 原生体验**:托盘 / 系统通知 / Quick Look / 原生对话框 / 多窗口。
5. **可逆操作**:几乎所有操作都能撤销(50 步历史)。

更多设计决策详见 [`docs/`](./docs/)。

---

## 🗺️ 路线图

- [x] 核心:节点编辑、拖拽、撤销重做、自动保存
- [x] 多窗口模式(XMind 风格)
- [x] 附件 + 8 种类型识别
- [x] 提醒系统 + 沙漏可视化
- [ [ ] ] 协作(本地网络共享画布)
- [ [ ] ] 跨平台(Windows / Linux)
- [ [ ] ] 插件系统(自定义节点类型)
- [ [ ] ] iOS / Android(基于 Tauri Mobile)

---

## 🤝 贡献

欢迎 issue、PR、设计建议。提交前请:

1. 跑 `npm run test:all` 确保全量通过
2. PR 标题用 [conventional commits](https://www.conventionalcommits.org/)(`feat: / fix: / chore: / docs:`)
3. 涉及 UI 改动的附上截图或录屏

---

## 📄 协议

[MIT](./LICENSE) © 2026 shishan444
