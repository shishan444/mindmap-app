import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useMindMapStore } from "../store";
import TabProperties from "./TabProperties";
import { makeContent, makeNode } from "../test/helpers";

beforeEach(() => {
  useMindMapStore.setState({
    content: null,
    selectedNodeId: null,
  });
});

describe("FE-PROP: 空状态", () => {
  it("FE-PROP-01a: 无 content 时显示 '未选中节点'", () => {
    render(<TabProperties />);
    expect(screen.getByText("未选中节点")).toBeInTheDocument();
  });

  it("FE-PROP-01b: 有 content 但未选中节点时显示 '未选中节点'", () => {
    useMindMapStore.setState({
      content: makeContent(),
      selectedNodeId: null,
    });
    render(<TabProperties />);
    expect(screen.getByText("未选中节点")).toBeInTheDocument();
  });

  it("FE-PROP-01c: selectedNodeId 不在树中时也显示 '未选中节点'", () => {
    useMindMapStore.setState({
      content: makeContent(),
      selectedNodeId: "不存在的-id",
    });
    render(<TabProperties />);
    expect(screen.getByText("未选中节点")).toBeInTheDocument();
  });
});

describe("FE-PROP: 节点显示", () => {
  it("FE-PROP-02: 选中节点时显示 topic", () => {
    const content = makeContent({
      root: makeNode({ id: "n1", topic: "测试主题" }),
    });
    useMindMapStore.setState({
      content,
      selectedNodeId: "n1",
    });
    render(<TabProperties />);
    expect(screen.getByDisplayValue("测试主题")).toBeInTheDocument();
  });

  it("FE-PROP-02b: 显示节点 ID", () => {
    const content = makeContent({
      root: makeNode({ id: "uuid-1234", topic: "x" }),
    });
    useMindMapStore.setState({
      content,
      selectedNodeId: "uuid-1234",
    });
    render(<TabProperties />);
    expect(screen.getByDisplayValue("uuid-1234")).toBeInTheDocument();
  });

  it("FE-PROP-02c: 选中嵌套子节点也能找到", () => {
    const content = makeContent({
      root: makeNode({
        id: "root",
        topic: "根",
        children: [
          makeNode({
            id: "child",
            topic: "嵌套子",
            children: [],
          }),
        ],
      }),
    });
    useMindMapStore.setState({
      content,
      selectedNodeId: "child",
    });
    render(<TabProperties />);
    expect(screen.getByDisplayValue("嵌套子")).toBeInTheDocument();
  });
});

describe("FE-PROP: 优先级显示", () => {
  it("FE-PROP-03: priority=P0 时 P0 chip 高亮", () => {
    const content = makeContent({
      root: makeNode({ id: "n", topic: "x", priority: "P0" }),
    });
    useMindMapStore.setState({ content, selectedNodeId: "n" });
    const { container } = render(<TabProperties />);
    const activeChip = container.querySelector(".priority-chip.active");
    expect(activeChip).not.toBeNull();
    expect(activeChip?.textContent).toContain("P0");
  });

  it("FE-PROP-03b: 无优先级时显示 '未设置'", () => {
    const content = makeContent({
      root: makeNode({ id: "n", topic: "x" }),
    });
    useMindMapStore.setState({ content, selectedNodeId: "n" });
    render(<TabProperties />);
    expect(screen.getByText("未设置")).toBeInTheDocument();
  });

  it("FE-PROP-03c: priority=P2 时非 P2 chips 不高亮", () => {
    const content = makeContent({
      root: makeNode({ id: "n", topic: "x", priority: "P2" }),
    });
    useMindMapStore.setState({ content, selectedNodeId: "n" });
    const { container } = render(<TabProperties />);
    const activeChips = container.querySelectorAll(".priority-chip.active");
    expect(activeChips.length).toBe(1);
    expect(activeChips[0].textContent).toContain("P2");
  });
});

describe("FE-PROP: 备注与图标", () => {
  it("FE-PROP: 显示备注", () => {
    const content = makeContent({
      root: makeNode({ id: "n", topic: "x", note: "重要备注内容" }),
    });
    useMindMapStore.setState({ content, selectedNodeId: "n" });
    render(<TabProperties />);
    expect(screen.getByDisplayValue("重要备注内容")).toBeInTheDocument();
  });

  it("FE-PROP: 无备注时 placeholder 显示 '无备注'", () => {
    const content = makeContent({
      root: makeNode({ id: "n", topic: "x" }),
    });
    useMindMapStore.setState({ content, selectedNodeId: "n" });
    render(<TabProperties />);
    expect(screen.getByPlaceholderText("无备注")).toBeInTheDocument();
  });

  it("FE-PROP: 无图标时显示 '无'", () => {
    const content = makeContent({
      root: makeNode({ id: "n", topic: "x" }),
    });
    useMindMapStore.setState({ content, selectedNodeId: "n" });
    render(<TabProperties />);
    // 图标行的 '无' 标记
    const muteds = screen.getAllByText("无");
    expect(muteds.length).toBeGreaterThanOrEqual(1);
  });
});
