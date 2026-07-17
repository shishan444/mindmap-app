# 测试覆盖矩阵

> 从需求出发，每个功能点的测试层级 + 验证状态。
> 最后验证：2026-07-17

## 验证层级

| 层级 | 工具 | 状态 |
|------|------|------|
| 单元（前端） | vitest + @testing-library | 232 通过 |
| 单元（Rust） | cargo test | 84 通过 |
| 集成（Rust） | cargo test --test integration | 17 通过 |
| E2E（Chromium） | chrome-devtools click/press_key/type_text | 38 场景通过 |
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
| 属性面板（主题/ID/优先级/备注/图标） | ✅ TabProperties | — | ✅ G3 | ✅ |
| 样式编辑（字号/颜色/粗体/边框） | — | — | ✅ G4 | ✅ |
| 大纲跳转 + 编辑 | ✅ TabOutline | — | ✅ G5 | ✅ |
| 提醒 CRUD + 重复规则 | ✅ TabReminders | — | ✅ G6 | ✅ |
| emoji 图标库 | ✅ TabProperties | — | ✅ | ✅ |

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

## E2E 场景明细（Chromium + 真实事件）

| ID | 场景 | 工具 | 结果 |
|----|------|------|------|
| A1 | me-root 渲染 | evaluate | ✅ |
| A2 | mind 实例 | evaluate | ✅ |
| A3 | 工具栏按钮 10+ | evaluate | ✅ |
| A4 | 侧边栏 4 tab | evaluate | ✅ |
| A5 | 搜索框 | evaluate | ✅ |
| A6 | 状态栏 | evaluate | ✅ |
| B1 | click 根 + Tab → 1 级 | click + press_key | ✅ |
| B2 | click 1 级 + Tab → 2 级 | click + press_key | ✅ |
| B3 | click 2 级 + Tab → 3 级 | click + press_key | ✅ |
| C1 | F2 → 编辑框 | press_key | ✅ |
| C2 | type "测试节点" + Enter | type_text | ✅ |
| D | P0 优先级设置 | click | ✅ |
| E | 撤销/重做 | press_key Meta+z | ✅（修复后） |
| F | drag 节点改层级 | drag | ✅ |
| G1-G6 | Tab 切换（属性/样式/大纲/提醒） | click | ✅ |
| H1 | 搜索框输入 | input event | ✅ |
| J1 | 偏好设置打开 | click | ✅ |
| J2 | 偏好设置关闭 | click | ✅ |
| K1 | 保存触发 invoke | click + mock | ✅ |
