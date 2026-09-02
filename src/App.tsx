import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import Toolbar from "./components/Toolbar";
import MindMapCanvas from "./components/MindMapCanvas";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import AboutModal from "./components/AboutModal";
import HotkeyHelpModal from "./components/HotkeyHelpModal";
import { GlassDialogHost, showAlert, showConfirm } from "./components/GlassDialog";
import ReminderToast from "./components/ReminderToast";
import { useMindMapStore, undo, redo, getHistoryInfo } from "./store";
import { useAutoSave } from "./hooks/useAutoSave";
import { exportPng } from "./hooks/usePngExport";
import { snapshotAnchor, keepAnchorInPlace, type AnchorSnapshot } from "./utils/canvasActions";
import { useWindowState } from "./hooks/useWindowState";
import { useSubWindowCloseGuard } from "./hooks/useSubWindowCloseGuard";
import { useMcpBridge } from "./mcp/mcpBridge";
import { initLlmBridge } from "./mcp/operationBridge";
import LlmSessionBanner from "./components/LlmSessionBanner";
import LlmOperationHistory from "./components/LlmOperationHistory";
import {
  initDevLogger,
  logUserAction,
  logState,
} from "./utils/devLogger";
import { isTauri, warnBrowserModeOnce } from "./utils/tauriEnv";
import type { Config, Content, Priority, Reminder } from "./types";
import "./theme/tokens.css";
import "./App.css";

// 模块加载时初始化 dev 日志
initDevLogger();
warnBrowserModeOnce();

function App() {
  const [booted, setBooted] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [hotkeyHelpOpen, setHotkeyHelpOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResultIds, setSearchResultIds] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const setContent = useMindMapStore((s) => s.setContent);
  const setFilePath = useMindMapStore((s) => s.setFilePath);
  const setConfig = useMindMapStore((s) => s.setConfig);
  const setAllReminders = useMindMapStore((s) => s.setAllReminders);
  const mindInstanceRef = useRef<any>(null);

  // 启用自动保存（防抖 2 秒）
  useAutoSave();
  // 启用窗口状态恢复/保存
  useWindowState();
  // 启用 MCP 桥接(推送状态到后端 MCP server)
  useMcpBridge();

  // 启用 LLM operation bridge(订阅 llm-operation 事件)
  useEffect(() => {
    initLlmBridge().catch(console.error);
  }, []);

  // === 节点默认样式生效链路(config.ui → CSS 变量,保存后即时生效) ===
  // font_family/font_size 原本只有配置与 UI,从未应用(半成品链路,本次补全);
  // font_color 为新增。空 font_family = 继承系统字体栈;font_color 空 = 主题默认。
  const uiPrefs = useMindMapStore((s) => s.config?.ui);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--node-font-size", `${uiPrefs?.font_size ?? 14}px`);
    root.style.setProperty("--node-font-family", uiPrefs?.font_family?.trim() || "inherit");
    root.style.setProperty("--node-color", uiPrefs?.font_color?.trim() || "#f2f4f7");
  }, [uiPrefs?.font_size, uiPrefs?.font_family, uiPrefs?.font_color]);

  // LLM 持锁时锁定画布(加 llm-active class)
  const llmSession = useMindMapStore((s) => s.llmSession);
  useEffect(() => {
    const inner = document.querySelector(".mind-elixir-inner");
    if (!inner) return;
    if (llmSession?.session) {
      inner.classList.add("llm-active");
    } else {
      inner.classList.remove("llm-active");
    }
  }, [llmSession]);

  // 全局快捷键：Cmd+Z 撤销 / Cmd+Shift+Z 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        const info = getHistoryInfo();
        if (info.canUndo) {
          logUserAction("keyboard.undo", { canUndo: info.undoCount });
          undo();
        }
      } else if (key === "z" && e.shiftKey) {
        e.preventDefault();
        const info = getHistoryInfo();
        if (info.canRedo) {
          logUserAction("keyboard.redo", { canRedo: info.redoCount });
          redo();
        }
      } else if (key === "y" && !e.shiftKey) {
        e.preventDefault();
        const info = getHistoryInfo();
        if (info.canRedo) redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 多窗口模式:根据 URL 参数决定加载哪个文档
  // 主窗口(label="main"):恢复 last_opened_file 或显示空
  // 子窗口(label="doc-N"):按 URL ?mode=open&mmap=/path 或 ?mode=new 加载
  useEffect(() => {
    (async () => {
      try {
        // 浏览器模式(无 Tauri 运行时):跳过所有 IPC,让 UI 显式失败(画布空白)
        // 友好提示已在 warnBrowserModeOnce() 给出
        if (!isTauri()) {
          return;
        }
        const cfg = await invoke<Config>("get_config");
        setConfig(cfg);

        // 解析当前窗口 label + URL 参数
        // mock 环境(getCurrentWindow 可能 throw)容错:默认 "main"
        let label = "main";
        try {
          label = getCurrentWindow().label;
        } catch {
          // 浏览器/测试环境
        }
        const url = new URL(window.location.href);
        const mode = url.searchParams.get("mode");
        const mmapPath = url.searchParams.get("mmap");
        logState("window.boot", { label, mode, mmapPath });

        if (label === "main" && !mode) {
          // 主窗口无参数:恢复 last_opened_file
          let restored = false;
          if (cfg.last_opened_file) {
            const exists = await invoke<boolean>("path_exists", { path: cfg.last_opened_file });
            if (exists) {
              try {
                const c = await invoke<Content>("open_mmap", { path: cfg.last_opened_file });
                setContent(c);
                setFilePath(cfg.last_opened_file);
                restored = true;
              } catch (e) {
                console.error("[App] 主窗口恢复上次文件失败", e);
              }
            }
          }
          if (!restored) {
            const c = await invoke<Content>("new_mmap", { topic: "中心主题" });
            setContent(c);
            setFilePath(null);
          }
        } else if (mode === "open" && mmapPath) {
          // 子窗口打开已有文件
          const c = await invoke<Content>("open_mmap", { path: mmapPath });
          setContent(c);
          setFilePath(mmapPath);
          try {
            await getCurrentWindow().setTitle(`思维导图 - ${mmapPath.split("/").pop()}`);
          } catch {
            // 测试环境忽略
          }
        } else {
          // 子窗口新建空白(mode === "new" 或无参)
          const c = await invoke<Content>("new_mmap", { topic: "中心主题" });
          setContent(c);
          setFilePath(null);
          if (label !== "main") {
            try {
              await getCurrentWindow().setTitle("思维导图 - 新建文档");
            } catch {
              // 测试环境忽略
            }
          }
        }
      } catch (e) {
        console.error("[App] 启动失败", e);
      } finally {
        setBooted(true);
      }
    })();
  }, [setContent, setFilePath, setConfig]);


  // === 加载全局 reminders(每窗口都加载,用于画布渲染沙漏) ===
  // 多窗口模式:每窗口都需要画布沙漏标识,所以每窗口都加载 reminders 全量
  // 但**只在主窗口启动 60s 定时器**(避免 N 窗口 N 个定时器并发请求)
  useEffect(() => {
    let timer: number | undefined;
    if (!isTauri()) return;
    const load = async () => {
      try {
        const idx = await invoke<{ reminders: Reminder[] }>("get_reminders");
        setAllReminders(idx.reminders || []);
      } catch (e) {
        console.warn("[App] 加载 reminders 失败", e);
      }
    };
    load();
    // 只主窗口启动定时器(mock 环境容错)
    let label = "main";
    try { label = getCurrentWindow().label; } catch {}
    if (label === "main") {
      timer = window.setInterval(load, 60_000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [setAllReminders]);

  // === 子窗口关闭按钮处理(关键修复,OB-016 / VP-MULTIWINDOW-CLOSE)===
  // 历史 bug:7b21334(关闭按钮失效) / 4886a58(close 无限循环)
  // 修复:前端主动监听 close request,子窗口强制 destroy(绕过 Tauri 默认流程)
  // 详见 useSubWindowCloseGuard 的回归测试
  useSubWindowCloseGuard();

  // === 原生菜单动作分发(F2 单导航:macOS 系统菜单 → menu-action 事件桥) ===
  // Rust 侧 on_menu_event 定向 emit 到焦点窗口;此处映射到既有 handler。
  // handlers 经 ref 保持最新(effect 只挂载一次)。
  const menuActionsRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        un = await listen<string>("prefs-updated", async () => {
          try {
            const cfg = await invoke<Config>("get_config");
            setConfig(cfg);
          } catch { /* 忽略 */ }
        });
        un = await listen<string>("menu-action", (ev) => {
          try {
            const id = ev.payload;
            if (id.startsWith("open-recent:")) {
              const st = useMindMapStore.getState();
              void import("./utils/openRecentFile").then(({ openRecentFile }) =>
                openRecentFile(id.slice("open-recent:".length), st.dirty, {
                  invoke: invoke as any,
                }).catch((e) => {
                  console.error("[menu] 打开最近文件失败", e);
                  void showAlert("打开失败", String(e), "error");
                }),
              );
              return;
            }
            menuActionsRef.current[id]?.();
          } catch (err) {
            console.error("[menu] 动作执行失败", ev.payload, err);
          }
        });
      } catch (e) {
        console.warn("[menu] 事件监听不可用", e);
      }
    })();
    return () => un?.();
  }, []);

  // 多窗口模式:点"新建"创建新窗口(当前窗口不动)
  // 这是 XMind 模式 — 每个文档独立窗口
  const handleNew = async () => {
    try {
      await invoke("create_new_window", { mode: "new", mmapPath: null });
    } catch (e) {
      console.error("[App] 创建新窗口失败", e);
      void showAlert("创建新窗口失败", String(e), "error");
    }
  };

  // 多窗口模式:点"打开"在**新窗口**打开文件(当前窗口不动)
  const handleOpen = async () => {
    const state0 = useMindMapStore.getState();
    if (state0.dirty && !(await showConfirm("当前文档有未保存的修改", { message: "是否继续打开?", danger: true, confirmText: "继续打开" }))) return;
    const cfg = state0.config;
    const selected = await openDialog({
      defaultPath: cfg?.last_open_dir ?? undefined,
      filters: [{ name: "思维导图", extensions: ["mmap"] }],
      multiple: false,
    });
    if (typeof selected !== "string" || !selected) return;
    try {
      // 检查是否已有窗口打开同文件(避免多窗口编辑同文件冲突)
      const windows = await invoke<Array<{ label: string; title: string }>>("list_windows");
      const title = selected.split("/").pop()?.replace(/\.mmap$/, "") || "未命名";
      // 简单匹配:窗口 title 包含文件 stem
      const existing = windows.find((w) => w.title.includes(title));
      if (existing) {
        // 已有窗口,激活它
        await invoke("focus_window", { label: existing.label });
        return;
      }
      // 记录最近文件 + 创建新窗口
      await invoke("add_recent_file", { path: selected, name: title });
      await invoke("set_last_opened_file", { path: selected });
      invoke("rebuild_menu").catch(() => {});   // 刷新系统菜单最近文件子菜单
      const dir = selected.split("/").slice(0, -1).join("/");
      await invoke("update_last_dirs", { openDir: dir, exportDir: null, importDir: null });
      await invoke("create_new_window", { mode: "open", mmapPath: selected });
    } catch (e) {
      console.error("[App] 打开失败", e);
      await showAlert("打开失败", String(e), "error");
    }
  };

  const handleSave = async () => {
    const state = useMindMapStore.getState();
    const c = state.content;
    if (!c) return;
    let path = state.filePath;
    try {
      if (!path) {
        const cfg = state.config;
        const defaultName = "新建思维导图.mmap";
        const defaultPath = cfg?.default_new_file_dir
          ? `${cfg.default_new_file_dir}/${defaultName}`
          : defaultName;
        const selected = await saveDialog({
          defaultPath: defaultPath,
          filters: [{ name: "思维导图", extensions: ["mmap"] }],
        });
        if (!selected) return;
        path = selected;
        setFilePath(selected);
      }
      state.setSaveStatus("saving");
      // ★ 关键:invoke 写盘和后续 markSaved 判断必须用同一个引用
      // 否则 saveDialog 期间 store.content 变化会导致"写了旧的、判断用新的"→ 误 markSaved → 数据丢失
      const contentRefAtInvokeStart = useMindMapStore.getState().content;
      if (!contentRefAtInvokeStart) return;
      await invoke("save_mmap", { path, content: contentRefAtInvokeStart });
      // ★ 只在 content 引用未变时才 markSaved
      // 否则 invoke 期间发生的新改动会被"已保存"误覆盖,useAutoSave 永远不会再保存
      const after = useMindMapStore.getState();
      if (after.content === contentRefAtInvokeStart) {
        after.markSaved();
      } else {
        // invoke 期间检测到新改动:只更新 saveStatus,保留 dirty=true
        // useAutoSave 会基于 dirty=true 继续防抖保存新内容
        after.setSaveStatus("saved");
        console.warn("[save] invoke 期间检测到新改动,保留 dirty=true 等待下次自动保存");
      }
      // 添加到最近文件
      const name = path.split("/").pop()?.replace(/\.mmap$/, "") || "未命名";
      await invoke("add_recent_file", { path, name });
      await invoke("set_last_opened_file", { path });
      invoke("rebuild_menu").catch(() => {});   // 刷新系统菜单最近文件子菜单
    } catch (e) {
      console.error("[App] 保存失败", e);
      state.setSaveStatus("error");
      await showAlert("保存失败", String(e), "error");
    }
  };

  const handleSetPriority = (p: Priority) => {
    const state = useMindMapStore.getState();
    if (!state.content) {
      void showAlert("未打开文档", "请先新建或打开一个文档");
      return;
    }
    if (!state.selectedNodeId) {
      void showAlert("未选中节点", "请先选中一个节点");
      return;
    }
    // 再次点击相同优先级 → 清除
    const current = findNodePriority(state.content.root, state.selectedNodeId);
    const next: Priority | null = current === p ? null : p;
    state.setPriorityForSelected(next);
  };

  // === 搜索 ===
  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResultIds([]);
      setSearchIndex(0);
      return;
    }
    const lower = q.toLowerCase();
    const results: string[] = [];
    const walk = (node: any) => {
      if (node.topic?.toLowerCase().includes(lower)) {
        results.push(node.id);
      }
      for (const c of node.children || []) walk(c);
    };
    const content = useMindMapStore.getState().content;
    if (content) walk(content.root);
    setSearchResultIds(results);
    setSearchIndex(0);
    // 跳到第一个匹配
    if (results.length > 0) {
      const mind = useMindMapStore.getState().mindInstance;
      if (mind?.findEle) {
        try {
          const tpc = mind.findEle(results[0]);
          if (tpc) {
            mind.selectNode(tpc);
            if (mind.scrollIntoView) mind.scrollIntoView(tpc);
          }
        } catch {}
      }
    }
  };

  const handleSearchNext = () => {
    if (searchResultIds.length === 0) return;
    const next = (searchIndex + 1) % searchResultIds.length;
    setSearchIndex(next);
    const mind = useMindMapStore.getState().mindInstance;
    if (mind?.findEle) {
      try {
        const tpc = mind.findEle(searchResultIds[next]);
        if (tpc) {
          mind.selectNode(tpc);
          if (mind.scrollIntoView) mind.scrollIntoView(tpc);
        }
      } catch {}
    }
  };

  // === SVG 导出 ===
  const handleExportSvg = async () => {
    try {
      const mind = mindInstanceRef.current;
      const state = useMindMapStore.getState();
      if (!mind?.exportSvg || !state.content) {
        await showAlert("无法导出 SVG");
        return;
      }
      const blob = mind.exportSvg();
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));
      const filePath = await saveDialog({
        defaultPath: `${state.content.root.topic || "思维导图"}.svg`,
        filters: [{ name: "SVG", extensions: ["svg"] }],
      });
      if (!filePath) return;
      await invoke("save_bytes", { path: filePath, data: bytes });
      const dir = filePath.split("/").slice(0, -1).join("/");
      await invoke("update_last_dirs", { openDir: null, exportDir: dir, importDir: null });
    } catch (e) {
      console.error("[App] SVG 导出失败", e);
      await showAlert("SVG 导出失败", String(e), "error");
    }
  };

  const handleExportPng = async () => {
    try {
      const result = await exportPng(mindInstanceRef.current);
      if (result) {
        logUserAction("export.png.done", { result });
      }
    } catch (e) {
      console.error("[App] PNG 导出失败", e);
      await showAlert("PNG 导出失败", String(e), "error");
    }
  };

  const handleExportMarkdown = async () => {
    const state = useMindMapStore.getState();
    if (!state.content) return;
    try {
      const md = await invoke<string>("export_markdown", { content: state.content });
      const defaultName = `${state.content.root.topic || "思维导图"}.md`;
      const defaultPath = state.config?.last_export_dir
        ? `${state.config.last_export_dir}/${defaultName}`
        : defaultName;
      const filePath = await saveDialog({
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!filePath) return;
      const bytes = new TextEncoder().encode(md);
      await invoke("save_bytes", {
        path: filePath,
        data: Array.from(bytes),
      });
      const dir = filePath.split("/").slice(0, -1).join("/");
      if (dir) {
        await invoke("update_last_dirs", {
          openDir: null,
          exportDir: dir,
          importDir: null,
        });
      }
    } catch (e) {
      console.error("[App] Markdown 导出失败", e);
      await showAlert("Markdown 导出失败", String(e), "error");
    }
  };

  const handleImportMarkdown = async () => {
    const state = useMindMapStore.getState();
    try {
      const selected = await openDialog({
        defaultPath: state.config?.last_import_dir ?? undefined,
        filters: [{ name: "Markdown", extensions: ["md"] }],
        multiple: false,
      });
      if (typeof selected !== "string" || !selected) return;
      const c = await invoke<Content>("import_markdown_file", { path: selected });
      setContent(c);
      setFilePath(null);
      const dir = selected.split("/").slice(0, -1).join("/");
      if (dir) {
        await invoke("update_last_dirs", {
          openDir: null,
          exportDir: null,
          importDir: dir,
        });
      }
    } catch (e) {
      console.error("[App] Markdown 导入失败", e);
      await showAlert("Markdown 导入失败", String(e), "error");
    }
  };

  // Phase 11.2 OPML
  const handleExportOpml = async () => {
    const state = useMindMapStore.getState();
    if (!state.content) return;
    try {
      const opml = await invoke<string>("export_opml", { content: state.content });
      const defaultName = `${state.content.root.topic || "思维导图"}.opml`;
      const defaultPath = state.config?.last_export_dir
        ? `${state.config.last_export_dir}/${defaultName}`
        : defaultName;
      const filePath = await saveDialog({
        defaultPath,
        filters: [{ name: "OPML", extensions: ["opml"] }],
      });
      if (!filePath) return;
      const bytes = new TextEncoder().encode(opml);
      await invoke("save_bytes", {
        path: filePath,
        data: Array.from(bytes),
      });
      const dir = filePath.split("/").slice(0, -1).join("/");
      if (dir) {
        await invoke("update_last_dirs", {
          openDir: null,
          exportDir: dir,
          importDir: null,
        });
      }
    } catch (e) {
      console.error("[App] OPML 导出失败", e);
      await showAlert("OPML 导出失败", String(e), "error");
    }
  };

  const handleImportOpml = async () => {
    const state = useMindMapStore.getState();
    try {
      const selected = await openDialog({
        defaultPath: state.config?.last_import_dir ?? undefined,
        filters: [{ name: "OPML", extensions: ["opml"] }],
        multiple: false,
      });
      if (typeof selected !== "string" || !selected) return;
      const c = await invoke<Content>("import_opml_file", { path: selected });
      setContent(c);
      setFilePath(null);
      const dir = selected.split("/").slice(0, -1).join("/");
      if (dir) {
        await invoke("update_last_dirs", {
          openDir: null,
          exportDir: null,
          importDir: dir,
        });
      }
    } catch (e) {
      console.error("[App] OPML 导入失败", e);
      await showAlert("OPML 导入失败", String(e), "error");
    }
  };

  menuActionsRef.current = {
    new: handleNew,
    open: handleOpen,
    save: handleSave,
    "export-png": handleExportPng,
    "export-svg": handleExportSvg,
    "export-markdown": handleExportMarkdown,
    "export-opml": handleExportOpml,
    "import-markdown": handleImportMarkdown,
    "import-opml": handleImportOpml,
    "prio-p0": () => handleSetPriority("P0"),
    "prio-p1": () => handleSetPriority("P1"),
    "prio-p2": () => handleSetPriority("P2"),
    "prio-p3": () => handleSetPriority("P3"),
    about: () => setAboutOpen(true),
    hotkeys: () => setHotkeyHelpOpen(true),
    prefs: () => { invoke("open_preference_window").catch((e) => console.error("[menu] 打开偏好设置失败", e)); },
    undo: () => undo(),
    redo: () => redo(),
    "toggle-sidebar": () => useMindMapStore.getState().toggleSidebar(),
    "edit-text": () => {
      const mind = useMindMapStore.getState().mindInstance;
      const s = getSelectedNode(mind);
      if (mind && s) { mind.selectNode?.(s); mind.beginEdit(s); }
    },
    "delete-node": () => {
      const mind = useMindMapStore.getState().mindInstance;
      const s = getSelectedNode(mind);
      if (mind && s && s.tagName !== "ME-ROOT") mind.removeNodes(mind.currentNodes || [s]);
    },
    "add-child": () => {
      const mind = useMindMapStore.getState().mindInstance;
      const s = getSelectedNode(mind);
      if (mind && s) {
        const anchor = snapshotAnchor(s as HTMLElement);
        mind.addChild(s);
        settleCanvasFocus(anchor);
      }
    },
    "add-sibling": () => {
      const mind = useMindMapStore.getState().mindInstance;
      const s = getSelectedNode(mind);
      if (mind && s && s.tagName !== "ME-ROOT") {
        const anchor = snapshotAnchor(s as HTMLElement);
        mind.insertSibling("after", s);
        settleCanvasFocus(anchor);
      }
    },
    "auto-layout": () => {
      const mind = useMindMapStore.getState().mindInstance;
      if (mind?.layout) { mind.layout(); if (mind.toCenter) mind.toCenter(); }
    },
  };

  if (!booted) {
    return <div className="app-booting">加载中...</div>;
  }

  return (
    <div className="app-root">
      {/* 舞台装饰层:三枚同族冷色光斑 + 点阵 + 渐晕(z-index 0,内容 z-index 1+) */}
      <div className="stage-fx" aria-hidden="true">
        <div className="glow-orb orb-blue"></div>
        <div className="glow-orb orb-purple"></div>
        <div className="glow-orb orb-green"></div>
        <div className="dot-grid"></div>
        <div className="vignette"></div>
      </div>
      <Toolbar
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onSearchNext={handleSearchNext}
        searchResultCount={searchResultIds.length}
        searchCurrentIndex={searchIndex}
      />
      <div className="app-main">
        <MindMapCanvas
          onCreateInstance={(mind) => {
            mindInstanceRef.current = mind;
          }}
        />
        <Sidebar />
      </div>
      <StatusBar />
      <GlassDialogHost />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <HotkeyHelpModal open={hotkeyHelpOpen} onClose={() => setHotkeyHelpOpen(false)} />
      <ReminderToast />
      <LlmSessionBanner />
      <LlmOperationHistory />
    </div>
  );
}

/** 菜单动作 helper:当前选中节点(currentNodes 优先,fallback DOM selected) */
function getSelectedNode(mind: any): any | null {
  const cn = mind?.currentNodes;
  if (Array.isArray(cn) && cn.length > 0) return cn[0];
  return document.querySelector("me-tpc.selected") as any;
}

/** 添加节点后:关闭编辑框 + 焦点归还 + 位置保持补偿(画布纹丝不动) */
function settleCanvasFocus(anchor?: AnchorSnapshot) {
  setTimeout(() => {
    const ib = document.querySelector("#input-box") as HTMLElement | null;
    if (ib) ib.blur();
    const mc = document.querySelector(".map-container") as HTMLElement | null;
    if (mc) mc.focus({ preventScroll: true }); // 视图主权:焦点归还绝不带动滚动
    // ★ 视图主权公理:内容操作永不移动画布;anchor 为创建前快照,
    // 此处反向平移恰好抵消 5.14 layout 推飞 → 净位移为零
    if (anchor) {
      const inner = document.querySelector(".mind-elixir-inner") as HTMLElement | null;
      const mind = useMindMapStore.getState().mindInstance;
      if (inner) keepAnchorInPlace(mind, inner, anchor);
    }
  }, 60);
}

/** 查找指定 id 节点的优先级 */
function findNodePriority(
  root: { id: string; priority?: Priority; children?: any[] },
  id: string,
): Priority | undefined {
  if (root.id === id) return root.priority;
  const children = root.children ?? [];
  for (const c of children) {
    const p = findNodePriority(c, id);
    if (p !== undefined || c.id === id) return p;
  }
  return undefined;
}

export default App;
