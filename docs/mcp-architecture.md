# MindMap MCP 架构设计

> **版本**:v2.0(实施完成后按现状重写)
> **状态**:已全部落地并通过测试与真实接入验证
> **配套**:[产品概览](./mcp-overview.md)(为什么做)/ [接入指南](./mcp-quickstart.md)(怎么用)/ 本文档(为什么这样实现)
> **本文的写法**:讲设计决策及其推导,不讲代码细节——参数定义连接后的 `tools/list` 即是活文档,实现直接读 `src-tauri/src/mcp/` 与 `src/mcp/` 源码。

## 修订记录

### v2.0(2026-09-02):按实施现状重写

- 状态从"待实施"更正为"已落地";删除全部"预计工作量"的规划语气
- 修正三处设计与实现的偏差:操作确认为**异步受理**而非同步 ack(§4.5);undo 整合由**会话事件驱动** pause/resume,无 wrap 写入(§4.4);跨文档 `path` 参数目前仅 `read_mindmap` 支持(§5)
- 删除与实现脱节的伪代码段与虚构的配置示例(MCP 设置面板实际只有启用开关),文件结构更新为实际目录(§12)
- Resources 修正为"机制就绪、暂无注册内容"(§5)

### v1.1(2026-07-23):代码层验证后修订

发现 v1.0 的前端集成设计有误(走 `store.updateContent` 是绕过 mind-elixir 的旁路),修订为调 mind-elixir 标准 API,确立单一数据源。

### v1.0(2026-07-22):初稿

## 一、背景与目标

MindMap-app 原本完全由人工操作。本设计引入 LLM 读写能力,实现人机协作:LLM 帮助生成、扩展、整理思维导图,人工审阅与微调。

核心约束只有一条:**同一时刻至多一个写者**。人是文档的主人,LLM 是受监督的协作者——由此推出全部架构。

设计目标与衡量标准:

| 目标 | 衡量标准 |
|------|---------|
| 人机协作 | LLM 能在人工打开的同一份导图上读写 |
| 互斥安全 | 任意时刻只有一个写者,不丢数据 |
| 实时可见 | LLM 的操作在画布上立刻显示 |
| 可中断 | 人工随时接管,LLM 不会锁死应用 |
| 零配置接入 | 主流 MCP 客户端直接挂载,无需额外部署 |

## 二、设计原则

五条原则,每条都是一次明确的取舍:

1. **内嵌,不做独立服务** — MCP server 与 Tauri app 同进程,共享事件总线与应用状态。app 没开就没有 MCP,这恰恰是对的特性:协作对象(画布)不存在,服务也不该存在。
2. **会话级互斥,不做操作级锁** — LLM 以"会话"为单位持锁。操作级锁会让 LLM 的多步操作与人的操作交错,中间状态互相污染,undo 历史混杂;会话级让"AI 的时间"和"我的时间"清晰分开。
3. **数据面复用,不新开通道** — LLM 的写操作必须穿过与人工编辑完全相同的管道。不为 AI 修的捷径,就是不为 AI 留的后门。
4. **沿用 mind-elixir 节点 id** — LLM 看到的 id 与画布一致,无双源生成冲突。
5. **HTTP,不做 stdio** — Tauri 不是 stdio 进程,transport 只能走 HTTP(loopback)。

## 三、总体架构

一句话:**LLM 伪装成一个特殊用户,走现有管道**。

```
┌────────────────────────────────────────────────────────────────┐
│                    Tauri App(单进程)                          │
│                                                                │
│  ┌──────────────────┐         ┌──────────────────────────┐    │
│  │   React 前端     │ ◄─────► │   Tauri Rust 后端         │    │
│  │  ┌────────────┐  │  events  │  ┌────────────────────┐  │    │
│  │  │ operation  │  │         │  │ EditorMode(写者锁) │  │    │
│  │  │ Bridge     │  │         │  │ SessionRegistry     │  │    │
│  │  └─────┬──────┘  │         │  └────────┬───────────┘  │    │
│  │        │调标准 API│                   │                │    │
│  │        ▼         │                   ▼                │    │
│  │  ┌────────────┐  │         ┌────────────────────┐      │    │
│  │  │ mind-elixir│  │         │ axum HTTP server   │      │    │
│  │  │ (canvas)   │  │         │ 127.0.0.1:23456    │      │    │
│  │  └─────┬──────┘  │         └────────┬───────────┘      │    │
│  │        │fire     │                  │                  │    │
│  │        │operation│                  │                  │    │
│  │        ▼         │                  │                  │    │
│  │  ┌────────────┐  │                  │                  │    │
│  │  │ 现有 sync   │◄─┼──── 人编辑也走这条 ────────────────┘    │
│  │  │ 链路(零修改)│  │                                            │
│  │  └─────┬──────┘  │                                            │
│  │        ▼         │                                            │
│  │  markDirty → useAutoSave → save_mmap(原子写)                 │
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP(loopback only)
                ┌─────────────┴─────────────┐
                │  外部 LLM 客户端           │
                │  Claude / Cursor 等        │
                └───────────────────────────┘
```

数据流的**关键决策**:operationBridge 不直接改 store,而是调用 mind-elixir 的标准 API(`addChild` / `reshapeNode` / `removeNodes` / `moveNodeIn`)。理由:

- mind-elixir 的每个 public API 内部都会 fire 标准 `"operation"` 事件,现有 `syncFromMindElixir` 链路自动接管——markDirty、setContent、附件同步、自动保存防抖、原子写,**全部零修改复用**;
- 若走 `store.updateContent` 旁路,画布 DOM 不会刷新,数据流立即分裂;
- 若走业务 action(如 `setPriorityForSelected`),绕一层间接调用毫无收益——业务 action 内部调的也是 mind-elixir API。

这就是"单一数据源"的工程含义:**所有为人工编辑建设的安全保障,LLM 自动享受**。可以在 DevTools 里直接验证:`window.__mind.addChild(window.__mind.currentNode)` 应看到新节点出现、dirty 置位、2 秒后自动保存。

## 四、核心机制

### 4.1 写者锁与双端防护

Rust 侧的 `EditorMode` 是全局唯一的事实来源,记录"当前谁在写"(Human 或某个 LLM session)。每个写操作在 emit 给前端之前,Rust 都强制校验 `require_llm_session(session_id)`——**持锁校验不依赖前端自觉**。

防护是双端的,各有分工:

| 层级 | 职责 | 为什么不能只有这一层 |
|------|------|---------------------|
| Rust(主) | emit 前强制校验持锁 | 不知道"人正在编辑",拦不住人的误操作 |
| 前端(辅) | 持锁时画布 `pointer-events: none` + 会话横幅 | 用户可能绕过 UI(DevTools),但体验层需要它 |

不变式:`Editor::Llm` 至多一个;只有持锁的 session 能释放;TTL 到期由后台 task 自动释放;用户的中断永远成功。

### 4.2 会话生命周期

```
                    ┌────────────────┐
       app 启动     │                │
        ────────►   │   Human 编辑    │ ◄─────── 用户点"接管"
                    │                │
                    └────┬───────────┘
                         │ LLM 调 acquire_session(TTL 默认 60s,上限 300s)
                         ▼
                    ┌────────────────┐
                    │  LLM 持锁中    │
                    │  (单 session)  │
                    └────┬───────────┘
                         │
              ┌──────────┼──────────────┐
       LLM 调        TTL 到期       用户点
    release_session  (失联自动释放)   "接管"
              └──────────┴──────────────┘
                         ▼
                    ┌──────────────┐
                    │  Human 编辑  │
                    └──────────────┘
```

三条归还路径(主动释放/超时/接管)保证锁**总会**回到人手里。其中两条值得展开:

**续约是双保险的。** 每次写操作自动刷新 TTL(连续干活永不掉锁),`heartbeat` 工具用于"长时间思考、暂不落笔"的显式续约。前者让正常流程零负担,后者兜住 LLM 推理慢的真实场景。

**接管是逃生舱。** 横幅上的"✋ 接管"按钮调用 `llm_force_release` Tauri command,无视 session 直接释放——设计上**任何时刻用户中断必然成功**,这是产品红线。接管后 LLM 的下一次写操作立即被 Rust 层拒绝,它必须重新申请。

### 4.3 前端桥接(operationBridge)

前端的 `src/mcp/operationBridge.ts` 订阅两类 Tauri 事件,职责干净分离:

- `llm-operation` — 按操作类型把指令转译为 mind-elixir API 调用(节点不存在等错误回传 Rust,再返给 LLM);
- `llm-session-changed` — 更新会话状态:持锁时锁画布、显横幅,释放时恢复。

它不持有任何业务判断——判断都在 Rust 层做完了,前端只是忠实的执行者。这保证了一个重要性质:**前端崩溃或重载,锁语义不受影响**(锁在 Rust 进程里)。

### 4.4 撤销语义

LLM 会话期间的操作不进入 undo 历史:会话开始(acquired)时 `temporal.pause()`,会话结束(released/expired/forced)时 `resume()`。zundo 没有 wrap API,无需伪造——pause 期间的操作天然不入史,用户按一次 Cmd+Z 撤到的正是**会话开始前的快照**。

净效果:整段 LLM 改动一步撤净;代价是中间状态不可逐步回看(如需审视过程,看操作历史侧栏与审计日志)。

### 4.5 操作受理模型

写 tool 的返回是**受理回执而非落盘确认**:Rust 完成持锁校验、自动续约、生成 `op_id`、emit 事件、写入审计日志后即返回 `queued: true`。事件由前端异步消费,画布刷新与保存发生在返回之后。

这是一个明确的取舍:同步等待前端 ack 会把 HTTP 请求生命周期与前端渲染耦合(前端卡顿即写工具超时),而受理模型下 LLM 拿着 `op_id` 可以继续操作,通过下一次读取观察到结果——MCP 客户端的使用模式(读-改-读)天然适配最终一致。

## 五、协议面

HTTP + JSON-RPC,自实现轻量协议层(协议本身简单,不必引入完整 SDK)。端点:`POST /mcp`(标准请求)、`POST /mcp/batch`(JSON-RPC 批量)、`GET /health`(健康检查)、`GET /mcp/sse`(占位,见后续演进)。

**工具(14 个)按语义分三组**:

- 只读 6 个——无需持锁:读树、搜索、节点详情、提醒列表、导出(markdown/opml/mermaid)、编辑状态查询。跨文档 `path` 参数目前仅 `read_mindmap` 支持;
- 会话 3 个——写操作的门:申请、心跳、释放;
- 写 5 个——须持有效 session:建、改、删、移、附文件。

**Prompts(3 个)**:expand_topic / from_meeting_notes / summarize_to_outline,引导 LLM 按正确流程协作(先读上下文、再拿锁、再动笔)。

**Resources 现状**:协议方法(`resources/list` / `resources/read`)已实现,但当前无注册内容,返回空。预留了能力,没有提前造没有需求的内容。

## 六、典型场景

**场景 A:LLM 扩展思维导图** — 用户在 agent 里说"把会议纪要扩展成思维导图"。LLM 先 `read_mindmap` 看上下文,`acquire_session` 报上名号与来意,横幅出现、画布锁定;随后一连串 `create_node`/`update_node` 逐个在画布上落地(每次自动续约);最后 `release_session`,横幅消失,画布回到人手里。用户审阅,不满意就一次 Cmd+Z 整段撤回。

**场景 B:LLM 失联** — LLM 拿锁后超过 TTL 无任何操作与心跳。Rust 后台 task(秒级检查)发现过期,自动释放并通知前端,横幅消失。用户无感知地恢复了编辑权;LLM 若恢复,写操作被拒,须重新申请。

**场景 C:用户中断** — LLM 正在建节点,用户看到方向不对,点横幅上的"接管"。锁立即释放,画布解锁;LLM 的下一个写操作在 Rust 层被拒。**人的判断永远优先于 AI 的计划。**

## 七、技术选型

| 决策点 | 选择 | 理由 | 备选与否决原因 |
|--------|------|------|---------------|
| transport | HTTP(loopback) | Tauri 非 stdio 进程 | stdio 需 sidecar,复杂 |
| HTTP server | axum | Tauri 生态亲和,tokio 原生 | actix-web 偏老 |
| 协议实现 | 自实现轻量 JSON-RPC | 协议简单,避免重型 SDK | rmcp crate 当时太早期 |
| 端口 | 23456 固定 | 便于客户端一次配置 | 随机端口不便于配置 |
| 写者锁 | `Arc<RwLock<Editor>>` | 读多写少 | parking_lot 快但加依赖 |
| 操作注入 | Tauri event | 复用现有事件机制,前端桥接简单 | 直接命令调用,前端无从感知 |

## 八、实施结果

三个阶段全部落地:

| 阶段 | 内容 | 结果 |
|------|------|------|
| Phase 1 只读 | 协议层、6 只读工具、状态镜像 | 已交付 |
| Phase 2 互斥写 | 写者锁、会话工具、5 写工具、operationBridge、横幅与画布锁定、TTL 自动释放、接管 | 已交付 |
| Phase 3 协作体验 | undo 整合、3 prompts、attach_file、操作历史、审计日志、设置面板 MCP 开关 | 已交付 |

验证手段:Rust 单元测试覆盖 MCP 全模块(含持锁校验、自动续约、force_release、undo 整合等关键不变式);`scripts/verify-mcp-live.sh` 对运行中的应用做真实接入验证(健康/清单/会话/写/心跳/释放/越权拦截八条链路);流程与特性覆盖率门禁见 `docs/mcp-flow-coverage.yaml` 与 `docs/mcp-feature-coverage.yaml`。

## 九、风险与缓解

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| LLM 失联持锁 | 高 | TTL 自动释放 + 接管按钮,双通道兜底 |
| 多 LLM 客户端冲突 | 中 | 单 session 模式,后到者拒绝 |
| LLM 误操作破坏数据 | 高 | 撤销整段撤回 + .bak 备份 + 审计日志留痕 |
| 端口被占用 | 低 | 启动失败有明确日志,健康检查可自检 |
| 多窗口锁归属 | 中 | 锁是 app 级,所有窗口共享同一 EditorMode |
| 跨设备操作 | 低 | 不支持(仅 loopback),演进方向见下 |

## 十、安全

- 只监听 `127.0.0.1`,不暴露局域网;
- 附件只暴露元信息,文件字节仍走 Tauri 既有权限通道;
- 每次 LLM 操作记入审计日志(`~/Library/Application Support/MindMap/llm-audit.jsonl`);
- Bearer token 预留为演进项,当前靠 loopback 隔离。

## 十一、后续演进

| 方向 | 触发条件 | 说明 |
|------|---------|------|
| SSE 流式推送 | 协作体验需要 | 端点已占位;推送中间状态与操作通知 |
| Resources 注册内容 | 出现订阅需求 | 协议已就绪,注册即可用 |
| 远程客户端 | 真实需求 | TLS + token,当前明确不支持 |
| 多 LLM 协同 | 高级用例 | session 队列与优先级 |

## 十二、代码地图

```
src-tauri/src/mcp/            # Rust 侧(协议与锁)
├── server.rs                 # axum 启动、路由(/health /mcp /mcp/batch /mcp/sse)
├── protocol.rs               # JSON-RPC 方法分发
├── editor_mode.rs            # 写者锁(持锁校验/释放/接管)
├── session.rs                # 会话注册表与 TTL 后台检查
├── tools_readonly.rs         # 6 只读工具
├── tools_write.rs            # 5 写工具(统一前置检查+自动续约+受理)
├── tools_session.rs          # 3 会话工具
├── prompts.rs                # 3 协作模板
├── audit_log.rs              # 审计日志(带锁追加)
├── event_emitter.rs          # Tauri 事件发射
├── data_source.rs            # 数据源 trait 抽象(tool 不依赖 AppHandle,测试用 mock)
└── tauri_source.rs           # 生产数据源:状态镜像(AppState)

src/mcp/                      # 前端侧(桥接)
├── mcpBridge.ts              # 状态镜像:store 变化防抖推送(会话变化即时)
└── operationBridge.ts        # 操作桥:事件 → mind-elixir API;会话事件 → 锁定/undo

src/components/LlmSessionBanner.tsx   # 会话横幅(含接管按钮)
```

接入配置见[接入指南](./mcp-quickstart.md),此处不再重复。
