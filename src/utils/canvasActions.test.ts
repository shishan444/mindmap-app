import { describe, it, expect } from "vitest";
import {
  resolveCanvasKeyAction,
  computeCenterTransform,
  computeRestoreTransform,
  shouldSwallowNavKeyOutsideCanvas,
  isTextEntryTarget,
  type CanvasKeyContext,
} from "./canvasActions";

/**
 * FE-CANVAS-ACTIONS: 画布交互纯函数(P1/L1 提取)
 * 背景:Tab 第二次"移动节点不创建"bug(5.14 layout 推飞)零测试覆盖,
 * 因交互逻辑内联组件闭包。本组测试是新测试体系的第一块基石。
 */

const BASE: CanvasKeyContext = { editing: false, inCanvas: true, hasSelection: true, isRoot: false };

describe("FE-KBD: 键盘→动作决策矩阵", () => {
  it("FE-KBD-01: Tab → addChild(选中时)", () => {
    expect(resolveCanvasKeyAction({ key: "Tab" }, BASE)).toBe("addChild");
  });

  it("FE-KBD-02: Tab 无选中 → null(不处理)", () => {
    expect(resolveCanvasKeyAction({ key: "Tab" }, { ...BASE, hasSelection: false })).toBeNull();
  });

  it("FE-KBD-03: Enter 非根 → insertSibling;根 → null", () => {
    expect(resolveCanvasKeyAction({ key: "Enter" }, BASE)).toBe("insertSibling");
    expect(resolveCanvasKeyAction({ key: "Enter" }, { ...BASE, isRoot: true })).toBeNull();
  });

  it("FE-KBD-04: F2 → beginEdit;Delete/Backspace 非根 → removeNodes", () => {
    expect(resolveCanvasKeyAction({ key: "F2" }, BASE)).toBe("beginEdit");
    expect(resolveCanvasKeyAction({ key: "Delete" }, BASE)).toBe("removeNodes");
    expect(resolveCanvasKeyAction({ key: "Backspace" }, { ...BASE, isRoot: true })).toBeNull();
  });

  it("FE-KBD-05: 编辑态一切放行(不拦截)", () => {
    expect(resolveCanvasKeyAction({ key: "Tab" }, { ...BASE, editing: true })).toBeNull();
    expect(resolveCanvasKeyAction({ key: "Enter" }, { ...BASE, editing: true })).toBeNull();
  });

  it("FE-KBD-06: 焦点不在画布 → 放行(Tab 失效家族的核心语义)", () => {
    expect(resolveCanvasKeyAction({ key: "Tab" }, { ...BASE, inCanvas: false })).toBeNull();
  });

  it("FE-KBD-07: Cmd+F 搜索;Cmd+Shift+L 布局;Cmd+. 展开", () => {
    expect(resolveCanvasKeyAction({ key: "f", metaKey: true }, BASE)).toBe("focusSearch");
    expect(resolveCanvasKeyAction({ key: "L", metaKey: true, shiftKey: true }, BASE)).toBe("autoLayout");
    expect(resolveCanvasKeyAction({ key: ".", metaKey: true }, BASE)).toBe("expand");
  });

  it("FE-KBD-08: 其他键 → null", () => {
    expect(resolveCanvasKeyAction({ key: "a" }, BASE)).toBeNull();
    expect(resolveCanvasKeyAction({ key: "Escape" }, BASE)).toBeNull();
  });
});

describe("FE-CENTER: 视口跟随补偿(★Tab bug 根因修复的核心几何)", () => {
  // 取证实测:5.14 layout 推飞后 root 238→-57(左移 295px)
  const CONTAINER = { x: 0, y: 0, width: 600, height: 380 }; // 中心 (300,190)

  it("FE-CENTER-01: 节点被推飞(layout bug 现场) → 生成反向平移把节点带回中心", () => {
    // 新节点落在 (-57+410=353?) — 直接用取证几何:节点 @ (-102,625) 类负偏移
    const flown = { x: -102, y: 625, width: 120, height: 30 }; // 中心 (-42,640)
    const next = computeCenterTransform(flown, CONTAINER, { x: 0, y: 0, scale: 1 });
    expect(next).not.toBeNull();
    // 平移后节点中心应等于容器中心:dx = 300-(-42)=342, dy = 190-640=-450
    expect(next!.x).toBe(342);
    expect(next!.y).toBe(-450);
    expect(next!.scale).toBe(1);
  });

  it("FE-CENTER-02: 已居中(±2px) → null 不补偿(第一次 Tab 正常场景)", () => {
    const centered = { x: 240, y: 175, width: 120, height: 30 }; // 中心 (300,190)
    expect(computeCenterTransform(centered, CONTAINER, { x: 0, y: 0, scale: 1 })).toBeNull();
  });

  it("FE-CENTER-03: 在既有 transform 上累加(不覆盖用户平移/缩放)", () => {
    const off = { x: 500, y: 300, width: 120, height: 30 }; // 中心(560,315)
    const next = computeCenterTransform(off, CONTAINER, { x: -120, y: 60, scale: 1.5 });
    // dx=300-560=-260, dy=190-315=-125
    expect(next).toEqual({ x: -380, y: -65, scale: 1.5 });
  });
});

describe("FE-KEEP-PLACE: 位置保持补偿(★视图主权公理 — Tab bug 修复的领域不变量)", () => {
  // 公理:内容操作(创建)永不移动画布;补偿量恒等于库的非法移动量,方向相反
  // 取证实测:5.14 layout 推飞,锚点 x 238→-57(左移 295px)

  it("FE-KEEP-01: 推飞场景 → 反向平移恰好抵消(净位移为零)", () => {
    const before = { x: 238, y: 1100, width: 100, height: 30 };
    const afterFlown = { x: -57, y: 1095, width: 100, height: 30 }; // 库推飞后
    const next = computeRestoreTransform(before, afterFlown, { x: 175, y: 65, scale: 1 });
    expect(next).toEqual({ x: 175 + 295, y: 65 + 5, scale: 1 }); // dx=+295 dy=+5
  });

  it("FE-KEEP-02: 未推飞(树浅自然行为,|Δ|≤1px) → 无需补偿", () => {
    const before = { x: 238, y: 1100, width: 100, height: 30 };
    const afterNatural = { x: 238.5, y: 1100.3, width: 100, height: 30 };
    expect(computeRestoreTransform(before, afterNatural, { x: 0, y: 0, scale: 1 })).toBeNull();
  });

  it("FE-KEEP-03: y 轴推飞同样抵消(综合位移)", () => {
    const next = computeRestoreTransform(
      { x: 100, y: 200, width: 50, height: 30 },
      { x: 130, y: 260, width: 50, height: 30 },
      { x: 10, y: 20, scale: 1.5 },
    );
    expect(next).toEqual({ x: 10 - 30, y: 20 - 60, scale: 1.5 });
  });

  it("FE-KEEP-04: 恰好 1px 视为未推飞(阈值语义)", () => {
    const next = computeRestoreTransform(
      { x: 100, y: 200, width: 50, height: 30 },
      { x: 101, y: 200, width: 50, height: 30 },
      { x: 0, y: 0, scale: 1 },
    );
    expect(next).toBeNull();
  });
});

describe("FE-VIEW-SOVEREIGN-TAB: 画布外 Tab 主权接管(★无选中 Tab 丢视图 bug)", () => {
  // 根因:焦点不在画布时裸 Tab 放行 → 浏览器焦点环落焦画布容器
  // → scrollIntoView → 视图被浏览器移动("画布找不到节点")
  // 真实 DOM 元素(实现含 instanceof HTMLElement 判定,fake 对象会误判)
  const fakeDiv = document.createElement("div");
  const fakeInput = document.createElement("input");
  const fakeEditable = document.createElement("div");
  Object.defineProperty(fakeEditable, "isContentEditable", { value: true });

  it("FE-VS-01: 焦点在普通元素,body/按钮 → 裸 Tab/Enter 吞掉(preventDefault)", () => {
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "Tab" }, fakeDiv)).toBe(true);
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "Enter" }, null)).toBe(true);
  });

  it("FE-VS-02: 输入类控件内放行(编辑语义)", () => {
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "Tab" }, fakeInput)).toBe(false);
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "Tab" }, fakeEditable)).toBe(false);
  });

  it("FE-VS-03: 修饰键组合放行(系统/浏览器快捷键不劫持)", () => {
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "Tab", metaKey: true }, fakeDiv)).toBe(false);
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "Enter", ctrlKey: true }, fakeDiv)).toBe(false);
  });

  it("FE-VS-04: 其他键不吞(只接管 Tab/Enter 两个焦点环键)", () => {
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "F2" }, fakeDiv)).toBe(false);
    expect(shouldSwallowNavKeyOutsideCanvas({ key: "a" }, fakeDiv)).toBe(false);
  });

  it("FE-VS-05: isTextEntryTarget 判定", () => {
    expect(isTextEntryTarget(fakeInput)).toBe(true);
    expect(isTextEntryTarget(fakeEditable)).toBe(true);
    expect(isTextEntryTarget(fakeDiv)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
