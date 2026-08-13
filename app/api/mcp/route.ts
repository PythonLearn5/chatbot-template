// ============================================================================
// MCP 服务器管理 API
// GET    → 列出所有 MCP 服务器
// POST   → 添加 MCP 服务器
// DELETE → 删除 MCP 服务器 (?id=xxx)
// ============================================================================

import { NextResponse } from "next/server"
import {
  listMCPServers,
  saveMCPServer,
  deleteMCPServer,
  type MCPServerConfig,
} from "@/lib/mcp-config"

export async function GET() {
  try {
    const servers = await listMCPServers()
    return NextResponse.json({ servers })
  } catch {
    return NextResponse.json({ error: "Failed to list MCP servers." }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const config: MCPServerConfig = {
      id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: (body as { name?: string })?.name ?? "unnamed",
      transport: ((body as { transport?: string })?.transport ?? "sse") as MCPServerConfig["transport"],
      url: (body as { url?: string })?.url,
      headers: (body as { headers?: Record<string, string> })?.headers,
      enabled: (body as { enabled?: boolean })?.enabled ?? true,
      createdAt: Date.now(),
    }
    await saveMCPServer(config)
    return NextResponse.json(config)
  } catch {
    return NextResponse.json({ error: "Failed to add MCP server." }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "ID required." }, { status: 400 })
  }
  try {
    await deleteMCPServer(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete." }, { status: 500 })
  }
}
