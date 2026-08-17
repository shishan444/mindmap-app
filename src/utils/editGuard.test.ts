import { describe, it, expect } from "vitest";
import {
  isEditingSession,
  shouldBlockDefaultDrag,
  shouldReSelectAfterDrop,
} from "./editGuard";

const el = (id: string) => ({ id }) as unknown as Element;

describe("OB-030 editGuard: isEditingSession 编辑会话判定", () => {
  it("activeElement 为 #input-box → true(mind-elixir 编辑框持有焦点)", () => {
    expect(isEditingSession(el("input-box"))).toBe(true);
  });

  it("activeElement 为其他元素 → false(画布/节点/body)", () => {
    expect(isEditingSession(el("map-container"))).toBe(false);
    expect(isEditingSession({ id: "" } as unknown as Element)).toBe(false);
  });

  it("activeElement 为 null → false", () => {
    expect(isEditingSession(null)).toBe(false);
  });
});

describe("OB-030 editGuard: shouldBlockDefaultDrag mousedown preventDefault 守卫", () => {
  it("编辑会话中 → false(不阻断焦点转移,让 input-box 正常 blur 销毁)", () => {
    expect(shouldBlockDefaultDrag(el("input-box"))).toBe(false);
  });

  it("非编辑状态 → true(保持 HTML5 drag 阻断,防 WKWebView 黑屏复发)", () => {
    expect(shouldBlockDefaultDrag(el("map-container"))).toBe(true);
    expect(shouldBlockDefaultDrag(null)).toBe(true);
  });
});

describe("OB-030 editGuard: shouldReSelectAfterDrop 拖动后重选守卫", () => {
  it("用户已手动选择其他节点 → false(250ms 定时器不抢选)", () => {
    expect(shouldReSelectAfterDrop("node-a", "node-c")).toBe(false);
  });

  it("当前仍是 source 自己 → true(重新选中恢复高亮)", () => {
    expect(shouldReSelectAfterDrop("node-c", "node-c")).toBe(true);
  });

  it("无选中(currentNodes 空) → true(默认恢复选中拖动源)", () => {
    expect(shouldReSelectAfterDrop(null, "node-c")).toBe(true);
    expect(shouldReSelectAfterDrop(undefined, "node-c")).toBe(true);
    expect(shouldReSelectAfterDrop("", "node-c")).toBe(true);
  });
});
