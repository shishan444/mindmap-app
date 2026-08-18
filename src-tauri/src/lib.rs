pub mod commands;
pub mod config;
pub mod dev_logger;
pub mod error;
pub mod markdown;
pub mod mcp;
pub mod mmap;
pub mod models;
pub mod opml;
pub mod reminder_scheduler;
pub mod freemind;
pub mod state;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
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

            // === 原生菜单栏(macOS 屏幕顶,替代窗口内 HTML 菜单栏) ===
            // 单导航设计:窗口内只留一条玻璃工具栏,菜单能力走系统菜单。
            // 动作经 menu-action 事件定向到焦点窗口的前端分发。
            let menu = build_app_menu(app)?;
            app.on_menu_event(|app, event| {
                let id = event.id().0.clone();
                println!("[menu] 收到菜单事件: {}", id);
                // 定向到焦点窗口(多窗口时菜单作用于当前文档)
                let target = app
                    .webview_windows()
                    .into_iter()
                    .find(|(_, w)| w.is_focused().unwrap_or(false))
                    .map(|(_, w)| w.label().to_string());
                let emit_result = match target {
                    Some(label) => app.emit_to(&label, "menu-action", id),
                    None => app.emit("menu-action", id),
                };
                if let Err(e) = emit_result {
                    eprintln!("[menu] 动作事件发送失败: {}", e);
                }
            });
            // ★ 根因修复:macOS 上 window.set_menu 不受支持(菜单只进 stash,
            // 不挂 NSApp mainMenu → 系统菜单栏一直是 AppKit 默认空壳)。
            // 必须用 AppHandle/Manager 级 set_menu(app-wide)。
            app.set_menu(menu)?;
            println!("[menu] app 级菜单已挂载(macOS NSApp mainMenu)");


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

            // === 启动 MCP server(Phase 2 完整集成,只在主窗口启动)===
            if is_main {
                // 读 config.mcp 决定是否启用
                let mcp_prefs = config::load_config().map(|c| c.mcp).unwrap_or_default();
                if !mcp_prefs.enabled {
                    println!("[mcp] config.mcp.enabled=false, 跳过 MCP server 启动");
                } else {
                let mirror = crate::mcp::shared_mirror();
                app.manage(mirror.clone());

                // Phase 2 状态:EditorMode + SessionRegistry + TauriEmitter
                let editor = crate::mcp::EditorMode::new();
                let registry = crate::mcp::SessionRegistry::new();
                app.manage(editor.clone());
                app.manage(registry.clone());

                // 启动 TTL 后台 task
                let editor_for_ttl = editor.clone();
                let registry_for_ttl = registry.clone();
                let app_handle_for_ttl = app.handle().clone();
                tauri::async_runtime::spawn(crate::mcp::run_ttl_loop(
                    editor_for_ttl,
                    registry_for_ttl,
                    move |expired_session_id| {
                        use tauri::Emitter;
                        let _ = app_handle_for_ttl.emit(
                            "llm-session-changed",
                            crate::mcp::SessionChange {
                                session: None,
                                reason: "expired".to_string(),
                            },
                        );
                        // expired_session_id 留作 log
                        eprintln!("[mcp] session {} TTL 过期,自动释放", expired_session_id);
                    },
                ));

                // 构造 emitter:同时发到 Tauri event(前端)+ 审计日志
                let tauri_emitter: std::sync::Arc<dyn crate::mcp::EventEmitter> =
                    std::sync::Arc::new(crate::mcp::event_emitter::TauriEmitter::new(app.handle().clone()));
                let audit_emitter: std::sync::Arc<dyn crate::mcp::EventEmitter> =
                    std::sync::Arc::new(crate::mcp::AuditLogger::new(
                        crate::mcp::audit_log::AuditLogger::default_path(),
                    ));
                let emitter: std::sync::Arc<dyn crate::mcp::EventEmitter> =
                    std::sync::Arc::new(crate::mcp::MultiEmitter::new(vec![tauri_emitter, audit_emitter]));

                // 构造 server 并注册所有 tools
                let mut server = crate::mcp::McpServer::new("mindmap-app", env!("CARGO_PKG_VERSION"));

                // 只读 tools(用 mirror 数据源)
                let readonly_source: std::sync::Arc<dyn crate::mcp::MindmapDataSource> = mirror.clone();
                server.register_tool(Box::new(crate::mcp::ReadMindmapTool::new(readonly_source.clone())));
                server.register_tool(Box::new(crate::mcp::SearchNodesTool::new(readonly_source.clone())));
                server.register_tool(Box::new(crate::mcp::GetNodeTool::new(readonly_source.clone())));
                server.register_tool(Box::new(crate::mcp::ListRemindersTool::new(readonly_source.clone())));
                server.register_tool(Box::new(crate::mcp::ExportMindmapTool::new(readonly_source.clone())));
                server.register_tool(Box::new(crate::mcp::GetEditStateTool::new(readonly_source)));

                // 会话 tools
                let session_ctx = crate::mcp::SessionToolContext::new(
                    editor.clone(),
                    registry.clone(),
                    emitter.clone(),
                );
                server.register_tool(Box::new(crate::mcp::AcquireSessionTool::new(session_ctx.clone())));
                server.register_tool(Box::new(crate::mcp::HeartbeatTool::new(session_ctx.clone())));
                server.register_tool(Box::new(crate::mcp::ReleaseSessionTool::new(session_ctx)));

                // 写 tools
                let write_ctx = crate::mcp::WriteToolContext::new(
                    crate::mcp::SessionToolContext::new(
                        editor.clone(),
                        registry.clone(),
                        emitter.clone(),
                    ),
                );
                server.register_tool(Box::new(crate::mcp::CreateNodeTool::new(write_ctx.clone())));
                server.register_tool(Box::new(crate::mcp::UpdateNodeTool::new(write_ctx.clone())));
                server.register_tool(Box::new(crate::mcp::DeleteNodeTool::new(write_ctx.clone())));
                server.register_tool(Box::new(crate::mcp::MoveNodeTool::new(write_ctx.clone())));
                server.register_tool(Box::new(crate::mcp::AttachFileTool::new(write_ctx)));

                // Prompts(Phase 3)
                server.register_prompt(Box::new(crate::mcp::ExpandTopicPrompt));
                server.register_prompt(Box::new(crate::mcp::FromMeetingNotesPrompt));
                server.register_prompt(Box::new(crate::mcp::SummarizeToOutlinePrompt));

                let app_state = crate::mcp::AppState {
                    server: std::sync::Arc::new(server),
                };
                let addr = format!("127.0.0.1:{}", mcp_prefs.port);
                let app_handle_clone = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match crate::mcp::start_server(&addr, app_state).await {
                        Ok(handle) => {
                            // ★ 关键:把 handle 存到 Tauri state,防止被 drop
                            // drop McpHttpHandle 会 abort 内部 task,导致 server 立刻关闭
                            app_handle_clone.manage(handle);
                            println!("[mcp] server listening on http://{}", addr);
                        }
                        Err(e) => eprintln!("[mcp] server start failed: {}", e),
                    }
                });
                } // end if mcp_prefs.enabled
            }

            // === 初始化开发模式日志（Phase 12）===
            // 即使失败也不阻塞启动
            if let Err(e) = dev_logger::init() {
                eprintln!("[mindmap] dev_logger init failed: {}", e);
            }

            // === dev 模式自动打开 DevTools ===
            // Tauri 2 默认 webview 不绑 Cmd+Option+I,需要主动 open_devtools()
            #[cfg(debug_assertions)]
            {
                if let Some(main_win) = app.get_webview_window("main") {
                    main_win.open_devtools();
                    println!("[mindmap] dev 模式:已自动打开 DevTools");
                }
            }

            Ok(())
        })
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::rebuild_menu,
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
            commands::__echo,
            commands::mcp_update_state,
            commands::llm_force_release,
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
            if let Some((_, w)) = visible.into_iter().next() {
                let _ = w.set_focus();
                shown = true;
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

/// 原生应用菜单(macOS 系统菜单栏)
/// 设计决策:F2 单导航修正 — 删除窗口内 HTML 菜单栏,菜单能力移到系统级,
/// 免费获得原生外观/行为与全局快捷键;动作通过 menu-action 事件桥接到前端。
/// 注意:撤销/重做不绑 accelerator — 前端已有 Cmd+Z 监听,避免双触发。
pub(crate) fn build_app_menu<M: tauri::Manager<tauri::Wry>>(
    app: &M,
) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let sep = PredefinedMenuItem::separator(app)?;

    // app 菜单(macOS 首个 submenu 显示为应用名)
    let m_about = MenuItem::with_id(app, "about", "关于 思维导图", true, None::<&str>)?;
    let m_prefs = MenuItem::with_id(app, "prefs", "偏好设置…", true, Some("cmdOrCtrl+,"))?;
    let pre_hide = PredefinedMenuItem::hide(app, None)?;
    let pre_quit = PredefinedMenuItem::quit(app, None)?;
    let app_menu = Submenu::with_id_and_items(
        app,
        "appmenu",
        "思维导图",
        true,
        &[&m_about, &sep, &m_prefs, &sep, &pre_hide, &pre_quit],
    )?;

    // 文件
    let f_new = MenuItem::with_id(app, "new", "新建文档", true, Some("cmdOrCtrl+n"))?;
    let f_open = MenuItem::with_id(app, "open", "打开…", true, Some("cmdOrCtrl+o"))?;
    let f_save = MenuItem::with_id(app, "save", "保存", true, Some("cmdOrCtrl+s"))?;
    // 最近文件动态子菜单(id 编码路径: open-recent:<path>)
    let mut recent_menu_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    if let Ok(rf) = crate::config::load_recent_files() {
        for f in rf.files.iter().take(5) {
            if let Ok(mi) = MenuItem::with_id(
                app,
                &format!("open-recent:{}", f.path),
                &f.name,
                true,
                None::<&str>,
            ) {
                recent_menu_items.push(mi);
            }
        }
    }
    use tauri::menu::IsMenuItem;
    let f_recent: Submenu<tauri::Wry> = if recent_menu_items.is_empty() {
        let empty: &[&dyn IsMenuItem<tauri::Wry>] = &[];
        Submenu::with_id_and_items(app, "recent", "打开最近文件", false, empty)?
    } else {
        let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = recent_menu_items.iter().map(|m| m as &dyn IsMenuItem<tauri::Wry>).collect();
        Submenu::with_id_and_items(app, "recent", "打开最近文件", true, &refs)?
    };
    let f_png = MenuItem::with_id(app, "export-png", "导出 PNG 图片", true, None::<&str>)?;
    let f_svg = MenuItem::with_id(app, "export-svg", "导出 SVG 矢量", true, None::<&str>)?;
    let f_md = MenuItem::with_id(app, "export-markdown", "导出 Markdown", true, None::<&str>)?;
    let f_opml = MenuItem::with_id(app, "export-opml", "导出 OPML", true, None::<&str>)?;
    let f_imd = MenuItem::with_id(app, "import-markdown", "导入 Markdown…", true, None::<&str>)?;
    let f_iopml = MenuItem::with_id(app, "import-opml", "导入 OPML…", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let file_menu = Submenu::with_id_and_items(
        app,
        "file",
        "文件",
        true,
        &[
            &f_new, &f_open, &f_recent, &f_save, &sep2, &f_png, &f_svg, &f_md, &f_opml, &sep3,
            &f_imd, &f_iopml,
        ],
    )?;

    // 编辑(undo/redo 走前端既有 Cmd+Z,不绑 accelerator)
    let e_undo = MenuItem::with_id(app, "undo", "撤销", true, None::<&str>)?;
    let e_redo = MenuItem::with_id(app, "redo", "重做", true, None::<&str>)?;
    let e_edit = MenuItem::with_id(app, "edit-text", "编辑节点文本", true, None::<&str>)?;
    let e_del = MenuItem::with_id(app, "delete-node", "删除节点", true, None::<&str>)?;
    let sep4 = PredefinedMenuItem::separator(app)?;
    let pre_cut = PredefinedMenuItem::cut(app, None)?;
    let pre_copy = PredefinedMenuItem::copy(app, None)?;
    let pre_paste = PredefinedMenuItem::paste(app, None)?;
    let pre_select_all = PredefinedMenuItem::select_all(app, None)?;
    let sep4b = PredefinedMenuItem::separator(app)?;
    let edit_menu = Submenu::with_id_and_items(
        app,
        "edit",
        "编辑",
        true,
        &[
            &e_undo, &e_redo, &sep4, &pre_cut, &pre_copy, &pre_paste, &pre_select_all, &sep4b,
            &e_edit, &e_del,
        ],
    )?;

    // 视图
    let v_layout = MenuItem::with_id(app, "auto-layout", "自动布局整理", true, Some("cmdOrCtrl+shift+l"))?;
    let v_sidebar = MenuItem::with_id(app, "toggle-sidebar", "切换侧边栏", true, Some("cmdOrCtrl+\\"))?;
    let view_menu = Submenu::with_id_and_items(
        app,
        "view",
        "视图",
        true,
        &[&v_layout, &v_sidebar],
    )?;

    // 插入
    let i_child = MenuItem::with_id(app, "add-child", "添加子节点", true, None::<&str>)?;
    let i_sib = MenuItem::with_id(app, "add-sibling", "添加兄弟节点", true, None::<&str>)?;
    let p0 = MenuItem::with_id(app, "prio-p0", "优先级 P0 · 紧急", true, None::<&str>)?;
    let p1 = MenuItem::with_id(app, "prio-p1", "优先级 P1 · 高", true, None::<&str>)?;
    let p2 = MenuItem::with_id(app, "prio-p2", "优先级 P2 · 中", true, None::<&str>)?;
    let p3 = MenuItem::with_id(app, "prio-p3", "优先级 P3 · 低", true, None::<&str>)?;
    let sep5 = PredefinedMenuItem::separator(app)?;
    let insert_menu = Submenu::with_id_and_items(
        app,
        "insert",
        "插入",
        true,
        &[&i_child, &i_sib, &sep5, &p0, &p1, &p2, &p3],
    )?;

    // 窗口(系统预定义:最小化/缩放)
    let pre_minimize = PredefinedMenuItem::minimize(app, None)?;
    let pre_maximize = PredefinedMenuItem::maximize(app, None)?;
    let window_menu = Submenu::with_id_and_items(
        app,
        "windowmenu",
        "窗口",
        true,
        &[&pre_minimize, &pre_maximize],
    )?;

    // 帮助
    let h_about = MenuItem::with_id(app, "about", "关于 思维导图", true, None::<&str>)?;
    let help_menu = Submenu::with_id_and_items(app, "help", "帮助", true, &[&h_about])?;

    Ok(Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &insert_menu, &window_menu, &help_menu],
    )?)
}

