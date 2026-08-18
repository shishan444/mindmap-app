import { useEffect, useState } from "react";
import "./AboutModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 关于 思维导图(玻璃模态,版本介绍能力)
 * 版本号优先读 Tauri 运行时(app 版本),失败时回落显示开发模式。
 */
export default function AboutModal({ open, onClose }: Props) {
  const [version, setVersion] = useState<string>("…");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (alive) setVersion(v);
      } catch {
        if (alive) setVersion("dev");
      }
    })();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="about-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="about-modal" role="dialog" aria-label="关于 思维导图">
        <div className="about-logo" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#06281a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </div>
        <h2>思维导图</h2>
        <div className="about-version">版本 {version}</div>
        <div className="about-copyright">为思考而生的桌面思维导图工具 · macOS</div>
        <div className="about-actions">
          <button className="about-btn-primary" onClick={() => { /* 检查更新:后续版本接入更新通道 */ }}>
            检查更新
          </button>
          <button className="about-btn" onClick={onClose}>好</button>
        </div>
      </div>
    </div>
  );
}
