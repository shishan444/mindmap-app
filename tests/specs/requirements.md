# 需求→测试映射

> 本文件是测试用例的 single source of truth。每个需求点对应一个或多个测试用例。
> 任何代码改动必须跑通相关测试，确保不破坏既有功能。
>
> 维护原则：新增决策 / 功能 → 立即在此追加测试用例 → 实现对应自动化测试。

## 测试金字塔

```
        ┌─────────┐
        │   E2E   │  ← Tauri 启动 + 真实用户操作（少而精）
        ├─────────┤
        │ 集成测试 │  ← Tauri commands 端到端（中等数量）
        ├─────────┤
        │ 单元测试 │  ← 函数/组件级（大量，快）
        └─────────┘
```

## 技术栈

| 层级 | 后端（Rust） | 前端（TypeScript） |
|------|------|------|
| 单元 | `cargo test` | `vitest` |
| 集成 | `cargo test`（tests/ 目录） | `vitest` + Tauri mock |
| E2E | tauri-driver / 手动 | Tauri runtime |
| 覆盖率 | cargo-tarpaulin | vitest coverage |

## 测试 ID 命名规则

```
DEC-<决策编号>           决策级（DEC-01 ~ DEC-23）
FE-<模块>-<编号>         前端功能（FE-CANVAS-01, FE-SIDEBAR-01, ...）
BE-<模块>-<编号>         后端功能（BE-MMAP-01, BE-CONFIG-01, ...）
E2E-<场景>-<编号>        端到端（E2E-LIFECYCLE-01）
```

## 状态标记

- ✅ 已实现并有自动化测试
- 🔄 部分实现（功能在，测试缺）
- ⏳ 计划中（功能未实现）
- ❌ 已知问题

---

## 一、决策级验收用例（23 项）

| ID | 决策 | 验收条件 | 测试层级 | 状态 |
|----|------|----------|----------|------|
| DEC-01 | 仅 macOS | cargo build 仅编译 aarch64-apple-darwin / x86_64-apple-darwin；Tauri bundle target 为 macos | U | ✅ |
| DEC-02 | 仅托盘常驻 | 关闭主窗口进程不退出；托盘图标仍可见；从托盘可重新打开窗口 | E | ⏳ |
| DEC-03 | 单文件 .mmap | 一张图 = 一个 .mmap（zip），含 meta.json + content.json + assets/ | U+I | ✅ |
| DEC-04 | 优先级标记 | 节点支持 priority 字段，取值 P0/P1/P2/P3/null | U | ✅ |
| DEC-05 | Tauri + React | 后端 Rust、前端 React 19，构建产物可启动 | E | ✅ |
| DEC-06 | 不开机自启 | 无 launchd plist 注册，无 SMLoginItemSetEnabled 调用 | I | ⏳ |
| DEC-07 | PNG + Markdown + OPML 导出 | 三种格式各自有独立导出器 | U | ⏳ |
| DEC-08 | 双层弹窗（前台模态 + 后台通知） | 前台时弹应用内模态框；后台时弹系统通知 | E | ⏳ |
| DEC-09 | 重复规则 3 种 | 支持 once/daily/interval 三种 repeat_rule.type | U | ⏳ |
| DEC-10 | 三入口（右键+快捷键+悬浮） | 右键菜单、Cmd+R、节点悬浮工具条均能触发添加提醒 | E | ⏳ |
| DEC-11 | P0-P3 四级 | Priority 枚举仅 4 个值，无其他 | U | ✅ |
| DEC-12 | 仅视觉标记（不联动提醒强度） | Priority 不影响 ReminderPrefs 或提醒触发逻辑 | U | ⏳ |
| DEC-13 | XMind/MindNode 快捷键约定 | Tab=子节点，Enter=兄弟节点，F2=编辑，Cmd+Z=撤销 | E | 🔄 |
| DEC-14 | 仿 XMind 二栏 | CSS Grid/Flex 布局：toolbar + canvas+sidebar 主区 + statusbar | U | ✅ |
| DEC-15 | Tab 切换侧边栏 | 4 个 tab 可切换，active_tab 持久化到 config | U+I | ✅ |
| DEC-16 | 不加开机自启提示 | 软件不会弹"建议加入登录项"对话框 | E | ⏳ |
| DEC-17 | 恢复上次状态启动 | 启动时读 config.last_opened_file + window_state，恢复窗口位置/侧栏 tab | I+E | 🔄 |
| DEC-18 | 防抖 2 秒 | 用户停止编辑 2 秒后自动保存，状态栏显示"保存中" | I | ⏳ |
| DEC-19 | 仅 1 份备份 | 每次保存覆盖 *.backup.mmap，不存在多版本堆积 | U+I | ✅ |
| DEC-20 | 优先级无快捷键 | 无 Cmd+1/2/3/4 等绑定；只能用工具栏/右键 | E | ⏳ |
| DEC-21 | 数字角标 | 托盘图标在 pending 提醒 > 0 时显示数字 | E | ⏳ |
| DEC-22 | 不做快捷键自定义 | 偏好设置无"快捷键"tab | U | ⏳ |
| DEC-23 | 数据模型 7 默认 | UUID v4 / 哈希命名 / reminders.json 独立 / 样式继承 / ISO 8601 / Application Support 路径 / 版本字段 | U | ✅ |

---

## 二、后端功能测试用例（Rust）

### BE-MMAP：.mmap 文件 I/O

| ID | 用例 | 测试函数 | 状态 |
|----|------|----------|------|
| BE-MMAP-01 | 序列化 + 反序列化往返（无 assets） | `mmap::tests::roundtrip_basic_mmap` | ✅ |
| BE-MMAP-02 | 相同内容 asset 去重（哈希一致） | `mmap::tests::asset_dedup` | ✅ |
| BE-MMAP-03 | 写入后 unzip 检查 meta.json + content.json | `mmap::tests::zip_structure` | ⏳ |
| BE-MMAP-04 | 读入损坏 zip（缺 meta.json）返回 InvalidFormat | `mmap::tests::missing_meta_errors` | ⏳ |
| BE-MMAP-05 | 原子写入：写入中途模拟失败不破坏原文件 | `mmap::tests::atomic_write_preserves_original_on_failure` | ⏳ |
| BE-MMAP-06 | 单份备份覆盖：第二次保存后只存在一个 .backup.mmap | `mmap::tests::backup_overwrites_previous` | ⏳ |
| BE-MMAP-07 | assets 目录的图片资源能被正确读回 | `mmap::tests::asset_roundtrip` | ⏳ |
| BE-MMAP-08 | meta.modified_at 在每次保存时更新 | `mmap::tests::meta_updates_on_touch` | ⏳ |

### BE-CONFIG：配置文件管理

| ID | 用例 | 测试函数 | 状态 |
|----|------|----------|------|
| BE-CONFIG-01 | Config::default 包含合理默认值（auto_save=2，recent_max=20） | `config::tests::default_values` | ⏳ |
| BE-CONFIG-02 | save → load 往返一致 | `config::tests::save_load_roundtrip` | ⏳ |
| BE-CONFIG-03 | load 不存在文件返回默认值，不报错 | `config::tests::load_missing_returns_default` | ⏳ |
| BE-CONFIG-04 | load 损坏 JSON 返回错误，不 panic | `config::tests::load_corrupt_errors` | ⏳ |
| BE-CONFIG-05 | save 创建必要的目录（~/Library/Application Support/MindMap/） | `config::tests::save_creates_dir` | ⏳ |

### BE-RECENT：最近文件管理

| ID | 用例 | 测试函数 | 状态 |
|----|------|----------|------|
| BE-RECENT-01 | touch 新文件 → 列表第一条 | `recent::tests::touch_adds_first` | ⏳ |
| BE-RECENT-02 | touch 已存在文件 → 移到非 pinned 顶部，不重复 | `recent::tests::touch_moves_to_top` | ⏳ |
| BE-RECENT-03 | 超过 max 时按 pinned 优先保留 | `recent::tests::trim_respects_pinned` | ⏳ |
| BE-RECENT-04 | toggle_pin 把 pinned 移到列表前 | `recent::tests::toggle_pin_orders` | ⏳ |
| BE-RECENT-05 | remove 删除指定项 | `recent::tests::remove_works` | ⏳ |

### BE-MODELS：数据模型

| ID | 用例 | 测试函数 | 状态 |
|----|------|----------|------|
| BE-MODELS-01 | Node 序列化包含 id+topic+children | `models::tests::node_serialization` | ⏳ |
| BE-MODELS-02 | 反序列化缺失字段时用默认值（向前兼容） | `models::tests::node_backward_compat` | ⏳ |
| BE-MODELS-03 | Priority 序列化为 "P0"/"P1"/"P2"/"P3" | `models::tests::priority_serialization` | ⏳ |
| BE-MODELS-04 | skip_serializing_if 让 JSON 不含 null 字段 | `models::tests::skip_serializing_if` | ⏳ |
| BE-MODELS-05 | Node::new 生成 UUID v4 格式（36 字符含 4 个连字符） | `models::tests::node_new_generates_uuid` | ⏳ |

### BE-CMDS：Tauri commands

| ID | 用例 | 测试函数 | 状态 |
|----|------|----------|------|
| BE-CMDS-01 | new_mmap 返回 Content 含根节点 | `commands::tests::new_mmap_default` | ⏳ |
| BE-CMDS-02 | save_mmap + open_mmap 往返数据一致 | `commands::tests::save_open_roundtrip` | ⏳ |
| BE-CMDS-03 | add_recent_file 后再读，列表含该项 | `commands::tests::recent_flow` | ⏳ |
| BE-CMDS-04 | update_last_dirs 后 config 反映新路径 | `commands::tests::update_dirs` | ⏳ |
| BE-CMDS-05 | path_exists 返回正确布尔值 | `commands::tests::path_exists_works` | ⏳ |

---

## 三、前端功能测试用例（TypeScript）

### FE-STORE：状态管理

| ID | 用例 | 测试文件 | 状态 |
|----|------|----------|------|
| FE-STORE-01 | setContent 后 nodeCount 正确递归计算 | `src/store.test.ts` | ⏳ |
| FE-STORE-02 | markDirty 后 dirty=true | 同上 | ⏳ |
| FE-STORE-03 | markSaved 后 dirty=false, saveStatus='saved', lastSavedAt 设值 | 同上 | ⏳ |
| FE-STORE-04 | updateContent 浅克隆 root，不污染原对象 | 同上 | ⏳ |
| FE-STORE-05 | setActiveTab 切换 tab 后 activeTab 正确 | 同上 | ⏳ |
| FE-STORE-06 | toggleSidebar 切换 sidebarCollapsed | 同上 | ⏳ |

### FE-CANVAS：mind-elixir 集成

| ID | 用例 | 测试文件 | 状态 |
|----|------|----------|------|
| FE-CANVAS-01 | 无 content 时显示空状态占位 | `src/components/MindMapCanvas.test.tsx` | ⏳ |
| FE-CANVAS-02 | 有 content 时 mind-elixir 容器存在 | 同上 | ⏳ |
| FE-CANVAS-03 | selectNode 事件触发后 setSelectedNodeId 被调用 | 同上 | ⏳ |

### FE-SIDEBAR：侧边栏

| ID | 用例 | 测试文件 | 状态 |
|----|------|----------|------|
| FE-SIDEBAR-01 | 默认 activeTab='properties'，对应面板渲染 | `src/components/Sidebar.test.tsx` | ⏳ |
| FE-SIDEBAR-02 | 点击其他 tab 后切换 | 同上 | ⏳ |
| FE-SIDEBAR-03 | collapsed=true 时只显示图标列 | 同上 | ⏳ |

### FE-PROPERTIES：属性面板

| ID | 用例 | 测试文件 | 状态 |
|----|------|----------|------|
| FE-PROP-01 | 未选中节点时显示"未选中节点"提示 | `src/components/TabProperties.test.tsx` | ⏳ |
| FE-PROP-02 | 选中节点时显示 topic + id + priority | 同上 | ⏳ |
| FE-PROP-03 | 优先级 chip 高亮当前 priority | 同上 | ⏳ |

### FE-OUTLINE：大纲视图

| ID | 用例 | 测试文件 | 状态 |
|----|------|----------|------|
| FE-OUTLINE-01 | 树形递归渲染所有节点 | `src/components/TabOutline.test.tsx` | ⏳ |
| FE-OUTLINE-02 | 点击 outline-row 触发 onSelect(id) | 同上 | ⏳ |
| FE-OUTLINE-03 | 选中节点高亮（class=selected） | 同上 | ⏳ |

### FE-TOOLBAR：工具栏

| ID | 用例 | 测试文件 | 状态 |
|----|------|----------|------|
| FE-TOOLBAR-01 | 无 content 时 onSave 按钮禁用 | `src/components/Toolbar.test.tsx` | ⏳ |
| FE-TOOLBAR-02 | dirty=true 时保存按钮显示 * | 同上 | ⏳ |
| FE-TOOLBAR-03 | 点击优先级下拉项触发 onSetPriority | 同上 | ⏳ |

### FE-STATUSBAR：状态栏

| ID | 用例 | 测试文件 | 状态 |
|----|------|----------|------|
| FE-STATUS-01 | nodeCount=0 时显示"0 节点" | `src/components/StatusBar.test.tsx` | ⏳ |
| FE-STATUS-02 | saveStatus='saving' 显示"保存中..." | 同上 | ⏳ |
| FE-STATUS-03 | dirty=true 显示"● 未保存" | 同上 | ⏳ |

---

## 四、端到端用例（E2E）

| ID | 场景 | 步骤 | 状态 |
|----|------|------|------|
| E2E-LIFE-01 | 完整生命周期 | 新建 → 编辑 10 节点 → 标记 P0 → 保存 → 关闭 → 重启 → 验证恢复 | ⏳ |
| E2E-FILE-01 | 打开对话框 | 文件菜单 → 打开 → 选 .mmap → 验证画布加载 | ⏳ |
| E2E-FILE-02 | 另存为 | 已有文件 → 另存为新位置 → 验证两个文件都存在 | ⏳ |
| E2E-RECENT-01 | 最近文件 | 打开 A → 打开 B → 文件菜单 → 最近打开 → 含 A 和 B | ⏳ |
| E2E-TRAY-01 | 托盘显隐窗口 | 关闭主窗口 → 托盘仍可见 → 点托盘"显示主窗口" → 窗口恢复 | ⏳ |

---

## 五、回归脚本入口

```bash
# 全量回归（每次提交前必跑）
npm run test:all

# 等价于：
#   npm run lint           # TypeScript 类型检查
#   npm run test:fe        # 前端单元测试
#   npm run test:be        # Rust 单元测试
#   npm run test:integration  # Rust 集成测试
```

预期：
- 全部测试通过（exit code 0）
- 覆盖率不低于阈值（前端 70%，后端 70%）
- 无 TypeScript 编译错误

---

## 六、当前状态汇总（2026-07-15）

| 类别 | 总数 | ✅ 已实现 | 🔄 部分 | ⏳ 计划 |
|------|------|----------|---------|---------|
| 决策级 | 23 | 9 | 2 | 12 |
| 后端 | 23 | 2 | 0 | 21 |
| 前端 | 19 | 0 | 0 | 19 |
| E2E | 5 | 0 | 0 | 5 |
| **合计** | **70** | **11** | **2** | **57** |

目标：完成 Phase 9 后，✅ 数量 ≥ 50；完成 Phase 8 后，✅ 数量 ≥ 60。
