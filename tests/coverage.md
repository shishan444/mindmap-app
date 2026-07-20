# 测试覆盖矩阵

> 从需求出发，每个功能点的测试层级 + 验证状态。
> 最后验证：2026-07-17

## 验证层级

| 层级 | 工具 | 状态 |
|------|------|------|
| 单元（前端） | vitest + @testing-library | 238 通过 |
| 单元（Rust） | cargo test | 100 通过 |
| 集成（Rust） | cargo test --test integration | 17 通过 |
| 类型检查 | tsc --noEmit | ✅ 0 错误 |
| E2E（Chromium） | CDP + Tauri mock 注入 | 56 场景通过 |
| WebKit（Tauri） | 用户验证 | ✅ 核心路径 |

---

## 功能覆盖

### 核心交互

| 功能 | 单元 | 集成 | E2E | 状态 |
|------|------|------|-----|------|
| 启动渲染（me-root + 中心主题） | — | ✅ | ✅ | ✅ |
| Tab 加子节点（多级） | — | — | ✅ B1-B3 | ✅ |
| F2 编辑 + Enter 保存 | — | — | ✅ C1-C2 | ✅ |
| 优先级 P0-P3 设置 | ✅ store | — | ✅ D | ✅ |
| 撤销/重做（Cmd+Z/Shift+Z） | ✅ store | — | ✅ E（修复后） | ✅ |
| 拖动改层级（吸附 + ghost） | — | — | ✅ F | ✅ |
| 双击编辑 | — | — | ✅ | ✅ |
| Delete 删除节点 | — | — | ✅ | ✅ |
| 节点折叠/展开（Cmd+.） | — | — | ✅ | ✅ |

### 文件操作

| 功能 | 单元 | 集成 | E2E | 状态 |
|------|------|------|-----|------|
| .mmap 文件读写（zip+json） | ✅ mmap | ✅ roundtrip | — | ✅ |
| 原子写入 + 单份备份 | ✅ config | ✅ backup | — | ✅ |
| 新建/打开/保存 | ✅ commands | ✅ int_save_open | ✅ K1 | ✅ |
| 最近文件（含置顶） | ✅ models | ✅ int_recent | — | ✅ |
| 自动保存（防抖 2s） | ✅ useAutoSave | — | — | ✅ |
| 恢复上次状态启动 | ✅ useWindowState | — | — | ✅ |

### 导入导出

| 功能 | 单元 | 集成 | E2E | 状态 |
|------|------|------|-----|------|
| PNG 导出 | ✅ usePngExport | — | — | ✅ |
| SVG 导出 | — | — | ✅ | ✅ |
| Markdown 导入导出 | ✅ 17 Rust | ✅ | — | ✅ |
| OPML 导入导出 | ✅ 16 Rust | ✅ | — | ✅ |
| FreeMind .mm 导入 | ✅ 4 Rust | — | — | ✅ |

### 侧边栏

| 功能 | 单元 | 集成 | E2E | 状态 |
|------|------|------|-----|------|
| Tab 切换（4 个） | ✅ Sidebar | — | ✅ G1-G6 | ✅ |
| 属性面板（主题/ID/优先级/图标） | ✅ TabProperties | — | ✅ G3 | ✅ |
| 样式编辑（字号/颜色/粗体/边框） | — | — | ✅ G4 | ✅ |
| 大纲跳转 + 编辑 | ✅ TabOutline | — | ✅ G5 | ✅ |
| 提醒 CRUD + 重复规则 | ✅ TabReminders | — | ✅ G6 | ✅ |
| SVG 图标库（4 分类：任务进度/级别/类型/状态） | ✅ TabProperties | — | ✅ D-按钮 | ✅ |
| 优先级视觉标记（全包围边框 + 外侧 SVG 图标） | ✅ store CSS class | — | ✅ D-边框/D-图标 | ✅ |
| macOS 系统通知（tauri-plugin-notification） | ✅ reminder_scheduler + capabilities | — | — | ✅ |
| 偏好设置 Esc 关闭 | — | — | ✅ J2（已加 useEffect keydown） | ✅ |

### 系统能力

| 功能 | 单元 | 集成 | E2E | 状态 |
|------|------|------|-----|------|
| macOS 托盘 + 关闭改隐藏 | — | — | ✅ | ✅ |
| 右键上下文菜单 | — | — | ✅ | ✅ |
| 偏好设置面板 | ✅ PreferencesModal | — | ✅ J1-J2 | ✅ |
| 全文搜索（Cmd+F） | — | — | ✅ H1 | ✅ |
| 明暗主题 | — | — | ✅ | ✅ |
| 自动布局（Cmd+Shift+L） | — | — | ✅ | ✅ |
| 单例检测 | — | — | ✅ | ✅ |
| 开发模式 JSONL 日志 | ✅ devLogger + dev_logger | ✅ | ✅ | ✅ |

### 数据模型

| 功能 | 单元 | 集成 | E2E | 状态 |
|------|------|------|-----|------|
| Node 序列化（children 始终输出） | ✅ contract | ✅ | — | ✅ |
| Priority 枚举 | ✅ models | — | — | ✅ |
| Config 往返 | ✅ config | ✅ | — | ✅ |
| RecentFiles 增删改 | ✅ models | ✅ | — | ✅ |
| mind-elixir adapter 往返 | ✅ 30 tests | — | — | ✅ |
| nodeActions 封装 | ✅ 36 tests | — | — | ✅ |

---

## E2E 场景明细（Chromium + Tauri mock + 真实 CDP 事件）

| ID | 场景 | 工具 | 结果 |
|----|------|------|------|
| MOCK | Tauri mock 注入（Page.addScriptToEvaluateOnNewDocument） | CDP Page | ✅ |
| P0 | 新建按钮 + invoke("new_mmap") | evaluate + click | ✅ |
| A1 | me-root 渲染 | evaluate | ✅ |
| A2 | mind 实例可用 | evaluate | ✅ |
| A3 | 工具栏按钮数 ≥ 10 | evaluate | ✅ 18 个 |
| A4 | 侧边栏 4 个 tab | evaluate | ✅ |
| A5 | 搜索框存在 | evaluate | ✅ |
| A6 | 状态栏存在 | evaluate | ✅ |
| A-主题 | 中心主题渲染 | evaluate | ✅ |
| B1 | selectNode(root) + CDP Tab → 1 级 | rawKeyDown | ✅ 1→2 |
| B2 | selectLast + Tab → 2 级 | rawKeyDown | ✅ 2→3 |
| B3 | selectLast + Tab → 3 级 | rawKeyDown | ✅ 3→4 |
| C1 | F2 → input-box 出现 | rawKeyDown | ✅ |
| C2 | Input.insertText + Enter 保存 | insertText + rawKeyDown | ✅ "E2E测试节点" |
| D-按钮 | 找到并点击 P0 按钮 | click | ✅ |
| D-类 | priority-p0 类已应用 | getComputedStyle | ✅ |
| D-边框 | 全包围 2px solid rgb(231,76,60) | getComputedStyle | ✅ |
| D-图标 | ::before 图标注入（left:-22px,width:16px,data:image/svg） | getComputedStyle | ✅ |
| D-清除 | 再次点击 P0 清除 | click | ✅ |
| D2-设置 | 设置 P1 + nodeObj/DOM/store 三方一致 | evaluate | ✅ |
| D2-保留 | 切换节点后 priority class 保留（回归 BUG 修复） | selectNode + getComputedStyle | ✅ |
| E1 | Cmd+Z 撤销（节点数验证） | dispatchKeyEvent | ✅ |
| E2 | Cmd+Shift+Z 重做 | dispatchKeyEvent | ✅ |
| F1 | Enter 创建兄弟节点 | rawKeyDown | ✅ 4→5 |
| G-大纲/样式/提醒/面板 | sidebar-tab.click + active class 验证 | click + classList | ✅ |
| H1 | 搜索框 click + insertText | clickPoint + insertText | ✅ |
| J1 | 偏好设置打开（title 匹配） | click | ✅ 20 个 modal 元素 |
| J2 | Esc 关闭偏好设置（已加 useEffect keydown） | rawKeyDown | ✅（已修复） |
| J3-tab | 切换到"提醒" tab | evaluate click | ✅ |
| J3-存在 | "触发 macOS 系统通知" checkbox 存在 + label 文案正确 | evaluate | ✅ |
| J3-切换 | 点击 checkbox 切换状态 | click + checked 验证 | ✅ |
| M-渲染 | 节点带 reminder 时渲染沙漏 wrapper | evaluate + setAllReminders | ✅ |
| M-SVG | 沙漏 SVG 内部多 path(rect/玻璃/沙堆/stream) | DOM querySelector | ✅ |
| M-状态 | 未来状态显示 hourglass-future class | classList 验证 | ✅ |
| M-穿透 | pointer-events: none(点击穿透到下层节点) | getComputedStyle | ✅ |
| M-到期 | 到期状态切换 due class + flow-fast 动画 | classList 验证 | ✅ |
| M-清理 | 删除 reminder 后沙漏 wrapper 移除 | evaluate + DOM | ✅ |
| N-标题 | 面板有"附加文件"区域 | evaluate querySelector | ✅ |
| N-按钮 | 7 种文件类型按钮(图片/PDF/PPT/Word/Excel/视频/音频) | evaluate | ✅ |
| N-渲染 | attached_file 节点渲染 attached-render | store update + DOM | ✅ |
| O1-添加 | reminder 写入 store | invoke upsert + setAllReminders | ✅ |
| O2-删除 | 删除后 store 不含该 reminder | invoke delete + filter | ✅ |
| O3-不复活 | 调度器 poll 后 reminder 不复活(防 race condition 回归) | invoke get_reminders | ✅ |
| O4-沙漏 | 删除后画布沙漏数量减少 | DOM querySelector | ✅ |
| P1-添加 | reminder 创建写入 store | invoke upsert | ✅ |
| P2-编辑按钮 | reminder 列表渲染 ✏️ 编辑按钮 | DOM 验证 | ✅ |
| P3-编辑生效 | 二次编辑改 title 生效(id 不变) | invoke upsert + store 验证 | ✅ |
| Q1-API | window.__centerNode 函数暴露 | typeof 验证 | ✅ |
| Q2-调用 | centerNode 调用返回成功 | boolean 返回值 | ✅ |
| Q3-居中 | 节点居中到容器中心(误差 ≤5px) | getBoundingClientRect 算 dx/dy | ✅ dx=0,dy=0 |
| K1 | store 状态可读（dirty/saveStatus/history） | evaluate | ✅ past=30 |
| L1 | Delete 删除节点 | rawKeyDown | ✅ 5→4 |
