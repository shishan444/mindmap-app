# Findings: 思维导图桌面客户端 Phase 1 MVP

> 本文件用于存储研究发现、技术调研、API 用法、踩坑总结。所有外部抓取的内容都先存这里（不放 task_plan.md，避免注入风险）。

## 项目上下文

- **设计草稿**：`/Users/ss/works/git/aicode/demo/docs/思维导图桌面客户端设计思路草稿.md`
- **23 个决策**已全部落盘，是后续实现的 single source of truth
- **范围**：仅本次 Phase 1 MVP（基础节点编辑 + 文件 I/O + 托盘 + PNG 导出）

## 环境基线（2026-07-15 检查）

| 工具 | 版本 | 状态 |
|------|------|------|
| Node | v24.16.0 | ✅ |
| npm | 11.17.0 | ✅ |
| Rust | - | ❌ 未装 |
| Cargo | - | ❌ 未装 |
| Tauri CLI | - | ❌ 未装 |
| pnpm | - | ❌ 未装（用 npm 即可） |

## 技术调研

### Tauri 2.x 关键变化（待验证）

- Tauri 2.x 的 tray API 与 1.x 不同，使用 `tauri::tray::TrayIconBuilder`
- macOS 路径 API：使用 `dirs::data_dir()` 获取 `~/Library/Application Support/`
- Tauri 2.x 推荐用 `Manager::path()` 而不是直接调 `dirs` crate

### mind-elixir 关键 API（待 Phase 2 验证）

- `MindElixir.init(options)`：初始化实例
- `me.addNode(parentNode, nodeData)`：添加节点
- `me.removeNode(nodeId)`：删除节点
- `me.exportSvg()` / 等：导出（PNG 需要外部库把 SVG 转 PNG，比如 html2canvas）
- 数据格式：`{ nodeData: { ... }, ... }`，需要适配我们的 content.json 结构

### 数据模型决策回顾（来自草稿）

```
.mmap (zip)
├── meta.json      # format, app_version, timestamps
├── content.json   # 节点树 + canvas_state
└── assets/        # 图片（哈希命名，去重）

~/Library/Application Support/MindMap/
├── config.json        # 全局偏好
├── recent-files.json  # 最近打开
└── reminders.json     # 全局提醒索引（Phase 3 才用，但 Phase 1 创建空文件）
```

## 风险点

1. **Tauri 2.x tray API 变化**：1.x 的 `SystemTray` 在 2.x 改成了 `TrayIconBuilder`，需要查最新文档
2. **mind-elixir 数据结构适配**：mind-elixir 的内部格式与我们的 content.json 不一致，需要写适配层
3. **mind-elixir 导出 PNG**：mind-elixir 原生只导出 SVG/JSON，PNG 需要把 SVG 渲染成 PNG（前端 canvas 或后端 resvg）
4. **macOS notarization**：分发时需要，但 MVP 阶段先跳过

## 第三方依赖清单（Phase 2 安装）

### 前端（package.json）

- `@tauri-apps/api` - Tauri 前端 API
- `@tauri-apps/plugin-dialog` - 文件对话框
- `@tauri-apps/plugin-fs` - 文件系统
- `mind-elixir` - 思维导图渲染
- `react`、`react-dom` - UI 框架
- `zustand` - 状态管理
- `uuid` - 生成 UUID v4
- `typescript`、`@types/react`、`@types/react-dom`、`@types/uuid`
- `vite`、`@vitejs/plugin-react`

### 后端（Cargo.toml）

- `tauri` 2.x - 主框架
- `serde`、`serde_json` - JSON 序列化
- `zip` - .mmap 压缩
- `uuid` - UUID 生成
- `chrono` - 时间处理
- `dirs` - 跨平台系统目录
- `tauri-plugin-dialog` - 对话框插件
- `tauri-plugin-fs` - 文件系统插件
- `image` 或 `resvg` - SVG → PNG（如需在后端转）

## 参考资料

- Tauri 2.x 文档：https://v2.tauri.app/
- mind-elixir 仓库：https://github.com/ssshooter/mind-elixir
- 设计草稿：`docs/思维导图桌面客户端设计思路草稿.md`

## 后续填充

随 Phase 推进，每发现新东西就追加到这里。
