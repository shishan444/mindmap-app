import { useEffect } from "react";
import { createPortal } from "react-dom";
import "./HotkeyHelpModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 快捷键速查(玻璃模态,P3-12:帮助能力补全)
 * 帮助菜单「快捷键速查」(Cmd+/)打开。
 */

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "节点操作",
    items: [
      ["Tab", "添加子节点"],
      ["Enter", "添加兄弟节点"],
      ["F2 / 双击", "编辑节点文本(双击附件节点为打开附件)"],
      ["Delete / ⌫", "删除选中节点"],
      ["拖动节点", "上=移到目标之前 · 中=变为子节点 · 下=移到目标之后"],
    ],
  },
  {
    title: "文档",
    items: [
      ["⌘N", "新建文档"],
      ["⌘O", "打开文档"],
      ["⌘S", "保存文档"],
    ],
  },
  {
    title: "编辑",
    items: [
      ["⌘Z", "撤销"],
      ["⇧⌘Z", "重做"],
    ],
  },
  {
    title: "视图与搜索",
    items: [
      ["⌘F", "搜索节点"],
      ["⇧⌘L", "自动布局整理"],
      ["⌘\\", "切换侧边栏"],
      ["Esc", "取消 / 退出编辑"],
    ],
  },
];

export default function HotkeyHelpModal({ open, onClose }: Props) {
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
  // 本组件是新写的却违反了 v0.3.1 纪律——证明约束必须活在代码/测试里,
  // 不能依赖记忆。配套 architecture.test 静态守护防复发。
  return createPortal(
    <div
      className="hotkey-mask"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="hotkey-modal" role="dialog" aria-label="快捷键速查">
        <div className="hotkey-header">
          <div className="hotkey-title">快捷键速查</div>
          <button className="hotkey-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="hotkey-body">
          {GROUPS.map((g) => (
            <div key={g.title} className="hotkey-group">
              <div className="hotkey-group-title">{g.title}</div>
              {g.items.map(([k, desc]) => (
                <div key={k} className="hotkey-row">
                  <span className="hotkey-desc">{desc}</span>
                  <span className="hotkey-keys">
                    {k.split(" ").map((part, i) =>
                      part === "/" || part === "·" ? (
                        <span key={i} className="hotkey-sep">{part}</span>
                      ) : (
                        <kbd key={i} className="hotkey-kbd">{part}</kbd>
                      ),
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
