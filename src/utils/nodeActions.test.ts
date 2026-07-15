import { describe, it, expect, vi } from "vitest";
import {
  addChildToSelected,
  addSiblingToSelected,
  editSelectedNode,
  deleteSelectedNode,
  setTopicForSelected,
  selectNode,
  canDeleteNode,
  findNode,
  type MindInstanceLike,
} from "./nodeActions";

function makeMockMind(overrides: Partial<MindInstanceLike> = {}): MindInstanceLike {
  const rootId = overrides.nodeData?.id ?? "root";
  const nodes: Record<string, any> = {
    [rootId]: { id: rootId, topic: "根" },
    child1: { id: "child1", topic: "子1" },
    child2: { id: "child2", topic: "子2" },
  };
  return {
    nodeData: { id: rootId },
    getObjById: vi.fn((id: string) => nodes[id] || null),
    addChild: vi.fn().mockResolvedValue(undefined),
    insertSibling: vi.fn().mockResolvedValue(undefined),
    beginEdit: vi.fn().mockResolvedValue(undefined),
    removeNodes: vi.fn().mockResolvedValue(undefined),
    selectNode: vi.fn(),
    setNodeTopic: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("FE-NODE-ACT: findNode", () => {
  it("FE-NA-01: 找到节点", () => {
    const mind = makeMockMind();
    const node = findNode(mind, "child1");
    expect(node).not.toBeNull();
    expect(node.id).toBe("child1");
  });

  it("FE-NA-02: 不存在的 id 返回 null", () => {
    const mind = makeMockMind();
    expect(findNode(mind, "not-exist")).toBeNull();
  });

  it("FE-NA-03: mind=null 返回 null", () => {
    expect(findNode(null, "any")).toBeNull();
  });

  it("FE-NA-04: id=null 返回 null", () => {
    const mind = makeMockMind();
    expect(findNode(mind, null)).toBeNull();
  });

  it("FE-NA-05: mind.getObjById 不是函数返回 null", () => {
    const mind = { nodeData: { id: "root" } } as any;
    expect(findNode(mind, "root")).toBeNull();
  });

  it("FE-NA-06: getObjById 抛错时返回 null（不 propagate）", () => {
    const mind = makeMockMind({
      getObjById: vi.fn(() => {
        throw new Error("boom");
      }),
    });
    expect(findNode(mind, "x")).toBeNull();
  });
});

describe("FE-NODE-ACT: addChildToSelected", () => {
  it("FE-NA-10: 选中非根节点 → 调用 addChild", () => {
    const mind = makeMockMind();
    const ok = addChildToSelected(mind, "child1");
    expect(ok).toBe(true);
    expect(mind.addChild).toHaveBeenCalledWith(expect.objectContaining({ id: "child1" }));
  });

  it("FE-NA-11: 选中根节点 → 也可加子（根允许加子）", () => {
    const mind = makeMockMind();
    const ok = addChildToSelected(mind, "root");
    expect(ok).toBe(true);
    expect(mind.addChild).toHaveBeenCalledTimes(1);
  });

  it("FE-NA-12: 无选中节点 → no-op 返回 false", () => {
    const mind = makeMockMind();
    const ok = addChildToSelected(mind, null);
    expect(ok).toBe(false);
    expect(mind.addChild).not.toHaveBeenCalled();
  });

  it("FE-NA-13: mind=null → no-op", () => {
    expect(addChildToSelected(null, "x")).toBe(false);
  });

  it("FE-NA-14: mind.addChild 不存在 → no-op", () => {
    const mind = makeMockMind({ addChild: undefined });
    expect(addChildToSelected(mind, "child1")).toBe(false);
  });
});

describe("FE-NODE-ACT: addSiblingToSelected", () => {
  it("FE-NA-20: 选中非根节点 after → 调用 insertSibling('after')", () => {
    const mind = makeMockMind();
    const ok = addSiblingToSelected(mind, "child1", "after");
    expect(ok).toBe(true);
    expect(mind.insertSibling).toHaveBeenCalledWith("after", expect.objectContaining({ id: "child1" }));
  });

  it("FE-NA-21: 选中非根节点 before → 调用 insertSibling('before')", () => {
    const mind = makeMockMind();
    addSiblingToSelected(mind, "child1", "before");
    expect(mind.insertSibling).toHaveBeenCalledWith("before", expect.objectContaining({ id: "child1" }));
  });

  it("FE-NA-22: 默认 position=after", () => {
    const mind = makeMockMind();
    addSiblingToSelected(mind, "child1");
    expect(mind.insertSibling).toHaveBeenCalledWith("after", expect.anything());
  });

  it("FE-NA-23: 选中根节点 → 拒绝（思维导图只有一个根）", () => {
    const mind = makeMockMind();
    const ok = addSiblingToSelected(mind, "root");
    expect(ok).toBe(false);
    expect(mind.insertSibling).not.toHaveBeenCalled();
  });

  it("FE-NA-24: 无选中节点 → no-op", () => {
    const mind = makeMockMind();
    expect(addSiblingToSelected(mind, null)).toBe(false);
  });

  it("FE-NA-25: insertSibling 不存在 → no-op", () => {
    const mind = makeMockMind({ insertSibling: undefined });
    expect(addSiblingToSelected(mind, "child1")).toBe(false);
  });
});

describe("FE-NODE-ACT: editSelectedNode", () => {
  it("FE-NA-30: 选中节点 → 调用 beginEdit", () => {
    const mind = makeMockMind();
    const ok = editSelectedNode(mind, "child1");
    expect(ok).toBe(true);
    expect(mind.beginEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "child1" }));
  });

  it("FE-NA-31: 根节点也可以编辑", () => {
    const mind = makeMockMind();
    expect(editSelectedNode(mind, "root")).toBe(true);
    expect(mind.beginEdit).toHaveBeenCalled();
  });

  it("FE-NA-32: 无选中 → no-op", () => {
    const mind = makeMockMind();
    expect(editSelectedNode(mind, null)).toBe(false);
    expect(mind.beginEdit).not.toHaveBeenCalled();
  });

  it("FE-NA-33: beginEdit 不存在 → no-op", () => {
    const mind = makeMockMind({ beginEdit: undefined });
    expect(editSelectedNode(mind, "child1")).toBe(false);
  });
});

describe("FE-NODE-ACT: deleteSelectedNode", () => {
  it("FE-NA-40: 删除非根节点 → 调用 removeNodes([node])", () => {
    const mind = makeMockMind();
    const ok = deleteSelectedNode(mind, "child1");
    expect(ok).toBe(true);
    expect(mind.removeNodes).toHaveBeenCalledWith([expect.objectContaining({ id: "child1" })]);
  });

  it("FE-NA-41: 删除根节点 → 拒绝", () => {
    const mind = makeMockMind();
    const ok = deleteSelectedNode(mind, "root");
    expect(ok).toBe(false);
    expect(mind.removeNodes).not.toHaveBeenCalled();
  });

  it("FE-NA-42: 无选中 → no-op", () => {
    const mind = makeMockMind();
    expect(deleteSelectedNode(mind, null)).toBe(false);
  });

  it("FE-NA-43: removeNodes 不存在 → no-op", () => {
    const mind = makeMockMind({ removeNodes: undefined });
    expect(deleteSelectedNode(mind, "child1")).toBe(false);
  });

  it("FE-NA-44: 节点不存在 → no-op", () => {
    const mind = makeMockMind();
    expect(deleteSelectedNode(mind, "not-exist")).toBe(false);
  });
});

describe("FE-NODE-ACT: setTopicForSelected", () => {
  it("FE-NA-50: 设置 topic", () => {
    const mind = makeMockMind();
    const ok = setTopicForSelected(mind, "child1", "新主题");
    expect(ok).toBe(true);
    expect(mind.setNodeTopic).toHaveBeenCalledWith(expect.objectContaining({ id: "child1" }), "新主题");
  });

  it("FE-NA-51: 空字符串 topic 允许", () => {
    const mind = makeMockMind();
    expect(setTopicForSelected(mind, "child1", "")).toBe(true);
    expect(mind.setNodeTopic).toHaveBeenCalledWith(expect.objectContaining({ id: "child1" }), "");
  });

  it("FE-NA-52: 无选中 → no-op", () => {
    const mind = makeMockMind();
    expect(setTopicForSelected(mind, null, "x")).toBe(false);
  });
});

describe("FE-NODE-ACT: selectNode", () => {
  it("FE-NA-60: 选中节点", () => {
    const mind = makeMockMind();
    expect(selectNode(mind, "child1")).toBe(true);
    expect(mind.selectNode).toHaveBeenCalledWith(expect.objectContaining({ id: "child1" }));
  });

  it("FE-NA-61: 不存在的 id → no-op", () => {
    const mind = makeMockMind();
    expect(selectNode(mind, "x")).toBe(false);
  });
});

describe("FE-NODE-ACT: canDeleteNode", () => {
  it("FE-NA-70: 非根节点 → true", () => {
    const mind = makeMockMind();
    expect(canDeleteNode(mind, "child1")).toBe(true);
  });

  it("FE-NA-71: 根节点 → false", () => {
    const mind = makeMockMind();
    expect(canDeleteNode(mind, "root")).toBe(false);
  });

  it("FE-NA-72: nodeId=null → false", () => {
    const mind = makeMockMind();
    expect(canDeleteNode(mind, null)).toBe(false);
  });

  it("FE-NA-73: mind=null → false", () => {
    expect(canDeleteNode(null, "x")).toBe(false);
  });

  it("FE-NA-74: mind 无 nodeData → 乐观允许（true）", () => {
    const mind = makeMockMind({ nodeData: undefined });
    expect(canDeleteNode(mind, "any")).toBe(true);
  });
});
