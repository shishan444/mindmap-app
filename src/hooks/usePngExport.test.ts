import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useMindMapStore } from "../store";
import { exportPng } from "./usePngExport";
import { makeContent, makeConfig, makeNode } from "../test/helpers";

// mock html-to-image
vi.mock("html-to-image", () => ({
  toPng: vi.fn().mockResolvedValue("data:image/png;base64,aGVsbG8="), // "hello" in base64
}));

import { toPng } from "html-to-image";

beforeEach(() => {
  vi.useRealTimers();
  useMindMapStore.setState({
    content: null,
    filePath: null,
    config: makeConfig({ export: { png_scale: 2, markdown_indent: "  " } }),
    dirty: false,
  });
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValue(null as any);
  vi.mocked(saveDialog).mockClear();
  vi.mocked(saveDialog).mockResolvedValue(null);
  vi.mocked(toPng).mockClear();
  vi.mocked(toPng).mockResolvedValue("data:image/png;base64,aGVsbG8=");
});

describe("FE-PNG: exportPng", () => {
  it("FE-PNG-01: 无 content 时抛错", async () => {
    useMindMapStore.setState({ content: null });
    await expect(exportPng({})).rejects.toThrow(/未打开文档/);
  });

  it("FE-PNG-02: 无 mindInstance 时抛错", async () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ topic: "x" }) }),
    });
    await expect(exportPng(null)).rejects.toThrow(/画布 DOM/);
  });

  it("FE-PNG-03: 用户取消保存对话框 → 返回 null，不写文件", async () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ topic: "x" }) }),
    });
    vi.mocked(saveDialog).mockResolvedValueOnce(null);

    const result = await exportPng({ mapArea: document.createElement("div") });
    expect(result).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith(
      "save_bytes",
      expect.anything(),
    );
  });

  it("FE-PNG-04: 正常导出 → 调用 save_bytes 和 update_last_dirs", async () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ topic: "我的导图" }) }),
    });
    vi.mocked(saveDialog).mockResolvedValueOnce("/Users/x/Desktop/out.png");

    const result = await exportPng({ mapArea: document.createElement("div") });

    expect(result).toBe("/Users/x/Desktop/out.png");
    // 调用了 save_bytes
    expect(invoke).toHaveBeenCalledWith(
      "save_bytes",
      expect.objectContaining({
        path: "/Users/x/Desktop/out.png",
        data: expect.any(Array),
      }),
    );
    // 调用了 update_last_dirs
    expect(invoke).toHaveBeenCalledWith(
      "update_last_dirs",
      expect.objectContaining({
        openDir: null,
        exportDir: "/Users/x/Desktop",
        importDir: null,
      }),
    );
  });

  it("FE-PNG-05: 默认使用 config.export.png_scale", async () => {
    useMindMapStore.setState({
      config: makeConfig({ export: { png_scale: 4, markdown_indent: "  " } }),
      content: makeContent({ root: makeNode({ topic: "x" }) }),
    });
    vi.mocked(saveDialog).mockResolvedValueOnce("/tmp/o.png");

    await exportPng({ mapArea: document.createElement("div") });

    expect(toPng).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pixelRatio: 4 }),
    );
  });

  it("FE-PNG-06: 显式 pixelRatio 覆盖 config", async () => {
    useMindMapStore.setState({
      config: makeConfig({ export: { png_scale: 4, markdown_indent: "  " } }),
      content: makeContent({ root: makeNode({ topic: "x" }) }),
    });
    vi.mocked(saveDialog).mockResolvedValueOnce("/tmp/o.png");

    await exportPng({ mapArea: document.createElement("div") }, 1);

    expect(toPng).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pixelRatio: 1 }),
    );
  });

  it("FE-PNG-07: 默认文件名来自根节点 topic", async () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ topic: "学习计划" }) }),
    });
    await exportPng({ mapArea: document.createElement("div") }).catch(() => {});

    expect(saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringContaining("学习计划.png"),
      }),
    );
  });

  it("FE-PNG-08: 默认路径包含 last_export_dir", async () => {
    useMindMapStore.setState({
      config: makeConfig({
        last_export_dir: "/Users/x/Exports",
        export: { png_scale: 2, markdown_indent: "  " },
      }),
      content: makeContent({ root: makeNode({ topic: "T" }) }),
    });
    await exportPng({ mapArea: document.createElement("div") }).catch(() => {});

    expect(saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "/Users/x/Exports/T.png",
      }),
    );
  });

  it("FE-PNG-09: toPng 失败时抛错", async () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ topic: "x" }) }),
    });
    vi.mocked(toPng).mockRejectedValueOnce(new Error("render fail"));

    await expect(
      exportPng({ mapArea: document.createElement("div") }),
    ).rejects.toThrow(/render fail/);
  });

  it("FE-PNG-10: 找不到容器时尝试多个候选", async () => {
    useMindMapStore.setState({
      content: makeContent({ root: makeNode({ topic: "x" }) }),
    });
    // 第一个候选是 HTMLElement
    const div = document.createElement("div");
    const mind = { el: div };
    vi.mocked(saveDialog).mockResolvedValueOnce("/tmp/o.png");

    await exportPng(mind);
    expect(toPng).toHaveBeenCalledWith(div, expect.anything());
  });
});
