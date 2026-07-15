import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useMindMapStore } from "../store";
import PreferencesModal from "./PreferencesModal";
import { makeConfig } from "../test/helpers";

beforeEach(() => {
  useMindMapStore.setState({
    showPreferences: false,
    config: null,
  });
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValue(null as any);
});

describe("FE-PREFS: PreferencesModal", () => {
  it("FE-PREFS-01: show=false 时不渲染", () => {
    useMindMapStore.setState({ showPreferences: false });
    const { container } = render(<PreferencesModal />);
    expect(container.firstChild).toBeNull();
  });

  it("FE-PREFS-02: show=true + 有 config 时渲染", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    render(<PreferencesModal />);
    expect(screen.getByText("偏好设置")).toBeInTheDocument();
  });

  it("FE-PREFS-03: 默认显示通用 tab", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    render(<PreferencesModal />);
    expect(screen.getByText("默认新建文件目录")).toBeInTheDocument();
  });

  it("FE-PREFS-04: 点击 tab 切换", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    render(<PreferencesModal />);
    fireEvent.click(screen.getByText("提醒"));
    expect(screen.getByText("启用提醒声音")).toBeInTheDocument();
    fireEvent.click(screen.getByText("外观"));
    expect(screen.getByText("主题")).toBeInTheDocument();
    fireEvent.click(screen.getByText("导出"));
    expect(screen.getByText("PNG 分辨率倍数")).toBeInTheDocument();
  });

  it("FE-PREFS-05: 点击取消关闭 modal", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    render(<PreferencesModal />);
    fireEvent.click(screen.getByText("取消"));
    expect(useMindMapStore.getState().showPreferences).toBe(false);
  });

  it("FE-PREFS-06: 点击 × 关闭", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    render(<PreferencesModal />);
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(useMindMapStore.getState().showPreferences).toBe(false);
  });

  it("FE-PREFS-07: 点击遮罩关闭", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    const { container } = render(<PreferencesModal />);
    const overlay = container.querySelector(".prefs-overlay");
    fireEvent.mouseDown(overlay!);
    // 点遮罩用 onClick
    fireEvent.click(overlay!);
    expect(useMindMapStore.getState().showPreferences).toBe(false);
  });

  it("FE-PREFS-08: 保存触发 invoke save_config_command", async () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig({ auto_save_interval_sec: 2 }),
    });
    render(<PreferencesModal />);
    // 改个值
    const autoSaveInput = screen.getByDisplayValue("2");
    fireEvent.change(autoSaveInput, { target: { value: "10" } });
    // 点保存
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "save_config_command",
        expect.objectContaining({
          cfg: expect.objectContaining({ auto_save_interval_sec: 10 }),
        }),
      );
    });
  });

  it("FE-PREFS-09: 保存后 store.config 更新 + modal 关闭", async () => {
    const cfg = makeConfig({ auto_save_interval_sec: 2 });
    useMindMapStore.setState({
      showPreferences: true,
      config: cfg,
    });
    render(<PreferencesModal />);
    const autoSaveInput = screen.getByDisplayValue("2");
    fireEvent.change(autoSaveInput, { target: { value: "15" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(useMindMapStore.getState().config?.auto_save_interval_sec).toBe(15);
    });
    expect(useMindMapStore.getState().showPreferences).toBe(false);
  });

  it("FE-PREFS-10: 编辑字段不立即影响 store.config（draft 隔离）", () => {
    const cfg = makeConfig({ auto_save_interval_sec: 5 });
    useMindMapStore.setState({
      showPreferences: true,
      config: cfg,
    });
    render(<PreferencesModal />);
    const input = screen.getByDisplayValue("5");
    fireEvent.change(input, { target: { value: "99" } });
    // store.config 仍是原值
    expect(useMindMapStore.getState().config?.auto_save_interval_sec).toBe(5);
  });

  it("FE-PREFS-11: 提醒 tab 切换勾选声音", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    render(<PreferencesModal />);
    fireEvent.click(screen.getByText("提醒"));
    const checkbox = screen.getByLabelText(/启用提醒声音/);
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("FE-PREFS-12: 主题切换 select", () => {
    useMindMapStore.setState({
      showPreferences: true,
      config: makeConfig(),
    });
    render(<PreferencesModal />);
    fireEvent.click(screen.getByText("外观"));
    const themeSelect = screen.getByDisplayValue("跟随系统");
    fireEvent.change(themeSelect, { target: { value: "dark" } });
    expect(themeSelect).toHaveValue("dark");
  });
});
