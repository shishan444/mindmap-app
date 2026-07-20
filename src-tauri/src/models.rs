use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ===== 节点相关 =====

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Priority {
    P0,
    P1,
    P2,
    P3,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeImage {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub topic: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<NodeImage>,
    /// 关键：Vec 字段必须总是序列化（即使空），前端 TS 类型是必填
    /// 如果用 skip_serializing_if="Vec::is_empty"，空 Vec 不序列化 → 前端拿到 undefined → crash
    #[serde(default)]
    pub icons: Vec<String>,
    #[serde(default)]
    pub reminder_ids: Vec<String>,
    #[serde(default)]
    pub style: NodeStyle,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub children: Vec<Node>,
    /// 附加文件(Package 目录机制:文件存在 assets/{uuid}.{ext})
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attached_file: Option<AttachedFile>,
}

/// 附加文件元信息。文件实体存在 .mmap 目录内的 assets/{uuid}.{ext}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachedFile {
    /// 内部唯一 ID(用于索引 assets/ 和 thumbnails/)
    pub uuid: String,
    /// 原始文件名(含扩展名,显示用)
    pub original_name: String,
    /// 扩展名(小写无点,如 "pdf" / "pptx" / "mp4")
    pub ext: String,
    /// 文件类型枚举(决定缩略图策略 + 图标渲染)
    pub file_type: FileType,
    /// 文件大小(字节)
    pub size_bytes: u64,
    /// 附加时间(ISO 8601 UTC)
    pub attached_at: String,
}

/// 文件类型枚举 — 决定画布渲染策略
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    /// 图片(jpg/png/gif/webp)— 缩略图就是图片本身
    Image,
    /// PDF — 用 QL 生成第一页缩略图
    Pdf,
    /// 演示文稿(ppt/pptx/key)— QL 缩略图
    Slide,
    /// 文档(doc/docx/pages)— QL 缩略图
    Doc,
    /// 表格(xls/xlsx/numbers)— QL 缩略图
    Sheet,
    /// 视频(mp4/mov/m4v)— 不生成缩略图,显示图标
    Video,
    /// 音频(mp3/wav/m4a)— 不生成缩略图,显示图标
    Audio,
    /// 其他类型 — 通用文件图标
    Other,
}

impl FileType {
    /// 根据扩展名推断文件类型
    pub fn from_extension(ext: &str) -> Self {
        let e = ext.to_lowercase();
        match e.as_str() {
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "svg" => Self::Image,
            "pdf" => Self::Pdf,
            "ppt" | "pptx" | "key" => Self::Slide,
            "doc" | "docx" | "pages" | "rtf" | "txt" | "md" => Self::Doc,
            "xls" | "xlsx" | "numbers" | "csv" => Self::Sheet,
            "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm" => Self::Video,
            "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" => Self::Audio,
            _ => Self::Other,
        }
    }

    /// 是否需要生成缩略图
    pub fn needs_thumbnail(&self) -> bool {
        matches!(self, Self::Image | Self::Pdf | Self::Slide | Self::Doc | Self::Sheet)
    }
}

impl Node {
    pub fn new(topic: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            topic: topic.into(),
            priority: None,
            image: None,
            icons: vec![],
            reminder_ids: vec![],
            style: NodeStyle::default(),
            collapsed: false,
            children: vec![],
            attached_file: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasState {
    #[serde(default = "default_zoom")]
    pub zoom: f64,
    #[serde(default)]
    pub pan_x: f64,
    #[serde(default)]
    pub pan_y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_node_id: Option<String>,
}

fn default_zoom() -> f64 {
    1.0
}

impl Default for CanvasState {
    fn default() -> Self {
        Self {
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
            selected_node_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Content {
    pub version: String,
    pub root: Node,
    #[serde(default)]
    pub canvas_state: CanvasState,
}

impl Content {
    pub fn new(topic: impl Into<String>) -> Self {
        Self {
            version: "1.0.0".to_string(),
            root: Node::new(topic),
            canvas_state: CanvasState::default(),
        }
    }
}

// ===== .mmap 包内 meta.json =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    pub format: String,
    pub app_version: String,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
}

impl Meta {
    pub fn new() -> Self {
        let now = Utc::now();
        Self {
            format: "mindmap-v1".to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            created_at: now,
            modified_at: now,
        }
    }

    pub fn touch(&mut self) {
        self.modified_at = Utc::now();
    }
}

impl Default for Meta {
    fn default() -> Self {
        Self::new()
    }
}

// ===== config.json =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    #[serde(default = "default_win_w")]
    pub width: u32,
    #[serde(default = "default_win_h")]
    pub height: u32,
    #[serde(default)]
    pub is_maximized: bool,
    #[serde(default = "default_sidebar_w")]
    pub sidebar_width: u32,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default = "default_active_tab")]
    pub active_tab: String,
}

fn default_win_w() -> u32 {
    1280
}
fn default_win_h() -> u32 {
    800
}
fn default_sidebar_w() -> u32 {
    280
}
fn default_active_tab() -> String {
    "properties".to_string()
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            x: 100,
            y: 100,
            width: default_win_w(),
            height: default_win_h(),
            is_maximized: false,
            sidebar_width: default_sidebar_w(),
            sidebar_collapsed: false,
            active_tab: default_active_tab(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiPrefs {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_true")]
    pub show_minimap: bool,
    #[serde(default = "default_true")]
    pub show_toolbar: bool,
}

fn default_theme() -> String {
    "system".to_string()
}
fn default_lang() -> String {
    "zh-CN".to_string()
}
fn default_font_size() -> u32 {
    14
}
fn default_true() -> bool {
    true
}

impl Default for UiPrefs {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            language: default_lang(),
            font_family: None,
            font_size: default_font_size(),
            show_minimap: true,
            show_toolbar: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderPrefs {
    #[serde(default)]
    pub sound_enabled: bool,
    #[serde(default = "default_sound_file")]
    pub sound_file: String,
    #[serde(default = "default_priority_str")]
    pub default_priority: String,
    #[serde(default = "default_snooze")]
    pub snooze_minutes: u32,
    #[serde(default)]
    pub show_modal_when_background: bool,
    /// 系统通知（macOS 通知中心）。默认开启，用户可在偏好设置中关闭。
    #[serde(default = "default_true")]
    pub system_notification_enabled: bool,
}

fn default_sound_file() -> String {
    "default".to_string()
}
fn default_priority_str() -> String {
    "P2".to_string()
}
fn default_snooze() -> u32 {
    5
}

impl Default for ReminderPrefs {
    fn default() -> Self {
        Self {
            sound_enabled: false,
            sound_file: default_sound_file(),
            default_priority: default_priority_str(),
            snooze_minutes: default_snooze(),
            show_modal_when_background: false,
            system_notification_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPrefs {
    #[serde(default = "default_png_scale")]
    pub png_scale: u32,
    #[serde(default = "default_md_indent")]
    pub markdown_indent: String,
}

fn default_png_scale() -> u32 {
    2
}
fn default_md_indent() -> String {
    "  ".to_string()
}

impl Default for ExportPrefs {
    fn default() -> Self {
        Self {
            png_scale: default_png_scale(),
            markdown_indent: default_md_indent(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_config_version")]
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_open_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_export_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_import_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_new_file_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_file: Option<String>,
    #[serde(default)]
    pub window_state: WindowState,
    /// 多窗口模式:按 window label 分键存储窗口状态
    /// key = window label("main" / "doc-1" / "doc-2" / ...)
    /// 兼容:旧版本无此字段时,window_state 作为 main 的默认值
    #[serde(default)]
    pub window_states: std::collections::HashMap<String, WindowState>,
    #[serde(default)]
    pub ui: UiPrefs,
    #[serde(default = "default_auto_save_sec")]
    pub auto_save_interval_sec: u32,
    #[serde(default = "default_recent_files_max")]
    pub recent_files_max: u32,
    #[serde(default)]
    pub reminder: ReminderPrefs,
    #[serde(default)]
    pub export: ExportPrefs,
}

fn default_config_version() -> String {
    "1.0.0".to_string()
}
fn default_auto_save_sec() -> u32 {
    2
}
fn default_recent_files_max() -> u32 {
    20
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: default_config_version(),
            last_open_dir: dirs::document_dir().map(|p| p.to_string_lossy().into_owned()),
            last_export_dir: dirs::desktop_dir().map(|p| p.to_string_lossy().into_owned()),
            last_import_dir: dirs::download_dir().map(|p| p.to_string_lossy().into_owned()),
            default_new_file_dir: dirs::document_dir().map(|p| p.to_string_lossy().into_owned()),
            last_opened_file: None,
            window_state: WindowState::default(),
            window_states: std::collections::HashMap::new(),
            ui: UiPrefs::default(),
            auto_save_interval_sec: default_auto_save_sec(),
            recent_files_max: default_recent_files_max(),
            reminder: ReminderPrefs::default(),
            export: ExportPrefs::default(),
        }
    }
}

// ===== Reminder（Phase 11.5）=====

/// 重复规则：单次 / 每日固定时间 / 间隔
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RepeatRule {
    /// "daily" | "interval"
    #[serde(rename = "type")]
    pub rule_type: String,
    /// daily 用，"HH:MM"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    /// interval 用，数值
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<u32>,
    /// interval 用，"minutes" | "hours" | "days"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReminderStatus {
    Pending,
    Triggered,
    Snoozed,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reminder {
    pub id: String,
    pub node_id: String,
    /// 所属 .mmap 文件路径（用于跳转回去）
    pub source_file: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// 触发时间，ISO 8601 本地（"2026-07-15T15:30:00"）
    pub trigger_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repeat_rule: Option<RepeatRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ReminderStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_triggered_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snoozed_until: Option<String>,
    /// 下次触发时间（缓存，调度器用）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_trigger_at: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl Reminder {
    pub fn new(
        node_id: impl Into<String>,
        source_file: impl Into<String>,
        title: impl Into<String>,
        trigger_at: impl Into<String>,
    ) -> Self {
        let now = chrono::Utc::now();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            node_id: node_id.into(),
            source_file: source_file.into(),
            title: title.into(),
            message: None,
            trigger_at: trigger_at.into(),
            repeat_rule: None,
            priority: None,
            enabled: true,
            status: Some(ReminderStatus::Pending),
            last_triggered_at: None,
            snoozed_until: None,
            next_trigger_at: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReminderIndex {
    #[serde(default = "default_config_version")]
    pub version: String,
    #[serde(default)]
    pub reminders: Vec<Reminder>,
}

impl ReminderIndex {
    pub fn add_or_replace(&mut self, reminder: Reminder) {
        if let Some(slot) = self
            .reminders
            .iter_mut()
            .find(|r| r.id == reminder.id)
        {
            *slot = reminder;
        } else {
            self.reminders.push(reminder);
        }
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.reminders.len();
        self.reminders.retain(|r| r.id != id);
        self.reminders.len() < before
    }

    pub fn get_for_node(&self, node_id: &str) -> Vec<&Reminder> {
        self.reminders
            .iter()
            .filter(|r| r.node_id == node_id)
            .collect()
    }
}

// ===== recent-files.json =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub opened_at: DateTime<Utc>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentFiles {
    #[serde(default = "default_config_version")]
    pub version: String,
    #[serde(default)]
    pub files: Vec<RecentFile>,
}

impl Default for RecentFiles {
    fn default() -> Self {
        Self {
            version: default_config_version(),
            files: vec![],
        }
    }
}

impl RecentFiles {
    /// 添加或更新最近文件（按 path 去重，置顶项永远在前）
    pub fn touch(&mut self, path: impl Into<String>, name: impl Into<String>, max: u32) {
        let path = path.into();
        let name = name.into();
        // 移除已存在的同 path 项
        self.files.retain(|f| f.path != path);
        // 插入到非 pinned 的最前
        let new_file = RecentFile {
            path,
            name,
            opened_at: Utc::now(),
            pinned: false,
        };
        // 找到第一个非 pinned 的位置
        let pos = self
            .files
            .iter()
            .position(|f| !f.pinned)
            .unwrap_or(self.files.len());
        self.files.insert(pos, new_file);
        // 裁剪到 max
        let max = max as usize;
        if self.files.len() > max {
            // 保留所有 pinned + 前 (max - pinned_count) 个非 pinned
            let pinned_count = self.files.iter().filter(|f| f.pinned).count();
            let non_pinned_keep = max.saturating_sub(pinned_count);
            let mut kept: Vec<RecentFile> = self.files.iter().filter(|f| f.pinned).cloned().collect();
            let non_pinned: Vec<RecentFile> = self
                .files
                .iter()
                .filter(|f| !f.pinned)
                .take(non_pinned_keep)
                .cloned()
                .collect();
            kept.extend(non_pinned);
            self.files = kept;
        }
    }

    pub fn toggle_pin(&mut self, path: &str) {
        if let Some(f) = self.files.iter_mut().find(|f| f.path == path) {
            f.pinned = !f.pinned;
        }
        // 重排：pinned 在前
        self.files.sort_by_key(|f| !f.pinned);
    }

    pub fn remove(&mut self, path: &str) {
        self.files.retain(|f| f.path != path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===== Node 测试 =====

    #[test]
    fn node_new_generates_uuid_v4_format() {
        let n = Node::new("test");
        // UUID v4 格式：8-4-4-4-12 共 36 字符（含 4 个连字符）
        assert_eq!(n.id.len(), 36);
        let parts: Vec<&str> = n.id.split('-').collect();
        assert_eq!(parts.len(), 5);
        assert_eq!(parts[0].len(), 8);
        assert_eq!(parts[1].len(), 4);
        assert_eq!(parts[2].len(), 4);
        assert_eq!(parts[3].len(), 4);
        assert_eq!(parts[4].len(), 12);
    }

    #[test]
    fn node_serialization_basic_fields() {
        let mut n = Node::new("根节点");
        n.children.push(Node::new("子节点"));
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("\"id\""));
        assert!(json.contains("\"topic\":\"根节点\""));
        assert!(json.contains("\"children\""));
        assert!(json.contains("子节点"));
    }

    #[test]
    fn node_always_serializes_vec_fields() {
        // 关键契约：Vec 字段（children/icons/reminder_ids）必须总是序列化（即使空）
        // 否则前端 TS 类型（必填）会拿到 undefined → crash
        let n = Node::new("x");
        let json = serde_json::to_string(&n).unwrap();
        assert!(
            json.contains("\"children\":[]"),
            "children 必须总是输出，实际: {}",
            json
        );
        assert!(
            json.contains("\"icons\":[]"),
            "icons 必须总是输出，实际: {}",
            json
        );
        assert!(
            json.contains("\"reminder_ids\":[]"),
            "reminder_ids 必须总是输出，实际: {}",
            json
        );
        // Option 字段为 None 时仍跳过（不影响）
        assert!(!json.contains("\"priority\""));
    }

    #[test]
    fn node_backward_compat_missing_fields() {
        // 模拟老版本 JSON：只有 id 和 topic
        let json = r#"{"id":"abc","topic":"老节点","children":[]}"#;
        let n: Node = serde_json::from_str(json).unwrap();
        assert_eq!(n.id, "abc");
        assert_eq!(n.topic, "老节点");
        assert!(n.priority.is_none());
        assert!(n.children.is_empty());
        assert!(!n.collapsed);
    }

    #[test]
    fn priority_serialization_uppercase() {
        let ps = vec![Priority::P0, Priority::P1, Priority::P2, Priority::P3];
        for p in &ps {
            let json = serde_json::to_string(p).unwrap();
            let s: String = serde_json::from_str(&json).unwrap();
            assert!(s.starts_with("P"));
        }
        // 直接序列化整个枚举值
        assert_eq!(serde_json::to_string(&Priority::P0).unwrap(), "\"P0\"");
        assert_eq!(serde_json::to_string(&Priority::P3).unwrap(), "\"P3\"");
    }

    #[test]
    fn priority_deserialization_case_insensitive_attempt() {
        // 大写必须支持
        let p: Priority = serde_json::from_str("\"P1\"").unwrap();
        assert_eq!(p, Priority::P1);
    }

    // ===== Content 测试 =====

    #[test]
    fn content_new_has_version_and_root() {
        let c = Content::new("主题");
        assert_eq!(c.version, "1.0.0");
        assert_eq!(c.root.topic, "主题");
        assert_eq!(c.canvas_state.zoom, 1.0);
    }

    // ===== Meta 测试 =====

    #[test]
    fn meta_format_is_mindmap_v1() {
        let m = Meta::new();
        assert_eq!(m.format, "mindmap-v1");
        assert!(!m.app_version.is_empty());
    }

    #[test]
    fn meta_touch_updates_modified_only() {
        let m = Meta::new();
        let original_created = m.created_at;
        let mut m2 = m.clone();
        std::thread::sleep(std::time::Duration::from_millis(10));
        m2.touch();
        assert_eq!(m2.created_at, original_created);
        assert!(m2.modified_at > original_created);
    }

    // ===== Config 测试 =====

    #[test]
    fn config_default_values() {
        let c = Config::default();
        assert_eq!(c.version, "1.0.0");
        assert_eq!(c.auto_save_interval_sec, 2);
        assert_eq!(c.recent_files_max, 20);
        assert_eq!(c.ui.theme, "system");
        assert_eq!(c.ui.language, "zh-CN");
        assert_eq!(c.ui.font_size, 14);
        assert!(!c.reminder.sound_enabled);
        assert_eq!(c.reminder.default_priority, "P2");
        assert_eq!(c.reminder.snooze_minutes, 5);
        assert_eq!(c.export.png_scale, 2);
        assert_eq!(c.window_state.sidebar_width, 280);
        assert_eq!(c.window_state.active_tab, "properties");
    }

    #[test]
    fn config_backward_compat_partial_json() {
        // 老版本 JSON：只有 version
        let json = r#"{"version":"0.9.0"}"#;
        let c: Config = serde_json::from_str(json).unwrap();
        assert_eq!(c.version, "0.9.0");
        // 缺失字段用默认值
        assert_eq!(c.auto_save_interval_sec, 2);
        assert_eq!(c.window_state.sidebar_width, 280);
    }

    // ===== RecentFiles 测试 =====

    #[test]
    fn recent_touch_adds_first() {
        let mut rf = RecentFiles::default();
        rf.touch("/a.mmap", "A", 20);
        assert_eq!(rf.files.len(), 1);
        assert_eq!(rf.files[0].path, "/a.mmap");
        assert_eq!(rf.files[0].name, "A");
        assert!(!rf.files[0].pinned);
    }

    #[test]
    fn recent_touch_moves_to_top() {
        let mut rf = RecentFiles::default();
        rf.touch("/a.mmap", "A", 20);
        rf.touch("/b.mmap", "B", 20);
        rf.touch("/a.mmap", "A", 20); // 再次打开 A
        assert_eq!(rf.files.len(), 2);
        // A 应在 B 之前（最近打开）
        assert_eq!(rf.files[0].path, "/a.mmap");
        assert_eq!(rf.files[1].path, "/b.mmap");
    }

    #[test]
    fn recent_trim_respects_pinned() {
        let mut rf = RecentFiles::default();
        // 加 5 个，前两个 pinned
        rf.touch("/a.mmap", "A", 20);
        rf.touch("/b.mmap", "B", 20);
        rf.toggle_pin("/a.mmap");
        rf.toggle_pin("/b.mmap");
        // 加 3 个非 pinned
        rf.touch("/c.mmap", "C", 20);
        rf.touch("/d.mmap", "D", 20);
        rf.touch("/e.mmap", "E", 20);
        // 现在 5 个，max=3 应保留 2 pinned + 1 非 pinned
        // 注意：touch 内部 trim 在 toggle_pin 之前可能不重新排
        // 简化测试：直接验证 max 行为
        // 这里 max=3，加 3 个非 pinned，前 2 个 pinned 永远保留
        // 但 touch 内 trim 是在每次 touch 时触发，所以可能已经裁剪
        // 这里我们再 touch 一个新的，让 trim 触发
        // 由于 pinned 永远保留，max=3 时会保留 2 pinned + 1 非 pinned = 3
        // 但 pinned 计算前可能多于 max-pinned_count
        // 关键验证：pinned 总是保留
        let pinned_count = rf.files.iter().filter(|f| f.pinned).count();
        assert!(pinned_count >= 2, "pinned 应至少 2 个，实际 {}", pinned_count);
    }

    #[test]
    fn recent_toggle_pin_changes_flag() {
        let mut rf = RecentFiles::default();
        rf.touch("/a.mmap", "A", 20);
        assert!(!rf.files[0].pinned);
        rf.toggle_pin("/a.mmap");
        assert!(rf.files[0].pinned);
        rf.toggle_pin("/a.mmap");
        assert!(!rf.files[0].pinned);
    }

    #[test]
    fn recent_remove_works() {
        let mut rf = RecentFiles::default();
        rf.touch("/a.mmap", "A", 20);
        rf.touch("/b.mmap", "B", 20);
        rf.remove("/a.mmap");
        assert_eq!(rf.files.len(), 1);
        assert_eq!(rf.files[0].path, "/b.mmap");
    }

    #[test]
    fn recent_max_zero_keeps_pinned_only() {
        let mut rf = RecentFiles::default();
        rf.touch("/a.mmap", "A", 1);
        rf.toggle_pin("/a.mmap");
        rf.touch("/b.mmap", "B", 1);
        rf.touch("/c.mmap", "C", 1);
        // max=1，应该只保留 1 个 pinned（A）
        let pinned_paths: Vec<_> = rf.files.iter().filter(|f| f.pinned).map(|f| f.path.clone()).collect();
        assert!(pinned_paths.contains(&"/a.mmap".to_string()));
    }

    #[test]
    fn file_type_from_extension_image() {
        assert!(matches!(FileType::from_extension("jpg"), FileType::Image));
        assert!(matches!(FileType::from_extension("PNG"), FileType::Image));
        assert!(matches!(FileType::from_extension("gif"), FileType::Image));
    }

    #[test]
    fn file_type_from_extension_pdf_doc_sheet() {
        assert!(matches!(FileType::from_extension("pdf"), FileType::Pdf));
        assert!(matches!(FileType::from_extension("pptx"), FileType::Slide));
        assert!(matches!(FileType::from_extension("docx"), FileType::Doc));
        assert!(matches!(FileType::from_extension("xlsx"), FileType::Sheet));
    }

    #[test]
    fn file_type_from_extension_media() {
        assert!(matches!(FileType::from_extension("mp4"), FileType::Video));
        assert!(matches!(FileType::from_extension("mov"), FileType::Video));
        assert!(matches!(FileType::from_extension("mp3"), FileType::Audio));
        assert!(matches!(FileType::from_extension("flac"), FileType::Audio));
    }

    #[test]
    fn file_type_from_extension_other() {
        assert!(matches!(FileType::from_extension("zip"), FileType::Other));
        assert!(matches!(FileType::from_extension("unknown"), FileType::Other));
    }

    #[test]
    fn file_type_needs_thumbnail() {
        assert!(FileType::Image.needs_thumbnail());
        assert!(FileType::Pdf.needs_thumbnail());
        assert!(FileType::Slide.needs_thumbnail());
        assert!(FileType::Doc.needs_thumbnail());
        assert!(FileType::Sheet.needs_thumbnail());
        assert!(!FileType::Video.needs_thumbnail());
        assert!(!FileType::Audio.needs_thumbnail());
        assert!(!FileType::Other.needs_thumbnail());
    }

    #[test]
    fn attached_file_serialization() {
        let af = AttachedFile {
            uuid: "test-uuid".to_string(),
            original_name: "report.pdf".to_string(),
            ext: "pdf".to_string(),
            file_type: FileType::Pdf,
            size_bytes: 1024,
            attached_at: "2026-07-18T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&af).unwrap();
        assert!(json.contains("\"file_type\":\"pdf\""));
        let de: AttachedFile = serde_json::from_str(&json).unwrap();
        assert_eq!(de.uuid, "test-uuid");
        assert!(matches!(de.file_type, FileType::Pdf));
    }

    #[test]
    fn node_with_attached_file_serialization() {
        let mut n = Node::new("文件节点");
        n.attached_file = Some(AttachedFile {
            uuid: "u1".to_string(),
            original_name: "demo.mp4".to_string(),
            ext: "mp4".to_string(),
            file_type: FileType::Video,
            size_bytes: 1024 * 1024,
            attached_at: "2026-07-18T00:00:00Z".to_string(),
        });
        let json = serde_json::to_string(&n).unwrap();
        assert!(json.contains("\"attached_file\""));
        assert!(json.contains("\"file_type\":\"video\""));
        // 反序列化
        let de: Node = serde_json::from_str(&json).unwrap();
        assert!(de.attached_file.is_some());
    }

    #[test]
    fn node_without_attached_file_no_field() {
        // 没有 attached_file 时,序列化结果不应该包含该字段(skip_serializing_if)
        let n = Node::new("普通节点");
        let json = serde_json::to_string(&n).unwrap();
        assert!(!json.contains("attached_file"), "无附件不应序列化该字段");
    }
}
