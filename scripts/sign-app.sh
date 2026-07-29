#!/usr/bin/env bash
# Build 后给 .app 重新 ad-hoc 签名
#
# 问题:Tauri build 出的 .app 默认只有 linker-signed 签名,
# 跟实际 Resources 不一致,macOS 26 (Tahoe) 启动时报"已损坏"。
#
# 修复:用 codesign --force --deep --sign - 覆盖签名。
#
# 调用:bash scripts/sign-app.sh [bundle-path]
# 默认 bundle:src-tauri/target/release/bundle/macos/mindmap-app.app

set -e

BUNDLE="${1:-src-tauri/target/release/bundle/macos/mindmap-app.app}"

if [ ! -d "$BUNDLE" ]; then
  echo "[sign-app] bundle 不存在: $BUNDLE"
  echo "[sign-app] 跳过(可能 dev 模式没生成 .app)"
  exit 0
fi

echo "[sign-app] 重新签名: $BUNDLE"
codesign --force --deep --sign - "$BUNDLE"

echo "[sign-app] 验证签名..."
if codesign --verify --deep --strict "$BUNDLE" 2>&1; then
  echo "[sign-app] ✓ 签名验证通过"
else
  echo "[sign-app] ✗ 签名验证失败"
  exit 1
fi
