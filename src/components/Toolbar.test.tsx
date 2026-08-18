import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMindMapStore } from "../store";
import Toolbar from "./Toolbar";
import { openRecentFile } from "../utils/openRecentFile";

beforeEach(() => {
  useMindMapStore.setState({
    content: null,
    dirty: false,
  });
});

function renderToolbar(handlers: any = {}) {
  const props = {
    onNew: handlers.onNew || vi.fn(),
    onOpen: handlers.onOpen || vi.fn(),
    onSave: handlers.onSave || vi.fn(),
    searchQuery: "",
    onSearchChange: handlers.onSearchChange || vi.fn(),
    onSearchNext: handlers.onSearchNext || vi.fn(),
    searchResultCount: 0,
    searchCurrentIndex: 0,
  };
  return { ...props, result: render(<Toolbar {...props} />) };
}

describe("FE-TOOLBAR", () => {
  it("FE-TOOLBAR-01: 无 content 时 onSave 禁用", () => {
    renderToolbar();
    expect(screen.getByTitle("保存")).toBeDisabled();
  });

  it("FE-TOOLBAR-01b: 有 content 时 onSave 启用", () => {
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar();
    expect(screen.getByTitle("保存")).not.toBeDisabled();
  });

  it("FE-TOOLBAR-02: dirty=true 时保存按钮显示未保存圆点", () => {
    useMindMapStore.setState({
      content: { root: { id: "x" } } as any,
      dirty: true,
    });
    renderToolbar();
    expect(screen.getByTitle("保存").querySelector(".dirty-dot")).toBeInTheDocument();
  });

  it("FE-TOOLBAR-02b: dirty=false 时保存按钮不显示未保存圆点", () => {
    useMindMapStore.setState({
      content: { root: { id: "x" } } as any,
      dirty: false,
    });
    renderToolbar();
    expect(screen.getByTitle("保存").querySelector(".dirty-dot")).not.toBeInTheDocument();
  });

  it("FE-TOOLBAR: 点击新建按钮触发 onNew", () => {
    const onNew = vi.fn();
    renderToolbar({ onNew });
    fireEvent.click(screen.getByTitle("新建文档"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 点击打开按钮触发 onOpen", () => {
    const onOpen = vi.fn();
    renderToolbar({ onOpen });
    fireEvent.click(screen.getByTitle("打开"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 点击保存按钮触发 onSave", () => {
    const onSave = vi.fn();
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar({ onSave });
    fireEvent.click(screen.getByTitle("保存"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 单导航精简栏 — 仅 新建/打开/保存/搜索,无 导入/导出/优先级", () => {
    renderToolbar();
    expect(screen.getByTitle("新建文档")).toBeInTheDocument();
    expect(screen.getByTitle("打开")).toBeInTheDocument();
    expect(screen.getByTitle("保存")).toBeInTheDocument();
    expect(document.getElementById("search-input")).toBeInTheDocument();
    expect(screen.queryByTitle("导出")).not.toBeInTheDocument();
    expect(screen.queryByTitle("导入")).not.toBeInTheDocument();
    expect(screen.queryByTitle("优先级")).not.toBeInTheDocument();
  });
});

// === OB-026 Bug3 回归(7022507):最近文件逻辑(入口移至系统菜单,逻辑迁移至 utils) ===

describe("openRecentFile(utils): 最近文件打开逻辑", () => {
  it("★bug 回归★ 无重复窗口时 invoke list_windows + add_recent_file + create_new_window", async () => {
    const invoke = vi.fn().mockResolvedValue([] as any);
    const ok = await openRecentFile("/x.mmap", false, { invoke });
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("list_windows");
    expect(invoke).toHaveBeenCalledWith("add_recent_file", { path: "/x.mmap", name: "x" });
    expect(invoke).toHaveBeenCalledWith("create_new_window", { mode: "open", mmapPath: "/x.mmap" });
  });

  it("★bug 回归★ 已有窗口打开同文件时调 focus_window(去重路径)", async () => {
    const invoke = vi.fn().mockImplementation((cmd: string) => {
      if (cmd === "list_windows") return Promise.resolve([{ label: "doc-1", title: "X" }]);
      return Promise.resolve(null);
    });
    await openRecentFile("/X.mmap", false, { invoke });
    expect(invoke).toHaveBeenCalledWith("focus_window", { label: "doc-1" });
    expect(invoke).not.toHaveBeenCalledWith("create_new_window", expect.anything());
  });

  it("★bug 回归★ dirty=true 时 confirm,用户取消不打开", async () => {
    const invoke = vi.fn().mockResolvedValue([] as any);
    const confirmFn = vi.fn().mockReturnValue(false);
    const ok = await openRecentFile("/x.mmap", true, { invoke, confirmFn });
    expect(ok).toBe(false);
    expect(confirmFn).toHaveBeenCalledWith("当前文档有未保存的修改,是否继续打开?");
    expect(invoke).not.toHaveBeenCalledWith("list_windows");
  });

  it("★bug 回归★ dirty=true 用户确认时正常打开", async () => {
    const invoke = vi.fn().mockResolvedValue([] as any);
    const confirmFn = vi.fn().mockReturnValue(true);
    const ok = await openRecentFile("/x.mmap", true, { invoke, confirmFn });
    expect(ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("list_windows");
    expect(confirmFn).toHaveBeenCalled();
  });
});
