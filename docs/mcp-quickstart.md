# MindMap MCP · Claude Desktop 配置指南

> **状态**:Phase 1 只读 MVP
> **配套**:[架构设计](./mcp-architecture.md) / [开发规划](./mcp-dev-plan.md)

## TL;DR

1. 启动 mindmap-app
2. Claude Desktop 配置文件加 MCP server
3. 重启 Claude Desktop
4. 让 Claude 读取你的思维导图

## 1. 前置条件

- mindmap-app 已安装并启动(开发版 `npm run tauri dev` 或 release 版)
- Claude Desktop 已安装
- macOS 12+(目前只支持 Apple Silicon)

## 2. 配置 Claude Desktop

打开 Claude Desktop 配置文件(macOS):

```bash
open "~/Library/Application Support/Claude/claude_desktop_config.json"
```

如果文件不存在,创建它。然后加入 mindmap server 配置:

```jsonc
{
  "mcpServers": {
    "mindmap": {
      "url": "http://127.0.0.1:23456/mcp",
      "transport": "http"
    }
  }
}
```

> **注意**:如果你已经有其他 MCP server,把 `"mindmap"` 字段加到现有 `mcpServers` 对象里,不要替换整个文件。

## 3. 验证连接

1. **完全退出** Claude Desktop(`Cmd+Q`,不只是关窗口)
2. 重新打开 Claude Desktop
3. 在对话里问:

> 我当前打开的思维导图有哪些节点?

Claude 会:
1. 调用 `read_mindmap` tool
2. 拿到当前打开的 .mmap 文档树
3. 总结给你

如果看到 Claude 调用了 tool 并返回结果,**连接成功**。

## 4. 可用的 Tools(Phase 1 只读)

| Tool | 用法示例 |
|------|---------|
| `read_mindmap` | "读一下我当前的思维导图" |
| `search_nodes` | "找一下包含'会议'的节点" |
| `get_node` | "节点 root 的详细内容是什么?" |
| `list_reminders` | "我设置了哪些提醒?" |
| `export_mindmap` | "把当前导图导出成 markdown" |
| `get_edit_state` | "现在能写操作吗?" |

## 5. 健康检查(调试用)

如果 Claude 接不上,在终端跑:

```bash
curl http://127.0.0.1:23456/health
# 预期输出:ok
```

如果失败:
- **Connection refused**:mindmap-app 没启动,或 MCP server 启动失败(看 app 日志)
- **超时**:端口被占用,检查 `lsof -i :23456`

直接测试 MCP 协议:

```bash
curl -X POST http://127.0.0.1:23456/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

预期返回 JSON,包含 6 个 tool 的定义。

## 6. 限制(Phase 1 已知)

- ❌ **不能读其他 .mmap 文件**(只能读当前打开的)— Phase 2 加
- ❌ **不能写操作**(create/update/delete 节点)— Phase 2 加
- ❌ **不能附加文件**(attach_file)— Phase 3 加
- ✅ 可以读、搜索、导出当前文档

## 7. 工作原理(简述)

```
Claude Desktop
    ↓ HTTP POST /mcp
mindmap-app 内嵌的 MCP server (127.0.0.1:23456)
    ↓ 调用 tool
McpStateMirror(前端推送的状态镜像)
    ↓
返回结果给 Claude
```

前端 store 变化 → 防抖 1s → 推送到后端 → MCP tool 读最新状态。

## 8. 反馈

发现问题或想加新 tool,在 GitHub Issues 提:[shishan444/mindmap-app/issues](https://github.com/shishan444/mindmap-app/issues)
