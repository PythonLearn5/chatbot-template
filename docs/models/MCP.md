# MCP 协议支持 (Model Context Protocol)

## 目标

让聊天机器人能**运行时**接入外部 MCP 服务器提供的工具，实现：
- 无需改代码即可扩展工具能力（前端 UI 上点「添加 MCP」就能接入）
- 模型可调用 MCP 服务器提供的任意工具（自动解析 inputSchema）
- MCP 服务器配置按用户隔离

## 技术方案

使用 AI SDK 7 官方的 `@ai-sdk/mcp`（项目已安装 v2）。
- **仅支持两种 transport**（@ai-sdk/mcp v2 已经**不再支持 stdio**，文档和代码都已移除）：
  - `sse` — Server-Sent Events 长连接
  - `streamable-http` — 普通 HTTP，server 端支持 streaming 响应
- 工具名称前添加 `${serverName}_${toolName}` 前缀，避免与内置工具/其他 MCP 服务器同名冲突
- 配置按用户隔离存储在 `.data/users/{hash}/mcp-servers.json`（匿名存 `.data/mcp-servers.json`）

## 架构

```
用户打开侧栏底部 MCP 面板
   │
   ├─ GET /api/mcp                     列出当前用户的服务器
   ├─ POST /api/mcp { name, transport, url, headers? }   添加
   └─ DELETE /api/mcp?id=xxx           删除
               │
               ▼
               lib/mcp-config.ts 持久化
               │
               ▼ lib/mcp-client.ts
               createMCPClient({ transport: {type:"sse"|"streamable-http", url, headers} })
                   .tools() → 合并到 tools: Record<string, Tool>
               │
               ▼ app/api/chat/route.ts
               Object.assign(tools, mcpTools) → streamText({ tools })
                   .
                   ↓ 模型生成 mcp 工具调用
               chat-message.tsx default 分支 → 通用渲染（加载/输出/错误三态）
```

## 修改 / 新增文件

```
lib/mcp-config.ts              # 增删查 + 持久化 (按 userId 隔离)
lib/mcp-client.ts              # createMCPClient → client.tools() (前缀合并)
app/api/mcp/route.ts           # GET / POST / DELETE（DELETE 带 ?id=）
tools/index.ts                 # 动态调用 loadMCPTools 合并进 tools
components/mcp-panel.tsx       # 侧栏第二个面板：列表 + 添加 Dialog + 删除
components/chat-message.tsx    # default 分支渲染所有未显式注册的 MCP 工具
```

## 依赖

> 项目已安装：`@ai-sdk/mcp` v2。

## 实现要点

### 1. 配置结构

```ts
// lib/mcp-config.ts
export interface MCPServerConfig {
  id: string                      // nanoid()
  name: string                    // 显示名，也用作工具前缀
  transport: "sse" | "streamable-http"
  url: string                     // 服务器地址
  headers?: Record<string, string>
  enabled: boolean
  createdAt: number
}
```

> 注：**早期设计文档里写了 stdio / command / args / env**，但 @ai-sdk/mcp v2 只支持 sse + streamable-http 两种网络传输，stdio 已移除，因此本地文件系统、GitHub 等 stdio 类型的 MCP 需要用户自行部署成 SSE/HTTP 服务端再接入。

### 2. MCP 客户端

```ts
// lib/mcp-client.ts
import { createMCPClient } from "@ai-sdk/mcp"

export async function loadMCPTools(
  configs: MCPServerConfig[],
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {}
  for (const cfg of configs.filter((c) => c.enabled)) {
    try {
      const client = await createMCPClient({
        name: cfg.name,
        transport: {
          type: cfg.transport,
          url: cfg.url,
          headers: cfg.headers,
        },
      })
      const tools = await client.tools()
      // 前缀防冲突： serverName__toolName  (双下划线，易于肉眼区分)
      for (const [toolName, tool] of Object.entries(tools)) {
        merged[`${cfg.name}__${toolName}`] = tool
      }
    } catch (err) {
      console.error(`[MCP] failed to load ${cfg.name}:`, err)
      // 单台服务器失败不阻断聊天主流程
    }
  }
  return merged
}
```

### 3. API 管理

```ts
// app/api/mcp/route.ts
// GET    → listMCPServers(userId)
// POST   → addMCPServer({ name, transport, url, headers }, userId)
// DELETE ?id=xxx → deleteMCPServer(id, userId)
```

> 注：设计文档里写了 `/api/mcp/[id]/route.ts`，实际删除实现合并到了同个 `app/api/mcp/route.ts` 用查询参数 `?id=`，避免额外路由。

### 4. 前端面板

`components/mcp-panel.tsx`（侧栏底部面板 2 / 3）：
- 顶部：`+ 添加 MCP 服务器` 按钮 → Dialog 里填：
  - 名称 name (必填)
  - transport：下拉选 `sse` / `streamable-http`（必填）
  - url（必填，`https://` 开头）
  - headers：可选，JSON textarea 形如 `{"Authorization":"Bearer xxx"}`
- 列表：每条显示 名称、transport、url 截断、状态色、删除 🗑
- 所有 fetch 带 `credentials: "include"`

### 5. 前端渲染通用 MCP 工具

因为 MCP 工具的 schema 由服务器动态定义，不可能为每个都写 part 组件，所以 `components/chat-message.tsx` 的 switch-case 加一个 `default:` 分支，用通用格式渲染所有 `tool-*` 类型：

```tsx
default: {
  if (part.type?.startsWith("tool-")) {
    const state = part.state
    const output = part.output
    if (state === "input-streaming" || state === "input-available")
      return <SpinnerRow label={part.title ?? part.toolCallId} />
    if (state === "output-error")
      return <ErrorRow text={part.errorText ?? "MCP error"} />
    if (output) {
      const s = typeof output === "string" ? output : JSON.stringify(output, null, 2)
      return <pre className="text-xs max-h-64 overflow-auto">{s.slice(0, 1000)}</pre>
    }
  }
  return null
}
```

## 常用公共 MCP 服务器（远程 SSE 部署）

| 项目 | Transport | 说明 |
|------|:---------:|------|
| 自建 `mcp-proxy` HTTP 服务 | sse | 文件系统 / DB，包一层 SSE 暴露 |
| 公司内部工具网关 | streamable-http | 内部 REST → MCP 工具 |
| 公开 MCP 目录 (modelcontextprotocol/servers) | sse | 按 README 部署成 SSE 模式 |

## 注意事项

- **@ai-sdk/mcp v2 已移除 stdio 传输**，不要传 command/args；要本地文件/Postgres/GitHub，请先启动对应 `@modelcontextprotocol/server-*` 进程 + 再用 SSE 包装。
- MCP 服务器超时要设短（默认 30s 内必须连上拿到 tools 列表），否则主聊天接口会被拖慢；实现里放在 `try/catch` + 服务器级错误忽略。
- 工具名前缀：`${serverName}__${toolName}`，不要用单下划线，以免 `github_repo` 和自建 `github` server 同名冲突。
- MCP 配置按用户隔离；匿名用户所有配置存在 `.data/mcp-servers.json`，任何人都能读写（demo 模式），正式环境强制登录。
