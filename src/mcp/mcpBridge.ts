/**
 * MCP 桥接:订阅 store,推送状态到后端
 *
 * Phase 1 只读,前端 → 后端单向:
 * store.subscribe → 防抖 1s → invoke("mcp_update_state", { content, ... })
 *
 * 后端 MCP tool 通过 McpStateMirror 拿到 latest state。
 */

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";

const DEBOUNCE_MS = 1000;

interface McpEditState {
  editor: string;
  session?: { session_id: string; client_name: string; expires_at_ms: number };
  file_path?: string;
}

export function useMcpBridge() {
  useEffect(() => {
    let timer: number | undefined;
    let lastSig = "";

    // 推送当前状态到后端
    const push = async () => {
      try {
        const s = useMindMapStore.getState();
        const editState: McpEditState = {
          editor: "human",
          file_path: s.filePath ?? undefined,
        };
        await invoke("mcp_update_state", {
          content: s.content,
          filePath: s.filePath,
          reminders: s.allReminders ?? [],
          editState,
        });
      } catch (e) {
        // 静默失败(MCP 是辅助能力,不应阻塞 app)
        console.warn("[mcp-bridge] update failed", e);
      }
    };

    // 防抖订阅
    const unsub = useMindMapStore.subscribe((state) => {
      // 用 content + filePath + reminders 的签名避免重复推送
      const sig = JSON.stringify({
        c: state.content?.root?.id,
        f: state.filePath,
        r: (state.allReminders ?? []).length,
      });
      if (sig === lastSig) return;
      lastSig = sig;

      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(push, DEBOUNCE_MS);
    });

    // 启动时立刻推送一次
    push();

    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);
}
