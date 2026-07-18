/**
 * 沙漏图标 — 节点 reminder 状态的纯视觉标识。
 *
 * 设计原则:
 * - 形状本身承载信息(沙量 = 剩余时间比例),不仅靠颜色
 * - 不响应任何鼠标事件(pointer-events: none),点击穿透到下层节点
 * - 多 reminder 节点显示最紧迫状态,父组件负责传入聚合后的状态
 *
 * 状态映射:
 * - future  (>5min):  上沙堆满, 静止, 蓝色
 * - looming (≤5min):  上半下沙, 沙流缓动, 黄色
 * - due     (已到期): 上空下满, 沙流加速, 红色
 * - done    (已完成): 180° 翻转, 灰色
 * - paused  (禁用):   静态半透明, 灰色
 */

export type ReminderState = "future" | "looming" | "due" | "done" | "paused";

interface HourglassIconProps {
  state: ReminderState;
  /** 剩余时间比例 0-1,决定上沙堆高度(只在 future/looming/due 用) */
  remainingRatio?: number;
  size?: number;
}

const STATE_COLORS: Record<ReminderState, string> = {
  future: "#4dc4ff",
  looming: "#f5a623",
  due: "#e74c3c",
  done: "#9aa0a6",
  paused: "#cccccc",
};

export default function HourglassIcon({
  state,
  remainingRatio = 1,
  size = 14,
}: HourglassIconProps) {
  const color = STATE_COLORS[state];
  // 沙堆高度按比例(0=全空, 1=全满)
  const upperRatio = state === "done" ? 0 : Math.max(0, Math.min(1, remainingRatio));
  const lowerRatio = state === "done" ? 1 : 1 - upperRatio;

  // 翻转角度(完成状态 180°)
  const rotation = state === "done" ? 180 : 0;

  // 透明度(paused/done 半透明)
  const opacity = state === "paused" ? 0.4 : state === "done" ? 0.6 : 1;

  // 动画 class(只在 looming/due 状态下流动)
  const animClass =
    state === "looming" ? "hourglass-flow-slow" : state === "due" ? "hourglass-flow-fast" : "";

  // 上沙堆高度按 ratio 计算 path
  // 上半内部空间:y=4 到 y=9(高度 5),按 ratio 填充
  // 沙堆形状是上宽下窄的梯形
  const upperPath = buildUpperSandPath(upperRatio);
  const lowerPath = buildLowerSandPath(lowerRatio);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={`hourglass-icon hourglass-${state} ${animClass}`}
      style={{
        pointerEvents: "none",
        transform: `rotate(${rotation}deg)`,
        opacity,
        transition: "transform 0.4s ease, opacity 0.3s ease",
        display: "block",
      }}
      aria-hidden="true"
    >
      {/* 上下框架 */}
      <rect x="3" y="2" width="14" height="1.5" fill={color} />
      <rect x="3" y="16.5" width="14" height="1.5" fill={color} />

      {/* 玻璃外壳(上下梯形) */}
      <path
        d="M4 3.5 L16 3.5 L11 9.5 Q10 10.3 9 9.5 Z"
        fill={color}
        fillOpacity="0.12"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M4 16.5 L16 16.5 L11 10.5 Q10 9.7 9 10.5 Z"
        fill={color}
        fillOpacity="0.12"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />

      {/* 上方剩余沙堆 */}
      {upperRatio > 0.02 && <path d={upperPath} fill={color} fillOpacity="0.85" />}

      {/* 下方已落沙堆 */}
      {lowerRatio > 0.02 && <path d={lowerPath} fill={color} />}

      {/* 中间沙流(细线,在 looming/due 时通过 CSS 显示流动动画) */}
      <line
        x1="10"
        y1="9.5"
        x2="10"
        y2="10.5"
        stroke={color}
        strokeWidth="0.6"
        className="hourglass-stream"
        opacity={state === "looming" || state === "due" ? 0.9 : 0}
      />
    </svg>
  );
}

/**
 * 计算上方沙堆 path(按 ratio 0-1)。
 *
 * 上半梯形内部空间:
 *   顶部宽: y=3.5, x 从 4 到 16(宽 12)
 *   底部窄: y=9.5, x 从 9 到 11(宽 2)
 * ratio=1: 满堆(整个梯形)
 * ratio=0: 空(无 path)
 * ratio=0.5: 中间高度,梯形变窄
 */
function buildUpperSandPath(ratio: number): string {
  if (ratio <= 0) return "";
  // 沙堆顶部 y(从 3.5 开始向下填充)
  const topY = 3.5 + (9.5 - 3.5) * (1 - ratio);
  // 在 topY 高度,梯形宽度按线性插值
  const ratioAtTop = (topY - 3.5) / (9.5 - 3.5); // 0=顶部, 1=底部
  const halfWidth = 6 - 5 * ratioAtTop; // 6 → 1
  const cx = 10;
  return `M${cx - halfWidth} ${topY} L${cx + halfWidth} ${topY} L11 9.5 Q10 10.3 9 9.5 Z`;
}

/**
 * 计算下方沙堆 path(按 ratio 0-1)。
 *
 * 下半梯形内部空间:
 *   顶部窄: y=10.5, x 从 9 到 11
 *   底部宽: y=16.5, x 从 4 到 16
 * ratio=1: 满堆
 * ratio=0: 空
 */
function buildLowerSandPath(ratio: number): string {
  if (ratio <= 0) return "";
  // 沙堆顶部 y(从 16.5 向上堆积)
  const topY = 16.5 - (16.5 - 10.5) * ratio;
  // 在 topY 高度,梯形宽度按线性插值(下宽 6 → 上窄 1)
  const ratioAtTop = (16.5 - topY) / (16.5 - 10.5); // 0=底部, 1=顶部
  const halfWidth = 6 - 5 * ratioAtTop;
  const cx = 10;
  return `M${cx - halfWidth} ${topY} L${cx + halfWidth} ${topY} L16 16.5 L4 16.5 Z`;
}
