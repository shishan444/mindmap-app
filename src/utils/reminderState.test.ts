import { describe, it, expect } from "vitest";
import { computeNodeReminderState, computeSingleReminderState } from "./reminderState";
import type { Reminder } from "../types";

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: overrides.id || "r1",
    node_id: overrides.node_id || "n1",
    source_file: overrides.source_file || "/tmp/test.mmap",
    title: overrides.title || "测试提醒",
    message: overrides.message || null,
    trigger_at: overrides.trigger_at || "2099-01-01T09:00:00",
    repeat_rule: overrides.repeat_rule || null,
    priority: overrides.priority || null,
    enabled: overrides.enabled ?? true,
    status: overrides.status || "pending",
    last_triggered_at: overrides.last_triggered_at || null,
    snoozed_until: overrides.snoozed_until || null,
    next_trigger_at: overrides.next_trigger_at || null,
    created_at: overrides.created_at || "2026-01-01T00:00:00Z",
    updated_at: overrides.updated_at || "2026-01-01T00:00:00Z",
  };
}

describe("FE-REMINDER: computeSingleReminderState", () => {
  const now = new Date("2026-07-18T10:00:00");

  it("未来(>5min)→ future", () => {
    const r = makeReminder({ trigger_at: "2026-07-18T11:00:00" }); // +1h
    expect(computeSingleReminderState(r, now)).toBe("future");
  });

  it("临近(≤5min)→ looming", () => {
    const r = makeReminder({ trigger_at: "2026-07-18T10:03:00" }); // +3min
    expect(computeSingleReminderState(r, now)).toBe("looming");
  });

  it("到期(now ≥ trigger)→ due", () => {
    const r = makeReminder({ trigger_at: "2026-07-18T09:00:00" }); // -1h
    expect(computeSingleReminderState(r, now)).toBe("due");
  });

  it("已触发 → done", () => {
    const r = makeReminder({ status: "triggered" });
    expect(computeSingleReminderState(r, now)).toBe("done");
  });

  it("禁用 → paused", () => {
    const r = makeReminder({ enabled: false });
    expect(computeSingleReminderState(r, now)).toBe("paused");
  });

  it("无效 trigger_at → null", () => {
    const r = makeReminder({ trigger_at: "invalid-date" });
    expect(computeSingleReminderState(r, now)).toBeNull();
  });
});

describe("FE-REMINDER: computeNodeReminderState", () => {
  const now = new Date("2026-07-18T10:00:00");

  it("无 reminder → hasActive=false", () => {
    const result = computeNodeReminderState([], "n1", now);
    expect(result.hasActive).toBe(false);
  });

  it("reminder 不属于该节点 → hasActive=false", () => {
    const r = makeReminder({ node_id: "n2", trigger_at: "2026-07-18T11:00:00" });
    const result = computeNodeReminderState([r], "n1", now);
    expect(result.hasActive).toBe(false);
  });

  it("取最紧迫状态(due > future)", () => {
    const r1 = makeReminder({ id: "r1", trigger_at: "2026-07-18T11:00:00" }); // future
    const r2 = makeReminder({ id: "r2", trigger_at: "2026-07-18T09:00:00" }); // due
    const result = computeNodeReminderState([r1, r2], "n1", now);
    expect(result.state).toBe("due");
    expect(result.hasActive).toBe(true);
  });

  it("取最紧迫状态(looming > future)", () => {
    const r1 = makeReminder({ id: "r1", trigger_at: "2026-07-18T11:00:00" }); // future
    const r2 = makeReminder({ id: "r2", trigger_at: "2026-07-18T10:03:00" }); // looming
    const result = computeNodeReminderState([r1, r2], "n1", now);
    expect(result.state).toBe("looming");
  });

  it("全部 done → done", () => {
    const r1 = makeReminder({ id: "r1", status: "triggered" });
    const r2 = makeReminder({ id: "r2", status: "completed" });
    const result = computeNodeReminderState([r1, r2], "n1", now);
    expect(result.state).toBe("done");
  });

  it("remainingRatio:未来越远 → 越接近 1", () => {
    const far = makeReminder({ trigger_at: "2026-07-18T20:00:00" }); // +10h
    const result = computeNodeReminderState([far], "n1", now);
    expect(result.remainingRatio).toBeGreaterThan(0.3);
    expect(result.remainingRatio).toBeLessThan(1);
  });

  it("禁用 reminder 不参与紧迫度比较", () => {
    const r1 = makeReminder({ id: "r1", enabled: false, trigger_at: "2026-07-18T09:00:00" });
    const r2 = makeReminder({ id: "r2", trigger_at: "2026-07-18T11:00:00" }); // future
    const result = computeNodeReminderState([r1, r2], "n1", now);
    // r1 是 paused(优先级低),r2 是 future,取 future
    expect(result.state).toBe("future");
  });
});
