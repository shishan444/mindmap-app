#!/usr/bin/env node
/**
 * 检查 MCP 功能点 + 链路覆盖率
 *
 * 读 docs/mcp-feature-coverage.yaml + docs/mcp-flow-coverage.yaml
 * 跑 vitest + cargo test,提取测试名
 * 检查每个 feature / scenario 是否有对应测试
 *
 * 门槛:覆盖率 ≥ 95%
 *
 * 用法:
 *   node scripts/check-coverage.js
 *
 * 退出码:
 *   0 = 通过(覆盖率 ≥ 95%)
 *   1 = 失败(覆盖率 < 95% 或解析失败)
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const THRESHOLD = 0.95;

function parseYamlManual(filepath) {
  const content = fs.readFileSync(filepath, "utf8");
  const lines = content.split("\n");
  const items = [];
  let currentItem = null;
  let inKeywords = false;
  let inTestsList = false;

  for (const line of lines) {
    const itemMatch = line.match(/^\s{2,4}- id: (.+)$/);
    if (itemMatch) {
      if (currentItem) items.push(currentItem);
      currentItem = { id: itemMatch[1].trim(), tests: [], keywords: [] };
      inKeywords = false;
      inTestsList = false;
      continue;
    }
    if (!currentItem) continue;

    const nameMatch = line.match(/^\s+name: (.+)$/);
    if (nameMatch) {
      currentItem.name = nameMatch[1].trim();
      continue;
    }

    // keywords: [a, b, c](inline 数组)
    const kwInline = line.match(/^\s+keywords:\s*\[(.*)\]\s*$/);
    if (kwInline) {
      currentItem.keywords = kwInline[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      inKeywords = false;
      continue;
    }

    // tests: [a, b, c](inline 数组,兼容旧格式)
    const testsInline = line.match(/^\s+tests:\s*\[(.*)\]\s*$/);
    if (testsInline) {
      currentItem.tests = testsInline[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      inTestsList = false;
      continue;
    }

    // 关闭列表(遇到其他 key)
    if (line.match(/^\s+\w+:/) && !line.match(/^\s+-/)) {
      inKeywords = false;
      inTestsList = false;
    }
  }
  if (currentItem) items.push(currentItem);
  return items;
}

function getRustTestNames() {
  try {
    const out = execSync("cd src-tauri && cargo test --lib -- --list 2>/dev/null", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return new Set(
      out
        .split("\n")
        .map((l) => l.replace(/: test$/u, "").trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function getFeTestNames() {
  try {
    // --reporter=json 输出到 stdout;stdio pipe 收集
    const out = execSync("npx vitest run --reporter=json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 50 * 1024 * 1024,
    });
    const allTests = new Set();
    // fullName 在 vitest json 里
    const regex = /"fullName"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = regex.exec(out)) !== null) {
      allTests.add(m[1]);
      // 也加最后一段(去 ancestor 前缀)
      const seg = m[1].split(" ").pop() || "";
      if (seg) allTests.add(seg);
    }
    const shortRegex = /"name"\s*:\s*"([^"]+)"/g;
    while ((m = shortRegex.exec(out)) !== null) {
      allTests.add(m[1]);
    }
    return allTests;
  } catch (e) {
    console.warn("[warn] getFeTestNames failed:", e.message?.slice(0, 100));
    return new Set();
  }
}

function main() {
  const featureFile = path.join("docs", "mcp-feature-coverage.yaml");
  const flowFile = path.join("docs", "mcp-flow-coverage.yaml");

  if (!fs.existsSync(featureFile) || !fs.existsSync(flowFile)) {
    console.error("✗ Missing coverage yaml files");
    process.exit(1);
  }

  const features = parseYamlManual(featureFile);
  const scenarios = parseYamlManual(flowFile);

  console.log(`Loaded ${features.length} features, ${scenarios.length} flow scenarios`);

  const rustTests = getRustTestNames();
  const feTests = getFeTestNames();
  console.log(`Found ${rustTests.size} Rust tests, ${feTests.size} FE tests`);

  let featureCovered = 0;
  let featureMissing = [];
  for (const f of features) {
    const kws = f.keywords && f.keywords.length > 0 ? f.keywords : f.tests;
    const covered = kws.length === 0 || kws.some((keyword) => {
      for (const t of rustTests) if (t.includes(keyword) || t === keyword) return true;
      for (const t of feTests) if (t.includes(keyword) || t === keyword) return true;
      return false;
    });
    if (covered) {
      featureCovered++;
    } else {
      featureMissing.push(`${f.id} ${f.name || ""}(expected keywords: ${(f.keywords || []).join(" | ")})`);
    }
  }

  let scenarioCovered = 0;
  let scenarioMissing = [];
  for (const s of scenarios) {
    const kws = s.keywords && s.keywords.length > 0 ? s.keywords : s.tests;
    const covered = kws.length === 0 || kws.some((keyword) => {
      for (const t of rustTests) if (t.includes(keyword) || t === keyword) return true;
      for (const t of feTests) if (t.includes(keyword) || t === keyword) return true;
      return false;
    });
    if (covered) {
      scenarioCovered++;
    } else {
      scenarioMissing.push(`${s.id}(expected keywords: ${(s.keywords || []).join(" | ")})`);
    }
  }

  const featureRate = features.length > 0 ? featureCovered / features.length : 0;
  const scenarioRate = scenarios.length > 0 ? scenarioCovered / scenarios.length : 0;

  console.log("\n=== MCP Coverage Report ===");
  console.log(`Features:  ${featureCovered}/${features.length} = ${(featureRate * 100).toFixed(1)}%(threshold ${(THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`Scenarios: ${scenarioCovered}/${scenarios.length} = ${(scenarioRate * 100).toFixed(1)}%(threshold ${(THRESHOLD * 100).toFixed(0)}%)`);

  if (featureMissing.length > 0) {
    console.log("\n✗ Missing feature coverage:");
    featureMissing.forEach((m) => console.log(`  - ${m}`));
  }
  if (scenarioMissing.length > 0) {
    console.log("\n✗ Missing scenario coverage:");
    scenarioMissing.forEach((m) => console.log(`  - ${m}`));
  }

  const pass = featureRate >= THRESHOLD && scenarioRate >= THRESHOLD;
  console.log(`\n${pass ? "✓ PASS" : "✗ FAIL"}`);
  process.exit(pass ? 0 : 1);
}

main();
