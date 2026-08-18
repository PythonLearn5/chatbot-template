"use client"

import * as React from "react"
import {
  BrainCircuitIcon,
  PlusIcon,
  TrashIcon,
  SearchIcon,
  RefreshCwIcon,
  UserIcon,
  LightbulbIcon,
  HeartIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

interface MemoryEntry {
  id: string
  type: "profile" | "fact" | "preference"
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

const TYPE_META: Record<
  MemoryEntry["type"],
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  profile: { label: "个人信息", icon: UserIcon, color: "bg-blue-500/10 text-blue-600" },
  fact: { label: "事实", icon: LightbulbIcon, color: "bg-amber-500/10 text-amber-600" },
  preference: { label: "偏好", icon: HeartIcon, color: "bg-pink-500/10 text-pink-600" },
}

export default function MemoryPage() {
  const [memories, setMemories] = React.useState<MemoryEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")
  const [typeFilter, setTypeFilter] = React.useState<MemoryEntry["type"] | "all">("all")
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [newType, setNewType] = React.useState<MemoryEntry["type"]>("fact")
  const [newKey, setNewKey] = React.useState("")
  const [newValue, setNewValue] = React.useState("")

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/memory", { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setMemories(data.memories ?? [])
      } else {
        setMemories([])
      }
    } catch {
      setMemories([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  async function handleSave() {
    if (!newKey.trim() || !newValue.trim()) return
    setSaving(true)
    try {
      await fetch("/api/memory", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          key: newKey,
          value: newValue,
        }),
      })
      setOpen(false)
      setNewKey("")
      setNewValue("")
      setNewType("fact")
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/memory?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    })
    await refresh()
  }

  const filtered = React.useMemo(() => {
    const q = query.toLowerCase()
    return memories.filter((m) => {
      if (typeFilter !== "all" && m.type !== typeFilter) return false
      if (!q) return true
      return (
        m.key.toLowerCase().includes(q) ||
        m.value.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q)
      )
    })
  }, [memories, query, typeFilter])

  const countBy = React.useMemo(() => {
    const r = { profile: 0, fact: 0, preference: 0 }
    for (const m of memories) r[m.type]++
    return r
  }, [memories])

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto px-8 py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">长期记忆</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI 会长期记住这些信息，并在需要时主动回忆以提升回答个性化与准确性。
          </p>
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
                新增记忆
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新增记忆</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">类型</label>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={newType}
                    onChange={(e) =>
                      setNewType(e.target.value as MemoryEntry["type"])
                    }
                  >
                    <option value="fact">事实 (fact)</option>
                    <option value="profile">个人信息 (profile)</option>
                    <option value="preference">偏好 (preference)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">键名</label>
                  <Input
                    placeholder="如：favoriteLanguage"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">内容</label>
                  <Textarea
                    placeholder="如：用户最喜欢用 TypeScript 开发"
                    rows={4}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                  />
                </div>
                <DialogClose asChild>
                  <Button
                    onClick={handleSave}
                    disabled={saving || !newKey || !newValue}
                  >
                    {saving ? (
                      <>
                        <Spinner
                          className="size-4"
                          data-icon="inline-start"
                        />
                        保存中…
                      </>
                    ) : (
                      "保存"
                    )}
                  </Button>
                </DialogClose>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BrainCircuitIcon className="size-3.5 text-violet-500" />
              全部
            </div>
            <div className="mt-1 text-2xl font-semibold">{memories.length}</div>
          </CardContent>
        </Card>
        {(Object.keys(TYPE_META) as MemoryEntry["type"][]).map((t) => {
          const meta = TYPE_META[t]
          const Icon = meta.icon
          return (
            <Card key={t}>
              <CardContent className="pt-6">
                <div
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    meta.color
                  )}
                >
                  <Icon className="size-3.5" />
                  {meta.label}
                </div>
                <div className="mt-1 text-2xl font-semibold">
                  {countBy[t]}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>记忆列表</CardTitle>
              <CardDescription>点击右上角新增或直接在对话中告诉 AI 「记住…」</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 rounded-md border p-1">
                <TypeChip
                  active={typeFilter === "all"}
                  onClick={() => setTypeFilter("all")}
                >
                  全部
                </TypeChip>
                {(Object.keys(TYPE_META) as MemoryEntry["type"][]).map((t) => (
                  <TypeChip
                    key={t}
                    active={typeFilter === t}
                    onClick={() => setTypeFilter(t)}
                  >
                    {TYPE_META[t].label}
                  </TypeChip>
                ))}
              </div>
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="搜索…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8 sm:w-48"
                />
              </div>
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
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <BrainCircuitIcon className="size-10 text-muted-foreground/50" />
              <div className="text-sm text-muted-foreground">
                {memories.length === 0
                  ? "还没有任何记忆。在对话中让 AI「记住」事情，或点击右上角「新增记忆」。"
                  : "没有匹配的记忆。"}
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((m) => {
                const meta = TYPE_META[m.type]
                const Icon = meta.icon
                return (
                  <div
                    key={m.id}
                    className="flex items-start gap-4 px-6 py-4 hover:bg-muted/30"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Icon className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium">
                          {m.key}
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px]",
                            meta.color
                          )}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {m.value}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground/80">
                        更新于 {new Date(m.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="删除"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TypeChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded px-2 py-1 text-xs transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
