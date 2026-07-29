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

    // 防抖订阅(签名包含 root children 数量 + root topic + session 变化)
    const countNodes = (n: any): number => {
      if (!n) return 0;
      return 1 + (n.children ?? []).reduce((sum: number, c: any) => sum + countNodes(c), 0);
    };
    const unsub = useMindMapStore.subscribe((state) => {
      const sig = JSON.stringify({
        c: state.content?.root?.id,
        n: countNodes(state.content?.root),  // ★ 节点总数(检测增删节点)
        t: state.content?.root?.topic,        // ★ root topic
        f: state.filePath,
        r: (state.allReminders ?? []).length,
        s: state.llmSession?.session?.session_id ?? null,
      });
      if (sig === lastSig) return;
      lastSig = sig;

      if (timer) window.clearTimeout(timer);
      // llmSession 变化时立即推送(不等防抖),其他变化 1s 防抖
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
