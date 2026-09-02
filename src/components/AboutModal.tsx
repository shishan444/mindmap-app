import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./AboutModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

const RELEASES_API = "https://api.github.com/repos/shishan444/mindmap-app/releases/latest";
const RELEASES_PAGE = "https://github.com/shishan444/mindmap-app/releases/latest";

/**
 * 关于 思维导图(玻璃模态,版本介绍能力)
 * 版本号优先读 Tauri 运行时(app 版本),失败时回落显示开发模式。
 * 检查更新(P3-11):ad-hoc 签名无法用 Tauri updater 平滑更新,
 * 采用「查询 GitHub Release → 浏览器打开下载页」的轻方案。
 */
export default function AboutModal({ open, onClose }: Props) {
  const [version, setVersion] = useState<string>("…");
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "latest" | "available" | "error">("idle");
  const [latestTag, setLatestTag] = useState("");

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

  const checkUpdate = async () => {
    setUpdateState("checking");
    try {
      const res = await fetch(RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const tag = String(data.tag_name || "").replace(/^v/, "");
      if (!tag) throw new Error("empty tag");
      if (tag !== version && version !== "…" && version !== "dev") {
        setLatestTag(tag);
        setUpdateState("available");
      } else {
        setUpdateState("latest");
      }
    } catch {
      setUpdateState("error");
    }
  };

  // 关闭时重置检查状态
  useEffect(() => {
    if (!open) {
      setUpdateState("idle");
      setLatestTag("");
    }
  }, [open]);

  const openReleasePage = async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(RELEASES_PAGE);
    } catch (e) {
      console.error("[About] 打开 release 页失败", e);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // ★ 根因修复(浮层布局劫持·系统性梳理):浮层一律 Portal 挂 body。
  // v0.3.1 只修了三个点名组件,本组件漏网(被 app-root 通配规则劫持
  // fixed→relative,模态挤压布局)——本次全库浮层穷举后统一处置。
  return createPortal(
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
        {updateState === "available" && (
          <div className="about-update-tip" role="status">
            发现新版本 v{latestTag}
            <button className="about-update-link" onClick={openReleasePage}>前往下载</button>
          </div>
        )}
        {updateState === "latest" && (
          <div className="about-update-tip about-update-ok" role="status">已是最新版本</div>
        )}
        {updateState === "error" && (
          <div className="about-update-tip about-update-err" role="status">检查失败,请稍后再试</div>
        )}
        <div className="about-actions">
          <button
            className="about-btn-primary"
            onClick={checkUpdate}
            disabled={updateState === "checking"}
          >
            {updateState === "checking" ? "检查中…" : "检查更新"}
          </button>
          <button className="about-btn" onClick={onClose}>好</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
