import { toPng } from "html-to-image";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useMindMapStore } from "../store";

/**
 * 导出当前思维导图为 PNG。
 *
 * 流程：
 * 1. 用 html-to-image 把 mind-elixir 容器渲染成 PNG dataURL
 * 2. 弹出 save 对话框让用户选位置
 * 3. 通过 Tauri save_bytes 命令写入文件
 * 4. 更新 last_export_dir 到 config
 *
 * @param mindInstance mind-elixir 实例
 * @param pixelRatio 分辨率倍数（默认 2x）
 * @returns 保存的文件路径，或 null（用户取消）
 */
export async function exportPng(
  mindInstance: any,
  pixelRatio?: number,
): Promise<string | null> {
  const state = useMindMapStore.getState();
  if (!state.content) {
    throw new Error("未打开文档，无法导出");
  }

  // 找到 mind-elixir 主容器
  const container = findCanvasElement(mindInstance);
  if (!container) {
    throw new Error("无法定位画布 DOM");
  }

  const scale = pixelRatio ?? state.config?.export.png_scale ?? 2;

  // 生成 PNG dataURL
  const dataUrl = await toPng(container, {
    pixelRatio: scale,
    backgroundColor: "#ffffff",
    cacheBust: true,
  });

  // 解码 base64
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("PNG 生成失败：dataURL 无效");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  // 选保存位置
  const defaultName = `${state.content.root.topic || "思维导图"}.png`;
  const defaultPath = state.config?.last_export_dir
    ? `${state.config.last_export_dir}/${defaultName}`
    : defaultName;

  const filePath = await saveDialog({
    defaultPath,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!filePath) return null;

  // 写文件（通过 Tauri command）
  await invoke("save_bytes", {
    path: filePath,
    data: Array.from(bytes),
  });

  // 更新 last_export_dir
  const dir = filePath.split("/").slice(0, -1).join("/");
  if (dir) {
    await invoke("update_last_dirs", {
      openDir: null,
      exportDir: dir,
      importDir: null,
    });
  }

  return filePath;
}

function findCanvasElement(mindInstance: any): HTMLElement | null {
  if (!mindInstance) return null;
  // mind-elixir 5.x 的各种容器引用
  const candidates = [
    mindInstance.mapArea,
    mindInstance.el?.querySelector?.("#map-area"),
    mindInstance.el?.querySelector?.(".map-area"),
    mindInstance.el,
    mindInstance.container,
  ];
  for (const c of candidates) {
    if (c instanceof HTMLElement) return c;
  }
  return null;
}
