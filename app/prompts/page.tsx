"use client"

import * as React from "react"
import {
  WandIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  SearchIcon,
  RefreshCwIcon,
  MessageSquareIcon,
  LanguagesIcon,
  CodeIcon,
  PenIcon,
  BarChartIcon,
  SparklesIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react"
import dynamicIcon from "next/dynamic"

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
import { Badge } from "@/components/ui/badge"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { PROMPT_TEMPLATES, type PromptTemplate } from "@/lib/system-prompts"
import { cn } from "@/lib/utils"

interface AnyTemplate extends PromptTemplate {
  custom?: boolean
  createdAt?: number
  updatedAt?: number
}

const ICON_CHOICES = [
  { name: "Sparkles", Icon: SparklesIcon },
  { name: "MessageSquare", Icon: MessageSquareIcon },
  { name: "Languages", Icon: LanguagesIcon },
  { name: "Code", Icon: CodeIcon },
  { name: "Pen", Icon: PenIcon },
  { name: "BarChart", Icon: BarChartIcon },
  { name: "Wand", Icon: WandIcon },
  { name: "Brain", Icon: dynamicIcon(() => import("lucide-react").then((m) => m.BrainIcon)) },
] as const

function pickIcon(name?: string) {
  const found = ICON_CHOICES.find((c) => c.name === name)
  return found ? found.Icon : SparklesIcon
}

export default function PromptsPage() {
  const [customs, setCustoms] = React.useState<AnyTemplate[]>([])
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<AnyTemplate | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [copied, setCopied] = React.useState<string | null>(null)

  const [name, setName] = React.useState("")
  const [icon, setIcon] = React.useState<string>("Sparkles")
  const [description, setDescription] = React.useState("")
  const [systemPrompt, setSystemPrompt] = React.useState("")

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/prompt-templates", {
        credentials: "include",
      })
      if (res.ok) {
        const data = await res.json()
        setCustoms(data.templates ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  function openCreate() {
    setEditing(null)
    setName("")
    setIcon("Sparkles")
    setDescription("")
    setSystemPrompt("")
    setOpen(true)
  }

  function openEdit(tpl: AnyTemplate) {
    setEditing(tpl)
    setName(tpl.name)
    setIcon(tpl.icon || "Sparkles")
    setDescription(tpl.description)
    setSystemPrompt(tpl.systemPrompt)
    setOpen(true)
  }

  async function handleSave() {
    if (!name.trim() || typeof systemPrompt !== "string") return
    setSaving(true)
    try {
      await fetch("/api/prompt-templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing?.id,
          name,
          icon,
          description,
          systemPrompt,
        }),
      })
      setOpen(false)
      setEditing(null)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/prompt-templates?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    })
    await refresh()
  }

  async function copyPrompt(tpl: AnyTemplate) {
    await navigator.clipboard.writeText(tpl.systemPrompt)
    setCopied(tpl.id)
    setTimeout(() => setCopied(null), 1500)
  }

  const preset = PROMPT_TEMPLATES
  const all = [
    ...preset.map((t) => ({ ...t, custom: false as const })),
    ...customs.map((t) => ({ ...t, custom: true as const })),
  ]
  const filtered = React.useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return all
    return all.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.systemPrompt.toLowerCase().includes(q)
    )
  }, [all, query])

  const presetFiltered = filtered.filter((t) => !t.custom)
  const customFiltered = filtered.filter((t) => t.custom)

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto px-8 py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">提示词模板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            预设角色模板 + 自定义系统提示词，开启新对话时一键选择。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="搜索模板…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 sm:w-60"
            />
          </div>
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
              <Button onClick={openCreate}>
                <PlusIcon className="size-4" data-icon="inline-start" />
                新建模板
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {editing ? "编辑模板" : "新建模板"}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">名称</label>
                    <Input
                      placeholder="如：写作助手"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted-foreground">图标</label>
                    <div className="flex flex-wrap gap-1 rounded-md border p-1.5">
                      {ICON_CHOICES.map((c) => {
                        const I = c.Icon
                        return (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() => setIcon(c.name)}
                            className={cn(
                              "flex size-7 items-center justify-center rounded transition",
                              icon === c.name
                                ? "bg-foreground text-background"
                                : "text-muted-foreground hover:bg-muted"
                            )}
                            aria-label={c.name}
                            title={c.name}
                          >
                            <I className="size-3.5" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">描述</label>
                  <Input
                    placeholder="简要说明此模板的用途"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground">
                    系统提示词
                  </label>
                  <Textarea
                    rows={8}
                    className="font-mono text-xs"
                    placeholder="你是一位资深…"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                  />
                </div>
                <DialogClose asChild>
                  <Button onClick={handleSave} disabled={saving || !name}>
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

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">预设模板</div>
            <div className="mt-1 text-2xl font-semibold">{preset.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">自定义模板</div>
            <div className="mt-1 text-2xl font-semibold">{customs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">合计</div>
            <div className="mt-1 text-2xl font-semibold">{all.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">全部 ({filtered.length})</TabsTrigger>
          <TabsTrigger value="preset">预设 ({presetFiltered.length})</TabsTrigger>
          <TabsTrigger value="custom">
            自定义 ({customFiltered.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4 space-y-4">
          <TemplateGrid
            templates={filtered}
            onCopy={copyPrompt}
            onEdit={openEdit}
            onDelete={handleDelete}
            copied={copied}
            loading={loading}
          />
        </TabsContent>
        <TabsContent value="preset" className="mt-4 space-y-4">
          <TemplateGrid
            templates={presetFiltered}
            onCopy={copyPrompt}
            onEdit={() => {}}
            onDelete={() => {}}
            copied={copied}
            loading={loading}
          />
        </TabsContent>
        <TabsContent value="custom" className="mt-4 space-y-4">
          <TemplateGrid
            templates={customFiltered}
            onCopy={copyPrompt}
            onEdit={openEdit}
            onDelete={handleDelete}
            copied={copied}
            loading={loading}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TemplateGrid({
  templates,
  onCopy,
  onEdit,
  onDelete,
  copied,
  loading,
}: {
  templates: AnyTemplate[]
  onCopy: (tpl: AnyTemplate) => void
  onEdit: (tpl: AnyTemplate) => void
  onDelete: (id: string) => void
  copied: string | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Spinner />
        加载中…
      </div>
    )
  }
  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <WandIcon className="size-10 text-muted-foreground/50" />
        <div className="text-sm text-muted-foreground">暂无模板。</div>
      </div>
    )
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((t) => {
        const Icon = pickIcon(t.icon)
        return (
          <Card key={t.id} className="flex h-full flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    {t.custom ? (
                      <Badge variant="secondary" className="text-[10px]">
                        自定义
                      </Badge>
                    ) : (
                      <Badge className="text-[10px]">预设</Badge>
                    )}
                  </div>
                  <CardDescription className="mt-1 line-clamp-2">
                    {t.description || "（无描述）"}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="flex flex-1 flex-col gap-3 pt-4">
              <div className="line-clamp-6 rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {t.systemPrompt ? (
                  t.systemPrompt
                ) : (
                  <span className="italic text-muted-foreground/60">
                    无系统提示词（默认通用助手）
                  </span>
                )}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onCopy(t)}
                  disabled={!t.systemPrompt}
                >
                  {copied === t.id ? (
                    <>
                      <CheckIcon className="size-3.5" data-icon="inline-start" />
                      已复制
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3.5" data-icon="inline-start" />
                      复制提示词
                    </>
                  )}
                </Button>
                {t.custom ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onEdit(t)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="编辑"
                    >
                      <PencilIcon className="size-4" />
                    </button>
                    <button
                      onClick={() => onDelete(t.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="删除"
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    内置
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
