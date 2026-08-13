"use client"

import * as React from "react"
import { ArrowUpIcon, SquareIcon, PaperclipIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { type GatewayModel } from "@/lib/models"
import { ModelSelect } from "@/components/model-select"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

export interface ImageAttachment {
  file: File
  preview: string
}

const VISUAL_MODEL_PREFIXES = ["openai/", "anthropic/"]
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_IMAGES = 9

function modelSupportsImages(modelId: string): boolean {
  return VISUAL_MODEL_PREFIXES.some((p) => modelId.startsWith(p))
}

export function PromptForm({
  models,
  model,
  onModelChange,
  isBusy,
  onSubmit,
  onStop,
}: {
  models: GatewayModel[]
  model: string
  onModelChange: (model: string) => void
  isBusy: boolean
  onSubmit: (text: string, images?: ImageAttachment[]) => void
  onStop: () => void
}) {
  const [input, setInput] = React.useState("")
  const [images, setImages] = React.useState<ImageAttachment[]>([])
  const [isDragging, setIsDragging] = React.useState(false)
  const [toast, setToast] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const supportsImages = modelSupportsImages(model)

  function showToast(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2800)
  }

  // 处理文件选择：大小 / 类型 / 数量 校验
  function handleFiles(files: FileList | null) {
    if (!supportsImages) {
      showToast("当前模型不支持图片上传，请切换到 GPT / Claude 模型。")
      return
    }
    if (!files) return
    const accepted: File[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue
      if (file.size > MAX_IMAGE_BYTES) {
        showToast(`「${file.name}」超过 5MB，请压缩后再上传。`)
        continue
      }
      accepted.push(file)
    }
    if (!accepted.length) return
    const slot = MAX_IMAGES - images.length
    if (slot <= 0) {
      showToast(`一次最多上传 ${MAX_IMAGES} 张图片。`)
      return
    }
    const sliced = accepted.slice(0, slot)
    const newAttachments = sliced.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }))
    setImages((prev) => [...prev, ...newAttachments])
    if (sliced.length < accepted.length) {
      showToast(`一次最多上传 ${MAX_IMAGES} 张，已截断。`)
    }
  }

  // 拖拽
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!supportsImages) return
    setIsDragging(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  // 移除图片
  function removeImage(idx: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  // 粘贴图片
  function handlePaste(e: React.ClipboardEvent) {
    if (!supportsImages) return
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      handleFiles({ length: files.length, [Symbol.iterator]: () => files[Symbol.iterator](), item: (i: number) => files[i] ?? null } as unknown as FileList)
    }
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    const text = input.trim()
    if ((!text && images.length === 0) || isBusy) return
    onSubmit(text, images.length > 0 ? images : undefined)
    setInput("")
    images.forEach((img) => URL.revokeObjectURL(img.preview))
    setImages([])
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      {toast && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-50 -translate-x-1/2 -translate-y-full rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive shadow-md animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "rounded-lg transition-colors",
          isDragging && "ring-2 ring-primary ring-offset-2"
        )}
      >
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div key={idx} className="relative size-16">
                <img
                  src={img.preview}
                  alt="preview"
                  className="size-full rounded-md object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-foreground p-0.5 text-background"
                  aria-label="Remove image"
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <InputGroup>
          <InputGroupTextarea
            placeholder={
              supportsImages
                ? "发送消息或拖拽/粘贴图片…"
                : "发送消息…（图片上传仅支持 GPT / Claude 模型）"
            }
            className="p-3.5"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                handleSubmit()
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {supportsImages && (
              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Upload image"
                title="上传图片（≤ 5MB）"
                onClick={() => fileInputRef.current?.click()}
              >
                <PaperclipIcon className="size-4" />
              </InputGroupButton>
            )}
            <ModelSelect
              models={models}
              value={model}
              onValueChange={onModelChange}
            />
            {isBusy ? (
              <InputGroupButton
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label="Stop generating"
                className="ml-auto"
                onClick={onStop}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                aria-label="Send message"
                className="ml-auto"
                disabled={!input.trim() && images.length === 0}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  )
}
