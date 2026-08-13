"use client"

import * as React from "react"
import { ServerIcon, PlusIcon, TrashIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"

interface MCPServer {
  id: string
  name: string
  transport: "sse" | "streamable-http"
  url?: string
  enabled: boolean
  createdAt: number
}

export function MCPPanel() {
  const [servers, setServers] = React.useState<MCPServer[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [transport, setTransport] = React.useState<"sse" | "streamable-http">("sse")

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/mcp", { credentials: "include" })
      const data = await res.json()
      setServers(data.servers ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  async function handleAdd() {
    if (!name.trim() || !url.trim()) return
    setAdding(true)
    try {
      await fetch("/api/mcp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, transport, enabled: true }),
      })
      setOpen(false)
      setName("")
      setUrl("")
      await refresh()
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/mcp?id=${id}`, {
      method: "DELETE",
      credentials: "include",
    })
    await refresh()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">MCP 服务器</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <PlusIcon className="size-3.5" data-icon="inline-start" />
              添加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加 MCP 服务器</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">名称</label>
                <Input
                  placeholder="my-mcp-server"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">传输类型</label>
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={transport}
                  onChange={(e) =>
                    setTransport(
                      e.target.value as "sse" | "streamable-http"
                    )
                  }
                >
                  <option value="sse">SSE</option>
                  <option value="streamable-http">Streamable HTTP</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground">URL</label>
                <Input
                  placeholder="https://mcp.example.com/sse"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <DialogClose asChild>
                <Button onClick={handleAdd} disabled={adding || !name || !url}>
                  {adding ? "添加中…" : "添加"}
                </Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : servers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          暂无服务器。添加 MCP 服务器以扩展工具能力。
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {servers.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
            >
              <ServerIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{s.name}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  s.enabled
                    ? "bg-green-500/10 text-green-600"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s.enabled ? "启用" : "禁用"}
              </span>
              <button
                onClick={() => handleDelete(s.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete MCP server"
              >
                <TrashIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
