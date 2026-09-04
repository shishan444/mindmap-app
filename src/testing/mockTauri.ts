/* ============================================================
   mockTauri — 测试模式的 Tauri 运行时模拟(L2 测试基建)
   ============================================================
   背景(测试重构方案 Phase 2):
   - 应用 409 个单元测试全绿却挡不住 Tab bug——jsdom 无 layout,
     画布交互层 0 覆盖;Playwright 是黑盒真页面,无法 vi.mock。
   - 唯一出路:mock 实现活在应用代码里,浏览器测试(vitest browser
     mode)与端到端(Playwright)共用同一套基建。

   原理:
   isTauri() 检测 window.__TAURI_INTERNALS__(tauriEnv.ts),@tauri-apps/api
   的 invoke/transformCallback/convertFileSrc 也全部读它。在 main.tsx
   加载任何应用模块之前安装 mock internals → 应用完整走 Tauri 分支,
   全部 IPC 由本文件的 in-memory 命令表分发。

   测试钩子:window.__testMock 暴露调用记录/内存文件系统/配置,
   供 E2E 断言(不依赖 UI 呈现)。

   ⚠ 生产零开销:仅 ?testMode=1 时安装(见 installMockTauri.ts)。
   ============================================================ */

import type { AttachedFile, Config, Content, MindNode } from "../types";

/** 默认测试文档路径(config.last_opened_file 指向它,App 启动即恢复) */
export const TEST_DOC_PATH = "/test/e2e-deep-tree.mmap";

/** 预置深树:根 → 3 子女各 2 子女各 1 子女(深度 3)。
 * 关键设计:树深 ≥3 才会触发 mind-elixir 5.14 addChild 的 layout
 * 全树重排(当年 Tab bug"第二次推飞"的现场)。测试文档若只有浅树,
 * 键盘族用例会静默绕过推飞路径——假绿。 */
function deepTestTree(): MindNode {
  const n = (id: string, topic: string, children: MindNode[] = []): MindNode => ({
    id,
    topic,
    icons: [],
    children,
  });
  return n("root", "中心主题", [
    n("t1", "主题一", [n("t1-1", "要点 1-1", [n("t1-1-1", "细节 1-1-1")]), n("t1-2", "要点 1-2")]),
    n("t2", "主题二", [n("t2-1", "要点 2-1", [n("t2-1-1", "细节 2-1-1")]), n("t2-2", "要点 2-2")]),
    n("t3", "主题三", [n("t3-1", "要点 3-1")]),
  ]);
}

// 注:无视 new_mmap 的 topic 参数——测试文档永远预置深树(见 deepTestTree 注释)
function makeFreshContent(): Content {
  return {
    version: "1.0.0",
    root: deepTestTree(), // new_mmap 传 topic 也不影响:预置深树优先于单节点
    canvas_state: { zoom: 1, pan_x: 0, pan_y: 0, selected_node_id: "root" },
  };
}

function makeConfig(): Config {
  return {
    version: "1.0.0",
    last_open_dir: "/test",
    last_export_dir: "/test",
    last_import_dir: "/test",
    default_new_file_dir: "/test",
    last_opened_file: TEST_DOC_PATH,
    window_state: {
      x: 100,
      y: 100,
      width: 1440,
      height: 900,
      is_maximized: false,
      sidebar_width: 260,
      sidebar_collapsed: false,
      active_tab: "properties",
    },
    ui: {
      theme: "dark",
      language: "zh-CN",
      font_family: "",
      font_size: 14,
      show_minimap: false,
      show_toolbar: true,
    },
    auto_save_interval_sec: 2,
    recent_files_max: 20,
    reminder: {
      sound_enabled: false,
      sound_file: "",
      default_priority: "P2",
      snooze_minutes: 10,
      show_modal_when_background: false,
      system_notification_enabled: false,
    },
    export: { png_scale: 2, markdown_indent: "  " },
    mcp: { enabled: false, port: 23456, default_ttl_sec: 60 },
  };
}

/** 每次调用的记录(E2E 断言 save_mmap 次数等) */
export interface MockCall {
  cmd: string;
  args: unknown;
  t: number;
}

/** E2E 断言钩子:window.__testMock */
export interface TestMockHooks {
  calls: MockCall[];
  fs: Map<string, Content>;
  config: Config;
  callsOf(cmd: string): MockCall[];
  reset(): void;
  /** 模拟 Tauri 事件派发(如 emit("menu-action", "hotkeys") 等价于用户点了菜单) */
  emit(event: string, payload?: unknown): void;
  /** 便捷:派发原生菜单动作 */
  emitMenuAction(action: string): void;
}

export function createMockTauri(): { internals: unknown; hooks: TestMockHooks } {
  const fs = new Map<string, Content>();
  fs.set(TEST_DOC_PATH, makeFreshContent());
  const config = makeConfig();
  const calls: MockCall[] = [];
  let callbackId = 0;
  // 事件通道:listen 注册的 handler(transformCallback 表)+ 事件名映射
  const callbackFns = new Map<number, (event: unknown) => void>();
  const eventHandlers = new Map<string, Set<number>>(); // event → callback ids

  const record = (cmd: string, args: unknown): void => {
    // 快照深拷贝,防止后续对同一对象的修改污染历史记录
    let snapshot: unknown;
    try {
      snapshot = structuredClone(args);
    } catch {
      snapshot = args;
    }
    calls.push({ cmd, args: snapshot, t: Date.now() });
  };

  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    record(cmd, args);
    switch (cmd) {
      // ---- 文档生命周期(数据族用例的往返对象) ----
      case "get_config":
        return structuredClone(config);
      case "new_mmap":
        return makeFreshContent();
      case "open_mmap": {
        const c = fs.get(args.path as string);
        if (!c) throw new Error(`[testMode] 文件不存在: ${String(args.path)}`);
        return structuredClone(c);
      }
      case "save_mmap":
        fs.set(args.path as string, structuredClone(args.content) as Content);
        return null;
      case "path_exists":
        return fs.has(args.path as string);
      case "set_last_opened_file":
        config.last_opened_file = (args.path as string) ?? null;
        return null;
      case "add_recent_file":
      case "update_last_dirs":
        return null;

      // ---- 提醒 / MCP ----
      case "get_reminders":
        return { reminders: [] };
      case "mcp_update_state":
      case "log_event":
        return null;
      case "llm_force_release":
        // 对齐 Rust 真实行为:释放后广播 llm-session-changed(forced),
        // 前端 banner 消失、画布解锁——E2E 的接管旅程依赖这个闭环
        emit("llm-session-changed", { session: null, reason: "forced" });
        return null;

      // ---- 窗口 ----
      case "list_windows":
        return [{ label: "main", title: "思维导图" }];
      case "create_new_window":
      case "focus_window":
      case "open_preference_window":
      case "rebuild_menu":
        return null;

      // ---- 配置 ----
      case "save_config_command":
        Object.assign(config, args.cfg);
        return null;

      // ---- 附件 ----
      case "attach_file_to_node": {
        const name = String(args.file_path ?? "").split("/").pop() ?? "file";
        const attached: AttachedFile = {
          uuid: `mock-${Date.now()}-${callbackId++}`,
          original_name: name,
          ext: name.includes(".") ? name.split(".").pop()! : "",
          file_type: "other",
          size_bytes: 0,
          attached_at: new Date().toISOString(),
        };
        return attached;
      }
      case "remove_attached_file":
      case "replace_attached_file":
      case "open_attached_file":
      case "reveal_attached_file":
        return null;
      case "read_thumbnail":
        return null;

      // ---- 导入导出(mock 只保证管道通,不做真转换) ----
      case "export_markdown":
        return "# mock 导出\n\n- 中心主题\n";
      case "export_opml":
        return '<?xml version="1.0"?><opml version="2.0"><body/></opml>';
      case "import_markdown_file":
      case "import_opml_file":
        throw new Error("[testMode] 导入未模拟:请走 save/open 往返用例");
      case "save_bytes":
        return null;
      case "__echo":
        return args;

      // ---- 插件通道:event listen 注册到表(emit 钩子可派发) ----
      default:
        // 文件对话框:save 返回默认路径(打通导出管道的 save_bytes 环节),
        // open 返回取消(路径不存在的文件会导致 open_mmap 失败)
        if (cmd === "plugin:dialog|save") {
          return (args.defaultPath as string) ?? "/test/dialog-export.md";
        }
        if (cmd === "plugin:dialog|open") return null;
        if (cmd.startsWith("plugin:event|listen")) {
          // ★ args.handler 是 transformCallback 已注册的回调 id——
          //   事件注册必须用它作键(生成新 id 会与真实回调错位,emit 打不中)
          const id = Number(args.handler ?? ++callbackId);
          const ev = String(args.event ?? "");
          if (!eventHandlers.has(ev)) eventHandlers.set(ev, new Set());
          eventHandlers.get(ev)!.add(id);
          return id;
        }
        if (cmd.startsWith("plugin:event|unlisten")) {
          const id = Number(args.eventId ?? -1);
          callbackFns.delete(id);
          for (const set of eventHandlers.values()) set.delete(id);
          return null;
        }
        if (cmd.startsWith("plugin:")) return null;
        console.warn(`[testMode] 未实现的命令: ${cmd}`, args);
        return null;
    }
  };

  const transformCallback = (
    callback: (event: unknown) => void,
    once = false,
  ): number => {
    // 真存表:emit 钩子派发时按 id 调用,事件链与应用真实行为一致
    const id = ++callbackId;
    callbackFns.set(id, once ? callback : callback);
    return id;
  };

  const emit = (event: string, payload?: unknown): void => {
    const ids = eventHandlers.get(event);
    if (!ids) {
      console.warn(`[testMode] emit:无 listener(${event})`);
      return;
    }
    for (const id of ids) {
      const fn = callbackFns.get(id);
      if (fn) {
        try {
          fn({ event, id, payload });
        } catch (e) {
          console.error(`[testMode] emit handler 错误(${event})`, e);
        }
      }
    }
  };

  const internals = {
    invoke,
    transformCallback,
    unregisterCallback: () => undefined,
    convertFileSrc: (path: string) => `mock-asset://${path}`,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", window: { label: "main" } },
    },
    plugins: {},
  };

  const hooks: TestMockHooks = {
    calls,
    fs,
    config,
    callsOf: (cmd: string) => calls.filter((c) => c.cmd === cmd),
    reset: () => {
      calls.length = 0;
      fs.clear();
      fs.set(TEST_DOC_PATH, makeFreshContent());
      Object.assign(config, makeConfig());
    },
    emit,
    emitMenuAction: (action: string) => emit("menu-action", action),
  };

  return { internals, hooks };
}
