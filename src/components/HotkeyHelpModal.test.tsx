import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import HotkeyHelpModal from "./HotkeyHelpModal";

afterEach(() => cleanup());

describe("FE-HOTKEY-HELP: 快捷键速查模态(P3-12)", () => {
  it("open=false 不渲染", () => {
    render(<HotkeyHelpModal open={false} onClose={() => {}} />);
    expect(document.querySelector(".hotkey-modal")).toBeNull();
  });

  it("★架构守护★ open=true 时 Portal 挂 body(不在 app-root,免疫布局劫持)", () => {
    render(<HotkeyHelpModal open={true} onClose={() => {}} />);
    const el = document.querySelector(".hotkey-mask");
    expect(el).not.toBeNull();
    expect(el!.closest(".app-root")).toBeNull();
    expect(el!.parentElement).toBe(document.body);
  });

  it("open=true 渲染四个分组与关键快捷键", () => {
    render(<HotkeyHelpModal open={true} onClose={() => {}} />);
    expect(screen.getByText("节点操作")).toBeInTheDocument();
    expect(screen.getByText("文档")).toBeInTheDocument();
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("视图与搜索")).toBeInTheDocument();
    // 核心快捷键存在(kbd 键帽)
    expect(screen.getByText("Tab")).toBeInTheDocument();
    expect(screen.getByText("添加子节点")).toBeInTheDocument();
    expect(screen.getByText("⌘S")).toBeInTheDocument();
  });

  it("Esc / 点遮罩 / 点 × 关闭", () => {
    const onClose = vi.fn();
    render(<HotkeyHelpModal open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(document.querySelector(".hotkey-mask")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
