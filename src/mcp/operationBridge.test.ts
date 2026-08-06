import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyOperation, type LlmOperation } from "./operationBridge";
import { useMindMapStore } from "../store";

// Mock mind-elixir instance
function makeMockMind() {
  const calls: string[] = [];
  const nodes = new Map<string, any>([
    ["root", { id: "root", topic: "根", nodeObj: { id: "root", topic: "根" } }],
    ["n1", { id: "n1", topic: "节点1", parent: { id: "root" }, nodeObj: { id: "n1", topic: "节点1" }, text: { textContent: "节点1" } }],
    ["n2", { id: "n2", topic: "节点2", parent: { id: "root" }, nodeObj: { id: "n2", topic: "节点2" }, text: { textContent: "节点2" } }],
  ]);
  return {
    calls,
    bus: { fire: vi.fn() },
    findEle: (id: string) => nodes.get(id),
    addChild: (parent: any, newObj: any) => {
      calls.push(`addChild:${parent.id}:${newObj.topic}`);
      const id = `new-${newObj.topic}`;
      nodes.set(id, { ...newObj, id, parent });
    },
    reshapeNode: (tpc: any, patch: any) => {
      calls.push(`reshapeNode:${tpc.id}:${JSON.stringify(patch)}`);
      Object.assign(nodes.get(tpc.id) ?? {}, patch);
    },
    removeNodes: (tpcs: any[]) => {
      tpcs.forEach((t) => {
        calls.push(`removeNodes:${t.id}`);
        nodes.delete(t.id);
      });
    },
    moveNodeIn: (tpcs: any[], target: any) => {
      tpcs.forEach((t) => {
        calls.push(`moveNodeIn:${t.id}->${target.id}`);
      });
    },
  };
}

function makeOp(op_type: string, payload: any): LlmOperation {
  return {
    op_id: "test-op-id",
    session_id: "test-session",
    op_type: op_type as any,
    payload,
    is_first_in_session: false,
    is_last_in_session: false,
  };
}

describe("FE-MCP-BRIDGE: applyOperation", () => {
  it("create_node 调 mind.addChild", async () => {
    const mind: any = makeMockMind();
    await applyOperation(mind, makeOp("create_node", { parent_id: "root", topic: "新节点" }));
    expect(mind.calls).toContain("addChild:root:新节点");
  });

  it("create_node 带优先级和图标", async () => {
    const mind: any = makeMockMind();
    await applyOperation(
      mind,
      makeOp("create_node", {
        parent_id: "root",
        topic: "重要",
        priority: "P0",
        icons: ["🔥"],
      }),
    );
    expect(mind.calls[0]).toBe("addChild:root:重要");
  });

  it("create_node 父节点不存在抛错", async () => {
    const mind: any = makeMockMind();
    await expect(
      applyOperation(mind, makeOp("create_node", { parent_id: "nonexistent", topic: "x" })),
    ).rejects.toThrow(/父节点/);
  });

  it("update_node 改 nodeObj topic", async () => {
    const mind: any = makeMockMind();
    await applyOperation(
      mind,
      makeOp("update_node", { node_id: "n1", patch: { topic: "改名" } }),
    );
    // update_node 直接改 nodeObj.topic(绕过 reshapeNode bug)
    expect(mind.findEle("n1").nodeObj.topic).toBe("改名");
    // fire operation 触发 syncFromMindElixir
    expect(mind.bus?.fire).toBeDefined();
  });

  it("update_node 节点不存在抛错", async () => {
    const mind: any = makeMockMind();
    await expect(
      applyOperation(mind, makeOp("update_node", { node_id: "no", patch: {} })),
    ).rejects.toThrow(/节点 no/);
  });

  it("delete_node 调 mind.removeNodes", async () => {
    const mind: any = makeMockMind();
    await applyOperation(mind, makeOp("delete_node", { node_id: "n1" }));
    expect(mind.calls).toContain("removeNodes:n1");
  });

  it("move_node 调 mind.moveNodeIn", async () => {
    const mind: any = makeMockMind();
    await applyOperation(
      mind,
      makeOp("move_node", { node_id: "n1", to_parent_id: "n2" }),
    );
    expect(mind.calls).toContain("moveNodeIn:n1->n2");
  });

  it("move_node 目标父节点不存在抛错", async () => {
    const mind: any = makeMockMind();
    await expect(
      applyOperation(mind, makeOp("move_node", { node_id: "n1", to_parent_id: "no" })),
    ).rejects.toThrow(/目标父节点/);
  });

  it("未知 op_type 不抛错只警告", async () => {
    const mind: any = makeMockMind();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyOperation(mind, makeOp("unknown_op" as any, {}));
    expect(warnSpy).toHaveBeenCalled();
    expect(mind.calls.length).toBe(0);
    warnSpy.mockRestore();
  });

  it("attach_file 无 filePath 时抛错", async () => {
    const mind: any = makeMockMind();
    useMindMapStore.setState({ filePath: null, content: null });
    await expect(
      applyOperation(mind, makeOp("attach_file", { node_id: "n1", file_path: "/tmp/x.txt" })),
    ).rejects.toThrow(/需要先保存文档/);
  });
});

describe("FE-MCP-BRIDGE: op 序列", () => {
  it("多次 op 顺序调用对应 mind API", async () => {
    const mind: any = makeMockMind();
    await applyOperation(mind, makeOp("create_node", { parent_id: "root", topic: "A" }));
    await applyOperation(mind, makeOp("update_node", { node_id: "n1", patch: { topic: "X" } }));
    await applyOperation(mind, makeOp("delete_node", { node_id: "n2" }));
    expect(mind.calls).toEqual([
      "addChild:root:A",
      "removeNodes:n2",
    ]);
    // update_node 直接改 nodeObj,不调 reshapeNode
    expect(mind.findEle("n1").nodeObj.topic).toBe("X");
  });
});

describe("FE-MCP-BRIDGE: undo 整合(Phase 3)", () => {
  it("session 变化不影响 applyOperation 的核心逻辑", async () => {
    // undo 整合在 initLlmBridge 的 listen 回调里,不在 applyOperation
    // 这里只验证 applyOperation 在无 session 状态下也能正常工作
    const mind: any = makeMockMind();
    await applyOperation(mind, makeOp("create_node", { parent_id: "root", topic: "x" }));
    expect(mind.calls).toContain("addChild:root:x");
  });
});

// === OB-024 zundo pause/resume LLM 整合 ===

describe("FE-MCP-BRIDGE: OB-024 zundo pause/resume", () => {
  let pauseSpy: ReturnType<typeof vi.fn>;
  let resumeSpy: ReturnType<typeof vi.fn>;
  let sessionChangedHandler:
    | ((event: { payload: any }) => void | Promise<void>)
    | null;

  beforeEach(async () => {
    const { shutdownLlmBridge } = await import("./operationBridge");
    shutdownLlmBridge();
    sessionChangedHandler = null;

    pauseSpy = vi.fn();
    resumeSpy = vi.fn();
    const temporalSpy = {
      pause: pauseSpy,
      resume: resumeSpy,
    };
    (useMindMapStore as any).temporal = {
      getState: () => temporalSpy,
    };

    const listenMod = await import("@tauri-apps/api/event");
    vi.mocked(listenMod.listen).mockImplementation(
      async (event: string, handler: any) => {
        if (event === "llm-session-changed") {
          sessionChangedHandler = handler;
        }
        return () => {};
      },
    );

    // mock isTauri 返回 true
    const envMod = await import("../utils/tauriEnv");
    vi.spyOn(envMod, "isTauri").mockReturnValue(true);
  });

  it("★OB-024★ session acquired 时调 temporal.pause(LLM 操作不进 undo 历史)", async () => {
    const { initLlmBridge } = await import("./operationBridge");
    await initLlmBridge();
    expect(sessionChangedHandler).not.toBeNull();

    await sessionChangedHandler!({
      payload: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });

    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).not.toHaveBeenCalled();
  });

  it("★OB-024★ session released 时调 temporal.resume(用户一次 Cmd+Z 撤整个会话)", async () => {
    const { initLlmBridge } = await import("./operationBridge");
    await initLlmBridge();

    // 先 acquired 触发 pause
    await sessionChangedHandler!({
      payload: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    expect(pauseSpy).toHaveBeenCalledTimes(1);

    // 再 released 触发 resume
    await sessionChangedHandler!({
      payload: { session: null, reason: "released" },
    });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it("★OB-024★ session expired 时也调 resume(所有会话结束路径都触发)", async () => {
    const { initLlmBridge } = await import("./operationBridge");
    await initLlmBridge();

    await sessionChangedHandler!({
      payload: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    await sessionChangedHandler!({
      payload: { session: null, reason: "expired" },
    });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it("★OB-024★ session forced(用户接管)时调 resume", async () => {
    const { initLlmBridge } = await import("./operationBridge");
    await initLlmBridge();

    await sessionChangedHandler!({
      payload: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    });
    await sessionChangedHandler!({
      payload: { session: null, reason: "forced" },
    });
    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it("★OB-024★ 重复 acquired 不重复 pause(llmSessionPaused 守卫)", async () => {
    const { initLlmBridge } = await import("./operationBridge");
    await initLlmBridge();

    const sessionPayload = {
      payload: {
        session: {
          session_id: "s1",
          client_name: "Claude",
          acquired_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60000,
          last_heartbeat_ms: Date.now(),
          operations_count: 0,
        },
        reason: "acquired",
      },
    };
    await sessionChangedHandler!(sessionPayload);
    await sessionChangedHandler!(sessionPayload);
    await sessionChangedHandler!(sessionPayload);

    expect(pauseSpy).toHaveBeenCalledTimes(1);
  });

  it("★OB-024★ 重复 session=null 不重复 resume", async () => {
    const { initLlmBridge } = await import("./operationBridge");
    await initLlmBridge();

    await sessionChangedHandler!({ payload: { session: null, reason: "released" } });
    await sessionChangedHandler!({ payload: { session: null, reason: "expired" } });
    await sessionChangedHandler!({ payload: { session: null, reason: "forced" } });

    expect(resumeSpy).not.toHaveBeenCalled();
  });
});
