import { useEffect, useRef } from "react";
import MindElixir from "mind-elixir";
import { useMindMapStore } from "../store";
import {
  toMindElixirData,
  fromMindElixirData,
} from "../utils/mindElixirAdapter";
import "./MindMapCanvas.css";

interface Props {
  onCreateInstance?: (mind: any) => void;
}

export default function MindMapCanvas({ onCreateInstance }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);
  const content = useMindMapStore((s) => s.content);
  const setContent = useMindMapStore((s) => s.setContent);
  const setSelectedNodeId = useMindMapStore((s) => s.setSelectedNodeId);
  const markDirty = useMindMapStore((s) => s.markDirty);

  // 初始化 mind-elixir（仅 mount 一次）
  useEffect(() => {
    if (!containerRef.current) return;
    const data = toMindElixirData(content);
    let mind: any;
    try {
      mind = new MindElixir({
        el: containerRef.current,
        direction: MindElixir.RIGHT,
        draggable: true,
        editable: true,
        contextMenu: true,
        toolBar: true,
        keypress: true,
        data,
      } as any);
      mind.init(data);
      instanceRef.current = mind;
      onCreateInstance?.(mind);
    } catch (e) {
      console.error("[MindMapCanvas] init failed:", e);
      return;
    }
    if (!mind) return;

    const bus = mind.bus as any;

    bus.addListener("selectNode", (node: any) => {
      setSelectedNodeId(node?.id ?? null);
    });

    const changeEvents = [
      "operation",
      "insertSibling",
      "insertChild",
      "addChild",
      "removeNode",
      "moveNode",
      "updateNodeTopic",
      "moveNodeBefore",
      "moveNodeAfter",
    ];
    changeEvents.forEach((evt) => {
      bus.addListener(evt, () => {
        markDirty();
        syncFromMindElixir();
      });
    });

    function syncFromMindElixir() {
      const inst = instanceRef.current;
      if (!inst) return;
      try {
        const data =
          typeof inst.getData === "function"
            ? inst.getData()
            : inst.nodeData
            ? { nodeData: inst.nodeData }
            : null;
        if (!data || !data.nodeData) return;
        const state = useMindMapStore.getState();
        const newContent = fromMindElixirData(data, state.content);
        if (!newContent) return;
        if (state.content && state.content.root === newContent.root) return;
        setContent(newContent);
      } catch (e) {
        console.error("[mind-elixir sync] 失败", e);
      }
    }

    return () => {
      try {
        mind.destroy();
      } catch (e) {
        console.error("[mind-elixir] destroy 失败", e);
      }
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // content.root.id 变化时（如切换文档、新建），重新 init mind-elixir
  // 注意：不要清空 containerRef.innerHTML —— mind-elixir 的 init 内部会自己处理 DOM，
  // 外部清空会破坏其对内部节点（map-container/lines/etc.）的引用，导致后续渲染失败。
  useEffect(() => {
    if (!instanceRef.current || !content) return;
    const data = toMindElixirData(content);
    try {
      instanceRef.current.init(data);
    } catch (e) {
      console.error("[MindMapCanvas] re-init failed:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.root.id]);

  return (
    <div className="canvas-container">
      <div className="mind-elixir-wrap">
        <div className="mind-elixir-inner" ref={containerRef} />
      </div>
      {!content && (
        <div className="canvas-empty">
          <div className="empty-icon">🧠</div>
          <p>暂未打开任何思维导图</p>
          <p className="empty-hint">点击菜单 文件 → 新建 或 打开 开始</p>
        </div>
      )}
    </div>
  );
}
