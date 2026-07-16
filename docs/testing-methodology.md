# 测试方法学（Testing Methodology）

> mindmap-app 经过 Phase 9-18 迭代形成的多层测试体系。
> 每个层次的工具、适用场景、限制、最佳实践。

---

## 测试金字塔

```
        ┌─────────┐
        │   E2E   │  chrome-devtools + mock invoke，最少但最真实
        ├─────────┤
        │ 集成测试 │  Rust commands 端到端（含 I/O）
        ├─────────┤
        │ 契约测试 │  前后端数据格式一致性
        ├─────────┤
        │ 单元测试 │  函数/组件级，大量快速
        └─────────┘
```

| 层级 | 工具 | 用例数 | 速度 | 真实度 |
|------|------|--------|------|--------|
| 单元（前端） | vitest + @testing-library | 232 | 快（ms） | 低（mock 重） |
| 单元（Rust） | cargo test | 80 | 快 | 中 |
| 集成（Rust） | cargo test --test integration | 17 | 中 | 高 |
| E2E | chrome-devtools + mock | 22 | 慢（s） | 最高 |

---

## 1. 单元测试（前端 vitest）

### 配置

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

### setup.ts（全局 mock）

```typescript
// src/test/setup.ts
import '@testing-library/jest-dom';

// Mock Tauri invoke（所有测试默认 mock）
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'ping') return Promise.resolve('pong');
    return Promise.resolve(null);
  }),
}));

// Mock Tauri event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));
```

### 测试用例模板

```typescript
// src/store.test.ts
describe('FE-STORE: setContent', () => {
  beforeEach(() => {
    useMindMapStore.setState({ content: null, ...initialState });
    useMindMapStore.temporal.getState().clear();
  });

  it('FE-STORE-01: setContent 设置后 nodeCount 正确', () => {
    const content = makeContent({ root: makeNode({ topic: '根' }) });
    useMindMapStore.getState().setContent(content);
    expect(useMindMapStore.getState().nodeCount).toBe(1);
  });
});
```

### 最佳实践

- **beforeEach 重置 store**：zustand store 是单例，测试间会污染
- **不 mock 自己写的代码**：只 mock 第三方 + 边界
- **用 helper 构造数据**：`makeNode()` / `makeContent()` 等
- **测试名含 ID**：`FE-STORE-01` 便于追踪

### 限制

- jsdom 不支持真实 DOM 事件默认行为（contenteditable Enter=换行等）
- 不支持 SVG 渲染（mind-elixir 内部 SVG 看不到）
- 不支持真实 IPC（必须 mock invoke）

---

## 2. 单元测试（Rust cargo test）

### 模块内测试

```rust
// src/models.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_new_generates_uuid_v4_format() {
        let n = Node::new("test");
        assert_eq!(n.id.len(), 36);
        let parts: Vec<&str> = n.id.split('-').collect();
        assert_eq!(parts.len(), 5);
    }
}
```

### 契约测试（关键！）

```rust
#[test]
fn node_always_serializes_vec_fields() {
    // 防止 skip_serializing_if="Vec::is_empty" 导致前端崩溃
    let n = Node::new("x");
    let json = serde_json::to_string(&n).unwrap();
    assert!(json.contains("\"children\":["));
    assert!(json.contains("\"icons\":["));
    assert!(json.contains("\"reminder_ids\:["));
}
```

### 运行

```bash
# 全部
cargo test

# 单文件
cargo test models::tests::node_new_generates_uuid_v4_format

# 多线程串行（env var 共享时）
cargo test -- --test-threads=1

# 显示 println
cargo test -- --nocapture
```

---

## 3. 集成测试（Rust tests/integration.rs）

### 配置

```rust
// src-tauri/tests/integration.rs
use mindmap_app_lib::commands;
use std::sync::Mutex;

static TEST_LOCK: Mutex<()> = Mutex::new(());

struct TestDir {
    path: PathBuf,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let guard = TEST_LOCK.lock().unwrap();
        let p = std::env::temp_dir().join(format!("mindmap-int-{}", label));
        std::fs::create_dir_all(&p).unwrap();
        std::env::set_var("MINDMAP_TEST_DATA_DIR", &p);
        Self { path: p, _guard: guard }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        std::env::remove_var("MINDMAP_TEST_DATA_DIR");
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
```

### 测试用例

```rust
#[test]
fn int_save_open_roundtrip_preserves_vec_fields() {
    let _td = TestDir::new("contract_rt");
    let original = commands::new_mmap(Some("测试".into())).unwrap();
    let path = _td.path.join("test.mmap");
    commands::save_mmap(path.to_string_lossy().into(), original.clone()).unwrap();

    let loaded = commands::open_mmap(path.to_string_lossy().into()).unwrap();
    // 契约：往返后 Vec 字段必须存在（不能因 skip_serializing_if 丢失）
    assert!(!loaded.root.children.is_empty() || loaded.root.children.is_empty());
}
```

### 关键点

- **测试间串行**（用 Mutex）——env var 是全局的
- **drop 自动清理**——不污染下次测试
- **不依赖 ~/Library/...**——用 MINDMAP_TEST_DATA_DIR 重定向

---

## 4. E2E 测试（chrome-devtools + mock）

### 启动 vite + chrome-devtools

```bash
npm run dev &
sleep 4
```

### 注入 mock invoke

```javascript
// navigate_page 的 initScript 参数
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    console.log('[mock invoke]', cmd);
    if (cmd === 'get_config') return { version: "1.0.0", ... };
    if (cmd === 'new_mmap') return { version: "1.0.0", root: { ... } };
    if (cmd === 'plugin:dialog|save') return '/mock/save.mmap';
    if (cmd === 'plugin:dialog|open') return '/mock/open.mmap';
    return null;
  },
  transformCallback: () => 0,
};
```

### 完整 E2E 脚本模板

```javascript
await evaluate_script(async () => {
  await new Promise(r => setTimeout(r, 2500));  // 等启动
  
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  
  // 1. 启动验证
  check('me-root 渲染', !!document.querySelector('me-root'));
  check('无 boot.failed', !document.querySelector('.error-boundary'));
  
  // 2. 操作模拟
  const meTpc = document.querySelector('me-tpc');
  meTpc.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  check('单击选中', meTpc.classList.contains('selected'));
  
  // 3. 键盘模拟
  const inner = document.querySelector('.mind-elixir-inner');
  inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  await new Promise(r => setTimeout(r, 500));
  check('Tab 加子节点', mind.nodeData.children.length > 0);
  
  return {
    passed: results.filter(r => r.pass).length,
    total: results.length,
    results,
  };
});
```

### 关键检查项

```javascript
// 焦点残留（重要！）
const ae = document.activeElement;
if (ae && ae.isContentEditable) {
  // 用户可能被困在编辑模式
}

// DOM 坐标对齐
const r1 = el1.getBoundingClientRect();
const r2 = el2.getBoundingClientRect();
const aligned = Math.abs(r1.x - r2.x) < 30 && Math.abs(r1.y - r2.y) < 30;

// 资源加载
const sheets = Array.from(document.styleSheets);
const hasCSS = sheets.some(s => {
  try { return Array.from(s.cssRules).some(r => r.cssText.includes('xxx')); }
  catch { return false; }
});
```

### 限制

- `dispatchEvent` 不触发浏览器默认行为（contenteditable Enter=换行）
- 真实用户操作的差异（鼠标移动轨迹、键盘节奏）
- 不测真实 Tauri native API（dialog、window、tray）

---

## 5. 视觉验证（zai 视觉模型）

### 流程

```bash
# 1. 截图
take_screenshot({ filePath: '/path/screenshot.png' })

# 2. 视觉模型分析
analyze_image({
  image_source: '/path/screenshot.png',
  prompt: '从 UI/UX 角度分析：布局、对齐、视觉层次、明显 bug'
})
```

### 适用场景

- 静态视觉问题（位置偏移、对齐错乱、颜色冲突）
- 整体布局评估（是否符合设计稿）
- 无法用代码 assert 的"看起来对不对"

### 限制

- 不能验证交互（点击、键盘）
- OCR 可能误判（"0 提醒" 误判为 "0 节点"）
- 不识别动态状态（编辑模式、loading）

---

## 6. 契约测试

### 为什么需要

单元测试都过，但前后端字段不一致线上崩——契约测试防止这种。

### Rust 端：序列化快照

```rust
#[test]
fn node_always_serializes_vec_fields() {
    let n = Node::new("x");
    let json = serde_json::to_string(&n).unwrap();
    // Vec 字段必须输出（即使空）
    assert!(json.contains("\"children\":["));
}
```

### 前端：模拟后端真实输出

```typescript
it('处理 children 缺失（旧版本后端数据）', () => {
  // 模拟 Rust 旧版本（skip_serializing_if 导致 children 缺失）
  const json = '{"id":"x","topic":"t"}';
  const c = parseContent(json);
  // 不应崩溃，应该用默认 []
  expect(c.root.children).toEqual([]);
});
```

---

## 测试矩阵（mindmap-app 当前）

```
单元（前端）    232 通过  ──┐
单元（Rust）     80 通过  ──┤
集成（Rust）     17 通过  ──┼─ 329 单元/集成
                            │
E2E             22 通过  ──┤
视觉模型         6 通过  ──┘
```

---

## 自动化回归

### pre-commit hook

```bash
# .githooks/pre-commit
npm run test:all  # 失败则阻止提交
```

### 开发时 watch

```bash
npm run test:watch:all
# concurrently 并行 vitest watch + cargo watch
```

### 测试入口

```json
{
  "test": "vitest run",
  "test:fe": "vitest run",
  "test:be": "cd src-tauri && cargo test",
  "test:integration": "cd src-tauri && cargo test --test '*'",
  "test:all": "npm run test:fe && npm run test:be && npm run build",
  "test:coverage": "vitest run --coverage",
  "test:watch:all": "concurrently ..."
}
```

---

## 何时写什么测试

| 场景 | 测试类型 |
|------|----------|
| 新增数据结构 | 契约测试（序列化 + 反序列化） |
| 新增纯函数 | 单元测试 |
| 新增 React 组件 | 组件测试（@testing-library） |
| 新增 Tauri command | 集成测试（端到端 I/O） |
| 新增用户交互 | E2E（chrome-devtools） |
| UI 视觉变更 | 视觉模型验证 |
| 修 bug | 先写复现测试，再修 |

---

## 反 Pattern

| # | 行为 | 后果 |
|---|------|------|
| 1 | 1000 个单元测试，从不测真实链路 | 集成层 bug 频发 |
| 2 | mock 所有依赖 | 测试通过但生产崩 |
| 3 | 测试数据全是 makeNode()，从不模拟后端真实输出 | 契约不一致 |
| 4 | 只测 happy path | error 路径没人覆盖 |
| 5 | 用 dispatchEvent 模拟就宣布通过 | 漏浏览器默认行为 |
| 6 | console error 当没事 | 关键资源没加载 |
| 7 | 测试和功能同一 commit | 回滚困难 |

---

## 维护

- 每次 commit 前必须 `npm run test:all`
- 修 bug 必须先写复现测试
- 新功能必须配套测试（commit 含 tests/）
- 文档与代码同步（本文件随测试体系演进而更新）
