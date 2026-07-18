// 测试辅助函数：构造测试用的 fake 数据
import type { Config, Content, MindNode, RecentFiles } from "../types";

export function makeNode(overrides: Partial<MindNode> = {}): MindNode {
  return {
    id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 10)}`,
    topic: overrides.topic ?? "默认主题",
    priority: overrides.priority,
    image: overrides.image,
    icons: overrides.icons,
    reminder_ids: overrides.reminder_ids,
    style: overrides.style,
    collapsed: overrides.collapsed ?? false,
    children: overrides.children ?? [],
    attached_file: overrides.attached_file,
  };
}

export function makeContent(overrides: Partial<Content> = {}): Content {
  return {
    version: overrides.version || "1.0.0",
    root: overrides.root || makeNode({ topic: "根节点" }),
    canvas_state: overrides.canvas_state || {
      zoom: 1,
      pan_x: 0,
      pan_y: 0,
      selected_node_id: undefined,
    },
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: overrides.version || "1.0.0",
    last_open_dir: overrides.last_open_dir,
    last_export_dir: overrides.last_export_dir,
    last_import_dir: overrides.last_import_dir,
    default_new_file_dir: overrides.default_new_file_dir,
    last_opened_file: overrides.last_opened_file,
    window_state: {
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
      is_maximized: false,
      sidebar_width: 280,
      sidebar_collapsed: false,
      active_tab: "properties",
      ...overrides.window_state,
    },
    ui: {
      theme: "system",
      language: "zh-CN",
      font_family: undefined,
      font_size: 14,
      show_minimap: true,
      show_toolbar: true,
      ...overrides.ui,
    },
    auto_save_interval_sec: overrides.auto_save_interval_sec ?? 2,
    recent_files_max: overrides.recent_files_max ?? 20,
    reminder: {
      sound_enabled: false,
      sound_file: "default",
      default_priority: "P2",
      snooze_minutes: 5,
      show_modal_when_background: false,
      system_notification_enabled: true,
      ...overrides.reminder,
    },
    export: {
      png_scale: 2,
      markdown_indent: "  ",
      ...overrides.export,
    },
  };
}

export function makeRecentFiles(
  files: Array<{ path: string; name: string; pinned?: boolean }> = [],
): RecentFiles {
  return {
    version: "1.0.0",
    files: files.map((f) => ({
      path: f.path,
      name: f.name,
      opened_at: "2026-07-15T00:00:00Z",
      pinned: f.pinned || false,
    })),
  };
}

/** 构造一棵树：根 → 3 个子节点 → 每个子节点 2 个孙节点 */
export function makeTree(): MindNode {
  return makeNode({
    topic: "根",
    children: [
      makeNode({
        topic: "子1",
        children: [
          makeNode({ topic: "孙1-1" }),
          makeNode({ topic: "孙1-2" }),
        ],
      }),
      makeNode({
        topic: "子2",
        children: [
          makeNode({ topic: "孙2-1" }),
          makeNode({ topic: "孙2-2" }),
        ],
      }),
      makeNode({
        topic: "子3",
        children: [
          makeNode({ topic: "孙3-1" }),
          makeNode({ topic: "孙3-2" }),
        ],
      }),
    ],
  });
}
