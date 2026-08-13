"use client"

import * as React from "react"
import { SettingsIcon, CheckIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { PROMPT_TEMPLATES } from "@/lib/system-prompts"

export function SystemPromptDialog({
  chatId,
  currentPrompt,
  onSaved,
}: {
  chatId?: string
  currentPrompt?: string
  onSaved?: (prompt: string, templateId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [selectedTemplate, setSelectedTemplate] = React.useState("default")
  const [customPrompt, setCustomPrompt] = React.useState(currentPrompt ?? "")
  const [saving, setSaving] = React.useState(false)

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplate(templateId)
    const template = PROMPT_TEMPLATES.find((t) => t.id === templateId)
    if (template) {
      setCustomPrompt(template.systemPrompt)
    }
  }

  async function handleSave() {
    if (!chatId) return
    setSaving(true)
    try {
      await fetch(`/api/chats/${chatId}`, {
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
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Assistant settings">
          <SettingsIcon className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>助手角色设置</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {PROMPT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-muted ${
                  selectedTemplate === template.id
                    ? "border-primary bg-primary/10"
                    : ""
                }`}
              >
                {selectedTemplate === template.id && (
                  <CheckIcon className="size-3" />
                )}
                {template.name}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">自定义系统提示</label>
            <Textarea
              placeholder="输入自定义系统提示…"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={4}
            />
          </div>
          <Button onClick={handleSave} disabled={!chatId || saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
