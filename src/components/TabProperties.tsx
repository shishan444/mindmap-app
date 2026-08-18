import {
  CircleDashed, Loader, CheckCircle, Ban, Pause,
  Flame, TrendingUp, Minus, ArrowDown,
  Bug, Sparkles, ListTodo, Lightbulb, FileText,
  Star, AlertTriangle, Lock, Pin, Flag, Bookmark,
  X,
  FileType2, FileText as FileDoc, Presentation, Sheet, Film, Music, Image as ImageIcon,
  Upload, FolderOpen, Trash2, ExternalLink,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMindMapStore } from "../store";
import type { AttachedFile, FileType, Priority } from "../types";
import "./Common.css";

// 图标分类：lucide SVG 组件 + emoji 存储 + 业务语义
const ICON_CATEGORIES: { label: string; icons: { emoji: string; label: string; Icon: any }[] }[] = [
  {
    label: "任务进度",
    icons: [
      { emoji: "⭕", label: "未开始", Icon: CircleDashed },
      { emoji: "🔄", label: "进行中", Icon: Loader },
      { emoji: "✅", label: "已完成", Icon: CheckCircle },
      { emoji: "🚫", label: "已阻塞", Icon: Ban },
      { emoji: "⏸️", label: "暂停", Icon: Pause },
    ],
  },
  {
    label: "任务级别",
    icons: [
      { emoji: "🔥", label: "P0 紧急", Icon: Flame },
      { emoji: "📈", label: "P1 高", Icon: TrendingUp },
      { emoji: "➖", label: "P2 中", Icon: Minus },
      { emoji: "⬇️", label: "P3 低", Icon: ArrowDown },
    ],
  },
  {
    label: "任务类型",
    icons: [
      { emoji: "🐛", label: "Bug", Icon: Bug },
      { emoji: "✨", label: "新功能", Icon: Sparkles },
      { emoji: "📋", label: "任务", Icon: ListTodo },
      { emoji: "💡", label: "想法", Icon: Lightbulb },
      { emoji: "📄", label: "文档", Icon: FileText },
    ],
  },
  {
    label: "状态标记",
    icons: [
      { emoji: "⭐", label: "收藏", Icon: Star },
      { emoji: "⚠️", label: "风险", Icon: AlertTriangle },
      { emoji: "🔒", label: "锁定", Icon: Lock },
      { emoji: "📌", label: "置顶", Icon: Pin },
      { emoji: "🚩", label: "重要", Icon: Flag },
      { emoji: "🔖", label: "书签", Icon: Bookmark },
    ],
  },
];

// emoji → lucide 映射（用于渲染已选图标）
const EMOJI_TO_ICON: Record<string, any> = {};
for (const cat of ICON_CATEGORIES) {
  for (const ic of cat.icons) {
    EMOJI_TO_ICON[ic.emoji] = ic.Icon;
  }
}

// === 附件节点固定尺寸 ===
// 设计理由:
//   - 让所有附件节点视觉一致,不继承 attach 前节点的尺寸
//   - 80×80 正方形适合各种缩略图(图片/PDF/视频帧)
//   - overflow:hidden 配合 CSS ellipsis 让长文件名自动截断(角标已显示扩展名兜底)
//   - 只合并到现有 style(保留 TabStyle 设的 fontSize/color 等),不覆盖
const ATTACH_FIXED_STYLE = {
  width: "80px",
  height: "80px",
  overflow: "hidden",
} as const;

// 合并固定尺寸到 oldStyle,保留其他字段
function withAttachFixedStyle(oldStyle: any): Record<string, string> {
  return { ...(oldStyle || {}), ...ATTACH_FIXED_STYLE };
}

// 从 oldStyle 移除固定尺寸相关字段(用于移除附件时恢复自适应)
function withoutAttachFixedStyle(oldStyle: any): Record<string, string> | undefined {
  if (!oldStyle) return undefined;
  const { width, height, overflow, ...rest } = oldStyle;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function findNode(root: any, id: string | null): any | null {
  if (!root || !id) return null;
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

export default function TabProperties() {
  const content = useMindMapStore((s) => s.content);
  const selectedId = useMindMapStore((s) => s.selectedNodeId);
  const filePath = useMindMapStore((s) => s.filePath);
  const mind = useMindMapStore((s) => s.mindInstance);
  const setPriorityForSelected = useMindMapStore((s) => s.setPriorityForSelected);
  const updateContent = useMindMapStore((s) => s.updateContent);

  const node = findNode(content?.root ?? null, selectedId);
  if (!node) {
    return (
      <div className="tab-pane">
        <p className="tab-empty">未选中节点</p>
      </div>
    );
  }

  // === 附加文件 ===
  // 类型色与画布 attached-render 的类型编码同源(同一套色彩语言)
  const fileTypeFilters: { type: FileType; label: string; Icon: any; exts: string[]; color: string }[] = [
    { type: "image", label: "图片", Icon: ImageIcon, exts: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"], color: "#10b981" },
    { type: "pdf", label: "PDF", Icon: FileType2, exts: ["pdf"], color: "#ef4444" },
    { type: "slide", label: "演示", Icon: Presentation, exts: ["ppt", "pptx", "key"], color: "#f59e0b" },
    { type: "doc", label: "文档", Icon: FileDoc, exts: ["doc", "docx", "pages", "rtf", "txt", "md"], color: "#3b82f6" },
    { type: "sheet", label: "表格", Icon: Sheet, exts: ["xls", "xlsx", "numbers", "csv"], color: "#84cc16" },
    { type: "video", label: "视频", Icon: Film, exts: ["mp4", "mov", "m4v", "avi", "mkv", "webm"], color: "#a855f7" },
    { type: "audio", label: "音频", Icon: Music, exts: ["mp3", "wav", "m4a", "aac", "flac", "ogg"], color: "#ec4899" },
  ];

  const handleAttach = async (fileType: FileType, exts: string[]) => {
    if (!selectedId) {
      alert("请先在画布上选中一个节点再附加文件。");
      return;
    }
    if (!filePath) {
      alert(
        "附加文件需要先保存当前文档。\n请按 Cmd+S(或工具栏 💾 按钮)保存后再试。",
      );
      return;
    }
    let selected: string | null = null;
    try {
      const result = await openDialog({
        multiple: false,
        filters: [{ name: fileType, extensions: exts }],
      });
      selected = typeof result === "string" ? result : null;
    } catch (e) {
      console.error("[TabProperties] openDialog 失败", e);
      alert("打开文件选择器失败: " + e);
      return;
    }
    if (!selected) return;
    try {
      const attached = await invoke<AttachedFile>("attach_file_to_node", {
        mmapPath: filePath,
        nodeId: selectedId,
        srcPath: selected,
      });
      // 更新 store.content,把 attached_file 写入对应节点 + topic 替换为文件名 stem
      // + 设置固定尺寸 style(让附件节点视觉统一)
      const stem = attached.original_name.replace(new RegExp(`\\.${attached.ext}$`, "i"), "");
      let newStyle: Record<string, string> = {};
      updateContent((c) => {
        const walk = (n: any): boolean => {
          if (n.id === selectedId) {
            n.attached_file = attached;
            n.topic = stem;
            newStyle = withAttachFixedStyle(n.style);
            n.style = newStyle;
            return true;
          }
          for (const child of n.children || []) {
            if (walk(child)) return true;
          }
          return false;
        };
        walk(c.root);
      });
      // 同步到 mind-elixir 画布(立即生效,不等下一次 content 变化触发)
      if (mind?.findEle && selectedId) {
        try {
          const tpc = mind.findEle(selectedId);
          if (tpc) mind.reshapeNode(tpc, { style: newStyle });
        } catch (e) {
          console.error("[TabProperties] reshapeNode (attach) 失败", e);
        }
      }
    } catch (e) {
      console.error("[TabProperties] attach_file_to_node 失败", e);
      alert("附加文件失败: " + e);
    }
  };

  const handleRemoveAttached = async () => {
    if (!filePath || !selectedId || !node.attached_file) return;
    if (!confirm("确定移除附件?")) return;
    try {
      await invoke("remove_attached_file", { mmapPath: filePath, nodeId: selectedId });
      // 移除附件时清除固定尺寸 style,让节点恢复自适应
      let newStyle: Record<string, string> | undefined = undefined;
      updateContent((c) => {
        const walk = (n: any): boolean => {
          if (n.id === selectedId) {
            n.attached_file = undefined;
            newStyle = withoutAttachFixedStyle(n.style);
            n.style = newStyle;
            return true;
          }
          for (const child of n.children || []) {
            if (walk(child)) return true;
          }
          return false;
        };
        walk(c.root);
      });
      // 同步到 mind-elixir(传空对象让 mind-elixir 清除固定尺寸)
      if (mind?.findEle && selectedId) {
        try {
          const tpc = mind.findEle(selectedId);
          if (tpc) mind.reshapeNode(tpc, { style: newStyle || {} });
        } catch (e) {
          console.error("[TabProperties] reshapeNode (remove) 失败", e);
        }
      }
    } catch (e) {
      alert("移除附件失败: " + e);
    }
  };

  const handleOpenAttached = async () => {
    if (!filePath || !selectedId || !node.attached_file) return;
    try {
      await invoke("open_attached_file", { mmapPath: filePath, nodeId: selectedId });
    } catch (e) {
      alert("打开失败: " + e);
    }
  };

  const handleReplaceAttached = async () => {
    if (!selectedId || !node.attached_file) return;
    if (!filePath) {
      alert("替换附件需要先保存当前文档。\n请按 Cmd+S 保存后再试。");
      return;
    }
    let selected: string | null = null;
    try {
      const result = await openDialog({ multiple: false });
      selected = typeof result === "string" ? result : null;
    } catch (e) {
      console.error("[TabProperties] openDialog(替换) 失败", e);
      alert("打开文件选择器失败: " + e);
      return;
    }
    if (!selected) return;
    try {
      const attached = await invoke<AttachedFile>("replace_attached_file", {
        mmapPath: filePath,
        nodeId: selectedId,
        newSrc: selected,
      });
      const stem = attached.original_name.replace(new RegExp(`\\.${attached.ext}$`, "i"), "");
      updateContent((c) => {
        const walk = (n: any): boolean => {
          if (n.id === selectedId) {
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
    } catch (e) {
      console.error("[TabProperties] replace_attached_file 失败", e);
      alert("替换附件失败: " + e);
    }
  };

  const handleReveal = async () => {
    if (!filePath || !selectedId || !node.attached_file) return;
    try {
      await invoke("reveal_attached_file", { mmapPath: filePath, nodeId: selectedId });
    } catch (e) {
      alert("Finder 显示失败: " + e);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const btnStyle: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "4px 9px", fontSize: 11,
    border: "1px solid var(--glass-border)", borderRadius: 8,
    background: "rgba(255,255,255,0.05)", color: "var(--text-2)", cursor: "pointer",
  };

  // 优先级设置/清除
  const handlePriority = (p: Priority) => {
    const next: Priority | null = node.priority === p ? null : p;
    setPriorityForSelected(next);
  };

  // 图标操作
  const applyIcons = (icons: string[]) => {
    if (!mind || !selectedId) return;
    const tpc = mind.findEle?.(selectedId) || mind.currentNodes?.[0];
    if (!tpc) return;
    try {
      mind.reshapeNode(tpc, { icons });
    } catch (e) {
      console.error("[面板] reshapeNode icons 失败", e);
    }
  };

  const toggleIcon = (emoji: string) => {
    const current = node.icons || [];
    if (current.includes(emoji)) {
      applyIcons(current.filter((e: string) => e !== emoji));
    } else {
      applyIcons([...current, emoji]);
    }
  };

  // 节点路径面包屑(根→选中节点)
  const findPath = (n: any, id: string, acc: string[] = []): string[] | null => {
    if (!n?.id) return null;
    const next = [...acc, n.topic || ""];
    if (n.id === id) return next;
    for (const c of n.children || []) {
      const r = findPath(c, id, next);
      if (r) return r;
    }
    return null;
  };
  const pathParts = content?.root ? (findPath(content.root, node.id) ?? []) : [];
  const PRIORITY_BADGE: Record<string, string> = { P0: "P0 · 紧急", P1: "P1 · 高", P2: "P2 · 中", P3: "P3 · 低" };

  const currentIcons = node.icons || [];

  return (
    <div className="tab-pane">
      {/* === Hero 选中节点卡(视觉重心:徽章→标题→路径 三段式) === */}
      <div className="panel-card hero-card">
        <div className="hero-head">
          {node.priority ? (
            <span className={`hero-badge hero-badge-${node.priority.toLowerCase()}`}>
              <span className={`priority-dot priority-${node.priority.toLowerCase()}`}></span>
              {PRIORITY_BADGE[node.priority]}
            </span>
          ) : (
            <span className="hero-badge hero-badge-none">未设优先级</span>
          )}
          <span className="hero-sub">已选中</span>
        </div>
        <div className="hero-title">{node.topic || "(无标题)"}</div>
        {pathParts.length > 1 && (
          <div className="hero-path">
            {pathParts.slice(0, -1).map((t, i) => (
              <span key={i}><span className="sep">/</span>{t}</span>
            ))}
          </div>
        )}
      </div>
      {/* === 优先级:分段控件 === */}
      <div className="field">
        <span className="field-label">优先级</span>
        <div className="prio-seg">
          {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => {
            const isActive = node.priority === p;
            return (
              <button
                key={p}
                className={`prio-chip ${isActive ? "active" : ""} prio-seg-${p.toLowerCase()}`}
                onClick={() => handlePriority(p)}
              >
                <span className={`priority-dot priority-${p.toLowerCase()}`}></span>{p}
              </button>
            );
          })}
        </div>
        {!node.priority && (
          <span className="prio-hint">点击设置优先级</span>
        )}
      </div>

      {/* === 图标 === */}
      <div className="field">
        <span className="field-label">图标</span>
        {/* 已选图标列表 */}
        {currentIcons.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            {currentIcons.map((emoji: string, i: number) => {
              const Icon = EMOJI_TO_ICON[emoji];
              return (
                <div
                  key={i}
                  onClick={() => toggleIcon(emoji)}
                  title="点击移除"
                  style={{
                    display: "flex", alignItems: "center", gap: 3,
                    padding: "3px 6px", background: "rgba(0,224,127,0.08)",
                    border: "1px solid rgba(0,224,127,0.25)", borderRadius: 6,
                    cursor: "pointer", fontSize: 11, color: "var(--text-2)",
                  }}
                >
                  {Icon ? <Icon size={14} color="var(--text-2)" /> : <span>{emoji}</span>}
                  <X size={10} color="var(--text-4)" />
                </div>
              );
            })}
          </div>
        )}

        {/* SVG 图标选择器(始终展示) */}
        <div style={{ marginTop: 6, padding: 8, background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid var(--glass-border-soft)" }}>
          {ICON_CATEGORIES.map((cat) => (
            <div key={cat.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600 }}>
                {cat.label}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                {cat.icons.map(({ emoji, label, Icon }) => {
                  const selected = currentIcons.includes(emoji);
                    return (
                      <button
                        key={emoji}
                        onClick={() => toggleIcon(emoji)}
                        title={label}
                        style={{
                          width: 32, height: 32, display: "flex",
                          alignItems: "center", justifyContent: "center",
                          border: selected ? "2px solid var(--accent)" : "1px solid var(--glass-border-soft)",
                          borderRadius: 6, cursor: "pointer",
                          background: selected ? "rgba(0,224,127,0.12)" : "rgba(255,255,255,0.04)",
                          transition: "all 0.1s",
                        }}
                      >
                        <Icon size={16} color={selected ? "var(--accent)" : "var(--text-2)"} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
      </div>

      {/* === 附加文件 === */}
      <div className="field">
        <span className="field-label">附加文件</span>

        {/* 已附加文件信息 + 操作 */}
        {node.attached_file ? (
          <div style={{ padding: 10, background: "rgba(0,224,127,0.05)", border: "1px solid rgba(0,224,127,0.18)", borderRadius: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
              {node.attached_file.original_name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>
              {formatSize(node.attached_file.size_bytes)} · {node.attached_file.ext.toUpperCase()}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button onClick={handleOpenAttached} title="用系统工具打开" style={{ ...btnStyle, background: "rgba(0,224,127,0.14)", borderColor: "rgba(0,224,127,0.35)", color: "var(--accent)" }}>
                <ExternalLink size={12} /> 打开
              </button>
              <button onClick={handleReplaceAttached} title="替换文件" style={btnStyle}>
                <Upload size={12} /> 替换
              </button>
              <button onClick={handleReveal} title="在 Finder 中显示" style={btnStyle}>
                <FolderOpen size={12} /> Finder
              </button>
              <button onClick={handleRemoveAttached} title="移除附件" style={{ ...btnStyle, color: "#ff8585" }}>
                <Trash2 size={12} /> 移除
              </button>
            </div>
          </div>
        ) : null}

        {/* 文件类型选择器(点击 → 弹文件选择器) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 8, background: "rgba(0,0,0,0.18)", borderRadius: 10, border: "1px solid var(--glass-border-soft)" }}>
          {fileTypeFilters.map(({ type, label, Icon, exts, color }) => (
            <button
              key={type}
              onClick={() => handleAttach(type, exts)}
              title={`${label} (${exts.join(", ")})`}
              style={{
                width: 34, height: 34, display: "flex",
                alignItems: "center", justifyContent: "center",
                border: `1px solid ${color}55`, borderRadius: 8,
                cursor: "pointer", background: `${color}1a`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${color}30`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${color}1a`; }}
            >
              <Icon size={17} color={color} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
