//! 提醒调度器：托盘进程内后台线程，定期轮询 reminders.json，
//! 到点触发（emit 事件给前端 + 后续可接入系统通知）。

use std::thread;
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use tauri::{AppHandle, Emitter};

use crate::models::Reminder;

const POLL_INTERVAL_SECS: u64 = 30;

/// 启动调度器线程（非阻塞，后台运行）
pub fn spawn(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
        if let Err(e) = poll_once(&app) {
            eprintln!("[reminder-scheduler] poll error: {}", e);
        }
    });
}

fn poll_once(app: &AppHandle) -> Result<(), String> {
    let idx = crate::config::load_reminders().map_err(|e| e.to_string())?;
    let now = Local::now();
    let mut dirty = false;
    let mut triggered: Vec<Reminder> = Vec::new();

    for r in idx.reminders.iter() {
        if !r.enabled {
            continue;
        }
        // 检查触发时间
        let should_fire = match parse_local_time(&r.trigger_at) {
            Some(t) => t <= now,
            None => false,
        };
        if !should_fire {
            continue;
        }
        // 已触发过且 1 分钟内不再重复触发
        if let Some(last) = r.last_triggered_at.as_ref() {
            if let Some(last_dt) = parse_local_time(last) {
                let elapsed = now.signed_duration_since(last_dt);
                if elapsed.num_minutes() < 1 {
                    continue;
                }
            }
        }

        // 触发！
        let mut triggered_reminder = r.clone();
        triggered_reminder.last_triggered_at = Some(now.format("%Y-%m-%dT%H:%M:%S").to_string());
        triggered_reminder.next_trigger_at = compute_next_trigger(&triggered_reminder, now);
        triggered.push(triggered_reminder);
        dirty = true;
    }

    if dirty {
        // 写回（更新 last_triggered_at 等）
        let mut new_idx = idx.clone();
        for fired in &triggered {
            if let Some(slot) = new_idx.reminders.iter_mut().find(|r| r.id == fired.id) {
                *slot = fired.clone();
            }
        }
        if let Err(e) = crate::config::save_reminders(&new_idx) {
            eprintln!("[reminder-scheduler] save error: {}", e);
        }

        // emit 事件给前端
        for r in &triggered {
            let _ = app.emit("reminder-triggered", r.clone());
            println!(
                "[reminder-scheduler] 🔔 triggered: {} (node: {})",
                r.title, r.node_id
            );
        }
    }

    Ok(())
}

fn parse_local_time(s: &str) -> Option<DateTime<Local>> {
    // 尝试多种格式
    let normalized = s.trim().replace(' ', "T");
    let try_formats = ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"];
    for fmt in &try_formats {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&normalized, fmt) {
            // 转换为 Local 时间
            if let Some(dt) = Local.from_local_datetime(&ndt).latest() {
                return Some(dt);
            }
            // fallback: UTC → Local
            let utc = TimeZone::from_utc_datetime(&chrono::Utc, &ndt);
            return Some(utc.with_timezone(&Local));
        }
    }
    None
}

/// 计算下次触发时间（如果有重复规则）
fn compute_next_trigger(r: &Reminder, now: DateTime<Local>) -> Option<String> {
    let rule = match &r.repeat_rule {
        Some(x) => x,
        None => return None, // 单次，无下次
    };
    match rule.rule_type.as_str() {
        "daily" => {
            // 下次：明日的 time
            let time_str = rule.time.clone().unwrap_or_else(|| "09:00".to_string());
            let parts: Vec<&str> = time_str.split(':').collect();
            let hour: u32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(9);
            let min: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            let next = now
                .date_naive()
                .succ_opt()?
                .and_hms_opt(hour, min, 0)?;
            let next_local = Local
                .from_local_datetime(&next)
                .latest()?;
            Some(next_local.format("%Y-%m-%dT%H:%M:%S").to_string())
        }
        "interval" => {
            let value = rule.value.unwrap_or(1) as i64;
            let unit = rule.unit.clone().unwrap_or_else(|| "hours".to_string());
            let dur = match unit.as_str() {
                "minutes" => chrono::Duration::minutes(value),
                "hours" => chrono::Duration::hours(value),
                "days" => chrono::Duration::days(value),
                _ => chrono::Duration::hours(value),
            };
            let next = now + dur;
            Some(next.format("%Y-%m-%dT%H:%M:%S").to_string())
        }
        _ => None,
    }
    .map(|s: String| s)
}

// 占位避免 unused import（DateTime 实际用了）
#[allow(dead_code)]
fn _silence() {
    let _: Option<DateTime<Local>> = None;
}
