// === 编辑会话守卫(选择残留 bug 根因修复,方案 A) ===
// 背景:mind-elixir 的 #input-box(contentEditable)编辑框只由 blur 事件驱动销毁;
// mousedown preventDefault 会阻断浏览器焦点转移 → input-box 永不 blur →
// 编辑框(复刻节点样式 + 焦点环)悬挂在原节点位置,视觉上等同"选中不释放"。

/** 判定当前是否处于 mind-elixir 编辑会话(input-box 持有焦点)。兼作类型守卫。 */
export function isEditingSession(
  activeElement: Element | null,
): activeElement is HTMLElement {
  return activeElement?.id === "input-box";
}

/**
 * mousedown preventDefault 守卫:是否应阻断默认行为(阻止 HTML5 drag)。
 * 编辑会话中放行 —— 让焦点转移正常发生,input-box 得以 blur 销毁;
 * HTML5 drag 由 dragstart 监听 + draggable=false 双保险继续拦截,黑屏不复发。
 */
export function shouldBlockDefaultDrag(activeElement: Element | null): boolean {
  return !isEditingSession(activeElement);
}

/**
 * 拖动后 250ms 重选守卫:用户已在定时器窗口内手动选中其他节点时,
 * 不再抢选(否则用户刚点的节点会被清掉换回拖动源)。
 */
export function shouldReSelectAfterDrop(
  currentSelectedId: string | null | undefined,
  sourceId: string,
): boolean {
  if (currentSelectedId && currentSelectedId !== sourceId) return false;
  return true;
}
