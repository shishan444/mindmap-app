/**
 * mind-elixir 数据格式 ↔ 我们的 Content 格式 双向适配器
 *
 * 关键差异：
 * - mind-elixir 用 `expanded`（默认 true），我们用 `collapsed`（默认 false）—— 语义相反
 * - mind-elixir 的 NodeObj 不强制 root 字段，root 通过 nodeData 顶层位置识别
 * - 我们的扩展字段（note/priority/reminder_ids）需要保留传递
 */
import type { Content, MindNode } from "../types";

/** 我们的 Content → mind-elixir 的 MindElixirData */
export function toMindElixirData(content: Content | null): {
  nodeData: any;
} {
  if (!content) {
    return {
      nodeData: {
        id: "root",
        topic: "中心主题",
        expanded: true,
        children: [],
      },
    };
  }
  return {
    nodeData: nodeToMindElixirNode(content.root),
  };
}

/** 单个节点：MindNode → mind-elixir NodeObj */
export function nodeToMindElixirNode(node: MindNode): any {
  const me: any = {
    id: node.id,
    topic: node.topic || "",
    // collapsed=false → expanded=true；collapsed=true → expanded=false
    expanded: node.collapsed !== true,
  };
  // 保留扩展字段（让 mind-elixir 内部 dispatch 时能带回来）
  if (node.note !== undefined && node.note !== null) me.note = node.note;
  if (node.priority !== undefined && node.priority !== null) {
    me.priority = node.priority;
  }
  if (node.image) {
    // mind-elixir NodeObj.image 用 url；我们的 NodeImage 用 path 存 data URL
    me.image = {
      url: node.image.path,
      width: node.image.width,
      height: node.image.height,
    };
  }
  if (Array.isArray(node.icons) && node.icons.length > 0) me.icons = node.icons;
  if (Array.isArray(node.reminder_ids) && node.reminder_ids.length > 0) {
    me.reminder_ids = node.reminder_ids;
  }
  if (node.style && Object.keys(node.style).length > 0) me.style = node.style;

  if (Array.isArray(node.children)) {
    me.children = node.children.map(nodeToMindElixirNode);
  } else {
    me.children = [];
  }
  return me;
}

/** mind-elixir NodeObj → MindNode */
export function fromMindElixirNode(node: any): MindNode {
  if (!node || typeof node !== "object") {
    return {
      id: "",
      topic: "",
      collapsed: false,
      children: [],
      icons: [],
      reminder_ids: [],
      style: {},
    };
  }
  // image 字段适配：mind-elixir 用 url，我们用 path
  let image = undefined;
  if (node.image && typeof node.image === "object") {
    image = {
      path: node.image.url ?? node.image.path ?? "",
      width: node.image.width ?? 0,
      height: node.image.height ?? 0,
    };
  }
  return {
    id: String(node.id ?? ""),
    topic: String(node.topic ?? ""),
    collapsed: node.expanded === false,
    note: node.note,
    priority: node.priority,
    image,
    icons: Array.isArray(node.icons) ? node.icons : [],
    reminder_ids: Array.isArray(node.reminder_ids) ? node.reminder_ids : [],
    style:
      typeof node.style === "object" && node.style !== null ? node.style : {},
    children: Array.isArray(node.children)
      ? node.children.map(fromMindElixirNode)
      : [],
  };
}

/** 整个 mind-elixir data → Content（保留扩展字段，触发历史） */
export function fromMindElixirData(
  data: { nodeData: any } | null | undefined,
  prevContent?: Content | null,
): Content | null {
  if (!data || !data.nodeData) return null;
  const newRoot = fromMindElixirNode(data.nodeData);
  const prevCanvas = prevContent?.canvas_state;
  return {
    version: prevContent?.version ?? "1.0.0",
    root: newRoot,
    canvas_state: prevCanvas ?? {
      zoom: 1,
      pan_x: 0,
      pan_y: 0,
    },
  };
}
