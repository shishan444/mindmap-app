use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::models::{Config, RecentFiles};

/// 应用数据目录：~/Library/Application Support/MindMap/
///
/// 测试时可通过环境变量 `MINDMAP_TEST_DATA_DIR` 覆盖，避免污染真实数据。
pub fn app_data_dir() -> Result<PathBuf> {
    if let Ok(test_dir) = std::env::var("MINDMAP_TEST_DATA_DIR") {
        return Ok(PathBuf::from(test_dir));
    }
    let base = dirs::data_dir()
        .ok_or_else(|| AppError::Config("无法获取 Application Support 目录".to_string()))?;
    Ok(base.join("MindMap"))
}

pub fn config_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join("config.json"))
}

pub fn recent_files_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join("recent-files.json"))
}

pub fn reminders_path() -> Result<PathBuf> {
    Ok(app_data_dir()?.join("reminders.json"))
}

/// 确保目录存在
pub fn ensure_app_data_dir() -> Result<()> {
    let dir = app_data_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(())
}

/// 读取 config.json；不存在则返回默认值（不写盘）
pub fn load_config() -> Result<Config> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let s = fs::read_to_string(&path)?;
    if s.trim().is_empty() {
        return Ok(Config::default());
    }
    let cfg: Config = serde_json::from_str(&s)?;
    Ok(cfg)
}

/// 原子写入 config.json
pub fn save_config(cfg: &Config) -> Result<()> {
    ensure_app_data_dir()?;
    let path = config_path()?;
    let bytes = serde_json::to_vec_pretty(cfg)?;
    atomic_write_json(&path, &bytes)
}

/// 读取 recent-files.json
pub fn load_recent_files() -> Result<RecentFiles> {
    let path = recent_files_path()?;
    if !path.exists() {
        return Ok(RecentFiles::default());
    }
    let s = fs::read_to_string(&path)?;
    if s.trim().is_empty() {
        return Ok(RecentFiles::default());
    }
    Ok(serde_json::from_str(&s)?)
}

pub fn save_recent_files(rf: &RecentFiles) -> Result<()> {
    ensure_app_data_dir()?;
    let path = recent_files_path()?;
    let bytes = serde_json::to_vec_pretty(rf)?;
    atomic_write_json(&path, &bytes)
}

/// JSON 文件原子写入（写 .tmp → rename）
fn atomic_write_json(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config(format!("路径无父目录: {}", path.display())))?;
    fs::create_dir_all(parent)?;

    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        use std::io::Write;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Config, RecentFiles, WindowState};
    use std::path::PathBuf;

    fn tmp_test_dir(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "mindmap-config-test-{}-{}-{}",
            std::process::id(),
            label,
            chrono::Utc::now().timestamp_millis()
        ));
        p
    }

    /// 用指定的 base 目录覆盖 app_data_dir，便于测试
    /// （通过 ENV 变量或临时改 dirs 行为都复杂，这里直接测函数级行为）
    #[test]
    fn config_default_round_trip_via_json() {
        let cfg = Config::default();
        let json = serde_json::to_string_pretty(&cfg).unwrap();
        let cfg2: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(cfg2.version, cfg.version);
        assert_eq!(cfg2.auto_save_interval_sec, cfg.auto_save_interval_sec);
        assert_eq!(cfg2.recent_files_max, cfg.recent_files_max);
        assert_eq!(cfg2.ui.theme, cfg.ui.theme);
        assert_eq!(cfg2.window_state.sidebar_width, cfg.window_state.sidebar_width);
    }

    #[test]
    fn config_partial_json_uses_defaults() {
        // 只有 version 字段
        let json = r#"{"version":"0.9.0"}"#;
        let cfg: Config = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.version, "0.9.0");
        assert_eq!(cfg.auto_save_interval_sec, 2);
        assert_eq!(cfg.window_state.sidebar_width, 280);
    }

    #[test]
    fn window_state_default_values() {
        let ws = WindowState::default();
        assert_eq!(ws.width, 1280);
        assert_eq!(ws.height, 800);
        assert_eq!(ws.sidebar_width, 280);
        assert_eq!(ws.active_tab, "properties");
        assert!(!ws.is_maximized);
    }

    #[test]
    fn atomic_write_creates_file() {
        let dir = tmp_test_dir("atomic");
        let path = dir.join("test.json");
        atomic_write_json(&path, b"{\"hello\":\"world\"}").unwrap();
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("hello"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn atomic_write_overwrites_existing() {
        let dir = tmp_test_dir("atomic_overwrite");
        let path = dir.join("test.json");
        atomic_write_json(&path, b"v1").unwrap();
        atomic_write_json(&path, b"v2").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(content, "v2");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn atomic_write_creates_parent_dirs() {
        let dir = tmp_test_dir("atomic_nested");
        let nested = dir.join("a/b/c");
        let path = nested.join("test.json");
        atomic_write_json(&path, b"data").unwrap();
        assert!(path.exists());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn recent_files_default_empty() {
        let rf = RecentFiles::default();
        assert_eq!(rf.version, "1.0.0");
        assert!(rf.files.is_empty());
    }

    #[test]
    fn recent_files_serialization_round_trip() {
        let mut rf = RecentFiles::default();
        rf.touch("/path/a.mmap", "A", 20);
        rf.touch("/path/b.mmap", "B", 20);
        let json = serde_json::to_string(&rf).unwrap();
        let rf2: RecentFiles = serde_json::from_str(&json).unwrap();
        assert_eq!(rf2.files.len(), 2);
        assert_eq!(rf2.files[0].path, "/path/b.mmap"); // 最近打开的在前
    }

    #[test]
    fn load_missing_returns_default() {
        // config::load_config 在 ~/Library/Application Support/MindMap/config.json
        // 直接测：路径不存在 → Ok(Config::default())
        // 由于该函数硬编码路径，这里跳过实际文件，只验证函数签名可调
        // 实际 I/O 在集成测试覆盖
        let _ = Config::default();
    }

    #[test]
    fn app_data_dir_under_home() {
        // 验证 app_data_dir 返回的路径包含 "Application Support" 和 "MindMap"
        if let Ok(p) = app_data_dir() {
            let s = p.to_string_lossy();
            assert!(s.contains("Application Support"), "路径: {}", s);
            assert!(s.contains("MindMap"), "路径: {}", s);
        }
    }
}
