"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  SettingsIcon,
  CheckIcon,
  Wand2Icon,
  PlusIcon,
  Trash2Icon,
  SaveIcon,
  XIcon,
  SparklesIcon,
  PencilIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { PROMPT_TEMPLATES, type PromptTemplate } from "@/lib/system-prompts"

type ListItem = PromptTemplate & { custom?: true }

export function SystemPromptDialog({
  chatId,
  currentPrompt,
  onSaved,
}: {
  chatId?: string
  currentPrompt?: string
  onSaved?: (prompt: string, templateId: string) => void
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [selectedTemplate, setSelectedTemplate] = React.useState("default")
  const [customPrompt, setCustomPrompt] = React.useState(currentPrompt ?? "")
  const [saving, setSaving] = React.useState(false)
  const [customTemplates, setCustomTemplates] = React.useState<ListItem[]>([])

  const [creatorOpen, setCreatorOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | undefined>(undefined)
  const [formName, setFormName] = React.useState("")
  const [formDesc, setFormDesc] = React.useState("")
  const [formSystem, setFormSystem] = React.useState("")
  const [formSaving, setFormSaving] = React.useState(false)

  const allTemplates: ListItem[] = React.useMemo(
    () => [...PROMPT_TEMPLATES, ...customTemplates],
    [customTemplates]
  )

  async function loadCustom() {
    try {
      const res = await fetch("/api/prompt-templates", {
        credentials: "include",
      })
      const data = await res.json()
      setCustomTemplates(data.templates ?? [])
    } catch {
      setCustomTemplates([])
    }
  }

  React.useEffect(() => {
    if (open) {
      setSelectedTemplate("default")
      setCustomPrompt(currentPrompt ?? "")
      loadCustom()
    }
  }, [open, currentPrompt])

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplate(templateId)
    const template = allTemplates.find((t) => t.id === templateId)
    if (template) {
      setCustomPrompt(template.systemPrompt)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      let targetChatId = chatId
      if (!targetChatId) {
        const res = await fetch("/api/chats", {
          method: "POST",
          credentials: "include",
        })
        if (!res.ok) return
        const data = await res.json()
        targetChatId = data.id
      }

      await fetch(`/api/chats/${targetChatId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: customPrompt,
          promptTemplateId: selectedTemplate,
        }),
      })

      onSaved?.(customPrompt, selectedTemplate)
      setOpen(false)

      if (!chatId && targetChatId) {
        router.push(`/c/${targetChatId}`)
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  const customTemplateIds: Set<string> = React.useMemo(
    () => new Set(customTemplates.map((t) => t.id)),
    [customTemplates]
  )

  function openCreator(editItem?: ListItem) {
    const isBuiltin = editItem && !customTemplateIds.has(editItem.id)
    if (isBuiltin) {
      setEditingId(undefined)
      setFormName(editItem?.name ? `${editItem.name}（自定义）` : "")
      setFormDesc(editItem?.description ?? "")
      setFormSystem(editItem?.systemPrompt ?? customPrompt)
    } else {
      setEditingId(editItem?.id)
      setFormName(editItem?.name ?? "")
      setFormDesc(editItem?.description ?? "")
      setFormSystem(editItem?.systemPrompt ?? customPrompt)
    }
    setCreatorOpen(true)
  }

  async function handleSaveTemplate() {
    if (!formName.trim() || !formSystem.trim()) return
    setFormSaving(true)
    try {
      const payloadId =
        editingId && customTemplateIds.has(editingId) ? editingId : undefined
      const res = await fetch("/api/prompt-templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: payloadId,
          name: formName,
          description: formDesc,
          systemPrompt: formSystem,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      await loadCustom()
      handleTemplateSelect(data.template.id)
      setCreatorOpen(false)
      setEditingId(undefined)
    } finally {
      setFormSaving(false)
    }
  }

  async function handleDeleteTemplate(templateId: string, e: React.MouseEvent) {
    e.stopPropagation()
    const ok = window.confirm("确定删除此自定义角色吗？")
    if (!ok) return
    try {
      await fetch(`/api/prompt-templates?id=${encodeURIComponent(templateId)}`, {
        method: "DELETE",
        credentials: "include",
      })
      await loadCustom()
      if (selectedTemplate === templateId) {
        setSelectedTemplate("default")
        const t = allTemplates.find((x) => x.id === "default")
        setCustomPrompt(t?.systemPrompt ?? "")
      }
    } catch {
      // ignore
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Assistant settings">
          <SettingsIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>助手角色设置</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">选择角色</label>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => openCreator()}
              >
                <PlusIcon className="size-3.5" data-icon="inline-start" />
                新建角色
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {allTemplates.map((template) => {
                const active = selectedTemplate === template.id
                const isCustom = customTemplateIds.has(template.id)
                return (
                  <div key={template.id} className="relative group">
                    <button
                      type="button"
                      onClick={() => handleTemplateSelect(template.id)}
                      className={`flex w-full flex-col items-start gap-1 rounded-xl border p-3 text-left text-sm transition-all ${
                        active
                          ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      <div className="flex w-full items-center gap-1.5 font-medium">
                        {active && (
                          <CheckIcon className="size-3.5 text-primary" />
                        )}
                        <span className="truncate">{template.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {template.description}
                      </p>
                    </button>
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        title={isCustom ? "编辑" : "基于此角色自定义"}
                        aria-label="Edit template"
                        onClick={(e) => {
                          e.stopPropagation()
                          openCreator(template)
                        }}
                        className="inline-flex size-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border hover:bg-muted hover:text-foreground"
                      >
                        <PencilIcon className="size-3.5" />
                      </button>
                      {isCustom && (
                        <button
                          type="button"
                          title="删除"
                          aria-label="Delete template"
                          onClick={(e) => handleDeleteTemplate(template.id, e)}
                          className="inline-flex size-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground shadow-sm ring-1 ring-border hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2Icon className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">自定义系统提示</label>
            <Textarea
              placeholder="输入你的助手人格、目标、输出风格要求等…"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={5}
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={saving}>
              <Wand2Icon className="size-4" data-icon="inline-start" />
              {saving
                ? chatId
                  ? "保存中…"
                  : "创建中…"
                : chatId
                  ? "应用此角色"
                  : "新建对话并应用角色"}
            </Button>
          </div>
        </div>

        {creatorOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => {
                setCreatorOpen(false)
                setEditingId(undefined)
              }}
            />
            <div
              className="relative z-10 mx-auto w-full max-w-lg rounded-xl border bg-background p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setCreatorOpen(false)
                  setEditingId(undefined)
                }}
                className="absolute right-4 top-4 inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
              <div className="mb-4 flex items-center gap-2">
                <SparklesIcon className="size-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  {editingId ? "编辑角色" : "新建自定义角色"}
                </h2>
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">角色名称</label>
                  <Input
                    placeholder="例如：论文评审助手"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">一句话简介</label>
                  <Input
                    placeholder="简要描述这个角色的能力"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">系统提示</label>
                  <Textarea
                    placeholder="详细描述助手的人格、目标、输出风格、约束条件等…"
                    value={formSystem}
                    onChange={(e) => setFormSystem(e.target.value)}
                    rows={6}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCreatorOpen(false)
                      setEditingId(undefined)
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    onClick={handleSaveTemplate}
                    disabled={formSaving || !formName.trim() || !formSystem.trim()}
                  >
                    <SaveIcon className="size-4" data-icon="inline-start" />
                    {formSaving
                      ? "保存中…"
                      : editingId
                        ? "保存修改"
                        : "保存角色"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
