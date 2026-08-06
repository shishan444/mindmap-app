import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    expect(screen.getAllByText(/T\d/).length).toBe(3);
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

  // === OB-026 Bug2-b 回归(7022507):✕ 关闭 + 默认 3 条 + 全部展开 + 翻页 ===

  it("★bug 回归★ 默认折叠显示最近 3 条(超过 3 时显示全部(N)▾)", () => {
    const ops = Array.from({ length: 5 }, (_, i) => ({
      op_id: `op${i}`,
      op_type: "create_node",
      payload: { topic: `T${i}` },
      received_at_ms: Date.now() - i * 1000,
    }));
    useMindMapStore.setState({ llmOperations: ops });
    render(<LlmOperationHistory />);
    // 默认显示 3 条
    expect(screen.getAllByText(/T\d/).length).toBe(3);
    // 显示"全部(5) ▾"
    expect(screen.getByText(/全部\(5\)/)).toBeInTheDocument();
  });

  it("★bug 回归★ 点✕ 关闭按钮隐藏整个历史面板", () => {
    useMindMapStore.setState({
      llmOperations: [
        { op_id: "1", op_type: "create_node", payload: { topic: "A" }, received_at_ms: Date.now() },
      ],
    });
    const { container } = render(<LlmOperationHistory />);
    expect(container.firstChild).not.toBeNull();
    fireEvent.click(screen.getByTitle("关闭操作历史"));
    expect(container.firstChild).toBeNull();
  });

  it("★bug 回归★ 点全部(N)▾ 展开后显示翻页(>10 条时)", () => {
    const ops = Array.from({ length: 15 }, (_, i) => ({
      op_id: `op${i}`,
      op_type: "create_node",
      payload: { topic: `T${i}` },
      received_at_ms: Date.now() - i * 1000,
    }));
    useMindMapStore.setState({ llmOperations: ops });
    render(<LlmOperationHistory />);
    // 点展开
    fireEvent.click(screen.getByText(/全部\(15\)/));
    // 展开后显示"收起 ▴" + 翻页器(pageSize=10,totalPages=2)
    expect(screen.getByText(/收起/)).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // 第一页应显示 10 条
    expect(screen.getAllByText(/T\d/).length).toBe(10);
  });

  it("★bug 回归★ 翻页 ‹ › 切换页面 + 边界 disable", () => {
    const ops = Array.from({ length: 25 }, (_, i) => ({
      op_id: `op${i}`,
      op_type: "create_node",
      payload: { topic: `T${i}` },
      received_at_ms: Date.now() - i * 1000,
    }));
    useMindMapStore.setState({ llmOperations: ops });
    render(<LlmOperationHistory />);
    fireEvent.click(screen.getByText(/全部\(25\)/));
    // 25 条 / 10 每页 = 3 页
    expect(screen.getByText("1/3")).toBeInTheDocument();
    const prevBtn = screen.getByText("‹");
    const nextBtn = screen.getByText("›");
    // 第一页 ‹ disabled
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();
    // 点 › 到第二页
    fireEvent.click(nextBtn);
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(prevBtn).not.toBeDisabled();
    // 点 › 到第三页(最后)
    fireEvent.click(nextBtn);
    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(nextBtn).toBeDisabled();
  });

  it("★bug 回归★ 展开后点收起 ▴ 回到折叠态(3 条)", () => {
    const ops = Array.from({ length: 8 }, (_, i) => ({
      op_id: `op${i}`,
      op_type: "create_node",
      payload: { topic: `T${i}` },
      received_at_ms: Date.now() - i * 1000,
    }));
    useMindMapStore.setState({ llmOperations: ops });
    render(<LlmOperationHistory />);
    fireEvent.click(screen.getByText(/全部\(8\)/));
    expect(screen.getByText(/收起/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/收起/));
    // 回到折叠:3 条 + "全部(8)" 按钮
    expect(screen.getAllByText(/T\d/).length).toBe(3);
    expect(screen.getByText(/全部\(8\)/)).toBeInTheDocument();
  });
});
