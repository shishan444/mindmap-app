import { useMindMapStore } from "../store";
import type { MindNode } from "../types";

export default function TabOutline() {
  const content = useMindMapStore((s) => s.content);
  const selectedId = useMindMapStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useMindMapStore((s) => s.setSelectedNodeId);
  const mind = useMindMapStore((s) => s.mindInstance);

  const handleSelect = (id: string) => {
    setSelectedNodeId(id);
    if (mind?.findEle) {
      try {
        const tpc = mind.findEle(id);
        if (tpc) {
          mind.selectNode(tpc);
          if (mind.scrollIntoView) mind.scrollIntoView(tpc);
        }
      } catch {}
    }
  };

  const handleEdit = (id: string) => {
    handleSelect(id);
    if (mind?.findEle) {
      try {
        const tpc = mind.findEle(id);
        if (tpc && mind.beginEdit) mind.beginEdit(tpc);
      } catch {}
    }
  };

  if (!content) return <div className="tab-empty">未打开文档</div>;

  return (
    <div className="tab-pane">
      <h3 className="section-title">大纲</h3>
      <div className="outline-tree">
        <OutlineNode
          node={content.root}
          depth={0}
          selectedId={selectedId}
          onSelect={handleSelect}
          onEdit={handleEdit}
        />
      </div>
    </div>
  );
}

interface OutlineNodeProps {
  node: MindNode;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}

function OutlineNode({ node, depth, selectedId, onSelect, onEdit }: OutlineNodeProps) {
  const hasChildren = (node.children || []).length > 0;
  const isSelected = node.id === selectedId;
  return (
    <div className="outline-node">
      <div
        className={`outline-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => onEdit(node.id)}
        title="单击选中 · 双击编辑"
      >
        <span className="outline-bullet">
          {hasChildren ? "▾" : "•"}
        </span>
        <span className="outline-topic">{node.topic || "(空)"}</span>
      </div>
      {(node.children || []).map((c) => (
        <OutlineNode
          key={c.id}
          node={c}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
