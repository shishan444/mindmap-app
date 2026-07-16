# 工程守则（Meta Rules）

> 从 mindmap-app Phase 1-18 真实事故提炼的工程原则。每条都有"反 Pattern / 合规做法 / 代码示例"。
> **遇到 issue 必须回看是否违反其中某条。** 新增经验时同步追加。

---

## 目录

1. [副作用清理原则](#守则-1副作用清理原则)
2. [启动健壮性原则](#守则-2启动健壮性原则)
3. [错误恢复优先于错误报告](#守则-3错误恢复优先于错误报告)
4. [可重现的验证流程](#守则-4可重现的验证流程)
5. [交付前的零假设检查](#守则-5交付前的零假设检查)
6. [失败必须能回滚](#守则-6失败必须能回滚)
7. [测试必须覆盖契约边界](#守则-7测试必须覆盖契约边界)
8. [验证必须模拟完整用户路径](#守则-8验证必须模拟完整用户路径)
9. [console 错误必须立即追查](#守则-9console-错误必须立即追查)
10. [第三方包导入必须验证](#守则-10第三方包导入必须验证)
11. [UX 默认行为必须符合用户直觉](#守则-11ux-默认行为必须符合用户直觉)

---

## 守则 1：副作用清理原则

**任何调试 / 验证启动的进程、服务、文件、目录，使用完毕必须显式清理，不依赖会话结束自动回收。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| 1.1 | E2E 验证启动 `npm run dev` 后台进程，验证完不 kill | 下次 `npm run tauri dev` 端口冲突启动失败 |
| 1.2 | 临时写入 `/tmp/xxx` 不删 | 磁盘累积垃圾，权限问题 |
| 1.3 | 集成测试 spawn 子进程不 wait | 子进程成孤儿，CI 卡死 |

### 合规做法

```bash
# bash：trap 自动清理
trap "kill $PID 2>/dev/null" EXIT
```

```typescript
// 测试代码：beforeEach / afterEach 配对
beforeEach(() => { server = startServer(); });
afterEach(() => { server.close(); });
```

---

## 守则 2：启动健壮性原则

**dev 命令必须能在任意初始状态下工作。不假设环境干净。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| 2.1 | vite 默认 strictPort，端口被占直接退出 | 用户每次都得手动 kill 僵尸 |
| 2.2 | 假设 `cargo` / `npm` 在 PATH | 切环境后命令找不到 |
| 2.3 | 启动失败只报错不恢复 | 用户卡住，体验崩塌 |

### 合规做法

```json
// package.json：加 predev / pretauri 钩子
{
  "scripts": {
    "predev": "bash scripts/precheck.sh",
    "pretauri": "bash scripts/precheck.sh"
  }
}
```

```bash
# scripts/precheck.sh：自动清理僵尸
PID=$(lsof -ti:1420 -sTCP:LISTEN 2>/dev/null)
[ -n "$PID" ] && kill $PID
```

---

## 守则 3：错误恢复优先于错误报告

**遇到常见错误（端口 / 文件锁 / 权限 / 网络）时，优先尝试自动恢复，而非抛错给用户。**

### 反 Pattern

| # | 行为 |
|---|------|
| 3.1 | "Port already in use" 直接退出 |
| 3.2 | 编译缓存损坏只报错，要用户手动 `rm -rf target/` |
| 3.3 | 文件锁占用直接 panic |

### 合规做法

```rust
fn open_or_recover(path: &Path) -> Result<File> {
    match File::open(path) {
        Ok(f) => Ok(f),
        Err(e) if e.kind() == PermissionDenied => {
            try_fix_permissions(path)?;
            File::open(path)
        }
        Err(e) => Err(e),
    }
}
```

---

## 守则 4：可重现的验证流程

**任何"我验证过"的声明必须配套可重现脚本，含完整 cleanup。**

### 反 Pattern

| # | 行为 |
|---|------|
| 4.1 | "我在 chrome-devtools 验证了，全过" — 没说怎么启动的 |
| 4.2 | 验证脚本启动 5 个服务，没说怎么停 |
| 4.3 | E2E 修改了真实用户文件（~/Library/...） |

### 合规做法

```bash
# scripts/verify.sh：trap cleanup 自动清理
trap cleanup EXIT
cleanup() {
  pkill -f "vite.*1420" 2>/dev/null
  unset MINDMAP_TEST_DATA_DIR
}
```

---

## 守则 5：交付前的零假设检查

**交付前必须验证：在干净环境（无残留进程/文件/配置）下能完整跑通。**

### 反 Pattern

| # | 行为 |
|---|------|
| 5.1 | 只在"开发机当前状态"测过 |
| 5.2 | 用了未提交的本地配置 |
| 5.3 | 假设 `~/Library/...` 目录已存在 |

### 合规做法

```bash
# scripts/verify-clean.sh
TEMP_DIR=$(mktemp -d)
export MINDMAP_TEST_DATA_DIR=$TEMP_DIR
trap "rm -rf $TEMP_DIR" EXIT
# 模拟首次启动
npm run tauri dev
```

---

## 守则 6：失败必须能回滚

**每次变更后用户能轻松回到上一个工作版本。**

### 反 Pattern

| # | 行为 |
|---|------|
| 6.1 | 一次 commit 改 10 个 Phase | 出 bug 不知哪层导致 |
| 6.2 | 测试和功能代码同一 commit | 回滚功能也丢了测试 |
| 6.3 | commit message 不说"为什么" | 回滚决策缺信息 |

### 合规做法

- 1 个独立改动 = 1 个 commit
- commit message 含：**做什么** + **为什么** + **如何回滚**
- 大变更拆成 N 个 atomic commit

---

## 守则 7：测试必须覆盖契约边界

**单元测试覆盖函数级，集成测试覆盖契约边界（前后端 / 进程间 / 模块间）。**

### 反 Pattern

| # | 行为 |
|---|------|
| 7.1 | 1000 个单元测试都过，但前后端字段不一致线上崩 |
| 7.2 | mock 所有依赖，从不测真实链路 |
| 7.3 | 测试数据全是 makeNode()，从不模拟后端真实输出 |

### 合规做法

```rust
// 契约测试：序列化输出必须含某字段（即使空）
#[test]
fn node_always_serializes_vec_fields() {
    let n = Node::new("x");
    let json = serde_json::to_string(&n).unwrap();
    assert!(json.contains("\"children\":["));
}
```

```typescript
// 契约测试：模拟后端 JSON（缺字段）测试前端解析
it("处理 children 缺失", () => {
  const json = '{"id":"x","topic":"t"}';  // 没 children
  const c = parseContent(json);
  expect(c.root.children).toEqual([]);
});
```

---

## 守则 8：验证必须模拟完整用户路径

**不只看静态 UI，必须 click → keydown → 编辑 → 保存 全流程。**

### 反 Pattern

| # | 行为 |
|---|------|
| 8.1 | 截图看 UI 漂亮就宣布通过——没操作 |
| 8.2 | 用 `dispatchEvent` 模拟，但漏掉浏览器默认行为 |
| 8.3 | 只测 happy path，不测 error/recovery |

### 合规做法

```javascript
// chrome-devtools MCP 完整 E2E 脚本
await evaluate_script(async () => {
  // 1. 启动验证
  assert(document.querySelector('me-root'));
  // 2. 模拟点击
  meTpc.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  // 3. 模拟键盘
  inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  // 4. 验证状态变化
  assert(mind.nodeData.children.length === 1);
  // 5. 模拟编辑
  meTpc.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  // 6. 验证 input-box 出现 + 输入 + Enter + 保存
  ...
});
```

**关键检查项**：
- `document.activeElement` 是否符合预期
- 焦点残留（input-box 是否还在）
- 浏览器默认行为（Enter=换行、Tab=缩进）是否被拦截

---

## 守则 9：console 错误必须立即追查

**任何 console error / network 500 都必须定位根因，不能"看起来能跑就略过"。**

### 反 Pattern

| # | 行为 |
|---|------|
| 9.1 | 看到 `Failed to load resource 500` 不查 |
| 9.2 | console 有 warning 当没事 |
| 9.3 | 用 try-catch 吞错不报告 |

### 合规做法

```javascript
// chrome-devtools 抓所有 console 错误
const msgs = await list_console_messages({ types: ['error', 'warn'] });
for (const m of msgs) {
  console.log(`[console ${m.level}]`, m.message);
  // 每条都必须有解释或修复
}
```

```javascript
// 网络请求失败必须查 response body
const req = await get_network_request(reqid);
if (req.status >= 400) {
  console.error('Request failed:', req.responseBody);
  // 不是"再试一次"，是定位根因
}
```

---

## 守则 10：第三方包导入必须验证

**`import "pkg/xxx"` 可能因 package.json exports 失败，必须看网络请求验证。**

### 反 Pattern

| # | 行为 |
|---|------|
| 10.1 | 加 `import "pkg/dist/style.css"`，不看 console |
| 10.2 | 假设 npm 包文档说支持就一定支持 |
| 10.3 | 报错信息"Missing specifier"看不懂就略过 |

### 合规做法

```bash
# 加 import 后立即验证
curl "http://localhost:1420/src/components/X.tsx" | head -5
# 如果 500，看 response body 的具体错误
```

```json
// 读取 package.json exports 字段确认是否声明
{
  "exports": {
    ".": "./dist/index.js",
    "./dist/style.css": "./dist/style.css"  // 必须有这行才能 import "pkg/dist/style.css"
  }
}
```

**绕过方案**（package.json 没声明）：
```html
<!-- index.html 用 link 注入 -->
<link rel="stylesheet" href="/node_modules/pkg/dist/style.css" />
```

---

## 守则 11：UX 默认行为必须符合用户直觉

**自动进入子模式（编辑、模态、聚焦）是反 UX 的——用户没主动触发。**

### 反 Pattern

| # | 行为 |
|---|------|
| 11.1 | addChild 后自动进入编辑模式，用户不知道按 Enter 退出 |
| 11.2 | 双击文件自动上传，没确认 |
| 11.3 | 失焦自动保存，没提示 |
| 11.4 | 创建后自动选中并 focus 输入框 |

### 合规做法

```typescript
// ❌ 反 Pattern：自动进入编辑
addChild(node);  // mind-elixir 默认 editTopic()

// ✅ 合规：让用户主动触发
addChild(node, { topic: "New Node" });  // 跳过自动编辑
// 用户需要编辑时双击 / F2
```

**抽象规则**：
- 任何"模式"必须有可见的退出方式（Esc + 明确按钮 + 失焦退出）
- 默认行为是"无副作用"
- 特殊模式（编辑/模态）需要用户主动操作才进入
- 自动选中 + focus 是危险的（拦截后续操作）

---

## 应用：本次会话的根因映射

| 修复 commit | 违反守则 |
|------------|----------|
| Phase 13（Vec skip_serializing） | 7（契约测试缺失） |
| Phase 14（mind-elixir 5.14 Nt noop） | 7（依赖测试缺失） |
| Phase 15（根节点偏下 + 图标大小不一） | 8（验证不全） |
| Phase 16（启动端口占用） | 1+2+3 |
| Phase 17（mind-elixir CSS 缺失） | 9+10 |
| Phase 18（自动编辑困用户） | 11（UX 反 Pattern） |

---

## 维护

- 新增 issue 时回看是否违反守则
- 修复后把经验提炼成新守则（守则 12+）
- 文档与代码同步更新（commit 含 docs/）
