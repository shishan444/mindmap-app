import { useEffect, useRef } from "react";
import MindElixir from "mind-elixir";
// MindElixir.css 在 index.html 用 <link> 注入（package.json exports 限制）
import { useMindMapStore } from "../store";
import {
  toMindElixirData,
  fromMindElixirData,
} from "../utils/mindElixirAdapter";
import {
  processImageFile,
  hasImageInDataTransfer,
  getImageFromDataTransfer,
  getImageFromClipboard,
} from "../utils/imageEmbed";
import { computeNodeReminderState } from "../utils/reminderState";
import "./MindMapCanvas.css";

interface Props {
  onCreateInstance?: (mind: any) => void;
}

// === 沙漏渲染 helper(module 顶层,多 useEffect 共享) ===
function syncHourglassesExternal(inst: any, state: any) {
  if (!inst || !state.content) return;
  const reminders = state.allReminders || [];
  const now = new Date();
  const walk = (node: any) => {
    const tpc = typeof inst.findEle === "function" ? inst.findEle(node.id) : null;
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
      "position:absolute;right:-18px;top:-8px;z-index:50;pointer-events:none;";
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

// === 附加文件渲染 helper ===
// 按 attached_file.file_type 差异化渲染:
// - image/pdf/slide/doc/sheet → 显示真实缩略图(<img>)
// - video/audio/other → 显示类型图标(SVG)
function syncAttachedFiles(inst: any, state: any) {
  if (!inst || !state.content) return;
  const mmapPath = state.filePath;
  const walk = (node: any) => {
    const tpc = typeof inst.findEle === "function" ? inst.findEle(node.id) : null;
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
    const render = document.createElement("div");
    render.className = "attached-render";
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
            img.src = fileIconDataUri(attached.file_type);
          }
        }).catch(() => {
          img.src = fileIconDataUri(attached.file_type);
        });
      } else {
        img.src = fileIconDataUri(attached.file_type);
      }
      render.appendChild(img);
    } else {
      // 视频/音频/其他 — 显示类型图标
      render.innerHTML = fileIconSvg(attached.file_type);
    }

    const host = tpc;
    if (host && getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }
    host.appendChild(render);
    for (const c of node.children || []) walk(c);
  };
  walk(state.content.root);
}

// 文件类型 → 内联 SVG(用于 video/audio/other)
function fileIconSvg(fileType: string): string {
  const colors: Record<string, string> = {
    video: "#9b59b6",
    audio: "#1abc9c",
    other: "#95a5a6",
  };
  const color = colors[fileType] || colors.other;
  if (fileType === "video") {
    return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
  }
  if (fileType === "audio") {
    return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
  }
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
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

export default function MindMapCanvas({ onCreateInstance }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);
  const content = useMindMapStore((s) => s.content);
  const setContent = useMindMapStore((s) => s.setContent);
  const setSelectedNodeId = useMindMapStore((s) => s.setSelectedNodeId);
  const markDirty = useMindMapStore((s) => s.markDirty);
  const setMindInstance = useMindMapStore((s) => s.setMindInstance);
  const theme = useMindMapStore((s) => s.config?.ui.theme || "system");
  const needSync = useMindMapStore((s) => s.needStoreToMindSync);

  // content 变化时(撤销/重做/外星更新),重渲染附件(因为 attached_file 可能变了)
  useEffect(() => {
    const inst = instanceRef.current;
    if (!inst || !content) return;
    setTimeout(() => {
      const s = useMindMapStore.getState();
      syncAttachedFiles(inst, s);
    }, 100);
  }, [content]);

  // 初始化 mind-elixir（仅 mount 一次）
  useEffect(() => {
    if (!containerRef.current) return;
    const data = toMindElixirData(content);
    let mind: any;
    try {
      mind = new MindElixir({
        el: containerRef.current,
        direction: MindElixir.RIGHT,
        draggable: true,
        editable: true,
        contextMenu: false, // 禁用内置右键菜单（英文，与 fallback 中文菜单重复）
        toolBar: false, // 禁用浮动 toolbar：与 React 工具栏重复 + 5.14 内部 layout 异常（横铺画布、遮挡节点）
        keypress: false, // 禁用 mind-elixir keypress：5.14 Nt() noop bug，事件已在 fallback 中处理
        data,
      } as any);
      mind.init(data);
      instanceRef.current = mind;
      onCreateInstance?.(mind);
      setMindInstance(mind);

      // mind-elixir 5.14 的 selectNode 内部会直接覆盖 tpc 的 className(用 "selected" 替换)
      // 导致我们手动加的 priority-p0/p1/p2/p3 class 丢失。
      // hook 一下:调用前快照所有 priority class,调用后恢复。
      const origSelectNode = (mind as any).selectNode?.bind(mind);
      if (typeof origSelectNode === "function") {
        (mind as any).selectNode = function (...args: any[]) {
          const snapshot = new Map<HTMLElement, string>();
          document.querySelectorAll<HTMLElement>("me-tpc[class*=priority-]").forEach((t) => {
            const pCls = Array.from(t.classList).find((c) => /^priority-p[0-3]$/.test(c));
            if (pCls) snapshot.set(t, pCls);
          });
          const r = origSelectNode(...args);
          snapshot.forEach((cls, t) => {
            if (!t.classList.contains(cls)) t.classList.add(cls);
          });
          return r;
        };
      }
      // dev 模式暴露到 window 便于调试
      if (import.meta.env.DEV) {
        (window as any).__mind = mind;
        console.log("[MindMapCanvas] mind 实例暴露到 window.__mind");
      }

      // mind-elixir 5.14 的 toCenter 计算有偏差，根节点会偏下；
      // mind.move 在 5.14 也是 noop（API bug）。
      // 直接操作 mapCanvas 的 transform 把根节点真正居中到容器。
      setTimeout(() => {
        try {
          const inner = containerRef.current;
          const meRoot = inner?.querySelector("me-root") as HTMLElement | null;
          const mapCanvas = inner?.querySelector(".map-canvas") as HTMLElement | null;
          if (!inner || !meRoot || !mapCanvas) return;
          const innerRect = inner.getBoundingClientRect();
          const rootRect = meRoot.getBoundingClientRect();
          const dx =
            (innerRect.x + innerRect.width / 2) -
            (rootRect.x + rootRect.width / 2);
          const dy =
            (innerRect.y + innerRect.height / 2) -
            (rootRect.y + rootRect.height / 2);
          if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return;
          // 解析当前 transform: translate3d(Xpx, Ypx, 0px) scale(S)
          const t = mapCanvas.style.transform || "";
          const m = t.match(/translate3d\(\s*([-\d.]+)px[\s,]+([-\d.]+)px/);
          const curX = m ? parseFloat(m[1]) : 0;
          const curY = m ? parseFloat(m[2]) : 0;
          const scaleMatch = t.match(/scale\(\s*([\d.]+)\s*\)/);
          const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
          mapCanvas.style.transform = `translate3d(${curX + dx}px, ${curY + dy}px, 0px) scale(${scale})`;
        } catch (e) {
          console.error("[MindMapCanvas] centerRoot 失败", e);
        }
      }, 100);
    } catch (e) {
      console.error("[MindMapCanvas] init failed:", e);
      return;
    }
    if (!mind) return;

    const bus = mind.bus as any;

    bus.addListener("selectNode", (node: any) => {
      setSelectedNodeId(node?.id ?? null);
    });

    const changeEvents = [
      "operation",
      "insertSibling",
      "insertChild",
      "addChild",
      "removeNode",
      "moveNode",
      "updateNodeTopic",
      "moveNodeBefore",
      "moveNodeAfter",
    ];
    changeEvents.forEach((evt) => {
      bus.addListener(evt, () => {
        markDirty();
        syncFromMindElixir();
      });
    });

    function syncFromMindElixir() {
      const inst = instanceRef.current;
      if (!inst) return;
      try {
        const data =
          typeof inst.getData === "function"
            ? inst.getData()
            : inst.nodeData
            ? { nodeData: inst.nodeData }
            : null;
        if (!data || !data.nodeData) return;
        const state = useMindMapStore.getState();
        const newContent = fromMindElixirData(data, state.content);
        if (!newContent) return;
        if (state.content && state.content.root === newContent.root) return;
        setContent(newContent);
        const sel = inst.currentNodes?.[0];
        if (sel?.nodeObj?.id) {
          setSelectedNodeId(sel.nodeObj.id);
        }
        syncPriorityStyles();
      } catch (e) {
        console.error("[mind-elixir sync] 失败", e);
      }
    }

    // 遍历所有节点，根据 priority 设置画布 DOM 彩色左边框
    function syncPriorityStyles() {
      const inst = instanceRef.current;
      const state = useMindMapStore.getState();
      if (!inst || !state.content) return;
      const walk = (node: any) => {
        const tpc = typeof inst.findEle === "function" ? inst.findEle(node.id) : null;
        if (tpc) {
          tpc.classList.remove("priority-p0", "priority-p1", "priority-p2", "priority-p3");
          if (node.priority) {
            tpc.classList.add(`priority-${node.priority.toLowerCase()}`);
          }
        }
        for (const c of node.children || []) walk(c);
      };
      walk(state.content.root);
      // 同步沙漏(基于全局 reminders)
      syncHourglasses();
    }

    // 遍历所有节点,根据 reminders 状态渲染沙漏图标到节点右上角外部
    function syncHourglasses() {
      syncHourglassesExternal(instanceRef.current, useMindMapStore.getState());
    }

    // === Fallback 事件处理 ===

    // === Fallback 事件处理 ===
    // mind-elixir 5.14 内部 Nt() 返回 noop（疑似打包 bug），
    // 导致原生 click/dblclick/keydown 不响应。这里自己绑事件作为兜底。
    const inner = containerRef.current;
    let onFallbackClick: ((e: MouseEvent) => void) | null = null;
    let onFallbackDblClick: ((e: MouseEvent) => void) | null = null;
    let onFallbackKey: ((e: KeyboardEvent) => void) | null = null;
    let onDragStart: ((e: MouseEvent) => void) | null = null;
    let onDragMove: ((e: MouseEvent) => void) | null = null;
    let onDragEnd: ((e: MouseEvent) => void) | null = null;
    let onContextMenu: ((e: MouseEvent) => void) | null = null;
    let onDocClickCloseMenu: ((e: MouseEvent) => void) | null = null;
    let contextMenuCleanup: (() => void) | null = null;

    if (inner) {
      inner.setAttribute("tabindex", "0");
      inner.style.outline = "none";

      const getMeTpc = (target: EventTarget | null): HTMLElement | null => {
        if (!(target instanceof HTMLElement)) return null;
        // 直接匹配 me-tpc
        const direct = target.closest("me-tpc");
        if (direct) return direct as HTMLElement;
        // me-parent 包裹 me-tpc（mind-elixir 子节点的结构）
        // 用户点 padding 区域时 target=me-parent，需要向下找 me-tpc
        const parent = target.closest("me-parent");
        if (parent) return parent.querySelector("me-tpc") as HTMLElement;
        // me-root（根节点 wrapper）同理
        const root = target.closest("me-root");
        if (root) return root.querySelector("me-tpc") as HTMLElement;
        return null;
      };

      const getSelected = (): any | null => {
        const inst = instanceRef.current;
        if (!inst) return null;
        const cn = inst.currentNodes;
        if (Array.isArray(cn) && cn.length > 0) return cn[0];
        const sel = inner.querySelector("me-tpc.selected") as any;
        return sel || null;
      };

      // === 双击编辑：click 计数兜底 ===
      // mind-elixir dblclick 事件在某些环境（webkit / chrome-devtools dblClick 工具）不触发。
      // 用 click 计数模拟：同一节点 400ms 内第二次 click = 双击 = 进入编辑。
      let lastClickTime = 0;
      let lastClickTpc: HTMLElement | null = null;
      let editTriggered = false;  // 防止 dblclick + click 计数重复触发

      onFallbackClick = (e: MouseEvent) => {
        const tpc = getMeTpc(e.target);
        if (!tpc) return;
        const inst = instanceRef.current;
        if (!inst) return;
        try {
          const now = Date.now();
          const isDoubleClick =
            tpc === lastClickTpc &&
            now - lastClickTime < 400 &&
            !editTriggered;

          if (isDoubleClick) {
            // 双击 → 如果节点有 attached_file,调用系统工具打开;否则进入编辑
            const nodeId = (tpc as any).nodeObj?.id || tpc.getAttribute("data-nodeid");
            const store = useMindMapStore.getState();
            const filePath = store.filePath;
            // 在 store.content 里找该节点的 attached_file
            const findAttached = (n: any): any => {
              if (n.id === nodeId) return n.attached_file;
              for (const c of n.children || []) {
                const r = findAttached(c);
                if (r) return r;
              }
              return null;
            };
            const attached = store.content ? findAttached(store.content.root) : null;
            if (attached && filePath) {
              // 双击有附件 → 系统工具打开
              (window as any).__TAURI_INTERNALS__?.invoke("open_attached_file", {
                mmapPath: filePath, nodeId,
              }).catch((e: any) => console.error("[打开附件] 失败", e));
            } else {
              // 双击无附件 → 编辑 topic
              editTriggered = true;
              setTimeout(() => { editTriggered = false; }, 600);
              inst.selectNode(tpc);
              inst.beginEdit(tpc);
            }
          } else {
            // 单击 → 选中
            inst.selectNode(tpc);
            const nodeId = (tpc as any).nodeObj?.id || tpc.getAttribute("data-nodeid");
            setSelectedNodeId(nodeId);
          }
          lastClickTime = now;
          lastClickTpc = tpc;
        } catch (err) {
          console.error("[fallback click] 失败", err);
        }
      };

      onFallbackDblClick = (e: MouseEvent) => {
        // dblclick 事件触发时，标记 editTriggered 防止 click 计数重复
        const tpc = getMeTpc(e.target);
        if (!tpc) return;
        const inst = instanceRef.current;
        if (!inst) return;
        try {
          // 节点有 attached_file → 系统工具打开;否则编辑
          const nodeId = (tpc as any).nodeObj?.id || tpc.getAttribute("data-nodeid");
          const store = useMindMapStore.getState();
          const filePath = store.filePath;
          const findAttached = (n: any): any => {
            if (n.id === nodeId) return n.attached_file;
            for (const c of n.children || []) {
              const r = findAttached(c);
              if (r) return r;
            }
            return null;
          };
          const attached = store.content ? findAttached(store.content.root) : null;
          if (attached && filePath) {
            (window as any).__TAURI_INTERNALS__?.invoke("open_attached_file", {
              mmapPath: filePath, nodeId,
            }).catch((err: any) => console.error("[dblclick 打开附件] 失败", err));
            return;
          }
          editTriggered = true;
          setTimeout(() => { editTriggered = false; }, 600);
          inst.selectNode(tpc);
          inst.beginEdit(tpc);
        } catch (err) {
          console.error("[fallback dblclick] 失败", err);
        }
      };

      onFallbackKey = (e: KeyboardEvent) => {
        const ae = document.activeElement;
        // 编辑模式（input-box / contenteditable）不拦截
        if (ae && (ae as HTMLElement).isContentEditable) return;

        // 只在画布区域拦截（焦点在 map-container / me-tpc / inner 内）
        // 否则 Tab 会跳到侧边栏等其他 focusable 元素
        const inCanvas = ae instanceof HTMLElement
          ? !!ae.closest(".mind-elixir-inner, .map-container, me-tpc, me-root, me-main, me-parent, me-wrapper")
          : false;
        if (!inCanvas) return;

        const inst = instanceRef.current;
        if (!inst) return;

        // 画布内的这些键始终拦截（防止焦点跳走）
        // Cmd+F 搜索
        if (e.metaKey && e.key === "f") {
          e.preventDefault();
          const si = document.querySelector("#search-input") as HTMLElement | null;
          if (si) si.focus();
          return;
        }

        // Cmd+Shift+L 自动布局（整理）
        if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "l") {
          e.preventDefault();
          const inst = instanceRef.current;
          if (inst?.layout) {
            try {
              inst.layout();
              if (inst.toCenter) inst.toCenter();
            } catch (err) {
              console.error("[auto-layout] 失败", err);
            }
          }
          return;
        }

        const interceptKeys = ["Tab", "Enter", "F2", "Delete", "Backspace", "."];
        if (!interceptKeys.includes(e.key)) return;
        e.preventDefault();

        const selected = getSelected();
        if (!selected) return;

        const isRoot = selected.tagName === "ME-ROOT";
        let opChanged = false;
        try {
          switch (e.key) {
            case "Tab":
              inst.addChild(selected);
              opChanged = true;
              setTimeout(() => {
                const ib = document.querySelector("#input-box") as HTMLElement | null;
                if (ib) ib.blur();
                // 关键：blur 后恢复焦点到 map-container，否则焦点丢到 body，
                // 后续 Tab/Enter/F2 检查 inCanvas 失败 → 不处理
                const mc = document.querySelector(".map-container") as HTMLElement | null;
                if (mc) mc.focus();
              }, 50);
              break;
            case "Enter":
              if (!isRoot) {
                inst.insertSibling("after", selected);
                opChanged = true;
                setTimeout(() => {
                  const ib = document.querySelector("#input-box") as HTMLElement | null;
                  if (ib) ib.blur();
                  const mc = document.querySelector(".map-container") as HTMLElement | null;
                  if (mc) mc.focus();
                }, 50);
              }
              break;
            case "F2":
              inst.beginEdit(selected);
              break;
            case "Delete":
            case "Backspace":
              if (!isRoot) {
                inst.removeNodes(inst.currentNodes || [selected]);
                opChanged = true;
              }
              break;
            case ".":
              if (e.metaKey && inst.expandNode) {
                inst.expandNode(selected);
                opChanged = true;
              }
              break;
          }
        } catch (err) {
          console.error("[fallback keydown] 失败", err);
        }
        if (opChanged) {
          setTimeout(() => { syncFromMindElixir(); }, 200);
        }
      };

      // 关键：keydown 绑 document 而非 inner。
      // 真实用户 click 节点后，焦点落在 map-container（不是 inner），
      // 绑在 inner 上时 Tab/Enter 事件到不了。
      // click/dblclick 仍绑 inner（事件冒泡能到，且能过滤非画布点击）。
      inner.addEventListener("click", onFallbackClick);
      inner.addEventListener("dblclick", onFallbackDblClick);
      document.addEventListener("keydown", onFallbackKey);

      // === Fallback 拖动改层级 ===
      // mind-elixir 5.14 内置 drag 不工作（Nt noop），但 moveNode API 可用。
      // 自己绑 mousedown/mousemove/mouseup 实现吸附式拖动。
      let dragState: {
        source: HTMLElement;
        startX: number;
        startY: number;
        isDragging: boolean;
        ghost: HTMLElement | null;
      } | null = null;

      const isDescendant = (node: any, targetId: string): boolean => {
        if (!node || !targetId) return false;
        if (node.id === targetId) return true;
        const children = node.children ?? [];
        for (const c of children) {
          if (isDescendant(c, targetId)) return true;
        }
        return false;
      };

      // 收集节点及其所有子节点的文字（用于 ghost 预览）
      const collectSubtreeTexts = (nodeObj: any, depth = 0): string[] => {
        const texts = [`${"  ".repeat(depth)}${nodeObj.topic || "?"}`];
        for (const c of nodeObj.children ?? []) {
          texts.push(...collectSubtreeTexts(c, depth + 1));
        }
        return texts;
      };

      const createGhost = (source: HTMLElement): HTMLElement => {
        const nodeObj = (source as any).nodeObj;
        const texts = nodeObj ? collectSubtreeTexts(nodeObj) : [source.textContent || "?"];

        const ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.innerHTML = texts
          .map((t, i) => `<div style="padding-left:${i === 0 ? 0 : 12}px;${i === 0 ? "font-weight:600;" : "opacity:0.7;"}">${t}</div>`)
          .join("");
        ghost.style.cssText =
          "position:fixed;z-index:9999;pointer-events:none;" +
          "background:rgba(255,255,255,0.95);border:1px solid #4dc4ff;border-radius:6px;" +
          "padding:6px 10px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.15);" +
          "max-width:200px;overflow:hidden;white-space:nowrap;";
        document.body.appendChild(ghost);
        return ghost;
      };

      const removeGhost = () => {
        const g = document.querySelector(".drag-ghost");
        if (g) g.remove();
      };

      onDragStart = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const tpc = getMeTpc(e.target);
        if (!tpc) return;
        if (tpc.closest("me-root")) return;
        dragState = {
          source: tpc,
          startX: e.clientX,
          startY: e.clientY,
          isDragging: false,
          ghost: null,
        };
      };

      onDragMove = (e: MouseEvent) => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
          dragState.isDragging = true;
          inner.style.cursor = "grabbing";
          // 创建 ghost 预览
          dragState.ghost = createGhost(dragState.source);
          // 原节点变半透明（暗示正在拖动）
          dragState.source.style.opacity = "0.3";
        }
        if (!dragState.isDragging) return;

        // 更新 ghost 位置
        if (dragState.ghost) {
          dragState.ghost.style.left = e.clientX + 12 + "px";
          dragState.ghost.style.top = e.clientY + 12 + "px";
        }

        // 清除之前的高亮
        inner.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));

        // 检测目标节点（用 elementFromPoint 避免 me-parent 拦截）
        // 临时隐藏 ghost 否则 elementFromPoint 返回 ghost
        if (dragState.ghost) dragState.ghost.style.display = "none";
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (dragState.ghost) dragState.ghost.style.display = "";

        const target = el ? getMeTpc(el as HTMLElement) : null;
        if (target && target !== dragState.source) {
          const sourceNodeObj = (dragState.source as any).nodeObj;
          const targetId = (target as any).nodeObj?.id;
          if (sourceNodeObj && isDescendant(sourceNodeObj, targetId)) {
            return; // 目标是源的子孙
          }
          target.classList.add("drag-over");
        }
      };

      onDragEnd = (e: MouseEvent) => {
        if (!dragState) return;
        inner.style.cursor = "";

        // 恢复源节点透明度
        dragState.source.style.opacity = "";

        // 移除 ghost
        removeGhost();
        inner.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));

        if (!dragState.isDragging) {
          dragState = null;
          return;
        }

        // 用 elementFromPoint 找目标（mouseup 的 target 在 WebKit 下可能不准）
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const target = el ? getMeTpc(el as HTMLElement) : null;

        if (target && target !== dragState.source) {
          const inst = instanceRef.current;
          try {
            const r = target.getBoundingClientRect();
            const relY = (e.clientY - r.top) / r.height;
            const sourceTpc = dragState.source;

            const sourceNodeObj = (sourceTpc as any).nodeObj;
            const targetId = (target as any).nodeObj?.id;
            if (sourceNodeObj && isDescendant(sourceNodeObj, targetId)) {
              dragState = null;
              return;
            }

            // 记录操作前 nodeData 用于诊断
            const beforeNodeData = JSON.stringify(inst.nodeData, (k,v) => k==='parent' ? undefined : v);

            if (relY < 0.25) {
              inst.moveNodeBefore([sourceTpc], target);
            } else if (relY > 0.75) {
              inst.moveNodeAfter([sourceTpc], target);
            } else {
              inst.moveNodeIn([sourceTpc], target);
            }

            const afterNodeData = JSON.stringify(inst.nodeData, (k,v) => k==='parent' ? undefined : v);

            // 如果 nodeData 没变化，说明 moveNode 失败（可能 API bug）
            if (beforeNodeData === afterNodeData) {
              console.warn("[drag] moveNode 未改变 nodeData——操作无效");
            }

            setTimeout(() => { syncFromMindElixir(); }, 200);
          } catch (err) {
            console.error("[fallback drag] 失败", err);
          }
        }
        dragState = null;
      };

      inner.addEventListener("mousedown", onDragStart);
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);

      // === 右键上下文菜单 ===
      let contextMenuEl: HTMLDivElement | null = null;

      const removeContextMenu = () => {
        if (contextMenuEl) {
          contextMenuEl.remove();
          contextMenuEl = null;
        }
      };

      onContextMenu = (e: MouseEvent) => {
        const tpc = getMeTpc(e.target);
        if (!tpc) return; // 没点节点，让浏览器默认菜单
        e.preventDefault();

        const inst = instanceRef.current;
        if (!inst) return;
        removeContextMenu();

        // 先选中
        try { inst.selectNode(tpc); } catch {}
        const nodeId = (tpc as any).nodeObj?.id;
        if (nodeId) setSelectedNodeId(nodeId);

        const isRoot = !!tpc.closest("me-root");

        const menu = document.createElement("div");
        menu.className = "ctx-menu";

        const addDivider = () => {
          const d = document.createElement("div");
          d.className = "ctx-menu-divider";
          menu.appendChild(d);
        };

        type MenuItem = { label: string; disabled?: boolean; action: () => void };
        const addItem = (item: MenuItem) => {
          const btn = document.createElement("div");
          btn.className = "ctx-menu-item" + (item.disabled ? " ctx-disabled" : "");
          btn.textContent = item.label;
          if (!item.disabled) {
            btn.addEventListener("click", () => {
              try { item.action(); } catch (err) { console.error("[ctx-menu]", err); }
              removeContextMenu();
            });
          }
          menu.appendChild(btn);
        };

        addItem({
          label: "📝 添加子节点",
          action: async () => {
            await inst.addChild(tpc);
            setTimeout(() => {
              const ib = document.querySelector("#input-box") as HTMLElement | null;
              if (ib) ib.blur();
              const mc = document.querySelector(".map-container") as HTMLElement | null;
              if (mc) mc.focus();
              syncFromMindElixir();
            }, 50);
          },
        });
        addItem({
          label: "➕ 添加兄弟节点",
          disabled: isRoot,
          action: async () => {
            if (isRoot) return;
            await inst.insertSibling("after", tpc);
            setTimeout(() => {
              const ib = document.querySelector("#input-box") as HTMLElement | null;
              if (ib) ib.blur();
              const mc = document.querySelector(".map-container") as HTMLElement | null;
              if (mc) mc.focus();
              syncFromMindElixir();
            }, 50);
          },
        });
        addItem({
          label: "✏️ 编辑节点 (F2)",
          action: () => inst.beginEdit(tpc),
        });
        addDivider();
        addItem({
          label: "🗑 删除节点",
          disabled: isRoot,
          action: () => {
            if (isRoot) return;
            inst.removeNodes([tpc]);
            setTimeout(() => { syncFromMindElixir(); }, 200);
          },
        });

        // === 附件相关菜单项(仅当节点有 attached_file) ===
        const store0 = useMindMapStore.getState();
        const filePath = store0.filePath;
        const findAttached = (n: any): any => {
          if (n.id === nodeId) return n.attached_file;
          for (const c of n.children || []) {
            const r = findAttached(c);
            if (r) return r;
          }
          return null;
        };
        const attached = store0.content && nodeId ? findAttached(store0.content.root) : null;
        if (attached && filePath) {
          addDivider();
          addItem({
            label: "📂 打开(系统工具)",
            action: () => {
              (window as any).__TAURI_INTERNALS__?.invoke("open_attached_file", {
                mmapPath: filePath, nodeId,
              }).catch((err: any) => console.error("[打开附件]", err));
            },
          });
          addItem({
            label: "🔍 在 Finder 中显示",
            action: () => {
              (window as any).__TAURI_INTERNALS__?.invoke("reveal_attached_file", {
                mmapPath: filePath, nodeId,
              }).catch((err: any) => console.error("[Finder 显示]", err));
            },
          });
          addItem({
            label: "🔄 替换附件...",
            action: async () => {
              try {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const sel = await open({ multiple: false });
                if (typeof sel !== "string" || !sel) return;
                await (window as any).__TAURI_INTERNALS__?.invoke("replace_attached_file", {
                  mmapPath: filePath, nodeId, newSrc: sel,
                });
                // 触发 store 更新(通过 syncAttachedFiles 重渲染)
                setTimeout(() => { (window as any).__syncAttachedFiles?.(); }, 100);
              } catch (err) {
                console.error("[替换附件]", err);
              }
            },
          });
          addItem({
            label: "❌ 移除附件",
            action: async () => {
              try {
                await (window as any).__TAURI_INTERNALS__?.invoke("remove_attached_file", {
                  mmapPath: filePath, nodeId,
                });
                setTimeout(() => { (window as any).__syncAttachedFiles?.(); }, 100);
              } catch (err) {
                console.error("[移除附件]", err);
              }
            },
          });
        }

        // 定位（防止超出视口）
        const x = Math.min(e.clientX, window.innerWidth - 200);
        const y = Math.min(e.clientY, window.innerHeight - 200);
        menu.style.left = x + "px";
        menu.style.top = y + "px";
        document.body.appendChild(menu);
        contextMenuEl = menu;
      };

      // 点击其他地方关闭菜单
      onDocClickCloseMenu = (e: MouseEvent) => {
        if (contextMenuEl && !contextMenuEl.contains(e.target as Node)) {
          removeContextMenu();
        }
      };

      inner.addEventListener("contextmenu", onContextMenu);
      document.addEventListener("click", onDocClickCloseMenu);
      contextMenuCleanup = removeContextMenu;
    }

    return () => {
      if (inner) {
        if (onFallbackClick) inner.removeEventListener("click", onFallbackClick);
        if (onFallbackDblClick) inner.removeEventListener("dblclick", onFallbackDblClick);
        if (onDragStart) inner.removeEventListener("mousedown", onDragStart);
        if (onContextMenu) inner.removeEventListener("contextmenu", onContextMenu);
      }
      if (onFallbackKey) document.removeEventListener("keydown", onFallbackKey);
      if (onDragMove) document.removeEventListener("mousemove", onDragMove);
      if (onDragEnd) document.removeEventListener("mouseup", onDragEnd);
      if (onDocClickCloseMenu) document.removeEventListener("click", onDocClickCloseMenu);
      if (contextMenuCleanup) contextMenuCleanup();
      try {
        mind.destroy();
      } catch (e) {
        console.error("[mind-elixir] destroy 失败", e);
      }
      instanceRef.current = null;
      setMindInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拖拽/粘贴图片到画布时，给选中节点添加图片
  useEffect(() => {
    const wrap = containerRef.current;
    if (!wrap) return;

    const onDrop = async (e: DragEvent) => {
      if (!hasImageInDataTransfer(e)) return;
      e.preventDefault();
      const file = getImageFromDataTransfer(e);
      if (!file) return;
      const state = useMindMapStore.getState();
      if (!state.content || !state.selectedNodeId) return;
      try {
        const processed = await processImageFile(file);
        state.updateSelectedNode({
          image: {
            path: processed.dataUrl,
            width: processed.width,
            height: processed.height,
          },
        });
      } catch (err) {
        console.error("[MindMapCanvas] 图片处理失败", err);
        alert("图片添加失败: " + err);
      }
    };

    const onDragOver = (e: DragEvent) => {
      if (hasImageInDataTransfer(e)) {
        e.preventDefault();
      }
    };

    const onPaste = async (e: ClipboardEvent) => {
      const state = useMindMapStore.getState();
      if (!state.content || !state.selectedNodeId) return;
      const file = getImageFromClipboard(e);
      if (!file) return;
      e.preventDefault();
      try {
        const processed = await processImageFile(file);
        state.updateSelectedNode({
          image: {
            path: processed.dataUrl,
            width: processed.width,
            height: processed.height,
          },
        });
      } catch (err) {
        console.error("[MindMapCanvas] 粘贴图片失败", err);
      }
    };

    wrap.addEventListener("drop", onDrop);
    wrap.addEventListener("dragover", onDragOver);
    wrap.addEventListener("paste", onPaste);
    return () => {
      wrap.removeEventListener("drop", onDrop);
      wrap.removeEventListener("dragover", onDragOver);
      wrap.removeEventListener("paste", onPaste);
    };
  }, []);

  // content.root.id 变化时（如切换文档、新建），重新 init mind-elixir
  // 注意：不要清空 containerRef.innerHTML —— mind-elixir 的 init 内部会自己处理 DOM，
  // 外部清空会破坏其对内部节点（map-container/lines/etc.）的引用，导致后续渲染失败。
  useEffect(() => {
    if (!instanceRef.current || !content) return;
    const data = toMindElixirData(content);
    try {
      instanceRef.current.init(data);
    } catch (e) {
      console.error("[MindMapCanvas] re-init failed:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.root.id]);

  // store→mind 反向同步：撤销/重做后 needStoreToMindSync=true
  // 用 store.content 覆盖 mind-elixir 数据（mind.refresh 轻量更新）
  useEffect(() => {
    if (!needSync || !instanceRef.current || !content) return;
    try {
      const data = toMindElixirData(content);
      instanceRef.current.refresh(data);
      // 同步 selectedNodeId
      const sel = instanceRef.current.currentNodes?.[0];
      if (sel?.nodeObj?.id) {
        setSelectedNodeId(sel.nodeObj.id);
      }
    } catch (e) {
      console.error("[store→mind sync] refresh 失败", e);
    }
    useMindMapStore.setState({ needStoreToMindSync: false });
    // 撤销/重做后恢复优先级边框 + 沙漏
    setTimeout(() => {
      const inst = instanceRef.current;
      const state = useMindMapStore.getState();
      if (!inst || !state.content) return;
      const walk = (node: any) => {
        const tpc = typeof inst.findEle === "function" ? inst.findEle(node.id) : null;
        if (tpc) {
          tpc.classList.remove("priority-p0", "priority-p1", "priority-p2", "priority-p3");
          if (node.priority) {
            tpc.classList.add(`priority-${node.priority.toLowerCase()}`);
          }
        }
        for (const c of node.children || []) walk(c);
      };
      walk(state.content.root);
      // 沙漏也需要重绘
      syncHourglassesExternal(inst, state);
    }, 100);
  }, [needSync]);

  // 全局 reminders 变化时,重绘画布沙漏
  // 暴露 __syncHourglasses 到 window,store.setAllReminders 在更新后直接调用(避免 React 渲染周期时序问题)
  useEffect(() => {
    (window as any).__syncHourglasses = () => {
      const inst = instanceRef.current;
      const state = useMindMapStore.getState();
      if (!inst || !state.content) return 0;
      syncHourglassesExternal(inst, state);
      return document.querySelectorAll(".hourglass-wrapper").length;
    };
    (window as any).__syncAttachedFiles = () => {
      const inst = instanceRef.current;
      const state = useMindMapStore.getState();
      if (!inst || !state.content) return 0;
      syncAttachedFiles(inst, state);
      return document.querySelectorAll(".attached-render").length;
    };
    // 居中跳转到指定节点(供 ReminderToast 调用)
    // 直接操作 mapCanvas 的 transform,把目标节点的中心对齐到容器中心
    (window as any).__centerNode = (nodeId: string): boolean => {
      const inst = instanceRef.current;
      if (!inst) return false;
      try {
        const tpc = typeof inst.findEle === "function" ? inst.findEle(nodeId) : null;
        if (!tpc) return false;
        // 先选中(高亮)
        try { inst.selectNode(tpc); } catch {}
        const inner = containerRef.current;
        const mapCanvas = inner?.querySelector(".map-canvas") as HTMLElement | null;
        if (!inner || !mapCanvas) return false;
        const innerRect = inner.getBoundingClientRect();
        const nodeRect = tpc.getBoundingClientRect();
        // 目标:把 nodeRect 中心对齐到 innerRect 中心
        const dx = (innerRect.x + innerRect.width / 2) - (nodeRect.x + nodeRect.width / 2);
        const dy = (innerRect.y + innerRect.height / 2) - (nodeRect.y + nodeRect.height / 2);
        if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return true;
        // 用 getComputedStyle 解析 transform matrix(更稳健,不依赖字符串格式)
        // mind-elixir 可能用 translate3d / matrix3d / 等多种格式
        const ts = window.getComputedStyle(mapCanvas).transform;
        let curX = 0, curY = 0, scale = 1;
        if (ts && ts !== "none") {
          const m = new DOMMatrix(ts);
          curX = m.e;  // translate X
          curY = m.f;  // translate Y
          scale = m.a;  // scale X (= m11)
        }
        // 保持当前 scale(用户主动调的缩放不应被覆盖)
        mapCanvas.style.transform = `translate3d(${curX + dx}px, ${curY + dy}px, 0px) scale(${scale})`;
        return true;
      } catch (e) {
        console.error("[MindMapCanvas] centerNode 失败", e);
        return false;
      }
    };
    // mount 时立即跑一次(mind-elixir 已就绪的情况下)
    const inst0 = instanceRef.current;
    const state0 = useMindMapStore.getState();
    if (inst0 && state0.content) {
      syncHourglassesExternal(inst0, state0);
      syncAttachedFiles(inst0, state0);
    }
    return () => {
      delete (window as any).__syncHourglasses;
      delete (window as any).__syncAttachedFiles;
      delete (window as any).__centerNode;
    };
  }, []);

  // 明暗主题：给 .mind-elixir-inner 加/去 dark-theme class
  useEffect(() => {
    const inner = containerRef.current;
    if (!inner) return;
    const isDark = theme === "dark";
    if (isDark) {
      inner.classList.add("dark-theme");
    } else {
      inner.classList.remove("dark-theme");
    }
  }, [theme]);

  return (
    <div className="canvas-container">
      <div className="mind-elixir-wrap">
        <div className="mind-elixir-inner" ref={containerRef} />
      </div>
      {!content && (
        <div className="canvas-empty">
          <div className="empty-icon">🧠</div>
          <p>暂未打开任何思维导图</p>
          <p className="empty-hint">点击菜单 文件 → 新建 或 打开 开始</p>
        </div>
      )}
    </div>
  );
}
