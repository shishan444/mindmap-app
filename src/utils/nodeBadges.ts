import { computeNodeReminderState } from "./reminderState";

/* ============================================================
   nodeBadges — 画布节点视觉标记同步(P2-8 拆分自 MindMapCanvas)
   三类标记:沙漏(reminder 状态)/ 优先级色条 / 附加文件渲染
   纯模块函数,依赖 mind-elixir 实例 + store 快照,零组件耦合。
   ============================================================ */
// === 沙漏渲染 helper(module 顶层,多 useEffect 共享) ===
export function syncHourglassesExternal(inst: any, state: any) {
  if (!inst || !state.content) return;
  const reminders = state.allReminders || [];
  const now = new Date();
  const walk = (node: any) => {
    if (!node?.id) return;
    // findEle 可能 throw("Node not found, maybe collapsed") — 用 try/catch
    // 节点 collapsed / 还没 init 完 / 用户在编辑中,都可能找不到 DOM
    let tpc: any = null;
    try {
      tpc = typeof inst.findEle === "function" ? inst.findEle(node.id) : null;
    } catch (e) {
      // 节点暂时找不到,跳过(下次 content 变化会重试)
      return;
    }
    if (!tpc) return;
    // 移除旧沙漏
    const old = tpc.parentElement?.querySelector(".hourglass-wrapper");
    if (old) old.remove();
    // 计算状态
    const result = computeNodeReminderState(reminders, node.id, now);
    if (!result.hasActive) {
      for (const c of node.children || []) walk(c);
      return;
    }
    // 创建沙漏容器,tpc 外部右上角
    const wrapper = document.createElement("div");
    wrapper.className = "hourglass-wrapper";
    wrapper.style.cssText =
      "position:absolute;right:-18px;top:-8px;z-index:var(--z-node-badge);pointer-events:none;";
    wrapper.innerHTML = renderHourglassSvg(result.state, result.remainingRatio);
    // 插到 tpc 的父元素(me-parent / me-wrapper)
    const host = tpc.parentElement;
    if (host && getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    host?.appendChild(wrapper);
    for (const c of node.children || []) walk(c);
  };
  walk(state.content.root);
}

function renderHourglassSvg(state: string, ratio: number): string {
  const colors: Record<string, string> = {
    future: "#4dc4ff",
    looming: "#f5a623",
    due: "#e74c3c",
    done: "#9aa0a6",
    paused: "#cccccc",
  };
  const color = colors[state] || colors.future;
  const rotation = state === "done" ? 180 : 0;
  const opacity = state === "paused" ? 0.4 : state === "done" ? 0.6 : 1;
  const animClass =
    state === "looming" ? "hourglass-flow-slow" : state === "due" ? "hourglass-flow-fast" : "";
  const upperRatio = state === "done" ? 0 : Math.max(0, Math.min(1, ratio));
  const lowerRatio = state === "done" ? 1 : 1 - upperRatio;
  const upperPath = buildUpperSandPath(upperRatio);
  const lowerPath = buildLowerSandPath(lowerRatio);
  const streamOpacity = state === "looming" || state === "due" ? 0.9 : 0;
  return `<svg width="14" height="14" viewBox="0 0 20 20" class="hourglass-icon hourglass-${state} ${animClass}" style="pointer-events:none;transform:rotate(${rotation}deg);opacity:${opacity};transition:transform 0.4s ease,opacity 0.3s ease;display:block" aria-hidden="true">
    <rect x="3" y="2" width="14" height="1.5" fill="${color}"/>
    <rect x="3" y="16.5" width="14" height="1.5" fill="${color}"/>
    <path d="M4 3.5 L16 3.5 L11 9.5 Q10 10.3 9 9.5 Z" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M4 16.5 L16 16.5 L11 10.5 Q10 9.7 9 10.5 Z" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1.3" stroke-linejoin="round"/>
    ${upperPath ? `<path d="${upperPath}" fill="${color}" fill-opacity="0.85"/>` : ""}
    ${lowerPath ? `<path d="${lowerPath}" fill="${color}"/>` : ""}
    <line x1="10" y1="9.5" x2="10" y2="10.5" stroke="${color}" stroke-width="0.6" class="hourglass-stream" opacity="${streamOpacity}"/>
  </svg>`;
}

function buildUpperSandPath(ratio: number): string {
  if (ratio <= 0) return "";
  const topY = 3.5 + (9.5 - 3.5) * (1 - ratio);
  const ratioAtTop = (topY - 3.5) / (9.5 - 3.5);
  const halfWidth = 6 - 5 * ratioAtTop;
  const cx = 10;
  return `M${cx - halfWidth} ${topY} L${cx + halfWidth} ${topY} L11 9.5 Q10 10.3 9 9.5 Z`;
}

function buildLowerSandPath(ratio: number): string {
  if (ratio <= 0) return "";
  const topY = 16.5 - (16.5 - 10.5) * ratio;
  const ratioAtTop = (16.5 - topY) / (16.5 - 10.5);
  const halfWidth = 6 - 5 * ratioAtTop;
  const cx = 10;
  return `M${cx - halfWidth} ${topY} L${cx + halfWidth} ${topY} L16 16.5 L4 16.5 Z`;
}

// === 优先级视觉同步 helper(module 顶层,init/re-init/change 后共用) ===
// ★ 修复(首开丢优先级):mind-elixir init()/refresh() 重建 DOM 后 priority class 全部丢失,
// 原实现只在 change 事件/undo-redo 路径同步;打开文档的首开路径(re-init)无人补 →
// 节点优先级视觉(左色条+图标)消失。此函数供 re-init 与 needStoreToMindSync 两处复用。
export function syncPriorityStylesExternal(inst: any, state: any) {
  if (!inst || !state.content) return;
  const walk = (node: any) => {
    if (!node?.id) return;
    let tpc: any = null;
    try {
      tpc = typeof inst.findEle === "function" ? inst.findEle(node.id) : null;
    } catch {
      return;
    }
    if (tpc) {
      tpc.classList.remove("priority-p0", "priority-p1", "priority-p2", "priority-p3");
      if (node.priority) {
        tpc.classList.add(`priority-${node.priority.toLowerCase()}`);
      }
    }
    for (const c of node.children || []) walk(c);
  };
  walk(state.content.root);
}

// === 附加文件渲染 helper ===
// 按 attached_file.file_type 差异化渲染:
// - image/pdf/slide/doc/sheet → 显示真实缩略图(<img>)
// - video/audio/other → 显示类型图标(SVG)
// - 所有类型:加类型色左边框 + 右下角扩展名角标(便于一眼识别)
export function syncAttachedFiles(inst: any, state: any) {
  if (!inst || !state.content) return;
  const mmapPath = state.filePath;
  const walk = (node: any) => {
    if (!node?.id) return;
    let tpc: any = null;
    try {
      tpc = typeof inst.findEle === "function" ? inst.findEle(node.id) : null;
    } catch {
      return;
    }
    if (!tpc) return;
    // 移除旧附件渲染
    const oldRender = tpc.querySelector(".attached-render");
    if (oldRender) oldRender.remove();
    const attached = node.attached_file;
    if (!attached) {
      for (const c of node.children || []) walk(c);
      return;
    }
    // 创建渲染容器(覆盖在 tpc 内部)
    // data-file-type 用于 CSS 选择类型色边框(--attached-type-color)
    const render = document.createElement("div");
    render.className = "attached-render";
    render.dataset.fileType = attached.file_type;
    render.style.cssText =
      "position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;pointer-events:none;background:#fff;";

    if (attached.file_type === "image" || attached.file_type === "pdf" || attached.file_type === "slide" || attached.file_type === "doc" || attached.file_type === "sheet") {
      // 真实缩略图(异步加载)
      const img = document.createElement("img");
      img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;";
      img.alt = attached.original_name;
      // 通过 invoke 读缩略图字节,转 data URL
      if (mmapPath) {
        // 用 dynamic import 避免 SSR/测试环境问题
        (window as any).__TAURI_INTERNALS__?.invoke("read_thumbnail", {
          mmapPath, uuid: attached.uuid,
        }).then((bytes: number[] | null) => {
          if (bytes && bytes.length) {
            const b64 = bytesToBase64(bytes);
            img.src = `data:image/png;base64,${b64}`;
          } else {
            img.className = "attached-fallback";
            img.src = fileIconDataUri(attached.file_type);
          }
        }).catch(() => {
          img.className = "attached-fallback";
          img.src = fileIconDataUri(attached.file_type);
        });
      } else {
        img.src = fileIconDataUri(attached.file_type);
      }
      render.appendChild(img);
    } else {
      // 视频/音频/其他 — 类型图标装进玻璃徽章(与面板 file-type-badge 同构)
      const badge = document.createElement("div");
      badge.className = "attached-icon-badge";
      badge.innerHTML = fileIconSvg(attached.file_type);
      render.appendChild(badge);
    }

    // 扩展名角标(右下角小标签,显示 .PDF/.MP4 等,辅助识别)
    const extTag = document.createElement("div");
    extTag.className = "attached-ext-tag";
    extTag.textContent = (attached.ext || "?").toUpperCase();
    render.appendChild(extTag);

    const host = tpc;
    if (host && getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    host.appendChild(render);
    for (const c of node.children || []) walk(c);
  };
  walk(state.content.root);
}

// 文件类型 → 内联 SVG(用于 video/audio/other,深色玻璃风格适配:细线+提亮色)
function fileIconSvg(fileType: string): string {
  const colors: Record<string, string> = {
    video: "#b98ce0",
    audio: "#55d6c9",
    other: "#9aa3ad",
  };
  const color = colors[fileType] || colors.other;
  if (fileType === "video") {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
  }
  if (fileType === "audio") {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
  }
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
}

function fileIconDataUri(fileType: string): string {
  const svg = fileIconSvg(fileType);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function bytesToBase64(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}
