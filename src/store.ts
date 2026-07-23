import { create } from "zustand";
import { temporal } from "zundo";
import type { Config, Content, MindNode, Priority, Reminder, SidebarTab } from "./types";

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

  // mind-elixir 实例引用（不进撤销重做历史）
  mindInstance: any | null;
  setMindInstance: (mind: any | null) => void;

  // 撤销重做后需要 store→mind 反向同步
  needStoreToMindSync: boolean;

  // 全局 reminders 缓存(用于画布渲染沙漏,定时刷新)
  allReminders: Reminder[];
  setAllReminders: (rs: Reminder[]) => void;

  // LLM session 状态(MCP 用,Phase 2)
  llmSession: { session: any | null; reason: string } | null;
  setLlmSession: (change: { session: any | null; reason: string } | null) => void;
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
        // 关键:同步到 mind-elixir nodeObj
        // 否则下次 selectNode 触发 syncFromMindElixir 时,mind 数据里这些扩展字段为空,
        // 会用 mind 数据覆盖 store 导致 priority/note 等字段丢失
        syncToMindNodeObj(get().mindInstance, selectedId, updates);
      },

      setPriorityForSelected: (p) => {
        get().updateSelectedNode({ priority: p ?? undefined });
        // 画布视觉反馈：CSS class 控制全包围边框 + 边框外图标
        const inst = get().mindInstance;
        const id = get().selectedNodeId;
        if (inst && id) {
          const tpc = typeof inst.findEle === "function" ? inst.findEle(id) : null;
          if (tpc) {
            tpc.classList.remove("priority-p0", "priority-p1", "priority-p2", "priority-p3");
            if (p) {
              tpc.classList.add(`priority-${p.toLowerCase()}`);
            }
          }
        }
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

      mindInstance: null,
      setMindInstance: (mind) => set({ mindInstance: mind }),
      needStoreToMindSync: false,

      allReminders: [],
      setAllReminders: (rs) => {
        set({ allReminders: rs });
        // 通过 mindInstance 直接触发画布沙漏同步(避免 React 渲染周期时序问题)
        setTimeout(() => {
          if (typeof window !== "undefined" && (window as any).__syncHourglasses) {
            (window as any).__syncHourglasses();
          }
        }, 50);
      },

      llmSession: null,
      setLlmSession: (change) => set({ llmSession: change }),
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
  useMindMapStore.setState({ dirty: true, needStoreToMindSync: true });
  return true;
}

export function redo(): boolean {
  const temporal = useMindMapStore.temporal.getState();
  if (temporal.futureStates.length === 0) return false;
  temporal.redo();
  useMindMapStore.setState({ dirty: true, needStoreToMindSync: true });
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

function countNodes(node: { children?: any[] }): number {
  let n = 1;
  const children = node.children ?? [];
  for (const c of children) n += countNodes(c);
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
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i++) {
    const updated = updateNodeById(children[i], id, updates);
    if (updated) {
      const newChildren = [...children];
      newChildren[i] = updated;
      return { ...node, children: newChildren };
    }
  }
  return null;
}

/**
 * 把 store 的扩展字段更新同步到 mind-elixir 的 nodeObj。
 *
 * 为什么需要这个:store.content 和 mind-elixir 内部 nodeData 是两份数据副本。
 * mind-elixir 自己只会通过 reshapeNode/editTopic 等 API 修改 nodeObj,不知道我们的扩展字段
 * (priority/note/reminder_ids/style)。如果用户在面板里改了这些字段后只更新 store,
 * mind-elixir 的 nodeObj 还停留在旧值。下次 selectNode 触发 syncFromMindElixir 时,
 * fromMindElixirData 会用 mind 数据重建 content,扩展字段就会被 undefined 覆盖,
 * 紧接着 syncPriorityStyles 走 store 发现 priority 没了 → DOM 上 priority class 被移除 → 视觉标记丢失。
 */
function syncToMindNodeObj(mind: any, id: string, updates: Partial<MindNode>) {
  if (!mind || typeof mind.findEle !== "function") return;
  const tpc = mind.findEle(id);
  const nodeObj = tpc?.nodeObj;
  if (!nodeObj) return;
  for (const [k, v] of Object.entries(updates)) {
    // undefined / null / 空数组 都视为"清除字段",保持 nodeObj 干净(避免 toMindElixirData 时再次写入)
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) {
      delete nodeObj[k];
    } else {
      nodeObj[k] = v;
    }
  }
}

// dev 模式暴露 store 到 window 便于调试
if (import.meta.env.DEV) {
  (window as any).__store = useMindMapStore;
}
