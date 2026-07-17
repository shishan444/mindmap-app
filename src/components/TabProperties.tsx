import { useState } from "react";
import {
  CircleDashed, Loader, CheckCircle, Ban, Pause,
  Flame, TrendingUp, Minus, ArrowDown,
  Bug, Sparkles, ListTodo, Lightbulb, FileText,
  Star, AlertTriangle, Lock, Pin, Flag, Bookmark,
  X,
} from "lucide-react";
import { useMindMapStore } from "../store";
import type { Priority } from "../types";
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
  const mind = useMindMapStore((s) => s.mindInstance);
  const setPriorityForSelected = useMindMapStore((s) => s.setPriorityForSelected);
  const updateSelectedNode = useMindMapStore((s) => s.updateSelectedNode);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string>("");

  const node = findNode(content?.root ?? null, selectedId);
  if (!node) {
    return (
      <div className="tab-pane">
        <p className="tab-empty">未选中节点</p>
      </div>
    );
  }

  // 优先级设置/清除
  const handlePriority = (p: Priority) => {
    const next: Priority | null = node.priority === p ? null : p;
    setPriorityForSelected(next);
  };

  // 备注编辑
  const handleNoteChange = (value: string) => {
    setNoteDraft(value);
    updateSelectedNode({ note: value || undefined });
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
  const currentNote = noteDraft !== null ? noteDraft : (node.note || "");

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

      {/* === 备注 === */}
      <div className="field">
        <span className="field-label">备注</span>
        <textarea
          className="field-textarea"
          value={currentNote}
          onChange={(e) => handleNoteChange(e.target.value)}
          placeholder="输入备注..."
          style={{ minHeight: 60, background: "#fff", cursor: "text" }}
        />
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

        {/* 图标选择器展开/收起 */}
        <button
          onClick={() => setShowIconPicker(!showIconPicker)}
          style={{
            width: "100%", padding: "4px 8px", fontSize: 11,
            border: "1px solid #d1d1d1", borderRadius: 4, cursor: "pointer",
            background: showIconPicker ? "#e8f4ff" : "#fff",
          }}
        >
          {showIconPicker ? "▲ 收起图标" : "▼ 选择图标"}
        </button>

        {/* SVG 图标选择器 */}
        {showIconPicker && (
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
        )}
      </div>
    </div>
  );
}
