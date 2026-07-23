use std::path::{Path, PathBuf};

use crate::config::{
    self, app_data_dir, config_path, ensure_app_data_dir, load_config, load_recent_files,
    save_config, save_recent_files,
};
use crate::error::{AppError, Result};
use crate::mmap::MmapFile;
use crate::models::{AttachedFile, Config, Content, FileType, RecentFiles, Reminder, ReminderIndex};

// ===== 配置相关 =====

#[tauri::command]
pub fn get_config() -> Result<Config> {
    let cfg = load_config()?;
    Ok(cfg)
}

#[tauri::command]
pub fn save_config_command(cfg: Config) -> Result<()> {
    save_config(&cfg)
}

#[tauri::command]
pub fn get_app_data_dir() -> Result<String> {
    Ok(app_data_dir()?.to_string_lossy().into_owned())
}

// ===== 最近文件 =====

#[tauri::command]
pub fn get_recent_files() -> Result<RecentFiles> {
    load_recent_files()
}

#[tauri::command]
pub fn add_recent_file(path: String, name: String) -> Result<RecentFiles> {
    let mut rf = load_recent_files()?;
    let cfg = load_config()?;
    rf.touch(path, name, cfg.recent_files_max);
    save_recent_files(&rf)?;
    Ok(rf)
}

#[tauri::command]
pub fn toggle_pin_recent(path: String) -> Result<RecentFiles> {
    let mut rf = load_recent_files()?;
    rf.toggle_pin(&path);
    save_recent_files(&rf)?;
    Ok(rf)
}

#[tauri::command]
pub fn remove_recent_file(path: String) -> Result<RecentFiles> {
    let mut rf = load_recent_files()?;
    rf.remove(&path);
    save_recent_files(&rf)?;
    Ok(rf)
}

// ===== .mmap 文件操作(Package 目录机制) =====

/// 读取 .mmap 目录,返回 content
#[tauri::command]
pub fn open_mmap(path: String) -> Result<Content> {
    let p = PathBuf::from(&path);
    let mmap = MmapFile::open_at(&p)?;
    Ok(mmap.content)
}

/// 创建新文档(不写盘,仅返回默认 Content;首次 save_mmap 时创建目录)
#[tauri::command]
pub fn new_mmap(topic: Option<String>) -> Result<Content> {
    let topic = topic.unwrap_or_else(|| "中心主题".to_string());
    Ok(Content::new(topic))
}

/// 保存到 .mmap 目录(原子写 content.json + 单份备份)
#[tauri::command]
pub fn save_mmap(path: String, content: Content) -> Result<()> {
    let p = PathBuf::from(&path);
    // 已存在 → 打开(保留 meta);不存在 → 创建
    let mut mmap = if p.exists() && p.is_dir() {
        let mut existing = MmapFile::open_at(&p)?;
        existing.content = content;
        existing
    } else {
        // 用 root.topic 创建(后续 save 内部建目录)
        MmapFile {
            meta: crate::models::Meta::new(),
            content,
            root: p.clone(),
        }
    };
    mmap.save()
}

/// 把 last_opened_file 更新到 config（启动时恢复用）
#[tauri::command]
pub fn set_last_opened_file(path: Option<String>) -> Result<Config> {
    let mut cfg = load_config()?;
    cfg.last_opened_file = path;
    save_config(&cfg)?;
    Ok(cfg)
}

// ===== 附加文件操作(Package 目录机制) =====

/// 把用户选择的文件复制到 mindmap 的 assets/ 目录,绑定到指定节点。
/// 返回更新后的 AttachedFile(前端用于更新 store.content)。
#[tauri::command]
pub fn attach_file_to_node(
    mmap_path: String,
    node_id: String,
    src_path: String,
) -> Result<AttachedFile> {
    let src = PathBuf::from(&src_path);
    if !src.exists() {
        return Err(AppError::FileNotFound(src_path));
    }
    let bytes = std::fs::read(&src)?;
    let original_name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    // 扩展名(小写无点)
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ext.is_empty() {
        return Err(AppError::InvalidFormat("文件无扩展名".to_string()));
    }
    let file_type = FileType::from_extension(&ext);
    let uuid = uuid::Uuid::new_v4().to_string();

    // 复制到 mmap 目录的 assets/{uuid}.{ext}
    let mmap_root = PathBuf::from(&mmap_path);
    let mmap = MmapFile::open_at(&mmap_root)?;
    mmap.add_asset(&uuid, &ext, &bytes)?;

    // 生成缩略图(只对需要缩略图的类型)
    if file_type.needs_thumbnail() {
        if let Some(thumb_bytes) = generate_thumbnail(&mmap, &uuid, &ext, &file_type, &bytes) {
            let _ = mmap.write_thumbnail(&uuid, &thumb_bytes);
        }
    }

    // 修改 content:把 attached_file 写入指定节点,topic 替换为文件名(无扩展名)
    let mut content = mmap.content.clone();
    let stem = original_name.trim_end_matches(&format!(".{}", ext));
    attach_to_node_in_place(&mut content.root, &node_id, AttachedFile {
        uuid: uuid.clone(),
        original_name: original_name.clone(),
        ext: ext.clone(),
        file_type: file_type.clone(),
        size_bytes: bytes.len() as u64,
        attached_at: chrono::Utc::now().to_rfc3339(),
    }, stem);

    // 保存(用 MmapFile::save,需要重新打开为 mut)
    let mut mmap_w = MmapFile::open_at(&mmap_root)?;
    mmap_w.content = content;
    mmap_w.save()?;

    // 返回新建的 AttachedFile
    Ok(AttachedFile {
        uuid,
        original_name,
        ext,
        file_type,
        size_bytes: bytes.len() as u64,
        attached_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// 替换节点的附件(删旧 + 加新),返回新 AttachedFile
#[tauri::command]
pub fn replace_attached_file(
    mmap_path: String,
    node_id: String,
    new_src: String,
) -> Result<AttachedFile> {
    // 先移除旧的(如果在节点上存在)
    let mmap_root = PathBuf::from(&mmap_path);
    let mmap_r = MmapFile::open_at(&mmap_root)?;
    if let Some(old) = find_attached_file(&mmap_r.content.root, &node_id) {
        let _ = mmap_r.remove_asset(&old.uuid, &old.ext);
    }
    // 走 attach 流程
    attach_file_to_node(mmap_path, node_id, new_src)
}

/// 移除节点附件(删 assets + thumbnails 文件 + 清 Node.attached_file)
#[tauri::command]
pub fn remove_attached_file(mmap_path: String, node_id: String) -> Result<()> {
    let mmap_root = PathBuf::from(&mmap_path);
    let mmap_r = MmapFile::open_at(&mmap_root)?;
    if let Some(old) = find_attached_file(&mmap_r.content.root, &node_id) {
        let _ = mmap_r.remove_asset(&old.uuid, &old.ext);
    }
    let mut content = mmap_r.content.clone();
    remove_attached_in_place(&mut content.root, &node_id);

    let mut mmap_w = MmapFile::open_at(&mmap_root)?;
    mmap_w.content = content;
    mmap_w.save()?;
    Ok(())
}

/// 打开附件(系统默认工具)。通过 std::process::Command 调 macOS 的 open
#[tauri::command]
pub fn open_attached_file(mmap_path: String, node_id: String) -> Result<()> {
    let mmap_root = PathBuf::from(&mmap_path);
    let mmap = MmapFile::open_at(&mmap_root)?;
    let attached = find_attached_file(&mmap.content.root, &node_id)
        .ok_or_else(|| AppError::Other("节点未附加文件".to_string()))?;
    let asset_path = mmap.get_asset_path(&attached.uuid, &attached.ext);
    if !asset_path.exists() {
        return Err(AppError::FileNotFound(asset_path.display().to_string()));
    }
    // macOS: open <path>
    std::process::Command::new("open")
        .arg(&asset_path)
        .spawn()
        .map_err(|e| AppError::Other(format!("打开失败: {}", e)))?;
    Ok(())
}

/// 在 Finder 中显示附件
#[tauri::command]
pub fn reveal_attached_file(mmap_path: String, node_id: String) -> Result<()> {
    let mmap_root = PathBuf::from(&mmap_path);
    let mmap = MmapFile::open_at(&mmap_root)?;
    let attached = find_attached_file(&mmap.content.root, &node_id)
        .ok_or_else(|| AppError::Other("节点未附加文件".to_string()))?;
    let asset_path = mmap.get_asset_path(&attached.uuid, &attached.ext);
    // macOS: open -R <path> reveal in Finder
    std::process::Command::new("open")
        .arg("-R")
        .arg(&asset_path)
        .spawn()
        .map_err(|e| AppError::Other(format!("Finder 显示失败: {}", e)))?;
    Ok(())
}

/// 读附件缩略图字节(前端用作 img src)。无缩略图返回 null。
#[tauri::command]
pub fn read_thumbnail(mmap_path: String, uuid: String) -> Result<Option<Vec<u8>>> {
    let mmap_root = PathBuf::from(&mmap_path);
    let mmap = MmapFile::open_at(&mmap_root)?;
    let thumb_path = mmap.get_thumbnail_path(&uuid);
    if !thumb_path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&thumb_path)?;
    Ok(Some(bytes))
}

// === 内部 helpers ===

fn attach_to_node_in_place(root: &mut crate::models::Node, node_id: &str, file: AttachedFile, new_topic: &str) {
    if root.id == node_id {
        root.attached_file = Some(file);
        root.topic = new_topic.to_string();
        return;
    }
    for child in root.children.iter_mut() {
        attach_to_node_in_place(child, node_id, file.clone(), new_topic);
    }
}

fn remove_attached_in_place(root: &mut crate::models::Node, node_id: &str) {
    if root.id == node_id {
        root.attached_file = None;
        return;
    }
    for child in root.children.iter_mut() {
        remove_attached_in_place(child, node_id);
    }
}

fn find_attached_file<'a>(root: &'a crate::models::Node, node_id: &str) -> Option<&'a AttachedFile> {
    if root.id == node_id {
        return root.attached_file.as_ref();
    }
    for child in root.children.iter() {
        if let Some(f) = find_attached_file(child, node_id) {
            return Some(f);
        }
    }
    None
}

/// 生成缩略图(类型差异化):
/// - Image: 复制原文件作为缩略图(图片本身就是缩略图)
/// - 其他需要 QL 的类型:走 qlmanage shell 命令(macOS Quick Look)
fn generate_thumbnail(_mmap: &MmapFile, _uuid: &str, _ext: &str, file_type: &FileType, original_bytes: &[u8]) -> Option<Vec<u8>> {
    match file_type {
        FileType::Image => {
            // 图片直接用原文件作为缩略图(前端会自适应显示尺寸)
            Some(original_bytes.to_vec())
        }
        FileType::Pdf | FileType::Slide | FileType::Doc | FileType::Sheet => {
            // 走 qlmanage -t -s 400 <file> -out <png_path>
            // 实现简化:把原文件写到临时路径,调 qlmanage,读输出 png
            let temp_dir = std::env::temp_dir();
            let temp_file = temp_dir.join(format!("mindmap-ql-input-{}.{}", uuid::Uuid::new_v4(), _ext));
            std::fs::write(&temp_file, original_bytes).ok()?;
            let out_dir = temp_dir.join(format!("mindmap-ql-out-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&out_dir).ok()?;
            let _output = std::process::Command::new("qlmanage")
                .arg("-t")
                .arg("-s").arg("400")
                .arg("-o").arg(&out_dir)
                .arg(&temp_file)
                .output()
                .ok()?;
            let _ = std::fs::remove_file(&temp_file);
            // qlmanage 输出 <input-name>.png 在 out_dir
            let png_name = format!("{}.png", temp_file.file_name()?.to_string_lossy());
            let png_path = out_dir.join(&png_name);
            if !png_path.exists() {
                let _ = std::fs::remove_dir_all(&out_dir);
                return None;
            }
            let bytes = std::fs::read(&png_path).ok();
            let _ = std::fs::remove_dir_all(&out_dir);
            bytes
        }
        _ => None,
    }
}

/// 把 last_open_dir / last_export_dir / last_import_dir 更新到 config
#[tauri::command]
pub fn update_last_dirs(
    open_dir: Option<String>,
    export_dir: Option<String>,
    import_dir: Option<String>,
) -> Result<Config> {
    let mut cfg = load_config()?;
    if let Some(d) = open_dir {
        cfg.last_open_dir = Some(d);
    }
    if let Some(d) = export_dir {
        cfg.last_export_dir = Some(d);
    }
    if let Some(d) = import_dir {
        cfg.last_import_dir = Some(d);
    }
    save_config(&cfg)?;
    Ok(cfg)
}

/// 初始化应用数据目录（首次启动调用）
#[tauri::command]
pub fn init_app_data() -> Result<()> {
    ensure_app_data_dir()?;
    // 如果 config.json 不存在，写入默认值
    let cfg_path = config_path()?;
    if !cfg_path.exists() {
        let cfg = Config::default();
        save_config(&cfg)?;
    }
    // reminders.json 也建空（Phase 3 才填充）
    let rem_path = config::reminders_path()?;
    if !rem_path.exists() {
        let empty = serde_json::json!({"version":"1.0.0","reminders":[]});
        let bytes = serde_json::to_vec_pretty(&empty)?;
        let _ = std::fs::write(&rem_path, bytes);
    }
    Ok(())
}

/// 文件是否存在（用于检查 last_opened_file 还在不在）
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

// ===== 测试用 =====
#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

// ===== MCP 状态推送(Phase 1 只读 MVP)=====

/// 前端推送状态到后端 MCP 镜像
/// 由 store.subscribe 触发,每次 store 变化时调用
#[tauri::command]
pub fn mcp_update_state(
    mirror: tauri::State<'_, std::sync::Arc<crate::mcp::McpStateMirror>>,
    content: Option<crate::models::Content>,
    file_path: Option<String>,
    reminders: Vec<crate::models::Reminder>,
    edit_state: crate::mcp::EditState,
) -> Result<()> {
    mirror.update(content, file_path, reminders, edit_state);
    Ok(())
}

// ===== MCP Phase 2 写操作 =====

/// 用户强制接管:中断 LLM session,释放锁
#[tauri::command]
pub fn llm_force_release(
    editor: tauri::State<'_, crate::mcp::EditorMode>,
    registry: tauri::State<'_, crate::mcp::SessionRegistry>,
    app: tauri::AppHandle,
) -> Result<Option<String>> {
    use tauri::Emitter;
    let released = editor.force_release();
    if let Some(ref sid) = released {
        let info = registry.remove(sid);
        let _ = app.emit("llm-session-changed", crate::mcp::SessionChange {
            session: info,
            reason: "forced".to_string(),
        });
    }
    Ok(released)
}

/// 通用字节写入（用于 PNG 导出等场景）
#[tauri::command]
pub fn save_bytes(path: String, data: Vec<u8>) -> Result<()> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&p, &data)?;
    Ok(())
}

// ===== Markdown 导入导出 =====

#[tauri::command]
pub fn export_markdown(content: Content) -> Result<String> {
    Ok(crate::markdown::export_markdown(&content))
}

#[tauri::command]
pub fn import_markdown_file(path: String) -> Result<Content> {
    let s = std::fs::read_to_string(&path)?;
    crate::markdown::import_markdown(&s)
}

#[tauri::command]
pub fn import_markdown_string(md: String) -> Result<Content> {
    crate::markdown::import_markdown(&md)
}

// ===== OPML 导入导出 =====

#[tauri::command]
pub fn export_opml(content: Content) -> Result<String> {
    Ok(crate::opml::export_opml(&content))
}

#[tauri::command]
pub fn import_opml_file(path: String) -> Result<Content> {
    let s = std::fs::read_to_string(&path)?;
    crate::opml::import_opml(&s)
}

#[tauri::command]
pub fn import_opml_string(opml: String) -> Result<Content> {
    crate::opml::import_opml(&opml)
}

// ===== Reminder CRUD (Phase 11.5) =====

#[tauri::command]
pub fn get_reminders(state: tauri::State<'_, crate::state::AppState>) -> Result<ReminderIndex> {
    state.read_reminders(|idx| idx.clone())
}

#[tauri::command]
pub fn upsert_reminder(
    reminder: Reminder,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<ReminderIndex> {
    state.modify_reminders(|idx| {
        idx.add_or_replace(reminder);
        Ok(())
    })?;
    // 返回最新副本
    state.read_reminders(|idx| idx.clone())
}

#[tauri::command]
pub fn delete_reminder(
    id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<ReminderIndex> {
    state.modify_reminders(|idx| {
        idx.remove(&id);
        Ok(())
    })?;
    state.read_reminders(|idx| idx.clone())
}

#[tauri::command]
pub fn get_reminders_for_node(
    node_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<Reminder>> {
    Ok(state.read_reminders(|idx| {
        idx.reminders
            .iter()
            .filter(|r| r.node_id == node_id)
            .cloned()
            .collect()
    })?)
}

// ===== 开发模式日志（Phase 12）=====

#[tauri::command]
pub fn log_event(entry: crate::dev_logger::LogEntry) -> Result<()> {
    // 静默失败：日志写不进去不能影响主流程
    match crate::dev_logger::write(&entry) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("[log_event] write failed: {}", e);
            Ok(())
        }
    }
}

#[tauri::command]
pub fn is_dev_logger_ready() -> bool {
    true
}

// ===== FreeMind .mm 导入 =====
#[tauri::command]
pub fn import_freemind_file(path: String) -> Result<crate::models::Content> {
    let s = std::fs::read_to_string(&path)?;
    crate::freemind::import_freemind(&s)
}

// ===== 多窗口命令(XMind 模式) =====

/// 创建新窗口加载新文档
/// mode: "new" 新建空白 / "open" 打开已有文件(mmap_path 必填)
#[tauri::command]
pub fn create_new_window(
    app: tauri::AppHandle,
    mode: String,
    mmap_path: Option<String>,
) -> Result<String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    // 生成唯一 label
    let label = format!("doc-{}", chrono::Utc::now().timestamp_millis());
    // URL 携带参数,前端 App.tsx 解析后决定加载方式
    let url = match mode.as_str() {
        "open" => {
            let path = mmap_path.clone().ok_or_else(|| AppError::Other("open 模式需要 mmap_path".into()))?;
            WebviewUrl::App(format!("/?mode=open&mmap={}", url_encode_path(&path)).into())
        }
        _ => WebviewUrl::App("/?mode=new".into()),
    };
    let window_label = label.clone();
    let window = WebviewWindowBuilder::new(&app, &label, url)
        .title("思维导图")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .build()
        .map_err(|e| AppError::Other(format!("创建窗口失败: {}", e)))?;
    let _ = window.set_focus();
    // 设置窗口 title(子窗口根据模式)
    let title = match mode.as_str() {
        "open" => mmap_path
            .clone()
            .map(|p| format!("思维导图 - {}", p.split('/').next_back().unwrap_or("文档")))
            .unwrap_or_else(|| "思维导图".into()),
        _ => "思维导图 - 新建文档".into(),
    };
    let _ = window.set_title(&title);
    println!("[mindmap] 创建子窗口: label={}, title={}", window_label, title);
    Ok(label)
}

/// 列出所有窗口信息(用于"窗口"菜单或托盘)
#[tauri::command]
pub fn list_windows(app: tauri::AppHandle) -> Vec<WindowInfo> {
    use tauri::Manager;
    app.webview_windows()
        .iter()
        .map(|(label, w)| WindowInfo {
            label: label.clone(),
            title: w.title().unwrap_or_default(),
            is_visible: w.is_visible().unwrap_or(true),
            is_focused: w.is_focused().unwrap_or(false),
        })
        .collect()
}

/// 激活指定窗口
#[tauri::command]
pub fn focus_window(app: tauri::AppHandle, label: String) -> Result<()> {
    use tauri::Manager;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| AppError::Other(format!("窗口不存在: {}", label)))?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// 关闭当前子窗口(主窗口不能通过此命令关闭)
#[tauri::command]
pub fn close_current_window(window: tauri::Window) -> Result<()> {
    let label = window.label();
    if label == "main" {
        return Err(AppError::Other("主窗口不能通过此命令关闭".into()));
    }
    let _ = window.close();
    Ok(())
}

#[derive(serde::Serialize)]
pub struct WindowInfo {
    pub label: String,
    pub title: String,
    pub is_visible: bool,
    pub is_focused: bool,
}

fn url_encode_path(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            ' ' => "%20".into(),
            '&' => "%26".into(),
            '?' => "%3F".into(),
            '#' => "%23".into(),
            _ => c.to_string(),
        })
        .collect()
}
