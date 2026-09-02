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
import { computeDropZone, computePlaceholderRectFromActual, computeSiblingShift, buildConnectionLinePath, executeDrop, type DropZone } from "../utils/dragDrop";
import { isEditingSession, shouldBlockDefaultDrag, shouldReSelectAfterDrop } from "../utils/editGuard";
import { log, logMindElixir } from "../utils/devLogger";
import {
  centerNodeInContainer,
  snapshotAnchor,
  keepAnchorInPlace,
  shouldSwallowNavKeyOutsideCanvas,
} from "../utils/canvasActions";
import { showAlert } from "./GlassDialog";
import {
  syncHourglassesExternal,
  syncPriorityStylesExternal,
  syncAttachedFiles,
} from "../utils/nodeBadges";
import { describeFocusTarget } from "../utils/focusDebug";
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
        logMindElixir("mind.exposed-window");
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
    // ★ 诊断插桩:焦点翻转监听(声明提级,cleanup 需要)
    let onFocusInProbe: (() => void) | null = null;
    let onFocusOutProbe: (() => void) | null = null;
    // ★ 预防性焦点加固:input-box 销毁归焦(声明提级,cleanup 需要)
    let onInputBoxFocusOut: ((e: FocusEvent) => void) | null = null;

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
        // ★ 修复(选择残留):兜底 — 点击非编辑框目标时显式结束悬挂的编辑会话。
        // mind-elixir 的 input-box 只由 blur 驱动销毁;焦点未转移的边缘路径下它会
        // 永久悬挂在原节点位置(视觉上等同"选中不释放")。blur 触发其收尾:
        // 恢复节点显示 + 销毁编辑框 + fire finishEdit。
        const active = document.activeElement as HTMLElement | null;
        if (
          isEditingSession(active) &&
          !(e.target instanceof Node && active.contains(e.target))
        ) {
          active.blur();
        }
        // ★ 预防性焦点加固(Tab/Enter 失效防御):
        // 浏览器规则:点击不可聚焦元素(me-tpc 等 div)不改变 activeElement —
        // 焦点会停留在上次交互的控件(工具栏按钮/侧栏/搜索框)上,导致
        // onFallbackKey 的 inCanvas 守卫放行 Tab/Enter → 快捷键失效。
        // 画布内点击 = "我要操作画布"的强意图,统一归还焦点到 map-container。
        if (e.target instanceof Node && inner.contains(e.target)) {
          const aeNow = document.activeElement as HTMLElement | null;
          if (!aeNow || !aeNow.closest(".mind-elixir-inner")) {
            const mc = inner.querySelector(".map-container") as HTMLElement | null;
            if (mc) mc.focus({ preventScroll: true });
          }
        }
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
        // ★ 诊断插桩:Tab/Enter/F2 失效根因取证(纯观测,不改行为;仅 dev 生效)
        const dbgKey = import.meta.env.DEV && ["Tab", "Enter", "F2"].includes(e.key);
        if (dbgKey) {
          log({
            cat: "mind-elixir", op: "kbd.probe",
            payload: {
              key: e.key,
              ae: describeFocusTarget(ae),
              editable: !!(ae as HTMLElement | null)?.isContentEditable,
              inCanvas: !!(ae instanceof HTMLElement && ae.closest(".mind-elixir-inner, .map-container, me-tpc, me-root, me-main, me-parent, me-wrapper")),
              selected: !!inner.querySelector("me-tpc.selected"),
              currentNodesLen: Array.isArray(instanceRef.current?.currentNodes)
                ? instanceRef.current.currentNodes.length
                : -1,
            },
          });
        }
        // 编辑模式（input-box / contenteditable）不拦截
        if (ae && (ae as HTMLElement).isContentEditable) {
          if (dbgKey) log({ cat: "mind-elixir", op: "kbd.skip-editing", payload: { key: e.key, ae: describeFocusTarget(ae) } });
          return;
        }

        // 只在画布区域拦截（焦点在 map-container / me-tpc / inner 内）
        // 否则 Tab 会跳到侧边栏等其他 focusable 元素
        const inCanvas = ae instanceof HTMLElement
          ? !!ae.closest(".mind-elixir-inner, .map-container, me-tpc, me-root, me-main, me-parent, me-wrapper")
          : false;
        if (!inCanvas) {
          if (dbgKey) log({ cat: "mind-elixir", op: "kbd.skip-not-in-canvas", payload: { key: e.key, ae: describeFocusTarget(ae) } });
          // ★ 视图主权(无选中 Tab 丢视图 bug 根因):焦点不在画布时裸 Tab/Enter
          // 若放行给浏览器,焦点环落焦画布容器会触发 scrollIntoView → 视图被
          // 浏览器移动("画布找不到节点")。吞掉(输入类控件除外,编辑语义放行)。
          if (shouldSwallowNavKeyOutsideCanvas(e as any, ae)) {
            e.preventDefault();
          }
          return;
        }

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
        if (!selected) {
          if (dbgKey) log({ cat: "mind-elixir", op: "kbd.skip-no-selected", payload: { key: e.key } });
          return;
        }

        const isRoot = selected.tagName === "ME-ROOT";
        if (dbgKey) log({ cat: "mind-elixir", op: "kbd.handled", payload: { key: e.key, isRoot } });
        let opChanged = false;
        try {
          switch (e.key) {
            case "Tab": {
              // ★ 视图主权公理:创建前快照锚点(选中节点)视口位置
              const anchor = snapshotAnchor(selected as HTMLElement);
              inst.addChild(selected);
              opChanged = true;
              setTimeout(() => {
                const ib = document.querySelector("#input-box") as HTMLElement | null;
                if (ib) ib.blur();
                // 关键：blur 后恢复焦点到 map-container，否则焦点丢到 body，
                // 后续 Tab/Enter/F2 检查 inCanvas 失败 → 不处理
                const mc = document.querySelector(".map-container") as HTMLElement | null;
                if (mc) {
                  mc.focus({ preventScroll: true });
                  if (import.meta.env.DEV) log({ cat: "state", op: "focus.restore", payload: { key: "Tab", ok: document.activeElement === mc } });
                }
                // ★ 根因修复(5.14 layout 推飞):树深≥3 时 addChild 触发
                // layout 全树重排(锚点实测 x 238→-57,且经 .map-canvas 的
                // 0.3s transition 渐进飞出)。keepAnchorInPlace:冻结动画→
                // 反向平移恰好抵消→复检→解冻 → 画布纹丝不动,新节点自然
                // 出现在锚点旁(与树浅时行为逐像素一致)。
                keepAnchorInPlace(inst, inner, anchor);
              }, 60);
              break;
            }
            case "Enter":
              if (!isRoot) {
                // ★ 视图主权:同 Tab — 创建前快照,创建后抵消推飞
                const anchor = snapshotAnchor(selected as HTMLElement);
                inst.insertSibling("after", selected);
                opChanged = true;
                setTimeout(() => {
                  const ib = document.querySelector("#input-box") as HTMLElement | null;
                  if (ib) ib.blur();
                  const mc = document.querySelector(".map-container") as HTMLElement | null;
                  if (mc) {
                    mc.focus({ preventScroll: true });
                    if (import.meta.env.DEV) log({ cat: "state", op: "focus.restore", payload: { key: "Enter", ok: document.activeElement === mc } });
                  }
                  keepAnchorInPlace(inst, inner, anchor);
                }, 60);
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

      // ★ 预防性焦点加固:编辑框(#input-box)销毁时焦点回落 body →
      // 随后 Tab/Enter 因 inCanvas=false 失效。focusout 且 relatedTarget
      // 为空(元素被移除的特征)时归还画布。点击侧栏等场景 relatedTarget
      // 非空,不受影响。
      onInputBoxFocusOut = (ev: FocusEvent) => {
        const t = ev.target as HTMLElement | null;
        if (t?.id !== "input-box" || ev.relatedTarget) return;
        const mc = inner.querySelector(".map-container") as HTMLElement | null;
        if (mc) mc.focus({ preventScroll: true });
      };
      document.addEventListener("focusout", onInputBoxFocusOut);

      // ★ 诊断插桩:焦点进出画布的翻转轨迹(降噪:只记翻转;仅 dev 注册,生产零开销)
      if (import.meta.env.DEV) {
        let lastFocusInCanvas: boolean | null = null;
        const checkFocusFlip = (why: string) => {
          const a = document.activeElement as HTMLElement | null;
          const inC = !!a?.closest(".mind-elixir-inner");
          if (inC !== lastFocusInCanvas) {
            lastFocusInCanvas = inC;
            log({ cat: "state", op: "focus.flip", payload: { why, inCanvas: inC, ae: describeFocusTarget(a) } });
          }
        };
        onFocusInProbe = () => checkFocusFlip("focusin");
        onFocusOutProbe = () => setTimeout(() => checkFocusFlip("focusout"), 0);
        document.addEventListener("focusin", onFocusInProbe);
        document.addEventListener("focusout", onFocusOutProbe);
      }

      // === Fallback 拖动改层级(方案 N:source 高亮 + 占位框 + 兄弟让位 + 阈值 0.15)===
      // mind-elixir 5.14 内置 drag 不工作（Nt noop），但 moveNode API 可用。
      // 自己绑 mousedown/mousemove/mouseup 实现吸附式拖动。
      // 方案 N:移除 ghost 浮窗 + source 加亮色边框/发光(替代 opacity)+ 占位框
      //        + 兄弟让位 transform。让用户看清"选中的是哪个"+"会落在哪"+"兄弟让位"。
      let dragState: {
        source: HTMLElement;
        startX: number;
        startY: number;
        isDragging: boolean;
        // ★ 方案 R:source DOM 不动,用 placeholder overlay 显示预览位置
        overlay: {
          placeholder: HTMLDivElement;
          svg: SVGSVGElement;
          line: SVGPathElement;
        } | null;
        currentTarget: HTMLElement | null;
        currentZone: DropZone | null;
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

      // === 方案 R:source 不动 + placeholder 占位 + sibling translateY + SVG 连接虚线 ===
      // 关键不变量:source DOM 位置不变(留原位高亮),所有视觉预览通过独立 overlay 元素。
      // 这符合 HTML5 drag-and-drop + 主流库(dnd-kit/react-dnd)的设计原则。
      // 解决了方案 Q 的 5 处病灶(反馈循环 / 自指 / 没选中 / 落点不准 / transition 冲突)。
      const createDragOverlay = () => {
        // placeholder 占位框(B 的化身:蓝色虚线方框 + 同 B 尺寸)
        const placeholder = document.createElement("div");
        placeholder.className = "drag-placeholder-r";
        placeholder.style.display = "none";
        inner.appendChild(placeholder);

        // SVG 连接虚线 overlay(A → placeholder)
        const svgNS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNS, "svg") as SVGSVGElement;
        svg.classList.add("drag-connection-svg");
        const line = document.createElementNS(svgNS, "path") as SVGPathElement;
        line.setAttribute("stroke", "#4dc4ff");
        line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-dasharray", "6 4");
        line.setAttribute("fill", "none");
        line.setAttribute("opacity", "0.85");
        line.setAttribute("d", "");
        svg.appendChild(line);
        inner.appendChild(svg);

        // 淡化 mind-elixir 内置连接线(避免旧实线 + 新虚线并存)
        inner.classList.add("dragging");
        return { placeholder, svg, line };
      };

      // 找 source 的父节点 A(用于绘制 A→source 连接虚线)
      // DOM 结构:me-wrapper > me-parent(第一个,父节点) > me-tpc(父节点本身)
      const findParentTpc = (source: HTMLElement): HTMLElement | null => {
        const wrapper = source.closest("me-wrapper");
        if (!wrapper) return null;
        const parentWrapper = wrapper.querySelector(":scope > me-parent");
        return (parentWrapper?.querySelector("me-tpc") as HTMLElement) || null;
      };

      // 找受影响的兄弟节点(source 自身和 target 不在结果中,根据 zone 决定 target 是否包含)
      const findShiftedSiblings = (
        source: HTMLElement,
        target: HTMLElement,
        zone: DropZone,
      ): HTMLElement[] => {
        if (zone === "inside") return [];
        const parent = target.parentElement;
        if (!parent) return [];
        const siblings = Array.from(parent.children) as HTMLElement[];
        const targetIdx = siblings.indexOf(target);
        if (targetIdx < 0) return [];

        const result: HTMLElement[] = [];
        for (let i = 0; i < siblings.length; i++) {
          if (siblings[i] === source) continue; // source 自身 transform 移走,不让位
          if (i === targetIdx) {
            if (zone === "before") result.push(siblings[i]);
            continue;
          }
          if (zone === "before" && i >= targetIdx) {
            result.push(siblings[i]);
          } else if (zone === "after" && i > targetIdx) {
            result.push(siblings[i]);
          }
        }
        return result;
      };

      const clearSiblingShift = () => {
        inner.querySelectorAll(".drag-sibling-shift").forEach((el) => {
          const e = el as HTMLElement;
          e.classList.remove("drag-sibling-shift");
          e.style.transform = "";
        });
      };

      const removeDragOverlay = () => {
        inner.querySelectorAll(".drag-connection-svg, .drag-placeholder-r").forEach((el) => el.remove());
        clearSiblingShift();
        inner.classList.remove("dragging");
        inner.querySelectorAll(".drag-source").forEach((el) => {
          (el as HTMLElement).classList.remove("drag-source");
        });
      };

      const updateDragOverlay = () => {
        if (!dragState || !dragState.overlay) return;
        const { placeholder, line } = dragState.overlay;

        // 清除上一帧 sibling shift(source 不动,不清 source transform)
        clearSiblingShift();

        const target = dragState.currentTarget;
        const zone = dragState.currentZone;
        if (!target || !zone) {
          placeholder.style.display = "none";
          line.setAttribute("d", "");
          return;
        }

        // ★ 关键:source DOM 不动,getBoundingClientRect 始终有效(无反馈循环)
        const srcRect = dragState.source.getBoundingClientRect();
        const tgtRect = target.getBoundingClientRect();
        const innerRect = inner.getBoundingClientRect();
        const srcRectArg = {
          left: srcRect.left,
          top: srcRect.top,
          width: srcRect.width,
          height: srcRect.height,
        };
        const tgtRectArg = {
          left: tgtRect.left,
          top: tgtRect.top,
          width: tgtRect.width,
          height: tgtRect.height,
        };

        // ★方案 R 修复(placeholder 位置不准)★
        // 在 applySiblingShift **之前** 找 shiftedSiblings + 测量其原 rect,
        // 然后用实测 rect 计算 placeholder(不用 target.bottom + gap 推算)。
        // 决定性事实:mind-elixir --node-gap-y=10px,跟 DROP_GAP_PX=20 不一致,
        // 推算会让 placeholder 跟 D 实际位置脱节。
        const shiftedSiblings = findShiftedSiblings(dragState.source, target, zone);
        const firstSiblingRect = shiftedSiblings.length > 0
          ? shiftedSiblings[0].getBoundingClientRect()
          : null;
        const firstSiblingRectArg = firstSiblingRect
          ? {
              left: firstSiblingRect.left,
              top: firstSiblingRect.top,
              width: firstSiblingRect.width,
              height: firstSiblingRect.height,
            }
          : null;

        // placeholder 占据实测位置(before=target 当前位 / after=D 原位 / inside=target 右侧)
        const preview = computePlaceholderRectFromActual(
          srcRectArg,
          tgtRectArg,
          firstSiblingRectArg,
          zone,
        );
        placeholder.style.display = "block";
        placeholder.style.left = `${preview.left - innerRect.left}px`;
        placeholder.style.top = `${preview.top - innerRect.top}px`;
        placeholder.style.width = `${preview.width}px`;
        placeholder.style.height = `${preview.height}px`;

        // siblings 让位(translateY)— 在测量 rect 之后,顺序关键
        const shiftDy = computeSiblingShift(srcRectArg, zone);
        for (const el of shiftedSiblings) {
          el.classList.add("drag-sibling-shift");
          el.style.transform = `translateY(${shiftDy}px)`;
        }

        // 绘制 A→placeholder 连接虚线(父节点中心到 placeholder 中心)
        const parentTpc = findParentTpc(dragState.source);
        if (parentTpc) {
          const parentRect = parentTpc.getBoundingClientRect();
          const parentLocal = {
            left: parentRect.left - innerRect.left,
            top: parentRect.top - innerRect.top,
            width: parentRect.width,
            height: parentRect.height,
          };
          const previewLocal = {
            left: preview.left - innerRect.left,
            top: preview.top - innerRect.top,
            width: preview.width,
            height: preview.height,
          };
          line.setAttribute("d", buildConnectionLinePath(parentLocal, previewLocal));
        }
      };

      onDragStart = (e: MouseEvent) => {
        if (e.button !== 0) return;
        const tpc = getMeTpc(e.target);
        if (!tpc) return;
        if (tpc.closest("me-root")) return;
        // ★ 根因修复:阻止浏览器原生 HTML5 drag-and-drop
        // mind-elixir 5.14 的 me-tpc 内部 <img>/<a href> 默认 draggable=true,
        // 即使 CSS 设了 pointer-events: none,浏览器仍会启动 HTML5 drag,
        // 触发 drag image(亮点)+ WKWebView drag state(黑屏)。
        // ★ 修复(选择残留):编辑会话中放行 mousedown 默认行为 —
        // preventDefault 会阻断焦点转移 → input-box 无法 blur → 编辑框悬挂。
        // HTML5 drag 由 dragstart 监听 + draggable=false 双保险继续拦截,黑屏不复发。
        if (shouldBlockDefaultDrag(document.activeElement)) {
          e.preventDefault();
        }
        dragState = {
          source: tpc,
          startX: e.clientX,
          startY: e.clientY,
          isDragging: false,
          overlay: null,
          currentTarget: null,
          currentZone: null,
        };
      };

      // ★ 根因修复:双保险 — 即使 mousedown preventDefault 失败(例如落在文本上),
      // dragstart 监听器仍能强制阻止 HTML5 drag
      const onHtml5DragStart = (e: DragEvent) => {
        e.preventDefault();
      };
      inner.addEventListener("dragstart", onHtml5DragStart as EventListener);

      onDragMove = (e: MouseEvent) => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
          dragState.isDragging = true;
          inner.style.cursor = "grabbing";
          // 方案 N:不加 ghost,source 自身高亮(.drag-source class)
          dragState.source.classList.add("drag-source");
          dragState.overlay = createDragOverlay();
        }
        if (!dragState.isDragging) return;

        const el = document.elementFromPoint(e.clientX, e.clientY);
        const target = el ? getMeTpc(el as HTMLElement) : null;
        if (target && target !== dragState.source) {
          const sourceNodeObj = (dragState.source as any).nodeObj;
          const targetId = (target as any).nodeObj?.id;
          if (sourceNodeObj && isDescendant(sourceNodeObj, targetId)) {
            dragState.currentTarget = null;
            dragState.currentZone = null;
            updateDragOverlay();
            return;
          }
          const targetRect = target.getBoundingClientRect();
          dragState.currentTarget = target;
          dragState.currentZone = computeDropZone(targetRect, e.clientY);
        } else {
          dragState.currentTarget = null;
          dragState.currentZone = null;
        }
        updateDragOverlay();
      };

      onDragEnd = (_e: MouseEvent) => {
        if (!dragState) return;
        inner.style.cursor = "";

        const sourceTpc = dragState.source;
        const sourceId = (sourceTpc as any).nodeObj?.id;
        sourceTpc.classList.remove("drag-source");
        removeDragOverlay();

        // ★ L2 业务流程协调:提取到 executeDrop 纯函数(可测试)
        // 跨边界:dragState → moveNodeInContent(store splice)→ setContent + refresh
        const state = useMindMapStore.getState();
        const inst = instanceRef.current;
        const result = executeDrop(
          dragState as any,
          {
            getContent: () => state.content as any,
            setContent: (c) => state.setContent(c as any),
            refresh: (data) => {
              try {
                inst.refresh(data as any);
              } catch (err) {
                console.error("[drag] refresh 失败", err);
              }
            },
            toMindElixirData: (c) => toMindElixirData(c as any) as any,
          },
        );
        if (!result.ok && result.reason === "illegal_move") {
          console.warn("[drag] moveNodeInContent 拒绝操作(可能是子孙循环或 root)");
        }
        // ★ 方案 R 修复病灶 3:refresh 后 inst 重建 DOM,source 引用失效,
        // 用 sourceId 在新 DOM 中重新找 source 并 selectNode(修复"没选中")
        if (result.ok && sourceId && inst) {
          setTimeout(() => {
            try {
              // ★ 修复(抢选):用户在定时器窗口内已手动选中其他节点时不抢回,
              // 否则用户刚点的节点会被清掉换回拖动源
              const currentId = inst.currentNodes?.[0]?.nodeObj?.id;
              if (!shouldReSelectAfterDrop(currentId, sourceId)) return;
              const newSource = inst.findEle?.(sourceId);
              if (newSource && inst.selectNode) {
                inst.selectNode(newSource);
              }
            } catch (err) {
              console.warn("[drag] selectNode 失败", err);
            }
          }, 250); // 等 refresh 完成
        }
        dragState = null;
      };

      inner.addEventListener("mousedown", onDragStart);
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);

      // ★ 根因修复:给所有 me-tpc 子元素(img/a/text)设 draggable=false
      // mind-elixir 5.14 没有这样做,导致 HTML5 drag 被触发
      // 用 MutationObserver 监听后续新增节点(动态 addChild 时也要设)
      const disableHtml5Drag = (root: Element | Document = document) => {
        root.querySelectorAll?.("me-tpc img, me-tpc a, me-tpc span").forEach((el) => {
          (el as HTMLElement).setAttribute("draggable", "false");
        });
      };
      // 初始一遍(对已存在的节点)
      setTimeout(() => disableHtml5Drag(inner), 100);
      const dragMutationObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              disableHtml5Drag(node as Element);
            }
          });
        }
      });
      dragMutationObserver.observe(inner, { childList: true, subtree: true });

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
          label: "添加子节点",
          action: async () => {
            const anchor = snapshotAnchor(tpc);
            await inst.addChild(tpc);
            setTimeout(() => {
              const ib = document.querySelector("#input-box") as HTMLElement | null;
              if (ib) ib.blur();
              const mc = document.querySelector(".map-container") as HTMLElement | null;
              if (mc) mc.focus({ preventScroll: true });
              // ★ 视图主权:位置保持补偿(冻结动画+抵消推飞,画布纹丝不动)
              keepAnchorInPlace(inst, inner, anchor);
              syncFromMindElixir();
            }, 60);
          },
        });
        addItem({
          label: "添加兄弟节点",
          disabled: isRoot,
          action: async () => {
            if (isRoot) return;
            const anchor = snapshotAnchor(tpc);
            await inst.insertSibling("after", tpc);
            setTimeout(() => {
              const ib = document.querySelector("#input-box") as HTMLElement | null;
              if (ib) ib.blur();
              const mc = document.querySelector(".map-container") as HTMLElement | null;
              if (mc) mc.focus({ preventScroll: true });
              // ★ 视图主权:位置保持补偿(冻结动画+抵消推飞,画布纹丝不动)
              keepAnchorInPlace(inst, inner, anchor);
              syncFromMindElixir();
            }, 60);
          },
        });
        addItem({
          label: "编辑节点 (F2)",
          action: () => inst.beginEdit(tpc),
        });
        addDivider();
        addItem({
          label: "删除节点",
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
            label: "打开(系统工具)",
            action: () => {
              (window as any).__TAURI_INTERNALS__?.invoke("open_attached_file", {
                mmapPath: filePath, nodeId,
              }).catch((err: any) => console.error("[打开附件]", err));
            },
          });
          addItem({
            label: "在 Finder 中显示",
            action: () => {
              (window as any).__TAURI_INTERNALS__?.invoke("reveal_attached_file", {
                mmapPath: filePath, nodeId,
              }).catch((err: any) => console.error("[Finder 显示]", err));
            },
          });
          addItem({
            label: "替换附件...",
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
            label: "移除附件",
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
      if (onInputBoxFocusOut) document.removeEventListener("focusout", onInputBoxFocusOut);
      if (onFocusInProbe) document.removeEventListener("focusin", onFocusInProbe);
      if (onFocusOutProbe) document.removeEventListener("focusout", onFocusOutProbe);
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
        await showAlert("图片添加失败", String(err), "error");
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
    // ★ 诊断插桩:re-init 会替换 map-container(旧的可能持有焦点)
    log({
      cat: "mind-elixir", op: "re-init",
      payload: {
        rootId: content.root.id,
        aeBefore: describeFocusTarget(document.activeElement),
        inCanvasBefore: !!(document.activeElement as HTMLElement)?.closest(".mind-elixir-inner"),
      },
    });
    try {
      instanceRef.current.init(data);
    } catch (e) {
      console.error("[MindMapCanvas] re-init failed:", e);
    }
    // ★ 修复(首开丢优先级):init 重建 DOM 后同步优先级/沙漏/附件三类视觉标记
    setTimeout(() => {
      const inst = instanceRef.current;
      const state = useMindMapStore.getState();
      // re-init 后焦点是否存活(旧 map-container 被替换 → 焦点回落 body?)
      log({
        cat: "state", op: "reinit.focus-check",
        payload: {
          ae: describeFocusTarget(document.activeElement),
          inCanvas: !!(document.activeElement as HTMLElement)?.closest(".mind-elixir-inner"),
        },
      });
      if (!inst || !state.content) return;
      syncPriorityStylesExternal(inst, state);
      syncHourglassesExternal(inst, state);
      syncAttachedFiles(inst, state);
    }, 100);
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
      syncPriorityStylesExternal(inst, state);
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
      // ★ P1 重构:几何补偿逻辑收编 canvasActions.centerNodeInContainer
      const inst = instanceRef.current;
      if (!inst) return false;
      try {
        const tpc = typeof inst.findEle === "function" ? inst.findEle(nodeId) : null;
        if (!tpc) return false;
        try { inst.selectNode(tpc); } catch {}
        return !!(containerRef.current && centerNodeInContainer(tpc, containerRef.current));
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
          <p>暂未打开任何思维导图</p>
          <p className="empty-hint">点击菜单 文件 → 新建 或 打开 开始</p>
        </div>
      )}
    </div>
  );
}
