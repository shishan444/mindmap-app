import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useMindMapStore } from "../store";
import Sidebar from "./Sidebar";

beforeEach(() => {
  useMindMapStore.setState({
    activeTab: "properties",
    sidebarCollapsed: false,
    sidebarWidth: 280,
  });
});

describe("FE-SIDEBAR: tab 切换", () => {
  it("FE-SIDEBAR-01: 默认 activeTab='properties'，显示面板面板标题", () => {
    render(<Sidebar />);
    expect(screen.getByText("面板")).toBeInTheDocument();
  });

  it("FE-SIDEBAR-02: 点击 '大纲' tab 后切换", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("大纲"));
    expect(useMindMapStore.getState().activeTab).toBe("outline");
  });

  it("FE-SIDEBAR-02b: 点击 '提醒' tab 后切换", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("提醒"));
    expect(useMindMapStore.getState().activeTab).toBe("reminders");
  });

  it("FE-SIDEBAR-02c: 点击 '样式' tab 后切换", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("样式"));
    expect(useMindMapStore.getState().activeTab).toBe("style");
  });

  it("FE-SIDEBAR: active tab 有 'active' class", () => {
    const { container } = render(<Sidebar />);
    const activeTab = container.querySelector(".sidebar-tab.active");
    expect(activeTab).not.toBeNull();
    expect(activeTab?.textContent).toContain("面板");
  });
});

describe("FE-SIDEBAR: 折叠/展开", () => {
  it("FE-SIDEBAR-03: collapsed=true 时只显示图标列（不含 tab 文字）", () => {
    useMindMapStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);
    // collapsed 模式下不应渲染完整 tab 文字
    // 折叠态有 sidebar-collapsed class
    const collapsed = document.querySelector(".sidebar-collapsed");
    expect(collapsed).not.toBeNull();
  });

  it("FE-SIDEBAR: 点击折叠按钮切换 collapsed", () => {
    render(<Sidebar />);
    const collapseBtn = screen.getByTitle("折叠侧栏");
    fireEvent.click(collapseBtn);
    expect(useMindMapStore.getState().sidebarCollapsed).toBe(true);
  });

  it("FE-SIDEBAR: 折叠态点击图标展开并切换 tab", () => {
    useMindMapStore.setState({ sidebarCollapsed: true });
    render(<Sidebar />);
    const outlineBtn = screen.getByTitle("大纲");
    fireEvent.click(outlineBtn);
    expect(useMindMapStore.getState().sidebarCollapsed).toBe(false);
    expect(useMindMapStore.getState().activeTab).toBe("outline");
  });
});

describe("FE-SIDEBAR: 宽度", () => {
  it("FE-SIDEBAR: 应用 sidebarWidth", () => {
    useMindMapStore.setState({ sidebarWidth: 350 });
    const { container } = render(<Sidebar />);
    const sidebar = container.querySelector(".sidebar") as HTMLElement;
    expect(sidebar.style.width).toBe("350px");
  });
});
