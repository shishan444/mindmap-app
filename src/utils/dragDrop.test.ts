import { describe, it, expect } from "vitest";
import {
  computeDropZone,
  buildSvgLine,
  rectCenter,
  rectBottom,
  DEFAULT_DROP_THRESHOLD,
  type Rect,
} from "./dragDrop";

const rect = (top: number, height: number, left = 0, width = 100): Rect => ({
  left,
  top,
  width,
  height,
});

describe("OB-027 dragDrop: computeDropZone 默认阈值 0.15", () => {
  it("relY < 0.15 → before(上半部)", () => {
    const r = rect(100, 200); // top=100, height=200, bottom=300
    expect(computeDropZone(r, 100)).toBe("before"); // relY=0
    expect(computeDropZone(r, 120)).toBe("before"); // relY=0.1
    expect(computeDropZone(r, 129)).toBe("before"); // relY=0.145(临界内)
  });

  it("relY > 0.85 → after(下半部)", () => {
    const r = rect(100, 200);
    expect(computeDropZone(r, 271)).toBe("after"); // relY=0.855
    expect(computeDropZone(r, 290)).toBe("after"); // relY=0.95
    expect(computeDropZone(r, 300)).toBe("after"); // relY=1.0
  });

  it("中间 70% → inside(成为子节点)", () => {
    const r = rect(100, 200);
    expect(computeDropZone(r, 131)).toBe("inside"); // relY=0.155(临界内)
    expect(computeDropZone(r, 200)).toBe("inside"); // relY=0.5
    expect(computeDropZone(r, 269)).toBe("inside"); // relY=0.845(临界内)
  });

  it("★bug 防回归★ 阈值 0.15 时,鼠标在 0.2/0.8 位置应是 inside(非误触)", () => {
    const r = rect(0, 100);
    // 旧阈值 0.25 下,0.2 会被判 before,0.8 会被判 after(误触)
    // 新阈值 0.15 下,这两个位置都是 inside
    expect(computeDropZone(r, 20)).toBe("inside");
    expect(computeDropZone(r, 80)).toBe("inside");
  });
});

describe("OB-027 dragDrop: computeDropZone 边界语义", () => {
  it("relY 恰好等于 threshold 是 inside(开区间)", () => {
    const r = rect(0, 100);
    // threshold=0.15,relY=0.15 应是 inside(因为条件是 < threshold)
    expect(computeDropZone(r, 15)).toBe("inside");
    // relY=0.85 也是 inside(因为条件是 > 0.85,等号不算)
    expect(computeDropZone(r, 85)).toBe("inside");
  });

  it("height=0 防御:返回 inside 避免除零", () => {
    const r = rect(100, 0);
    expect(computeDropZone(r, 100)).toBe("inside");
  });

  it("mouseY 在 rect 之上(< top)仍判 before", () => {
    const r = rect(100, 200);
    expect(computeDropZone(r, 50)).toBe("before"); // relY=-0.25
    expect(computeDropZone(r, 0)).toBe("before");
  });

  it("mouseY 在 rect 之下(> bottom)仍判 after", () => {
    const r = rect(100, 200);
    expect(computeDropZone(r, 400)).toBe("after"); // relY=1.5
  });
});

describe("OB-027 dragDrop: computeDropZone 自定义阈值", () => {
  it("threshold=0.25(旧值)时,relY=0.2 是 before", () => {
    const r = rect(0, 100);
    expect(computeDropZone(r, 20, 0.25)).toBe("before");
    expect(computeDropZone(r, 80, 0.25)).toBe("after");
    expect(computeDropZone(r, 50, 0.25)).toBe("inside");
  });

  it("threshold=0.5 时,上半/下半各占 50%(inside 几乎消失)", () => {
    const r = rect(0, 100);
    expect(computeDropZone(r, 10, 0.5)).toBe("before");
    expect(computeDropZone(r, 90, 0.5)).toBe("after");
    // threshold=0.5 时 0.4 < 0.5 → before;0.6 > 0.5 → after
    expect(computeDropZone(r, 40, 0.5)).toBe("before");
    expect(computeDropZone(r, 60, 0.5)).toBe("after");
    // 恰好等于 0.5 时(< 和 > 都不满足)→ inside
    expect(computeDropZone(r, 50, 0.5)).toBe("inside");
  });

  it("DEFAULT_DROP_THRESHOLD 常量是 0.15", () => {
    expect(DEFAULT_DROP_THRESHOLD).toBe(0.15);
  });
});

describe("OB-027 dragDrop: buildSvgLine", () => {
  it("两个简单 rect → 正确 path", () => {
    const src = rect(0, 100, 0, 100); // 中心 (50, 50)
    const dst = rect(200, 100, 200, 100); // 中心 (250, 250)? left=200, width=100 → center_x=250; top=200, height=100 → center_y=250
    // 重新算:src center = (0+100/2, 0+100/2) = (50, 50)
    // dst: left=200, width=100 → cx=250; top=200, height=100 → cy=250
    expect(buildSvgLine(src, dst)).toBe("M 50 50 L 250 250");
  });

  it("同一 rect → 零长度直线(从中心到自己中心)", () => {
    const r = rect(100, 100, 100, 100); // cx=150, cy=150
    expect(buildSvgLine(r, r)).toBe("M 150 150 L 150 150");
  });

  it("负坐标也能处理", () => {
    const src = rect(-100, 50, -50, 50); // cx=-25, cy=-75
    const dst = rect(0, 50, 0, 50); // cx=25, cy=25
    expect(buildSvgLine(src, dst)).toBe("M -25 -75 L 25 25");
  });
});

describe("OB-027 dragDrop: rectCenter / rectBottom", () => {
  it("rectCenter 返回几何中心", () => {
    expect(rectCenter(rect(0, 100, 0, 100))).toEqual({ x: 50, y: 50 });
    expect(rectCenter(rect(100, 200, 50, 100))).toEqual({ x: 100, y: 200 });
  });

  it("rectBottom = top + height", () => {
    expect(rectBottom(rect(0, 100))).toBe(100);
    expect(rectBottom(rect(200, 50))).toBe(250);
  });
});
