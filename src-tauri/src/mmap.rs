//! mindmap 文件存储(Package 目录机制)。
//!
//! 架构:
//! ```text
//! xxx.mmap/                     ← 目录(macOS Package,Finder 显示为单文件)
//! ├── meta.json                 ← 文件元信息
//! ├── content.json              ← 思维导图数据(Node 树)
//! ├── content.json.bak          ← 单份备份(每次保存时刷新)
//! ├── assets/                   ← 附件原文件
//! │   └── {uuid}.{ext}
//! └── thumbnails/               ← 缩略图缓存(按 uuid 索引)
//!     └── {uuid}.png
//! ```
//!
//! - 不向后兼容旧 .mmap 单文件(zip+json 格式)
//! - 不打包/解压 zip,直接 fs 读写
//! - 改 content.json 不影响 assets(增量保存)
//! - 删除 mindmap 时,删整个目录(包括 assets/thumbnails)

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::models::{Content, Meta};

const META_FILE: &str = "meta.json";
const CONTENT_FILE: &str = "content.json";
const CONTENT_BAK_FILE: &str = "content.json.bak";
const ASSETS_DIR: &str = "assets";
const THUMBS_DIR: &str = "thumbnails";

/// 一个 .mmap 目录的内容(meta + content)。
/// assets 通过 `add_asset` / `get_asset_path` 单独管理,不缓存在内存。
#[derive(Debug, Clone)]
pub struct MmapFile {
    pub meta: Meta,
    pub content: Content,
    pub root: PathBuf,
}

impl MmapFile {
    /// 创建新的 mindmap 目录(如果已存在会先清空)
    pub fn create_at(path: impl Into<PathBuf>, topic: impl Into<String>) -> Result<Self> {
        let root = path.into();
        if root.exists() {
            // 已存在的目录,如果是空目录则用;否则报错
            let is_empty = root.read_dir().map(|mut it| it.next().is_none()).unwrap_or(true);
            if !is_empty {
                return Err(AppError::InvalidFormat(format!(
                    "目标目录已存在且非空: {}",
                    root.display()
                )));
            }
        } else {
            fs::create_dir_all(&root)?;
        }
        fs::create_dir_all(root.join(ASSETS_DIR))?;
        fs::create_dir_all(root.join(THUMBS_DIR))?;

        let mut file = Self {
            meta: Meta::new(),
            content: Content::new(topic),
            root: root.clone(),
        };
        file.save()?;
        Ok(file)
    }

    /// 打开已有 mindmap 目录
    pub fn open_at(path: impl Into<PathBuf>) -> Result<Self> {
        let root = path.into();
        if !root.exists() {
            return Err(AppError::FileNotFound(root.display().to_string()));
        }
        if !root.is_dir() {
            return Err(AppError::InvalidFormat(format!(
                "目标路径不是目录(可能是旧 .mmap 单文件格式,已不兼容): {}",
                root.display()
            )));
        }
        let meta_path = root.join(META_FILE);
        let content_path = root.join(CONTENT_FILE);
        if !meta_path.exists() {
            return Err(AppError::InvalidFormat("缺失 meta.json".to_string()));
        }
        if !content_path.exists() {
            return Err(AppError::InvalidFormat("缺失 content.json".to_string()));
        }

        let meta_bytes = fs::read(&meta_path)?;
        let meta: Meta = serde_json::from_slice(&meta_bytes)?;
        let content_bytes = fs::read(&content_path)?;
        let content: Content = serde_json::from_slice(&content_bytes)?;

        Ok(Self { meta, content, root })
    }

    /// 保存(原子写 content.json + 备份 + 更新 meta.json)
    pub fn save(&mut self) -> Result<()> {
        self.touch();
        fs::create_dir_all(&self.root)?;
        fs::create_dir_all(self.root.join(ASSETS_DIR))?;
        fs::create_dir_all(self.root.join(THUMBS_DIR))?;

        let content_path = self.root.join(CONTENT_FILE);
        let bak_path = self.root.join(CONTENT_BAK_FILE);
        let tmp_path = self.root.join(format!("{}.tmp", CONTENT_FILE));
        let meta_path = self.root.join(META_FILE);

        let content_bytes = serde_json::to_vec_pretty(&self.content)?;

        // 1. 写 .tmp
        {
            let mut f = fs::File::create(&tmp_path)?;
            f.write_all(&content_bytes)?;
            f.sync_all()?;
        }

        // 2. 备份原 content.json(如果存在)
        if content_path.exists() {
            let _ = fs::rename(&content_path, &bak_path);
            // rename 失败时降级 copy
            if !bak_path.exists() && content_path.exists() {
                let _ = fs::copy(&content_path, &bak_path).map(|_| ());
            }
        }

        // 3. rename .tmp → content.json
        fs::rename(&tmp_path, &content_path)?;

        // 4. 写 meta.json(独立,不参与备份逻辑)
        let meta_bytes = serde_json::to_vec_pretty(&self.meta)?;
        let meta_tmp = self.root.join(format!("{}.tmp", META_FILE));
        {
            let mut f = fs::File::create(&meta_tmp)?;
            f.write_all(&meta_bytes)?;
            f.sync_all()?;
        }
        fs::rename(&meta_tmp, &meta_path)?;

        Ok(())
    }

    pub fn touch(&mut self) {
        self.meta.touch();
    }

    /// 把附件字节写入 assets/{uuid}.{ext},返回 uuid(也用于后续 thumbnail 索引)
    pub fn add_asset(&self, uuid: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf> {
        let assets_dir = self.root.join(ASSETS_DIR);
        fs::create_dir_all(&assets_dir)?;
        let filename = format!("{}.{}", uuid, ext);
        let path = assets_dir.join(&filename);
        let mut f = fs::File::create(&path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(path)
    }

    /// 获取附件路径(只读)
    pub fn get_asset_path(&self, uuid: &str, ext: &str) -> PathBuf {
        self.root.join(ASSETS_DIR).join(format!("{}.{}", uuid, ext))
    }

    /// 移除附件(同时删缩略图)
    pub fn remove_asset(&self, uuid: &str, ext: &str) -> Result<()> {
        let asset_path = self.get_asset_path(uuid, ext);
        if asset_path.exists() {
            fs::remove_file(&asset_path)?;
        }
        let thumb_path = self.root.join(THUMBS_DIR).join(format!("{}.png", uuid));
        if thumb_path.exists() {
            let _ = fs::remove_file(&thumb_path);
        }
        Ok(())
    }

    /// 写缩略图(PNG)。QL 或图片压缩由调用方完成后传入字节。
    pub fn write_thumbnail(&self, uuid: &str, png_bytes: &[u8]) -> Result<PathBuf> {
        let thumbs_dir = self.root.join(THUMBS_DIR);
        fs::create_dir_all(&thumbs_dir)?;
        let path = thumbs_dir.join(format!("{}.png", uuid));
        let mut f = fs::File::create(&path)?;
        f.write_all(png_bytes)?;
        Ok(path)
    }

    /// 获取缩略图路径
    pub fn get_thumbnail_path(&self, uuid: &str) -> PathBuf {
        self.root.join(THUMBS_DIR).join(format!("{}.png", uuid))
    }

    /// assets 目录绝对路径
    pub fn assets_dir(&self) -> PathBuf {
        self.root.join(ASSETS_DIR)
    }

    /// thumbnails 目录绝对路径
    pub fn thumbnails_dir(&self) -> PathBuf {
        self.root.join(THUMBS_DIR)
    }
}

/// 删除整个 mindmap 目录(包括 assets 和 thumbnails)
pub fn remove_mmap_dir(path: &Path) -> Result<()> {
    if path.exists() && path.is_dir() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_dir(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "mindmap-test-{}-{}-{}",
            std::process::id(),
            name,
            chrono::Utc::now().timestamp_millis()
        ));
        p
    }

    #[test]
    fn create_at_writes_meta_and_content() {
        let dir = tmp_dir("create_basic");
        let path = dir.join("test.mmap");
        let _m = MmapFile::create_at(&path, "中心主题").unwrap();
        assert!(path.is_dir(), ".mmap 应是目录");
        assert!(path.join(META_FILE).exists());
        assert!(path.join(CONTENT_FILE).exists());
        assert!(path.join(ASSETS_DIR).is_dir());
        assert!(path.join(THUMBS_DIR).is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_at_roundtrip() {
        let dir = tmp_dir("open_roundtrip");
        let path = dir.join("test.mmap");
        {
            let mut m = MmapFile::create_at(&path, "测试主题").unwrap();
            m.content.root.topic = "改后主题".to_string();
            m.save().unwrap();
        }
        let m2 = MmapFile::open_at(&path).unwrap();
        assert_eq!(m2.content.root.topic, "改后主题");
        assert_eq!(m2.meta.format, "mindmap-v1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_generates_backup() {
        let dir = tmp_dir("save_backup");
        let path = dir.join("test.mmap");
        let mut m = MmapFile::create_at(&path, "版本1").unwrap();
        // 第一次 save 已经在 create_at 内执行,但还没备份(因为 content.json 不存在)
        // 第二次 save 应该生成备份
        m.content.root.topic = "版本2".to_string();
        m.save().unwrap();
        assert!(path.join(CONTENT_BAK_FILE).exists(), "二次保存应生成备份");

        // 备份内容应是版本1(覆盖前的版本)
        let bak_bytes = std::fs::read(path.join(CONTENT_BAK_FILE)).unwrap();
        let bak: Content = serde_json::from_slice(&bak_bytes).unwrap();
        assert_eq!(bak.root.topic, "版本1", "备份应是覆盖前的版本");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_asset_writes_file() {
        let dir = tmp_dir("add_asset");
        let path = dir.join("test.mmap");
        let m = MmapFile::create_at(&path, "t").unwrap();
        let asset_path = m.add_asset("uuid-1", "png", &[1, 2, 3]).unwrap();
        assert!(asset_path.exists());
        assert_eq!(asset_path.file_name().unwrap(), "uuid-1.png");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_asset_cleans() {
        let dir = tmp_dir("rm_asset");
        let path = dir.join("test.mmap");
        let m = MmapFile::create_at(&path, "t").unwrap();
        m.add_asset("uuid-2", "pdf", &[1]).unwrap();
        m.write_thumbnail("uuid-2", &[1, 2]).unwrap();
        assert!(m.get_asset_path("uuid-2", "pdf").exists());
        assert!(m.get_thumbnail_path("uuid-2").exists());

        m.remove_asset("uuid-2", "pdf").unwrap();
        assert!(!m.get_asset_path("uuid-2", "pdf").exists());
        assert!(!m.get_thumbnail_path("uuid-2").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_nonexistent_errors() {
        let path = Path::new("/tmp/this-does-not-exist-12345.mmap");
        let result = MmapFile::open_at(path);
        assert!(matches!(result, Err(AppError::FileNotFound(_))));
    }

    #[test]
    fn open_old_single_file_format_errors() {
        // 旧 .mmap 单文件(zip 格式)应报错(不兼容)
        let dir = tmp_dir("old_format");
        let path = dir.join("old.mmap");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"PK\x03\x04 old zip content").unwrap();
        let result = MmapFile::open_at(&path);
        assert!(matches!(result, Err(AppError::InvalidFormat(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_dir_missing_meta_errors() {
        let dir = tmp_dir("missing_meta");
        let path = dir.join("bad.mmap");
        std::fs::create_dir_all(&path).unwrap();
        // 只写 content.json,缺 meta.json
        std::fs::write(path.join(CONTENT_FILE), b"{}").unwrap();
        let result = MmapFile::open_at(&path);
        assert!(matches!(result, Err(AppError::InvalidFormat(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_mmap_dir_cleans_all() {
        let dir = tmp_dir("remove_all");
        let path = dir.join("test.mmap");
        let m = MmapFile::create_at(&path, "t").unwrap();
        m.add_asset("uuid-3", "png", &[1]).unwrap();
        assert!(path.exists());
        remove_mmap_dir(&path).unwrap();
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
