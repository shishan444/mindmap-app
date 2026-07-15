import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMindMapStore } from "../store";
import TabOutline from "./TabOutline";
import { makeContent, makeTree } from "../test/helpers";

beforeEach(() => {
  useMindMapStore.setState({
    content: null,
    selectedNodeId: null,
  });
});

describe("FE-OUTLINE: 渲染", () => {
  it("FE-OUTLINE-01: 无 content 时显示 '未打开文档'", () => {
    render(<TabOutline />);
    expect(screen.getByText("未打开文档")).toBeInTheDocument();
  });

  it("FE-OUTLINE-01b: 有 content 时渲染所有节点", () => {
    const content = makeContent({ root: makeTree() });
    useMindMapStore.setState({ content });
    render(<TabOutline />);
    expect(screen.getByText("根")).toBeInTheDocument();
    expect(screen.getByText("子1")).toBeInTheDocument();
    expect(screen.getByText("子2")).toBeInTheDocument();
    expect(screen.getByText("子3")).toBeInTheDocument();
    expect(screen.getByText("孙1-1")).toBeInTheDocument();
    expect(screen.getByText("孙2-2")).toBeInTheDocument();
  });

  it("FE-OUTLINE-01c: 空 topic 节点显示 '(空)'", () => {
    const content = makeContent({
      root: { id: "r", topic: "", children: [], id_property: undefined } as any,
    });
    useMindMapStore.setState({ content });
    render(<TabOutline />);
    expect(screen.getByText("(空)")).toBeInTheDocument();
  });
});

describe("FE-OUTLINE: 选中与交互", () => {
  it("FE-OUTLINE-02: 点击 outline-row 触发 setSelectedNodeId", () => {
    const content = makeContent({
      root: {
        id: "root",
        topic: "根",
        children: [
          { id: "c1", topic: "子1", children: [] },
          { id: "c2", topic: "子2", children: [] },
        ],
      } as any,
    });
    useMindMapStore.setState({ content });
    render(<TabOutline />);
    fireEvent.click(screen.getByText("子1"));
    expect(useMindMapStore.getState().selectedNodeId).toBe("c1");
  });

  it("FE-OUTLINE-03: 选中节点行有 'selected' class", () => {
    const content = makeContent({
      root: {
        id: "root",
        topic: "根",
        children: [{ id: "c1", topic: "子1", children: [] }],
      } as any,
    });
    useMindMapStore.setState({ content, selectedNodeId: "c1" });
    const { container } = render(<TabOutline />);
    const selectedRow = container.querySelector(".outline-row.selected");
    expect(selectedRow).not.toBeNull();
    expect(selectedRow?.textContent).toContain("子1");
  });
});

describe("FE-OUTLINE: 深度缩进", () => {
  it("FE-OUTLINE: 深度越大缩进越多", () => {
    const content = makeContent({
      root: {
        id: "root",
        topic: "根",
        children: [
          {
            id: "c1",
            topic: "子1",
            children: [{ id: "g1", topic: "孙1", children: [] }],
          },
        ],
      } as any,
    });
    useMindMapStore.setState({ content });
    const { container } = render(<TabOutline />);
    const rows = container.querySelectorAll(".outline-row");
    expect(rows.length).toBe(3);
    // 根（depth=0，padding-left=8），子1（depth=1，padding-left=20），孙1（depth=2，padding-left=32）
    const paddingLeft = (el: Element) =>
      (el as HTMLElement).style.paddingLeft || "";
    expect(paddingLeft(rows[0])).toBe("8px");
    expect(paddingLeft(rows[1])).toBe("20px");
    expect(paddingLeft(rows[2])).toBe("32px");
  });
});
