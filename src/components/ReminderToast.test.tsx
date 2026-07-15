import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import ReminderToast from "./ReminderToast";

describe("FE-TOAST: ReminderToast", () => {
  it("FE-TOAST-01: 初始渲染无 toast（listen 异步，container 为空）", () => {
    const { container } = render(<ReminderToast />);
    expect(container.firstChild).toBeNull();
  });

  it("FE-TOAST-02: 渲染不抛错（listen mock 已在 setup.ts 配置）", () => {
    expect(() => render(<ReminderToast />)).not.toThrow();
  });
});
