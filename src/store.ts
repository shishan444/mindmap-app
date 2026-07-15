import { create } from "zustand";
import { temporal } from "zundo";
import type { Config, Content, MindNode, Priority, SidebarTab } from "./types";

interface MindMapState {
  // 当前文档
  content: Content | null;
  filePath: string | null;
  dirty: boolean;

  // UI 状态
  activeTab: SidebarTab;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  selectedNodeId: string | null;
  nodeCount: number;

  // 配置
  config: Config | null;

  // 自动保存状态
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;

  // Actions
  setContent: (content: Content | null) => void;
  setFilePath: (path: string | null) => void;
  markDirty: () => void;
  markSaved: () => void;
  setSaveStatus: (status: "idle" | "saving" | "saved" | "error") => void;
  setActiveTab: (tab: SidebarTab) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setSelectedNodeId: (id: string | null) => void;
  setNodeCount: (n: number) => void;
  setConfig: (cfg: Config) => void;
  updateContent: (updater: (c: Content) => void) => void;

  // Phase 5: 节点编辑
  updateSelectedNode: (updates: Partial<MindNode>) => void;
  setPriorityForSelected: (p: Priority | null) => void;
  clearHistory: () => void;

  // Phase 11.3: 偏好设置
  showPreferences: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
  replaceConfig: (cfg: Config) => void;
}

export const useMindMapStore = create<MindMapState>()(
  temporal(
    (set, get) => ({
      content: null,
      filePath: null,
      dirty: false,
      activeTab: "properties",
      sidebarCollapsed: false,
      sidebarWidth: 280,
      selectedNodeId: null,
      nodeCount: 0,
      config: null,
      saveStatus: "idle",
      lastSavedAt: null,

      setContent: (content) =>
        set({
          content,
          dirty: false,
          selectedNodeId: content?.root.id ?? null,
          nodeCount: content ? countNodes(content.root) : 0,
        }),

      setFilePath: (path) => set({ filePath: path }),

      markDirty: () => set({ dirty: true }),

      markSaved: () =>
        set({ dirty: false, saveStatus: "saved", lastSavedAt: Date.now() }),

      setSaveStatus: (status) => set({ saveStatus: status }),

      setActiveTab: (tab) => set({ activeTab: tab }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      setSidebarWidth: (w) => set({ sidebarWidth: w }),

      setSelectedNodeId: (id) => set({ selectedNodeId: id }),

      setNodeCount: (n) => set({ nodeCount: n }),

      setConfig: (cfg) =>
        set({
          config: cfg,
          activeTab: (cfg.window_state.active_tab as SidebarTab) || "properties",
          sidebarCollapsed: cfg.window_state.sidebar_collapsed,
          sidebarWidth: cfg.window_state.sidebar_width,
        }),

      updateContent: (updater) => {
        const c = get().content;
        if (!c) return;
        const cloned: Content = {
          ...c,
          root: { ...c.root },
          canvas_state: { ...c.canvas_state },
        };
        updater(cloned);
        set({ content: cloned, dirty: true, nodeCount: countNodes(cloned.root) });
      },

      updateSelectedNode: (updates) => {
        const c = get().content;
        const selectedId = get().selectedNodeId;
        if (!c || !selectedId) return;
        const newRoot = updateNodeById(c.root, selectedId, updates);
        if (!newRoot) return;
        set({
          content: { ...c, root: newRoot },
          dirty: true,
          nodeCount: countNodes(newRoot),
        });
      },

      setPriorityForSelected: (p) => {
        get().updateSelectedNode({ priority: p ?? undefined });
      },

      clearHistory: () => {
        useMindMapStore.temporal.getState().clear();
      },

      showPreferences: false,
      openPreferences: () => set({ showPreferences: true }),
      closePreferences: () => set({ showPreferences: false }),
      replaceConfig: (cfg) =>
        set({
          config: cfg,
          activeTab: (cfg.window_state.active_tab as SidebarTab) || "properties",
          sidebarCollapsed: cfg.window_state.sidebar_collapsed,
          sidebarWidth: cfg.window_state.sidebar_width,
        }),
    }),
    {
      // 只跟踪 content 和 selectedNodeId 的变化（撤销重做依据）
      partialize: (state) => ({
        content: state.content,
        selectedNodeId: state.selectedNodeId,
      }),
      limit: 50,
      equality: (pastState, currentState) =>
        pastState.content === currentState.content &&
        pastState.selectedNodeId === currentState.selectedNodeId,
    },
  ),
);

// === 撤销/重做 helper ===

export function undo(): boolean {
  const temporal = useMindMapStore.temporal.getState();
  if (temporal.pastStates.length === 0) return false;
  temporal.undo();
  // 标记 dirty（撤销也算改动）
  useMindMapStore.setState({ dirty: true });
  return true;
}

export function redo(): boolean {
  const temporal = useMindMapStore.temporal.getState();
  if (temporal.futureStates.length === 0) return false;
  temporal.redo();
  useMindMapStore.setState({ dirty: true });
  return true;
}

export function getHistoryInfo() {
  const temporal = useMindMapStore.temporal.getState();
  return {
    undoCount: temporal.pastStates.length,
    redoCount: temporal.futureStates.length,
    canUndo: temporal.pastStates.length > 0,
    canRedo: temporal.futureStates.length > 0,
  };
}

function countNodes(node: { children: any[] }): number {
  let n = 1;
  for (const c of node.children) n += countNodes(c);
  return n;
}

/** 递归查找并更新指定 id 的节点，返回新的 root（不可变更新） */
function updateNodeById(
  node: MindNode,
  id: string,
  updates: Partial<MindNode>,
): MindNode | null {
  if (node.id === id) {
    return { ...node, ...updates };
  }
  for (let i = 0; i < node.children.length; i++) {
    const updated = updateNodeById(node.children[i], id, updates);
    if (updated) {
      const newChildren = [...node.children];
      newChildren[i] = updated;
      return { ...node, children: newChildren };
    }
  }
  return null;
}
