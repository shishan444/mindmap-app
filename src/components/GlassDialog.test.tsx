import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { GlassDialogHost, showAlert, showConfirm } from "./GlassDialog";

// 队列状态在模块级,每个用例后强制清空(vi.resetModules 太重,直接等队列走完)
beforeEach(() => {
  cleanup();
});

describe("FE-GLASS-DIALOG: 玻璃对话框(alert/confirm 替代)", () => {
  it("无请求时 Host 不渲染", () => {
    render(<GlassDialogHost />);
    expect(document.querySelector(".glass-dialog")).toBeNull();
  });

  it("showAlert 渲染标题/正文/知道了,点按钮 resolve", async () => {
    render(<GlassDialogHost />);
    const p = showAlert("保存失败", "磁盘已满", "error");
    await screen.findByRole("dialog");
    expect(screen.getByText("保存失败")).toBeInTheDocument();
    expect(screen.getByText("磁盘已满")).toBeInTheDocument();
    fireEvent.click(screen.getByText("知道了"));
    await expect(p).resolves.toBeUndefined();
    expect(document.querySelector(".glass-dialog")).toBeNull();
  });

  it("showConfirm 取消按钮 resolve false", async () => {
    render(<GlassDialogHost />);
    const p = showConfirm("删除提醒", { message: "确定删除此提醒?", danger: true });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("取消"));
    await expect(p).resolves.toBe(false);
  });

  it("showConfirm 确认按钮 resolve true + 自定义文案", async () => {
    render(<GlassDialogHost />);
    const p = showConfirm("移除附件", { confirmText: "移除", danger: true });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByText("移除"));
    await expect(p).resolves.toBe(true);
  });

  it("Escape = 取消", async () => {
    render(<GlassDialogHost />);
    const p = showConfirm("标题");
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(p).resolves.toBe(false);
  });

  it("Enter = 确认", async () => {
    render(<GlassDialogHost />);
    const p = showConfirm("标题");
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Enter" });
    await expect(p).resolves.toBe(true);
  });

  it("队列:多个请求依次展示(FIFO)", async () => {
    render(<GlassDialogHost />);
    const p1 = showAlert("第一个");
    const p2 = showAlert("第二个");
    await screen.findByRole("dialog");
    expect(screen.getByText("第一个")).toBeInTheDocument();
    expect(screen.queryByText("第二个")).toBeNull();
    // 关第一个 → 第二个接管
    fireEvent.click(screen.getByText("知道了"));
    await expect(p1).resolves.toBeUndefined();
    expect(await screen.findByText("第二个")).toBeInTheDocument();
    fireEvent.click(screen.getByText("知道了"));
    await expect(p2).resolves.toBeUndefined();
  });
});
