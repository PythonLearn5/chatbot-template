// ============================================================================
// MCP 配置存储 — 管理 MCP 服务器配置
// ============================================================================

import "server-only"
import { promises as fs } from "fs"
import path from "path"

const MCP_DIR = path.join(process.cwd(), ".data", "mcp")

export interface MCPServerConfig {
  id: string
  name: string
  transport: "sse" | "streamable-http"
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: number
}

async function ensureDir() {
  await fs.mkdir(MCP_DIR, { recursive: true })
}

function getIndexPath() {
  return path.join(MCP_DIR, "servers.json")
}

export async function listMCPServers(): Promise<MCPServerConfig[]> {
  try {
    const content = await fs.readFile(getIndexPath(), "utf-8")
    return JSON.parse(content) as MCPServerConfig[]
  } catch {
    return []
  }
}

export async function saveMCPServer(config: MCPServerConfig): Promise<void> {
  await ensureDir()
  const servers = await listMCPServers()
  const idx = servers.findIndex((s) => s.id === config.id)
  if (idx >= 0) {
    servers[idx] = config
  } else {
    servers.push(config)
  }
  await fs.writeFile(getIndexPath(), JSON.stringify(servers))
}

export async function deleteMCPServer(id: string): Promise<void> {
  const servers = await listMCPServers()
  const filtered = servers.filter((s) => s.id !== id)
  await ensureDir()
  await fs.writeFile(getIndexPath(), JSON.stringify(filtered))
}
