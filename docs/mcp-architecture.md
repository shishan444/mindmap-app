# MindMap MCP Server 架构设计

> **版本**:v1.1(代码层验证后修订)
> **状态**:待实施
> **最后更新**:2026-07-23

## 修订记录

### v1.1(2026-07-23):代码层验证后修订

代码层确认后,发现 v1.0 的"前端集成"设计有误(走 `store.updateContent` 是绕过 mind-elixir 的旁路),修订为**调 mind-elixir 标准 API**,真正实现单一数据源:

- **§ 4 总体架构图**:数据流方向纠正,LLM → mind-elixir API → fire operation → 现有 sync 链路
- **§ 5.1 EditorMode Mutex**:加 Rust 端 `require_llm_session()` guard,双端防护
- **§ 5.8 前端集成**:operationBridge 改为调 `mind.addChild / reshapeNode` 等 API,不调 store
- 加了"单一数据源验证脚本"(DevTools 可执行)

### v1.0(2026-07-22):初稿

## 1. 背景

MindMap-app 目前完全由人工操作(键盘 + 鼠标)。希望让 LLM 也能读写思维导图,实现**人机协作**:LLM 帮助生成、扩展、整理思维导图,人工审阅和微调。

核心约束:**同时只能有一个写者**(人 or LLM),避免并发写入冲突。

## 2. 设计目标

| 目标 | 衡量标准 |
|------|---------|
| **人机协作** | LLM 能在人工打开的同一份 mindmap 上读写 |
| **互斥安全** | 任意时刻只有一个写者,不会丢数据 |
| **实时可见** | LLM 的操作在画布上立刻显示 |
| **可中断** | 人工能随时接管,LLM 不会"锁死"应用 |
| **零配置接入** | Claude Desktop / Cursor 等主流 LLM 客户端能直接挂载 |
| **复用现有架构** | 不重写 Tauri 后端,只增量加 MCP 层 |

## 3. 设计原则

1. **App-Embedded,不是 Standalone** — MCP server 跟 Tauri app 同进程,共享 store。app 没开就没 MCP。
2. **会话级互斥,不是操作级** — LLM 进入"会话",期间 UI 锁定。避免操作级锁的"中间状态污染"。
3. **协作礼仪,不是硬约束** — LLM 默认主动声明"我要编辑了",用户响应。技术上能锁但 UX 上不强制。
4. **复用 mind-elixir id** — LLM 看到的 node id 跟 app 一致,避免双源生成冲突。
5. **HTTP+SSE,不是 stdio** — Tauri 不是 stdio 进程,必须用 HTTP transport。

## 4. 总体架构

> **设计原则(代码层验证)**:LLM 操作**不直接改 store**,而是**调 mind-elixir 的标准 API**(`addChild` / `reshapeNode` 等),让 mind-elixir 内部 fire 标准 `"operation"` 事件,自动走现有 `syncFromMindElixir` 链路。这样 LLM 跟人编辑**走完全相同的路径**,真正实现单一数据源。

```
┌────────────────────────────────────────────────────────────────┐
│                    Tauri App(单进程)                          │
│                                                                │
│  ┌──────────────────┐         ┌──────────────────────────┐    │
│  │   React 前端     │ ◄─────► │   Tauri Rust 后端         │    │
│  │  ┌────────────┐  │  IPC    │  ┌────────────────────┐  │    │
│  │  │ operation  │  │ events  │  │ MCP HTTP server    │  │    │
│  │  │ Bridge     │  │         │  │ (axum + JSON-RPC)  │  │    │
│  │  │ (新增)     │  │         │  ├────────────────────┤  │    │
│  │  └─────┬──────┘  │         │  │ EditorMode Mutex   │  │    │
│  │        │调 API   │         │  │ SessionRegistry    │  │    │
│  │        ▼         │         │  └────────┬───────────┘  │    │
│  │  ┌────────────┐  │         │           │ HTTP         │    │
│  │  │ mind-elixir│  │         │           ▼              │    │
│  │  │ (canvas)   │  │         │  ┌────────────────────┐  │    │
│  │  │ addChild/  │  │         │  │ axum HTTP server   │  │    │
│  │  │ reshape... │  │         │  │ localhost:23456    │  │    │
│  │  └─────┬──────┘  │         │  └────────┬───────────┘  │    │
│  │        │ fire    │         └────────────┼─────────────┘    │
│  │        │operation│                      │                  │
│  │        ▼         │                      │                  │
│  │  ┌────────────┐  │                      │                  │
│  │  │ syncFrom   │  │                      │                  │
│  │  │ MindElixir │◄─┼──── 现有链路 ────────┘                  │
│  │  │ (零修改)   │  │         (人编辑也走这条)                 │
│  │  └─────┬──────┘  │                                            │
│  │        │setContent                                            │
│  │        ▼                                                       │
│  │  ┌────────────┐                                                │
│  │  │ Zustand    │ → markDirty → useAutoSave → save_mmap          │
│  │  │ Store      │                                                │
│  │  └────────────┘                                                │
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP + SSE (loopback only)
                              │
                ┌─────────────┴─────────────┐
                │   外部 LLM 客户端          │
                │  Claude Desktop / Cursor  │
                └───────────────────────────┘
```

### 数据流要点(代码层确认)

- **LLM 操作走 mind-elixir API**(不调 store):`mind.addChild()` / `mind.reshapeNode()` 等
- **mind-elixir 自动 fire `"operation"` 事件**(代码层验证:22 个 fire 点,每个 API 都有)
- **现有 `syncFromMindElixir` 链路零修改复用**:`markDirty + syncFromMindElixir + setContent`
- **useAutoSave 2s 防抖天然防抖**:LLM 60s 内调 20 次只触发 1 次保存
- **undo 整合靠 zundo pause/resume**:会话期间 `temporal.pause()`,会话结束 `resume()` + 手动 wrap

### 单一数据源验证

可以在浏览器 DevTools 执行,确认走 mind-elixir API 是否触发完整链路:
```javascript
window.__mind.addChild(window.__mind.currentNode)
// 预期:新节点出现 + dirty=true + 2s 后自动保存
```

## 5. 核心组件

### 5.1 EditorMode Mutex(核心)

Rust 全局状态,记录"当前谁在写"。

```rust
// src-tauri/src/mcp/editor_mode.rs
pub enum Editor {
    Human,
    Llm { session_id: String, client_name: String, acquired_at: i64, ttl_ms: u64 },
}

pub struct EditorMode(Arc<RwLock<Editor>>);

impl EditorMode {
    pub fn current(&self) -> Editor { /* 读锁 */ }
    pub fn try_acquire_llm(&self, session_id: &str, client: &str, ttl_ms: u64) -> Result<()> { /* CAS 写锁 */ }
    pub fn release_llm(&self, session_id: &str) -> Result<()> { /* 校验 session_id 后释放 */ }
    pub fn force_release(&self) { /* 用户中断 */ }
    
    /// ★ Rust 端 guard:emit llm-operation 前必须先 check 锁
    /// 即使前端 UI 防护失败,Rust 这层也能拦住
    pub fn require_llm_session(&self, session_id: &str) -> Result<()> {
        let editor = self.current();
        match editor {
            Editor::Llm { session_id: s, .. } if s == session_id => Ok(()),
            _ => Err(McpError::NotAuthorized { 
                hint: "需先 acquire_session 或 session 已过期" 
            }),
        }
    }
}
```

**双端防护策略**:

| 层级 | 防护机制 | 失败兜底 |
|------|---------|---------|
| **Rust 层(主)** | `require_llm_session()` 在 emit 前强制 check | 即使前端 bug,Rust 拒绝 emit |
| **前端层(辅)** | UI 加 `pointer-events: none` 阻止人编辑 | 用户体验(画布锁定 + banner) |

**为什么需要双端**:
- 只 Rust 层:用户编辑可能漏过(因为 Rust 不知道用户在编辑)
- 只前端层:用户可能通过 DevTools 绕过 UI 防护
- 双端:任何一层失败,另一层兜底

**关键不变式(Invariants)**:
- 同一时刻 `Editor::Llm` 最多存在 1 个 session
- `session_id` 是 UUID,只有持锁的 session 能 release
- TTL 到期自动 release(后台 tokio task 定时检查)
- Rust emit `llm-operation` event 前必须 `require_llm_session()` check 通过

### 5.2 SessionRegistry(会话管理)

```rust
pub struct SessionRegistry {
    sessions: Arc<Mutex<HashMap<String, LlmSession>>>,
}

pub struct LlmSession {
    pub id: String,
    pub client_name: String,
    pub acquired_at: i64,
    pub expires_at: i64,
    pub operations_count: u32,
    pub last_heartbeat: i64,
}
```

API:
- `create_session(client_name) -> session_id`
- `heartbeat(session_id) -> Result<()>`(续约 TTL)
- `list_active() -> Vec<LlmSession>`

### 5.3 MCP HTTP Server(axum)

监听 `127.0.0.1:23456`(配置项),路由:

| Path | Method | 用途 |
|------|--------|------|
| `/mcp` | POST | JSON-RPC 请求(tools/call, resources/read 等) |
| `/mcp/sse` | GET | Server-Sent Events(服务端推送:操作通知、心跳) |
| `/health` | GET | 健康检查(LLM 客户端验证 server 活着) |

实现要点:
- 用 `axum::Router` + `tokio`
- **CORS**:允许 `http://localhost:*`(Cursor 等浏览器内 MCP 客户端)
- **认证**:本机 loopback only,默认无 token(后续可加 bearer token)
- **Tauri state 共享**:axum 的 `State<AppState>` 持有 `tauri::AppHandle`,可以直接 emit events

### 5.4 MCP 协议适配层

实现 MCP 标准方法(JSON-RPC over HTTP):

| MCP 方法 | 行为 |
|---------|------|
| `initialize` | 返回 server info、capabilities |
| `tools/list` | 返回所有 tool 定义 |
| `tools/call` | 执行 tool,返回结果 |
| `resources/list` | 返回所有 resource uri |
| `resources/read` | 读 resource(返回 JSON) |
| `prompts/list` | 返回 prompts 模板 |
| `prompts/get` | 渲染 prompt |

**不引入完整 MCP SDK**,自己实现轻量 JSON-RPC handler(协议本身很简单,约 200 行 Rust)。

### 5.5 工具集(Tools)

按操作类型分组:

#### 只读 Tools(无需持锁)

| Tool | 参数 | 返回 | 用途 |
|------|------|------|------|
| `read_mindmap` | `{ path?: string }` | tree + meta | 读当前打开的或指定路径的文档 |
| `search_nodes` | `{ query: string, path?: string }` | `NodeSummary[]` | 关键词搜索节点 |
| `get_node` | `{ node_id: string, path?: string }` | `Node` 完整字段 | 单节点详情 |
| `list_reminders` | `{ path?: string }` | `Reminder[]` | 列出所有提醒 |
| `export_mindmap` | `{ format: "md"\|"opml"\|"mermaid", path?: string }` | string | 导出为文本格式 |
| `get_edit_state` | `{}` | `{ editor: "human"\|"llm", session?: {...} }` | 查询当前谁在编辑 |

#### 写 Tools(必须先 acquire session)

| Tool | 参数 | 返回 | 用途 |
|------|------|------|------|
| `acquire_session` | `{ client_name: string, ttl_sec?: number }` | `{ session_id, expires_at }` | LLM 申请持锁 |
| `heartbeat` | `{ session_id: string }` | `{ expires_at }` | 续约 |
| `release_session` | `{ session_id: string }` | `{}` | 主动释放 |
| `create_node` | `{ parent_id, topic, priority?, icons?, index? }` | `{ node_id }` | 新建子节点 |
| `update_node` | `{ node_id, patch }` | `{ node }` | 改字段(topic/priority/icons/style) |
| `delete_node` | `{ node_id }` | `{}` | 删除 |
| `move_node` | `{ node_id, to_parent_id, position? }` | `{}` | 移动 |
| `attach_file` | `{ node_id, file_path }` | `{ attached_file }` | 附加文件(走现有 attach_file_to_node) |

#### 写 Tools 的统一前置检查

```
fn require_llm_session(&self, session_id: &str) -> Result<()> {
    let editor = self.editor_mode.current();
    match editor {
        Editor::Llm { session_id: s, .. } if s == session_id => Ok(()),
        _ => Err(McpError::NotAuthorized { hint: "需先 acquire_session" }),
    }
}
```

### 5.6 Resources(可订阅的资源)

```
mindmap://current                        → 当前打开的文档(整树)
mindmap://current/outline                → Markdown 大纲视图
mindmap://current/node/{id}              → 单节点
mindmap://recent                         → 最近文件列表
mindmap://reminders                      → 全局提醒列表
mindmap://session                        → 当前 LLM 会话状态
```

支持 MCP 的 `resources/subscribe`,变更时通过 SSE 推送通知。

### 5.7 Prompts(协作模板)

```typescript
prompts: [
  {
    name: "expand_topic",
    description: "扩展一个节点为子结构",
    arguments: [
      { name: "node_id", required: true },
      { name: "depth", default: 2 }
    ]
  },
  {
    name: "from_meeting_notes",
    description: "从会议纪要生成思维导图"
  },
  {
    name: "summarize_to_outline",
    description: "把当前导图压缩成 3 层大纲"
  }
]
```

### 5.8 前端集成(LLM Operation Bridge)

新增 `src/llm/operationBridge.ts`:

> **关键设计(代码层验证)**:**不调 store**,而是调 **mind-elixir 的标准 API**。
> 这样 mind-elixir 内部会 fire 标准 `"operation"` 事件,自动走现有 `syncFromMindElixir` 链路,跟人编辑完全一样。
> 好处:零修改复用现有的 markDirty / setContent / attached_file 同步 / useAutoSave 防抖 / save_mmap 原子写。

```typescript
import { listen } from "@tauri-apps/api/event";
import { useMindMapStore } from "../store";

// 监听 Tauri event "llm-operation",转发到 mind-elixir API
listen("llm-operation", async (event) => {
  const op = event.payload as LlmOperation;
  const mind = useMindMapStore.getState().mindInstance;
  if (!mind) {
    console.warn("[llm-bridge] mind 实例未就绪");
    return;
  }
  
  // 会话级 undo 整合:会话开始时 pause,结束时 resume
  if (op.is_first_in_session) {
    useMindMapStore.temporal.getState().pause();
  }
  
  // ★ 关键:调 mind-elixir API,不调 store
  // mind-elixir 会 fire "operation" 事件 → 触发现 syncFromMindElixir → setContent
  try {
    switch (op.type) {
      case "create_node": {
        const parent = mind.findEle(op.payload.parent_id);
        if (!parent) throw new Error(`父节点 ${op.payload.parent_id} 不存在`);
        const newNodeObj = {
          topic: op.payload.topic,
          ...(op.payload.priority && { priority: op.payload.priority }),
          ...(op.payload.icons && { icons: op.payload.icons }),
        };
        await mind.addChild(parent, newNodeObj);
        break;
      }
      case "update_node": {
        const tpc = mind.findEle(op.payload.node_id);
        if (!tpc) throw new Error(`节点 ${op.payload.node_id} 不存在`);
        await mind.reshapeNode(tpc, op.payload.patch);
        break;
      }
      case "delete_node": {
        const tpc = mind.findEle(op.payload.node_id);
        if (!tpc) throw new Error(`节点 ${op.payload.node_id} 不存在`);
        await mind.removeNodes([tpc]);
        break;
      }
      case "move_node": {
        const tpc = mind.findEle(op.payload.node_id);
        const target = mind.findEle(op.payload.to_parent_id);
        if (!tpc || !target) throw new Error("源/目标节点不存在");
        await mind.moveNodeIn([tpc], target);
        break;
      }
      default:
        console.warn("[llm-bridge] 未知 op type", op.type);
    }
    // mind-elixir 自动 fire operation → syncFromMindElixir → setContent + markDirty
    // useAutoSave 2s 防抖 → save_mmap 原子写
    // 一切都自动!
  } catch (e) {
    console.error("[llm-bridge] 操作失败", op, e);
    // 错误回传给 Rust,Rust 返给 LLM
    throw e;
  }
  
  if (op.is_last_in_session) {
    useMindMapStore.temporal.getState().resume();
    // 手动记录 wrap state,让整个会话成为 1 个 undo 单元
    useMindMapStore.temporal.getState().set(
      useMindMapStore.getState(),
      "LLM 会话: " + (op.session_intent ?? "")
    );
  }
});

// LLM 持锁时,UI 显示 banner + 画布加 llm-active class
listen("llm-session-changed", (event) => {
  useMindMapStore.getState().setLlmSession(event.payload);
});
```

**为什么不调 store.updateContent**:
- store.updateContent 是"程序式修改 content"的旁路,绕过 mind-elixir
- 一旦绕过,mind-elixir 的 canvas DOM 不会刷新,会显示旧状态
- 必须走 mind-elixir API 让它内部自己刷新,数据流才一致

**为什么不用 `store.setPriorityForSelected` 等业务 action**:
- 业务 action 内部也是调 mind.reshapeNode(看 TabProperties.tsx handleAttach)
- 直接调 mind API 更直接,且能复用 mind-elixir 的 fire operation 链路

**代码层验证**:
- mind-elixir 类型定义(`node_modules/mind-elixir/dist/types/methods.d.ts`)确认 `addChild / reshapeNode / removeNodes / moveNodeIn/Before/After` 都是 public API
- mind-elixir 内部(`MindElixir.iife.js`)确认每个 API 内部都 `fire("operation", {name: ...})`
- MindMapCanvas.tsx:323-328 确认订阅了 operation 事件并触发 syncFromMindElixir

### 5.9 UI 变更

**新增**:`src/components/LlmSessionBanner.tsx`
- LLM 持锁时顶部显示:"🤖 Claude Desktop 正在编辑(剩余 45s)" + "✋ 接管" 按钮
- 显示 LLM 最近一次操作("2s 前:创建了节点 X")

**修改**:`MindMapCanvas.tsx`
- LLM 持锁时画布加 `llm-active` class
- CSS:`.llm-active me-tpc { pointer-events: none; }`(禁止人编辑)
- 但是允许点击查看(不影响 LLM)

**修改**:`TabProperties.tsx`
- LLM 持锁时所有写按钮 disabled + tooltip "LLM 正在编辑"

## 6. 互斥协议(详细)

### 6.1 状态机

```
                    ┌────────────────┐
       app 启动     │                │
        ────────►   │   Human 编辑    │ ◄─────── 用户点"接管"
                    │                │
                    └────┬───────────┘
                         │
                         │ LLM 调 acquire_session
                         │   (检查 ttl_sec ≤ 300)
                         │
                         ▼
                    ┌────────────────┐
                    │                │
                    │  LLM 持锁中    │
                    │  (单 session)  │
                    │                │
                    └────┬───────────┘
                         │
              ┌──────────┼──────────┬──────────┐
              │          │          │          │
       LLM 调      LLM 调       TTL 到期      用户点
    release_     heartbeat     (60s 无心跳)   "接管"
    session      (续约)        
              
              └──────────┴──────────┴──────────┘
                         │
                         ▼
                    ┌──────────────┐
                    │  Human 编辑  │
                    └──────────────┘
```

### 6.2 acquire_session 协议

```jsonc
// LLM → MCP
{
  "method": "tools/call",
  "params": {
    "name": "acquire_session",
    "arguments": {
      "client_name": "Claude Desktop",
      "ttl_sec": 60,
      "intent": "扩展会议纪要为思维导图"
    }
  }
}

// MCP → LLM
{
  "result": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "expires_at": 1784610000000,
    "acquired_at": 1784609940000,
    "human_present": true,    // 提示:人在 app 前
    "hint": "请在 60s 内完成操作,可调 heartbeat 续约"
  }
}
```

### 6.3 TTL 与心跳

- **默认 TTL**:60 秒(足够 LLM 思考 + 调几个 tool)
- **心跳续约**:LLM 每次调任意写 tool 自动续约
- **主动续约**:LLM 可调 `heartbeat` tool 显式续约
- **超时**:TTL 到期自动 release,emit `llm-session-expired` 事件,UI 提示用户

### 6.4 用户中断(逃生舱)

LLMSessionBanner 的"✋ 接管"按钮:
```typescript
onClick: async () => {
  await invoke("llm_force_release");  // Tauri command
  // Rust 释放锁,emit "llm-session-changed"
  // UI 立即恢复可编辑
}
```

**关键**:用户中断后,LLM 下次调写 tool 会收到 `NotAuthorized` 错误,LLM 必须先重新 `acquire_session`。

### 6.5 操作原子性(undo 整合)

LLM 会话内所有操作打包成一个 undo 单元:
- 会话开始时,`temporal.pause()`(暂停 zundo 跟踪)
- 每个操作直接改 store(不进 undo 历史)
- 会话结束(或 TTL 到期),`temporal.resume()` + 手动记录一个 wrap state

这样用户按 Cmd+Z 一次就能撤销整个 LLM 会话。

## 7. 数据流(典型场景)

### 场景 A:LLM 扩展思维导图

```
1. 用户打开 app,打开 mindmap.mmap(EditorMode=Human)
2. 用户在 Claude Desktop 发指令:"帮我把会议纪要扩展成思维导图"
3. Claude 调 read_mindmap → MCP 返回当前树
4. Claude 调 acquire_session(60s) → MCP 检查 Human idle,Rust EditorMode=Llm
5. MCP emit "llm-session-changed" → 前端显示 banner + 锁定 UI
6. Claude 调 create_node(parent=root, topic="会议纪要") 
   → MCP 校验 session_id
   → MCP emit "llm-operation"(type=create_node, payload=...)
   → 前端 operationBridge 调 store.createNode()
   → mind-elixir 重新渲染,画布显示新节点
   → MCP 返回 {node_id} 给 Claude
7. Claude 调若干次 create_node / update_node(每次自动续约)
8. Claude 调 release_session → MCP emit "llm-session-changed"
9. 前端 banner 消失,UI 解锁
10. 用户审阅,如不满意按 Cmd+Z 一次撤销整个 LLM 会话
```

### 场景 B:LLM 持锁超时

```
... 步骤 4-6 同上 ...
7. Claude 思考超 60s 没动作
8. MCP 后台 task 检测到 expires_at < now
9. MCP 自动 release,emit "llm-session-expired"
10. 前端 banner 变红:"⚠️ LLM 会话已超时,已释放锁"
11. 用户恢复编辑
12. Claude 继续调 tool → 收到 NotAuthorized → 必须 acquire_session
```

### 场景 C:用户主动中断

```
1. Claude 持锁,正在调 create_node
2. 用户看到节点不对,点 banner "✋ 接管"
3. 前端 invoke "llm_force_release"
4. Rust EditorMode = Human,emit "llm-session-changed"
5. Claude 下次调 create_node → 收到 NotAuthorized
6. Claude 必须先 acquire_session(检查 user idle)
```

## 8. 技术选型

| 决策点 | 选择 | 理由 | 备选 |
|--------|------|------|------|
| MCP transport | HTTP + SSE | Tauri 不是 stdio 进程 | stdio(需 sidecar,复杂) |
| HTTP server | `axum` | Tauri 生态友好,tokio 原生 | actix-web(更老) |
| Async runtime | `tokio` | axum 依赖 | 无 |
| MCP 协议实现 | 自己实现(轻量) | 协议简单(~200 行),避免重型 SDK | `rmcp` crate(还在早期) |
| 端口 | `23456`(可配) | 不冲突常见端口 | 0(随机,但不便于客户端配置) |
| 锁实现 | `Arc<RwLock<Editor>>` | 读多写少 | `parking_lot::RwLock`(更快,加依赖) |
| LLM 操作注入 | Tauri event | 复用现有 event 机制 | 直接命令调用(但前端拿不到) |

## 9. 实施阶段

### Phase 1:只读 MVP(预计 3-5 天)

**目标**:验证 Claude Desktop 能连上 app,能读到当前打开的 mindmap。

**范围**:
- axum HTTP server 启动 + 路由
- 实现 MCP 协议核心(`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`)
- 实现 6 个只读 tools(read_mindmap / search_nodes / get_node / list_reminders / export_mindmap / get_edit_state)
- README 加"Claude Desktop 配置"章节

**不做**:写 tools / 互斥协议 / UI 变更

**验收**:
- `curl http://localhost:23456/health` 返回 ok
- Claude Desktop 配置后,问"我现在的思维导图有哪些节点?"能正确回答

### Phase 2:互斥写(预计 1-2 周)

**目标**:LLM 能通过 acquire/session 机制安全地修改思维导图。

**范围**:
- EditorMode Mutex + SessionRegistry
- 实现 acquire/heartbeat/release 3 个会话 tool
- 实现 4 个写 tools(create/update/delete/move_node)
- 前端 operationBridge(订阅 event + 应用到 store)
- LlmSessionBanner UI + 画布锁定
- TTL 后台 task + 超时 release
- 用户"接管"按钮

**不做**:attach_file / 复杂 prompts

**验收**:
- Claude Desktop 能在 60s 内完成一系列 create_node
- 用户点"接管"立即生效
- 持锁期间人编辑被 UI 阻止

### Phase 3:协作体验(预计 1 周)

**目标**:让协作感觉自然,不是机械的锁切换。

**范围**:
- LLM 操作历史侧栏(显示最近 10 个操作)
- undo 整合(整个会话作为单个 undo 单元)
- Prompts 模板(3-5 个常用)
- attach_file tool
- 系统通知("LLM 已完成,请审阅")
- 设置面板(MCP 开关、端口、TTL)

## 10. 风险与缓解

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| **LLM 卡死持锁** | 高 | TTL 60s 自动释放 + 用户中断按钮 |
| **用户被锁 UX 差** | 中 | Banner 明显 + 实时进度 + 一键接管 |
| **多 LLM 客户端冲突** | 中 | 单 session 模式,后到者拒绝并提示 |
| **LLM 误操作破坏数据** | 高 | undo 整合 + 提示用户审阅 + 自动备份(save_mmap 已有 .bak) |
| **端口被占用** | 低 | 启动时检测,失败降级 + 提示用户改端口 |
| **Tauri 多窗口的锁归属** | 中 | 锁是 app 级(不是窗口级),所有窗口共享同一 EditorMode |
| **跨设备 LLM 操作** | 低 | 当前不支持(只本机 loopback),后续可加 TLS + token |
| **Tauri event 时序** | 中 | 写 tool 同步等待前端 ack(用 once_cell + reply channel) |

## 11. 安全考虑

- **只监听 loopback**(`127.0.0.1`),不暴露到局域网
- **无敏感数据通过 MCP 暴露**:attached_file 只暴露元信息,不暴露文件字节(文件字节通过现有 read_thumbnail 走 Tauri 权限)
- **后续可加 Bearer token**:settings 里配 token,LLM 客户端必须带
- **审计日志**:每次 LLM 操作记录到 `~/Library/Application Support/MindMap/llm-audit.jsonl`

## 12. 后续演进

| 演进方向 | 触发条件 | 大致工作量 |
|---------|---------|-----------|
| **远程 LLM 客户端**(跨设备) | 用户需求 | 1 周(加 TLS + token + 局域网发现) |
| **流式操作推送**(LLM 边思考边显示) | 协作体验提升 | 3 天(SSE 推送中间状态) |
| **协作 Prompts 库** | 社区贡献 | 持续 |
| **Web UI 远程查看** | 用户需求 | 1 周(只读 HTTP 路由,返回 HTML 渲染) |
| **多 LLM 协同** | 高级用例 | 2 周(加 session queue + 优先级) |

## 13. 关键文件结构(规划)

```
mindmap-app/
├── src-tauri/
│   ├── src/
│   │   ├── mcp/                    # 新增 MCP 模块
│   │   │   ├── mod.rs              # 模块入口
│   │   │   ├── server.rs           # axum HTTP server 启动
│   │   │   ├── protocol.rs         # MCP JSON-RPC 实现
│   │   │   ├── editor_mode.rs      # EditorMode Mutex
│   │   │   ├── session.rs          # SessionRegistry
│   │   │   ├── tools/              # 各 tool 实现
│   │   │   │   ├── read.rs         # 只读 tools
│   │   │   │   ├── write.rs        # 写 tools
│   │   │   │   └── session.rs      # 会话管理 tools
│   │   │   └── state.rs            # MCP server 共享 state(AppHandle 等)
│   │   ├── commands.rs             # 扩展:加 llm_force_release 等命令
│   │   └── lib.rs                  # setup 时启动 MCP server
│   └── Cargo.toml                  # 加 axum / tokio 依赖
├── src/
│   ├── llm/                        # 新增前端 LLM 集成
│   │   ├── operationBridge.ts      # 订阅 llm-operation 事件
│   │   ├── sessionState.ts         # LLM session state(zustand slice)
│   │   └── types.ts                # LlmOperation / LlmSession 类型
│   ├── components/
│   │   ├── LlmSessionBanner.tsx    # 新增:顶部 banner
│   │   └── LlmOperationHistory.tsx # 新增:操作历史侧栏(Phase 3)
│   ├── store.ts                    # 扩展:加 llmSession 字段
│   └── App.tsx                     # 集成 banner
└── docs/
    ├── mcp-architecture.md         # 本文档
    └── mcp-quickstart.md           # Phase 1 完成后写(Claude Desktop 配置指南)
```

## 14. 附录:配置示例

### Claude Desktop 配置(`claude_desktop_config.json`)

```jsonc
{
  "mcpServers": {
    "mindmap": {
      "url": "http://localhost:23456/mcp",
      "transport": "sse"
    }
  }
}
```

### App 设置(`config.json`)

```jsonc
{
  "mcp": {
    "enabled": true,
    "port": 23456,
    "default_ttl_sec": 60,
    "max_ttl_sec": 300,
    "audit_log": true
  }
}
```

---

**下一步**:等待用户 review,确认后进入 Phase 1 实施。
