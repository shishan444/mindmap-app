# mindmap-app 测试设计 v2（重构草稿）

> 本文档由 design-test-cases skill 工作流从需求世界重新推导。
> 与 v1（`mindmap-app/docs/testing/mindmap-app/test-design.md`）的差异对账见 `reconcile-matrix.md`。
> v1 已知缺口：OB-016 实施缺失、Bug 回归不完整、L3 未自动化、F-010/F-012 缺单元守卫。

## 结论与就绪状态

- **档位**: `critical`（数据不可逆 + LLM 写链路 + 互斥 + 多窗口 + 发布门禁）
- **就绪状态**: `ready`
- **设计门**: `draft`（等差异对账后转 `approved`）
- **重构动机**: 修复 v1 元审计识别的"对账机制缺失"根因，把每个 OB/VP/F 双向追溯到测试文件:行号。

## 需求基线、假设与关键未知

### 已确认事实（来自 README + 源码 + commit log）

#### A. 数据可靠性
- `F-A1` `.mmap` 是 macOS Package 目录:meta.json + content.json + content.json.bak + assets/ + thumbnails/
- `F-A2` save 原子写:.tmp → fsync → 备份原 content.json → rename .tmp → 写 meta
- `F-A3` handleSave + useAutoSave 用引用比较 `store.content === contentRefAtInvokeStart` 判断 markSaved 安全
- `F-A4` 自动保存防抖 N 秒（默认 2s，可配置），savingRef 防重入
- `F-A5` invoke 期间新改动 → needsReschedule=true，finally 后主动重新调度（防数据丢失）

#### B. 节点编辑
- `F-B1` 键盘:Tab 加子 / Enter 加兄 / F2 编辑 / Delete 删除 / Cmd+. 折叠
- `F-B2` 拖拽重排（吸附式 before/after/in）
- `F-B3` 节点样式:字号/文字色/背景色/粗体下划线/边框/自定义宽度
- `F-B4` 节点图标:Lucide 矢量库，4 大类分组
- `F-B5` 优先级 P0-P3 通过 `me-tpc.priority-pN` CSS class + `::before` 图标，再次点击清除
- `F-B6` store ↔ mind-elixir nodeObj 扩展字段双向同步（syncToMindNodeObj，防 priority/note/reminder_ids/style 在 selectNode 触发 syncFromMindElixir 时被 undefined 覆盖）

#### C. 附件
- `F-C1` 8 类型识别（image/pdf/slide/doc/sheet/video/audio/other）+ 类型色映射 + 扩展名角标
- `F-C2` attach 流程:openDialog → invoke attach_file_to_node → 后端复制到 assets/{uuid}.{ext} → QL 生成缩略图 → save mmap → 前端 updateContent
- `F-C3` attached_file 在 mind-elixir 同步链路保留:fromMindElixirData 从 prevContent 按 id 索引继承
- `F-C4` remove_attached_file 同步删 assets + thumbnails
- `F-C5` 双击附件节点 → 系统默认工具打开（open_attached_file）

#### D. 提醒
- `F-D1` 节点级提醒:单次 / 重复
- `F-D2` 沙漏状态机:future（蓝）/ looming（橙）/ due（红闪烁）/ done（灰）/ paused
- `F-D3` 系统通知 + 应用内 Toast，Toast 点击跳转到对应节点
- `F-D4` 后台调度器 reminder_scheduler.rs，30s 轮询，**只主窗口启动**
- `F-D5` 启动时自动清理测试残留 reminder（filter_test_reminders + polluted-backup）

#### E. 多窗口
- `F-E1` 每文档独立窗口（label=main / doc-N），URL 参数决定加载模式
- `F-E2` URL `?mode=open&mmap=/path` 或 `?mode=new`，main 无参时恢复 last_opened_file
- `F-E3` 子窗口关闭三重保险:Rust 全局 on_window_event prevent + spawn destroy / 前端 onCloseRequested prevent + destroy / window.__forceCloseWindow 兜底
- `F-E4` 主窗口关闭 → hide 到托盘（应用常驻）
- `F-E5` 同文件多窗口冲突避免:openDialog 后 list_windows + focus_window 跳转已有窗口
- `F-E6` 单实例插件:外部二次启动 → 激活可见窗口 / 拖入 .mmap 在新窗口打开
- `F-E7` 托盘菜单 + 左键切换所有窗口显隐
- `F-E8` 多窗口 MCP / reminder scheduler 只主窗口启动（避免 N 倍并发）

#### F. 导入导出
- `F-F1` 导出 Markdown / OPML
- `F-F2` 导入 Markdown / OPML / FreeMind
- `F-F3` 导出 PNG（高清倍率）/ SVG（矢量）

#### G. MCP 协议
- `F-G1` JSON-RPC 2.0 over HTTP，loopback 127.0.0.1:port
- `F-G2` 6 个只读 tool:read_mindmap / search_nodes / get_node / list_reminders / export_mindmap / get_edit_state
- `F-G3` 3 个会话 tool:acquire_session / heartbeat / release_session
- `F-G4` 5 个写 tool:create_node / update_node / delete_node / move_node / attach_file
- `F-G5` 3 个 prompts 模板:expand_topic / from_meeting_notes / summarize_to_outline
- `F-G6` EditorMode RwLock<Editor>，Editor=Human|Llm{session_id, client_name, acquired_at_ms, ttl_ms}
- `F-G7` TTL 默认 60s，最大 300s（clamp），后台 1s 轮询 check_ttl_expiry
- `F-G8` 写 tool execute_op 共享流程:require_llm_session → 自动 heartbeat → emit llm-operation → record_operation
- `F-G9` 审计日志 llm-audit.jsonl（AuditLogger + MultiEmitter）

#### H. LLM 写链路
- `F-H1` parent_id="root" → 真实 root UUID 转换（LLM 不知道真实 id）
- `F-H2` addChild 必须手动生成 UUID（绕过 mind-elixir F-011 bug）
- `F-H3` update_node 直接 Object.assign nodeObj + 手动改 DOM textContent + fire operation（绕过 reshapeNode F-009 bug）
- `F-H4` attach_file op:前端调 attach_file_to_node command + updateContent + __syncAttachedFiles
- `F-H5` zundo pause/resume 整合:LLM 会话期间 pause，结束 resume（一次 Cmd+Z 撤销整个会话）
- `F-H6` mcpBridge sig 用 content JSON hash（首 50 + 尾 50 + filePath + reminders 长度 + session_id），子节点 topic 改名能触发推送
- `F-H7` mcpBridge llmSession 变化时立即推（delay=0），其他变化 1s 防抖
- `F-H8` force_release 逃生舱:UI 接管按钮无视 session_id，总是成功

#### I. 撤销重做
- `F-I1` zustand + zundo，partialize 只跟 content + selectedNodeId
- `F-I2` 50 步历史限制
- `F-I3` equality 用引用比较（pastState.content === currentState.content）
- `F-I4` undo/redo 后 needStoreToMindSync=true，触发 store→mind 反向同步
- `F-I5` 全局快捷键:Cmd+Z 撤销 / Cmd+Shift+Z 重做 / Cmd+Y 重做

#### J. 开发模式
- `F-J1` 浏览器模式优雅降级:isTauri() 守卫所有 IPC 入口，warnBrowserModeOnce 提示一次
- `F-J2` dev_logger JSONL 日志（仅 dev + Tauri 模式）
- `F-J3` dev 模式自动打开 DevTools（debug_assertions）
- `F-J4` __echo 诊断 command（Rust stdout 反馈）
- `F-J5` window.__store / window.__forceCloseWindow / window.__syncHourglasses / window.__syncAttachedFiles 调试钩子

### 推导
- `D-1` 由 `F-A3 + F-A5`:markSaved 安全 + needsReschedule 是同一 race 的两道闸，必须同时覆盖
- `D-2` 由 `F-E3`:子窗口关闭是三重保险，每重都必须独立可验证（任一失效不应导致整体失效）
- `D-3` 由 `F-G6 + F-G7 + F-H8`:EditorMode 是 LLM 写链路的唯一权威，前端 banner 只是 UI 反馈
- `D-4` 由 `F-H2 + F-H3 + F-B6`:mind-elixir 的 3 个 bug 是 LLM 写链路的固有风险，每次升级 mind-elixir 都需要重新验证绕过逻辑
- `D-5` 由 `F-D4 + F-E8`:多窗口模式下"只主窗口启动"是关键不变量，否则 N 倍并发

### 假设
- `A-1` Tauri 2 + macOS 26 Tahoe WKWebView 行为跟 Chrome 一致（历史上 dev 白屏出过此问题）
- `A-2` mind-elixir 5.14 稳定，不引入新 bug（每次升级需要重新验证 F-H2/H3/B6 绕过）
- `A-3` MCP 客户端（Claude Desktop）遵循 JSON-RPC 2.0 + MCP 2024-11-05 协议

### 关键未知
- `U-1` reshapeNode 对非 topic 字段（priority/icons/style）的影响（v1 U-001 遗留）
- `U-2` MCP TTL 后台 task 在 app 退出时是否会泄漏（lib.rs 无 cleanup hook，依赖 tokio runtime drop）
- `U-3` 同文件多窗口冲突只有"激活已有窗口"的弱保护，没有锁文件机制（v1 U-003 遗留）
- `U-4` filter_test_reminders 是否可能误清理真实 reminder（依赖 source_file 路径匹配，规则未文档化）
- `U-5` commit `7022507` "3 个用户报告的 bug" 具体内容未在 commit body 详述，可能存在未覆盖回归

## 范围和受保护价值

### 受保护价值

| ID | 价值 | 破坏后果 | 来源 |
|----|------|---------|------|
| `PV-001` | 用户数据不丢失 | 信任崩塌 | README 设计理念 1 |
| `PV-002` | LLM 与人不能同时编辑 | 数据冲突 / 互相覆盖 | F-G6 |
| `PV-003` | LLM 写操作真实生效（不只 emit） | LLM 假成功，实际数据未变 | F-G8 + F-H1..H4 |
| `PV-004` | 自动保存的修改能被重开看到 | "保存了但没了" | F-A1..A5 |
| `PV-005` | 接管按钮真能中断 LLM | 用户失去控制感 | F-H8 |
| `PV-006` | attached_file 在 Tab 加子节点时不丢 | 老 bug 7d20f7b 复发 | F-C3 |
| `PV-007` | MCP 协议合规 | Claude Desktop 拒绝连接 | F-G1 |
| `PV-008` | 多窗口子窗口关闭不死循环 | 用户只能 kill 进程 | F-E3 + 4886a58 |
| `PV-009` | 撤销重做跨 LLM 会话语义正确 | 用户撤销丢失或过度 | F-H5 |
| `PV-010` | 测试残留数据不污染生产 reminder | 真实提醒被屏蔽或污染 | F-D5 |
| `PV-011` | 多窗口下后台任务只启动一份 | N 倍并发 / 重复通知 | F-D4 + F-E8 |
| `PV-012` | 浏览器模式不刷 IPC 错误刷屏 | dev 体验差 | F-J1 + 681713e |

### 范围内 `scope_in`
- L1 单元:工具函数、Rust 命令、协议层、adapter、EditorMode/SessionRegistry 状态机、提醒状态计算、附件类型识别、filter_test_reminders
- L2 业务流程:MCP CRUD 完整链路、自动保存 race、附件持久化、多窗口生命周期、TTL task、审计日志、zundo pause/resume
- L3 真实操作:LLM 接管交互、Tab 加子节点、附件附加、偏好设置、多窗口关闭按钮

### 范围外 `scope_out`
- 跨设备 LLM 接入（只本机 loopback）
- 多 LLM 客户端并发（plan 提过但未实现）
- 性能/压力测试（节点数 > 1000）
- 国际化（i18n）
- Apple 公证 + Homebrew 分发（工程基础设施）
- 跨平台 Windows / Linux（README 待社区贡献）

## 三层测试策略

| 层级 | 处置 | 主责范围 | 不重复理由 |
|------|------|---------|----------|
| `L1` | `cases` | 单元规则:协议、EditorMode/SessionRegistry 状态机、adapter、reminder 状态计算、附件类型识别、filter_test_reminders、useAutoSave 引用比较、markSaved 引用比较 | L2/L3 重复同一规则时下沉 |
| `L2` | `cases` | 业务流程:MCP CRUD 真实链路（emit→bridge→mind→store→mirror→search）、自动保存 race、save_mmap 原子写、多窗口生命周期、TTL task、审计日志、zundo 整合、mcpBridge sig 哈希 | L1 不能验证"端到端真生效"，L3 不能验证"原子写 + 备份" |
| `L3` | `cases` | 真实操作:接管按钮、附件附加、偏好设置、画布锁定、多窗口关闭按钮 | L1/L2 不能验证"用户可见状态变化" |

## 业务流程模型

### FLOW-1 LLM 写链路（最关键）
```
N-LLM-CALL(LLM 调 create_node/update_node/...)
  → E-GUARD[require_llm_session]
  → E-AUTO-HEARTBEAT[刷新 TTL]
  → E-EMIT[emit llm-operation + 写 audit_log]
  → E-FRONTEND-BRIDGE[operationBridge.listen]
  → E-APPLY-OP[applyOperation:parent_id "root" 转换 + findEle try/catch + addChild 手动 UUID / reshapeNode 绕过 / removeNodes / moveNodeIn / attach_file_to_node]
  → E-MIND-ELIXIR-FIRE[fire "operation"]
  → E-SYNC[syncFromMindElixir → setContent → markDirty + attached_file prevContent 继承]
  → E-STORE-SUB[mcpBridge.subscribe → sig 哈希比较 → 防抖]
  → E-MIRROR-PUSH[invoke mcp_update_state]
  → T-WRITE-SUCCESS[search/read_mindmap 能找到新节点]

副作用:
  SE-MARK-DIRTY[dirty=true → useAutoSave 防抖]
  SE-AUTO-SAVE[save_mmap 原子写盘]
  SE-AUDIT-LOG[llm-audit.jsonl]
  SE-RECORD-OP[registry.record_operation]

恢复终态:
  T-LLM-RELEASE[release_session → editor=Human → banner 消失]
  T-USER-TAKEOVER[force_release → 同上]
  T-TTL-EXPIRE[TTL 后台 task 自动 release + emit llm-session-changed reason=expired]
```

### FLOW-2 自动保存（race 敏感）
```
N-USER-EDIT[用户改 topic]
  → E-MIND-ELIXIR-FIRE-OP
  → E-SYNC-BACK[syncFromMindElixir → setContent → markDirty]
  → E-DEBOUNCE[2s 防抖，savingRef 防重入]
  → E-INVOKE-SAVE[record contentRefAtInvokeStart + invoke save_mmap]
  → (期间)E-USER-EDIT2[用户继续改 → markDirty + 新 content 引用]
  → E-SAVE-COMPLETE[invoke 返回]
  → E-CONDITIONAL-MARK[after.content === contentRefAtInvokeStart ? markSaved : setSaveStatus("saved") + needsReschedule]
  → T-SAVED[dirty=false, 磁盘已写] 或 T-RESCHEDULE[dirty=true, scheduleSave 再来一次]
```

### FLOW-3 附件附加
```
N-NODE-SELECTED
  → E-USER-CLICK-ATTACH
  → E-GUARD[filePath 存在]
  → E-OPEN-DIALOG
  → E-INVOKE-ATTACH[attach_file_to_node]
  → E-BACKEND-COPY[assets/{uuid}.{ext}]
  → E-BACKEND-THUMBNAIL[QL 生成 PNG]
  → E-BACKEND-SAVE[save mmap content.json]
  → E-FRONTEND-UPDATE[updateContent 写 attached_file]
  → E-RESHAPE-NODE[固定 80×80]
  → T-ATTACH-SUCCESS[画布显示缩略图 + 类型色边框 + 角标]

后续守卫:
  G-TAB-ADD-CHILD[Tab 加子节点 → syncFromMindElixir → fromMindElixirData prevContent 继承 → attached_file 不丢]
```

### FLOW-4 多窗口子窗口关闭（三重保险）
```
N-USER-CLOSE[点子窗口关闭按钮]
  → E-FRONTEND-PREVENT[App.tsx onCloseRequested → event.preventDefault + win.destroy]
  → (并发)E-RUST-PREVENT[lib.rs on_window_event → api.prevent_close + spawn destroy]
  → T-WINDOW-DESTROYED[Destroyed log 1 次]
  → G-NO-LOOP[CloseRequested log 1-2 次,然后 Destroyed]
```

### FLOW-5 提醒触发
```
N-REMINDER-DUE[reminder_scheduler 30s 轮询发现 due]
  → E-NOTIFICATION[系统通知]
  → E-TOAST[应用内 Toast]
  → E-USER-CLICK-TOAST
  → E-NAVIGATE[跳转到对应节点 + selectNode]
  → T-NODE-FOCUSED

后台约束:
  C-MAIN-ONLY[只主窗口启动 scheduler,避免 N 倍并发]
  C-FILTER-TEST[startup filter_test_reminders 清理污染]
```

### FLOW-6 撤销重做（含 LLM 会话整合）
```
普通场景:
  N-USER-EDIT → store.set(content V1) → zundo pastStates.push(V0)
  → N-USER-CMD-Z → undo() → pastStates.pop → setState(V0) + needStoreToMindSync=true
  → E-MIND-SYNC[reverse sync store→mind]

LLM 会话场景:
  N-LLM-ACQUIRE → zundo.pause()
  → N-LLM-OPS（多次）→ 操作不进 undo 历史
  → N-LLM-RELEASE → zundo.resume()
  → N-USER-CMD-Z → 撤到 pre-snapshot（等同一次撤整个会话）
```

## 风险链与验证命题

### 风险链 1:LLM 写操作"假成功"
```
PV-003 → 暴露在 applyOperation → 触发条件:parent_id="root" / addChild 不生成 id / reshapeNode bug
       → 失败机制:emit 成功但 mind-elixir nodeData 没变 → store.content 不变 → mirror 不推送
       → 不利状态:LLM 报告"创建成功"但实际什么都没发生
       → 证据:read_mindmap 拿不到新节点 / search_nodes 0 匹配
```
**VP-MCP-WRITE-REAL**
- 上下文:LLM 持有 session，文档已保存
- 刺激:create_node(parent_id="root", topic="测试")
- 预期:search_nodes 在 3s 内能找到该节点
- 不变量:audit_log 有记录 + mirror.current_content 有新节点 + store.content.root.children.length+1

### 风险链 2:EditorMode 死锁/漏锁
```
PV-002 → 暴露在 RwLock + TTL task → 触发条件:并发 acquire / TTL 过期时刚好新 acquire
       → 失败机制:RwLock 持有过期 / require_llm_session 检查后 TTL 到期
       → 不利状态:两个 LLM 都认为持锁 / 用户接管后 LLM 仍能写
       → 证据:get_edit_state 不一致
```
**VP-MUTEX**
- 上下文:Human 状态
- 刺激:10 并发 acquire_session
- 预期:恰好 1 个成功，9 个被拒
- 不变量:editor.current() 任意时刻最多一个 Llm session

### 风险链 3:自动保存覆盖 invoke 期间改动
```
PV-004 → 暴露在 handleSave + useAutoSave → 触发条件:invoke save_mmap 期间用户继续编辑
       → 失败机制:markSaved 无条件 set dirty=false
       → 不利状态:用户后续改动被误标已保存 → 重开丢失
       → 证据:重开后 store.content 跟磁盘不一致
```
**VP-AUTOSAVE-RACE**
- 上下文:dirty=true，有 filePath
- 刺激:invoke 期间 setContent(新 content V2)
- 预期:invoke 完成后 `dirty=true` 保留（useAutoSave 会再次保存 V2）
- 不变量:`store.content === V2` 时 `dirty=false`，`store.content !== V2` 时 `dirty=true` + needsReschedule 触发

### 风险链 4:附件 Tab 后丢失
```
PV-006 → 暴露在 mindElixirAdapter → 触发条件:attach 后按 Tab 加子节点 → syncFromMindElixir 触发
       → 失败机制:fromMindElixirNode 不读 attached_file
       → 不利状态:节点 attached_file 变 undefined → 画布缩略图消失
       → 证据:read_mindmap 节点 attached_file=null
```
**VP-ATTACH-PERSIST**
- 上下文:节点 A 有 attached_file
- 刺激:Tab 在 A 下加子节点（触发 syncFromMindElixir）
- 预期:之后 A 的 attached_file 仍在
- 不变量:fromMindElixirData 必须从 prevContent 继承 attached_file

### 风险链 5:子窗口关闭死循环
```
PV-008 → 暴露在 handle_window_event + 前端 onCloseRequested → 触发条件:macOS 26 Tahoe 默认 close 流程卡住
       → 失败机制:CloseRequested 无限触发
       → 不利状态:CPU 100% / 大量日志
       → 证据:CloseRequested log 重复 > 5 次
```
**VP-MULTIWINDOW-CLOSE**
- 上下文:子窗口存在
- 刺激:点关闭按钮
- 预期:CloseRequested log 出现 1-2 次，然后 Destroyed
- 不变量:destroy 后窗口真销毁，资源释放

### 风险链 6（新增）:多窗口后台任务重复启动
```
PV-011 → 暴露在 reminder_scheduler + MCP server → 触发条件:多窗口模式下每窗口都启动
       → 失败机制:lib.rs is_main 判断失效 / 单实例插件二次启动
       → 不利状态:N 窗口 N 个 scheduler → 重复通知 / N 个 MCP server 端口冲突
       → 证据:系统通知重复 / MCP port bind failed
```
**VP-MULTIWINDOW-SCHEDULER**
- 上下文:打开 3 个窗口
- 刺激:等到 30s 轮询周期
- 预期:只主窗口 scheduler 触发，子窗口无触发
- 不变量:reminder_scheduler 全局只 1 份 + MCP server 全局只 1 份

### 风险链 7（新增）:测试残留数据污染生产
```
PV-010 → 暴露在 filter_test_reminders → 触发条件:测试 reminder 写入生产 reminders.json
       → 失败机制:filter 规则不严或过度激进
       → 不利状态:真实 reminder 被误清理 / 测试 reminder 残留导致重复通知
       → 证据:reminders.json.polluted-backup 异常出现 / 真实 reminder 丢失
```
**VP-FILTER-TEST-REMINDERS**
- 上下文:reminders.json 含真实 reminder
- 刺激:启动 app
- 预期:真实 reminder 保留，测试 reminder（如果有）被清理 + polluted-backup
- 不变量:filter 只匹配 source_file 含 "test" 路径的 reminder

### 风险链 8（新增）:浏览器模式 IPC 报错刷屏
```
PV-012 → 暴露在 npm run dev 纯浏览器 → 触发条件:window.__TAURI_INTERNALS__ 不存在
       → 失败机制:各 hook 入口未守卫，invoke/listen 抛 7 处错
       → 不利状态:dev 控制台刷红，新成员误以为代码坏了
       → 证据:console error > 7
```
**VP-BROWSER-GRACEFUL**
- 上下文:npm run dev 纯浏览器加载
- 刺激:打开页面
- 预期:只 1 条 info 提示，0 条 IPC error
- 不变量:isTauri() 守卫所有 IPC 入口（App/mcpBridge/operationBridge/ReminderToast/devLogger）

## 覆盖义务矩阵（重新推导，从需求世界正向 + 反向闭合）

| Obligation | 来源 | 主责层 | v1 状态 | v2 评估 |
|---|---|---|---|---|
| OB-001 MCP 协议合规（JSON-RPC） | F-G1 | L1 | designed | 保留 |
| OB-002 EditorMode 状态机 | F-G6 | L1 | designed | 保留 |
| OB-003 TTL 自动释放 | F-G7 | L1+L2 | designed | 保留 |
| OB-004 14 个 tool 正确性 | F-G2/G3/G4 | L1 | designed | 保留（注:v1 写 14 个，实际是 6+3+5=14 ✓） |
| OB-005 MCP CRUD 真实链路 | VP-MCP-WRITE-REAL | L2 | designed | 保留 |
| OB-006 acquire/release 互斥 | VP-MUTEX | L1+L2 | designed | 保留 |
| OB-007 自动保存 race | VP-AUTOSAVE-RACE | L1+L2 | designed | 保留 |
| OB-008 save_mmap 原子写 + 备份 | F-A1/A2 | L1 | designed | 保留 |
| OB-009 adapter 双向同步 | F-B6 + F-C3 | L1 | designed | 保留 |
| OB-010 attached_file 继承 | VP-ATTACH-PERSIST | L1 | designed | 保留 |
| OB-011 节点 CRUD（键盘） | F-B1 | L1+L3 | designed | 保留 |
| OB-012 优先级 P0-P3 + class | F-B5 | L1 | designed | 保留 |
| OB-013 提醒系统 | F-D1..D5 | L1+L2 | designed | 保留 |
| OB-014 附件 8 类型 + 类型色 | F-C1 | L1+L3 | designed | 保留 |
| OB-015 导入导出 | F-F1..F3 | L1 | designed | 保留 |
| OB-016 多窗口关闭 | VP-MULTIWINDOW-CLOSE | L2+L3 | **designed** | **v1 实施缺失，必须补齐** |
| OB-017 接管按钮 | PV-005 + F-H8 | L2+L3 | designed | 保留 |
| OB-018 TTL task 退出时清理 | U-2 | L2 | conditional | 保留（条件阻断，等评估） |
| OB-019 同文件多窗口冲突 | U-3 | L2 | conditional | 保留（无锁文件机制） |
| OB-020（新增）多窗口后台任务去重 | VP-MULTIWINDOW-SCHEDULER + F-D4 + F-E8 | L2 | **未识别** | **新增必须覆盖** |
| OB-021（新增）filter_test_reminders 安全性 | VP-FILTER-TEST-REMINDERS + F-D5 | L1+L2 | **未识别** | **新增必须覆盖** |
| OB-022（新增）浏览器模式优雅降级 | VP-BROWSER-GRACEFUL + F-J1 | L1 | **未识别** | **新增必须覆盖** |
| OB-023（新增）扩展字段 store↔nodeObj 同步 | F-B6 | L1 | 部分覆盖 | **新增独立守卫** |
| OB-024（新增）zundo pause/resume LLM 整合 | F-H5 + PV-009 | L1+L2 | **未识别** | **新增必须覆盖** |
| OB-025（新增）审计日志完整性 | F-G9 | L2 | 部分覆盖 | **新增独立守卫** |
| OB-026（新增）commit 7022507 回归 | U-5 | L1+L2 | **未识别** | **必须查证后决定** |

## 测试用例摘要

### L1 单元（重新组织，按 OB）

| ID | 类别 | OB | 目标 | v1 实施位置 |
|----|------|----|----|---|
| TC-L1-001..010 | pos/neg | OB-001 | JSON-RPC 协议 | src-tauri/src/mcp/protocol.rs |
| TC-L1-011..023 | pos/neg/risk | OB-002 | EditorMode 状态机 | editor_mode.rs（24 个 test） |
| TC-L1-024 | risk | OB-003 | TTL 自动释放 | editor_mode.rs + session.rs |
| TC-L1-025..038 | pos/neg | OB-004 | 14 个 tool 参数校验 | tools_*.rs |
| TC-L1-039 | risk | OB-007 | markSaved 引用比较 | useAutoSave.test.ts |
| TC-L1-040..042 | pos/risk | OB-008 | save_mmap 原子写 + .bak | mmap.rs |
| TC-L1-043..048 | pos/neg | OB-009 | adapter 双向同步 | mindElixirAdapter.test.ts |
| TC-L1-049..050 | pos/risk | OB-010 | attached_file 继承 | mindElixirAdapter.test.ts |
| TC-L1-051..054 | pos | OB-011 | 节点 CRUD 规则 | nodeActions.test.ts |
| TC-L1-055..058 | pos | OB-012 | 优先级 P0-P3 | TabProperties.test.tsx |
| TC-L1-059..063 | pos/risk | OB-013 | 提醒状态计算 | reminderState.test.ts |
| TC-L1-064..068 | pos | OB-014 | 附件类型识别 | （v1 部分，需补全） |
| TC-L1-069..073 | pos/neg | OB-015 | 导出 markdown/opml/mermaid | markdown/opml.rs |
| TC-L1-074（新） | pos/neg | OB-020 | 主窗口判断逻辑 | lib.rs setup is_main |
| TC-L1-075（新） | pos/neg/risk | OB-021 | filter_test_reminders 安全性 | state.rs（v1 未覆盖） |
| TC-L1-076..080（新） | pos/neg | OB-022 | isTauri() 守卫各入口 | tauriEnv + 5 个 hook |
| TC-L1-081..083（新） | pos/risk | OB-023 | syncToMindNodeObj 扩展字段 | store.test.ts |
| TC-L1-084..086（新） | pos/risk | OB-024 | zundo pause/resume | operationBridge.test.ts |

### L2 业务流程

| ID | 类别 | flow_id | 目标 | v1 状态 |
|----|------|---------|------|------|
| TC-L2-001 | risk | FLOW-1 | TTL 后台 task 自动 release + emit | 新增（v1 标新增未落） |
| TC-L2-002..006 | pos | FLOW-1 | create/update/delete/move 真实链路 | 部分有（verify-mcp-live.sh） |
| TC-L2-007 | neg | FLOW-1 | 无 session 时 create_node 被拒 | 已有 |
| TC-L2-008 | risk | FLOW-1 | parent_id="root" 自动转 UUID | 已有 |
| TC-L2-009 | risk | FLOW-1 | mcpBridge sig 用 content hash | 需新增 |
| TC-L2-010 | risk | FLOW-1 | attach_file 完整链路 | 需新增 |
| TC-L2-011 | risk | FLOW-1 | reshapeNode bug 绕过 | 需新增 |
| TC-L2-012 | risk | FLOW-1 | 10 并发 acquire 只 1 成功 | 已有 |
| TC-L2-013 | risk | FLOW-2 | invoke 期间新改动 dirty 保留 | 已有 |
| TC-L2-014 | risk | FLOW-4 | **子窗口关闭不死循环** | **v1 缺失,必须补** |
| TC-L2-015 | pos | FLOW-1 | force_release + banner 消失 | 已有 |
| TC-L2-016（新） | pos/risk | FLOW-6 | zundo pause/resume LLM 整合 | 新增 |
| TC-L2-017（新） | pos | FLOW-1 | 审计日志完整性（每次 op 有 entry） | 新增 |
| TC-L2-018（新） | risk | FLOW-5 | 多窗口下 scheduler 只主窗口触发 | 新增 |
| TC-L2-019（新） | pos/neg | FLOW-5 | filter_test_reminders 启动清理 | 新增 |

### L3 模拟人类操作

| ID | 类别 | 目标 | 工具 | v1 状态 |
|----|------|------|------|------|
| TC-L3-001 | pos | Tab 加子节点 DOM 出现新 tpc | chrome-devtools MCP | 需自动化 |
| TC-L3-002 | pos | 点附件图标 → 缩略图 + 类型色边框 + 角标 | chrome-devtools MCP | 需自动化 |
| TC-L3-003 | pos/risk | **多窗口关闭按钮 → Destroyed** | 手动 + 日志 / chrome-devtools | **v1 缺失** |
| TC-L3-004 | pos/risk | acquire → banner 显示 → 点接管 → banner 消失 + 解锁 | chrome-devtools MCP | 需自动化 |
| TC-L3-005（新） | pos | Cmd+Z 撤销 / Cmd+Shift+Z 重做 / Cmd+Y 重做 | chrome-devtools MCP | 新增 |

## 自动调用与回归计划

| 档位 | 触发 | 用例集 |
|------|------|-------|
| `local` | 开发者本地 | 全部 L1 + 关键 L2 |
| `pr` | GitHub Actions PR | 全部 L1 + 全部 L2 |
| `scheduled` | 每日 cron | 全部 L1 + L2 + L3 |
| `release` | tag push | 全部 + verify-mcp-live.sh |
| `post_deploy` | 装好 app 后 | TC-L3-001..005 + verify-mcp-live.sh |

## 未覆盖项与剩余风险

### 显式未覆盖
| 项 | 原因 | 处置 |
|---|------|-----|
| OB-018 TTL task app 退出清理 | U-2，无 cleanup hook | 评估 tokio runtime drop 行为，若安全则显式标注 `out_of_scope`，否则补 hook |
| OB-019 同文件多窗口锁 | U-3，无锁文件机制 | 评估是否需要引入 flock，否则显式接受为已知限制 |
| U-1 reshapeNode 非 topic 字段 | 需 PoC | 写 PoC 测试一次性验证 |
| U-4 filter_test_reminders 误清理真实 | 规则未文档化 | 查 source.rs 源码 + 补单元测试 |
| U-5 commit 7022507 具体内容 | commit body 不详 | git show 查证 |

### 剩余风险
1. macOS 26 Tahoe WKWebView ≠ Chrome（L3 用 chrome-devtools 不能完全覆盖）
2. mind-elixir 5.14 依赖稳定性（升级需重新验证 F-H2/H3/B6 绕过）
3. MCP 协议版本演进（当前 `2024-11-05`）

### 停止判断
`conditional_complete` — 已识别的 26 个覆盖义务（v1 19 + v2 新增 7）都有用例或显式条件/阻断。U-1~U-5 必须在下次评审时关闭或显式接受。

## 设计审批
- **当前状态**: `draft`
- **下一步**: Phase 2 差异对账（生成 reconcile-matrix.md） → Phase 3 落实差异 → Phase 4 全量回归
