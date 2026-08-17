"use client"

import * as React from "react"
import { ServerIcon, PlusIcon, TrashIcon, GlobeIcon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface MCPServer {
  id: string
  name: string
  transport: "sse" | "streamable-http"
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  createdAt: number
}

export default function MCPPage() {
  const [servers, setServers] = React.useState<MCPServer[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [url, setUrl] = React.useState("")
  const [transport, setTransport] =
    React.useState<MCPServer["transport"]>("sse")

  const refresh = React.useCallback(async () => {
    setLoading(true)
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
      setTransport("sse")
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

  async function handleToggle(id: string, enabled: boolean) {
    await fetch("/api/mcp", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled: !enabled }),
    })
    await refresh()
  }

  const enabledCount = servers.filter((s) => s.enabled).length

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MCP 服务器</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          通过 MCP（Model Context Protocol）连接外部工具和数据源，扩展 AI
          的能力边界。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">服务器总数</div>
            <div className="mt-1 text-2xl font-semibold">{servers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">已启用</div>
            <div className="mt-1 text-2xl font-semibold">{enabledCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">已禁用</div>
            <div className="mt-1 text-2xl font-semibold">
              {servers.length - enabledCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>服务器列表</CardTitle>
              <CardDescription>
                支持 SSE 与 Streamable HTTP 两种传输方式
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refresh}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="刷新"
              >
                <RefreshCwIcon
                  className={cn("size-4", loading && "animate-spin")}
                />
              </button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <PlusIcon className="size-4" data-icon="inline-start" />
                    添加服务器
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>添加 MCP 服务器</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted-foreground">
                        名称
                      </label>
                      <Input
                        placeholder="my-mcp-server"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted-foreground">
                        传输类型
                      </label>
                      <select
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                        value={transport}
                        onChange={(e) =>
                          setTransport(
                            e.target.value as MCPServer["transport"]
                          )
                        }
                      >
                        <option value="sse">SSE（Server-Sent Events）</option>
                        <option value="streamable-http">
                          Streamable HTTP
                        </option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted-foreground">
                        服务器 URL
                      </label>
                      <Input
                        placeholder="https://mcp.example.com/sse"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    </div>
                    <DialogClose asChild>
                      <Button
                        onClick={handleAdd}
                        disabled={adding || !name || !url}
                      >
                        {adding ? (
                          <>
                            <Spinner
                              className="size-4"
                              data-icon="inline-start"
                            />
                            添加中…
                          </>
                        ) : (
                          "添加"
                        )}
                      </Button>
                    </DialogClose>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Spinner />
              加载中…
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <ServerIcon className="size-10 text-muted-foreground/50" />
              <div className="text-sm text-muted-foreground">
                暂无 MCP 服务器，点击右上角「添加服务器」开始。
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {servers.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <ServerIcon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium">
                        {s.name}
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px]",
                          s.enabled
                            ? "bg-green-500/10 text-green-600"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {s.enabled ? "已启用" : "已禁用"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <GlobeIcon className="size-3" />
                        <span className="truncate">{s.url}</span>
                      </span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 uppercase">
                        {s.transport === "sse" ? "SSE" : "STH"}
                      </span>
                      <span>
                        加入于 {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggle(s.id, s.enabled)}
                    >
                      {s.enabled ? "禁用" : "启用"}
                    </Button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="删除"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
