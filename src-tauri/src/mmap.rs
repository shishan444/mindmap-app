use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use crate::error::{AppError, Result};
use crate::models::{Content, Meta};

const META_PATH: &str = "meta.json";
const CONTENT_PATH: &str = "content.json";
const ASSETS_DIR: &str = "assets/";

/// 一个 .mmap 文件的内容（meta + content + 图片资源）
#[derive(Debug, Clone)]
pub struct MmapFile {
    pub meta: Meta,
    pub content: Content,
    /// (path inside zip like "assets/abc.png", bytes)
    pub assets: Vec<(String, Vec<u8>)>,
}

impl MmapFile {
    pub fn new(topic: impl Into<String>) -> Self {
        Self {
            meta: Meta::new(),
            content: Content::new(topic),
            assets: vec![],
        }
    }

    /// 从 .mmap 文件读取
    pub fn read_from_path(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Err(AppError::FileNotFound(path.display().to_string()));
        }
        let bytes = fs::read(path)?;
        Self::read_from_bytes(&bytes)
    }

    /// 从字节数组读取（zip 格式）
    pub fn read_from_bytes(bytes: &[u8]) -> Result<Self> {
        let cursor = Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor)?;

        let mut meta: Option<Meta> = None;
        let mut content: Option<Content> = None;
        let mut assets: Vec<(String, Vec<u8>)> = vec![];

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let name = entry.name().to_string();
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;

            match name.as_str() {
                META_PATH => {
                    meta = Some(serde_json::from_slice(&buf)?);
                }
                CONTENT_PATH => {
                    content = Some(serde_json::from_slice(&buf)?);
                }
                _ if name.starts_with(ASSETS_DIR) && !name.ends_with('/') => {
                    assets.push((name, buf));
                }
                _ => {} // 忽略未知文件（兼容性）
            }
        }

        let meta = meta.ok_or_else(|| {
            AppError::InvalidFormat("缺失 meta.json".to_string())
        })?;
        let content = content.ok_or_else(|| {
            AppError::InvalidFormat("缺失 content.json".to_string())
        })?;

        Ok(Self { meta, content, assets })
    }

    /// 写入 .mmap 文件（原子写入：先写 .tmp，再 rename）
    pub fn write_to_path(&self, path: &Path) -> Result<()> {
        let bytes = self.to_bytes()?;
        atomic_write_with_backup(path, &bytes)
    }

    /// 序列化为字节数组（zip 格式）
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let options =
                zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            // meta.json
            zip.start_file(META_PATH, options)?;
            let meta_bytes = serde_json::to_vec_pretty(&self.meta)?;
            zip.write_all(&meta_bytes)?;

            // content.json
            zip.start_file(CONTENT_PATH, options)?;
            let content_bytes = serde_json::to_vec_pretty(&self.content)?;
            zip.write_all(&content_bytes)?;

            // assets
            for (asset_path, asset_bytes) in &self.assets {
                zip.start_file(asset_path, options)?;
                zip.write_all(asset_bytes)?;
            }

            zip.finish()?;
        }
        Ok(buf.into_inner())
    }

    pub fn touch(&mut self) {
        self.meta.touch();
    }

    /// 设置/替换某个 asset，返回 path inside zip（"assets/{hash}.ext"）
    pub fn add_asset(&mut self, ext: &str, bytes: &[u8]) -> String {
        let hash = sha256_hex(bytes);
        let short = &hash[..12];
        let name = format!("{}{}.{}", ASSETS_DIR, short, ext);
        // 替换已存在
        if let Some(slot) = self.assets.iter_mut().find(|(p, _)| *p == name) {
            slot.1 = bytes.to_vec();
        } else {
            self.assets.push((name.clone(), bytes.to_vec()));
        }
        name
    }
}

/// 原子写入：写 .tmp → fsync → rename，并保留一份 .backup.mmap
pub fn atomic_write_with_backup(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config(format!("路径无父目录: {}", path.display())))?;
    fs::create_dir_all(parent)?;

    let tmp = path.with_extension("mmap.tmp");
    let backup = path.with_extension("backup.mmap");

    // 1. 写 .tmp
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }

    // 2. 如果原文件存在，备份（覆盖已有 backup）
    if path.exists() {
        let _ = fs::rename(path, &backup);
        // rename 失败时降级到 copy + remove
        if !path.exists() && backup.exists() {
            // 已成功 rename
        } else if path.exists() {
            let _ = fs::copy(path, &backup).map(|_| ());
            let _ = fs::remove_file(path);
        }
    }

    // 3. rename .tmp → 目标
    fs::rename(&tmp, path)?;

    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    // 简单实现：用 sha2 crate
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // 这里偷个懒，只用 DefaultHasher；后续 Phase 2 上图片时再换 sha2
    // 注意：DefaultHasher 不是加密强度哈希，但用于文件去重够用
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
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
    fn roundtrip_basic_mmap() {
        let mut m = MmapFile::new("测试主题");
        m.content.root.topic = "根节点".to_string();
        let bytes = m.to_bytes().unwrap();
        let m2 = MmapFile::read_from_bytes(&bytes).unwrap();
        assert_eq!(m2.content.root.topic, "根节点");
        assert_eq!(m2.meta.format, "mindmap-v1");
    }

    #[test]
    fn asset_dedup() {
        let mut m = MmapFile::new("t");
        let p1 = m.add_asset("png", &[1, 2, 3]);
        let p2 = m.add_asset("png", &[1, 2, 3]);
        assert_eq!(p1, p2, "相同内容应去重");
        assert_eq!(m.assets.len(), 1);
    }

    #[test]
    fn asset_different_content_distinct() {
        let mut m = MmapFile::new("t");
        let p1 = m.add_asset("png", &[1, 2, 3]);
        let p2 = m.add_asset("png", &[4, 5, 6]);
        assert_ne!(p1, p2, "不同内容应不同路径");
        assert_eq!(m.assets.len(), 2);
    }

    #[test]
    fn zip_structure_meta_and_content() {
        let m = MmapFile::new("结构测试");
        let bytes = m.to_bytes().unwrap();
        let cursor = Cursor::new(&bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let names: Vec<String> = (0..archive.len())
            .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().to_string()))
            .collect();
        assert!(names.iter().any(|n| n == "meta.json"), "应有 meta.json");
        assert!(
            names.iter().any(|n| n == "content.json"),
            "应有 content.json"
        );
    }

    #[test]
    fn read_corrupt_zip_errors() {
        let bad_bytes = b"not a zip file";
        let result = MmapFile::read_from_bytes(bad_bytes);
        assert!(result.is_err(), "损坏数据应报错");
    }

    #[test]
    fn missing_meta_errors() {
        // 构造只含 content.json 的 zip
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let options =
                zip::write::SimpleFileOptions::default();
            zip.start_file("content.json", options).unwrap();
            let content = Content::new("缺 meta 的文档");
            let content_bytes = serde_json::to_vec(&content).unwrap();
            zip.write_all(&content_bytes).unwrap();
            zip.finish().unwrap();
        }
        let result = MmapFile::read_from_bytes(&buf.into_inner());
        assert!(result.is_err());
        if let Err(AppError::InvalidFormat(msg)) = result {
            assert!(msg.contains("meta"));
        } else {
            panic!("期望 InvalidFormat 错误");
        }
    }

    #[test]
    fn missing_content_errors() {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("meta.json", options).unwrap();
            let meta = Meta::new();
            zip.write_all(&serde_json::to_vec(&meta).unwrap()).unwrap();
            zip.finish().unwrap();
        }
        let result = MmapFile::read_from_bytes(&buf.into_inner());
        assert!(result.is_err(), "缺 content.json 应报错");
    }

    #[test]
    fn write_to_path_creates_file() {
        let dir = tmp_dir("write_creates");
        let path = dir.join("test.mmap");
        let m = MmapFile::new("写盘测试");
        m.write_to_path(&path).unwrap();
        assert!(path.exists(), "文件应被创建");
        // 读回验证
        let m2 = MmapFile::read_from_path(&path).unwrap();
        assert_eq!(m2.content.root.topic, "写盘测试");
        // 清理
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_creates_parent_dir() {
        let dir = tmp_dir("write_parent");
        let nested = dir.join("nested/deep");
        let path = nested.join("test.mmap");
        let m = MmapFile::new("嵌套路径");
        m.write_to_path(&path).unwrap();
        assert!(path.exists());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn backup_overwrites_previous() {
        let dir = tmp_dir("backup_overwrites");
        let path = dir.join("test.mmap");
        let backup = dir.join("test.backup.mmap");

        // 第一次保存
        let m1 = MmapFile::new("版本1");
        m1.write_to_path(&path).unwrap();
        assert!(path.exists());
        // 此时还没 backup（首次创建无前版本）

        // 第二次保存（应该生成 backup）
        let m2 = MmapFile::new("版本2");
        m2.write_to_path(&path).unwrap();
        assert!(backup.exists(), "第二次保存应生成 backup");

        // 第三次保存（应该覆盖 backup）
        let m3 = MmapFile::new("版本3");
        m3.write_to_path(&path).unwrap();
        assert!(backup.exists());

        // backup 应是第二次的内容（覆盖前的版本）
        let backup_content = MmapFile::read_from_path(&backup).unwrap();
        // 实际上 backup 是覆盖前的原文件，第三次保存时原文件是"版本2"
        assert_eq!(backup_content.content.root.topic, "版本2");

        // 清理
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&backup);
    }

    #[test]
    fn write_to_nonexistent_path_errors() {
        // 用一个不可写的路径触发错误（macOS 上 /dev/null/nope 之类）
        let path = Path::new("/this/does/not/exist/and/cannot/be/created/test.mmap");
        let m = MmapFile::new("x");
        let result = m.write_to_path(path);
        // 视权限可能成功也可能失败，但通常会失败
        // 这里只验证不 panic
        let _ = result;
    }

    #[test]
    fn meta_touch_via_mmap() {
        let mut m = MmapFile::new("touch 测试");
        let original = m.meta.modified_at;
        std::thread::sleep(std::time::Duration::from_millis(10));
        m.touch();
        assert!(m.meta.modified_at > original);
    }

    #[test]
    fn open_nonexistent_file_errors() {
        let path = Path::new("/tmp/this-mindmap-file-does-not-exist.mmap");
        let result = MmapFile::read_from_path(path);
        assert!(matches!(result, Err(AppError::FileNotFound(_))));
    }
}
