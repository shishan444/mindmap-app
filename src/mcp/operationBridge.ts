/**
 * LLM Operation Bridge
 *
 * 设计:
 * - 订阅 Tauri event "llm-operation"(LLM 调写 tool 触发)
 * - 调 mind-elixir 标准 API(addChild / reshapeNode / removeNodes / moveNodeIn)
 * - mind-elixir 内部 fire "operation" → 现有 syncFromMindElixir 链路自动处理
 *
 * 真正"单一数据源":LLM 操作跟人编辑走完全相同的路径,
 * 自动复用 markDirty / setContent / attached_file 同步 / useAutoSave / save_mmap
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useMindMapStore } from "../store";

export interface LlmOperation {
  op_id: string;
  session_id: string;
  op_type: "create_node" | "update_node" | "delete_node" | "move_node" | "attach_file";
  payload: any;
  is_first_in_session: boolean;
  is_last_in_session: boolean;
}

export interface SessionInfo {
  session_id: string;
  client_name: string;
  acquired_at_ms: number;
  expires_at_ms: number;
  last_heartbeat_ms: number;
  operations_count: number;
}

export interface SessionChange {
  session: SessionInfo | null;
  reason: "acquired" | "released" | "expired" | "forced";
}

/**
 * 把 LLM op 转换为 mind-elixir API 调用
 * 抛错时回传给调用方(理论上应该回传给 Rust 让 LLM 知道)
 *
 * 注意:这是 async 函数(attach_file 需要调 Tauri command)
 */
export async function applyOperation(mind: any, op: LlmOperation): Promise<void> {
  switch (op.op_type) {
    case "create_node": {
      const { parent_id, topic, priority, icons } = op.payload;
      const parent = mind.findEle?.(parent_id);
      if (!parent) throw new Error(`父节点 ${parent_id} 不存在`);
      const newNodeObj: any = { topic };
      if (priority) newNodeObj.priority = priority;
      if (icons) newNodeObj.icons = icons;
      mind.addChild(parent, newNodeObj);
      break;
    }
    case "update_node": {
      const { node_id, patch } = op.payload;
      const tpc = mind.findEle?.(node_id);
      if (!tpc) throw new Error(`节点 ${node_id} 不存在`);
      mind.reshapeNode(tpc, patch);
      break;
    }
    case "delete_node": {
      const { node_id } = op.payload;
      const tpc = mind.findEle?.(node_id);
      if (!tpc) throw new Error(`节点 ${node_id} 不存在`);
      mind.removeNodes([tpc]);
      break;
    }
    case "move_node": {
      const { node_id, to_parent_id } = op.payload;
      const tpc = mind.findEle?.(node_id);
      const target = mind.findEle?.(to_parent_id);
      if (!tpc) throw new Error(`节点 ${node_id} 不存在`);
      if (!target) throw new Error(`目标父节点 ${to_parent_id} 不存在`);
      mind.moveNodeIn([tpc], target);
      break;
    }
    case "attach_file": {
      const { node_id, file_path } = op.payload;
      const { invoke } = await import("@tauri-apps/api/core");
      const state = useMindMapStore.getState();
      const mmapPath = state.filePath;
      if (!mmapPath) {
        throw new Error("attach_file 需要先保存文档");
      }
      const attached = await invoke<any>("attach_file_to_node", {
        mmapPath,
        nodeId: node_id,
        srcPath: file_path,
      });
      const stem = attached.original_name.replace(
        new RegExp(`\\.${attached.ext}$`, "i"),
        "",
      );
      state.updateContent((c) => {
        const walk = (n: any): boolean => {
          if (n.id === node_id) {
            n.attached_file = attached;
            n.topic = stem;
            return true;
          }
          for (const child of n.children || []) {
            if (walk(child)) return true;
          }
          return false;
        };
        walk(c.root);
      });
      setTimeout(() => {
        if (typeof window !== "undefined" && (window as any).__syncAttachedFiles) {
          (window as any).__syncAttachedFiles();
        }
      }, 50);
      break;
    }
    default:
      console.warn("[llm-bridge] 未知 op_type:", (op as any).op_type);
  }
}

/**
 * Hook:订阅 LLM events
 *
 * 用法:在 App.tsx 加 `useLlmOperationBridge()`
 */
export function useLlmOperationBridge() {
  // 由于 React Strict Mode 会跑两次 effect,我们用 module-level singleton 保证只订阅一次
  // 实际 listen 在 initLlmBridge() 里启动
}

let bridgeStarted = false;
const unlisteners: UnlistenFn[] = [];

/**
 * 启动 bridge(应在 App mount 时调用,且只调一次)
 */
export async function initLlmBridge(): Promise<void> {
  if (bridgeStarted) return;
  bridgeStarted = true;

  // 订阅 llm-operation
  const unlisten1 = await listen<LlmOperation>("llm-operation", (event) => {
    const op = event.payload;
    const mind = useMindMapStore.getState().mindInstance;
    if (!mind) {
      console.warn("[llm-bridge] mind 实例未就绪,丢弃 op:", op.op_id);
      return;
    }
    // async 调用,catch 错误
    applyOperation(mind, op).catch((e) => {
      console.error("[llm-bridge] op 执行失败:", op, e);
    });
  });

  // 订阅 llm-session-changed
  const unlisten2 = await listen<SessionChange>("llm-session-changed", (event) => {
    useMindMapStore.getState().setLlmSession?.(event.payload);
  });

  unlisteners.push(unlisten1, unlisten2);
}

/**
 * 关闭 bridge(测试 / 卸载时调用)
 */
export function shutdownLlmBridge(): void {
  unlisteners.forEach((u) => u());
  unlisteners.length = 0;
  bridgeStarted = false;
}
