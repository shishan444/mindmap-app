/**
 * 计算节点 reminder 状态。
 *
 * 紧迫度排序:due > looming > future > done > paused
 * 一个节点有多 reminder 时,取最紧迫状态作为节点状态。
 * remainingRatio 用于驱动沙漏沙堆高度(0-1)。
 */
import type { Reminder } from "../types";
import type { ReminderState } from "../components/HourglassIcon";

const LOOMING_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟内为 looming

interface NodeReminderState {
  state: ReminderState;
  /** 剩余时间比例 0-1,只在 future/looming/due 有意义 */
  remainingRatio: number;
  /** 是否有任何活跃 reminder */
  hasActive: boolean;
}

/** 计算单个 reminder 的状态 */
export function computeSingleReminderState(r: Reminder, now: Date): ReminderState | null {
  if (!r.enabled) return "paused";
  if (r.status === "triggered" || r.status === "completed") return "done";

  const trigger = parseLocalTime(r.trigger_at);
  if (!trigger) return null;

  const diff = trigger.getTime() - now.getTime();
  if (diff <= 0) return "due";
  if (diff <= LOOMING_THRESHOLD_MS) return "looming";
  return "future";
}

/**
 * 计算节点的聚合状态(取最紧迫)
 */
export function computeNodeReminderState(
  reminders: Reminder[],
  nodeId: string,
  now: Date = new Date(),
): NodeReminderState {
  const nodeReminders = reminders.filter((r) => r.node_id === nodeId);
  if (nodeReminders.length === 0) {
    return { state: "future", remainingRatio: 1, hasActive: false };
  }

  // 收集所有状态
  const states = nodeReminders
    .map((r) => ({
      reminder: r,
      state: computeSingleReminderState(r, now),
    }))
    .filter((x) => x.state !== null) as {
    reminder: Reminder;
    state: ReminderState;
  }[];

  if (states.length === 0) {
    return { state: "future", remainingRatio: 1, hasActive: false };
  }

  // 紧迫度排序
  const priority: Record<ReminderState, number> = {
    due: 5,
    looming: 4,
    future: 3,
    done: 2,
    paused: 1,
  };

  // 取最紧迫
  const mostUrgent = states.reduce((acc, cur) =>
    priority[cur.state] > priority[acc.state] ? cur : acc,
  );

  // 计算 remainingRatio(基于最紧迫 reminder 的剩余时间)
  let remainingRatio = 1;
  if (mostUrgent.state === "future" || mostUrgent.state === "looming" || mostUrgent.state === "due") {
    const trigger = parseLocalTime(mostUrgent.reminder.trigger_at);
    if (trigger) {
      // 假设最大窗口是 24h,超出按 0/1 截断
      const totalWindow = 24 * 60 * 60 * 1000;
      const diff = trigger.getTime() - now.getTime();
      remainingRatio = Math.max(0, Math.min(1, diff / totalWindow));
    }
  } else if (mostUrgent.state === "done") {
    remainingRatio = 0;
  }

  return {
    state: mostUrgent.state,
    remainingRatio,
    hasActive: true,
  };
}

/** 解析 "2026-07-15T15:30:00" 或 "2026-07-15 15:30:00" 为 Date */
function parseLocalTime(s: string): Date | null {
  if (!s) return null;
  const normalized = s.trim().replace(" ", "T");
  // 加上本地时区后缀,确保按本地时间解析
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return d;
}
