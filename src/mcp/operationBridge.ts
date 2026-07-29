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
 *
 * undo 整合(Phase 3):
 * - LLM 会话期间 pause zundo(操作不进 undo 历史)
 * - 会话结束(force_release / release / expired)时 resume + 手动 wrap
 * - 用户按 Cmd+Z 一次撤销整个会话
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";

// 模块级状态:记录 LLM 会话是否在 zundo pause 中
let llmSessionPaused = false;

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
  // ★ 诊断 echo 到 Rust stdout
  try {
    await invoke("__echo", { msg: `[applyOp] start ${op.op_type}` });
  } catch {}
  console.log("[applyOperation] start:", op.op_type, "payload:", op.payload);
  switch (op.op_type) {
    case "create_node": {
      let { parent_id, topic, priority, icons } = op.payload;
      // ★ 约定转换:LLM 用 "root" 指代文档根节点,实际 root id 是 UUID
      // 这里从 store 拿真实 root id 替换
      if (parent_id === "root") {
        const realRootId = useMindMapStore.getState().content?.root?.id;
        if (realRootId) {
          try { await invoke("__echo", { msg: `[applyOp] parent_id "root" → 真实 ${realRootId.slice(0, 8)}` }); } catch {}
          parent_id = realRootId;
        }
      }
      try { await invoke("__echo", { msg: `[applyOp] findEle parent=${parent_id}` }); } catch {}
      let parent: any = null;
      try {
        parent = mind.findEle?.(parent_id);
      } catch (e) {
        try { await invoke("__echo", { msg: `[applyOp] ✗ findEle threw: ${String(e).slice(0, 80)}` }); } catch {}
        throw e;
      }
      try { await invoke("__echo", { msg: `[applyOp] parent found=${!!parent} id=${parent?.nodeObj?.id ?? "?"}` }); } catch {}
      if (!parent) throw new Error(`父节点 ${parent_id} 不存在`);
      const newNodeObj: any = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        topic,
      };
      if (priority) newNodeObj.priority = priority;
      if (icons) newNodeObj.icons = icons;
      try { await invoke("__echo", { msg: `[applyOp] addChild topic=${topic}` }); } catch {}
      try {
        mind.addChild(parent, newNodeObj);
        try { await invoke("__echo", { msg: `[applyOp] ✓ addChild 完成` }); } catch {}
        // 等 syncFromMindElixir 跑完,看 store 是否真更新
        await new Promise(r => setTimeout(r, 500));
        const rootChildren = useMindMapStore.getState().content?.root?.children?.length;
        try { await invoke("__echo", { msg: `[applyOp] store content root.children.length=${rootChildren}` }); } catch {}
      } catch (e) {
        try { await invoke("__echo", { msg: `[applyOp] ✗ addChild threw: ${String(e).slice(0, 80)}` }); } catch {}
        throw e;
      }
      break;
    }
    case "update_node": {
      const { node_id, patch } = op.payload;
      const tpc = mind.findEle?.(node_id);
      if (!tpc) throw new Error(`节点 ${node_id} 不存在`);
      // ★ mind-elixir reshapeNode 有 bug(Object.assign 到 tpc 不是 nodeObj)
      // 直接改 nodeObj + 手动同步 DOM + fire operation
      Object.assign(tpc.nodeObj, patch);
      if (patch.topic !== undefined && tpc.text) {
        tpc.text.textContent = patch.topic;
      }
      mind.bus?.fire?.("operation", { name: "reshapeNode", obj: tpc.nodeObj });
      try { await invoke("__echo", { msg: `[applyOp] ✓ update_node id=${node_id?.slice(0,8)}` }); } catch {}
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

  console.log("[llm-bridge] initLlmBridge 启动,注册 listen...");

  try {
    // 订阅 llm-operation
    const unlisten1 = await listen<LlmOperation>("llm-operation", (event) => {
      // ★ 诊断:通过 invoke 反馈到 Rust stdout(因为前端 console 默认不到 stdout)
      invoke("__echo", { msg: `[frontend] ★★★ 收到 llm-operation ${event.payload?.op_type} ${event.payload?.op_id}` }).catch(() => {});
      console.log("[llm-bridge] ★★★ 收到 llm-operation ★★★:", event.payload?.op_type, event.payload?.op_id);
      const op = event.payload;
      // 记录到操作历史(便于侧栏显示)
      useMindMapStore.getState().pushLlmOperation?.({
        ...op,
        received_at_ms: Date.now(),
      });
      const mind = useMindMapStore.getState().mindInstance;
      console.log("[llm-bridge] mind 实例:", !!mind);
      if (!mind) {
        console.warn("[llm-bridge] mind 实例未就绪,丢弃 op:", op.op_id);
        return;
      }
      console.log("[llm-bridge] 调 applyOperation");
      // async 调用,catch 错误
    applyOperation(mind, op).catch((e) => {
      console.error("[llm-bridge] op 执行失败:", op, e);
    });
  });
    console.log("[llm-bridge] ✓ llm-operation listen 注册成功");

  // 订阅 llm-session-changed
  const unlisten2 = await listen<SessionChange>("llm-session-changed", (event) => {
    console.log("[llm-bridge] 收到 llm-session-changed:", event.payload?.reason);
    const change = event.payload;
    useMindMapStore.getState().setLlmSession?.(change);

    // undo 整合:会话开始 pause,结束 resume + wrap
    if (change.session && change.reason === "acquired") {
      // 会话开始:pause zundo(pause 期间 LLM 操作不进 undo 历史)
      if (!llmSessionPaused) {
        try {
          useMindMapStore.temporal.getState().pause();
          llmSessionPaused = true;
        } catch (e) {
          console.warn("[llm-bridge] zundo pause failed", e);
        }
      }
    } else if (!change.session) {
      // 会话结束(released/expired/forced):resume
      // 注:zundo 没有 wrap API,pause 期间的 LLM 操作不会进 undo 历史,
      // resume 后用户 Cmd+Z 会撤到 pre-snapshot(等同"一次撤销整个会话")
      if (llmSessionPaused) {
        try {
          useMindMapStore.temporal.getState().resume();
        } catch (e) {
          console.warn("[llm-bridge] zundo resume failed", e);
        }
        llmSessionPaused = false;
      }
    }
  });
    console.log("[llm-bridge] ✓ llm-session-changed listen 注册成功");

  unlisteners.push(unlisten1, unlisten2);
  } catch (e) {
    console.error("[llm-bridge] ✗ initLlmBridge 失败:", e);
  }
  console.log("[llm-bridge] initLlmBridge 完成");
}

/**
 * 关闭 bridge(测试 / 卸载时调用)
 */
export function shutdownLlmBridge(): void {
  unlisteners.forEach((u) => u());
  unlisteners.length = 0;
  bridgeStarted = false;
}
