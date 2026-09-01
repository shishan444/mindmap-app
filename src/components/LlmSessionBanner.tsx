/**
 * LLM Session Banner
 *
 * 当 LLM 持有写锁时,顶部显示:
 * - 🤖 LLM 名称 + 剩余时间倒计时
 * - ✋ 接管按钮(逃生舱,调 llm_force_release Tauri command)
 * - 锁定原因(acquired/released/expired/forced)
 *
 * 当 editor = human 时不显示
 */

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import "./LlmSessionBanner.css";

export default function LlmSessionBanner() {
  const llmSession = useMindMapStore((s) => s.llmSession);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [fadingOut, setFadingOut] = useState(false);
  const hadSession = useRef(false);

  useEffect(() => {
    if (llmSession?.session) {
      hadSession.current = true;
      setFadingOut(false);
      const t = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(t);
    } else if (hadSession.current && !fadingOut) {
      setFadingOut(true);
      const t = window.setTimeout(() => setFadingOut(false), 800);
      return () => window.clearTimeout(t);
    }
  }, [llmSession?.session, fadingOut]);

  if (!llmSession?.session && !fadingOut) return null;

  const session = llmSession?.session;
  const remainingMs = session ? Math.max(0, session.expires_at_ms - now) : 0;
  const remainingSec = Math.floor(remainingMs / 1000);

  const handleTakeOver = async () => {
    try {
      setError(null);
      await invoke("llm_force_release");
      useMindMapStore.getState().setLlmSession(null);
    } catch (e) {
      console.error("[banner] 接管失败:", e);
      setError("接管失败: " + e);
    }
  };

  const handleClose = () => {
    useMindMapStore.getState().setLlmSession(null);
  };

  const isUrgent = remainingSec <= 10;

  // ★ 根因修复(浮层布局劫持):同 LlmOperationHistory — Portal 挂 body,
  // 免疫 `.app-root > *:not(.stage-fx)` 的 position:relative 覆盖。
  return createPortal(
    <div
      className={`llm-banner ${isUrgent ? "llm-banner-urgent" : ""} ${!session ? "llm-banner-fading" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="llm-banner-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="8" width="16" height="12" rx="3" />
          <path d="M12 8V4M8 4h8" />
          <path d="M9 13v2M15 13v2" />
        </svg>
      </span>
      <span className="llm-banner-text">
        {session ? (
          <>
            <strong>{session.client_name}</strong> 正在编辑
            {remainingSec > 0 ? `(剩余 ${remainingSec}s)` : "(已超时,正在释放)"}
          </>
        ) : (
          "会话已结束"
        )}
      </span>
      {session && (
        <button className="llm-banner-takeover" onClick={handleTakeOver} title="中断 LLM,立即恢复编辑">
          接管
        </button>
      )}
      <button className="llm-banner-close" onClick={handleClose} title="关闭提示">
        ×
      </button>
      {error && <span className="llm-banner-error">{error}</span>}
    </div>,
    document.body,
  );
}
