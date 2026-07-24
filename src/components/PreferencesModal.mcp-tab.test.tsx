import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// 验证 PreferencesModal 的 MCP tab 存在(F-P3-07)

describe("FE-MCP-PREFS-TAB", () => {
  it("PreferencesModal.tsx 包含 McpTab 组件", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "PreferencesModal.tsx"),
      "utf8",
    );
    expect(src).toContain("function McpTab");
    expect(src).toContain("启用 MCP server");
    expect(src).toContain("监听端口");
    expect(src).toContain("默认 LLM 会话 TTL");
  });

  it("types.ts 包含 McpPrefs interface", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "types.ts"),
      "utf8",
    );
    expect(src).toContain("interface McpPrefs");
    expect(src).toContain("enabled: boolean");
    expect(src).toContain("port: number");
    expect(src).toContain("default_ttl_sec: number");
  });

  it("后端 McpPrefs 字段存在", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "src-tauri", "src", "models.rs"),
      "utf8",
    );
    expect(src).toContain("struct McpPrefs");
    expect(src).toContain("default_ttl_sec");
  });
});
