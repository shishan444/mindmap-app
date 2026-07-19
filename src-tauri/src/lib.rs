pub mod commands;
pub mod config;
pub mod dev_logger;
pub mod error;
pub mod markdown;
pub mod mmap;
pub mod models;
pub mod opml;
pub mod reminder_scheduler;
pub mod freemind;
pub mod state;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

#[cfg(test)]
pub(crate) mod test_support {
    use std::sync::Mutex as StdMutex;
    /// 全局测试锁,串行化所有依赖 MINDMAP_TEST_DATA_DIR 的测试
    /// (避免多线程跑测试时 env var + 文件操作相互干扰)
    pub(crate) static ENV_TEST_LOCK: StdMutex<()> = StdMutex::new(());

    pub(crate) fn lock_env_test() -> std::sync::MutexGuard<'static, ()> {
        // SAFETY: 测试间没有 'static 数据依赖
        unsafe {
            std::mem::transmute::<
                std::sync::MutexGuard<'_, ()>,
                std::sync::MutexGuard<'static, ()>,
            >(ENV_TEST_LOCK.lock().unwrap())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 重复打开时激活已有窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 初始化应用数据目录（~/Library/Application Support/MindMap/）
            if let Err(e) = commands::init_app_data() {
                eprintln!("[mindmap] init_app_data 失败: {}", e);
            }
            match config::app_data_dir() {
                Ok(p) => println!("[mindmap] 数据目录: {}", p.display()),
                Err(e) => eprintln!("[mindmap] 无法获取数据目录: {}", e),
            }

            // === 创建托盘 ===
            setup_tray(app)?;

            // === 初始化全局共享状态(AppState) ===
            // 关键:用于避免 reminder 调度器和 commands 之间的写写冲突
            // 启动时加载 reminders.json 到内存,后续所有读写走 Mutex 串行化
            let mut initial_reminders = config::load_reminders().unwrap_or_else(|e| {
                eprintln!("[mindmap] 加载 reminders.json 失败,使用空集合: {}", e);
                crate::models::ReminderIndex { version: "1.0.0".into(), reminders: vec![] }
            });

            // === 清理测试数据污染(自动检测 + 备份) ===
            // 历史问题:测试代码曾通过 set_var + save_reminders 把 100+ 测试 reminder
            // 写到了真实 ~/Library/.../reminders.json。这里在启动时自动扫描,
            // 发现测试标记字符串(source_file="/tmp/test.mmap", title="a"/"target" 等)
            // 就备份原文件 + 用过滤后的干净数据启动。
            if let Some((clean, removed)) = state::filter_test_reminders(&initial_reminders) {
                eprintln!(
                    "[mindmap] 检测到 {} 个测试残留 reminder,自动清理",
                    removed
                );
                // 备份原文件(防止误删,便于追溯)
                if let Ok(path) = config::reminders_path() {
                    if path.exists() {
                        let backup = path.with_extension("json.polluted-backup");
                        let _ = std::fs::rename(&path, &backup);
                        eprintln!("[mindmap] 原文件已备份到 {}", backup.display());
                    }
                }
                // 用干净数据覆盖写盘
                if let Err(e) = config::save_reminders(&clean) {
                    eprintln!("[mindmap] 清理后写盘失败: {}", e);
                }
                initial_reminders = clean;
            }

            app.manage(state::AppState::new(initial_reminders));

            // === 启动提醒调度器（后台线程，30s 轮询）===
            reminder_scheduler::spawn(app.handle().clone());

            // === 初始化开发模式日志（Phase 12）===
            // 即使失败也不阻塞启动
            if let Err(e) = dev_logger::init() {
                eprintln!("[mindmap] dev_logger init failed: {}", e);
            }

            Ok(())
        })
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config_command,
            commands::get_app_data_dir,
            commands::get_recent_files,
            commands::add_recent_file,
            commands::toggle_pin_recent,
            commands::remove_recent_file,
            commands::open_mmap,
            commands::new_mmap,
            commands::save_mmap,
            commands::set_last_opened_file,
            commands::update_last_dirs,
            commands::init_app_data,
            commands::path_exists,
            commands::ping,
            commands::save_bytes,
            commands::export_markdown,
            commands::import_markdown_file,
            commands::import_markdown_string,
            commands::export_opml,
            commands::import_opml_file,
            commands::import_opml_string,
            commands::get_reminders,
            commands::upsert_reminder,
            commands::delete_reminder,
            commands::get_reminders_for_node,
            commands::attach_file_to_node,
            commands::replace_attached_file,
            commands::remove_attached_file,
            commands::open_attached_file,
            commands::reveal_attached_file,
            commands::read_thumbnail,
            commands::log_event,
            commands::is_dev_logger_ready,
            commands::import_freemind_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 创建 macOS 状态栏托盘：图标 + 菜单（显示/隐藏/退出）+ 左键切换显隐
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray-hide", "隐藏主窗口", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let new_doc = MenuItem::with_id(app, "tray-new", "新建思维导图", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出思维导图", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &hide, &sep1, &new_doc, &sep2, &quit])?;

    let default_icon = app
        .default_window_icon()
        .ok_or_else(|| "默认窗口图标未找到".to_string())?
        .clone();

    TrayIconBuilder::with_id("main-tray")
        .icon(default_icon)
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("思维导图")
        .on_menu_event(on_tray_menu_event)
        .on_tray_icon_event(on_tray_icon_event)
        .build(app)?;

    Ok(())
}

fn on_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "tray-show" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        "tray-hide" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        "tray-new" => {
            // 显示窗口，前端会处理新建逻辑（用户点工具栏的"新建"）
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
                // 通过事件让前端创建新文档
                let _ = window.emit("tray-action", "new");
            }
        }
        "tray-quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

fn on_tray_icon_event(tray: &TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        let app = tray.app_handle();
        if let Some(window) = app.get_webview_window("main") {
            match window.is_visible() {
                Ok(true) => {
                    let _ = window.hide();
                }
                _ => {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    }
}

/// 窗口事件处理：点关闭按钮时改为隐藏（保持托盘常驻）
fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        // 不真正关闭，只隐藏（托盘常驻策略）
        let _ = window.hide();
        api.prevent_close();
    }
}
