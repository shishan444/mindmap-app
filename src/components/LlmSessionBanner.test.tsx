import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import LlmSessionBanner from "./LlmSessionBanner";

beforeEach(() => {
  useMindMapStore.setState({ llmSession: null });
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValue(null as any);
});

describe("FE-LLM-BANNER", () => {
  it("无 session 时不渲染", () => {
    render(<LlmSessionBanner />);
    expect(document.querySelector(".llm-banner")).toBeNull();
  });

  it("有 session 时显示 banner", () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude Desktop",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    render(<LlmSessionBanner />);
    expect(screen.getByText(/正在编辑/)).toBeInTheDocument();
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText(/接管/)).toBeInTheDocument();
  });

  // === 系列修复回归(浮层玻璃化):bot 图标 SVG 化,emoji 清零 ===
  it("★浮层修复回归★ icon 为 SVG,按钮文案 emoji 清零", () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    const { container } = render(<LlmSessionBanner />);
    expect(document.querySelector(".llm-banner-icon svg")).toBeInTheDocument();
    expect(screen.getByText(/接管/).textContent).not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    );
  });

  it("剩余 ≤ 10s 进入 urgent 状态", async () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now() - 55000,
          expires_at_ms: Date.now() + 5000, // 5s 后过期
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    render(<LlmSessionBanner />);
    const banner = document.querySelector(".llm-banner") as HTMLElement;
    expect(banner.className).toContain("llm-banner-urgent");
  });

  it("点接管按钮调 invoke llm_force_release", async () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    render(<LlmSessionBanner />);
    fireEvent.click(screen.getByText(/接管/));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("llm_force_release");
    });
  });

  it("接管失败显示错误", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network down"));
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    render(<LlmSessionBanner />);
    fireEvent.click(screen.getByText(/接管/));
    await waitFor(() => {
      expect(screen.getByText(/接管失败/)).toBeInTheDocument();
    });
  });

  it("session 已过期显示已超时提示", () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now() - 70000,
          expires_at_ms: Date.now() - 10000, // 10s 前过期
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    render(<LlmSessionBanner />);
    expect(screen.getByText(/已超时/)).toBeInTheDocument();
  });

  // === OB-026 Bug2-a 回归(7022507):✕ 关闭按钮 + 0.8s 淡出 ===

  it("★bug 回归★ 点✕ 关闭按钮立即清空 llmSession(banner 隐藏)", () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    render(<LlmSessionBanner />);
    const closeBtn = screen.getByTitle("关闭提示");
    fireEvent.click(closeBtn);
    // 立即清空 store(Bug2-a 修复前 banner 无法关闭)
    expect(useMindMapStore.getState().llmSession).toBeNull();
  });

  it("★bug 回归★ session 结束后进入 fading 状态(0.8s 淡出动画)", async () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    const { container } = render(<LlmSessionBanner />);
    expect(document.querySelector(".llm-banner")).not.toBeNull();

    // 模拟 release/expire:session 变 null,但 hadSession=true 触发淡出
    useMindMapStore.setState({ llmSession: null });
    await waitFor(() => {
      const banner = document.querySelector(".llm-banner") as HTMLElement;
      // 仍在 DOM 中(淡出中),且 class 含 llm-banner-fading
      expect(banner.className).toContain("llm-banner-fading");
    });
  });

  it("★bug 回归★ 点✕ 关闭按钮也走淡出路径(跟 release 一致,UI 一致性)", async () => {
    useMindMapStore.setState({
      llmSession: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    const { container } = render(<LlmSessionBanner />);
    fireEvent.click(screen.getByTitle("关闭提示"));
    // store 立即清空
    expect(useMindMapStore.getState().llmSession).toBeNull();
    // 但 banner 进入淡出态(跟 release/expire 路径一致)
    await waitFor(() => {
      const banner = document.querySelector(".llm-banner") as HTMLElement;
      expect(banner.className).toContain("llm-banner-fading");
    });
  });
});
