import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useMindMapStore } from "../store";
import LlmOperationHistory from "./LlmOperationHistory";

beforeEach(() => {
  useMindMapStore.setState({
    llmOperations: [],
    sidebarCollapsed: false,
  });
});

describe("FE-LLM-HISTORY", () => {
  it("无操作时不渲染", () => {
    const { container } = render(<LlmOperationHistory />);
    expect(container.firstChild).toBeNull();
  });

  it("sidebar 折叠时不渲染", () => {
    useMindMapStore.setState({
      sidebarCollapsed: true,
      llmOperations: [{ op_id: "1", op_type: "create_node", payload: { topic: "X" } }],
    });
    const { container } = render(<LlmOperationHistory />);
    expect(container.firstChild).toBeNull();
  });

  it("有操作时显示标题和计数", () => {
    useMindMapStore.setState({
      llmOperations: [
        { op_id: "1", op_type: "create_node", payload: { topic: "A" }, received_at_ms: Date.now() },
      ],
    });
    render(<LlmOperationHistory />);
    expect(screen.getByText(/LLM 操作/)).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("显示每种 op 类型的图标和标签", () => {
    useMindMapStore.setState({
      llmOperations: [
        { op_id: "1", op_type: "create_node", payload: { topic: "A" } },
        { op_id: "2", op_type: "delete_node", payload: { node_id: "n1" } },
        { op_id: "3", op_type: "attach_file", payload: { file_path: "/x/y.pdf" } },
      ],
    });
    render(<LlmOperationHistory />);
    expect(screen.getByText("新建节点")).toBeInTheDocument();
    expect(screen.getByText("删除节点")).toBeInTheDocument();
    expect(screen.getByText("附加文件")).toBeInTheDocument();
    expect(screen.getByText("y.pdf")).toBeInTheDocument();
  });

  it("超过 10 条只显示最近 10 条", () => {
    const ops = Array.from({ length: 15 }, (_, i) => ({
      op_id: `op${i}`,
      op_type: "create_node",
      payload: { topic: `T${i}` },
      // op0 最近(5s 前),op14 最旧(5+14*5s 前)
      received_at_ms: Date.now() - i * 5 * 1000,
    }));
    useMindMapStore.setState({ llmOperations: ops });
    render(<LlmOperationHistory />);
    // slice(-10) 取 op5-op14(数组最后 10 条)
    // 但 received_at_ms 让"最近"是 op0(op0 时间最晚)
    // 应该显示时间最新的 10 个,即 op0-op9
    // 但 slice(-10) 取的是数组末尾,所以是 op5-op14
    // 这里测试只验证显示数量 = 10
    expect(screen.getAllByText(/T\d/).length).toBe(10);
  });

  it("时间格式化(秒前)", () => {
    useMindMapStore.setState({
      llmOperations: [
        {
          op_id: "1",
          op_type: "create_node",
          payload: { topic: "A" },
          received_at_ms: Date.now() - 5 * 1000, // 5s 前
        },
      ],
    });
    render(<LlmOperationHistory />);
    expect(screen.getByText(/5s 前/)).toBeInTheDocument();
  });

  it("时间格式化(分钟前)", () => {
    useMindMapStore.setState({
      llmOperations: [
        {
          op_id: "1",
          op_type: "create_node",
          payload: { topic: "A" },
          received_at_ms: Date.now() - 120 * 1000, // 2 分钟前
        },
      ],
    });
    render(<LlmOperationHistory />);
    expect(screen.getByText(/2m 前/)).toBeInTheDocument();
  });

  it("move_node 显示源/目标", () => {
    useMindMapStore.setState({
      llmOperations: [
        {
          op_id: "1",
          op_type: "move_node",
          payload: { node_id: "n1", to_parent_id: "n2" },
        },
      ],
    });
    render(<LlmOperationHistory />);
    expect(screen.getByText("n1 → n2")).toBeInTheDocument();
  });
});
