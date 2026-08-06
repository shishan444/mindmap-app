/**
 * 拖动落点判定 + SVG 连线工具函数。
 *
 * 设计目标:
 * - computeDropZone 是纯函数,便于 L1 单元测试覆盖阈值边界
 * - buildSvgLine 生成从源到目标的 SVG path,用于实时虚线可视化
 * - 阈值默认 0.15(上 15% 是 before,下 15% 是 after,中间 70% 是 inside)
 *   让兄弟排序更宽容,减少误操作成"嵌入子节点"
 */

export type DropZone = "before" | "after" | "inside";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlaceholderRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 项目 MindNode 最小契约(避免 import 整个 types) */
export interface MutableMindNode {
  id: string;
  topic?: string;
  children?: MutableMindNode[];
  [key: string]: unknown;
}

export interface ContentLike {
  root: MutableMindNode;
  [key: string]: unknown;
}

export const DEFAULT_DROP_THRESHOLD = 0.15;
export const DROP_GAP_PX = 20;

/**
 * 计算鼠标在目标节点上的落点区域。
 * - relY < threshold → "before"(同级,排到目标之前)
 * - relY > 1 - threshold → "after"(同级,排到目标之后)
 * - 中间 → "inside"(成为目标的子节点)
 *
 * 边界:height<=0 视为零高度节点,直接返回 "inside"(避免除零)。
 */
export function computeDropZone(
  targetRect: Rect,
  mouseY: number,
  threshold: number = DEFAULT_DROP_THRESHOLD,
): DropZone {
  if (targetRect.height <= 0) return "inside";
  const relY = (mouseY - targetRect.top) / targetRect.height;
  if (relY < threshold) return "before";
  if (relY > 1 - threshold) return "after";
  return "inside";
}

/**
 * 计算拖动时 **source 自身** 的预览位置(source 移到目标位置,不是 placeholder 占位)。
 *
 * 坐标系:mind-elixir RIGHT 布局,同一父的子节点纵向排列(同 x 列,top 递增)
 * - before: source 预览 top = target.top - source.height - gap(占 target 上方)
 * - after:  source 预览 top = target.bottom + gap(占 target 下方间隙)
 * - inside: source 预览 left = target.right + gap(成为 target 子节点,横向偏移)
 *
 * 决定性约束:mind-elixir 5.14 linkDiv 基于 offsetLeft/offsetTop 绘制连接线,
 * 不跟随 transform。source 用 transform 移到本函数返回的位置后,内置 A→source
 * 连接线停留原位,所以 caller 必须自画 SVG 连接线覆盖。
 */
export interface PreviewPosition {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * ★方案 R 修复(placeholder 位置不准)★
 *
 * 基于 **实测的下一个让位兄弟 boundingRect** 计算 placeholder 位置,
 * 不再用 target.bottom + gap 推算。
 *
 * 决定性事实:mind-elixir 内部 --node-gap-y=10px,跟我们的 DROP_GAP_PX=20 不一致。
 * 推算会让 placeholder 跟实际兄弟位置脱节(用户报告"placeholder 跟 C 重叠,
 * 没到 D 原位")。
 *
 * - before: placeholder = targetRect(target 让位,target 加 transform 后离开原位)
 * - after:  placeholder = firstShiftedSiblingRect(D 让位前的原位置);
 *           target 是最后一个时 firstShiftedSiblingRect=null,fallback 到 target.bottom + gap
 * - inside: placeholder 紧贴 target 右侧(横向,因为 target 的子节点在右)
 *
 * caller 必须在 applySiblingShift **之前** 测量 firstShiftedSiblingRect,
 * 否则 transform 应用后 rect 会变。
 */
export function computePlaceholderRectFromActual(
  sourceRect: Rect,
  targetRect: Rect,
  firstShiftedSiblingRect: Rect | null,
  zone: DropZone,
  gap: number = DROP_GAP_PX,
): PreviewPosition {
  const width = sourceRect.width;
  const height = sourceRect.height;

  if (zone === "inside") {
    return {
      left: targetRect.left + targetRect.width + gap,
      top: targetRect.top,
      width,
      height,
    };
  }

  if (zone === "before") {
    // placeholder 占 target 当前位置(target 让位)
    return {
      left: targetRect.left,
      top: targetRect.top,
      width,
      height,
    };
  }

  // after
  if (firstShiftedSiblingRect) {
    // ★ 关键修复:placeholder 占 D 让位前的原位置(实测,不推算)
    return {
      left: firstShiftedSiblingRect.left,
      top: firstShiftedSiblingRect.top,
      width,
      height,
    };
  }
  // target 是最后一个兄弟,无下一个 sibling,fallback 推算
  return {
    left: targetRect.left,
    top: targetRect.top + targetRect.height + gap,
    width,
    height,
  };
}

export function computeSourcePreviewPosition(
  sourceRect: Rect,
  targetRect: Rect,
  zone: DropZone,
  gap: number = DROP_GAP_PX,
): PreviewPosition {
  const width = sourceRect.width;
  const height = sourceRect.height;

  if (zone === "inside") {
    return {
      left: targetRect.left + targetRect.width + gap,
      top: targetRect.top,
      width,
      height,
    };
  }

  if (zone === "before") {
    return {
      left: targetRect.left,
      top: targetRect.top - height - gap,
      width,
      height,
    };
  }

  // after
  const targetBottom = targetRect.top + targetRect.height;
  return {
    left: targetRect.left,
    top: targetBottom + gap,
    width,
    height,
  };
}

/**
 * 计算 source 移动时,sibling 应该让位的位移量(纵向 translateY)。
 *
 * - before: target 自己 + target 之后的兄弟 让位(向下)
 * - after:  target 之后的兄弟 让位(target 不动)
 * - inside: 不让位(无位移)
 *
 * 位移量 = source 子树高度 + gap
 */
export function computeSiblingShift(
  sourceRect: Rect,
  zone: DropZone,
  gap: number = DROP_GAP_PX,
): number {
  if (zone === "inside") return 0;
  return sourceRect.height + gap;
}

/**
 * 计算连接线 SVG path:从 anchor(通常是 source 的父节点 A)中心到 source 预览位置中心。
 *
 * 用于拖动时绘制 A→B 的虚线,因为 mind-elixir 内置连接线不跟随 transform。
 */
export function buildConnectionLinePath(
  anchorRect: Rect,
  previewRect: PreviewPosition,
): string {
  return buildSvgLine(anchorRect, previewRect);
}

/**
 * 计算 source 节点 transform 的位移量(从原位置到预览位置)。
 *
 * source 用 `transform: translate(dx, dy)` 移到预览位置。
 * dx = previewLeft - sourceLeft
 * dy = previewTop - sourceTop
 */
export function computeSourceTransform(
  sourceRect: Rect,
  preview: PreviewPosition,
): { dx: number; dy: number } {
  return {
    dx: preview.left - sourceRect.left,
    dy: preview.top - sourceRect.top,
  };
}

/**
 * 在 content 层直接移动节点(绕开 mind-elixir 5.14 的 moveNodeBefore/After/In)。
 *
 * 根因:mind-elixir 5.14 的 It 函数(MindElixir.js:439)依赖 target.nodeObj.parent.children
 * 找兄弟节点,但项目 store.MindNode 类型没有 parent 字段(由 mind-elixir B 函数衍生)。
 * 在某些场景下 parent 字段 stale,It 直接 return,nodeData 不变,
 * 触发 syncFromMindElixir 拉旧数据 → DOM 回滚 → 用户看到"没生效"。
 *
 * 本函数在 store.content 层做 splice(完全可靠),返回新 content。
 * onDragEnd 调用后 setContent + mind.refresh(toMindElixirData(content)) 重建 DOM。
 *
 * 返回 null 表示操作非法(source/target 不存在、source 是 root、target 是 source 子孙)。
 */
export function moveNodeInContent(
  content: ContentLike,
  sourceId: string,
  targetId: string,
  zone: DropZone,
): ContentLike | null {
  // 深拷贝(避免改原 content,React 才能检测变化)
  const cloned: ContentLike = JSON.parse(JSON.stringify(content));

  type Found = {
    node: MutableMindNode;
    parentArr: MutableMindNode[] | null;
    index: number;
  };
  const found: { source: Found | null; target: Found | null } = {
    source: null,
    target: null,
  };

  const walk = (
    node: MutableMindNode,
    parentArr: MutableMindNode[] | null,
    idx: number,
  ) => {
    if (node.id === sourceId) {
      found.source = { node, parentArr, index: idx };
    }
    if (node.id === targetId) {
      found.target = { node, parentArr, index: idx };
    }
    if (node.children) {
      node.children.forEach((child, i) => walk(child, node.children!, i));
    }
  };

  walk(cloned.root, null, 0);

  const sourceFound = found.source;
  const targetFound = found.target;
  if (!sourceFound || !targetFound) return null;
  if (!sourceFound.parentArr || !targetFound.parentArr) return null;

  const contains = (root: MutableMindNode, looking: string): boolean => {
    if (root.id === looking) return true;
    return (root.children ?? []).some((c) => contains(c, looking));
  };
  if (contains(sourceFound.node, targetId)) return null;

  sourceFound.parentArr.splice(sourceFound.index, 1);

  let targetIdx = targetFound.index;
  if (
    sourceFound.parentArr === targetFound.parentArr &&
    sourceFound.index < targetFound.index
  ) {
    targetIdx -= 1;
  }

  if (zone === "inside") {
    if (!targetFound.node.children) targetFound.node.children = [];
    targetFound.node.children.push(sourceFound.node);
  } else if (zone === "before") {
    targetFound.parentArr.splice(targetIdx, 0, sourceFound.node);
  } else {
    targetFound.parentArr.splice(targetIdx + 1, 0, sourceFound.node);
  }

  return cloned;
}

/**
 * L2 业务流程协调器:把 onDragEnd 的核心逻辑提取为可测试纯函数。
 *
 * 跨边界协作:dragState(事件状态)→ moveNodeInContent(store 层 splice)
 * → setContent(React store)→ refresh(mind-elixir DOM 重建)。
 *
 * 这层测试覆盖 onDragEnd 的所有分支,不依赖真实 DOM/mind-elixir/Tauri,
 * 但证明了"拖动结束 → 数据正确流转 → 副作用按预期触发"。
 */

export interface DragStateLike {
  source: { nodeObj?: { id?: string } };
  currentTarget: { nodeObj?: { id?: string } } | null;
  currentZone: DropZone | null;
  isDragging: boolean;
}

export interface DropExecutors {
  getContent: () => ContentLike | null;
  setContent: (c: ContentLike) => void;
  refresh: (data: { nodeData: unknown }) => void;
  toMindElixirData: (c: ContentLike) => { nodeData: unknown };
}

export type DropResult =
  | { ok: true }
  | { ok: false; reason: "no_drag" | "no_target" | "no_zone" | "no_content" | "illegal_move" };

export function executeDrop(
  dragState: DragStateLike | null,
  exec: DropExecutors,
): DropResult {
  if (!dragState || !dragState.isDragging) return { ok: false, reason: "no_drag" };

  const target = dragState.currentTarget;
  const zone = dragState.currentZone;
  if (!target) return { ok: false, reason: "no_target" };
  if (!zone) return { ok: false, reason: "no_zone" };

  const sourceId = dragState.source.nodeObj?.id;
  const targetId = target.nodeObj?.id;
  if (!sourceId || !targetId) return { ok: false, reason: "no_target" };

  const currentContent = exec.getContent();
  if (!currentContent) return { ok: false, reason: "no_content" };

  const newContent = moveNodeInContent(currentContent, sourceId, targetId, zone);
  if (!newContent) return { ok: false, reason: "illegal_move" };

  exec.setContent(newContent);
  exec.refresh(exec.toMindElixirData(newContent));
  return { ok: true };
}

export function buildSvgLine(sourceRect: Rect, targetRect: Rect): string {
  const x1 = sourceRect.left + sourceRect.width / 2;
  const y1 = sourceRect.top + sourceRect.height / 2;
  const x2 = targetRect.left + targetRect.width / 2;
  const y2 = targetRect.top + targetRect.height / 2;
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

export function rectCenter(rect: Rect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function rectBottom(rect: Rect): number {
  return rect.top + rect.height;
}
