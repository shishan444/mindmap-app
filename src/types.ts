// 与 Rust 后端 models.rs 对应的前端类型定义

export type Priority = "P0" | "P1" | "P2" | "P3";

export interface NodeImage {
  path: string;
  width: number;
  height: number;
}

export interface NodeStyle {
  font_family?: string;
  font_size?: number;
  font_weight?: string;
  color?: string;
  background?: string;
  border_color?: string;
  border_width?: number;
  shape?: string;
  line_style?: string;
}

export interface MindNode {
  id: string;
  topic: string;
  priority?: Priority;
  image?: NodeImage;
  icons?: string[];           // 后端总是输出 []，但前端防御性处理 undefined
  reminder_ids?: string[];
  style?: NodeStyle;
  collapsed?: boolean;
  children?: MindNode[];      // 历史数据可能缺失，所有访问用 ?? [] 防御
  attached_file?: AttachedFile;  // 附加文件(Package 目录机制)
}

export type FileType =
  | "image"
  | "pdf"
  | "slide"
  | "doc"
  | "sheet"
  | "video"
  | "audio"
  | "other";

export interface AttachedFile {
  uuid: string;
  original_name: string;
  ext: string;
  file_type: FileType;
  size_bytes: number;
  attached_at: string;
}

export interface CanvasState {
  zoom: number;
  pan_x: number;
  pan_y: number;
  selected_node_id?: string;
}

export interface Content {
  version: string;
  root: MindNode;
  canvas_state: CanvasState;
}

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  is_maximized: boolean;
  sidebar_width: number;
  sidebar_collapsed: boolean;
  active_tab: string;
}

export interface UiPrefs {
  theme: string;
  language: string;
  font_family?: string;
  font_size: number;
  show_minimap: boolean;
  show_toolbar: boolean;
}

export interface ReminderPrefs {
  sound_enabled: boolean;
  sound_file: string;
  default_priority: string;
  snooze_minutes: number;
  show_modal_when_background: boolean;
  system_notification_enabled: boolean;
}

export interface ExportPrefs {
  png_scale: number;
  markdown_indent: string;
}

export interface Config {
  version: string;
  last_open_dir?: string;
  last_export_dir?: string;
  last_import_dir?: string;
  default_new_file_dir?: string;
  last_opened_file?: string;
  window_state: WindowState;
  ui: UiPrefs;
  auto_save_interval_sec: number;
  recent_files_max: number;
  reminder: ReminderPrefs;
  export: ExportPrefs;
}

export interface RecentFile {
  path: string;
  name: string;
  opened_at: string;
  pinned: boolean;
}

export interface RecentFiles {
  version: string;
  files: RecentFile[];
}

export type SidebarTab = "properties" | "reminders" | "style" | "outline";

// ===== Reminder（Phase 11.5）=====

export interface ReminderRepeatRule {
  type: "daily" | "interval";
  time?: string; // daily 用 "HH:MM"
  value?: number; // interval 用
  unit?: "minutes" | "hours" | "days" | string;
}

export interface Reminder {
  id: string;
  node_id: string;
  source_file: string;
  title: string;
  message: string | null;
  trigger_at: string;
  repeat_rule: ReminderRepeatRule | null;
  priority: Priority | null;
  enabled: boolean;
  status: "pending" | "triggered" | "snoozed" | "completed";
  last_triggered_at: string | null;
  snoozed_until: string | null;
  next_trigger_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderIndex {
  version: string;
  reminders: Reminder[];
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  P0: "#E74C3C",
  P1: "#F39C12",
  P2: "#F1C40F",
  P3: "#95A5A6",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  P0: "P0 紧急",
  P1: "P1 高",
  P2: "P2 中",
  P3: "P3 低",
};
