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
        contextMenu: false, // 禁用内置右键菜单（英文，与 fallback 中文菜单重复）
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
