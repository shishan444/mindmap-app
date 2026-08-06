import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import Toolbar from "./Toolbar";

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
    onExportPng: handlers.onExportPng || vi.fn(),
    onExportMarkdown: handlers.onExportMarkdown || vi.fn(),
    onExportOpml: handlers.onExportOpml || vi.fn(),
    onImportMarkdown: handlers.onImportMarkdown || vi.fn(),
    onImportOpml: handlers.onImportOpml || vi.fn(),
    onSetPriority: handlers.onSetPriority || vi.fn(),
    onOpenPreferences: handlers.onOpenPreferences || vi.fn(),
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

  it("FE-TOOLBAR-02: dirty=true 时保存按钮显示 *", () => {
    useMindMapStore.setState({
      content: { root: { id: "x" } } as any,
      dirty: true,
    });
    renderToolbar();
    expect(screen.getByTitle("保存").textContent).toContain("*");
  });

  it("FE-TOOLBAR-02b: dirty=false 时保存按钮不显示 *", () => {
    useMindMapStore.setState({
      content: { root: { id: "x" } } as any,
      dirty: false,
    });
    renderToolbar();
    expect(screen.getByTitle("保存").textContent).not.toContain("*");
  });

  it("FE-TOOLBAR: 点击新建按钮触发 onNew", () => {
    const onNew = vi.fn();
    renderToolbar({ onNew });
    fireEvent.click(screen.getByTitle("新建"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 点击打开按钮触发 onOpen", async () => {
    const onOpen = vi.fn();
    renderToolbar({ onOpen });
    const openBtn = screen.getByTitle("打开文件").querySelector("button") || screen.getByTitle("打开文件");
    fireEvent.click(openBtn);
    await new Promise(r => setTimeout(r, 50));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 点击保存按钮触发 onSave", () => {
    const onSave = vi.fn();
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar({ onSave });
    fireEvent.click(screen.getByTitle("保存"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR-03: 点击 PNG 项触发 onExportPng", () => {
    const onExportPng = vi.fn();
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar({ onExportPng });
    fireEvent.click(screen.getByText("📷 PNG 图片"));
    expect(onExportPng).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 无 content 时导出触发器禁用", () => {
    renderToolbar();
    const exportTrigger = screen.getByText(/导出 ▾/)?.closest("button");
    expect(exportTrigger).toBeDisabled();
  });

  it("FE-TOOLBAR: 点击 Markdown 导出触发 onExportMarkdown", () => {
    const onExportMarkdown = vi.fn();
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar({ onExportMarkdown });
    // 导出下拉里的 MD（第一个 📝）
    const mdItems = screen.getAllByText("📝 Markdown (.md)");
    fireEvent.click(mdItems[0]);
    expect(onExportMarkdown).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 点击导入 Markdown 触发 onImportMarkdown", () => {
    const onImportMarkdown = vi.fn();
    renderToolbar({ onImportMarkdown });
    const mdItems = screen.getAllByText("📝 Markdown (.md)");
    // 第二个是导入下拉里的
    fireEvent.click(mdItems[1]);
    expect(onImportMarkdown).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 点击 OPML 导出触发 onExportOpml", () => {
    const onExportOpml = vi.fn();
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar({ onExportOpml });
    const opmlItems = screen.getAllByText("🌐 OPML (.opml)");
    fireEvent.click(opmlItems[0]);
    expect(onExportOpml).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 渲染 🧠 品牌图标", () => {
    renderToolbar();
    expect(screen.getByText("🧠")).toBeInTheDocument();
  });
});

// === OB-026 Bug3 回归(7022507):最近文件下拉 + dirty confirm ===

describe("FE-TOOLBAR-OPEN: 最近文件下拉", () => {
  const origConfirm = window.confirm;

  beforeEach(() => {
    useMindMapStore.setState({ content: null, dirty: false });
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(null as any);
    window.confirm = origConfirm;
  });

  afterEach(() => {
    window.confirm = origConfirm;
  });

  it("★bug 回归★ 渲染最近文件区域(前 5 个)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      files: [
        { path: "/a.mmap", name: "A" },
        { path: "/b.mmap", name: "B" },
        { path: "/c.mmap", name: "C" },
      ],
    } as any);
    renderToolbar();
    await waitFor(() => {
      expect(screen.getByText("🕐 最近文件")).toBeInTheDocument();
    });
    expect(screen.getByText("📄 A")).toBeInTheDocument();
    expect(screen.getByText("📄 B")).toBeInTheDocument();
    expect(screen.getByText("📄 C")).toBeInTheDocument();
  });

  it("★bug 回归★ 无最近文件时不渲染下拉区域", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ files: [] } as any);
    renderToolbar();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("🕐 最近文件")).not.toBeInTheDocument();
  });

  it("★bug 回归★ 点击最近文件触发 invoke list_windows + add_recent_file + create_new_window", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      files: [{ path: "/x.mmap", name: "X" }],
    } as any);
    // list_windows 返回空数组(无重复窗口)
    vi.mocked(invoke).mockResolvedValueOnce([] as any);
    renderToolbar();
    await waitFor(() => expect(screen.getByText("📄 X")).toBeInTheDocument());
    fireEvent.click(screen.getByText("📄 X"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_windows");
      expect(invoke).toHaveBeenCalledWith("add_recent_file", { path: "/x.mmap", name: "X" });
      expect(invoke).toHaveBeenCalledWith("create_new_window", { mode: "open", mmapPath: "/x.mmap" });
    });
  });

  it("★bug 回归★ 已有窗口打开同文件时调 focus_window(去重路径)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      files: [{ path: "/x.mmap", name: "X" }],
    } as any);
    // list_windows 返回已有窗口
    vi.mocked(invoke).mockResolvedValueOnce([
      { label: "doc-1", title: "X" },
    ] as any);
    renderToolbar();
    await waitFor(() => expect(screen.getByText("📄 X")).toBeInTheDocument());
    fireEvent.click(screen.getByText("📄 X"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("focus_window", { label: "doc-1" });
      // 不应再创建新窗口
      expect(invoke).not.toHaveBeenCalledWith("create_new_window", expect.anything());
    });
  });

  it("★bug 回归★ dirty=true 时弹 confirm,用户取消不打开", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      files: [{ path: "/x.mmap", name: "X" }],
    } as any);
    useMindMapStore.setState({ dirty: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderToolbar();
    await waitFor(() => expect(screen.getByText("📄 X")).toBeInTheDocument());
    fireEvent.click(screen.getByText("📄 X"));
    expect(confirmSpy).toHaveBeenCalledWith("当前文档有未保存的修改,是否继续打开?");
    // confirm 返回 false → 不应触发 list_windows(在 checkDirty 之后)
    // list_windows 是 checkDirty 通过后的第一个调用
    const listWindowsCalls = vi.mocked(invoke).mock.calls.filter(
      ([cmd]) => cmd === "list_windows",
    );
    expect(listWindowsCalls.length).toBe(0);
  });

  it("★bug 回归★ dirty=true 用户确认时正常打开", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      files: [{ path: "/x.mmap", name: "X" }],
    } as any);
    vi.mocked(invoke).mockResolvedValueOnce([] as any);
    useMindMapStore.setState({ dirty: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderToolbar();
    await waitFor(() => expect(screen.getByText("📄 X")).toBeInTheDocument());
    fireEvent.click(screen.getByText("📄 X"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_windows");
    });
    expect(confirmSpy).toHaveBeenCalled();
  });
});
