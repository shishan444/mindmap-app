import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyOperation, type LlmOperation } from "./operationBridge";
import { useMindMapStore } from "../store";

// Mock mind-elixir instance
function makeMockMind() {
  const calls: string[] = [];
  const nodes = new Map<string, any>([
    ["root", { id: "root", topic: "根" }],
    ["n1", { id: "n1", topic: "节点1", parent: { id: "root" } }],
    ["n2", { id: "n2", topic: "节点2", parent: { id: "root" } }],
  ]);
  return {
    calls,
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
  it("create_node 调 mind.addChild", () => {
    const mind: any = makeMockMind();
    applyOperation(mind, makeOp("create_node", { parent_id: "root", topic: "新节点" }));
    expect(mind.calls).toContain("addChild:root:新节点");
  });

  it("create_node 带优先级和图标", () => {
    const mind: any = makeMockMind();
    applyOperation(
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

  it("update_node 调 mind.reshapeNode", () => {
    const mind: any = makeMockMind();
    applyOperation(
      mind,
      makeOp("update_node", { node_id: "n1", patch: { topic: "改名" } }),
    );
    expect(mind.calls[0]).toContain("reshapeNode:n1");
    expect(mind.calls[0]).toContain("改名");
  });

  it("update_node 节点不存在抛错", async () => {
    const mind: any = makeMockMind();
    await expect(
      applyOperation(mind, makeOp("update_node", { node_id: "no", patch: {} })),
    ).rejects.toThrow(/节点 no/);
  });

  it("delete_node 调 mind.removeNodes", () => {
    const mind: any = makeMockMind();
    applyOperation(mind, makeOp("delete_node", { node_id: "n1" }));
    expect(mind.calls).toContain("removeNodes:n1");
  });

  it("move_node 调 mind.moveNodeIn", () => {
    const mind: any = makeMockMind();
    applyOperation(
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

  it("未知 op_type 不抛错只警告", () => {
    const mind: any = makeMockMind();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyOperation(mind, makeOp("unknown_op" as any, {}));
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
  it("多次 op 顺序调用对应 mind API", () => {
    const mind: any = makeMockMind();
    applyOperation(mind, makeOp("create_node", { parent_id: "root", topic: "A" }));
    applyOperation(mind, makeOp("update_node", { node_id: "n1", patch: { topic: "X" } }));
    applyOperation(mind, makeOp("delete_node", { node_id: "n2" }));
    expect(mind.calls).toEqual([
      "addChild:root:A",
      expect.stringMatching(/^reshapeNode:n1:/),
      "removeNodes:n2",
    ]);
  });
});
