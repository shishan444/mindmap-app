use std::path::{Path, PathBuf};

use crate::config::{
    self, app_data_dir, config_path, ensure_app_data_dir, load_config, load_recent_files,
    save_config, save_recent_files,
};
use crate::error::Result;
use crate::mmap::MmapFile;
use crate::models::{Config, Content, RecentFiles};

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

// ===== .mmap 文件操作 =====

/// 读取 .mmap 文件，返回 content（前端用的主要数据）
#[tauri::command]
pub fn open_mmap(path: String) -> Result<Content> {
    let p = PathBuf::from(&path);
    let mmap = MmapFile::read_from_path(&p)?;
    Ok(mmap.content)
}

/// 创建新文档（不写盘，仅返回默认 Content）
#[tauri::command]
pub fn new_mmap(topic: Option<String>) -> Result<Content> {
    let topic = topic.unwrap_or_else(|| "中心主题".to_string());
    Ok(Content::new(topic))
}

/// 保存到 .mmap 文件（原子写入 + 单份备份）
#[tauri::command]
pub fn save_mmap(path: String, content: Content) -> Result<()> {
    // 读已有文件的 meta（如果有），保留 created_at
    let p = PathBuf::from(&path);
    let mut meta = if p.exists() {
        match MmapFile::read_from_path(&p) {
            Ok(existing) => existing.meta,
            Err(_) => crate::models::Meta::new(),
        }
    } else {
        crate::models::Meta::new()
    };
    meta.touch();

    // 暂不处理 assets（Phase 2 才做图片）
    let mmap = MmapFile {
        meta,
        content,
        assets: vec![],
    };
    mmap.write_to_path(&p)
}

/// 把 last_opened_file 更新到 config（启动时恢复用）
#[tauri::command]
pub fn set_last_opened_file(path: Option<String>) -> Result<Config> {
    let mut cfg = load_config()?;
    cfg.last_opened_file = path;
    save_config(&cfg)?;
    Ok(cfg)
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
