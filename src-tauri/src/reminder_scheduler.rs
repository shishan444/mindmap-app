//! 提醒调度器：托盘进程内后台线程，定期轮询 reminders.json，
//! 到点触发（emit 事件给前端 + 发系统通知）。

use std::thread;
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDateTime, TimeZone};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

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
    use tauri::Manager;
    let state = app.state::<crate::state::AppState>();
    let now = Local::now();
    let mut triggered: Vec<Reminder> = Vec::new();

    // 关键:整个 load → check → modify → save 在同一个 Mutex 锁内完成
    // 避免与 commands::delete_reminder / upsert_reminder 之间的写写冲突
    state
        .modify_reminders(|idx| {
            for r in idx.reminders.iter() {
                if !should_fire_reminder(r, now) {
                    continue;
                }
                if is_within_dedup_window(r, now) {
                    continue;
                }
                // 收集触发的(后面 emit)
                let mut fired = r.clone();
                fired.last_triggered_at = Some(now.format("%Y-%m-%dT%H:%M:%S").to_string());
                fired.next_trigger_at = compute_next_trigger(&fired, now);
                triggered.push(fired);
            }

            // 在锁内更新触发的 reminder(last_triggered_at / next_trigger_at)
            for fired in &triggered {
                if let Some(slot) = idx.reminders.iter_mut().find(|r| r.id == fired.id) {
                    slot.last_triggered_at = fired.last_triggered_at.clone();
                    slot.next_trigger_at = fired.next_trigger_at.clone();
                }
            }
            Ok(())
        })
        .map_err(|e| e.to_string())?;

    // emit + 系统通知在锁外(避免长时间持锁)
    if !triggered.is_empty() {
        let enabled = read_system_notification_enabled(app);
        for r in &triggered {
            let _ = app.emit("reminder-triggered", r.clone());
            if enabled {
                let mut builder = app.notification().builder().title(&r.title);
                if let Some(msg) = r.message.as_ref() {
                    builder = builder.body(msg);
                }
                if let Err(e) = builder.show() {
                    eprintln!("[reminder-scheduler] 系统通知失败: {}", e);
                }
            }
            println!(
                "[reminder-scheduler] 🔔 triggered: {} (node: {})",
                r.title, r.node_id
            );
        }
    }

    Ok(())
}

/// 读 config.reminder.system_notification_enabled（默认 true，配置读取失败时也默认开启）
fn read_system_notification_enabled(_app: &AppHandle) -> bool {
    match crate::config::load_config() {
        Ok(cfg) => cfg.reminder.system_notification_enabled,
        Err(_) => true,
    }
}

/// 判断 reminder 在 now 时刻是否应该触发(不包含去重逻辑)。
///
/// Bug1(7022507)修复:优先检查 next_trigger_at(每次触发后会更新),
/// fallback 到 trigger_at(单次 reminder 或首次触发前的 daily/interval)。
/// 历史 bug 是只用 trigger_at,导致 daily 提醒每 90s 重复触发整天不停。
pub(crate) fn should_fire_reminder(r: &Reminder, now: DateTime<Local>) -> bool {
    if !r.enabled {
        return false;
    }
    let check_time = r.next_trigger_at.as_ref().unwrap_or(&r.trigger_at);
    match parse_local_time(check_time) {
        Some(t) => t <= now,
        None => false,
    }
}

/// 判断 reminder 是否在去重窗口内(1 分钟内已触发过,避免重复)。
pub(crate) fn is_within_dedup_window(r: &Reminder, now: DateTime<Local>) -> bool {
    if let Some(last) = r.last_triggered_at.as_ref() {
        if let Some(last_dt) = parse_local_time(last) {
            let elapsed = now.signed_duration_since(last_dt);
            return elapsed.num_minutes() < 1;
        }
    }
    false
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
pub(crate) fn compute_next_trigger(r: &Reminder, now: DateTime<Local>) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Reminder, RepeatRule};
    use chrono::Utc;

    fn make_reminder(trigger_at: &str, next_trigger_at: Option<&str>) -> Reminder {
        Reminder {
            id: "test-id".to_string(),
            node_id: "node-1".to_string(),
            source_file: "/tmp/test.mmap".to_string(),
            title: "test".to_string(),
            message: None,
            trigger_at: trigger_at.to_string(),
            repeat_rule: None,
            priority: None,
            enabled: true,
            status: None,
            last_triggered_at: None,
            snoozed_until: None,
            next_trigger_at: next_trigger_at.map(|s| s.to_string()),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    fn now_at(year: i32, month: u32, day: u32, hour: u32, min: u32, sec: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(year, month, day, hour, min, sec).unwrap()
    }

    // === Bug1(7022507)回归:should_fire_reminder 优先 next_trigger_at ===

    #[test]
    fn test_should_fire_uses_next_trigger_at_when_present() {
        // Bug1 场景:daily reminder,trigger_at 是昨天 09:00,
        // next_trigger_at 是今天 09:00(已更新过)
        // now 是今天 09:30 → 应触发
        let r = make_reminder(
            "2026-08-03T09:00:00", // 昨天 trigger_at(过时)
            Some("2026-08-04T09:00:00"), // 今天 next_trigger_at
        );
        let now = now_at(2026, 8, 4, 9, 30, 0);
        assert!(should_fire_reminder(&r, now), "now >= next_trigger_at 应触发");
    }

    #[test]
    fn test_should_fire_uses_next_trigger_at_even_if_trigger_at_in_future() {
        // 关键验证:即使 trigger_at 在未来,只要 next_trigger_at <= now 也触发
        // 这正是 Bug1 修复的核心 — 不能 fallback 到 trigger_at
        let r = make_reminder(
            "2026-08-10T09:00:00", // trigger_at 在未来(假设配错了)
            Some("2026-08-04T09:00:00"), // next_trigger_at 已到
        );
        let now = now_at(2026, 8, 4, 9, 30, 0);
        assert!(should_fire_reminder(&r, now));
    }

    #[test]
    fn test_should_fire_fallback_to_trigger_at_when_no_next() {
        // 首次触发前 next_trigger_at 是 None → fallback 到 trigger_at
        let r = make_reminder("2026-08-04T09:00:00", None);
        let now = now_at(2026, 8, 4, 9, 30, 0);
        assert!(should_fire_reminder(&r, now));
    }

    #[test]
    fn test_should_fire_false_when_next_trigger_in_future() {
        // next_trigger_at 在未来 → 不触发(这正是 Bug1 修复后该有的行为)
        let r = make_reminder(
            "2026-08-03T09:00:00",
            Some("2026-08-04T10:00:00"), // 还没到
        );
        let now = now_at(2026, 8, 4, 9, 30, 0);
        assert!(!should_fire_reminder(&r, now));
    }

    #[test]
    fn test_should_fire_false_when_disabled() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.enabled = false;
        let now = now_at(2026, 8, 4, 9, 30, 0);
        assert!(!should_fire_reminder(&r, now));
    }

    #[test]
    fn test_should_fire_false_when_parse_fail() {
        let r = make_reminder("not-a-valid-time", None);
        let now = now_at(2026, 8, 4, 9, 30, 0);
        assert!(!should_fire_reminder(&r, now));
    }

    // === Bug1(7022507)回归:daily 不应重复触发 ===

    #[test]
    fn test_daily_does_not_refire_within_same_day_after_trigger() {
        // Bug1 现场:daily 09:00 reminder,触发后 next_trigger_at 应为明日 09:00
        // → 同一天 09:01 / 09:30 / 23:59 都不应再触发
        let mut r = make_reminder(
            "2026-08-03T09:00:00",
            Some("2026-08-04T09:00:00"), // 假设这是触发后已更新的值
        );
        r.repeat_rule = Some(RepeatRule {
            rule_type: "daily".to_string(),
            time: Some("09:00".to_string()),
            value: None,
            unit: None,
        });
        // 触发时刻:now = 2026-08-04 09:00(刚好到点)
        let now_triggered = now_at(2026, 8, 4, 9, 0, 0);
        assert!(should_fire_reminder(&r, now_triggered));

        // compute_next_trigger 计算下次
        let next = compute_next_trigger(&r, now_triggered);
        assert_eq!(next.as_deref(), Some("2026-08-05T09:00:00"));

        // 模拟触发后状态:更新 next_trigger_at
        r.next_trigger_at = next;
        // 同一天晚些时候(09:30, 12:00, 23:59)都不应触发
        assert!(!should_fire_reminder(&r, now_at(2026, 8, 4, 9, 30, 0)));
        assert!(!should_fire_reminder(&r, now_at(2026, 8, 4, 12, 0, 0)));
        assert!(!should_fire_reminder(&r, now_at(2026, 8, 4, 23, 59, 0)));
        // 次日 09:00 应再次触发
        assert!(should_fire_reminder(&r, now_at(2026, 8, 5, 9, 0, 0)));
    }

    // === 去重窗口 ===

    #[test]
    fn test_dedup_window_blocks_refire_within_1_minute() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.last_triggered_at = Some("2026-08-04T09:00:30".to_string()); // 30s 前触发过
        let now = now_at(2026, 8, 4, 9, 0, 45);
        assert!(is_within_dedup_window(&r, now));
    }

    #[test]
    fn test_dedup_window_allows_refire_after_1_minute() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.last_triggered_at = Some("2026-08-04T09:00:00".to_string()); // 1 分钟前
        let now = now_at(2026, 8, 4, 9, 1, 1);
        assert!(!is_within_dedup_window(&r, now));
    }

    #[test]
    fn test_dedup_window_no_last_triggered_is_false() {
        let r = make_reminder("2026-08-04T09:00:00", None);
        let now = now_at(2026, 8, 4, 9, 0, 0);
        assert!(!is_within_dedup_window(&r, now));
    }

    // === compute_next_trigger ===

    #[test]
    fn test_compute_next_trigger_no_rule_returns_none() {
        let r = make_reminder("2026-08-04T09:00:00", None);
        let now = now_at(2026, 8, 4, 9, 0, 0);
        assert_eq!(compute_next_trigger(&r, now), None);
    }

    #[test]
    fn test_compute_next_trigger_daily_tomorrow_same_time() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.repeat_rule = Some(RepeatRule {
            rule_type: "daily".to_string(),
            time: Some("09:00".to_string()),
            value: None,
            unit: None,
        });
        let now = now_at(2026, 8, 4, 9, 0, 0);
        assert_eq!(
            compute_next_trigger(&r, now).as_deref(),
            Some("2026-08-05T09:00:00")
        );
    }

    #[test]
    fn test_compute_next_trigger_daily_default_time_when_missing() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.repeat_rule = Some(RepeatRule {
            rule_type: "daily".to_string(),
            time: None, // 缺失 → 默认 09:00
            value: None,
            unit: None,
        });
        let now = now_at(2026, 8, 4, 10, 30, 0);
        assert_eq!(
            compute_next_trigger(&r, now).as_deref(),
            Some("2026-08-05T09:00:00")
        );
    }

    #[test]
    fn test_compute_next_trigger_interval_hours() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.repeat_rule = Some(RepeatRule {
            rule_type: "interval".to_string(),
            time: None,
            value: Some(3),
            unit: Some("hours".to_string()),
        });
        let now = now_at(2026, 8, 4, 9, 0, 0);
        assert_eq!(
            compute_next_trigger(&r, now).as_deref(),
            Some("2026-08-04T12:00:00")
        );
    }

    #[test]
    fn test_compute_next_trigger_interval_minutes() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.repeat_rule = Some(RepeatRule {
            rule_type: "interval".to_string(),
            time: None,
            value: Some(30),
            unit: Some("minutes".to_string()),
        });
        let now = now_at(2026, 8, 4, 9, 0, 0);
        assert_eq!(
            compute_next_trigger(&r, now).as_deref(),
            Some("2026-08-04T09:30:00")
        );
    }

    #[test]
    fn test_compute_next_trigger_interval_days() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.repeat_rule = Some(RepeatRule {
            rule_type: "interval".to_string(),
            time: None,
            value: Some(2),
            unit: Some("days".to_string()),
        });
        let now = now_at(2026, 8, 4, 9, 0, 0);
        assert_eq!(
            compute_next_trigger(&r, now).as_deref(),
            Some("2026-08-06T09:00:00")
        );
    }

    #[test]
    fn test_compute_next_trigger_unknown_rule_type_returns_none() {
        let mut r = make_reminder("2026-08-04T09:00:00", None);
        r.repeat_rule = Some(RepeatRule {
            rule_type: "weekly".to_string(), // 未支持
            time: Some("09:00".to_string()),
            value: None,
            unit: None,
        });
        let now = now_at(2026, 8, 4, 9, 0, 0);
        assert_eq!(compute_next_trigger(&r, now), None);
    }

    // === parse_local_time ===

    #[test]
    fn test_parse_local_time_seconds_format() {
        let dt = parse_local_time("2026-08-04T09:30:45");
        assert!(dt.is_some());
    }

    #[test]
    fn test_parse_local_time_minute_format() {
        let dt = parse_local_time("2026-08-04T09:30");
        assert!(dt.is_some());
    }

    #[test]
    fn test_parse_local_time_space_separator() {
        let dt = parse_local_time("2026-08-04 09:30:00");
        assert!(dt.is_some());
    }

    #[test]
    fn test_parse_local_time_invalid() {
        assert!(parse_local_time("invalid").is_none());
        assert!(parse_local_time("").is_none());
    }
}
