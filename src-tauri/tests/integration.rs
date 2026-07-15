// Tauri command 集成测试：端到端验证 commands 的行为
//
// 通过 MINDMAP_TEST_DATA_DIR 环境变量覆盖数据目录，避免污染真实数据。
// 这些测试直接调用 commands::xxx 函数，不经过 Tauri runtime。

use mindmap_app_lib::commands;
use mindmap_app_lib::config;
use mindmap_app_lib::models::{Content, Node};
use std::path::PathBuf;
use std::sync::Mutex;

// 用 Mutex 确保测试串行（env var 是全局的，并行会冲突）
static TEST_LOCK: Mutex<()> = Mutex::new(());

/// 临时测试目录 guard：创建时设环境变量，drop 时清理文件 + 解除环境变量
struct TestDir {
    path: PathBuf,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl TestDir {
    fn new(label: &str) -> Self {
        let guard = TEST_LOCK.lock().unwrap();
        let mut p = std::env::temp_dir();
        p.push(format!(
            "mindmap-int-{}-{}-{}",
            std::process::id(),
            label,
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::create_dir_all(&p).unwrap();
        std::env::set_var("MINDMAP_TEST_DATA_DIR", &p);
        Self { path: p, _guard: guard }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        std::env::remove_var("MINDMAP_TEST_DATA_DIR");
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn make_content_with_children() -> Content {
    let mut root = Node::new("根节点");
    let mut child1 = Node::new("子1");
    child1.priority = Some(mindmap_app_lib::models::Priority::P0);
    child1.children.push(Node::new("孙1"));
    root.children.push(child1);
    root.children.push(Node::new("子2"));
    Content::new("根节点") // 用默认工厂保证 version 字段
}

#[test]
fn int_new_mmap_default() {
    let _td = TestDir::new("new_mmap");
    let c = commands::new_mmap(None).unwrap();
    assert_eq!(c.version, "1.0.0");
    assert!(!c.root.id.is_empty());
    assert_eq!(c.root.children.len(), 0);
}

#[test]
fn int_new_mmap_custom_topic() {
    let _td = TestDir::new("new_custom");
    let c = commands::new_mmap(Some("我的主题".into())).unwrap();
    assert_eq!(c.root.topic, "我的主题");
}

#[test]
fn int_save_open_roundtrip() {
    let _td = TestDir::new("roundtrip");
    let original = commands::new_mmap(Some("往返测试".into())).unwrap();
    let path = _td.path.join("test.mmap");
    commands::save_mmap(path.to_string_lossy().into(), original.clone()).unwrap();

    let loaded = commands::open_mmap(path.to_string_lossy().into()).unwrap();
    assert_eq!(loaded.version, original.version);
    assert_eq!(loaded.root.topic, original.root.topic);
    assert_eq!(loaded.root.id, original.root.id);
}

#[test]
fn int_save_creates_backup_on_second_write() {
    let _td = TestDir::new("backup");
    let path = _td.path.join("test.mmap");
    let backup = _td.path.join("test.backup.mmap");

    // 第一次保存（无 backup）
    let c1 = commands::new_mmap(Some("v1".into())).unwrap();
    commands::save_mmap(path.to_string_lossy().into(), c1).unwrap();
    assert!(!backup.exists());

    // 第二次保存（生成 backup，内容是 v1）
    let c2 = commands::new_mmap(Some("v2".into())).unwrap();
    commands::save_mmap(path.to_string_lossy().into(), c2).unwrap();
    assert!(backup.exists());

    let backup_content = commands::open_mmap(backup.to_string_lossy().into()).unwrap();
    assert_eq!(backup_content.root.topic, "v1");

    // 主文件应是 v2
    let main = commands::open_mmap(path.to_string_lossy().into()).unwrap();
    assert_eq!(main.root.topic, "v2");
}

#[test]
fn int_open_nonexistent_errors() {
    let _td = TestDir::new("missing");
    let result = commands::open_mmap("/tmp/does-not-exist-xxx.mmap".into());
    assert!(result.is_err());
}

#[test]
fn int_init_app_data_creates_files() {
    let _td = TestDir::new("init");
    commands::init_app_data().unwrap();
    let cfg_path = config::config_path().unwrap();
    let rem_path = config::reminders_path().unwrap();
    assert!(cfg_path.exists(), "config.json 应被创建");
    assert!(rem_path.exists(), "reminders.json 应被创建");
}

#[test]
fn int_config_save_load_roundtrip() {
    let _td = TestDir::new("config_rt");
    commands::init_app_data().unwrap();
    let mut cfg = commands::get_config().unwrap();
    cfg.auto_save_interval_sec = 10;
    cfg.ui.theme = "dark".into();
    cfg.window_state.sidebar_width = 350;
    commands::save_config_command(cfg.clone()).unwrap();

    let loaded = commands::get_config().unwrap();
    assert_eq!(loaded.auto_save_interval_sec, 10);
    assert_eq!(loaded.ui.theme, "dark");
    assert_eq!(loaded.window_state.sidebar_width, 350);
}

#[test]
fn int_recent_files_flow() {
    let _td = TestDir::new("recent_flow");
    commands::init_app_data().unwrap();

    // 添加 3 个文件
    let rf1 = commands::add_recent_file("/a.mmap".into(), "A".into()).unwrap();
    assert_eq!(rf1.files.len(), 1);
    let rf2 = commands::add_recent_file("/b.mmap".into(), "B".into()).unwrap();
    assert_eq!(rf2.files.len(), 2);
    let rf3 = commands::add_recent_file("/c.mmap".into(), "C".into()).unwrap();
    assert_eq!(rf3.files.len(), 3);

    // 最近打开的在前
    assert_eq!(rf3.files[0].path, "/c.mmap");

    // 重新打开 A，应移到最前
    let rf4 = commands::add_recent_file("/a.mmap".into(), "A".into()).unwrap();
    assert_eq!(rf4.files[0].path, "/a.mmap");
    assert_eq!(rf4.files.len(), 3);

    // pin B
    let rf5 = commands::toggle_pin_recent("/b.mmap".into()).unwrap();
    let b = rf5.files.iter().find(|f| f.path == "/b.mmap").unwrap();
    assert!(b.pinned);

    // 再加 D，B 应保留
    let _rf6 = commands::add_recent_file("/d.mmap".into(), "D".into()).unwrap();
    let rf7 = commands::get_recent_files().unwrap();
    let b_still = rf7.files.iter().find(|f| f.path == "/b.mmap");
    assert!(b_still.is_some(), "pinned 文件应保留");

    // 移除 A
    let rf8 = commands::remove_recent_file("/a.mmap".into()).unwrap();
    assert!(rf8.files.iter().find(|f| f.path == "/a.mmap").is_none());
}

#[test]
fn int_set_last_opened_file_persists() {
    let _td = TestDir::new("last_opened");
    commands::init_app_data().unwrap();
    let cfg = commands::set_last_opened_file(Some("/tmp/abc.mmap".into())).unwrap();
    assert_eq!(cfg.last_opened_file, Some("/tmp/abc.mmap".into()));

    let loaded = commands::get_config().unwrap();
    assert_eq!(loaded.last_opened_file, Some("/tmp/abc.mmap".into()));
}

#[test]
fn int_update_last_dirs_persists() {
    let _td = TestDir::new("update_dirs");
    commands::init_app_data().unwrap();
    let cfg = commands::update_last_dirs(
        Some("/new/open".into()),
        Some("/new/export".into()),
        Some("/new/import".into()),
    )
    .unwrap();
    assert_eq!(cfg.last_open_dir, Some("/new/open".into()));
    assert_eq!(cfg.last_export_dir, Some("/new/export".into()));
    assert_eq!(cfg.last_import_dir, Some("/new/import".into()));

    let loaded = commands::get_config().unwrap();
    assert_eq!(loaded.last_open_dir, Some("/new/open".into()));
}

#[test]
fn int_path_exists_works() {
    let _td = TestDir::new("path_exists");
    let exists = commands::path_exists("/tmp".into());
    assert!(exists);
    let not_exists = commands::path_exists("/nonexistent-xxx-yyy-zzz".into());
    assert!(!not_exists);
}

#[test]
fn int_ping_returns_pong() {
    let _td = TestDir::new("ping");
    let r = commands::ping();
    assert_eq!(r, "pong");
}

#[test]
fn int_save_mmap_with_complex_tree() {
    let _td = TestDir::new("complex_tree");
    let mut root = mindmap_app_lib::models::Node::new("根");
    let mut child = mindmap_app_lib::models::Node::new("子");
    child.priority = Some(mindmap_app_lib::models::Priority::P0);
    child.note = Some("重要节点".into());
    child.children.push(mindmap_app_lib::models::Node::new("孙"));
    root.children.push(child);

    let content = Content {
        version: "1.0.0".into(),
        root,
        canvas_state: Default::default(),
    };

    let path = _td.path.join("complex.mmap");
    commands::save_mmap(path.to_string_lossy().into(), content).unwrap();

    let loaded = commands::open_mmap(path.to_string_lossy().into()).unwrap();
    assert_eq!(loaded.root.children.len(), 1);
    let c = &loaded.root.children[0];
    assert_eq!(c.topic, "子");
    assert_eq!(c.priority, Some(mindmap_app_lib::models::Priority::P0));
    assert_eq!(c.note.as_deref(), Some("重要节点"));
    assert_eq!(c.children.len(), 1);
    assert_eq!(c.children[0].topic, "孙");
}

#[test]
fn int_save_mmap_preserves_created_at_across_saves() {
    let _td = TestDir::new("preserve_created");
    let path = _td.path.join("preserve.mmap");

    let c = commands::new_mmap(Some("主题".into())).unwrap();
    commands::save_mmap(path.to_string_lossy().into(), c.clone()).unwrap();

    let first = commands::open_mmap(path.to_string_lossy().into()).unwrap();
    let mmap_first =
        mindmap_app_lib::mmap::MmapFile::read_from_path(&path).unwrap();
    let created_first = mmap_first.meta.created_at;

    std::thread::sleep(std::time::Duration::from_millis(20));

    commands::save_mmap(path.to_string_lossy().into(), c.clone()).unwrap();
    let mmap_second =
        mindmap_app_lib::mmap::MmapFile::read_from_path(&path).unwrap();
    let created_second = mmap_second.meta.created_at;
    let modified_second = mmap_second.meta.modified_at;

    assert_eq!(
        created_first, created_second,
        "created_at 在多次保存中应保持不变"
    );
    assert!(
        modified_second > created_second,
        "modified_at 应大于 created_at"
    );
    let _ = first;
}

// ===== Contract tests：验证 Tauri command 输出的 JSON 格式契约 =====
// 这些测试防止 Phase 12 之前的 bug 复现：
// Vec 字段（children/icons/reminder_ids）必须总是序列化（即使空），
// 否则前端 TS 类型（必填）会拿到 undefined → 崩溃。

#[test]
fn int_contract_new_mmap_json_has_required_vec_fields() {
    let _td = TestDir::new("contract_new");
    let c = commands::new_mmap(Some("测试".into())).unwrap();
    let json = serde_json::to_string(&c).unwrap();
    // 必须包含这些字段（即使空数组）
    assert!(
        json.contains("\"children\":[]"),
        "new_mmap 输出必须含 children:[]，实际: {}",
        json
    );
    assert!(
        json.contains("\"icons\":[]"),
        "new_mmap 输出必须含 icons:[]，实际: {}",
        json
    );
    assert!(
        json.contains("\"reminder_ids\":[]"),
        "new_mmap 输出必须含 reminder_ids:[]，实际: {}",
        json
    );
    assert!(
        json.contains("\"style\":"),
        "new_mmap 输出必须含 style，实际: {}",
        json
    );
    assert!(
        json.contains("\"collapsed\":"),
        "new_mmap 输出必须含 collapsed，实际: {}",
        json
    );
}

#[test]
fn int_contract_save_open_roundtrip_preserves_vec_fields() {
    let _td = TestDir::new("contract_roundtrip");
    let path = _td.path.join("test.mmap");

    let c = commands::new_mmap(Some("根".into())).unwrap();
    commands::save_mmap(path.to_string_lossy().into(), c).unwrap();

    let loaded = commands::open_mmap(path.to_string_lossy().into()).unwrap();
    let json = serde_json::to_string(&loaded).unwrap();
    // 往返后仍必须含 Vec 字段
    assert!(
        json.contains("\"children\":[]"),
        "open_mmap 后 JSON 必须含 children:[]，实际: {}",
        json
    );
    assert!(
        json.contains("\"icons\":[]"),
        "open_mmap 后 JSON 必须含 icons:[]，实际: {}",
        json
    );
}

#[test]
fn int_contract_node_with_children_serializes_recursively() {
    let _td = TestDir::new("contract_nested");
    use mindmap_app_lib::models::{Node, Content};
    let mut root = Node::new("根");
    let mut child = Node::new("子");
    child.children.push(Node::new("孙")); // 孙的 children 是空 vec
    root.children.push(child);

    let c = Content {
        version: "1.0.0".into(),
        root,
        canvas_state: Default::default(),
    };
    let _ = c;
    let json = serde_json::to_string(&c).unwrap();
    // 孙节点的 children:[] 也必须存在
    // 数 children:[ 的出现次数（根 + 子 + 孙）
    let count = json.matches("\"children\":").count();
    assert!(
        count >= 3,
        "3 个节点都应有 children 字段，实际 {} 个，json: {}",
        count,
        json
    );
}

// make_content_with_children 当前未使用，但作为参考保留
#[allow(dead_code)]
fn _silence_warning() {
    let _ = make_content_with_children();
}
