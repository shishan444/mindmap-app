import { describe, it, expect, beforeEach } from "vitest";
import { useMindMapStore, undo, redo, getHistoryInfo } from "./store";
import { makeContent, makeConfig, makeNode } from "./test/helpers";

// 每个 it 之前重置 store 数据字段（不覆盖 actions）
beforeEach(() => {
  useMindMapStore.setState({
    content: null,
    filePath: null,
    dirty: false,
    activeTab: "properties",
    sidebarCollapsed: false,
    sidebarWidth: 280,
    selectedNodeId: null,
    nodeCount: 0,
    config: null,
    saveStatus: "idle",
    lastSavedAt: null,
  });
  // 清空 temporal 历史
  useMindMapStore.temporal.getState().clear();
});

describe("FE-STORE: setContent", () => {
  it("FE-STORE-01: setContent 后 nodeCount 正确递归计算", () => {
    const content = makeContent({
      root: makeNode({
        topic: "根",
        children: [
          makeNode({ topic: "子1", children: [makeNode({ topic: "孙1" })] }),
          makeNode({ topic: "子2" }),
        ],
      }),
    });
    useMindMapStore.getState().setContent(content);
    expect(useMindMapStore.getState().nodeCount).toBe(4);
  });

  it("FE-STORE-01b: setContent(null) 把 nodeCount 置 0", () => {
    useMindMapStore.getState().setContent(makeContent());
    useMindMapStore.getState().setContent(null);
    expect(useMindMapStore.getState().nodeCount).toBe(0);
    expect(useMindMapStore.getState().content).toBeNull();
  });

  it("FE-STORE-01c: setContent 后 dirty=false", () => {
    useMindMapStore.setState({ dirty: true });
    useMindMapStore.getState().setContent(makeContent());
    expect(useMindMapStore.getState().dirty).toBe(false);
  });
});

describe("FE-STORE: dirty & saveStatus", () => {
  it("FE-STORE-02: markDirty 后 dirty=true", () => {
    useMindMapStore.getState().markDirty();
    expect(useMindMapStore.getState().dirty).toBe(true);
  });

  it("FE-STORE-03: markSaved 后 dirty=false, saveStatus=saved, lastSavedAt 设值", () => {
    useMindMapStore.getState().markDirty();
    useMindMapStore.getState().setSaveStatus("saving");
    useMindMapStore.getState().markSaved();
    const s = useMindMapStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.saveStatus).toBe("saved");
    expect(s.lastSavedAt).not.toBeNull();
  });

  it("FE-STORE: setSaveStatus 切换状态", () => {
    useMindMapStore.getState().setSaveStatus("saving");
    expect(useMindMapStore.getState().saveStatus).toBe("saving");
    useMindMapStore.getState().setSaveStatus("error");
    expect(useMindMapStore.getState().saveStatus).toBe("error");
  });
});

describe("FE-STORE: 文件路径", () => {
  it("FE-STORE: setFilePath 设置路径", () => {
    useMindMapStore.getState().setFilePath("/tmp/test.mmap");
    expect(useMindMapStore.getState().filePath).toBe("/tmp/test.mmap");
  });

  it("FE-STORE: setFilePath(null) 清空路径", () => {
    useMindMapStore.getState().setFilePath("/tmp/a.mmap");
    useMindMapStore.getState().setFilePath(null);
    expect(useMindMapStore.getState().filePath).toBeNull();
  });
});

describe("FE-STORE: UI 状态", () => {
  it("FE-STORE-05: setActiveTab 切换", () => {
    useMindMapStore.getState().setActiveTab("reminders");
    expect(useMindMapStore.getState().activeTab).toBe("reminders");
    useMindMapStore.getState().setActiveTab("outline");
    expect(useMindMapStore.getState().activeTab).toBe("outline");
  });

  it("FE-STORE-06: toggleSidebar 切换 collapsed", () => {
    expect(useMindMapStore.getState().sidebarCollapsed).toBe(false);
    useMindMapStore.getState().toggleSidebar();
    expect(useMindMapStore.getState().sidebarCollapsed).toBe(true);
    useMindMapStore.getState().toggleSidebar();
    expect(useMindMapStore.getState().sidebarCollapsed).toBe(false);
  });

  it("FE-STORE: setSidebarWidth 设置宽度", () => {
    useMindMapStore.getState().setSidebarWidth(400);
    expect(useMindMapStore.getState().sidebarWidth).toBe(400);
  });

  it("FE-STORE: setSelectedNodeId 设置选中", () => {
    useMindMapStore.getState().setSelectedNodeId("node-xyz");
    expect(useMindMapStore.getState().selectedNodeId).toBe("node-xyz");
  });
});

describe("FE-STORE: config", () => {
  it("FE-STORE: setConfig 同步 window_state 字段", () => {
    const cfg = makeConfig({
      window_state: {
        x: 10,
        y: 20,
        width: 1000,
        height: 700,
        is_maximized: true,
        sidebar_width: 320,
        sidebar_collapsed: true,
        active_tab: "outline",
      },
    });
    useMindMapStore.getState().setConfig(cfg);
    const s = useMindMapStore.getState();
    expect(s.sidebarCollapsed).toBe(true);
    expect(s.sidebarWidth).toBe(320);
    expect(s.activeTab).toBe("outline");
  });
});

describe("FE-STORE: updateContent", () => {
  it("FE-STORE-04: updateContent 浅克隆 root，不污染原对象", () => {
    const original = makeContent({ root: makeNode({ topic: "原始" }) });
    useMindMapStore.getState().setContent(original);
    const capturedRoot = useMindMapStore.getState().content!.root;
    useMindMapStore.getState().updateContent((c) => {
      c.root.topic = "修改后";
    });
    // 原对象 topic 应不变
    expect(original.root.topic).toBe("原始");
    // capturedRoot 是 setContent 时克隆的，updateContent 应该再克隆
    // 这里 capturedRoot 应仍是 "原始"（因为 updateContent 浅克隆了新的 root）
    expect(capturedRoot.topic).toBe("原始");
    // 当前 store 中的 root topic 应是 "修改后"
    expect(useMindMapStore.getState().content!.root.topic).toBe("修改后");
  });

  it("FE-STORE-04b: updateContent 标记 dirty", () => {
    useMindMapStore.getState().setContent(makeContent());
    useMindMapStore.getState().markSaved();
    useMindMapStore.getState().updateContent((c) => {
      c.root.topic = "new";
    });
    expect(useMindMapStore.getState().dirty).toBe(true);
  });

  it("FE-STORE-04c: updateContent 无 content 时静默 no-op", () => {
    expect(useMindMapStore.getState().content).toBeNull();
    useMindMapStore.getState().updateContent((c) => {
      c.root.topic = "x";
    });
    expect(useMindMapStore.getState().content).toBeNull();
  });

  it("FE-STORE-04d: updateContent 更新 nodeCount", () => {
    useMindMapStore.getState().setContent(
      makeContent({
        root: makeNode({
          topic: "根",
          children: [makeNode({ topic: "子" })],
        }),
      }),
    );
    expect(useMindMapStore.getState().nodeCount).toBe(2);
    useMindMapStore.getState().updateContent((c) => {
      c.root.children.push(makeNode({ topic: "新子" }));
    });
    expect(useMindMapStore.getState().nodeCount).toBe(3);
  });
});

describe("FE-EDIT: updateSelectedNode", () => {
  it("FE-EDIT-01: 更新选中节点的 topic", () => {
    const content = makeContent({
      root: makeNode({ id: "n1", topic: "原" }),
    });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setSelectedNodeId("n1");
    useMindMapStore.getState().updateSelectedNode({ topic: "新" });
    expect(useMindMapStore.getState().content?.root.topic).toBe("新");
  });

  it("FE-EDIT-01b: 更新嵌套子节点", () => {
    const content = makeContent({
      root: makeNode({
        id: "root",
        topic: "根",
        children: [
          makeNode({
            id: "child",
            topic: "子",
            children: [makeNode({ id: "g1", topic: "孙" })],
          }),
        ],
      }),
    });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setSelectedNodeId("g1");
    useMindMapStore.getState().updateSelectedNode({ topic: "新孙" });
    expect(useMindMapStore.getState().content?.root.children[0].children[0].topic).toBe("新孙");
  });

  it("FE-EDIT-02: 无选中节点时 no-op", () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "原" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setSelectedNodeId(null);
    useMindMapStore.getState().updateSelectedNode({ topic: "新" });
    expect(useMindMapStore.getState().content?.root.topic).toBe("原");
  });

  it("FE-EDIT-02b: 无 content 时 no-op", () => {
    useMindMapStore.getState().setSelectedNodeId("any");
    useMindMapStore.getState().updateSelectedNode({ topic: "新" });
    expect(useMindMapStore.getState().content).toBeNull();
  });

  it("FE-EDIT-02c: 选中 ID 不在树中时 no-op", () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "原" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setSelectedNodeId("not-exist");
    useMindMapStore.getState().updateSelectedNode({ topic: "新" });
    expect(useMindMapStore.getState().content?.root.topic).toBe("原");
  });

  it("FE-EDIT: updateSelectedNode 标记 dirty", () => {
    const content = makeContent({ root: makeNode({ id: "n1", topic: "原" }) });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().markSaved();
    useMindMapStore.getState().updateSelectedNode({ topic: "新" });
    expect(useMindMapStore.getState().dirty).toBe(true);
  });

  it("FE-EDIT: updateSelectedNode 不修改原对象（不可变）", () => {
    const original = makeContent({ root: makeNode({ id: "n1", topic: "原" }) });
    useMindMapStore.getState().setContent(original);
    useMindMapStore.getState().setSelectedNodeId("n1");
    useMindMapStore.getState().updateSelectedNode({ topic: "新" });
    expect(original.root.topic).toBe("原");
  });
});

describe("FE-EDIT: setPriorityForSelected", () => {
  beforeEach(() => {
    const content = makeContent({
      root: makeNode({ id: "n1", topic: "节点", priority: undefined }),
    });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setSelectedNodeId("n1");
  });

  it("FE-EDIT-03: 设置 P0 优先级", () => {
    useMindMapStore.getState().setPriorityForSelected("P0");
    expect(useMindMapStore.getState().content?.root.priority).toBe("P0");
  });

  it("FE-EDIT-03: 设置 P1/P2/P3", () => {
    for (const p of ["P1", "P2", "P3"] as const) {
      useMindMapStore.getState().setPriorityForSelected(p);
      expect(useMindMapStore.getState().content?.root.priority).toBe(p);
    }
  });

  it("FE-EDIT-03b: null 清除优先级", () => {
    useMindMapStore.getState().setPriorityForSelected("P0");
    expect(useMindMapStore.getState().content?.root.priority).toBe("P0");
    useMindMapStore.getState().setPriorityForSelected(null);
    expect(useMindMapStore.getState().content?.root.priority).toBeUndefined();
  });

  it("FE-EDIT: 改变优先级 → dirty=true", () => {
    useMindMapStore.getState().markSaved();
    useMindMapStore.getState().setPriorityForSelected("P1");
    expect(useMindMapStore.getState().dirty).toBe(true);
  });
});

describe("FE-UNDO: 撤销重做", () => {
  beforeEach(() => {
    const content = makeContent({
      root: makeNode({ id: "n1", topic: "初始", children: [] }),
    });
    useMindMapStore.getState().setContent(content);
    useMindMapStore.getState().setSelectedNodeId("n1");
    // setContent 后清空历史，让后续操作成为基线
    useMindMapStore.temporal.getState().clear();
  });

  it("FE-UNDO-01: 一次操作后可以撤销", () => {
    useMindMapStore.getState().updateSelectedNode({ topic: "修改后" });
    expect(useMindMapStore.getState().content?.root.topic).toBe("修改后");
    const ok = undo();
    expect(ok).toBe(true);
    expect(useMindMapStore.getState().content?.root.topic).toBe("初始");
  });

  it("FE-UNDO-02: 撤销后可以重做", () => {
    useMindMapStore.getState().updateSelectedNode({ topic: "v2" });
    undo();
    expect(useMindMapStore.getState().content?.root.topic).toBe("初始");
    const ok = redo();
    expect(ok).toBe(true);
    expect(useMindMapStore.getState().content?.root.topic).toBe("v2");
  });

  it("FE-UNDO-03: 无历史时 undo 返回 false", () => {
    const ok = undo();
    expect(ok).toBe(false);
  });

  it("FE-UNDO-03b: 有历史无 future 时 redo 返回 false", () => {
    useMindMapStore.getState().updateSelectedNode({ topic: "v2" });
    const ok = redo();
    expect(ok).toBe(false);
  });

  it("FE-UNDO-04: 多步撤销", () => {
    useMindMapStore.getState().updateSelectedNode({ topic: "v2" });
    useMindMapStore.getState().updateSelectedNode({ topic: "v3" });
    useMindMapStore.getState().updateSelectedNode({ topic: "v4" });
    expect(useMindMapStore.getState().content?.root.topic).toBe("v4");
    undo();
    expect(useMindMapStore.getState().content?.root.topic).toBe("v3");
    undo();
    expect(useMindMapStore.getState().content?.root.topic).toBe("v2");
    undo();
    expect(useMindMapStore.getState().content?.root.topic).toBe("初始");
  });

  it("FE-UNDO-05: clearHistory 清空历史", () => {
    useMindMapStore.getState().updateSelectedNode({ topic: "v2" });
    expect(getHistoryInfo().undoCount).toBeGreaterThan(0);
    useMindMapStore.getState().clearHistory();
    expect(getHistoryInfo().undoCount).toBe(0);
  });

  it("FE-UNDO-06: 历史栈深度限制 50", () => {
    for (let i = 0; i < 60; i++) {
      useMindMapStore.getState().updateSelectedNode({ topic: `v${i}` });
    }
    expect(getHistoryInfo().undoCount).toBeLessThanOrEqual(50);
  });

  it("FE-UNDO: undo 后 dirty=true", () => {
    useMindMapStore.getState().updateSelectedNode({ topic: "v2" });
    useMindMapStore.getState().markSaved();
    undo();
    expect(useMindMapStore.getState().dirty).toBe(true);
  });

  it("FE-UNDO: 优先级变化也可撤销", () => {
    useMindMapStore.getState().setPriorityForSelected("P0");
    expect(useMindMapStore.getState().content?.root.priority).toBe("P0");
    undo();
    expect(useMindMapStore.getState().content?.root.priority).toBeUndefined();
  });
});
