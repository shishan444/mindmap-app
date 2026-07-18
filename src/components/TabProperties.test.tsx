import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMindMapStore } from "../store";
import TabProperties from "./TabProperties";
import { makeContent, makeNode } from "../test/helpers";

beforeEach(() => {
  useMindMapStore.setState({
    content: null,
    selectedNodeId: null,
    mindInstance: null,
  });
});

describe("FE-PANEL: 空状态", () => {
  it("无 content 时显示 '未选中节点'", () => {
    render(<TabProperties />);
    expect(screen.getByText("未选中节点")).toBeInTheDocument();
  });

  it("有 content 但未选中时显示 '未选中节点'", () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ id: "n1" }) }),
      selectedNodeId: null,
    });
    render(<TabProperties />);
    expect(screen.getByText("未选中节点")).toBeInTheDocument();
  });
});

describe("FE-PANEL: 优先级按钮组", () => {
  beforeEach(() => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ id: "n1", topic: "测试" }) }),
      selectedNodeId: "n1",
    });
  });

  it("显示 P0-P3 四个按钮", () => {
    render(<TabProperties />);
    expect(screen.getByText("P0")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
    expect(screen.getByText("P2")).toBeInTheDocument();
    expect(screen.getByText("P3")).toBeInTheDocument();
  });

  it("点击 P0 设置优先级", () => {
    render(<TabProperties />);
    fireEvent.click(screen.getByText("P0"));
    expect(useMindMapStore.getState().content?.root.priority).toBe("P0");
  });

  it("点击已选中 P0 清除优先级", () => {
    render(<TabProperties />);
    fireEvent.click(screen.getByText("P0"));
    fireEvent.click(screen.getByText("P0"));
    expect(useMindMapStore.getState().content?.root.priority).toBeUndefined();
  });
});

describe("FE-PANEL: 备注编辑", () => {
  beforeEach(() => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ id: "n1", topic: "测试" }) }),
      selectedNodeId: "n1",
    });
  });

  it("备注 textarea 可编辑", () => {
    render(<TabProperties />);
    const textarea = screen.getByPlaceholderText("输入备注...");
    fireEvent.change(textarea, { target: { value: "测试备注" } });
    expect(useMindMapStore.getState().content?.root.note).toBe("测试备注");
  });
});

describe("FE-PANEL: 图标选择器", () => {
  beforeEach(() => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ id: "n1", topic: "测试" }) }),
      selectedNodeId: "n1",
    });
  });

  it("默认展开显示图标分类", () => {
    render(<TabProperties />);
    expect(screen.getByText("任务进度")).toBeInTheDocument();
    expect(screen.getByText("任务级别")).toBeInTheDocument();
    expect(screen.getByText("任务类型")).toBeInTheDocument();
    expect(screen.getByText("状态标记")).toBeInTheDocument();
  });

  it("可收起图标选择器", () => {
    render(<TabProperties />);
    fireEvent.click(screen.getByText(/收起/));
    expect(screen.queryByText("任务进度")).not.toBeInTheDocument();
  });
});
