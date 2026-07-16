#!/usr/bin/env bash
# 启动前预检：检测并清理占用 1420 端口的僵尸 vite 进程
# 调用：bash scripts/precheck.sh
# 通过 package.json 的 predev / pretauri 钩子自动调用
#
# Meta 守则 2（启动健壮性）+ 守则 3（错误恢复优先）的实现。

set -e

PORT=1420

# 1. 找占用端口的进程（仅 LISTEN，排除客户端连接）
PIDS=$(lsof -ti:$PORT -sTCP:LISTEN 2>/dev/null || true)

if [ -z "$PIDS" ]; then
  exit 0
fi

# 2. 检查是否是自己（避免自杀）
CURRENT_PID=$$
SELF=$(ps -p $CURRENT_PID -o comm= 2>/dev/null | head -1)

for PID in $PIDS; do
  if [ "$PID" = "$CURRENT_PID" ]; then
    continue
  fi
  COMM=$(ps -p $PID -o comm= 2>/dev/null | head -1)
  # 仅清理 node / vite 进程（避免误杀 Chrome / Safari 等）
  if [[ "$COMM" == *node* || "$COMM" == *vite* || "$COMM" == *npm* ]]; then
    echo "[precheck] 端口 $PORT 被僵尸进程占用 (PID $PID: $COMM)，自动清理"
    kill $PID 2>/dev/null || true
    # 给进程时间优雅退出
    for i in 1 2 3 4 5; do
      sleep 0.4
      if ! kill -0 $PID 2>/dev/null; then
        break
      fi
    done
    # 仍存活 → 强制 kill
    if kill -0 $PID 2>/dev/null; then
      echo "[precheck] PID $PID 未响应 SIGTERM，发送 SIGKILL"
      kill -9 $PID 2>/dev/null || true
      sleep 0.5
    fi
  else
    echo "[precheck] 端口 $PORT 被 $COMM (PID $PID) 占用，但非 node/vite，跳过（请手动处理）"
    exit 1
  fi
done

# 3. 验证端口已释放
sleep 0.5
REMAINING=$(lsof -ti:$PORT -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$REMAINING" ]; then
  echo "[precheck] 端口 $PORT 仍被占用，请手动检查：lsof -i:$PORT"
  exit 1
fi

echo "[precheck] 端口 $PORT 已就绪"
exit 0
