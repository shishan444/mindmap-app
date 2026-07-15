import { useMindMapStore } from "../store";

export default function TabOutline() {
  const content = useMindMapStore((s) => s.content);
  const selectedId = useMindMapStore((s) => s.selectedNodeId);
  const setSelectedNodeId = useMindMapStore((s) => s.setSelectedNodeId);

  if (!content) return <div className="tab-empty">未打开文档</div>;

  return (
    <div className="tab-pane">
      <h3 className="section-title">大纲</h3>
      <div className="outline-tree">
        <OutlineNode
          node={content.root}
          depth={0}
          selectedId={selectedId}
          onSelect={setSelectedNodeId}
        />
      </div>
    </div>
  );
}

interface OutlineNodeProps {
  node: any;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function OutlineNode({ node, depth, selectedId, onSelect }: OutlineNodeProps) {
  const hasChildren = (node.children || []).length > 0;
  const isSelected = node.id === selectedId;
  return (
    <div className="outline-node">
      <div
        className={`outline-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onSelect(node.id)}
      >
        <span className="outline-bullet">
          {hasChildren ? "▾" : "•"}
        </span>
        <span className="outline-topic">{node.topic || "(空)"}</span>
      </div>
      {(node.children || []).map((c: any) => (
        <OutlineNode
          key={c.id}
          node={c}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
