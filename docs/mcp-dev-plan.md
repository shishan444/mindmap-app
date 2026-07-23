# MindMap MCP 开发规划

> **版本**:v1.0
> **配套文档**:
> - 产品决策:[`mcp-overview.md`](./mcp-overview.md)
> - 架构设计:[`mcp-architecture.md`](./mcp-architecture.md)
> - 本文档:**工程执行规划**(开发/测试/合并/验收)

---

## 0. 总览

### 0.1 目标

把架构方案落地为**可执行、可验证、可追溯**的工程任务,从 Phase 1 到 Phase 3 全程纪律化执行,确保:
- 任何时候拿到文档都能开工(无隐性决策)
- 每个 Phase 是独立可交付的增量
- 功能点覆盖率 ≥ 95%,链路流程覆盖率 ≥ 95%
- git 历史清晰反映每个里程碑

### 0.2 核心工程纪律(硬门槛)

| # | 纪律 | 强制方式 |
|---|------|---------|
| 1 | main 分支保护 | 不准直接 push,只能 PR 合并 |
| 2 | 每任务独立分支 | 命名 `feature/mcp-p{N}-{slug}` |
| 3 | 任务完工 = 测试通过 + 覆盖率达标 | pre-push hook + CI 双重 check |
| 4 | Phase 完工 = 全量回归过 + 打 tag | 阶段验收清单 |
| 5 | 不允许 skip 测试 / 带 todo 提交 | lint + 类型检查 |
| 6 | 提交信息遵循 conventional commits | commitlint hook |

### 0.3 文档关系

```
mcp-overview.md       产品决策(产品负责人看)
    ↓
mcp-architecture.md   架构设计(工程师看,What/Why)
    ↓
mcp-dev-plan.md       开发规划(本文档,How/When)  ← 你在这里
    ↓
实施 → commit → 测试 → PR → 合并
```

---

## 1. 分支策略与版本控制

### 1.1 分支模型(单一功能分支)

**核心策略**:MCP 作为一个完整功能单元,使用**单一长生命周期分支** `feature/mcp-server`,所有 Phase 1-3 的所有任务都在这一个分支上开发。每个任务是分支上的一个 commit,不在 main 上留下中间状态。最终整体完成后通过 1 个 PR 合并到 main。

```
main (受保护,稳定线,始终可发布的稳定版本)
 │
 │
 │     feature/mcp-server (MCP 功能分支,所有开发在这)
 │     │
 │     ├── commit: feat(mcp-p1): 实现 MCP JSON-RPC 协议层
 │     ├── commit: feat(mcp-p1): axum server 启动 + 路由
 │     ├── commit: feat(mcp-p1): 6 个只读 tool 实现
 │     ├── commit: docs(mcp-p1): Claude Desktop 配置指南
 │     ├── tag: mcp-phase-1                       ← Phase 1 里程碑
 │     │
 │     ├── commit: feat(mcp-p2): EditorMode Mutex + Rust guard
 │     ├── commit: feat(mcp-p2): SessionRegistry + TTL task
 │     ├── commit: feat(mcp-p2): 7 个写 tool + acquire/release
 │     ├── commit: feat(mcp-p2): 前端 operationBridge
 │     ├── commit: feat(mcp-p2): LlmSessionBanner + 画布锁定
 │     ├── commit: feat(mcp-p2): 用户接管按钮
 │     ├── tag: mcp-phase-2                       ← Phase 2 里程碑
 │     │
 │     ├── commit: feat(mcp-p3): attach_file tool
 │     ├── commit: feat(mcp-p3): Prompts 模板
 │     ├── commit: feat(mcp-p3): undo 整合
 │     ├── commit: feat(mcp-p3): 操作历史侧栏
 │     ├── commit: feat(mcp-p3): 设置面板
 │     ├── tag: v0.2.0-mcp                         ← 最终版本
 │     │
 │     ▼
 │   PR #N:Merge feature/mcp-server into main
 │     │
 ▼─────┴──────────────────────────────────────────►  main
                                                     │
                                                     tag: v0.2.0
```

### 1.2 命名规范

- **MCP 功能分支**:`feature/mcp-server`(固定名,整个开发周期不变)
- **Hotfix**(如需紧急修复 main):`fix/{slug}`
- **阶段 tag**(在功能分支上打):
  - `mcp-phase-1` — Phase 1 完成
  - `mcp-phase-2` — Phase 2 完成
- **最终 release tag**(合并到 main 后打):`v0.2.0-mcp`

### 1.3 开发流程

```
1. 启动:
   git checkout main
   git pull origin main
   git checkout -b feature/mcp-server
   git push -u origin feature/mcp-server

2. 每个任务的开发循环:
   git checkout feature/mcp-server    # 确保在功能分支
   # ... 编码 + 测试 + 覆盖率达到 95%
   git add <files>
   git commit -m "feat(mcp-pN): 任务标题"
   git push origin feature/mcp-server
   # (pre-push hook 自动跑相关测试)

3. 阶段里程碑:
   # Phase N 全部任务完成 + 验收通过
   git tag mcp-phase-N
   git push origin mcp-phase-N

4. 最终交付:
   # Phase 3 全部完成 + 整体验收
   git push origin feature/mcp-server
   # 在 GitHub 开 PR:feature/mcp-server → main
   # PR 描述附上 3 份文档链接 + 测试报告 + 覆盖率报告
   # code review + CI 全绿 → squash merge 到 main
   git checkout main
   git tag v0.2.0-mcp
   git push origin v0.2.0-mcp
   # 创建 GitHub Release v0.2.0(带新 .dmg)
```

### 1.4 同步 main(如需)

如果开发期间 main 有其他更新(比如修了 bug),需要把 main 同步到功能分支:

```bash
git checkout feature/mcp-server
git fetch origin
git rebase origin/main   # 或 merge,看团队偏好
# 解决冲突 → 跑全量测试 → push
```

**推荐 rebase**(保持线性历史),但需团队接受 force push 到功能分支。

### 1.5 Commit 规范

每个任务 = 1 个 commit(粒度对齐 WBS 任务):

```
<type>(mcp-p<N>): <任务标题>

<body:做了什么、为什么、加了哪些测试>

<footer:关联 Issue / 标注 Phase>
```

类型:`feat / fix / test / refactor / docs / chore`

示例:
```
feat(mcp-p1): 实现 MCP JSON-RPC 协议核心层

- initialize / tools/list / tools/call 三个标准方法
- 错误码遵循 MCP 规范(代码 -32xxx 系列)
- 加 22 个单元测试覆盖协议层
- 覆盖率:协议层 100%

Phase: P1-T1
```

**约束**:
- 一个 commit 只做一件事(对应一个任务)
- 必须包含测试
- 不允许 `--no-verify` 绕过 hook
- 不允许 `--amend` 改已 push 的 commit(改用新 commit)

---

## 2. WBS 任务分解

### 2.1 Phase 1:只读 MVP(预计 5-7 天)

| ID | 任务 | 产出 | 依赖 | 预估 |
|----|------|------|------|------|
| P1-T1 | MCP 协议核心层 | `src-tauri/src/mcp/protocol.rs` 实现 JSON-RPC 3.0 + MCP 标准方法 | 无 | 1.5 天 |
| P2-T2 | axum HTTP server 启动 | `src-tauri/src/mcp/server.rs` 监听 127.0.0.1:23456,/health 路由 | T1 | 1 天 |
| P1-T3 | 6 个只读 tool 实现 | read_mindmap / search_nodes / get_node / list_reminders / export_mindmap / get_edit_state | T1, T2 | 2 天 |
| P1-T4 | Claude Desktop 配置 + 文档 | `docs/mcp-quickstart.md` + 示例配置 | T1-T3 | 0.5 天 |
| P1-T5 | 阶段验收 + tag | 全量回归 + 覆盖率报告 + 打 `mcp-phase-1` tag | T1-T4 | 0.5 天 |

**Phase 1 总计**:5.5 天(含缓冲 7 天)

### 2.2 Phase 2:互斥写(预计 12-15 天)

| ID | 任务 | 产出 | 依赖 | 预估 |
|----|------|------|------|------|
| P2-T1 | EditorMode Mutex + Rust guard | `src-tauri/src/mcp/editor_mode.rs`,双端防护 | P1 完成 | 2 天 |
| P2-T2 | SessionRegistry + TTL task | `src-tauri/src/mcp/session.rs`,心跳 + 超时 | T1 | 2 天 |
| P2-T3 | 7 个写 tool + acquire/release | acquire/heartbeat/release + create/update/delete/move_node | T1, T2 | 3 天 |
| P2-T4 | 前端 operationBridge | `src/llm/operationBridge.ts`,调 mind-elixir API | T3 | 2 天 |
| P2-T5 | LlmSessionBanner + 画布锁定 | `src/components/LlmSessionBanner.tsx` + CSS | T4 | 2 天 |
| P2-T6 | 用户接管按钮 + force_release | Tauri command + UI | T1, T5 | 1 天 |
| P2-T7 | 阶段验收 + tag | 全量回归 + E2E + 打 `mcp-phase-2` tag | T1-T6 | 1 天 |

**Phase 2 总计**:13 天(含缓冲 15 天)

### 2.3 Phase 3:协作体验(预计 6-8 天)

| ID | 任务 | 产出 | 依赖 | 预估 |
|----|------|------|------|------|
| P3-T1 | attach_file tool | 走现有 attach_file_to_node 命令 | P2 完成 | 1 天 |
| P3-T2 | Prompts 模板(3 个) | expand_topic / from_meeting_notes / summarize_to_outline | 无 | 1 天 |
| P3-T3 | undo 整合(zundo pause/resume) | operationBridge 加 session 级 undo 分组 | P2-T4 | 1.5 天 |
| P3-T4 | LLM 操作历史侧栏 | `src/components/LlmOperationHistory.tsx` | P2-T5 | 1.5 天 |
| P3-T5 | 设置面板(MCP 开关/端口/TTL) | PreferencesModal 加 MCP tab | 无 | 1 天 |
| P3-T6 | 最终验收 + release | 全量 + 打 `v0.2.0-mcp` | T1-T5 | 1 天 |

**Phase 3 总计**:7 天(含缓冲 8 天)

### 2.4 总工期

**~25-30 个工作日**(约 5-6 周,含测试和缓冲)

---

## 3. 功能点清单(95% 覆盖率基础)

> **95% 覆盖率怎么算**:覆盖的功能点数 / 总功能点数 ≥ 0.95。下面列出全部功能点。

### 3.1 Phase 1 功能点(11 个)

#### MCP 协议(5 个)
- F-P1-01:`initialize` 方法(返回 server info + capabilities)
- F-P1-02:`tools/list` 方法(返回所有 tool 定义)
- F-P1-03:`tools/call` 方法(执行 tool,返回结果)
- F-P1-04:`resources/list` 方法
- F-P1-05:`resources/read` 方法

#### 只读 Tools(6 个)
- F-P1-06:`read_mindmap(path?)` 返回树 + meta
- F-P1-07:`search_nodes(query, path?)` 返回匹配节点
- F-P1-08:`get_node(node_id, path?)` 返回单节点详情
- F-P1-09:`list_reminders(path?)` 返回提醒列表
- F-P1-10:`export_mindmap(format, path?)` 返回 md/opml/mermaid
- F-P1-11:`get_edit_state()` 返回当前 Editor 状态

### 3.2 Phase 2 功能点(13 个)

#### 互斥协议(5 个)
- F-P2-01:`acquire_session(client_name, ttl_sec)` 申请持锁
- F-P2-02:`heartbeat(session_id)` 续约 TTL
- F-P2-03:`release_session(session_id)` 主动释放
- F-P2-04:TTL 到期自动 release(后台 task)
- F-P2-05:`llm_force_release` Tauri command(用户接管)

#### 写 Tools(4 个)
- F-P2-06:`create_node(parent_id, topic, ...)`
- F-P2-07:`update_node(node_id, patch)`
- F-P2-08:`delete_node(node_id)`
- F-P2-09:`move_node(node_id, to_parent_id, position?)`

#### 前端集成(4 个)
- F-P2-10:operationBridge 订阅 `llm-operation` 事件
- F-P2-11:operationBridge 调 mind-elixir API(不调 store)
- F-P2-12:LlmSessionBanner 显示 + 倒计时
- F-P2-13:画布 `llm-active` class(锁定 UI)

### 3.3 Phase 3 功能点(6 个)

- F-P3-01:`attach_file(node_id, file_path)` tool
- F-P3-02:Prompt `expand_topic`
- F-P3-03:Prompt `from_meeting_notes`
- F-P3-04:Prompt `summarize_to_outline`
- F-P3-05:undo 整合(整段会话 = 1 个 undo 单元)
- F-P3-06:LLM 操作历史侧栏(实时显示最近 10 个操作)
- F-P3-07:设置面板 MCP tab(开关/端口/TTL)

### 3.4 总数:**30 个功能点**

**95% 门槛**:至少 29 个功能点有测试覆盖。

---

## 4. 链路清单(95% 链路覆盖率基础)

> **链路 = 端到端用户场景**,从 LLM 客户端发起到最终生效的完整流程。

### 4.1 8 条核心链路

#### L1:连接链路(Phase 1)
```
LLM 客户端 → HTTP /mcp → initialize → 拿到 capabilities → 列 tools
```
- Happy:正常初始化
- Edge:无效 protocol version、端口被占、CORS 拒绝

#### L2:只读链路(Phase 1)
```
LLM → tools/call read_mindmap → Rust 读 .mmap → 返回树 JSON
```
- Happy:当前打开的文档、指定路径的文档
- Edge:文件不存在、文件损坏、节点数 > 1000 性能

#### L3:acquire 链路(Phase 2)
```
LLM → acquire_session → Rust check EditorMode → 返回 session_id
```
- Happy:Human idle 时 LLM 成功 acquire
- Edge:已有 LLM session 拒绝、TTL 超限拒绝、client_name 缺失

#### L4:写链路(Phase 2)★ 最关键
```
LLM → create_node → Rust emit llm-operation → 前端 bridge → 
mind.addChild() → fire operation → syncFromMindElixir → 
setContent + markDirty → useAutoSave → save_mmap
```
- Happy:LLM 创建节点 → 画布实时显示 → 2s 后自动保存
- Edge:parent_id 不存在、session 失效、mind 实例未就绪

#### L5:心跳链路(Phase 2)
```
LLM → heartbeat → Rust 续约 TTL → 返回新 expires_at
```
- Happy:正常续约
- Edge:session_id 错误、已过期不能续约

#### L6:超时链路(Phase 2)
```
LLM 60s 无心跳 → 后台 task 检测 → 自动 release → emit llm-session-expired
```
- Happy:TTL 到期自动解锁,UI 恢复
- Edge:TTL task 崩溃、UI 没订阅事件

#### L7:接管链路(Phase 2)
```
用户点 ✋ 接管 → Tauri command → Rust force_release → emit → UI 解锁 → 
LLM 下次操作失败
```
- Happy:用户中断 → LLM 收到 NotAuthorized
- Edge:LLM 正在执行操作中途被中断、按钮无响应

#### L8:undo 链路(Phase 3)
```
LLM 会话期间 zundo pause → N 次操作 → 会话结束 resume → 
用户按 Cmd+Z 一次撤销整段
```
- Happy:整个会话作为 1 个 undo 单元
- Edge:pause 期间 app 崩溃、会话超时未正常 release

### 4.2 链路覆盖率门槛

**8 条链路 × (happy + 至少 2 edge) = 24 个 E2E 测试**

**95% 门槛**:至少 23 个测试通过。

---

## 5. 测试体系(三层架构)

### 5.1 三层测试分工

```
┌──────────────────────────────────────────────┐
│  E2E 测试(chrome-devtools MCP + 模拟 LLM)  │  ← 验证链路
│  ~24 个,覆盖 8 条核心链路                    │
├──────────────────────────────────────────────┤
│  集成测试(Rust + TS 协作)                   │  ← 验证组件协作
│  ~50 个,跨 Rust/TS 边界                      │
├──────────────────────────────────────────────┤
│  单元测试(vitest + cargo test)              │  ← 验证函数正确
│  ~200 个,每个 tool / 函数级                  │
└──────────────────────────────────────────────┘
```

### 5.2 单元测试

#### 前端(vitest)
- 位置:`src/**/*.test.ts(x)`
- 工具:现有 vitest 配置
- 覆盖:operationBridge / LlmSessionBanner / 设置面板 / helpers
- 数量预估:**~80 个**

#### 后端(cargo test)
- 位置:`src-tauri/src/mcp/*.rs` 内 `#[cfg(test)] mod tests`
- 工具:现有 cargo test
- 覆盖:protocol / editor_mode / session / tools 逻辑
- 数量预估:**~120 个**

### 5.3 集成测试

#### Rust + Tauri 集成(`src-tauri/tests/mcp_*.rs`)
- 启动真实 axum server + 真实 Tauri runtime
- 模拟 HTTP 请求 + 验证响应
- 数量预估:**~30 个**

#### 前端 + mind-elixir 集成(`src/llm/*.test.ts`)
- 真实 mind-elixir 实例 + mock Tauri event
- 验证 operationBridge 真的触发 mind-elixir API
- 数量预估:**~20 个**

### 5.4 E2E 测试(chrome-devtools MCP)

- 位置:`e2e/mcp-*.test.ts`
- 工具:chrome-devtools MCP + 自定义 LLM client mock
- 流程:启动 dev → 模拟 LLM 发 HTTP 请求 → 验证画布变化
- 数量:**24 个**(8 链路 × 3 场景)

#### LLM 客户端 Mock 策略

```typescript
// e2e/helpers/llmClient.ts
export class MockLLMClient {
  constructor(private baseUrl = "http://localhost:23456") {}
  
  async callTool(name: string, args: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "tools/call",
        params: { name, arguments: args }
      })
    });
    return res.json();
  }
}
```

### 5.5 测试夹具

```
e2e/fixtures/
├── simple.mmap               # 简单 3 节点文档
├── large-1000-nodes.mmap     # 性能测试用
├── with-attachments.mmap     # 含附件
├── with-reminders.mmap       # 含提醒
└── meeting-notes.md          # Prompt 测试输入
```

---

## 6. 覆盖率体系

### 6.1 工具选型

| 层 | 工具 | 报告格式 |
|----|------|---------|
| 前端 | `vitest --coverage`(istanbul) | json + html + lcov |
| 后端 | `cargo tarpaulin` | json + lcov |
| 合并 | `covdir` 合并两份报告 | unified lcov |

### 6.2 衡量方法

#### 功能点覆盖率(自定义指标)
```python
covered = sum(1 for f in FEATURES if f.has_test)
rate = covered / len(FEATURES)
assert rate >= 0.95
```

维护文件:`e2e/feature-coverage.yaml`
```yaml
features:
  - id: F-P1-01
    name: initialize
    tests: [test_protocol_initialize]
  - id: F-P1-06
    name: read_mindmap
    tests: [test_read_current, test_read_specified_path]
  ...
```

#### 链路覆盖率(自定义指标)
```yaml
flows:
  - id: L1
    name: 连接链路
    tests: [e2e_l1_connect_happy, e2e_l1_invalid_version, e2e_l1_port_conflict]
```

#### 代码覆盖率(传统指标)
- 行覆盖(line):辅助参考,不作硬性门槛
- 分支覆盖(branch):辅助参考
- **功能点 + 链路覆盖率**才是 95% 门槛的依据

### 6.3 门槛配置

```yaml
# .coverage-threshold.yml
feature_coverage: 0.95
flow_coverage: 0.95
line_coverage: 0.80   # 辅助
branch_coverage: 0.80 # 辅助
```

### 6.4 强制机制

| 时机 | 强制方式 |
|------|---------|
| 本地 commit | pre-commit hook 跑相关测试 |
| 本地 push | pre-push hook 跑全量测试 + 覆盖率 |
| PR | CI 跑全量 + 阻止合并 if < 95% |
| Phase 完工 | 手动验收清单 + tag |

---

## 7. 阶段验收清单(Go / No-Go)

### 7.1 Phase 1 验收(在 feature/mcp-server 分支上打 mcp-phase-1)

**前提**:Phase 1 所有任务(T1-T5)已 commit 到 `feature/mcp-server`。

**验收项**:

- [ ] 全量单元测试通过(`npm run test:fe` + `npm run test:be`)
- [ ] 现有 254 FE + 100 Rust 测试 0 回归
- [ ] 新增 Phase 1 测试 ≥ 50 个全过
- [ ] 功能点覆盖率(F-P1-01 到 F-P1-11)= 11/11 = 100%
- [ ] L1 连接链路 + L2 只读链路 E2E 测试通过
- [ ] `curl http://localhost:23456/health` 返回 ok
- [ ] Claude Desktop 配置后能列 tool、能读当前 mindmap
- [ ] `docs/mcp-quickstart.md` 完成
- [ ] 在 `feature/mcp-server` 分支上打 tag:`git tag mcp-phase-1`

**No-Go 信号**(任一出现就停,不进 Phase 2):
- ❌ 现有测试有回归
- ❌ 协议实现卡壳 > 2 天
- ❌ Claude Desktop 接不上

### 7.2 Phase 2 验收(在 feature/mcp-server 分支上打 mcp-phase-2)

**前提**:Phase 2 所有任务已 commit 到同一分支。

**验收项**:

- [ ] 全量测试 + Phase 2 新增 ≥ 80 个测试全过
- [ ] 功能点覆盖率(F-P2-01 到 F-P2-13)= 13/13 = 100%
- [ ] L3-L7 链路 E2E 测试通过(acquire/写/心跳/超时/接管)
- [ ] 用户场景测试:Claude 在 60s 内生成 10-20 节点的思维导图
- [ ] 用户能一键接管
- [ ] Cmd+Z 一次撤销单次操作(undo 整合在 Phase 3,这里只保证单次撤销工作)
- [ ] 互斥锁压力测试(10 并发 acquire 只成功 1 个)
- [ ] TTL 超时准确(±2s)
- [ ] 在 `feature/mcp-server` 分支上打 tag:`git tag mcp-phase-2`

**No-Go 信号**:
- ❌ 死锁或漏锁
- ❌ 用户中断不生效
- ❌ 用户测试"50%+ 操作需要撤销"(AI 能力问题,非架构)

### 7.3 Phase 3 验收(合并到 main + 打 v0.2.0-mcp)

**前提**:Phase 3 所有任务已 commit。

**验收项**:

- [ ] 全量测试 + Phase 3 新增 ≥ 30 个测试全过
- [ ] 功能点覆盖率(全部 30 个)= 100%
- [ ] L8 undo 链路 E2E 测试通过
- [ ] 整段 undo 工作(LLM 会话 5 次操作,Cmd+Z 一次全撤)
- [ ] 3 个 Prompts 模板都能用
- [ ] attach_file tool 跟现有 attach_file_to_node 行为一致
- [ ] 设置面板能切换 MCP 开关 + 改端口
- [ ] 真实用户测试:3-5 人,每人 30 分钟,收集反馈
- [ ] 开 PR `feature/mcp-server` → `main`,CI 全绿 + code review 通过
- [ ] squash merge 到 main
- [ ] 在 main 上打 tag:`git tag v0.2.0-mcp`
- [ ] GitHub Release v0.2.0 发布(带新图标 .dmg + MCP 功能)

**No-Go 信号**:
- ❌ 真实用户 1-2 次就不用(产品价值假设失败)
- ❌ LLM 操作 30s+ 才生效(性能问题)

---

## 8. CI/CD(GitHub Actions)

### 8.1 Workflow 文件

`.github/workflows/mcp-ci.yml`:

```yaml
name: MCP CI

on:
  push:
    branches: [main, feature/mcp-p*]
  pull_request:
    branches: [main]

jobs:
  frontend-test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run test:fe -- --coverage
      - run: npx covdir merge --threshold 0.95
  
  rust-test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cd src-tauri && cargo test --lib
      - run: cd src-tauri && cargo tarpaulin --out lcov --threshold 95
  
  e2e-test:
    runs-on: macos-latest
    needs: [frontend-test, rust-test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run tauri build
      - run: node e2e/run-all.js
  
  coverage-gate:
    needs: [frontend-test, rust-test, e2e-test]
    runs-on: ubuntu-latest
    steps:
      - run: |
          # 检查 feature-coverage.yaml + flow-coverage.yaml
          node scripts/check-coverage.js
          # 失败则阻止合并
```

### 8.2 PR 合并规则

- 必须 CI 全绿
- 必须 code review(approve)
- 必须 ≥ 95% 覆盖率
- 不允许 force push 后绕过 CI

---

## 9. 本地工程纪律

### 9.1 pre-commit hook(轻量,提交前)

```bash
# .husky/pre-commit
npx lint-staged   # 只检查暂存文件
```

检查项:
- 类型检查(`tsc --noEmit`)
- lint(eslint)
- 格式化(prettier)

### 9.2 pre-push hook(重量,push 前,只对 feature/mcp-server 生效)

```bash
# .husky/pre-push
# 只在 feature/mcp-server 分支强制跑全量,其他分支跳过
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "feature/mcp-server" ]; then
  echo "[pre-push] 在 MCP 功能分支,跑全量测试..."
  npm run test:fe
  cd src-tauri && cargo test --lib && cd ..
  node scripts/check-coverage.js
fi
```

如果失败,push 被拒绝。

### 9.3 提交前 Checklist(开发者自查)

- [ ] 我的代码通过 `tsc --noEmit`
- [ ] 我加了对应测试(新功能点必须有测试)
- [ ] 我跑了全量测试无回归
- [ ] 我的 commit message 符合 conventional commits
- [ ] 我确认在 `feature/mcp-server` 分支(不在 main)
- [ ] 我更新了 `feature-coverage.yaml`(新增功能点)

---

## 10. 进度跟踪

### 10.1 GitHub Projects 看板

创建 `MindMap MCP` project,列:
- `Backlog`:所有任务
- `In Progress`:正在做
- `Review`:PR 阶段
- `Done`:已合并 main

### 10.2 Issue 模板

每个任务开 Issue,标签:
- `phase-1` / `phase-2` / `phase-3`
- `mcp`
- `feature` / `test` / `docs`

### 10.3 里程碑

| 里程碑 | 触发条件 | 标记 |
|--------|---------|------|
| M1 | Phase 1 完成 | git tag `mcp-phase-1` |
| M2 | Phase 2 完成 | git tag `mcp-phase-2` |
| M3 | Phase 3 完成 | git tag `v0.2.0-mcp` + GitHub Release |

---

## 11. 风险与缓解(任务级)

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| axum + Tauri 集成卡壳 | 中 | 高 | Phase 1 T2 先做 PoC,失败则换 hyper |
| mind-elixir API 不够用 | 低 | 高 | Phase 1 已验证,有 addChild/reshapeNode 够用 |
| 互斥锁死锁 | 中 | 高 | Phase 2 T1 加压力测试,10 并发 acquire |
| TTL task 内存泄漏 | 低 | 中 | 用 weak ref + drop 时清理 |
| E2E 测试 flaky | 高 | 中 | retry 机制 + 超时容忍 ±2s |
| 覆盖率工具误报 | 中 | 低 | feature-coverage.yaml 手动维护,不依赖代码覆盖 |
| Claude Desktop 协议变更 | 低 | 中 | 跟 MCP spec 对齐,不绑特定客户端 |
| 性能(LLM 操作延迟 > 500ms) | 中 | 高 | Phase 2 加性能基准,超 500ms 报警 |

---

## 12. 启动条件检查清单

**进 Phase 1 实施前必须确认**:

- [ ] `docs/mcp-overview.md` 已 review
- [ ] `docs/mcp-architecture.md` v1.1 已 review
- [ ] 本文档(`docs/mcp-dev-plan.md`)已 review
- [ ] main 分支已加保护规则(不准直接 push)
- [ ] 3 份文档已 commit 到 main
- [ ] `feature-coverage.yaml` 骨架已建(在 main)
- [ ] pre-commit / pre-push hook 已配
- [ ] CI workflow 已配
- [ ] **从 main 拉 `feature/mcp-server` 分支并 push 到 GitHub**

**确认完毕 → 在 `feature/mcp-server` 开始 P1-T1**。

---

## 13. 文档维护

本文档是**活文档**,实施过程中如发现:
- 任务拆分不合理 → 调整 WBS
- 新功能点 → 加到清单
- 新链路 → 加到链路清单
- 工具不适用 → 调整测试体系

**每次调整都 commit 到 main**(走 PR 流程),保留变更历史。

---

**下一步**:等你 review 这份规划,确认或提出修改。OK 后我开始:
1. 把 3 份文档(mcp-overview / mcp-architecture / mcp-dev-plan)一起 commit 到 main
2. 配 main 分支保护 + GitHub Project
3. 拉 `feature/mcp-p1-protocol` 开始 Phase 1 T1
