// ============================================================================
// MCP 配置存储 — 管理 MCP 服务器配置（Supabase PostgreSQL）
// ============================================================================

import "server-only"
import { supabase } from "@/lib/db"

export interface MCPServerConfig {
  id: string
  name: string
  transport: "sse" | "streamable-http"
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: number
}

interface DBMCPServer {
  id: string
  name: string
  transport: string
  url: string | null
  headers: Record<string, string> | null
  enabled: boolean
  created_at: string
}

function toConfig(row: DBMCPServer): MCPServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as MCPServerConfig["transport"],
    url: row.url ?? undefined,
    headers: row.headers ?? undefined,
    enabled: row.enabled,
    createdAt: new Date(row.created_at).getTime(),
  }
}

export async function listMCPServers(): Promise<MCPServerConfig[]> {
  const { data, error } = await supabase
    .from("mcp_servers")
    .select()
    .order("created_at", { ascending: true })

  if (error || !data) return []
  return (data as unknown as DBMCPServer[]).map(toConfig)
}

export async function saveMCPServer(config: MCPServerConfig): Promise<void> {
  const { data: existing } = await supabase
    .from("mcp_servers")
    .select("id")
    .eq("id", config.id)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from("mcp_servers")
      .update({
        name: config.name,
        transport: config.transport,
        url: config.url ?? null,
        headers: config.headers ?? null,
        enabled: config.enabled,
      })
      .eq("id", config.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from("mcp_servers").insert({
    id: config.id,
    name: config.name,
    transport: config.transport,
    url: config.url ?? null,
    headers: config.headers ?? null,
    enabled: config.enabled,
    created_at: new Date().toISOString(),
  })
  if (error) throw error
}

export async function deleteMCPServer(id: string): Promise<void> {
  const { error } = await supabase.from("mcp_servers").delete().eq("id", id)
  if (error) throw error
}
