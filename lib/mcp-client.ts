// ============================================================================
// MCP 客户端 — 连接 MCP 服务器，加载外部工具
// 使用 @ai-sdk/mcp（项目中已安装）
// 注意：@ai-sdk/mcp v2 只支持 SSE 和 HTTP 传输，不支持 stdio
// ============================================================================

import "server-only"
import { createMCPClient } from "@ai-sdk/mcp"
import type { MCPServerConfig } from "./mcp-config"

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
        tools[`${config.name}_${name}`] = tool
      }
    } catch (err) {
      console.error(`[MCP] Failed to connect to ${config.name} (${config.url}):`, err)
    }
  }

  return tools
}
