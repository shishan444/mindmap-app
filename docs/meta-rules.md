# Meta 守则（工程交付的反Pattern 与原则）

> 本文件从多次实际失败中提炼，是项目级"血泪经验"。每次新增 issue 都应回看是否违反其中某条。
> 来源：mindmap-app Phase 1-15 的真实事故。

---

## 守则 1：副作用清理原则

**任何调试 / 验证启动的进程、服务、文件、目录，使用完毕必须显式清理，不依赖会话结束自动回收。**

### 反 Pattern（违规案例）

| # | 行为 | 后果 |
|---|------|------|
| P1.1 | E2E 验证用 `npm run dev` 后台启动 vite，验证完不 kill | 下次 `npm run tauri dev` 端口被占，启动失败 |
| P1.2 | 临时写入 `/tmp/xxx` 不删 | 磁盘累积垃圾，权限问题 |
| P1.3 | 集成测试 spawn 子进程不 wait | 子进程成孤儿，CI 卡死 |

### 合规做法

```bash
# 启动后台进程后，立即在 cleanup 路径上注册停止逻辑
vite_pid=$(npm run dev & echo $!)
trap "kill $vite_pid 2>/dev/null" EXIT

# 或者用工具管理：concurrently / npm-run-all / trap
```

```typescript
// 测试代码：beforeEach 启动的资源必须在 afterEach 清理
beforeEach(() => { server = startServer(); });
afterEach(() => { server.close(); });  // 必须有
```

---

## 守则 2：启动健壮性原则

**dev 命令必须能在任意初始状态下工作。不假设环境干净。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| P2.1 | `vite` 默认 strictPort，端口被占直接退出 | 用户每次都得手动 kill 僵尸 |
| P2.2 | 启动失败只报错不恢复 | 用户卡住，体验崩塌 |
| P2.3 | 假设 `cargo` / `npm` 在 PATH | 切环境后命令找不到 |

### 合规做法

- 启动前预检（端口 / 依赖 / 工具链），失败时自动修复或给具体指引
- 端口冲突 → 自动 kill 占用进程 OR 自动换端口
- 工具链缺失 → 自动 `brew install` 或 `rustup install`，不直接退出
- 关键命令前加 `precheck` 钩子

```json
// package.json
{
  "scripts": {
    "predev": "bash scripts/precheck.sh",
    "dev": "vite",
    "pretauri": "bash scripts/precheck.sh",
    "tauri": "tauri"
  }
}
```

```bash
# scripts/precheck.sh
#!/usr/bin/env bash
# 检测端口 1420 占用，kill 僵尸 vite 进程
PID=$(lsof -ti:1420 2>/dev/null)
if [ -n "$PID" ]; then
  echo "[precheck] 端口 1420 被占用 (PID $PID)，自动清理"
  kill $PID 2>/dev/null
  sleep 1
fi
```

---

## 守则 3：错误恢复优先于错误报告

**遇到常见错误（端口 / 文件锁 / 权限 / 网络）时，优先尝试自动恢复，而非抛错给用户。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| P3.1 | "Port already in use" 直接退出 | 用户不知所措 |
| P3.2 | 编译缓存损坏只报错 | 用户必须手动 `rm -rf target/` |
| P3.3 | 文件锁占用直接 panic | 用户必须重启 |

### 合规做法

```rust
fn open_or_recover(path: &Path) -> Result<File> {
    match File::open(path) {
        Ok(f) => Ok(f),
        Err(e) if e.kind() == IoError::PermissionDenied => {
            // 尝试修复权限
            try_fix_permissions(path)?;
            File::open(path)  // 再试一次
        }
        Err(e) => Err(e),
    }
}
```

```typescript
async function startDevServer(maxRetry = 3) {
  for (let i = 0; i < maxRetry; i++) {
    try { return await vite(); }
    catch (e) {
      if (e.message.includes('Port')) { await killPortStaleProcesses(); continue; }
      throw e;
    }
  }
}
```

---

## 守则 4：可重现的验证流程

**任何"我验证过"的声明必须配套可重现脚本，含完整 cleanup。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| P4.1 | "我在 chrome-devtools 验证了，全过" — 没说怎么启动的 | 别人复现不了 |
| P4.2 | 验证脚本启动 5 个服务，没说怎么停 | 环境遗留垃圾 |
| P4.3 | E2E 修改了 ~/Library/Application Support/ 真实文件 | 污染用户数据 |

### 合规做法

```bash
# scripts/verify.sh
#!/usr/bin/env bash
set -e
trap cleanup EXIT

cleanup() {
  echo "[verify] 清理..."
  pkill -f "vite.*1420" 2>/dev/null || true
  pkill -f "tauri dev" 2>/dev/null || true
  unset MINDMAP_TEST_DATA_DIR  # 测试环境变量
}

# 1. 启动 vite
npm run dev &
VITE_PID=$!
sleep 3

# 2. 跑 E2E
node e2e/check-render.js

# 3. cleanup（trap 自动执行）
```

---

## 守则 5：交付前的"零假设"检查

**交付前必须验证：在干净环境（无残留进程/文件/配置）下能完整跑通。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| P5.1 | 只在"开发机当前状态"测过，没测干净环境 | 用户首次安装即崩 |
| P5.2 | 用了未提交的本地配置 | 别人 clone 后跑不起来 |
| P5.3 | 假设 `~/Library/...` 目录已存在 | 首次启动崩溃 |

### 合规做法

```bash
# scripts/verify-clean.sh
# 在干净环境下验证（不依赖任何残留状态）

TEMP_DIR=$(mktemp -d)
export MINDMAP_TEST_DATA_DIR=$TEMP_DIR
trap "rm -rf $TEMP_DIR" EXIT

# 模拟首次启动
npm run tauri dev &
# 验证应用启动 + 创建必要目录 + 初始化配置
```

---

## 守则 6：失败必须能回滚

**每次变更后用户能轻松回到上一个工作版本。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| P6.1 | 一次 commit 改 10 个 Phase | 出 bug 不知哪层导致，无法回滚 |
| P6.2 | 测试和功能代码同一 commit | 回滚功能也丢了测试 |
| P6.3 | commit message 不说"为什么"，只说"做了什么" | 回滚决策缺信息 |

### 合规做法

- 1 个独立改动 = 1 个 commit
- commit message 含：**做什么** + **为什么**（决策动机）+ **如何回滚**（关键文件）
- 大变更拆成 N 个 atomic commit，逐个可回滚

---

## 守则 7：测试必须覆盖"契约边界"

**单元测试覆盖函数级，集成测试覆盖契约边界（前后端 / 进程间 / 模块间）。**

### 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| P7.1 | 1000 个单元测试都过，但前后端字段不一致线上崩 | 契约测试缺失 |
| P7.2 | mock 了所有依赖，从不测真实链路 | bug 在集成层 |
| P7.3 | 测试数据全是 makeNode() 构造的，从不模拟后端真实输出 | 上线就崩 |

### 合规做法

```rust
// 契约测试：序列化输出必须含某字段（即使空）
#[test]
fn node_always_serializes_vec_fields() {
    let n = Node::new("x");
    let json = serde_json::to_string(&n).unwrap();
    assert!(json.contains("\"children\":["));  // 即使空也输出
}
```

```typescript
// 契约测试：模拟后端 JSON（缺字段）测试前端解析
it("处理 children 缺失（向后兼容）", () => {
  const json = '{"id":"x","topic":"t"}';  // 没 children
  const c = parseContent(json);
  expect(c.root.children).toEqual([]);  // 不应崩溃
});
```

---

## 应用：本次启动失败的根因

| 守则 | 违反 | 修复 |
|------|------|------|
| 守则 1 | E2E 验证后没 kill 后台 vite | 加 `scripts/cleanup-dev.sh` |
| 守则 2 | 启动没预检端口 | 加 `scripts/precheck.sh` + `predev` 钩子 |
| 守则 3 | 端口占用直接退出，不自动恢复 | precheck 自动 kill |
| 守则 5 | 没在干净环境验证 | 加 `scripts/verify-clean.sh` |

修复方案：scripts/precheck.sh + package.json predev 钩子。
