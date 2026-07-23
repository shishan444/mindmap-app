import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import TabProperties from "./TabProperties";
import { makeContent, makeNode } from "../test/helpers";

beforeEach(() => {
  useMindMapStore.setState({
    content: null,
    selectedNodeId: null,
    mindInstance: null,
    filePath: null,
  });
  vi.clearAllMocks();
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
});

describe("FE-PANEL: 附加文件图标点击(回归测试 - bug: 点击无响应)", () => {
  beforeEach(() => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ id: "n1", topic: "测试" }) }),
      selectedNodeId: "n1",
      filePath: null,
    });
  });

  it("filePath=null(未保存文档)时点击图标:应弹提示,不再静默", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.mocked(openDialog).mockResolvedValue("/test/pic.jpg");
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toContain("保存");
    expect(openDialog).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("selectedId=null(无选中节点)时:应弹提示", async () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ id: "n1" }) }),
      selectedNodeId: null,
      filePath: "/tmp/test.mmap",
    });
    // 注意:selectedId=null 时整个面板渲染"未选中节点",无图标可点
    render(<TabProperties />);
    expect(screen.getByText("未选中节点")).toBeInTheDocument();
  });

  it("filePath 有值 + 用户选择文件:应调用 attach_file_to_node", async () => {
    useMindMapStore.setState({ filePath: "/tmp/test.mmap" });
    vi.mocked(openDialog).mockResolvedValue("/Users/test/pic.jpg");
    vi.mocked(invoke).mockResolvedValue({
      uuid: "u1", original_name: "pic.jpg", ext: "jpg",
      file_type: "image", size_bytes: 100, attached_at: "2026-07-20",
    });
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => {
      expect(openDialog).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("attach_file_to_node", {
        mmapPath: "/tmp/test.mmap",
        nodeId: "n1",
        srcPath: "/Users/test/pic.jpg",
      });
    });
  });

  it("filePath 有值 + 用户取消选择(openDialog 返回 null):不报错", async () => {
    useMindMapStore.setState({ filePath: "/tmp/test.mmap" });
    vi.mocked(openDialog).mockResolvedValue(null);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => expect(openDialog).toHaveBeenCalled());
    // 用户取消,不调用 invoke,不弹 alert
    expect(invoke).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("openDialog 抛错:应弹 alert,不再 unhandled rejection", async () => {
    useMindMapStore.setState({ filePath: "/tmp/test.mmap" });
    vi.mocked(openDialog).mockRejectedValue(new Error("permission denied"));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toContain("打开文件选择器失败");
    expect(invoke).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("invoke 抛错:应弹 alert + console.error", async () => {
    useMindMapStore.setState({ filePath: "/tmp/test.mmap" });
    vi.mocked(openDialog).mockResolvedValue("/test/pic.jpg");
    vi.mocked(invoke).mockRejectedValue(new Error("磁盘满"));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toContain("附加文件失败");
    expect(errSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
    errSpy.mockRestore();
  });
});

describe("FE-PANEL: 附件节点固定尺寸(回归 - bug: 节点尺寸继承自变更前)", () => {
  beforeEach(() => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ id: "n1", topic: "测试" }) }),
      selectedNodeId: "n1",
      filePath: null,
      mindInstance: null,
    });
    vi.clearAllMocks();
  });

  it("attach 后 node.style 应包含固定 width/height/overflow", async () => {
    useMindMapStore.setState({ filePath: "/tmp/test.mmap" });
    vi.mocked(openDialog).mockResolvedValue("/test/pic.jpg");
    vi.mocked(invoke).mockResolvedValue({
      uuid: "u1", original_name: "pic.jpg", ext: "jpg",
      file_type: "image", size_bytes: 100, attached_at: "2026-07-21",
    });
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => {
      const node = useMindMapStore.getState().content?.root;
      expect(node?.style?.width).toBe("80px");
      expect(node?.style?.height).toBe("80px");
      expect(node?.style?.overflow).toBe("hidden");
    });
  });

  it("attach 应保留已有 style(如 fontSize),只追加固定尺寸字段", async () => {
    useMindMapStore.setState({
      filePath: "/tmp/test.mmap",
      content: makeContent({
        root: makeNode({
          id: "n1",
          topic: "测试",
          style: { fontSize: "20px", color: "#ff0000" },
        }),
      }),
    });
    vi.mocked(openDialog).mockResolvedValue("/test/pic.jpg");
    vi.mocked(invoke).mockResolvedValue({
      uuid: "u1", original_name: "pic.jpg", ext: "jpg",
      file_type: "image", size_bytes: 100, attached_at: "2026-07-21",
    });
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => {
      const node = useMindMapStore.getState().content?.root;
      // 原有 style 保留
      expect(node?.style?.fontSize).toBe("20px");
      expect(node?.style?.color).toBe("#ff0000");
      // 新增固定尺寸
      expect(node?.style?.width).toBe("80px");
      expect(node?.style?.height).toBe("80px");
    });
  });

  it("attach 后调用 mind.reshapeNode 同步固定尺寸到画布", async () => {
    const reshapeNode = vi.fn();
    const findEle = vi.fn(() => "fake-tpc");
    useMindMapStore.setState({
      filePath: "/tmp/test.mmap",
      mindInstance: { reshapeNode, findEle } as any,
    });
    vi.mocked(openDialog).mockResolvedValue("/test/pic.jpg");
    vi.mocked(invoke).mockResolvedValue({
      uuid: "u1", original_name: "pic.jpg", ext: "jpg",
      file_type: "image", size_bytes: 100, attached_at: "2026-07-21",
    });
    render(<TabProperties />);
    fireEvent.click(screen.getByTitle(/^图片/));
    await waitFor(() => expect(reshapeNode).toHaveBeenCalled());
    const patchArg = reshapeNode.mock.calls[0][1];
    expect(patchArg.style.width).toBe("80px");
    expect(patchArg.style.height).toBe("80px");
  });
});
