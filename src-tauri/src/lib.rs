pub mod commands;
pub mod config;
pub mod error;
pub mod markdown;
pub mod mmap;
pub mod models;
pub mod opml;
pub mod reminder_scheduler;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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

            // === 启动提醒调度器（后台线程，30s 轮询）===
            reminder_scheduler::spawn(app.handle().clone());

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
