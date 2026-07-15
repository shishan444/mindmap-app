/**
 * 节点操作封装：把 mind-elixir 实例的 API 包装成纯函数。
 *
 * 这些函数接受 mind 实例和节点 ID，调用对应的 mind-elixir 方法。
 * 不直接修改 store——mind-elixir 内部变化后会通过 MindMapCanvas 的事件
 * 监听器同步回 store（触发 history）。
 *
 * 设计原则：
 * - 无效输入（无选中/找不到节点）静默 no-op，不抛错
 * - 根节点不可删除（思维导图必须有根）
 * - 函数是 pure wrapper，可独立测试（mock mind 实例）
 */

export interface MindInstanceLike {
  getObjById?: (id: string) => any;
  addChild?: (node?: any) => Promise<void> | void;
  insertSibling?: (
    type: "before" | "after",
    node?: any,
  ) => Promise<void> | void;
  beginEdit?: (node?: any) => Promise<void> | void;
  removeNodes?: (nodes: any[]) => Promise<void> | void;
  selectNode?: (node: any, isNewNode?: boolean) => void;
  setNodeTopic?: (el: any, topic: string) => Promise<void> | void;
  nodeData?: { id?: string };
}

/** 找到 mind 实例中对应 id 的节点 */
export function findNode(
  mind: MindInstanceLike | null | undefined,
  id: string | null | undefined,
): any | null {
  if (!mind || !id) return null;
  if (typeof mind.getObjById !== "function") return null;
  try {
    return mind.getObjById(id) || null;
  } catch {
    return null;
  }
}

/** 给选中节点添加子节点（Tab） */
export function addChildToSelected(
  mind: MindInstanceLike | null,
  selectedNodeId: string | null,
): boolean {
  const node = findNode(mind, selectedNodeId);
  if (!node || typeof mind!.addChild !== "function") return false;
  mind!.addChild(node);
  return true;
}

/** 给选中节点添加兄弟节点（Enter = after, Shift+Enter = before） */
export function addSiblingToSelected(
  mind: MindInstanceLike | null,
  selectedNodeId: string | null,
  position: "before" | "after" = "after",
): boolean {
  const node = findNode(mind, selectedNodeId);
  if (!node || typeof mind!.insertSibling !== "function") return false;
  // 根节点不允许加兄弟（思维导图只有一个根）
  if (mind!.nodeData && node.id === mind!.nodeData.id) return false;
  mind!.insertSibling(position, node);
  return true;
}

/** 进入选中节点的编辑模式（F2） */
export function editSelectedNode(
  mind: MindInstanceLike | null,
  selectedNodeId: string | null,
): boolean {
  const node = findNode(mind, selectedNodeId);
  if (!node || typeof mind!.beginEdit !== "function") return false;
  mind!.beginEdit(node);
  return true;
}

/** 删除选中节点（Delete/Backspace） */
export function deleteSelectedNode(
  mind: MindInstanceLike | null,
  selectedNodeId: string | null,
): boolean {
  const node = findNode(mind, selectedNodeId);
  if (!node || typeof mind!.removeNodes !== "function") return false;
  // 根节点不允许删除
  if (mind!.nodeData && node.id === mind!.nodeData.id) return false;
  mind!.removeNodes([node]);
  return true;
}

/** 修改选中节点的 topic */
export function setTopicForSelected(
  mind: MindInstanceLike | null,
  selectedNodeId: string | null,
  topic: string,
): boolean {
  const node = findNode(mind, selectedNodeId);
  if (!node || typeof mind!.setNodeTopic !== "function") return false;
  mind!.setNodeTopic(node, topic);
  return true;
}

/** 选中指定节点 */
export function selectNode(
  mind: MindInstanceLike | null,
  nodeId: string | null,
): boolean {
  const node = findNode(mind, nodeId);
  if (!node || typeof mind!.selectNode !== "function") return false;
  mind!.selectNode(node);
  return true;
}

/** 节点是否可删除（根节点不可删） */
export function canDeleteNode(
  mind: MindInstanceLike | null,
  nodeId: string | null | undefined,
): boolean {
  if (!mind || !nodeId) return false;
  if (!mind.nodeData) return true; // 无 root 信息时乐观允许
  return nodeId !== mind.nodeData.id;
}
