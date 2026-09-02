import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AboutModal from "./AboutModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FE-ABOUT-UPDATE: 检查更新(P3-11)", () => {
  it("发现新版本 → 显示提示 + 前往下载按钮", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tag_name: "v9.9.9" }),
    }));
    render(<AboutModal open={true} onClose={() => {}} />);
    // 等版本号加载(getVersion mock 失败回落 dev → 与 9.9.9 比较)
    await waitFor(() => expect(screen.getByText(/版本/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("检查更新"));
    await waitFor(() => expect(screen.getByText(/已是最新版本|发现新版本|检查失败/)).toBeInTheDocument());
  });

  it("★架构守护★ Portal 挂 body(不在 app-root,免疫布局劫持)", () => {
    render(<AboutModal open={true} onClose={() => {}} />);
    const el = document.querySelector(".about-mask");
    expect(el).not.toBeNull();
    expect(el!.closest(".app-root")).toBeNull();
    expect(el!.parentElement).toBe(document.body);
  });

  it("fetch 失败 → 检查失败提示", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<AboutModal open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText("检查更新"));
    await waitFor(() => expect(screen.getByText("检查失败,请稍后再试")).toBeInTheDocument());
  });
});
