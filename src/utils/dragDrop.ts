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

export const DEFAULT_DROP_THRESHOLD = 0.15;

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
 * 构造 SVG path:从源节点中心到目标节点中心的直线。
 * 用于拖动时显示"我要把这个移到那里"的可视化连接。
 */
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
