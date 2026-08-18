// === 打开最近文件(系统菜单入口) ===
// 从 Toolbar 下拉迁移而来(F2 单导航:最近文件入口收归系统菜单)。
// 逻辑保持不变:dirty 确认 → 窗口去重(已有则激活) → 记录最近 → 新窗口打开。
// 依赖注入式设计便于单测(invoke/window 列表 mock)。

export interface RecentFileWindowInfo {
  label: string;
  title: string;
}

export interface OpenRecentDeps {
  invoke: (cmd: string, args?: any) => Promise<any>;
  confirmFn?: (msg: string) => boolean;
}

/**
 * 打开最近文件。
 * @returns 打开动作是否执行(false = 用户在 dirty 确认中取消)
 */
export async function openRecentFile(
  path: string,
  dirty: boolean,
  deps: OpenRecentDeps,
): Promise<boolean> {
  const confirmFn = deps.confirmFn ?? ((m: string) => confirm(m));
  if (dirty && !confirmFn("当前文档有未保存的修改,是否继续打开?")) return false;
  const { invoke } = deps;
  const windows = await invoke("list_windows") as RecentFileWindowInfo[];
  const name = path.split("/").pop()?.replace(/\.mmap$/, "") || "未命名";
  const existing = windows.find((w) => w.title.includes(name));
  if (existing) {
    await invoke("focus_window", { label: existing.label });
    return true;
  }
  await invoke("add_recent_file", { path, name });
  await invoke("set_last_opened_file", { path });
  await invoke("create_new_window", { mode: "open", mmapPath: path });
  return true;
}
