import { describe, it, expect, vi } from "vitest";
import {
  computeDropZone,
  computeSourcePreviewPosition,
  computePlaceholderRectFromActual,
  computeSiblingShift,
  computeSourceTransform,
  buildConnectionLinePath,
  moveNodeInContent,
  executeDrop,
  buildSvgLine,
  rectCenter,
  rectBottom,
  DEFAULT_DROP_THRESHOLD,
  DROP_GAP_PX,
  type Rect,
  type ContentLike,
  type DragStateLike,
  type DropExecutors,
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

describe("★方案 R 修复★ OB-030 computePlaceholderRectFromActual: 用实测 sibling rect,不推算", () => {
  // source(B):宽 120 高 60
  const src = rect(0, 60, 0, 120);
  // target(C):top=200 height=40,bottom=240
  const tgt = rect(200, 40, 100, 80);
  // 第一个让位兄弟(D):top=250(mind-elixir --node-gap-y=10,所以 D.top=C.bottom+10)
  const firstSibling = rect(250, 40, 100, 80);

  it("★修复★ after + 有下一个兄弟: placeholder 占 D 原位(实测)", () => {
    const p = computePlaceholderRectFromActual(src, tgt, firstSibling, "after");
    expect(p.top).toBe(250); // ★ D 的实际 top,不是 C.bottom + 20 = 260
    expect(p.left).toBe(100); // 同 x 列
    expect(p.width).toBe(120);
    expect(p.height).toBe(60);
  });

  it("★修复★ after + 无下一个兄弟(target 是最后): fallback 到 target.bottom + gap", () => {
    const p = computePlaceholderRectFromActual(src, tgt, null, "after");
    expect(p.top).toBe(240 + 20); // C.bottom + DROP_GAP_PX
  });

  it("★修复★ before: placeholder 占 target 当前位置(target 让位)", () => {
    const p = computePlaceholderRectFromActual(src, tgt, firstSibling, "before");
    expect(p.top).toBe(200); // target 当前 top
    expect(p.left).toBe(100);
  });

  it("★修复★ inside: placeholder 紧贴 target 右侧(横向)", () => {
    const p = computePlaceholderRectFromActual(src, tgt, firstSibling, "inside");
    expect(p.left).toBe(100 + 80 + 20); // target.right + gap
    expect(p.top).toBe(200); // 同 y
  });

  it("★根因验证★ 不再用 C.bottom + 20 推算(避免跟 D 脱节)", () => {
    // 旧逻辑:placeholder.top = 240 + 20 = 260(跟 D.top=250 偏 10px)
    // 新逻辑:placeholder.top = 250(D 实际位置)
    const p = computePlaceholderRectFromActual(src, tgt, firstSibling, "after");
    expect(p.top).not.toBe(260); // 不再是旧推算值
    expect(p.top).toBe(250); // 是 D 的实际 top
  });
});

describe("★方案 Q★ OB-030 computeSourcePreviewPosition: source 自身预览位置(纵向坐标系)", () => {
  const src = rect(0, 60, 0, 120); // width=120 height=60
  const tgt = rect(200, 40, 100, 80); // left=100 top=200 width=80 height=40

  it("★Q★ before: source 预览在 target 上方", () => {
    const p = computeSourcePreviewPosition(src, tgt, "before");
    expect(p.left).toBe(100);
    expect(p.top).toBe(200 - 60 - 20); // target.top - source.height - gap = 120
    expect(p.width).toBe(120);
    expect(p.height).toBe(60);
  });

  it("★Q★ after: source 预览紧贴 target 下方", () => {
    const p = computeSourcePreviewPosition(src, tgt, "after");
    expect(p.left).toBe(100);
    expect(p.top).toBe(200 + 40 + 20); // target.bottom + gap = 260
    expect(p.width).toBe(120);
    expect(p.height).toBe(60);
  });

  it("★Q★ inside: source 预览在 target 右侧(横向偏移,成为子节点)", () => {
    const p = computeSourcePreviewPosition(src, tgt, "inside");
    expect(p.left).toBe(100 + 80 + 20); // target.right + gap = 200
    expect(p.top).toBe(200);
  });

  it("自定义 gap 影响 after 的 top", () => {
    const p = computeSourcePreviewPosition(src, tgt, "after", 40);
    expect(p.top).toBe(240 + 40);
  });

  it("DROP_GAP_PX 默认是 20", () => {
    expect(DROP_GAP_PX).toBe(20);
  });
});

describe("★方案 Q★ OB-030 computeSiblingShift: 纵向让位位移量", () => {
  const src = rect(0, 60, 0, 120);

  it("before/after: 让位量 = source.height + gap", () => {
    expect(computeSiblingShift(src, "before")).toBe(60 + 20);
    expect(computeSiblingShift(src, "after")).toBe(60 + 20);
  });

  it("inside: 不让位(0)", () => {
    expect(computeSiblingShift(src, "inside")).toBe(0);
  });
});

describe("★方案 Q★ OB-030 computeSourceTransform: source 自身位移", () => {
  it("原位置 → 预览位置", () => {
    const srcRect = rect(0, 60, 0, 120);
    const preview = { left: 100, top: 200, width: 120, height: 60 };
    const { dx, dy } = computeSourceTransform(srcRect, preview);
    expect(dx).toBe(100);
    expect(dy).toBe(200);
  });

  it("负位移(向上/左)", () => {
    const srcRect = rect(200, 60, 200, 120);
    const preview = { left: 100, top: 100, width: 120, height: 60 };
    const { dx, dy } = computeSourceTransform(srcRect, preview);
    expect(dx).toBe(-100);
    expect(dy).toBe(-100);
  });
});

describe("★方案 Q★ OB-030 buildConnectionLinePath: A→source SVG 连接虚线", () => {
  it("anchor 中心到 preview 中心", () => {
    const anchor = rect(0, 100, 0, 100); // center=(50,50)
    const preview = { left: 200, top: 200, width: 100, height: 60 }; // center=(250,230)
    expect(buildConnectionLinePath(anchor, preview)).toBe("M 50 50 L 250 230");
  });
});

describe("★根因修复★ OB-029 moveNodeInContent: store 层 splice", () => {
  // 构造树: root → A → [a1, a2, a3], root → B → [b1]
  const makeContent = (): ContentLike => ({
    root: {
      id: "root",
      topic: "根",
      children: [
        {
          id: "A",
          topic: "A",
          children: [
            { id: "a1", topic: "a1" },
            { id: "a2", topic: "a2" },
            { id: "a3", topic: "a3" },
          ],
        },
        {
          id: "B",
          topic: "B",
          children: [{ id: "b1", topic: "b1" }],
        },
      ],
    },
  });

  const childIds = (node: any): string[] =>
    (node.children ?? []).map((c: any) => c.id);

  it("before: 把 a1 移到 a3 之前 → A.children = [a1, a3, a2]? 不对,应是 [a3, a1, a2]", () => {
    // 等下想清楚: a1 在 index 0, a3 在 index 2
    // 把 a1 移到 a3 之前 → 期望 [a3, a1, a2] 不对
    // 正确: a3 在 index 2,在 a3 之前插入 a1,但 a1 已经被移除(原 index 0)
    // 移除 a1 后: [a2, a3], a3 现在在 index 1
    // 在 index 1 之前插入 a1: [a2, a1, a3]
    const result = moveNodeInContent(makeContent(), "a1", "a3", "before");
    expect(result).not.toBeNull();
    const a = result!.root.children![0];
    expect(childIds(a)).toEqual(["a2", "a1", "a3"]);
  });

  it("★关键场景★ before: 把 a1 移到 a2 之前 → A.children = [a1, a2, a3](原位)", () => {
    // a1 已经在 a2 之前,操作应保持不变(或幂等)
    const result = moveNodeInContent(makeContent(), "a1", "a2", "before");
    expect(result).not.toBeNull();
    const a = result!.root.children![0];
    expect(childIds(a)).toEqual(["a1", "a2", "a3"]);
  });

  it("after: 把 a1 移到 a3 之后 → A.children = [a2, a3, a1]", () => {
    const result = moveNodeInContent(makeContent(), "a1", "a3", "after");
    expect(result).not.toBeNull();
    const a = result!.root.children![0];
    expect(childIds(a)).toEqual(["a2", "a3", "a1"]);
  });

  it("★用户场景★ before: 把 a3 移到 a1 之前 → A.children = [a3, a1, a2]", () => {
    const result = moveNodeInContent(makeContent(), "a3", "a1", "before");
    expect(result).not.toBeNull();
    const a = result!.root.children![0];
    expect(childIds(a)).toEqual(["a3", "a1", "a2"]);
  });

  it("inside: 把 a1 移到 B 下 → B.children = [b1, a1], A.children = [a2, a3]", () => {
    const result = moveNodeInContent(makeContent(), "a1", "B", "inside");
    expect(result).not.toBeNull();
    const a = result!.root.children![0];
    const b = result!.root.children![1];
    expect(childIds(a)).toEqual(["a2", "a3"]);
    expect(childIds(b)).toEqual(["b1", "a1"]);
  });

  it("★根因验证★ 跨层级 before: 把 b1 移到 a2 之前 → A.children = [a1, b1, a2, a3], B.children = []", () => {
    const result = moveNodeInContent(makeContent(), "b1", "a2", "before");
    expect(result).not.toBeNull();
    const a = result!.root.children![0];
    const b = result!.root.children![1];
    expect(childIds(a)).toEqual(["a1", "b1", "a2", "a3"]);
    expect(childIds(b)).toEqual([]);
  });

  it("防子孙循环: 把 A 移到 a1 之前 → 返回 null", () => {
    const result = moveNodeInContent(makeContent(), "A", "a1", "before");
    expect(result).toBeNull();
  });

  it("防子孙循环: 把 A 移到 a1 之内 → 返回 null", () => {
    const result = moveNodeInContent(makeContent(), "A", "a1", "inside");
    expect(result).toBeNull();
  });

  it("root 不能被移: 把 root 移到 A 之前 → 返回 null", () => {
    const result = moveNodeInContent(makeContent(), "root", "A", "before");
    expect(result).toBeNull();
  });

  it("source/target 不存在 → 返回 null", () => {
    expect(moveNodeInContent(makeContent(), "nonexistent", "A", "before")).toBeNull();
    expect(moveNodeInContent(makeContent(), "A", "nonexistent", "before")).toBeNull();
  });

  it("不修改原 content(返回深拷贝)", () => {
    const original = makeContent();
    const originalAChildren = [...original.root.children![0].children!].map((c) => c.id);
    moveNodeInContent(original, "a1", "a3", "after");
    // 原 content 不变
    expect(original.root.children![0].children!.map((c) => c.id)).toEqual(originalAChildren);
  });

  it("保留节点的其他字段(如 topic)", () => {
    const result = moveNodeInContent(makeContent(), "a1", "a3", "after");
    expect(result).not.toBeNull();
    const a1 = result!.root.children![0].children!.find((c) => c.id === "a1");
    expect(a1?.topic).toBe("a1");
  });
});

// === L2 业务流程测试:executeDrop 跨边界协调 ===

describe("★L2★ OB-029 executeDrop: onDragEnd 业务流程协调", () => {
  const makeContentL2 = (): ContentLike => ({
    root: {
      id: "root",
      topic: "根",
      children: [
        { id: "A", topic: "A", children: [{ id: "a1", topic: "a1" }, { id: "a2", topic: "a2" }] },
        { id: "B", topic: "B", children: [{ id: "b1", topic: "b1" }] },
      ],
    },
  });

  const makeDragState = (
    sourceId: string,
    targetId: string,
    zone: "before" | "after" | "inside",
  ): DragStateLike => ({
    source: { nodeObj: { id: sourceId } },
    currentTarget: { nodeObj: { id: targetId } },
    currentZone: zone,
    isDragging: true,
  });

  const makeExecutors = (content: ContentLike | null) => {
    const setContent = vi.fn();
    const refresh = vi.fn();
    const toMindElixirData = vi.fn((c: ContentLike) => ({ nodeData: c.root }));
    const exec: DropExecutors = {
      getContent: () => content,
      setContent,
      refresh,
      toMindElixirData,
    };
    return { exec, setContent, refresh, toMindElixirData };
  };

  it("★L2 正向★ 同级 before 排序 → setContent + refresh 都被调用,参数正确", () => {
    const content = makeContentL2();
    const { exec, setContent, refresh, toMindElixirData } = makeExecutors(content);
    const result = executeDrop(makeDragState("a1", "a2", "before"), exec);

    expect(result).toEqual({ ok: true });
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toMindElixirData).toHaveBeenCalledTimes(1);

    // setContent 收到的是 moveNodeInContent 的结果(顺序已变)
    const newContent = setContent.mock.calls[0][0] as ContentLike;
    const a = newContent.root.children![0];
    expect(a.children!.map((c) => c.id)).toEqual(["a1", "a2"]); // before 在同位置幂等

    // refresh 收到的 data 是 toMindElixirData(newContent)
    const refreshData = refresh.mock.calls[0][0];
    expect(refreshData).toEqual({ nodeData: newContent.root });
  });

  it("★L2 正向★ 同级 after 排序: a1 → a2 之后 → A.children = [a2, a1]", () => {
    const content = makeContentL2();
    const { exec, setContent } = makeExecutors(content);
    const result = executeDrop(makeDragState("a1", "a2", "after"), exec);

    expect(result).toEqual({ ok: true });
    const newContent = setContent.mock.calls[0][0] as ContentLike;
    expect(newContent.root.children![0].children!.map((c) => c.id)).toEqual(["a2", "a1"]);
  });

  it("★L2 正向★ 跨层级 inside: a1 → B 下 → B.children = [b1, a1]", () => {
    const content = makeContentL2();
    const { exec, setContent } = makeExecutors(content);
    const result = executeDrop(makeDragState("a1", "B", "inside"), exec);

    expect(result).toEqual({ ok: true });
    const newContent = setContent.mock.calls[0][0] as ContentLike;
    expect(newContent.root.children![1].children!.map((c) => c.id)).toEqual(["b1", "a1"]);
  });

  it("★L2 反向★ dragState=null → 不调任何 executor,返回 no_drag", () => {
    const { exec, setContent, refresh } = makeExecutors(makeContentL2());
    const result = executeDrop(null, exec);
    expect(result).toEqual({ ok: false, reason: "no_drag" });
    expect(setContent).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("★L2 反向★ isDragging=false → 不调,返回 no_drag", () => {
    const { exec, setContent, refresh } = makeExecutors(makeContentL2());
    const dragState: DragStateLike = {
      source: { nodeObj: { id: "a1" } },
      currentTarget: { nodeObj: { id: "a2" } },
      currentZone: "before",
      isDragging: false, // 关键:未拖动
    };
    const result = executeDrop(dragState, exec);
    expect(result).toEqual({ ok: false, reason: "no_drag" });
    expect(setContent).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("★L2 反向★ currentTarget=null → 返回 no_target,不调 executor", () => {
    const { exec, setContent, refresh } = makeExecutors(makeContentL2());
    const dragState: DragStateLike = {
      source: { nodeObj: { id: "a1" } },
      currentTarget: null,
      currentZone: "before",
      isDragging: true,
    };
    const result = executeDrop(dragState, exec);
    expect(result).toEqual({ ok: false, reason: "no_target" });
    expect(setContent).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("★L2 反向★ currentZone=null → 返回 no_zone,不调 executor", () => {
    const { exec, setContent, refresh } = makeExecutors(makeContentL2());
    const dragState: DragStateLike = {
      source: { nodeObj: { id: "a1" } },
      currentTarget: { nodeObj: { id: "a2" } },
      currentZone: null,
      isDragging: true,
    };
    const result = executeDrop(dragState, exec);
    expect(result).toEqual({ ok: false, reason: "no_zone" });
    expect(setContent).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("★L2 反向★ getContent 返回 null → 返回 no_content,不调 setContent/refresh", () => {
    const { exec, setContent, refresh } = makeExecutors(null);
    const result = executeDrop(makeDragState("a1", "a2", "before"), exec);
    expect(result).toEqual({ ok: false, reason: "no_content" });
    expect(setContent).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("★L2 风险★ 子孙循环(A → a1 之前) → 返回 illegal_move,不调 setContent/refresh", () => {
    // A 是 a1 的父节点,把 A 移到 a1 之前 = 把父节点移到子节点下 = 循环
    const { exec, setContent, refresh } = makeExecutors(makeContentL2());
    const result = executeDrop(makeDragState("A", "a1", "before"), exec);
    expect(result).toEqual({ ok: false, reason: "illegal_move" });
    expect(setContent).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("★L2 风险★ root 被移(root → A 之前) → illegal_move", () => {
    const { exec, setContent, refresh } = makeExecutors(makeContentL2());
    const result = executeDrop(makeDragState("root", "A", "before"), exec);
    expect(result).toEqual({ ok: false, reason: "illegal_move" });
    expect(setContent).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("★L2 不变量★ setContent 收到的 content 是深拷贝(不修改原 content)", () => {
    const original = makeContentL2();
    const originalAChildren = [...original.root.children![0].children!].map((c) => c.id);
    const { exec } = makeExecutors(original);
    executeDrop(makeDragState("a1", "a2", "after"), exec);
    expect(original.root.children![0].children!.map((c) => c.id)).toEqual(originalAChildren);
  });

  it("★L2 调用顺序★ setContent 在 refresh 之前调用(先提交 store 再重建 DOM)", () => {
    const content = makeContentL2();
    const callOrder: string[] = [];
    const exec: DropExecutors = {
      getContent: () => content,
      setContent: () => callOrder.push("setContent"),
      refresh: () => callOrder.push("refresh"),
      toMindElixirData: (c) => ({ nodeData: c.root }),
    };
    executeDrop(makeDragState("a1", "a2", "after"), exec);
    expect(callOrder).toEqual(["setContent", "refresh"]);
  });
});
