# 思维导图桌面客户端 (mindmap-app)

Tauri 2 + React 19 + TypeScript + mind-elixir 构建的 macOS 桌面思维导图应用。

## 文档

| 文档 | 用途 |
|------|------|
| [docs/llm-guidelines.md](docs/llm-guidelines.md) | **LLM 工程指引——任何任务开始前先读** |
| [task_plan.md](task_plan.md) | 18 个 Phase 的开发规划 + 错误日志 |
| [../docs/思维导图桌面客户端设计思路草稿.md](../docs/思维导图桌面客户端设计思路草稿.md) | 23 个设计决策（产品定义） |

具体 bug 修复案例：`git log` 查 commit message（每个含根因 + 修复 + 测试）。

## 常用命令

```bash
npm run tauri dev          # 启动开发模式（predev 自动清理僵尸进程）
npm run tauri build        # 打包 .app + .dmg
npm run test:all           # 全量回归（前端 + Rust + 类型 + 构建）
npm run test:fe            # 仅前端单元测试
npm run test:be            # 仅 Rust 单元 + 集成测试
npm run test:watch:all     # 双 watch 实时反馈（需 cargo install cargo-watch）
```

## 测试矩阵

| 层级 | 工具 | 位置 |
|------|------|------|
| 前端单元 | vitest + @testing-library | `src/**/*.test.{ts,tsx}` |
| Rust 单元 | `cargo test`（lib 内 `#[cfg(test)]`） | `src-tauri/src/**/*.rs` |
| Rust 集成 | `cargo test --test integration` | `src-tauri/tests/integration.rs` |
| E2E | chrome-devtools + mock invoke | 手动脚本（无固定文件） |

集成测试通过 `MINDMAP_TEST_DATA_DIR` 环境变量重定向数据目录，**不污染真实用户数据**。

## 项目结构

```
mindmap-app/
├── src/                       # React 前端
│   ├── components/            # UI 组件（含 .test.tsx）
│   ├── hooks/                 # useAutoSave / usePngExport / useWindowState
│   ├── utils/                 # mindElixirAdapter / imageEmbed / devLogger / nodeActions
│   ├── store.ts               # zustand + zundo（撤销重做）
│   ├── types.ts               # 与 Rust 模型对应的类型
│   └── App.tsx                # 主布局 + 文件操作 handler
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── lib.rs             # 入口 + Tauri builder + 托盘
│   │   ├── models.rs          # 数据模型（serde）
│   │   ├── mmap.rs            # .mmap zip 读写 + 原子写入 + 备份
│   │   ├── config.rs          # 配置 + 最近文件 + 提醒索引
│   │   ├── commands.rs        # Tauri commands
│   │   ├── markdown.rs        # Markdown 导入导出
│   │   ├── opml.rs            # OPML 导入导出
│   │   ├── dev_logger.rs      # 开发模式 JSONL 日志
│   │   └── reminder_scheduler.rs  # 提醒调度器
│   └── tests/integration.rs   # 集成测试
├── scripts/precheck.sh        # 启动前清理僵尸进程
├── .githooks/pre-commit       # 提交前跑 test:all
└── docs/llm-guidelines.md     # LLM 工程指引
```

## IDE 推荐

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
