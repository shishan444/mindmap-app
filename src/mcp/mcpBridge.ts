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
        // 根据当前 llmSession 推送 editor 状态(LLM 持锁时 editor="llm")
        const isLlmActive = !!s.llmSession?.session;
        const editState: McpEditState = {
          editor: isLlmActive ? "llm" : "human",
          session: s.llmSession?.session
            ? {
                session_id: s.llmSession.session.session_id,
                client_name: s.llmSession.session.client_name,
                expires_at_ms: s.llmSession.session.expires_at_ms,
              }
            : undefined,
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
    // ★ 用 content JSON hash 做签名(检测任何节点变化,包括 topic 改名)
    const unsub = useMindMapStore.subscribe((state) => {
      const contentStr = state.content ? JSON.stringify(state.content) : "";
      const sig = JSON.stringify({
        len: contentStr.length,
        hash: contentStr.length > 100 ? contentStr.slice(0, 50) + contentStr.slice(-50) : contentStr,
        f: state.filePath,
        r: (state.allReminders ?? []).length,
        s: state.llmSession?.session?.session_id ?? null,
      });
      if (sig === lastSig) return;
      lastSig = sig;

      if (timer) window.clearTimeout(timer);
      // llmSession 变化时立即推送,其他变化 1s 防抖
      const delay = state.llmSession?.session ? 0 : DEBOUNCE_MS;
      timer = window.setTimeout(push, delay);
    });

    // 启动时立刻推送一次
    push();

    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);
}
