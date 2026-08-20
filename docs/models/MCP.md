# MCP 协议支持 (Model Context Protocol)

## 概述

本项目已实现运行时动态接入外部 MCP 服务器，无需改代码即可扩展工具能力：

- 前端 UI 管理 MCP 服务器配置（添加 / 切换 / 删除）
- 模型可调用 MCP 服务器提供的任意工具（自动解析 inputSchema）
- 配置存储在 Supabase PostgreSQL（全局配置，不按用户隔离）

## 涉及文件

```
lib/mcp-config.ts              # 配置存储（Supabase mcp_servers 表）
lib/mcp-client.ts              # MCP 客户端（createMCPClient → tools()）
app/api/mcp/route.ts           # REST API: GET / POST / PATCH / DELETE
app/api/chat/route.ts          # 集成：loadMCPTools → Object.assign(tools, mcpTools)
supabase/migrations/
  001_init_schema.sql          # mcp_servers 表定义
  003_seed_mcp_servers.sql     # 种子数据
```

## 依赖

> 项目已安装：`@ai-sdk/mcp` v2。

@ai-sdk/mcp v2 只支持两种网络传输，**不支持 stdio**：
- `sse` — Server-Sent Events 长连接
- `streamable-http` — 普通 HTTP，server 端支持 streaming 响应

## 数据表结构

```sql
-- supabase/migrations/001_init_schema.sql
CREATE TABLE mcp_servers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  transport  TEXT NOT NULL,
  url        TEXT,
  headers    JSONB,
  enabled    BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**重要：** 该表**没有 `user_id` 列** — MCP 配置是**全局配置**，不按用户隔离。所有用户共享同一份 MCP 服务器列表。

### 种子数据

```sql
-- supabase/migrations/003_seed_mcp_servers.sql
INSERT INTO mcp_servers (id, name, transport, url, enabled, created_at)
VALUES
  ('toolkit-mcp', 'Toolkit MCP', 'streamable-http', 'https://toolkit.caseyjhand.com/mcp', true, now())
ON CONFLICT (id) DO NOTHING;
```

预置一个 Toolkit MCP 服务器（streamable-http 传输）。

## 配置结构

```ts
// lib/mcp-config.ts
export interface MCPServerConfig {
  id: string
  name: string                      // 显示名，也用作工具前缀
  transport: "sse" | "streamable-http"
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: number
}
```

## 配置存储 (lib/mcp-config.ts)

```ts
// 列出所有 MCP 服务器（全局，不按用户隔离）
export async function listMCPServers(): Promise<MCPServerConfig[]> {
  const { data, error } = await supabase
    .from("mcp_servers")
    .select()
    .order("created_at", { ascending: true })  // 按 created_at 升序
  // ...
}

// 保存（upsert by id）
export async function saveMCPServer(config: MCPServerConfig): Promise<void> {
  // 先查询是否存在
  // 存在 → UPDATE
  // 不存在 → INSERT
}

// 删除
export async function deleteMCPServer(id: string): Promise<void> {
  await supabase.from("mcp_servers").delete().eq("id", id)
}
```

- `listMCPServers` 按 `created_at` **升序**（ASC）排列
- `saveMCPServer` 先查询是否已存在，存在则 `UPDATE`，不存在则 `INSERT`

## MCP 客户端 (lib/mcp-client.ts)

```ts
import { createMCPClient } from "@ai-sdk/mcp"

export async function loadMCPTools(configs: MCPServerConfig[]) {
  const tools: Record<string, unknown> = {}

  for (const config of configs.filter((c) => c.enabled && c.url)) {
    try {
      console.log(`[MCP] Connecting to ${config.name} (${config.transport}) at ${config.url}`)

      const client = await createMCPClient({
        transport: {
          type: config.transport === "streamable-http" ? "http" : "sse",
          url: config.url!,
        },
      })

      const mcpTools = await client.tools()
      const toolNames = Object.keys(mcpTools)
      console.log(`[MCP] ${config.name}: loaded ${toolNames.length} tools: ${toolNames.join(", ")}`)

      for (const [name, tool] of Object.entries(mcpTools)) {
        tools[`${config.name}_${name}`] = tool  // 单下划线前缀
      }
    } catch (err) {
      console.error(`[MCP] Failed to connect to ${config.name} (${config.url}):`, err)
    }
  }

  return tools
}
```

### 关键实现细节

| 要点 | 实际实现 | 说明 |
|------|----------|------|
| 工具前缀 | `${config.name}_${name}` | **单下划线**（非双下划线） |
| 传输映射 | `"streamable-http"` → `"http"` | createMCPClient 接收的是 `"http"`，不是 `"streamable-http"` |
| headers | **不传给 createMCPClient** | 配置中有 headers 字段但实际未传递 |
| 过滤条件 | `c.enabled && c.url` | 只连接启用且有 URL 的服务器 |
| 日志 | `console.log` 成功 / `console.error` 失败 | 连接成功打印工具列表，失败打印错误 |
| 错误处理 | try/catch 单服务器级别 | 单台服务器失败不阻断聊天主流程 |

## REST API (app/api/mcp/route.ts)

```ts
// GET → 列出所有 MCP 服务器
export async function GET() {
  const servers = await listMCPServers()
  return NextResponse.json({ servers })
}

// POST → 添加 MCP 服务器
export async function POST(req: Request) {
  const body = await req.json()
  const config: MCPServerConfig = {
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: body.name ?? "unnamed",
    transport: body.transport ?? "sse",
    url: body.url,
    headers: body.headers,
    enabled: body.enabled ?? true,
    createdAt: Date.now(),
  }
  await saveMCPServer(config)
  return NextResponse.json(config)
}

// PATCH → 切换启用/禁用
export async function PATCH(req: Request) {
  const body = await req.json()  // { id, enabled }
  const all = await listMCPServers()
  const target = all.find((s) => s.id === body.id)
  const updated = { ...target, enabled: body.enabled ?? target.enabled }
  await saveMCPServer(updated)
  return NextResponse.json(updated)
}

// DELETE → 删除服务器 (?id=xxx)
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")
  await deleteMCPServer(id)
  return NextResponse.json({ success: true })
}
```

| 方法 | 功能 | 参数 |
|------|------|------|
| GET | 列出所有服务器 | 无 |
| POST | 添加服务器 | body: `{ name, transport, url, headers?, enabled? }` |
| PATCH | 切换启用/禁用 | body: `{ id, enabled }` |
| DELETE | 删除服务器 | query: `?id=xxx` |

## Chat 路由集成

```ts
// app/api/chat/route.ts

// ── 模块 7 + 模块 3：工具集（基础工具 + MCP 动态工具）──
const tools = getTools(modelId, userId)
try {
  const mcpConfigs = await listMCPServers()
  if (mcpConfigs.some((c) => c.enabled)) {
    const mcpTools = (await loadMCPTools(mcpConfigs)) as Record<string, unknown>
    if (Object.keys(mcpTools).length > 0) {
      Object.assign(tools, mcpTools)
    }
  }
} catch {
  // MCP 加载失败不影响主流程
}
```

### 集成流程

```
getTools(modelId, userId) → 基础工具集
    │
    ▼ listMCPServers() → 读取全局配置
    │
    ▼ 检查是否有 enabled 的服务器
    │  → 否: 跳过，只用基础工具
    │  → 是: loadMCPTools(mcpConfigs)
    │
    ▼ loadMCPTools:
    │   1. 过滤 enabled && url 的配置
    │   2. 逐个 createMCPClient + client.tools()
    │   3. 前缀合并: `${serverName}_${toolName}`
    │   4. 单台失败 → console.error，继续下一台
    │
    ▼ Object.assign(tools, mcpTools) → 合并到工具集
    │
    ▼ streamText({ tools }) → 模型可调用 MCP 工具
```

- MCP 加载失败被 `try/catch` 静默捕获，**不会阻断聊天**
- MCP 工具通过 `Object.assign` 合并到 `tools` 对象
- 只有当 `mcpTools` 非空时才合并（`Object.keys(mcpTools).length > 0`）

## 架构

```
用户打开 /mcp 管理页面
   │
   ├─ GET /api/mcp                     列出所有服务器
   ├─ POST /api/mcp { name, transport, url, headers? }   添加
   ├─ PATCH /api/mcp { id, enabled }   切换启用/禁用
   └─ DELETE /api/mcp?id=xxx           删除
               │
               ▼ lib/mcp-config.ts (Supabase mcp_servers 表)
               │
               ▼ lib/mcp-client.ts
               createMCPClient({ transport: {type: "sse"|"http", url} })
                   .tools() → 前缀合并到 tools
               │
               ▼ app/api/chat/route.ts
               Object.assign(tools, mcpTools) → streamText({ tools })
                   .
                   ↓ 模型生成 mcp 工具调用
               chat-message.tsx default 分支 → 通用渲染
```

## 常用公共 MCP 服务器

| 项目 | Transport | 说明 |
|------|:---------:|------|
| Toolkit MCP | streamable-http | `https://toolkit.caseyjhand.com/mcp`（种子预置） |
| 自建 `mcp-proxy` HTTP 服务 | sse | 文件系统 / DB，包一层 SSE 暴露 |
| 公司内部工具网关 | streamable-http | 内部 REST → MCP 工具 |
| 公开 MCP 目录 (modelcontextprotocol/servers) | sse | 按 README 部署成 SSE 模式 |

## 注意事项

- **@ai-sdk/mcp v2 已移除 stdio 传输**，不要传 command/args；要本地文件/Postgres/GitHub，请先启动对应 `@modelcontextprotocol/server-*` 进程 + 再用 SSE 包装
- MCP 服务器超时要设短（默认 30s 内必须连上拿到 tools 列表），否则主聊天接口会被拖慢；实现里放在 `try/catch` + 服务器级错误忽略
- 工具名前缀使用**单下划线** `${serverName}_${toolName}`
- 传输类型映射：配置中存 `"streamable-http"`，传给 `createMCPClient` 时转为 `"http"`
- 配置中的 `headers` 字段当前**未传递给 createMCPClient**，如需鉴权头需后续补充
- MCP 配置是**全局**的（无 `user_id` 隔离），所有用户共享同一份服务器列表
