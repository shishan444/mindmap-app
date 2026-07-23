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

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import "./LlmSessionBanner.css";

export default function LlmSessionBanner() {
  const llmSession = useMindMapStore((s) => s.llmSession);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  // 1s tick 用于倒计时
  useEffect(() => {
    if (!llmSession?.session) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [llmSession?.session]);

  if (!llmSession?.session) return null;

  const session = llmSession.session;
  const remainingMs = Math.max(0, session.expires_at_ms - now);
  const remainingSec = Math.floor(remainingMs / 1000);

  const handleTakeOver = async () => {
    try {
      setError(null);
      await invoke("llm_force_release");
    } catch (e) {
      setError("接管失败: " + e);
    }
  };

  const isUrgent = remainingSec <= 10;

  return (
    <div
      className={`llm-banner ${isUrgent ? "llm-banner-urgent" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="llm-banner-icon">🤖</span>
      <span className="llm-banner-text">
        <strong>{session.client_name}</strong> 正在编辑
        {remainingSec > 0 ? `(剩余 ${remainingSec}s)` : "(已超时,正在释放)`"}
      </span>
      <button className="llm-banner-takeover" onClick={handleTakeOver} title="中断 LLM,立即恢复编辑">
        ✋ 接管
      </button>
      {error && <span className="llm-banner-error">{error}</span>}
    </div>
  );
}
