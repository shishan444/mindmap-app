import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PreferencesView from "./PreferencesModal";
import { makeConfig } from "../test/helpers";

// 独立窗口依赖 mock
const destroyMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: destroyMock }),
}));
const emitMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/event", () => ({
  emit: emitMock,
  listen: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  destroyMock.mockResolvedValue(undefined);
  emitMock.mockResolvedValue(undefined);
  vi.mocked(invoke).mockClear();
});

/** 渲染并等待 get_config 加载完成(draft 就绪) */
async function renderView(cfgOverrides: Parameters<typeof makeConfig>[0] = {}) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_config") return Promise.resolve(makeConfig(cfgOverrides));
    return Promise.resolve(null);
  });
  render(<PreferencesView />);
  await waitFor(() => {
    expect(screen.getByText("默认新建文件目录")).toBeInTheDocument();
  });
}

describe("FE-PREFS: 偏好设置(独立窗口视图)", () => {
  it("FE-PREFS-01: get_config 前显示加载中", () => {
    vi.mocked(invoke).mockImplementation(
      () => new Promise(() => { /* pending */ }),
    );
    render(<PreferencesView />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("FE-PREFS-02: 加载后渲染内容(入口为独立原生窗口)", async () => {
    await renderView();
    expect(screen.getByText("通用")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("保存")).toBeInTheDocument();
  });

  it("FE-PREFS-03: 默认显示通用 tab", async () => {
    await renderView();
    expect(screen.getByText("默认新建文件目录")).toBeInTheDocument();
  });

  it("FE-PREFS-04: 点击 tab 切换", async () => {
    await renderView();
    fireEvent.click(screen.getByText("提醒"));
    expect(screen.getByText("启用提醒声音")).toBeInTheDocument();
    fireEvent.click(screen.getByText("外观"));
    expect(screen.getByText("主题")).toBeInTheDocument();
    fireEvent.click(screen.getByText("导出"));
    expect(screen.getByText("PNG 分辨率倍数")).toBeInTheDocument();
  });

  it("FE-PREFS-05: 点击取消关闭窗口(destroy)", async () => {
    await renderView();
    fireEvent.click(screen.getByText("取消"));
    await waitFor(() => expect(destroyMock).toHaveBeenCalled());
  });

  it("FE-PREFS-06: Esc 关闭窗口(escape-routes)", async () => {
    await renderView();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(destroyMock).toHaveBeenCalled());
  });

  it("FE-PREFS-08: 保存触发 invoke save_config_command", async () => {
    await renderView({ auto_save_interval_sec: 2 });
    const autoSaveInput = screen.getByDisplayValue("2");
    fireEvent.change(autoSaveInput, { target: { value: "10" } });
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

  it("FE-PREFS-09: 保存成功后广播 prefs-updated + 关闭窗口", async () => {
    await renderView({ auto_save_interval_sec: 2 });
    const autoSaveInput = screen.getByDisplayValue("2");
    fireEvent.change(autoSaveInput, { target: { value: "15" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith("prefs-updated");
      expect(destroyMock).toHaveBeenCalled();
    });
  });

  it("FE-PREFS-10: 编辑字段(draft)未保存前不触发 save_config_command", async () => {
    await renderView({ auto_save_interval_sec: 2 });
    const autoSaveInput = screen.getByDisplayValue("2");
    fireEvent.change(autoSaveInput, { target: { value: "30" } });
    expect(invoke).not.toHaveBeenCalledWith("save_config_command", expect.anything());
  });

  it("FE-PREFS-11: 提醒 tab 切换勾选声音", async () => {
    await renderView();
    fireEvent.click(screen.getByText("提醒"));
    const checkbox = screen.getByLabelText(/启用提醒声音/) as HTMLInputElement;
    const before = checkbox.checked;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(!before);
  });

  it("FE-PREFS-12: 主题切换 select", async () => {
    await renderView();
    fireEvent.click(screen.getByText("外观"));
    const select = screen.getByDisplayValue("跟随系统") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "dark" } });
    expect(select.value).toBe("dark");
  });
});
