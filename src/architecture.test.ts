import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * FE-ARCH: 浮层架构守护(用户验收否决后的系统性根治)
 *
 * 背景:v0.3.1 修了三个点名的浮层,但 AboutModal 漏网、新写的
 * HotkeyHelpModal 犯同错——"报一个修一个"模式不可持续。
 * 本测试把纪律固化为可执行约束:
 *   A1. App.css 禁止通配子代规则(三次事故的共同土壤)
 *   A2. 全部浮层组件必须 createPortal 挂 body
 *   A3. 全部浮层 CSS 必须用 z-index token(禁止裸数字)
 *
 * 新增浮层组件时:加入 FLOATING_COMPONENTS 清单即自动受护。
 */

// 项目根:src/ 的上一级(vitest cwd = 项目根,双保险取相对本文件的 ../)
const root = resolve(__dirname, "..");

// 浮层组件清单(穷举于 2026-09 全库梳理;新增浮层必须登记)
const FLOATING_COMPONENTS = [
  "src/components/AboutModal.tsx",
  "src/components/HotkeyHelpModal.tsx",
  "src/components/GlassDialog.tsx",
  "src/components/ReminderToast.tsx",
  "src/components/LlmSessionBanner.tsx",
  "src/components/LlmOperationHistory.tsx",
];

// 浮层 CSS 清单(A3 用;z-index 必须 var(--z-*))
const FLOATING_CSS = [
  "src/components/AboutModal.css",
  "src/components/HotkeyHelpModal.css",
  "src/components/GlassDialog.css",
  "src/components/ReminderToast.css",
  "src/components/LlmSessionBanner.css",
  "src/components/LlmOperationHistory.css",
];

describe("FE-ARCH: 浮层架构守护(防布局劫持复发)", () => {
  it("A1: App.css 禁止 `.app-root > *` 通配子代规则(劫持源)", () => {
    const css = readFileSync(resolve(root, "src/App.css"), "utf8");
    expect(
      css,
      "禁止使用 .app-root > * 通配(曾三次劫持浮层 fixed);布局元素请显式列举",
    ).not.toMatch(/\.app-root\s*>\s*\*/);
  });

  it("A2: 全部浮层组件必须 createPortal 挂 body(登记清单逐一校验)", () => {
    for (const f of FLOATING_COMPONENTS) {
      const src = readFileSync(resolve(root, f), "utf8");
      expect(
        src.includes("createPortal"),
        `${f} 未使用 createPortal——浮层必须 Portal 挂 body(免疫祖先劫持)`,
      ).toBe(true);
    }
  });

  it("A3: 浮层 CSS 的 z-index 必须用层级 token(禁止裸数字)", () => {
    for (const f of FLOATING_CSS) {
      const css = readFileSync(resolve(root, f), "utf8");
      const bare = css.match(/z-index:\s*(?!var\()(\d+)/g);
      expect(
        bare,
        `${f} 存在裸 z-index 数字(${bare})——请用 var(--z-*) token`,
      ).toBeNull();
    }
  });
});
