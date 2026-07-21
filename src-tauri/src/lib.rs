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
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 多窗口模式:外部二次启动 → 激活任意可见窗口(优先 main)
            // 如果 args 包含 .mmap 文件路径,在新窗口打开它
            use tauri::Manager;
            let visible: Vec<_> = app
                .webview_windows()
                .into_iter()
                .filter(|(_, w)| w.is_visible().unwrap_or(false))
                .collect();
            // 找 .mmap 参数(Dock 拖入)
            let mmap_arg = args.iter().find(|a| a.ends_with(".mmap"));
            if let Some(path) = mmap_arg {
                // 在新窗口打开该文件
                let _ = crate::commands::create_new_window(
                    app.clone(),
                    "open".into(),
                    Some(path.clone()),
                );
            } else if let Some((_, w)) = visible.first() {
                let _ = w.show();
                let _ = w.set_focus();
            } else if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
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
            if let Some((clean, removed)) = state::filter_test_reminders(&initial_reminders) {
                eprintln!(
                    "[mindmap] 检测到 {} 个测试残留 reminder,自动清理",
                    removed
                );
                if let Ok(path) = config::reminders_path() {
                    if path.exists() {
                        let backup = path.with_extension("json.polluted-backup");
                        let _ = std::fs::rename(&path, &backup);
                        eprintln!("[mindmap] 原文件已备份到 {}", backup.display());
                    }
                }
                if let Err(e) = config::save_reminders(&clean) {
                    eprintln!("[mindmap] 清理后写盘失败: {}", e);
                }
                initial_reminders = clean;
            }

            // 加载 config(多窗口共享)
            let initial_config = config::load_config().unwrap_or_else(|e| {
                eprintln!("[mindmap] 加载 config.json 失败,使用默认值: {}", e);
                crate::models::Config::default()
            });

            app.manage(state::AppState::new(initial_reminders, initial_config));

            // === 启动提醒调度器(后台线程,30s 轮询) ===
            // 多窗口模式:只在主窗口启动调度器(避免 N 窗口 N 个调度器并发触发)
            // 子窗口由主窗口 emit 事件接收到(通过 source_file 过滤)
            let main_window = app.get_webview_window("main");
            let is_main = main_window.is_some();
            if is_main {
                reminder_scheduler::spawn(app.handle().clone());
                println!("[mindmap] 主窗口启动,启动 reminder 调度器");
            } else {
                println!("[mindmap] 子窗口启动,跳过 reminder 调度器");
            }

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
            commands::create_new_window,
            commands::list_windows,
            commands::focus_window,
            commands::close_current_window,
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
    use tauri::Manager;
    match event.id().as_ref() {
        "tray-show" => {
            // 多窗口:激活任意可见窗口(优先 main)
            let visible = app
                .webview_windows()
                .into_iter()
                .filter(|(_, w)| w.is_visible().unwrap_or(false));
            let mut shown = false;
            for (_, w) in visible {
                let _ = w.set_focus();
                shown = true;
                break;
            }
            if !shown {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
        }
        "tray-hide" => {
            // 隐藏所有可见窗口
            for (_, w) in app.webview_windows() {
                let _ = w.hide();
            }
        }
        "tray-new" => {
            // 多窗口模式:直接创建新窗口
            let _ = crate::commands::create_new_window(app.clone(), "new".into(), None);
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
        // 多窗口模式:左键点击托盘切换"全部隐藏/显示"
        use tauri::Manager;
        let app = tray.app_handle();
        let windows = app.webview_windows();
        let any_visible = windows.values().any(|w| w.is_visible().unwrap_or(false));
        if any_visible {
            // 隐藏所有
            for (_, w) in &windows {
                let _ = w.hide();
            }
        } else {
            // 显示所有 + 主窗口 focus
            for (_, w) in &windows {
                let _ = w.show();
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
        }
    }
}

/// 窗口事件处理:
/// - 主窗口(main):点关闭按钮 → 隐藏到托盘(应用常驻)
/// - 子窗口(doc-N):点关闭按钮 → destroy(真正销毁)
/// 多窗口模式下,只有主窗口隐藏保留,子窗口直接销毁释放资源
fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    let label = window.label().to_string();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            println!("[window-event] CloseRequested label={}", label);
            if label == "main" {
                println!("[window-event] 主窗口隐藏到托盘");
                let _ = window.hide();
                api.prevent_close();
            } else {
                // 子窗口:默认 close 流程在某些 macOS 环境下卡住,
                // 导致 CloseRequested 无限循环触发。
                // 修复:prevent + 主动 destroy,绕过默认流程。
                println!("[window-event] 子窗口 {} prevent + destroy", label);
                api.prevent_close();
                // 用 spawn 异步 destroy,避免在 event handler 内同步销毁导致 panic
                let win_clone = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    println!("[window-event] 异步 destroy 子窗口");
                    let _ = win_clone.destroy();
                });
            }
        }
        WindowEvent::Destroyed => {
            println!("[window-event] Destroyed label={}", label);
        }
        WindowEvent::Focused(focused) => {
            if *focused {
                println!("[window-event] Focused label={}", label);
            }
        }
        _ => {}
    }
}
