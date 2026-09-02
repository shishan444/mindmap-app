/* ============================================================
   canvasActions — 画布交互的纯决策与几何计算(P1/L1 提取)
   背景:交互逻辑内联在 MindMapCanvas 闭包中不可测(Tab bug 系列
   零测试覆盖的直接原因)。本模块把两类核心逻辑提为纯函数:
     1. resolveCanvasKeyAction — 键盘事件 → 画布动作(决策矩阵)
     2. computeCenterTransform — 视口跟随补偿(5.14 layout 推飞修复)
   ============================================================ */

/** 键盘修饰 + 键名(最小输入面,便于穷举测试) */
export interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** 决策上下文(焦点/选中状态) */
export interface CanvasKeyContext {
  /** activeElement 是否可编辑(input-box/编辑态) */
  editing: boolean;
  /** 焦点是否在画布区域 */
  inCanvas: boolean;
  /** 是否有选中节点 */
  hasSelection: boolean;
  /** 选中节点是否为根节点(部分动作禁用) */
  isRoot: boolean;
}

export type CanvasAction =
  | "addChild"
  | "insertSibling"
  | "beginEdit"
  | "removeNodes"
  | "expand"
  | "focusSearch"
  | "autoLayout"
  | null;

/** 焦点目标是否为文本输入类(其内按键属编辑语义,须放行) */
export function isTextEntryTarget(el: Element | null): boolean {
  // isContentEditable === true:jsdom 未实现该属性时为 undefined,须归一为 false
  return (
    el instanceof HTMLElement &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable === true)
  );
}

/**
 * 视图主权(画布外兜底):焦点不在画布时,裸 Tab/Enter 是否应被 app 吞掉。
 * 公理:浏览器焦点环的 Tab 跳转不是本产品意图——它落焦画布容器会触发
 * scrollIntoView,等于"浏览器替程序移动视图"(无选中节点按 Tab 后
 * "画布找不到节点"的根因)。输入类控件内放行(编辑语义)。
 */
export function shouldSwallowNavKeyOutsideCanvas(
  e: KeyInput,
  focusTarget: Element | null,
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (isTextEntryTarget(focusTarget)) return false;
  return e.key === "Tab" || e.key === "Enter";
}

/**
 * 键盘 → 动作决策(与 MindMapCanvas onFallbackKey 行为一一对应)。
 * 返回 null = 不处理(放行)。
 * 矩阵:
 *   editing=true            → 一切放行(编辑态)
 *   !inCanvas               → 一切放行(焦点不在画布)
 *   Cmd+F → focusSearch; Cmd+Shift+L → autoLayout
 *   Tab → addChild(需选中)
 *   Enter → 非根 insertSibling
 *   F2 → beginEdit
 *   Delete/Backspace → 非根 removeNodes
 *   Cmd+. → expand
 */
export function resolveCanvasKeyAction(
  e: KeyInput,
  ctx: CanvasKeyContext,
): CanvasAction {
  if (ctx.editing) return null;
  if (!ctx.inCanvas) return null;

  if (e.metaKey && e.key === "f") return "focusSearch";
  if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "l") return "autoLayout";
  if (e.metaKey && e.key === "." ) return "expand";

  switch (e.key) {
    case "Tab":
      return ctx.hasSelection ? "addChild" : null;
    case "Enter":
      return ctx.hasSelection && !ctx.isRoot ? "insertSibling" : null;
    case "F2":
      return ctx.hasSelection ? "beginEdit" : null;
    case "Delete":
    case "Backspace":
      return ctx.hasSelection && !ctx.isRoot ? "removeNodes" : null;
    default:
      return null;
  }
}

/** 矩形(最小结构,便于测试注入) */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 画布当前 transform */
export interface CanvasTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * 视口跟随补偿(P1 核心:修复 mind-elixir 5.14 layout 推飞)
 * 计算把 targetRect 中心对齐 containerRect 中心所需的平移。
 * 返回新 transform;已对齐(±2px)返回 null(无需补偿)。
 *
 * 根因:5.14 addChild 在树深≥3 时触发 layout() 全树重排,节点群被推
 * 至负坐标区(实测 root 238→-57)——数据正确但视觉飞出视口,用户感知
 * 为"节点移动了、没有创建"。创建后把新节点带回中心即拉回全树。
 */
export function computeCenterTransform(
  targetRect: Rect,
  containerRect: Rect,
  current: CanvasTransform,
): CanvasTransform | null {
  const dx =
    containerRect.x + containerRect.width / 2 -
    (targetRect.x + targetRect.width / 2);
  const dy =
    containerRect.y + containerRect.height / 2 -
    (targetRect.y + targetRect.height / 2);
  if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return null;
  return { x: current.x + dx, y: current.y + dy, scale: current.scale };
}

/**
 * DOM 应用层(薄封装):把节点居中到画布容器。
 * 解析 map-canvas 当前 transform(computed style,兼容 translate3d/matrix),
 * 应用 computeCenterTransform 的结果。
 * ⚠ 仅限用户显式跳转(Toast/搜索定位)——视图主权公理:程序不得
 * 在内容操作路径调用本函数(创建节点用 restoreAnchorPosition)。
 */
export function centerNodeInContainer(tpc: HTMLElement, inner: HTMLElement): boolean {
  const mapCanvas = inner.querySelector(".map-canvas") as HTMLElement | null;
  if (!mapCanvas) return false;
  const innerRect = inner.getBoundingClientRect();
  const nodeRect = tpc.getBoundingClientRect();
  const ts = window.getComputedStyle(mapCanvas).transform;
  let cur: CanvasTransform = { x: 0, y: 0, scale: 1 };
  if (ts && ts !== "none") {
    try {
      const m = new DOMMatrix(ts);
      cur = { x: m.e, y: m.f, scale: m.a };
    } catch {
      // 保持默认
    }
  }
  const next = computeCenterTransform(nodeRect, innerRect, cur);
  if (!next) return true; // 已居中
  mapCanvas.style.transform = `translate3d(${next.x}px, ${next.y}px, 0px) scale(${next.scale})`;
  return true;
}

/* ============================================================
   位置保持补偿(视图主权公理的代码化)
   公理:内容操作(创建/删除/编辑)永不移动画布;画布平移/缩放只
   属于用户的鼠标。mind-elixir 5.14 的 addChild 在树深≥3 时触发
   layout 全树重排(库对视图的非法侵入,实测锚点 x 238→-57)。
   修复 = 反向平移恰好抵消侵入 → 净位移为零,画布纹丝不动。
   ============================================================ */

/** 锚点快照:创建操作前的选中节点(元素+节点 id+视口 rect) */
export interface AnchorSnapshot {
  el: HTMLElement;
  nodeId?: string;
  rect: Rect;
}

export function snapshotAnchor(el: HTMLElement): AnchorSnapshot {
  const r = el.getBoundingClientRect();
  return { el, nodeId: (el as any).nodeObj?.id, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
}

/**
 * 位置保持的核心几何(纯函数):计算把 after 送回 before 的平移。
 * |Δ|≤1px 视为未推飞(树浅时 mind-elixir 自然行为,无需补偿)。
 */
export function computeRestoreTransform(
  before: Rect,
  after: Rect,
  current: CanvasTransform,
): CanvasTransform | null {
  const dx = before.x - after.x;
  const dy = before.y - after.y;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return null;
  return { x: current.x + dx, y: current.y + dy, scale: current.scale };
}

/**
 * DOM 应用层:内容操作后恢复锚点原位(抵消库的非法视图侵入)。
 * 元素失联(DOM 重建)时按 nodeId 回查;找不到则放弃补偿(宁缺毋错)。
 * 返回剩余漂移(px,≤1 视为已保持)。
 */
export function restoreAnchorPosition(
  inst: any,
  inner: HTMLElement,
  before: AnchorSnapshot,
): number {
  let el: HTMLElement | null = before.el.isConnected ? before.el : null;
  if (!el && before.nodeId && typeof inst?.findEle === "function") {
    try {
      el = inst.findEle(before.nodeId);
    } catch {
      el = null;
    }
  }
  if (!el) return -1;
  const r = el.getBoundingClientRect();
  const mapCanvas = inner.querySelector(".map-canvas") as HTMLElement | null;
  if (!mapCanvas) return -1;
  const ts = window.getComputedStyle(mapCanvas).transform;
  let cur: CanvasTransform = { x: 0, y: 0, scale: 1 };
  if (ts && ts !== "none") {
    try {
      const m = new DOMMatrix(ts);
      cur = { x: m.e, y: m.f, scale: m.a };
    } catch {
      // 保持默认
    }
  }
  const next = computeRestoreTransform(
    before.rect,
    { x: r.x, y: r.y, width: r.width, height: r.height },
    cur,
  );
  if (next) {
    mapCanvas.style.transform = `translate3d(${next.x}px, ${next.y}px, 0px) scale(${next.scale})`;
  }
  const fr = el.getBoundingClientRect();
  return Math.max(Math.abs(fr.x - before.rect.x), Math.abs(fr.y - before.rect.y));
}

/**
 * 冻结画布 transform 动画,返回解冻函数。
 * 实测取证:5.14 的 layout 推飞经 .map-canvas 的
 * `transition: transform 0.3s` 渐进完成(t=30ms 飞出 41px,
 * t=400ms 才到终态 368px)——中途补偿必被后续动画冲掉。
 * 创建期间冻结 → 推飞瞬时完成 → 单次补偿精确 → 解冻恢复
 * 用户拖拽的平滑动画能力。
 */
export function freezeCanvasTransition(inner: HTMLElement): () => void {
  const canvas = inner.querySelector(".map-canvas") as HTMLElement | null;
  if (!canvas) return () => {};
  const prev = canvas.style.transition;
  canvas.style.transition = "none";
  return () => {
    canvas.style.transition = prev;
  };
}

/**
 * 位置保持(稳定版,集成层统一入口):
 *   冻结动画 → 补偿 → 复检(防未知二次 layout,最多 maxRounds 轮) → 解冻。
 * 不变量:内容操作后锚点回到创建前位置(±1px),画布对用户纹丝不动。
 */
export function keepAnchorInPlace(
  inst: any,
  inner: HTMLElement,
  before: AnchorSnapshot,
  opts: { settleDelayMs?: number; recheckDelayMs?: number; maxRounds?: number } = {},
): void {
  const settleDelay = opts.settleDelayMs ?? 60;
  const recheckDelay = opts.recheckDelayMs ?? 250;
  const maxRounds = opts.maxRounds ?? 3;
  const unfreeze = freezeCanvasTransition(inner);
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      unfreeze();
    }
  };
  setTimeout(() => {
    let drift = restoreAnchorPosition(inst, inner, before);
    let round = 0;
    const recheck = () => {
      if (drift >= 0 && drift <= 1) {
        finish();
        return;
      }
      if (round >= maxRounds) {
        finish();
        return;
      }
      round++;
      setTimeout(() => {
        drift = restoreAnchorPosition(inst, inner, before);
        recheck();
      }, recheckDelay);
    };
    recheck();
  }, settleDelay);
}
