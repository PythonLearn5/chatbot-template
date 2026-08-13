# 多模态支持 (Multimodal)

## 目标

让聊天机器人支持图片输入，实现：
- 用户上传图片（拖拽 / 粘贴 / 选择文件）
- 视觉模型识别图片内容并回答
- 图片与文本混合输入

## 技术方案

利用 AI SDK 7 对 `FileUIPart` 的原生支持：
- 前端：FileList / DragEvent / ClipboardEvent 拿 File → 浏览器端 `FileReader` 读成 ArrayBuffer → base64 → 拼成 data URL
- 发给 `/api/chat` 的消息结构是 `UIMessage` 带 parts：`[{type:"text", text:"..."}, {type:"file", mediaType:"image/png", url:"data:image/png;base64,XXXX", filename:"shot.png"}]`
- 后端 `validateUIMessages → convertToModelMessages` 自动将 image part 转成多模态消息内容（Claude/GPT-4V/VLM 原生支持）

## 架构

```
浏览器
┌──────────────────────────────────────┐
│ PromptForm                           │
│  ├─ textarea                         │
│  ├─ 📎 选择文件 (accept=image/*)      │
│  ├─ onDrop 拖拽                      │
│  ├─ onPaste 粘贴 (clipboardData.items)│
│  └─ 预览缩略图 + ✕ 移除按钮           │
└──────────────┬───────────────────────┘
               │ sendMessage({ text, experimental_attachments })
               ▼
  POST /api/chat (body = { messages, id, model })
               │
               ▼
  convertToModelMessages(messages)
    └─ file part mediaType=image/* → 模型视觉理解
```

## 修改 / 新增文件

```
components/prompt-form.tsx    # 上传 / 拖拽 / 粘贴 / 预览 / 移除
components/chat.tsx           # File → base64 data URL （发送前转换）
components/chat-message.tsx   # 用户消息渲染图片气泡
```

## 实现要点

### 1. 前端上传 UI

```tsx
// components/prompt-form.tsx
type PendingFile = { id: string; file: File; preview: string }
const [pending, setPending] = useState<PendingFile[]>([])
const inputRef = useRef<HTMLInputElement>(null)

// 1) 选择文件
const onAdd = (files: FileList | File[]) => {
  const arr = Array.from(files).filter((f) => f.type.startsWith("image/"))
  // 大小校验：单张 < 5 MB
  const over = arr.find((f) => f.size > 5 * 1024 * 1024)
  if (over) { alert(`${over.name} 超过 5MB`); return }
  for (const f of arr) {
    const reader = new FileReader()
    reader.onload = () => setPending((prev) => [...prev, {
      id: Math.random().toString(36).slice(2),
      file: f,
      preview: reader.result as string,
    }])
    reader.readAsDataURL(f)
  }
}

// 2) 粘贴
const onPaste = (e: React.ClipboardEvent) => {
  const items = Array.from(e.clipboardData?.items ?? [])
  const files = items
    .filter((i) => i.kind === "file")
    .map((i) => i.getAsFile() as File)
    .filter(Boolean)
  if (files.length) onAdd(files)
}

// 3) 拖拽
const [dragging, setDragging] = useState(false)
<div
  onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
  onDragLeave={() => setDragging(false)}
  onDrop={(e) => {
    e.preventDefault(); setDragging(false)
    onAdd(e.dataTransfer.files)
  }}
  className={cn("rounded-xl", dragging && "ring-2 ring-primary/40 bg-muted/30")}
>
```

### 2. 发送前转 data URL（FileUIPart）

```ts
// components/chat.tsx  — 提交前 handler
function filesToParts(list: File[]): Promise<any[]> {
  return Promise.all(list.map((file) => new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => {
      const buf = r.result as ArrayBuffer
      const bin = Array.from(new Uint8Array(buf)).map((b) => String.fromCharCode(b)).join("")
      const b64 = window.btoa(bin)
      resolve({
        type: "file",
        mediaType: file.type,
        filename: file.name,
        url: `data:${file.type};base64,${b64}`,
      })
    }
    r.readAsArrayBuffer(file)
  })))
}

// 提交时：
const parts: any[] = [{ type: "text", text: input }]
parts.push(...(await filesToParts(pending.map((p) => p.file))))
append({ role: "user", parts })
```

### 3. 用户消息渲染

```tsx
// components/chat-message.tsx  (role === "user")
{message.parts
  .filter((p) => p.type === "file")
  .map((part, i) => {
    const url = part.url ?? (typeof part.data === "string" ? part.data : null)
    if (url && part.mediaType?.startsWith("image/")) {
      return (
        <img
          key={`file-${i}`}
          src={url}
          alt="uploaded"
          className="max-h-48 max-w-64 rounded-lg object-contain shadow-sm"
        />
      )
    }
    return null
  })}
```

## 视觉模型白名单

非视觉模型（例如 `inclusionai/*` 纯文本、开源小模型）不支持图片。前端按模型前缀显示/隐藏上传按钮：

```ts
const VISUAL_MODEL_PREFIXES = [
  "openai/",     // gpt-4o, gpt-4.1
  "anthropic/",  // claude 3.x sonnet/opus/s
]
export function modelSupportsImages(modelId: string): boolean {
  return VISUAL_MODEL_PREFIXES.some((p) => modelId.startsWith(p))
}
```

- 非视觉模型：PromptForm 隐藏 📎 上传按钮，拖拽/粘贴会提示"当前模型不支持图片，请切换到 GPT 或 Claude"

## 限制

| 项 | 值 | 说明 |
|----|----|------|
| 单图大小 | ≤ 5 MB | 超过会 alert，不加入待发送队列 |
| 格式 | JPEG / PNG / GIF / WebP | 由 `file.type.startsWith("image/")` 过滤 |
| 一次最多 | 9 张 | 前端限制数组长度，避免 prompt 过大 |
| 数据编码 | base64 data URL | 浏览器端编码，不上传到后端再转发 |

## 注意事项

- base64 膨胀约 33%，5 MB 的 PNG 实际 ~7 MB 文本；token 成本高，建议发缩略图/压缩后图
- 纯文本模型调图片会报错 `image_content`，前端白名单模式尽量避免用户踩坑
- 匿名模式完全能发图片（/api/chat 允许匿名），存储仅在内存中（不落地，除了整体消息在 chat/route.ts 的 saveChat 中落盘——落盘 data URL 会很占磁盘，可考虑未来把原图单独存为 `.data/users/{hash}/attachments/{id}`，消息里只存相对路径）
