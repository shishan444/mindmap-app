# mindmap-app 自动化验证规划

> 目标:整理已有功能需求 + 设计测试 + 自动化执行 + 报告,通过后用户人工确认

## Phase 1: 功能需求列表

### A. 思维导图核心(基础)

| ID | 功能 | 状态 |
|----|------|------|
| A01 | 新建文档(空白 mindmap) | 已实现 |
| A02 | 打开 .mmap 文件 | 已实现 |
| A03 | 保存 .mmap(原子写 + 备份) | 已实现 |
| A04 | 自动保存(2s 防抖) | 已实现 |
| A05 | 撤销/重做(Cmd+Z / Cmd+Shift+Z) | 已实现 |
| A06 | 节点添加(Tab=子 / Enter=兄) | 已实现 |
| A07 | 节点删除(Delete/Backspace) | 已实现 |
| A08 | 节点编辑(F2 / 双击) | 已实现 |
| A09 | 节点拖拽(改变父子关系) | 已实现 |
| A10 | 节点折叠(Cmd+.) | 已实现 |

### B. 视觉增强

| ID | 功能 | 状态 |
|----|------|------|
| B01 | 优先级 P0/P1/P2/P3(色边框 + 图标) | 已实现 |
| B02 | 自定义样式(字号/颜色/粗细/边框) | 已实现 |
| B03 | 类型图标(20+ lucide,4 类) | 已实现 |
| B04 | 附件类型色边框 + 扩展名角标(8 类型) | 已实现 |

### C. 提醒系统

| ID | 功能 | 状态 |
|----|------|------|
| C01 | 创建提醒(时间 + 重复) | 已实现 |
| C02 | 提醒触发系统通知 | 已实现 |
| C03 | 沙漏图标渲染(future/looming/due/done/paused) | 已实现 |
| C04 | 点击提醒跳转到节点 | 已实现 |

### D. 文件附加

| ID | 功能 | 状态 |
|----|------|------|
| D01 | 附加文件(8 类型:image/pdf/slide/doc/sheet/video/audio/other) | 已实现 |
| D02 | 替换附件 | 已实现 |
| D03 | 移除附件 | 已实现 |
| D04 | 在 Finder 中显示附件 | 已实现 |
| D05 | 用系统工具打开附件 | 已实现 |
| D06 | 节点固定 80×80 卡片形态 | 已实现 |

### E. 导入导出

| ID | 功能 | 状态 |
|----|------|------|
| E01 | 导出 Markdown | 已实现 |
| E02 | 导出 OPML | 已实现 |
| E03 | 导出 PNG / SVG | 已实现 |
| E04 | 导入 Markdown | 已实现 |
| E05 | 导入 OPML | 已实现 |
| E06 | 导入 Freemind | 已实现 |

### F. 多窗口(XMind 模式)

| ID | 功能 | 状态 |
|----|------|------|
| F01 | 新建窗口(独立文档) | 已实现 |
| F02 | 在新窗口打开文件 | 已实现 |
| F03 | 子窗口关闭按钮工作 | 已实现 |
| F04 | 托盘菜单(显示/隐藏/新建/退出) | 已实现 |

### G. MCP(LLM 协作,Phase 1-3)

| ID | 功能 | 状态 |
|----|------|------|
| G01 | MCP HTTP server(127.0.0.1:23456) | 已实现 |
| G02 | 6 个只读 tool(read/search/get/list_reminders/export/state) | 已实现 |
| G03 | acquire/heartbeat/release session | 已实现 |
| G04 | create/update/delete/move/attach_node | 已实现 |
| G05 | EditorMode Mutex(写者互斥) | 已实现 |
| G06 | TTL 自动释放(60s 默认) | 已实现 |
| G07 | 用户接管按钮(✋) | **待验证**(本次重点) |
| G08 | LlmSessionBanner(顶部提示 + 倒计时) | 已实现 |
| G09 | 画布锁定(llm-active class) | 已实现 |
| G10 | LlmOperationHistory(右下角操作历史) | 已实现 |
| G11 | 设置面板 MCP tab(开关/端口/TTL) | 已实现 |
| G12 | 3 个 Prompts(expand_topic/from_meeting/summarize) | 已实现 |
| G13 | undo 整合(zundo pause/resume) | 已实现 |
| G14 | 审计日志(llm-audit.jsonl) | 已实现 |
| G15 | read_mindmap path 参数(跨文档) | 已实现 |

**合计 ~50 个功能点**

---

## Phase 2: 测试规划

### 测试策略分层

| 层级 | 工具 | 覆盖范围 | 自动化 |
|------|------|---------|--------|
| **L1 单元测试** | vitest + cargo test | 函数级 correctness | ✅ 已有 529 个 |
| **L2 真实 MCP 链路** | curl + scripts/verify-mcp-live.sh | MCP 协议层 | ✅ 已有 |
| **L3 浏览器 UI** | chrome-devtools MCP + vite + Tauri mock | UI 渲染 + 交互 | ✅ 已有(本次重做) |
| **L4 Tauri 集成** | 启动 dev + curl 验证后端 | Rust + 前端协作 | ⚠️ 部分(create_node 写链路有问题) |

### 本次重点验证(基于用户反馈)

| # | 验证项 | 用户报告的问题 | 验证方法 |
|---|--------|--------------|---------|
| 1 | **接管按钮工作** | 点接管无法停止 LLM | 触发 session + 点接管 + 看 banner 是否消失 |
| 2 | **DevTools 能打开** | Cmd+Option+I 无反应 | 添加 open_devtools() 自动打开 |
| 3 | **LLM 写操作真生效** | create_node 后 store.content 不变 | 触发 create_node + read_mindmap 看节点是否增加 |
| 4 | **基础 UI 渲染** | (回归)Toolbar/Canvas/Sidebar 正常 | chrome-devtools 打开 + 截图 |

### 自动化测试矩阵

```
┌─────────────────────────────────────────────────────┐
│ Step 1: 单元测试(vitest + cargo)                    │
│   - 全量跑,确认 0 失败                              │
├─────────────────────────────────────────────────────┤
│ Step 2: 浏览器 UI(chrome-devtools + vite + mock)   │
│   - Toolbar / Sidebar / PreferencesModal 渲染       │
│   - Tab 切换 / 优先级设置 / 搜索 功能                │
│   - PreferencesModal MCP tab 内容                   │
├─────────────────────────────────────────────────────┤
│ Step 3: 真实 MCP 链路(curl + dev 模式)              │
│   - /health → ok                                   │
│   - tools/list → 14 tools                          │
│   - acquire → create_node → release                │
│   - search_nodes 验证 create_node 真生效            │
├─────────────────────────────────────────────────────┤
│ Step 4: LLM 接管验证(模拟用户接管)                  │
│   - acquire + create_node(不 release)              │
│   - invoke llm_force_release                       │
│   - get_edit_state 应为 human                       │
│   - 再次 create_node 应被拒绝                       │
├─────────────────────────────────────────────────────┤
│ Step 5: 报告 + 等待用户人工确认                     │
└─────────────────────────────────────────────────────┘
```

---

## Phase 3: 执行(逐步)

执行进度记录在 progress.md
