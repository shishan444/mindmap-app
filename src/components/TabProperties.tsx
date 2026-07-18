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
  const fileTypeFilters: { type: FileType; label: string; Icon: any; exts: string[] }[] = [
    { type: "image", label: "图片", Icon: ImageIcon, exts: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"] },
    { type: "pdf", label: "PDF", Icon: FileType2, exts: ["pdf"] },
    { type: "slide", label: "演示", Icon: Presentation, exts: ["ppt", "pptx", "key"] },
    { type: "doc", label: "文档", Icon: FileDoc, exts: ["doc", "docx", "pages", "rtf", "txt", "md"] },
    { type: "sheet", label: "表格", Icon: Sheet, exts: ["xls", "xlsx", "numbers", "csv"] },
    { type: "video", label: "视频", Icon: Film, exts: ["mp4", "mov", "m4v", "avi", "mkv", "webm"] },
    { type: "audio", label: "音频", Icon: Music, exts: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] },
  ];

  const handleAttach = async (fileType: FileType, exts: string[]) => {
    if (!filePath || !selectedId) return;
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: fileType, extensions: exts }],
    });
    if (typeof selected !== "string" || !selected) return;
    try {
      const attached = await invoke<AttachedFile>("attach_file_to_node", {
        mmapPath: filePath,
        nodeId: selectedId,
        srcPath: selected,
      });
      // 更新 store.content,把 attached_file 写入对应节点 + topic 替换为文件名 stem
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
      alert("附加文件失败: " + e);
    }
  };

  const handleRemoveAttached = async () => {
    if (!filePath || !selectedId || !node.attached_file) return;
    if (!confirm("确定移除附件?")) return;
    try {
      await invoke("remove_attached_file", { mmapPath: filePath, nodeId: selectedId });
      updateContent((c) => {
        const walk = (n: any): boolean => {
          if (n.id === selectedId) {
            n.attached_file = undefined;
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
    if (!filePath || !selectedId || !node.attached_file) return;
    const selected = await openDialog({
      multiple: false,
    });
    if (typeof selected !== "string" || !selected) return;
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
    padding: "4px 8px", fontSize: 11,
    border: "1px solid #d1d1d1", borderRadius: 4,
    background: "#fff", color: "#666", cursor: "pointer",
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

  const currentIcons = node.icons || [];

  return (
    <div className="tab-pane">
      {/* === 优先级 === */}
      <div className="field">
        <span className="field-label">优先级</span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["P0", "P1", "P2", "P3"] as Priority[]).map((p) => {
            const colors: Record<string, string> = {
              P0: "#e74c3c", P1: "#f39c12", P2: "#f1c40f", P3: "#95a5a6",
            };
            const isActive = node.priority === p;
            return (
              <button
                key={p}
                onClick={() => handlePriority(p)}
                style={{
                  flex: 1, padding: "5px 0", fontSize: 12, fontWeight: 600,
                  border: isActive ? "none" : "1px solid #d1d1d1",
                  borderRadius: 4, cursor: "pointer",
                  background: isActive ? colors[p] : "#fff",
                  color: isActive ? "#fff" : "#666",
                  transition: "all 0.15s",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
        {!node.priority && (
          <span style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>点击设置优先级</span>
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
                    padding: "3px 6px", background: "#f0f7ff",
                    border: "1px solid #d0e0ee", borderRadius: 4,
                    cursor: "pointer", fontSize: 11,
                  }}
                >
                  {Icon ? <Icon size={14} color="#333" /> : <span>{emoji}</span>}
                  <X size={10} color="#999" />
                </div>
              );
            })}
          </div>
        )}

        {/* SVG 图标选择器(始终展示) */}
        <div style={{ marginTop: 6, padding: 8, background: "#f9f9f9", borderRadius: 4, border: "1px solid #e8e8e8" }}>
          {ICON_CATEGORIES.map((cat) => (
            <div key={cat.label} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4, fontWeight: 600 }}>
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
                          border: selected ? "2px solid #4dc4ff" : "1px solid #e0e0e0",
                          borderRadius: 4, cursor: "pointer",
                          background: selected ? "#e8f4ff" : "#fff",
                          transition: "all 0.1s",
                        }}
                      >
                        <Icon size={16} color={selected ? "#4dc4ff" : "#666"} />
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
          <div style={{ padding: 8, background: "#f0f7ff", border: "1px solid #d0e0ee", borderRadius: 4, marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#333", marginBottom: 4 }}>
              {node.attached_file.original_name}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>
              {formatSize(node.attached_file.size_bytes)} · {node.attached_file.ext.toUpperCase()}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button onClick={handleOpenAttached} title="用系统工具打开" style={btnStyle}>
                <ExternalLink size={12} /> 打开
              </button>
              <button onClick={handleReplaceAttached} title="替换文件" style={btnStyle}>
                <Upload size={12} /> 替换
              </button>
              <button onClick={handleReveal} title="在 Finder 中显示" style={btnStyle}>
                <FolderOpen size={12} /> Finder
              </button>
              <button onClick={handleRemoveAttached} title="移除附件" style={{ ...btnStyle, color: "#e74c3c" }}>
                <Trash2 size={12} /> 移除
              </button>
            </div>
          </div>
        ) : null}

        {/* 文件类型选择器(点击 → 弹文件选择器) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: 8, background: "#f9f9f9", borderRadius: 4, border: "1px solid #e8e8e8" }}>
          {fileTypeFilters.map(({ type, label, Icon, exts }) => (
            <button
              key={type}
              onClick={() => handleAttach(type, exts)}
              title={`${label} (${exts.join(", ")})`}
              style={{
                width: 36, height: 36, display: "flex",
                alignItems: "center", justifyContent: "center",
                border: "1px solid #e0e0e0", borderRadius: 4,
                cursor: "pointer", background: "#fff",
                transition: "all 0.1s",
              }}
            >
              <Icon size={18} color="#666" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
