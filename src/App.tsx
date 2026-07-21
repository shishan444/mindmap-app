import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import Toolbar from "./components/Toolbar";
import MindMapCanvas from "./components/MindMapCanvas";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import PreferencesModal from "./components/PreferencesModal";
import ReminderToast from "./components/ReminderToast";
import { useMindMapStore, undo, redo, getHistoryInfo } from "./store";
import { useAutoSave } from "./hooks/useAutoSave";
import { exportPng } from "./hooks/usePngExport";
import { useWindowState } from "./hooks/useWindowState";
import {
  initDevLogger,
  logUserAction,
  logState,
} from "./utils/devLogger";
import type { Config, Content, Priority, Reminder } from "./types";
import "./App.css";

// 模块加载时初始化 dev 日志
initDevLogger();

function App() {
  const [booted, setBooted] = useState(false);
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

  // === 子窗口关闭按钮处理(关键修复)===
  // bug:用户报告子窗口关闭按钮无法关闭,只能 kill 进程
  // 根因:Rust 全局 on_window_event 对动态创建的子窗口触发不可靠
  // 修复:前端主动监听 close request,子窗口强制 destroy(绕过 Tauri 默认流程)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const win = getCurrentWindow();
        const label = win.label;
        console.log("[App][close-watch] useEffect 触发, label=", label);
        if (label === "main") {
          console.log("[App][close-watch] 主窗口,跳过子窗口 close 监听");
          return;
        }
        console.log("[App][close-watch] 子窗口,注册 onCloseRequested");
        unlisten = await win.onCloseRequested(async (event) => {
          console.log("[App][close-watch] onCloseRequested 触发, label=", label);
          event.preventDefault();
          try {
            console.log("[App][close-watch] 调用 win.destroy()");
            await win.destroy();
            console.log("[App][close-watch] destroy 成功");
          } catch (e) {
            console.error("[App][close-watch] destroy 失败", e);
            try {
              console.log("[App][close-watch] fallback 调用 win.close()");
              await win.close();
            } catch (e2) {
              console.error("[App][close-watch] close 也失败", e2);
            }
          }
        });
        console.log("[App][close-watch] onCloseRequested 注册成功, unlisten=", typeof unlisten);

        // 兜底:暴露一个手动关闭函数到 window,用户可通过 DevTools console 调用
        (window as any).__forceCloseWindow = async () => {
          console.log("[App][close-watch] 手动触发 __forceCloseWindow");
          try { await win.destroy(); } catch (e) { console.error(e); }
        };
      } catch (e) {
        console.warn("[App][close-watch] 注册失败", e);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 多窗口模式:点"新建"创建新窗口(当前窗口不动)
  // 这是 XMind 模式 — 每个文档独立窗口
  const handleNew = async () => {
    try {
      await invoke("create_new_window", { mode: "new", mmapPath: null });
    } catch (e) {
      console.error("[App] 创建新窗口失败", e);
      alert("创建新窗口失败: " + e);
    }
  };

  // 多窗口模式:点"打开"在**新窗口**打开文件(当前窗口不动)
  const handleOpen = async () => {
    const cfg = useMindMapStore.getState().config;
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
      const dir = selected.split("/").slice(0, -1).join("/");
      await invoke("update_last_dirs", { openDir: dir, exportDir: null, importDir: null });
      await invoke("create_new_window", { mode: "open", mmapPath: selected });
    } catch (e) {
      console.error("[App] 打开失败", e);
      alert("打开失败: " + e);
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
      await invoke("save_mmap", { path, content: c });
      state.markSaved();
      // 添加到最近文件
      const name = path.split("/").pop()?.replace(/\.mmap$/, "") || "未命名";
      await invoke("add_recent_file", { path, name });
      await invoke("set_last_opened_file", { path });
    } catch (e) {
      console.error("[App] 保存失败", e);
      state.setSaveStatus("error");
      alert("保存失败: " + e);
    }
  };

  const handleSetPriority = (p: Priority) => {
    const state = useMindMapStore.getState();
    if (!state.content) {
      alert("请先新建或打开一个文档");
      return;
    }
    if (!state.selectedNodeId) {
      alert("请先选中一个节点");
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
        alert("无法导出 SVG");
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
      alert("SVG 导出失败: " + e);
    }
  };

  const handleExportPng = async () => {
    try {
      const result = await exportPng(mindInstanceRef.current);
      if (result) {
        console.log("[App] PNG 已导出:", result);
      }
    } catch (e) {
      console.error("[App] PNG 导出失败", e);
      alert("PNG 导出失败: " + e);
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
      alert("Markdown 导出失败: " + e);
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
      alert("Markdown 导入失败: " + e);
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
      alert("OPML 导出失败: " + e);
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
      alert("OPML 导入失败: " + e);
    }
  };

  if (!booted) {
    return <div className="app-booting">加载中...</div>;
  }

  return (
    <div className="app-root">
      <Toolbar
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onExportPng={handleExportPng}
        onExportSvg={handleExportSvg}
        onExportMarkdown={handleExportMarkdown}
        onExportOpml={handleExportOpml}
        onImportMarkdown={handleImportMarkdown}
        onImportOpml={handleImportOpml}
        onSetPriority={handleSetPriority}
        onOpenPreferences={() => useMindMapStore.getState().openPreferences()}
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
      <PreferencesModal />
      <ReminderToast />
    </div>
  );
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
