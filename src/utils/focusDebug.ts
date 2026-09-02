/* ============================================================
   focusDebug — Tab/Enter 失效取证插桩 helper(P2-8 拆分)
   ============================================================ */
// ★ 诊断插桩 helper:焦点目标的紧凑描述(tag#id.class)
// 用于 Tab/Enter 快捷键失效根因取证(纯观测,生产模式 log() 静默)
export function describeFocusTarget(el: Element | null): string {
  if (!el) return "null";
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    el instanceof HTMLElement && el.className
      ? `.${String(el.className).trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  return `${tag}${id}${cls}`;
}
