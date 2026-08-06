#!/usr/bin/env node
/**
 * OB 覆盖对账脚本 — 元审计根因的可持续修复
 *
 * 元审计识别"对账机制缺失"为最严重根因:
 * 设计写 designed,实施可以沉默缺失,直到外部审查才暴露。
 *
 * 本脚本扫描 test-design.md 的 OB 表,对每个 designed 状态的 OB
 * 必须能在 test-results.json 找到对应 PASS 证据。
 * 缺失即 gap,CI 失败。
 *
 * 用法:
 *   node scripts/check-ob-coverage.cjs [test-design.md] [test-results.json]
 */

const fs = require("fs");
const path = require("path");

const designPath = process.argv[2] ||
  path.join(__dirname, "..", "docs", "testing", "mindmap-app", "test-design.md");
const resultsPath = process.argv[3] ||
  path.join(__dirname, "..", "docs", "testing", "mindmap-app", "test-results.json");

if (!fs.existsSync(designPath)) {
  console.error(`✗ design 文件不存在: ${designPath}`);
  process.exit(2);
}
if (!fs.existsSync(resultsPath)) {
  console.error(`✗ results 文件不存在: ${resultsPath}`);
  console.error(`  先跑全量测试并生成 test-results.json`);
  process.exit(2);
}

const design = fs.readFileSync(designPath, "utf8");
const results = JSON.parse(fs.readFileSync(resultsPath, "utf8"));

// 从 design 提取所有 OB 行,按行扫描并识别 design 状态关键字
const STATUS_KEYWORDS = ["designed", "approved", "conditional", "blocked", "out_of_scope", "pass", "fail", "partial"];
const designObs = new Map();
for (const line of design.split("\n")) {
  const obMatch = line.match(/\|\s*(OB-\d+)\b/);
  if (!obMatch) continue;
  const id = obMatch[1];
  // 跳过表头行(包含 "Obligation")
  if (line.includes("Obligation")) continue;
  const lower = line.toLowerCase();
  let status = "unknown";
  for (const kw of STATUS_KEYWORDS) {
    if (lower.includes(kw)) {
      status = kw;
      break;
    }
  }
  if (!designObs.has(id)) {
    designObs.set(id, status);
  }
}

if (designObs.size === 0) {
  console.error("✗ 未在 design 中识别到任何 OB-* 行");
  process.exit(2);
}

// 从 results 拿 by_ob 状态
const resultsObs = results.by_ob || {};

let gaps = [];
let passCount = 0;
let blockedCount = 0;
let partialCount = 0;

for (const [id, designStatus] of designObs) {
  const r = resultsObs[id];
  if (!r) {
    gaps.push({ id, design: designStatus, results: "MISSING", reason: "results.json 缺该 OB 项" });
    continue;
  }
  const s = (r.status || "").toUpperCase();
  if (s === "PASS" || s.startsWith("PASS_")) {
    passCount++;
  } else if (s === "BLOCKED" || s.startsWith("BLOCKED_")) {
    blockedCount++;
  } else if (s === "PARTIAL") {
    partialCount++;
    gaps.push({
      id,
      design: designStatus,
      results: s,
      reason: `PARTIAL — 缺失: ${(r.missing || []).join(", ") || "未说明"}`,
    });
  } else {
    gaps.push({ id, design: designStatus, results: s, reason: "未识别状态" });
  }
}

console.log("=== OB 覆盖对账 ===");
console.log(`设计 OB 数: ${designObs.size}`);
console.log(`  PASS:       ${passCount}`);
console.log(`  BLOCKED:    ${blockedCount} (显式阻断,可接受)`);
console.log(`  PARTIAL:    ${partialCount} (部分覆盖,需补齐)`);
console.log(`  GAPS:       ${gaps.length}`);

if (gaps.length > 0) {
  console.log("\n❌ 发现缺口:");
  for (const g of gaps) {
    console.log(`  ${g.id} (design=${g.design}, results=${g.results}): ${g.reason}`);
  }
  console.log(`\n修复:补齐对应测试,或在 design 显式标 conditional/blocked。`);
  process.exit(1);
}

console.log("\n✓ 所有非阻断 OB 都有 PASS 证据。");
process.exit(0);
