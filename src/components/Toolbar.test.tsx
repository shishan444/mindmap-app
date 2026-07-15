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
    onSetPriority: handlers.onSetPriority || vi.fn(),
  };
  return { ...props, result: render(<Toolbar {...props} />) };
}

describe("FE-TOOLBAR: 按钮显隐与状态", () => {
  it("FE-TOOLBAR-01: 无 content 时 onSave 按钮禁用", () => {
    renderToolbar();
    const saveBtn = screen.getByTitle("保存");
    expect(saveBtn).toBeDisabled();
  });

  it("FE-TOOLBAR-01b: 有 content 时 onSave 启用", () => {
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar();
    const saveBtn = screen.getByTitle("保存");
    expect(saveBtn).not.toBeDisabled();
  });

  it("FE-TOOLBAR-02: dirty=true 时保存按钮显示 *", () => {
    useMindMapStore.setState({
      content: { root: { id: "x" } } as any,
      dirty: true,
    });
    renderToolbar();
    const saveBtn = screen.getByTitle("保存");
    expect(saveBtn.textContent).toContain("*");
  });

  it("FE-TOOLBAR-02b: dirty=false 时保存按钮不显示 *", () => {
    useMindMapStore.setState({
      content: { root: { id: "x" } } as any,
      dirty: false,
    });
    renderToolbar();
    const saveBtn = screen.getByTitle("保存");
    expect(saveBtn.textContent).not.toContain("*");
  });
});

describe("FE-TOOLBAR: 点击回调", () => {
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

  it("FE-TOOLBAR: 点击保存按钮触发 onSave（content 存在时）", () => {
    const onSave = vi.fn();
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar({ onSave });
    fireEvent.click(screen.getByTitle("保存"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR-03: 点击 PNG 按钮触发 onExportPng", () => {
    const onExportPng = vi.fn();
    useMindMapStore.setState({ content: { root: { id: "x" } } as any });
    renderToolbar({ onExportPng });
    fireEvent.click(screen.getByTitle("导出 PNG"));
    expect(onExportPng).toHaveBeenCalledTimes(1);
  });

  it("FE-TOOLBAR: 无 content 时 PNG 按钮禁用", () => {
    renderToolbar();
    expect(screen.getByTitle("导出 PNG")).toBeDisabled();
  });
});

describe("FE-TOOLBAR: 品牌区", () => {
  it("FE-TOOLBAR: 渲染 🧠 品牌图标", () => {
    renderToolbar();
    expect(screen.getByText("🧠")).toBeInTheDocument();
  });
});
