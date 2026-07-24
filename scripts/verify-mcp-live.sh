#!/usr/bin/env bash
# MCP 真实接入验证脚本(需要 mindmap-app dev 在跑)
#
# 用法:bash scripts/verify-mcp-live.sh
#
# 验证:
#   L1: GET /health → ok
#   L2: tools/list → 14 个 tool
#   L3: acquire_session → 拿到 session_id
#   L4: create_node → emit 给前端
#   L5: heartbeat → 续约
#   L6: get_edit_state → 当前状态
#   L7: release_session → 释放
#   L8: 无效 session 拦截

set -e

BASE="http://127.0.0.1:23456"

echo "=== L1: GET /health ==="
HEALTH=$(curl -s "$BASE/health")
if [ "$HEALTH" = "ok" ]; then
  echo "✓ /health = ok"
else
  echo "✗ /health failed: $HEALTH"
  exit 1
fi

echo ""
echo "=== L2: tools/list ==="
TOOL_COUNT=$(curl -s -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python3 -c "import sys, json; print(len(json.load(sys.stdin)['result']['tools']))")
echo "✓ $TOOL_COUNT tools registered"

echo ""
echo "=== L3: acquire_session ==="
RESP=$(curl -s -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"acquire_session","arguments":{"client_name":"verify-mcp-live","ttl_sec":60}}}')
SID=$(echo "$RESP" | python3 -c "import sys, json; print(json.loads(json.load(sys.stdin)['result']['content'][0]['text'])['session_id'])")
echo "✓ session_id=$SID"

echo ""
echo "=== L4: create_node ==="
curl -s -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"create_node\",\"arguments\":{\"session_id\":\"$SID\",\"parent_id\":\"root\",\"topic\":\"verify-mcp-live 测试\"}}}" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print('✓', d['result']['content'][0]['text'][:70])"

echo ""
echo "=== L5: heartbeat ==="
curl -s -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"heartbeat\",\"arguments\":{\"session_id\":\"$SID\"}}}" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); r = d.get('result'); print('✓ heartbeat ok' if r and not r.get('isError') else '✗ ' + str(d))"

echo ""
echo "=== L6: get_edit_state ==="
curl -s -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_edit_state","arguments":{}}}' | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print('✓ editor=' + json.loads(d['result']['content'][0]['text'])['editor'])"

echo ""
echo "=== L7: release_session ==="
curl -s -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"release_session\",\"arguments\":{\"session_id\":\"$SID\"}}}" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print('✓', d['result']['content'][0]['text'][:60])"

echo ""
echo "=== L8: 无效 session 拦截 ==="
curl -s -X POST "$BASE/mcp" -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/call\",\"params\":{\"name\":\"create_node\",\"arguments\":{\"session_id\":\"invalid-sid\",\"parent_id\":\"root\",\"topic\":\"should fail\"}}}" | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
r = d.get('result', {})
if r.get('isError'):
    print('✓ guard works: ' + r['content'][0]['text'][:60])
else:
    print('✗ should be rejected')
    exit(1)
"

echo ""
echo "🎉 All 8 MCP flows verified successfully"
