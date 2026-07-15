import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useMindMapStore } from "../store";
import StatusBar from "./StatusBar";

beforeEach(() => {
  useMindMapStore.setState({
    content: null,
    filePath: null,
    dirty: false,
    nodeCount: 0,
    saveStatus: "idle",
    lastSavedAt: null,
  });
});

describe("FE-STATUS: StatusBar", () => {
  it("FE-STATUS-01: nodeCount=0 时显示 '0 节点'", () => {
    render(<StatusBar />);
    expect(screen.getByText("0 节点")).toBeInTheDocument();
  });

  it("FE-STATUS-01b: nodeCount=42 时显示 '42 节点'", () => {
    useMindMapStore.setState({ nodeCount: 42 });
    render(<StatusBar />);
    expect(screen.getByText("42 节点")).toBeInTheDocument();
  });

  it("FE-STATUS-02: saveStatus='saving' 显示 '保存中...'", () => {
    useMindMapStore.setState({ saveStatus: "saving" });
    render(<StatusBar />);
    expect(screen.getByText(/保存中/)).toBeInTheDocument();
  });

  it("FE-STATUS-02b: saveStatus='error' 显示 '保存失败'", () => {
    useMindMapStore.setState({ saveStatus: "error" });
    render(<StatusBar />);
    expect(screen.getByText(/保存失败/)).toBeInTheDocument();
  });

  it("FE-STATUS-03: dirty=true 显示 '● 未保存'", () => {
    useMindMapStore.setState({ dirty: true });
    render(<StatusBar />);
    expect(screen.getByText(/未保存/)).toBeInTheDocument();
  });

  it("FE-STATUS-03b: dirty=false 且 lastSavedAt 有值显示 '已保存'", () => {
    useMindMapStore.setState({
      dirty: false,
      lastSavedAt: Date.now(),
    });
    render(<StatusBar />);
    expect(screen.getByText(/已保存/)).toBeInTheDocument();
  });

  it("FE-STATUS: 显示文件路径", () => {
    useMindMapStore.setState({ filePath: "/tmp/test.mmap" });
    render(<StatusBar />);
    expect(screen.getByTitle("/tmp/test.mmap")).toBeInTheDocument();
  });

  it("FE-STATUS: 显示提醒数（默认 0）", () => {
    render(<StatusBar />);
    expect(screen.getByText(/0 提醒/)).toBeInTheDocument();
  });
});
