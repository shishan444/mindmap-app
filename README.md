# 思维导图桌面客户端 (mindmap-app)

Tauri 2 + React 19 + TypeScript + mind-elixir 构建的 macOS 桌面思维导图应用。

## 文档索引

| 文档 | 用途 |
|------|------|
| [docs/思维导图桌面客户端设计思路草稿.md](../docs/思维导图桌面客户端设计思路草稿.md) | 23 个设计决策落盘 |
| [tests/specs/requirements.md](tests/specs/requirements.md) | 70 个测试用例映射 |
| [docs/meta-rules.md](docs/meta-rules.md) | 11 条工程守则（反 Pattern + 合规做法） |
| [docs/debugging-notes.md](docs/debugging-notes.md) | 按 Phase 组织的踩坑知识库 |
| [docs/testing-methodology.md](docs/testing-methodology.md) | 测试金字塔 + 工具 + 模板 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 常见问题 + 解决方案 + 工具索引 |
| [task_plan.md](task_plan.md) | 18 个 Phase 的开发规划 |
| [findings.md](findings.md) | 研究发现 |
| [progress.md](progress.md) | 会话日志 |

## 开发命令

```bash
# 启动开发模式（前端 + Rust 编译 + 自动打开窗口）
npm run tauri dev

# 生产构建（打包 .app）
npm run tauri build

# 仅构建前端（验证 TypeScript）
npm run build
```

## 测试与质量

```bash
# 全量回归（前端单测 + Rust 单测/集成 + 类型 + 构建）
npm run test:all

# 单独跑某一层
npm run test:fe              # 前端单元测试（vitest）
npm run test:be              # Rust 单元 + 集成测试（cargo test）
npm run test:integration     # 仅 Rust 集成测试
npm run test:coverage        # 前端覆盖率报告

# 实时监听（开发时双 watch）
npm run test:watch:all       # 同时监听前端 + Rust（需先装 cargo-watch）

# 仅前端 watch
npm run test:watch
```

### 测试矩阵

| 层级 | 工具 | 用例数 | 位置 |
|------|------|--------|------|
| 前端单元 | vitest + @testing-library | 62 | `src/**/*.test.{ts,tsx}` |
| Rust 单元 | `cargo test` | 40 | `src-tauri/src/**/*.rs`（`#[cfg(test)] mod tests`） |
| Rust 集成 | `cargo test --test integration` | 14 | `src-tauri/tests/integration.rs` |
| **合计** | | **116** | |

集成测试通过 `MINDMAP_TEST_DATA_DIR` 环境变量重定向数据目录，**不会污染真实用户数据**。

## 自动化回归

### Git pre-commit hook

项目用 `.githooks/pre-commit` 实现"提交前必须跑通全量测试"。

**启用方式**：
- 如果项目已 `git init`，运行 `npm install` 时会自动配置 `core.hooksPath = .githooks`
- 手动启用：`git config --local core.hooksPath .githooks`
- 临时跳过：`git commit --no-verify`（不推荐）

**触发行为**：
- 跑 `npm run test:all`（前端测试 + Rust 测试 + 类型 + 构建）
- 全过才允许提交，否则阻止并打印失败原因

### 开发时实时反馈

`npm run test:watch:all` 用 concurrently 同时启动：
- vitest watch：保存 `src/**` 后立即重跑相关测试
- cargo watch：保存 `src-tauri/src/**` 后立即重跑 cargo test

前置：`cargo install cargo-watch`

## 项目结构

```
mindmap-app/
├── src/                       # React 前端
│   ├── components/            # UI 组件（含 .test.tsx）
│   ├── store.ts               # zustand 状态管理
│   ├── types.ts               # 类型定义（与 Rust 模型对应）
│   ├── App.tsx                # 主布局
│   └── test/                  # 测试 setup + helpers
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── lib.rs             # 入口 + Tauri builder
│   │   ├── models.rs          # 数据模型（serde）
│   │   ├── mmap.rs            # .mmap zip 读写
│   │   ├── config.rs          # 配置文件管理
│   │   ├── commands.rs        # Tauri commands
│   │   └── error.rs           # 错误类型
│   └── tests/
│       └── integration.rs     # 集成测试
├── tests/
│   └── specs/
│       └── requirements.md    # 需求→测试映射（70 用例）
├── task_plan.md               # 开发规划（Phases）
├── findings.md                # 研究发现
└── progress.md                # 会话日志
```

## IDE 推荐

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
