import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import Toolbar from "./components/Toolbar";
import MindMapCanvas from "./components/MindMapCanvas";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import { useMindMapStore, undo, redo, getHistoryInfo } from "./store";
import { useAutoSave } from "./hooks/useAutoSave";
import { exportPng } from "./hooks/usePngExport";
import type { Config, Content, Priority } from "./types";
import "./App.css";

function App() {
  const [booted, setBooted] = useState(false);
  const setContent = useMindMapStore((s) => s.setContent);
  const setFilePath = useMindMapStore((s) => s.setFilePath);
  const setConfig = useMindMapStore((s) => s.setConfig);
  const mindInstanceRef = useRef<any>(null);

  // 启用自动保存（防抖 2 秒）
  useAutoSave();

  // 全局快捷键：Cmd+Z 撤销 / Cmd+Shift+Z 重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        const info = getHistoryInfo();
        if (info.canUndo) undo();
      } else if (key === "z" && e.shiftKey) {
        e.preventDefault();
        const info = getHistoryInfo();
        if (info.canRedo) redo();
      } else if (key === "y" && !e.shiftKey) {
        // Cmd+Y 也作为重做（部分用户习惯）
        e.preventDefault();
        const info = getHistoryInfo();
        if (info.canRedo) redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<Config>("get_config");
        setConfig(cfg);
        // 尝试恢复 last_opened_file
        let restored = false;
        if (cfg.last_opened_file) {
          const exists = await invoke<boolean>("path_exists", {
            path: cfg.last_opened_file,
          });
          if (exists) {
            try {
              const c = await invoke<Content>("open_mmap", {
                path: cfg.last_opened_file,
              });
              setContent(c);
              setFilePath(cfg.last_opened_file);
              restored = true;
            } catch (e) {
              console.error("[App] 恢复上次文件失败，回退到新建", e);
            }
          }
        }
        // 没有可恢复的文件 → 自动新建默认文档（让用户立即看到根节点）
        if (!restored) {
          const c = await invoke<Content>("new_mmap", {
            topic: "中心主题",
          });
          setContent(c);
          setFilePath(null);
        }
      } catch (e) {
        console.error("[App] 启动失败", e);
      } finally {
        setBooted(true);
      }
    })();
  }, [setContent, setFilePath, setConfig]);

  const handleNew = async () => {
    const c = await invoke<Content>("new_mmap", { topic: "中心主题" });
    setContent(c);
    setFilePath(null);
  };

  const handleOpen = async () => {
    const cfg = useMindMapStore.getState().config;
    const selected = await openDialog({
      defaultPath: cfg?.last_open_dir ?? undefined,
      filters: [{ name: "思维导图", extensions: ["mmap"] }],
      multiple: false,
    });
    if (typeof selected !== "string" || !selected) return;
    try {
      const c = await invoke<Content>("open_mmap", { path: selected });
      setContent(c);
      setFilePath(selected);
      const name =
        selected.split("/").pop()?.replace(/\.mmap$/, "") || "未命名";
      await invoke("add_recent_file", { path: selected, name });
      await invoke("set_last_opened_file", { path: selected });
      const dir = selected.split("/").slice(0, -1).join("/");
      await invoke("update_last_dirs", {
        openDir: dir,
        exportDir: null,
        importDir: null,
      });
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

  const handleExportPng = async () => {
    try {
      const result = await exportPng(mindInstanceRef.current);
      if (result) {
        // 短暂提示，不打断
        console.log("[App] PNG 已导出:", result);
      }
    } catch (e) {
      console.error("[App] PNG 导出失败", e);
      alert("PNG 导出失败: " + e);
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
        onSetPriority={handleSetPriority}
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
    </div>
  );
}

/** 查找指定 id 节点的优先级 */
function findNodePriority(
  root: { id: string; priority?: Priority; children: any[] },
  id: string,
): Priority | undefined {
  if (root.id === id) return root.priority;
  for (const c of root.children) {
    const p = findNodePriority(c, id);
    if (p !== undefined || c.id === id) return p;
  }
  return undefined;
}

export default App;
