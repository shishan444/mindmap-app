import { describe, it, expect } from "vitest";
import {
  toMindElixirData,
  nodeToMindElixirNode,
  fromMindElixirNode,
  fromMindElixirData,
} from "./mindElixirAdapter";
import type { Content, MindNode } from "../types";
import { makeContent, makeNode } from "../test/helpers";

describe("FE-ADAPT: toMindElixirData", () => {
  it("FE-ADAPT-01: content=null 时返回默认根节点（topic='中心主题'）", () => {
    const data = toMindElixirData(null);
    expect(data.nodeData).toBeDefined();
    expect(data.nodeData.topic).toBe("中心主题");
    expect(data.nodeData.id).toBe("root");
    expect(data.nodeData.expanded).toBe(true);
    expect(Array.isArray(data.nodeData.children)).toBe(true);
  });

  it("FE-ADAPT-02: 正常 content 转换根节点", () => {
    const content = makeContent({
      root: makeNode({ id: "n1", topic: "我的主题" }),
    });
    const data = toMindElixirData(content);
    expect(data.nodeData.id).toBe("n1");
    expect(data.nodeData.topic).toBe("我的主题");
  });

  it("FE-ADAPT-03: 根节点带子节点时正确递归", () => {
    const content = makeContent({
      root: makeNode({
        id: "root",
        topic: "根",
        children: [
          makeNode({ id: "c1", topic: "子1" }),
          makeNode({
            id: "c2",
            topic: "子2",
            children: [makeNode({ id: "g1", topic: "孙" })],
          }),
        ],
      }),
    });
    const data = toMindElixirData(content);
    expect(data.nodeData.children.length).toBe(2);
    expect(data.nodeData.children[0].id).toBe("c1");
    expect(data.nodeData.children[1].children[0].id).toBe("g1");
  });
});

describe("FE-ADAPT: nodeToMindElixirNode collapsed/expanded 转换", () => {
  it("FE-ADAPT-04: collapsed=false → expanded=true", () => {
    const node = makeNode({ collapsed: false });
    const me = nodeToMindElixirNode(node);
    expect(me.expanded).toBe(true);
  });

  it("FE-ADAPT-05: collapsed=true → expanded=false", () => {
    const node = makeNode({ collapsed: true });
    const me = nodeToMindElixirNode(node);
    expect(me.expanded).toBe(false);
  });

  it("FE-ADAPT-06: collapsed=undefined → expanded=true（默认展开）", () => {
    const node: MindNode = {
      id: "x",
      topic: "x",
      children: [],
      icons: [],
      reminder_ids: [],
      style: {},
      collapsed: false,
    };
    const me = nodeToMindElixirNode(node);
    expect(me.expanded).toBe(true);
  });
});

describe("FE-ADAPT: nodeToMindElixirNode 扩展字段保留", () => {
  it("FE-ADAPT-07: priority 字段保留", () => {
    const node = makeNode({ priority: "P0" });
    const me = nodeToMindElixirNode(node);
    expect(me.priority).toBe("P0");
  });

  it("FE-ADAPT-08: note 字段保留", () => {
    const node = makeNode({ note: "备注内容" });
    const me = nodeToMindElixirNode(node);
    expect(me.note).toBe("备注内容");
  });

  it("FE-ADAPT-09: priority=null 时不输出 priority 字段", () => {
    const node = makeNode({});
    const me = nodeToMindElixirNode(node);
    expect(me.priority).toBeUndefined();
  });

  it("FE-ADAPT-10: icons 数组保留", () => {
    const node = makeNode({ icons: ["star", "fire"] });
    const me = nodeToMindElixirNode(node);
    expect(me.icons).toEqual(["star", "fire"]);
  });

  it("FE-ADAPT-11: 空 icons 时不输出字段", () => {
    const node = makeNode({ icons: [] });
    const me = nodeToMindElixirNode(node);
    expect(me.icons).toBeUndefined();
  });

  it("FE-ADAPT-12: reminder_ids 数组保留", () => {
    const node = makeNode({ reminder_ids: ["rem-1", "rem-2"] });
    const me = nodeToMindElixirNode(node);
    expect(me.reminder_ids).toEqual(["rem-1", "rem-2"]);
  });

  it("FE-ADAPT-13: image 字段保留", () => {
    const node = makeNode({
      image: { path: "assets/abc.png", width: 100, height: 50 },
    });
    const me = nodeToMindElixirNode(node);
    expect(me.image).toEqual({ path: "assets/abc.png", width: 100, height: 50 });
  });

  it("FE-ADAPT-14: style 字段保留", () => {
    const node = makeNode({ style: { color: "#fff", font_size: 16 } });
    const me = nodeToMindElixirNode(node);
    expect(me.style.color).toBe("#fff");
  });

  it("FE-ADAPT-15: 空 topic 转换为空字符串（不报错）", () => {
    const node = makeNode({ topic: "" });
    const me = nodeToMindElixirNode(node);
    expect(me.topic).toBe("");
  });
});

describe("FE-ADAPT: fromMindElixirNode", () => {
  it("FE-ADAPT-16: 基本字段还原", () => {
    const me = { id: "n1", topic: "T", children: [], expanded: true };
    const node = fromMindElixirNode(me);
    expect(node.id).toBe("n1");
    expect(node.topic).toBe("T");
    expect(node.collapsed).toBe(false);
  });

  it("FE-ADAPT-17: expanded=false → collapsed=true", () => {
    const me = { id: "x", topic: "T", expanded: false, children: [] };
    const node = fromMindElixirNode(me);
    expect(node.collapsed).toBe(true);
  });

  it("FE-ADAPT-18: expanded=undefined → collapsed=false（兼容老数据）", () => {
    const me = { id: "x", topic: "T", children: [] };
    const node = fromMindElixirNode(me);
    expect(node.collapsed).toBe(false);
  });

  it("FE-ADAPT-19: null/undefined 输入返回安全空节点", () => {
    const node = fromMindElixirNode(null);
    expect(node.id).toBe("");
    expect(node.topic).toBe("");
    expect(node.children).toEqual([]);
  });

  it("FE-ADAPT-20: children 缺失时返回空数组", () => {
    const me = { id: "x", topic: "T" };
    const node = fromMindElixirNode(me);
    expect(node.children).toEqual([]);
  });

  it("FE-ADAPT-21: icons 缺失时返回空数组（不 undefined）", () => {
    const me = { id: "x", topic: "T", children: [] };
    const node = fromMindElixirNode(me);
    expect(node.icons).toEqual([]);
    expect(node.reminder_ids).toEqual([]);
    expect(node.style).toEqual({});
  });

  it("FE-ADAPT-22: 嵌套子节点还原", () => {
    const me = {
      id: "root",
      topic: "根",
      expanded: true,
      children: [
        { id: "c1", topic: "子", expanded: true, children: [] },
      ],
    };
    const node = fromMindElixirNode(me);
    expect(node.children.length).toBe(1);
    expect(node.children[0].id).toBe("c1");
  });

  it("FE-ADAPT-23: priority 等扩展字段还原", () => {
    const me = {
      id: "x",
      topic: "T",
      children: [],
      priority: "P1",
      note: "备注",
      icons: ["🔥"],
    };
    const node = fromMindElixirNode(me);
    expect(node.priority).toBe("P1");
    expect(node.note).toBe("备注");
    expect(node.icons).toEqual(["🔥"]);
  });
});

describe("FE-ADAPT: fromMindElixirData", () => {
  it("FE-ADAPT-24: data=null 返回 null", () => {
    expect(fromMindElixirData(null)).toBeNull();
  });

  it("FE-ADAPT-25: data.nodeData 缺失返回 null", () => {
    expect(fromMindElixirData({} as any)).toBeNull();
  });

  it("FE-ADAPT-26: 正常数据生成 Content（含 version）", () => {
    const data = {
      nodeData: { id: "r", topic: "根", expanded: true, children: [] },
    };
    const c = fromMindElixirData(data);
    expect(c).not.toBeNull();
    expect(c!.version).toBe("1.0.0");
    expect(c!.root.id).toBe("r");
  });

  it("FE-ADAPT-27: 保留 prevContent 的 canvas_state", () => {
    const prev: Content = {
      version: "1.0.0",
      root: makeNode({ topic: "旧" }),
      canvas_state: { zoom: 2, pan_x: 100, pan_y: 50 },
    };
    const data = {
      nodeData: { id: "new", topic: "新", expanded: true, children: [] },
    };
    const c = fromMindElixirData(data, prev);
    expect(c!.canvas_state.zoom).toBe(2);
    expect(c!.canvas_state.pan_x).toBe(100);
  });

  it("FE-ADAPT-28: 无 prevContent 时 canvas_state 用默认", () => {
    const data = {
      nodeData: { id: "r", topic: "根", expanded: true, children: [] },
    };
    const c = fromMindElixirData(data, null);
    expect(c!.canvas_state.zoom).toBe(1);
    expect(c!.canvas_state.pan_x).toBe(0);
  });
});

describe("FE-ADAPT: 往返一致性（round-trip）", () => {
  it("FE-ADAPT-29: MindNode → ME → MindNode 数据一致", () => {
    const original = makeNode({
      id: "rt",
      topic: "根",
      priority: "P2",
      note: "测试",
      collapsed: false,
      children: [
        makeNode({
          id: "c1",
          topic: "子",
          priority: "P0",
          collapsed: true,
          children: [],
        }),
      ],
    });
    const me = nodeToMindElixirNode(original);
    const restored = fromMindElixirNode(me);
    expect(restored.id).toBe(original.id);
    expect(restored.topic).toBe(original.topic);
    expect(restored.priority).toBe(original.priority);
    expect(restored.note).toBe(original.note);
    expect(restored.collapsed).toBe(original.collapsed);
    expect(restored.children.length).toBe(1);
    expect(restored.children[0].collapsed).toBe(true);
    expect(restored.children[0].priority).toBe("P0");
  });

  it("FE-ADAPT-30: Content → ME data → Content 一致", () => {
    const original = makeContent({
      root: makeNode({
        id: "root",
        topic: "中心",
        children: [
          makeNode({ id: "a", topic: "A" }),
          makeNode({ id: "b", topic: "B" }),
        ],
      }),
    });
    const data = toMindElixirData(original);
    const restored = fromMindElixirData(data);
    expect(restored!.root.id).toBe("root");
    expect(restored!.root.topic).toBe("中心");
    expect(restored!.root.children.length).toBe(2);
    expect(restored!.root.children[0].id).toBe("a");
  });
});
