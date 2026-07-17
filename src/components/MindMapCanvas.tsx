import { useEffect, useRef } from "react";
import MindElixir from "mind-elixir";
// MindElixir.css 在 index.html 用 <link> 注入（package.json exports 限制）
import { logUserAction } from "../utils/devLogger";
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
import "./MindMapCanvas.css";

interface Props {
  onCreateInstance?: (mind: any) => void;
}

export default function MindMapCanvas({ onCreateInstance }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);
  const content = useMindMapStore((s) => s.content);
  const setContent = useMindMapStore((s) => s.setContent);
  const setSelectedNodeId = useMindMapStore((s) => s.setSelectedNodeId);
  const markDirty = useMindMapStore((s) => s.markDirty);

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
        contextMenu: true,
        toolBar: false, // 禁用浮动 toolbar：与 React 工具栏重复 + 5.14 内部 layout 异常（横铺画布、遮挡节点）
        keypress: false, // 禁用 mind-elixir keypress：5.14 Nt() noop bug，事件已在 fallback 中处理
        data,
      } as any);
      mind.init(data);
      instanceRef.current = mind;
      onCreateInstance?.(mind);
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
        // 关键：同步 selectedNodeId 到 mind-elixir 当前选中节点
        // 否则 TabProperties 等组件显示的还是旧选中
        const sel = inst.currentNodes?.[0];
        if (sel?.nodeObj?.id) {
          setSelectedNodeId(sel.nodeObj.id);
        }
      } catch (e) {
        console.error("[mind-elixir sync] 失败", e);
      }
    }

    // === Fallback 事件处理 ===
    // mind-elixir 5.14 内部 Nt() 返回 noop（疑似打包 bug），
    // 导致原生 click/dblclick/keydown 不响应。这里自己绑事件作为兜底。
    const inner = containerRef.current;
    let onFallbackClick: ((e: MouseEvent) => void) | null = null;
    let onFallbackDblClick: ((e: MouseEvent) => void) | null = null;
    let onFallbackKey: ((e: KeyboardEvent) => void) | null = null;

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
            // 双击 → 进入编辑
            editTriggered = true;
            setTimeout(() => { editTriggered = false; }, 600);
            inst.selectNode(tpc);
            inst.beginEdit(tpc);
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
        const interceptKeys = ["Tab", "Enter", "F2", "Delete", "Backspace"];
        if (!interceptKeys.includes(e.key)) return;
        e.preventDefault();  // 关键：先拦截，避免 Tab 跳侧边栏

        const selected = getSelected();
        if (!selected) return;  // 没选中就不做操作（但 Tab 已拦截）

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

      // === 全局事件诊断（capture 阶段，确保在所有 handler 之前收到） ===
      // 诊断 WebKit vs Chromium 事件差异，用 logUserAction 写到 JSONL 文件
      document.addEventListener(
        "click",
        (e) => {
          const target = e.target as HTMLElement;
          const tpc = target?.closest?.("me-tpc");
          logUserAction("diag.click", {
            targetTag: target?.tagName,
            targetClass: target?.className?.toString?.()?.substring(0, 40),
            closestMeTpc: !!tpc,
            closestMeRoot: !!target?.closest?.("me-root"),
            inInner: !!target?.closest?.(".mind-elixir-inner"),
            activeElement: document.activeElement?.tagName,
          });
        },
        true,
      );
      document.addEventListener(
        "keydown",
        (e) => {
          if (["Tab", "Enter", "F2", "Delete", "Backspace"].includes(e.key)) {
            const t = e.target as HTMLElement;
            const ae = document.activeElement as HTMLElement;
            logUserAction("diag.keydown", {
              key: e.key,
              target: t?.tagName,
              activeElement: ae?.tagName,
              activeClass: ae?.className?.substring(0, 40),
              inCanvas: !!ae?.closest?.(".map-container"),
            });
          }
        },
        true,
      );
    }

    return () => {
      if (inner) {
        if (onFallbackClick) inner.removeEventListener("click", onFallbackClick);
        if (onFallbackDblClick) inner.removeEventListener("dblclick", onFallbackDblClick);
      }
      if (onFallbackKey) document.removeEventListener("keydown", onFallbackKey);
      try {
        mind.destroy();
      } catch (e) {
        console.error("[mind-elixir] destroy 失败", e);
      }
      instanceRef.current = null;
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
