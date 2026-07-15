/**
 * 图片嵌入工具
 *
 * MVP 方案：图片以 base64 data URL 形式嵌入 NodeImage.url。
 * - 优点：简单，无需文件 I/O，前端可直接 <img src> 显示
 * - 缺点：.mmap 文件变大（base64 比原始大 33%）
 *
 * 后续优化：Phase 12 可改为 assets/ 目录 + 哈希命名 + invoke 读文件。
 */

export interface ProcessedImage {
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** 支持的图片格式 */
export const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

/** 最大图片大小（5MB） */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/**
 * 把 File/Blob 处理为 data URL + 尺寸
 * @throws 如果格式不支持或超大小
 */
export async function processImageFile(
  file: File | Blob,
): Promise<ProcessedImage> {
  if (file instanceof File) {
    if (file.type && !SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      throw new Error(`不支持的图片格式: ${file.type}`);
    }
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error(
        `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB > 5MB 上限）`,
      );
    }
  }
  const sizeBytes = file.size;
  const dataUrl = await blobToDataUrl(file);
  const { width, height } = await getImageDimensions(dataUrl);
  return { dataUrl, width, height, sizeBytes };
}

/** Blob → data URL */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(blob);
  });
}

/** 从 data URL 加载图片，返回自然尺寸 */
export function getImageDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = dataUrl;
  });
}

/** 校验拖拽事件是否含图片 */
export function hasImageInDataTransfer(e: DragEvent): boolean {
  if (!e.dataTransfer) return false;
  for (const item of Array.from(e.dataTransfer.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return true;
    }
  }
  return false;
}

/** 从拖拽事件提取第一个图片 File */
export function getImageFromDataTransfer(e: DragEvent): File | null {
  if (!e.dataTransfer) return null;
  for (const item of Array.from(e.dataTransfer.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

/** 从粘贴事件提取第一个图片 File */
export function getImageFromClipboard(e: ClipboardEvent): File | null {
  if (!e.clipboardData) return null;
  for (const item of Array.from(e.clipboardData.items)) {
    if (item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}
