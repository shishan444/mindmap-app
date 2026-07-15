import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  processImageFile,
  blobToDataUrl,
  getImageDimensions,
  hasImageInDataTransfer,
  getImageFromDataTransfer,
  getImageFromClipboard,
  SUPPORTED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from "./imageEmbed";

// Mock File / Blob / FileReader / Image
class MockFileReader {
  result: string = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(_blob: Blob) {
    setTimeout(() => {
      this.result = "data:image/png;base64,AAAA";
      this.onload?.();
    }, 0);
  }
}

class MockImage {
  naturalWidth = 100;
  naturalHeight = 50;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

beforeEach(() => {
  (globalThis as any).FileReader = MockFileReader;
  (globalThis as any).Image = MockImage;
});

describe("FE-IMG: 常量", () => {
  it("FE-IMG-01: 支持的格式列表含 png/jpeg/gif/webp/svg", () => {
    expect(SUPPORTED_IMAGE_TYPES).toContain("image/png");
    expect(SUPPORTED_IMAGE_TYPES).toContain("image/jpeg");
    expect(SUPPORTED_IMAGE_TYPES).toContain("image/gif");
    expect(SUPPORTED_IMAGE_TYPES).toContain("image/webp");
    expect(SUPPORTED_IMAGE_TYPES).toContain("image/svg+xml");
  });

  it("FE-IMG-02: MAX_IMAGE_SIZE 是 5MB", () => {
    expect(MAX_IMAGE_SIZE).toBe(5 * 1024 * 1024);
  });
});

describe("FE-IMG: blobToDataUrl", () => {
  it("FE-IMG-03: 把 Blob 转 data URL", async () => {
    const blob = new Blob(["x"], { type: "image/png" });
    const url = await blobToDataUrl(blob);
    expect(url).toMatch(/^data:image\/png;base64,/);
  });
});

describe("FE-IMG: getImageDimensions", () => {
  it("FE-IMG-04: 返回图片自然尺寸", async () => {
    const dims = await getImageDimensions("data:image/png;base64,xxx");
    expect(dims.width).toBe(100);
    expect(dims.height).toBe(50);
  });
});

describe("FE-IMG: processImageFile", () => {
  it("FE-IMG-05: 处理合法 File 返回 dataUrl + 尺寸 + 大小", async () => {
    const file = new File(["data"], "test.png", { type: "image/png" });
    const result = await processImageFile(file);
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
    expect(result.sizeBytes).toBe(4);
  });

  it("FE-IMG-06: 格式不支持时抛错", async () => {
    const file = new File(["x"], "t.bmp", { type: "image/bmp" });
    await expect(processImageFile(file)).rejects.toThrow(/不支持/);
  });

  it("FE-IMG-07: 文件过大抛错", async () => {
    const bigBlob = new Blob([new Uint8Array(MAX_IMAGE_SIZE + 1)]);
    const file = new File([bigBlob], "big.png", { type: "image/png" });
    await expect(processImageFile(file)).rejects.toThrow(/过大/);
  });

  it("FE-IMG-08: Blob（非 File）跳过类型/大小检查", async () => {
    const blob = new Blob([new Uint8Array(MAX_IMAGE_SIZE + 1)], {
      type: "image/bmp",
    });
    // Blob 没有 .type 检查（只有 File 才检查）
    const result = await processImageFile(blob);
    expect(result.dataUrl).toMatch(/^data:/);
  });
});

describe("FE-IMG: DataTransfer 处理", () => {
  function makeDragEvent(items: Array<{ kind: string; type: string; file: File | null }>): DragEvent {
    const dtItems = items.map((it) => ({
      kind: it.kind,
      type: it.type,
      getAsFile: () => it.file,
    }));
    return {
      dataTransfer: { items: dtItems } as any,
    } as DragEvent;
  }

  it("FE-IMG-09: hasImageInDataTransfer 检测到图片", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const e = makeDragEvent([{ kind: "file", type: "image/png", file }]);
    expect(hasImageInDataTransfer(e)).toBe(true);
  });

  it("FE-IMG-10: hasImageInDataTransfer 无图片时 false", () => {
    const e = makeDragEvent([{ kind: "string", type: "text/plain", file: null }]);
    expect(hasImageInDataTransfer(e)).toBe(false);
  });

  it("FE-IMG-11: hasImageInDataTransfer 无 dataTransfer 时 false", () => {
    const e = {} as DragEvent;
    expect(hasImageInDataTransfer(e)).toBe(false);
  });

  it("FE-IMG-12: getImageFromDataTransfer 提取图片", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const e = makeDragEvent([{ kind: "file", type: "image/png", file }]);
    expect(getImageFromDataTransfer(e)).toBe(file);
  });

  it("FE-IMG-13: getImageFromDataTransfer 无图片时返回 null", () => {
    const e = makeDragEvent([]);
    expect(getImageFromDataTransfer(e)).toBeNull();
  });
});

describe("FE-IMG: Clipboard 处理", () => {
  it("FE-IMG-14: getImageFromClipboard 提取图片", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const e = {
      clipboardData: {
        items: [
          { type: "image/png", getAsFile: () => file },
          { type: "text/plain", getAsFile: () => null },
        ],
      },
    } as unknown as ClipboardEvent;
    expect(getImageFromClipboard(e)).toBe(file);
  });

  it("FE-IMG-15: getImageFromClipboard 无 clipboardData 返回 null", () => {
    const e = {} as ClipboardEvent;
    expect(getImageFromClipboard(e)).toBeNull();
  });
});
