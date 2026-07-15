import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
