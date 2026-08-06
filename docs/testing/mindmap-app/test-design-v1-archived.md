# mindmap-app 测试设计

## 结论与就绪状态

- **档位**:`critical`(数据不可逆 + 并发一致性 + 权限 + 关键用户旅程 + 发布门禁)
- **就绪状态**:`ready`
- **设计门**:`draft`(`approval_required_before_implementation: true`)
- **顶层风险**(必须先关闭):
  1. MCP 写链路真实 Tauri 模式下"emit 成功但数据不变"(已发现 4 个,可能还有)
  2. EditorMode Mutex 死锁或漏锁(LLM 与用户同时编辑)
  3. 自动保存 `markSaved` 覆盖 invoke 期间新改动(历史 bug 已修但未充分覆盖)
  4. 附件 `attached_file` 在 mind-elixir 同步链路丢失(历史 bug 已修)
  5. 真实人类操作下接管按钮无效(LLM session 不释放)

## 需求基线、假设与关键未知

### 已确认事实(来自代码 + 文档 + 历史 commit)

- `F-001` 思维导图核心:Tab 加子 / Enter 加兄 / F2 编辑 / Delete 删除 / 拖拽 / Cmd+. 折叠
- `F-002` 优先级 P0/P1/P2/P3 通过 `me-tpc.priority-pN` class + `::before` 图标
- `F-003` 提醒系统:创建/编辑/删除,30s 后台轮询,沙漏图标(future/looming/due/done/paused)
- `F-004` 附件 8 类型(image/pdf/slide/doc/sheet/video/audio/other),类型色边框 + 扩展名角标
- `F-005` 导入导出:Markdown / OPML / PNG / SVG / Freemind
- `F-006` 多窗口:每文档独立窗口,子窗口 destroy,主窗口 hide 到托盘
- `F-007` MCP 14 个 tool + EditorMode Mutex + TTL 60s 默认 + 接管按钮
- `F-008` 自动保存:2s 防抖,`markSaved` 用引用比较避免覆盖 invoke 期间改动
- `F-009` mind-elixir `reshapeNode` 有 bug(Object.assign 到 DOM 不是 nodeObj)— 已绕过
- `F-010` `findEle` 在节点 collapsed 时 throw,所有调用需 try/catch
- `F-011` `addChild` 传对象时不调 `generateNewObj`,必须手动生成 id
- `F-012` McpBridge 必须用 content JSON hash 做 sig(子节点 topic 变化要触发推送)

### 推导

- `D-001` 由 `F-007 + F-009 + F-010 + F-011 + F-012`:LLM 写链路在真实 Tauri 模式下需要端到端验证,不能只信单元测试
- `D-002` 由 `F-008`:自动保存的 race condition 是历史 bug 来源,必须保留 `引用比较` 用例

### 假设

- `A-001` 假设 Tauri 2 macOS 26 (Tahoe) + Sequoia 下,WKWebView 行为跟 Chrome 一致(可能不成立 — 历史上 dev 白屏就是这样出现的)
- `A-002` 假设 mind-elixir 5.14 是稳定依赖,不引入新 bug

### 关键未知

- `U-001` mind-elixir `reshapeNode` 的 bug 是否影响 priority/icons/style 等非 topic 字段(只确认了 topic)
- `U-002` MCP TTL 后台 task 在 app 关闭时是否会泄漏(L1 不易测)
- `U-003` 多窗口同时打开同一 `.mmap` 文件时,save_mmap 是否会互相覆盖(没有锁文件机制)

## 范围和受保护价值

### 受保护价值(必须保证不破坏)

| ID | 价值 | 破坏后果 |
|----|------|---------|
| `PV-001` | 用户思维导图数据不丢失 | 用户思考成果消失,信任崩塌 |
| `PV-002` | LLM 与人不能同时编辑 | 数据冲突 / 互相覆盖 |
| `PV-003` | MCP 写操作真实生效(不只 emit) | LLM 自以为完成,实际数据未变 |
| `PV-004` | 自动保存的修改能被重开看到 | "保存了但没了" |
| `PV-005` | 接管按钮真能中断 LLM | 用户失去控制感 |
| `PV-006` | 附件 attached_file 在 Tab 加子节点时不丢 | 老 bug 复发 |
| `PV-007` | MCP 协议合规(JSON-RPC 2.0) | Claude Desktop 等客户端拒绝连接 |
| `PV-008` | 多窗口子窗口关闭不卡 CloseRequested 死循环 | 用户只能 kill 进程 |

### 范围内(`scope_in`)

- L1 单元:工具函数、Rust 命令、协议层、adapter、EditorMode 状态机
- L2 业务流程:MCP CRUD 完整链路、自动保存 race、附件持久化、多窗口生命周期
- L3 真实操作:LLM 接管交互、Tab 加子节点、附件附加、偏好设置

### 范围外(`scope_out`)

- 跨设备 LLM 接入(只本机 loopback)
- 多 LLM 客户端并发(plan 提过但未实现)
- Homebrew 分发 / Apple 公证(工程基础设施)
- 性能/压力测试(节点数 > 1000)
- 国际化(i18n)

## 三层测试策略

| 层级 | 处置 | 主责范围 | 不重复理由 |
|------|------|---------|----------|
| `L1` | `cases` | 单元规则:协议、EditorMode 状态机、adapter、reminder 状态计算、附件类型识别 | L2/L3 重复同一规则时下沉 |
| `L2` | `cases` | 业务流程:MCP CRUD 真实链路、自动保存 race、save_mmap 原子写、多窗口生命周期 | L1 不能验证"端到端真生效",L3 不能验证"原子写 + 备份" |
| `L3` | `cases` | 真实操作:接管按钮、附件附加、偏好设置、画布锁定 | L1/L2 不能验证"用户可见状态变化" |

## 业务流程模型

### FLOW-MCP-WRITE(LLM 写链路,最关键)

```
N-LLM-REQUEST(收到 LLM tool call)
  → E-GUARD[守卫:require_llm_session] → N-GUARD-PASS / T-REJECT-NO-SESSION
  → E-EMIT[emit llm-operation Tauri event]
  → E-FRONTEND-BRIDGE[前端 operationBridge.listen]
  → E-APPLY-OP[applyOperation:parent_id "root" 自动转换 + findEle + addChild/reshapeNode]
  → E-MIND-ELIXIR-FIRE[mind-elixir fire "operation"]
  → E-SYNC[syncFromMindElixir → setContent]
  → E-STORE-SUB[mcpBridge.subscribe]
  → E-MIRROR-PUSH[invoke mcp_update_state]
  → T-WRITE-SUCCESS[search/read_mindmap 能找到新节点]

副作用:
  SE-MARK-DIRTY[store.dirty=true → useAutoSave 防抖 2s]
  SE-AUTO-SAVE[save_mmap 写盘]
  SE-AUDIT-LOG[llm-audit.jsonl 写入]

恢复终态:
  T-LLM-RELEASE[LLM 调 release_session → editor=Human → banner 消失]
  T-USER-TAKEOVER[用户点接管 → force_release → 同上]
  T-TTL-EXPIRE[60s 无心跳 → 后台 task 自动 release]
```

### FLOW-AUTO-SAVE(自动保存)

```
N-USER-EDIT[用户改 topic]
  → E-MIND-ELIXIR-FIRE-OP[fire "operation"]
  → E-SYNC-BACK[syncFromMindElixir → setContent → markDirty]
  → E-DEBOUNCE[2s 防抖]
  → E-INVOKE-SAVE[invoke save_mmap(content_ref)]
  → (期间)E-USER-EDIT2[用户继续改 → markDirty=true]
  → E-SAVE-COMPLETE[invoke 返回]
  → E-CONDITIONAL-MARK[if store.content === content_ref → markSaved; else 保留 dirty]
  → T-SAVED[dirty=false,磁盘已写]
```

### FLOW-ATTACH-FILE(附件附加)

```
N-NODE-SELECTED[选中节点]
  → E-USER-CLICK-ATTACH[点附件图标]
  → E-GUARD[filePath 存在?]
  → E-OPEN-DIALOG[弹文件选择器]
  → E-INVOKE-ATTACH[invoke attach_file_to_node]
  → E-BACKEND-COPY[后端复制到 assets/{uuid}.{ext}]
  → E-BACKEND-THUMBNAIL[生成缩略图]
  → E-BACKEND-SAVE[save mmap content.json]
  → E-FRONTEND-UPDATE[updateContent 把 attached_file 写入 store]
  → E-RESHAPE[reshapeNode 设固定 80×80]
  → T-ATTACH-SUCCESS[画布显示缩略图 + 类型色边框 + 扩展名角标]
```

### FLOW-MULTI-WINDOW(多窗口子窗口关闭)

```
N-USER-CLOSE[点子窗口关闭按钮]
  → E-PREVENT-CLOSE[api.prevent_close]
  → E-ASYNC-DESTROY[std::thread::spawn → destroy]
  → T-WINDOW-DESTROYED[窗口真销毁,资源释放]
```

## 风险链与验证命题

### 风险链 1:LLM 写操作"假成功"

```
PV-003(LLM 写真实生效)
  → 暴露在 applyOperation
  → 触发条件:parent_id="root" / mind.addChild 不生成 id / reshapeNode bug
  → 失败机制:emit 成功但 mind-elixir nodeData 没变 → store.content 不变 → mirror 不推送
  → 不利状态:LLM 报告"创建成功"但实际什么都没发生
  → 证据:read_mindmap 拿不到新节点 / search_nodes 0 匹配
```

**验证命题**:`VP-MCP-WRITE-REAL`
- 上下文:LLM 持有 session,文档已保存
- 刺激:create_node(parent_id="root", topic="测试")
- 预期:`search_nodes` 在 3s 内能找到该节点
- 不变量:`audit_log` 有记录 + `mirror.current_content` 有新节点

### 风险链 2:EditorMode 死锁/漏锁

```
PV-002(互斥)
  → 暴露在 EditorMode Mutex + TTL task
  → 触发条件:并发 acquire / TTL 过期时刚好新 acquire
  → 失败机制:RwLock 持有过期 / require_llm_session 检查后 TTL 到期
  → 不利状态:两个 LLM 都认为持锁 / 用户接管后 LLM 仍能写
  → 证据:get_edit_state 不一致
```

**验证命题**:`VP-MUTEX`
- 上下文:Human 状态
- 刺激:10 并发 acquire_session
- 预期:恰好 1 个成功,9 个被拒
- 不变量:`editor.current()` 任意时刻最多一个 Llm session

### 风险链 3:自动保存覆盖 invoke 期间改动

```
PV-004(自动保存可重开)
  → 暴露在 handleSave + useAutoSave
  → 触发条件:invoke save_mmap 期间用户继续编辑
  → 失败机制:markSaved 无条件 set dirty=false
  → 不利状态:用户后续改动被误标已保存 → 重开丢失
  → 证据:重开后 store.content 跟磁盘不一致
```

**验证命题**:`VP-AUTOSAVE-RACE`
- 上下文:dirty=true,有 filePath
- 刺激:invoke 期间 setContent(新 content V2)
- 预期:invoke 完成后 `dirty=true` 保留(useAutoSave 会再次保存 V2)
- 不变量:`store.content === V2` 时 `dirty=false`,`store.content !== V2` 时 `dirty=true`

### 风险链 4:附件 Tab 后丢失

```
PV-006(附件持久)
  → 暴露在 mindElixirAdapter
  → 触发条件:attach 后按 Tab 加子节点 → syncFromMindElixir 触发
  → 失败机制:fromMindElixirNode 不读 attached_file
  → 不利状态:节点 attached_file 变 undefined → 画布缩略图消失
  → 证据:read_mindmap 节点 attached_file=null
```

**验证命题**:`VP-ATTACH-PERSIST`
- 上下文:节点 A 有 attached_file
- 刺激:Tab 在 A 下加子节点(触发 syncFromMindElixir)
- 预期:之后 A 的 attached_file 仍在
- 不变量:fromMindElixirData 必须从 prevContent 继承 attached_file

### 风险链 5:子窗口关闭死循环

```
PV-008(多窗口可用)
  → 暴露在 handle_window_event CloseRequested
  → 触发条件:macOS 26 Tahoe 默认 close 流程卡住
  → 失败机制:CloseRequested 无限触发
  → 不利状态:CPU 100% / 大量日志
  → 证据:CloseRequested log 重复 > 5 次
```

**验证命题**:`VP-MULTIWINDOW-CLOSE`
- 上下文:子窗口存在
- 刺激:点关闭按钮
- 预期:CloseRequested log 出现 1-2 次,然后 Destroyed
- 不变量:destroy 后窗口真销毁

## 覆盖义务矩阵

| Obligation | 来源 | 主责层 | 状态 | 用例 |
|-----------|------|--------|------|------|
| OB-001 MCP 协议合规(JSON-RPC) | F-007 | L1 | designed | TC-L1-001..010 |
| OB-002 EditorMode 状态机 | F-007 | L1 | designed | TC-L1-011..020 |
| OB-003 TTL 自动释放 | F-007 | L1+L2 | designed | TC-L1-021, TC-L2-001 |
| OB-004 14 个 tool 正确性 | F-007 | L1 | designed | TC-L1-022..040 |
| OB-005 MCP CRUD 真实链路 | VP-MCP-WRITE-REAL | L2 | designed | TC-L2-002..010 |
| OB-006 acquire/release 互斥 | VP-MUTEX | L1+L2 | designed | TC-L1-011..020, TC-L2-011 |
| OB-007 自动保存 race | VP-AUTOSAVE-RACE | L1+L2 | designed | TC-L1-041, TC-L2-012 |
| OB-008 save_mmap 原子写 + 备份 | F-008 | L1 | designed | TC-L1-042..044 |
| OB-009 adapter 双向同步 | F-009,F-010,F-011,F-012 | L1 | designed | TC-L1-045..050 |
| OB-010 attached_file 继承 | VP-ATTACH-PERSIST | L1 | designed | TC-L1-051,052 |
| OB-011 节点 CRUD(Tab/Enter/F2/Del) | F-001 | L1+L3 | designed | TC-L1-053..056, TC-L3-001 |
| OB-012 优先级 P0-P3 + class | F-002 | L1 | designed | TC-L1-057..060 |
| OB-013 提醒系统 | F-003 | L1+L2 | designed | TC-L1-061..065, TC-L2-013 |
| OB-014 附件 8 类型 + 类型色 | F-004 | L1+L3 | designed | TC-L1-066..070, TC-L3-002 |
| OB-015 导入导出 | F-005 | L1 | designed | TC-L1-071..075 |
| OB-016 多窗口关闭 | VP-MULTIWINDOW-CLOSE | L2+L3 | designed | TC-L2-014, TC-L3-003 |
| OB-017 接管按钮 | PV-005 | L2+L3 | designed | TC-L2-015, TC-L3-004 |
| OB-018 TTL task 退出时清理 | U-002 | L2 | conditional | (无入口测试) |
| OB-019 同文件多窗口冲突 | U-003 | L2 | conditional | (无机制) |

## 测试用例摘要

### L1 单元(60 个)

| ID | 类别 | 优先级 | 目标 | 入口 |
|----|------|--------|------|------|
| TC-L1-001..010 | positive/negative | critical | JSON-RPC 协议(initialize/tools/call/resources/error codes) | `src-tauri/src/mcp/protocol.rs` 已有 |
| TC-L1-011..020 | positive/negative/risk | critical | EditorMode Mutex 状态机 + 并发 acquire | `editor_mode.rs` 已有 |
| TC-L1-021 | risk | critical | TTL 自动释放 | `session.rs` 已有 |
| TC-L1-022..040 | positive/negative | high | 14 个 tool 参数校验 + emit | `tools_*.rs` 已有 |
| TC-L1-041 | risk | critical | markSaved 引用比较 | `useAutoSave.test.ts` 已有 |
| TC-L1-042..044 | positive/risk | critical | save_mmap 原子写 + .bak 备份 + 失败回滚 | `mmap.rs` 已有 |
| TC-L1-045..050 | positive/negative | critical | adapter 双向同步 + attached_file 继承 | `mindElixirAdapter.test.ts` 已有 |
| TC-L1-051..052 | positive/risk | critical | attached_file 在 Tab 后保留 / 删除时清理 | `mindElixirAdapter.test.ts` 已有 |
| TC-L1-053..056 | positive | high | 节点 CRUD 规则(Tab/Enter/F2/Del) | `nodeActions.test.ts` 已有 |
| TC-L1-057..060 | positive | high | 优先级 P0-P3 设置/清除 + DOM class | `TabProperties.test.tsx` 已有 |
| TC-L1-061..065 | positive/risk | high | 提醒状态计算(future/looming/due/done/paused) | `reminderState.test.ts` 已有 |
| TC-L1-066..070 | positive | normal | 附件类型识别 + 类型色映射 | 已有 + 新增 |
| TC-L1-071..075 | positive/negative | normal | 导出 markdown/opml/mermaid + 导入 | `markdown/opml.rs` 已有 |

### L2 业务流程(15 个)

| ID | 类别 | flow_id | 目标 | 状态 |
|----|------|---------|------|------|
| TC-L2-001 | risk | FLOW-MCP-WRITE | TTL 后台 task 自动 release + emit event | 新增 |
| TC-L2-002 | positive | FLOW-MCP-WRITE | create_node 真实链路(emit→bridge→mind→store→mirror→search 找到) | 已有(scripts/verify-mcp-live.sh) |
| TC-L2-003 | positive | FLOW-MCP-WRITE | update_node 真实链路(改名后 search 找到新名) | 已有(诊断时验证) |
| TC-L2-004 | positive | FLOW-MCP-WRITE | delete_node 真实链路 | 已有 |
| TC-L2-005 | positive | FLOW-MCP-WRITE | move_node 真实链路 | 新增 |
| TC-L2-006 | negative | FLOW-MCP-WRITE | 无 session 时 create_node 被拒 | 已有 |
| TC-L2-007 | risk | FLOW-MCP-WRITE | parent_id="root" 自动转 UUID(LLM 不知道真实 id) | 已有(诊断用例) |
| TC-L2-008 | risk | FLOW-MCP-WRITE | mcpBridge sig 用 content hash(子节点 topic 变化触发推送) | 新增 |
| TC-L2-009 | risk | FLOW-MCP-WRITE | attach_file 走 attach_file_to_node + updateContent | 新增 |
| TC-L2-010 | risk | FLOW-MCP-WRITE | reshapeNode bug 绕过(直接改 nodeObj) | 新增 |
| TC-L2-011 | risk | FLOW-MCP-WRITE | 10 并发 acquire 只 1 个成功 | 已有(unit test) |
| TC-L2-012 | risk | FLOW-AUTO-SAVE | invoke 期间新改动 dirty 保留 | 已有(unit test) |
| TC-L2-013 | positive | (提醒流程) | 提醒触发系统通知 + 沙漏渲染 | 新增 |
| TC-L2-014 | risk | FLOW-MULTI-WINDOW | 子窗口关闭不死循环 | 新增 |
| TC-L2-015 | positive | FLOW-MCP-WRITE | 用户接管按钮 force_release + banner 消失 | 已有 |

### L3 模拟人类操作(4 个)

| ID | 类别 | 目标 | 工具 |
|----|------|------|------|
| TC-L3-001 | positive | 真实键盘操作 Tab 加子节点 → DOM 出现新 tpc | chrome-devtools MCP |
| TC-L3-002 | positive | 点附件图标 → 画布显示缩略图 + 类型色边框 + 角标 | chrome-devtools MCP |
| TC-L3-003 | positive | 多窗口关闭按钮 → Destroyed | 手动 + 日志 |
| TC-L3-004 | positive/risk | acquire → LLM banner 显示 → 点接管 → banner 消失 + canvas 解锁 | chrome-devtools MCP |

## 自动调用与回归计划

### 运行档位分配

| 档位 | 触发 | 用例集 |
|------|------|-------|
| `local` | 开发者本地 | 全部 L1 + 关键 L2 |
| `pr` | GitHub Actions PR | 全部 L1 + 全部 L2 |
| `scheduled` | 每日 cron | 全部 L1 + L2 + L3 |
| `release` | tag push | 全部 + verify-mcp-live.sh |
| `post_deploy` | 装好 app 后 | TC-L3-001..004 + verify-mcp-live.sh |
| `exploration` | Agent 探索 | L3 exploration 用例 |

### 数据环境

- 单元测试:`MINDMAP_TEST_DATA_DIR` 环境变量隔离(AppState::new_in_memory 已支持)
- L2 真实链路:启动 dev app,curl 测试,不污染用户数据(用临时 mmap)
- L3 浏览器:启动 vite,clean state,测试完不持久化

### 证据要求

- L1:vitest / cargo test 输出 + 覆盖率报告
- L2:`scripts/verify-mcp-live.sh` 输出 + `audit_log.jsonl` 摘录
- L3:chrome-devtools 截图 + DOM snapshot + console log

## 未覆盖项、剩余风险与停止判断

### 未覆盖(显式标记)

| 项 | 原因 | 责任人 |
|---|------|-------|
| OB-018 TTL task app 退出清理 | U-002,无入口测试 | 待评估 |
| OB-019 同文件多窗口冲突 | U-003,无锁文件机制 | 待评估 |
| `U-001` reshapeNode 对非 topic 字段影响 | 需要进一步 PoC | 待评估 |
| Apple 公证 + Homebrew 分发 | 工程基础设施,非测试范畴 | 待决定 |

### 剩余风险

1. **macOS 26 Tahoe webview 行为差异**:Tauri WKWebView 跟 Chrome 行为不完全一致(历史已出过白屏 bug)。L3 用 chrome-devtools 测试不能完全覆盖 Tauri webview,需要真机验证
2. **mind-elixir 5.14 依赖稳定性**:如果未来升级,可能引入新 bug(`reshapeNode`/`findEle`/`addChild` 的具体行为可能变)
3. **MCP 协议版本演进**:当前用 `2024-11-05`,如果 MCP spec 更新,需要同步

### 停止判断

`conditional_complete` — 已识别的关键需求、风险、流程都有用例或显式条件/阻断。`U-001`~`U-003` 必须在下次评审时关闭或显式接受。

## 设计审批

- **当前状态**:`draft`
- **下一步**:用户评审 → 改为 `approved` → 进入实施阶段(写测试代码 + 跑测试)
- **审批要求**:
  1. 确认 19 个覆盖义务清单完整(无遗漏关键需求)
  2. 确认 5 个风险链对应的受保护价值正确
  3. 确认剩余风险接受 / 仍要关闭
  4. 确认 L3 4 个用例的工具(chrome-devtools MCP)和入口
