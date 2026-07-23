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
    const { container } = render(<LlmSessionBanner />);
    expect(container.firstChild).toBeNull();
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
    const { container } = render(<LlmSessionBanner />);
    const banner = container.firstChild as HTMLElement;
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
});
