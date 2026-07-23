import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import type { Config } from "../types";
import "./PreferencesModal.css";

type Tab = "general" | "reminder" | "appearance" | "export" | "mcp";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "general", icon: "⚙", label: "通用" },
  { id: "reminder", icon: "⏰", label: "提醒" },
  { id: "appearance", icon: "🎨", label: "外观" },
  { id: "export", icon: "📤", label: "导出" },
  { id: "mcp", icon: "🤖", label: "MCP" },
];

export default function PreferencesModal() {
  const show = useMindMapStore((s) => s.showPreferences);
  const close = useMindMapStore((s) => s.closePreferences);
  const config = useMindMapStore((s) => s.config);
  const replaceConfig = useMindMapStore((s) => s.replaceConfig);

  const [draft, setDraft] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (show && config) {
      // 深克隆做编辑副本
      setDraft(JSON.parse(JSON.stringify(config)));
      setError(null);
    }
  }, [show, config]);

  // Esc 关闭(满足 escape-routes:模态必须提供取消/退出途径)
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show, close]);

  if (!show || !draft) return null;

  const update = (path: (cfg: Config) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as Config;
      path(next);
      return next;
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("save_config_command", { cfg: draft });
      replaceConfig(draft);
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    close();
  };

  return (
    <div className="prefs-overlay" onClick={handleCancel}>
      <div
        className="prefs-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="偏好设置"
      >
        <div className="prefs-header">
          <h2>偏好设置</h2>
          <button
            className="prefs-close"
            onClick={handleCancel}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="prefs-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`prefs-tab ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span className="prefs-tab-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="prefs-content">
          {activeTab === "general" && (
            <GeneralTab draft={draft} update={update} />
          )}
          {activeTab === "reminder" && (
            <ReminderTab draft={draft} update={update} />
          )}
          {activeTab === "appearance" && (
            <AppearanceTab draft={draft} update={update} />
          )}
          {activeTab === "export" && (
            <ExportTab draft={draft} update={update} />
          )}
          {activeTab === "mcp" && <McpTab draft={draft} update={update} />}
        </div>

        {error && <div className="prefs-error">{error}</div>}

        <div className="prefs-footer">
          <button className="prefs-btn-cancel" onClick={handleCancel}>
            取消
          </button>
          <button
            className="prefs-btn-save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface TabProps {
  draft: Config;
  update: (path: (cfg: Config) => void) => void;
}

function GeneralTab({ draft, update }: TabProps) {
  return (
    <div className="tab-pane">
      <label className="prefs-field">
        <span>默认新建文件目录</span>
        <input
          type="text"
          value={draft.default_new_file_dir || ""}
          placeholder="如 /Users/ss/Documents/MindMaps"
          onChange={(e) =>
            update((c) => {
              c.default_new_file_dir = e.target.value || undefined;
            })
          }
        />
      </label>

      <label className="prefs-field">
        <span>自动保存间隔（秒）</span>
        <input
          type="number"
          min={1}
          max={60}
          value={draft.auto_save_interval_sec}
          onChange={(e) =>
            update((c) => {
              c.auto_save_interval_sec = Math.max(1, Number(e.target.value) || 2);
            })
          }
        />
      </label>

      <label className="prefs-field">
        <span>最近文件数量上限</span>
        <input
          type="number"
          min={5}
          max={100}
          value={draft.recent_files_max}
          onChange={(e) =>
            update((c) => {
              c.recent_files_max = Math.max(5, Number(e.target.value) || 20);
            })
          }
        />
      </label>
    </div>
  );
}

function ReminderTab({ draft, update }: TabProps) {
  return (
    <div className="tab-pane">
      <label className="prefs-field checkbox">
        <input
          type="checkbox"
          checked={draft.reminder.sound_enabled}
          onChange={(e) =>
            update((c) => {
              c.reminder.sound_enabled = e.target.checked;
            })
          }
        />
        <span>启用提醒声音</span>
      </label>

      <label className="prefs-field">
        <span>声音文件</span>
        <input
          type="text"
          value={draft.reminder.sound_file}
          onChange={(e) =>
            update((c) => {
              c.reminder.sound_file = e.target.value;
            })
          }
        />
      </label>

      <label className="prefs-field">
        <span>默认优先级</span>
        <select
          value={draft.reminder.default_priority}
          onChange={(e) =>
            update((c) => {
              c.reminder.default_priority = e.target.value;
            })
          }
        >
          <option value="P0">P0 紧急</option>
          <option value="P1">P1 高</option>
          <option value="P2">P2 中（默认）</option>
          <option value="P3">P3 低</option>
        </select>
      </label>

      <label className="prefs-field">
        <span>贪睡时长（分钟）</span>
        <input
          type="number"
          min={1}
          max={60}
          value={draft.reminder.snooze_minutes}
          onChange={(e) =>
            update((c) => {
              c.reminder.snooze_minutes = Math.max(1, Number(e.target.value) || 5);
            })
          }
        />
      </label>

      <label className="prefs-field checkbox">
        <input
          type="checkbox"
          checked={draft.reminder.show_modal_when_background}
          onChange={(e) =>
            update((c) => {
              c.reminder.show_modal_when_background = e.target.checked;
            })
          }
        />
        <span>软件在后台时也弹应用内模态框</span>
      </label>

      <label className="prefs-field checkbox">
        <input
          type="checkbox"
          checked={draft.reminder.system_notification_enabled}
          onChange={(e) =>
            update((c) => {
              c.reminder.system_notification_enabled = e.target.checked;
            })
          }
        />
        <span>触发 macOS 系统通知（通知中心）</span>
      </label>
    </div>
  );
}

function AppearanceTab({ draft, update }: TabProps) {
  return (
    <div className="tab-pane">
      <label className="prefs-field">
        <span>主题</span>
        <select
          value={draft.ui.theme}
          onChange={(e) =>
            update((c) => {
              c.ui.theme = e.target.value;
            })
          }
        >
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>

      <label className="prefs-field">
        <span>字号</span>
        <input
          type="number"
          min={10}
          max={24}
          value={draft.ui.font_size}
          onChange={(e) =>
            update((c) => {
              c.ui.font_size = Math.max(10, Number(e.target.value) || 14);
            })
          }
        />
      </label>

      <label className="prefs-field">
        <span>字体（留空用系统默认）</span>
        <input
          type="text"
          value={draft.ui.font_family || ""}
          placeholder="PingFang SC / Helvetica Neue"
          onChange={(e) =>
            update((c) => {
              c.ui.font_family = e.target.value || undefined;
            })
          }
        />
      </label>

      <label className="prefs-field checkbox">
        <input
          type="checkbox"
          checked={draft.ui.show_minimap}
          onChange={(e) =>
            update((c) => {
              c.ui.show_minimap = e.target.checked;
            })
          }
        />
        <span>显示小地图</span>
      </label>

      <label className="prefs-field checkbox">
        <input
          type="checkbox"
          checked={draft.ui.show_toolbar}
          onChange={(e) =>
            update((c) => {
              c.ui.show_toolbar = e.target.checked;
            })
          }
        />
        <span>显示工具栏</span>
      </label>
    </div>
  );
}

function ExportTab({ draft, update }: TabProps) {
  return (
    <div className="tab-pane">
      <label className="prefs-field">
        <span>PNG 分辨率倍数</span>
        <select
          value={draft.export.png_scale}
          onChange={(e) =>
            update((c) => {
              c.export.png_scale = Number(e.target.value);
            })
          }
        >
          <option value={1}>1x（标准）</option>
          <option value={2}>2x（推荐，Retina）</option>
          <option value={3}>3x（高清打印）</option>
          <option value={4}>4x（极致）</option>
        </select>
      </label>

      <label className="prefs-field">
        <span>Markdown 缩进</span>
        <select
          value={draft.export.markdown_indent}
          onChange={(e) =>
            update((c) => {
              c.export.markdown_indent = e.target.value;
            })
          }
        >
          <option value={"  "}>2 空格（推荐）</option>
          <option value={" "}>1 空格</option>
          <option value={"\t"}>Tab</option>
          <option value={"    "}>4 空格</option>
        </select>
      </label>
    </div>
  );
}

function McpTab({
  draft,
  update,
}: {
  draft: Config;
  update: (path: (cfg: Config) => void) => void;
}) {
  return (
    <div className="tab-pane">
      <h3 className="section-title">🤖 MCP(LLM 协作)</h3>
      <p className="prefs-hint">
        启用后,LLM 客户端(Claude Desktop 等)可通过本机 HTTP 接入,读写思维导图。
        <a
          href="https://github.com/shishan444/mindmap-app/blob/main/docs/mcp-quickstart.md"
          target="_blank"
          rel="noreferrer"
        >
          配置指南
        </a>
      </p>

      <label className="prefs-field">
        <span>启用 MCP server</span>
        <input
          type="checkbox"
          checked={draft.mcp.enabled}
          onChange={(e) =>
            update((c) => {
              c.mcp.enabled = e.target.checked;
            })
          }
        />
        <small className="prefs-field-hint">
          关闭后重启 app 生效。监听 127.0.0.1:{draft.mcp.port}(本机 only)
        </small>
      </label>

      <label className="prefs-field">
        <span>监听端口</span>
        <input
          type="number"
          min={1024}
          max={65535}
          value={draft.mcp.port}
          onChange={(e) =>
            update((c) => {
              const p = parseInt(e.target.value, 10);
              if (!isNaN(p) && p >= 1024 && p <= 65535) c.mcp.port = p;
            })
          }
        />
      </label>

      <label className="prefs-field">
        <span>默认 LLM 会话 TTL(秒)</span>
        <input
          type="number"
          min={1}
          max={300}
          value={draft.mcp.default_ttl_sec}
          onChange={(e) =>
            update((c) => {
              const t = parseInt(e.target.value, 10);
              if (!isNaN(t) && t >= 1 && t <= 300) c.mcp.default_ttl_sec = t;
            })
          }
        />
        <small className="prefs-field-hint">
          LLM 持锁的最大时长。超时自动释放(用户可随时接管)。
        </small>
      </label>
    </div>
  );
}
