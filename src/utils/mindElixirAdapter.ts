/**
 * mind-elixir 数据格式 ↔ 我们的 Content 格式 双向适配器
 *
 * 关键差异：
 * - mind-elixir 用 `expanded`（默认 true），我们用 `collapsed`（默认 false）—— 语义相反
 * - mind-elixir 的 NodeObj 不强制 root 字段，root 通过 nodeData 顶层位置识别
 * - 我们的扩展字段（note/priority/reminder_ids/attached_file）需要保留传递
 *
 * **attached_file 特殊处理**:
 * mind-elixir 内部不感知这个字段, attach 是后端命令直接写盘 + 前端 store 持有。
 * 当 mind-elixir 触发结构变化(addChild/insertSibling/removeNodes 等)时,syncFromMindElixir
 * 会从 mind-elixir 重新拉数据并覆盖 store.content —— 此时 mind-elixir nodeData 里没有
 * attached_file,会被丢掉。所以 fromMindElixirData 顶层按 id 从 prevContent 继承。
 */
import type { AttachedFile, Content, MindNode } from "../types";

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
  if (node.attached_file) me.attached_file = node.attached_file;
  if (node.style && Object.keys(node.style).length > 0) me.style = node.style;

  if (Array.isArray(node.children)) {
    me.children = node.children.map(nodeToMindElixirNode);
  } else {
    me.children = [];
  }
  return me;
}

/** mind-elixir NodeObj → MindNode
 *  attachedFileById(可选):从 prevContent 按 id 索引的 attached_file 映射,
 *  用于在 mind-elixir 同步覆盖时保留前端持有的附件信息。
 */
export function fromMindElixirNode(
  node: any,
  attachedFileById?: Map<string, AttachedFile>,
): MindNode {
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
  const id = String(node.id ?? "");
  // image 字段适配：mind-elixir 用 url，我们用 path
  let image = undefined;
  if (node.image && typeof node.image === "object") {
    image = {
      path: node.image.url ?? node.image.path ?? "",
      width: node.image.width ?? 0,
      height: node.image.height ?? 0,
    };
  }
  // attached_file:优先从 prevContent 继承(mind-elixir 不管理此字段);
  // 兜底从 node.attached_file 读(防御性,正常情况不会有)
  const attached_file =
    attachedFileById?.get(id) ?? node.attached_file ?? undefined;
  return {
    id,
    topic: String(node.topic ?? ""),
    collapsed: node.expanded === false,
    priority: node.priority,
    image,
    icons: Array.isArray(node.icons) ? node.icons : [],
    reminder_ids: Array.isArray(node.reminder_ids) ? node.reminder_ids : [],
    style:
      typeof node.style === "object" && node.style !== null ? node.style : {},
    attached_file,
    children: Array.isArray(node.children)
      ? node.children.map((c: any) => fromMindElixirNode(c, attachedFileById))
      : [],
  };
}

/** 整个 mind-elixir data → Content（保留扩展字段，触发历史）
 *  关键:从 prevContent 按 id 继承 attached_file,避免 mind-elixir 同步时丢附件。
 */
export function fromMindElixirData(
  data: { nodeData: any } | null | undefined,
  prevContent?: Content | null,
): Content | null {
  if (!data || !data.nodeData) return null;
  // 1) 从 prevContent 收集所有 attached_file,按 id 索引
  const attachedFileById = new Map<string, AttachedFile>();
  if (prevContent?.root) {
    const collect = (n: MindNode) => {
      if (n.attached_file) attachedFileById.set(n.id, n.attached_file);
      for (const c of n.children ?? []) collect(c);
    };
    collect(prevContent.root);
  }
  // 2) 转换时传入 map,递归继承
  const newRoot = fromMindElixirNode(data.nodeData, attachedFileById);
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
