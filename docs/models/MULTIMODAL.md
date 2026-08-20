# 多模态支持 (Multimodal)

## 概述

本项目已实现图片输入支持，用户可以通过拖拽、粘贴或选择文件上传图片，视觉模型识别图片内容并回答，支持图片与文本混合输入。

## 涉及文件

```
components/prompt-form.tsx    # 上传 / 拖拽 / 粘贴 / 预览 / 移除
components/chat.tsx           # File → base64 data URL 转换（filesToParts）
components/chat-message.tsx   # 用户消息渲染图片气泡
app/api/chat/route.ts        # 视觉模型回退 + data URL 规范化
```

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
               │ sendMessage({ text, files })
               ▼
  components/chat.tsx
  filesToParts(): File → arrayBuffer → base64 → data URL
               │
               ▼
  POST /api/chat (body = { messages, id, model })
               │
               ▼
  app/api/chat/route.ts:
  1. normalizeModelMessageContent() → 规范化 data URL
  2. hasVisualParts 检测 → Anthropic 自动回退到 GPT
  3. convertToModelMessages → 模型视觉理解
```

## 视觉模型白名单

```ts
// components/prompt-form.tsx
const VISUAL_MODEL_PREFIXES = ["openai/", "anthropic/"]

function modelSupportsImages(modelId: string): boolean {
  return VISUAL_MODEL_PREFIXES.some((p) => modelId.startsWith(p))
}
```

- 支持视觉的模型前缀：`openai/`（GPT 系列）和 `anthropic/`（Claude 系列）
- 非视觉模型（如 `inclusionai/*`、`alibaba/*` 等纯文本模型）：隐藏 📎 上传按钮，拖拽/粘贴会提示"当前模型不支持图片上传，请切换到 GPT / Claude 模型"

## 前端实现

### 1. 上传 UI (components/prompt-form.tsx)

```ts
const MAX_IMAGE_BYTES = 5 * 1024 * 1024  // 5 MB
const MAX_IMAGES = 9

// 处理文件选择：大小 / 类型 / 数量 校验
function handleFiles(files: FileList | null) {
  if (!supportsImages) {
    showToast("当前模型不支持图片上传，请切换到 GPT / Claude 模型。")
    return
  }
  const accepted: File[] = []
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue
    if (file.size > MAX_IMAGE_BYTES) {
      showToast(`「${file.name}」超过 5MB，请压缩后再上传。`)
      continue
    }
    accepted.push(file)
  }
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
}
```

功能：
- **文件选择**：`<input type="file" accept="image/*" multiple>`，点击 📎 按钮触发
- **拖拽**：`onDragOver` / `onDragLeave` / `onDrop`，拖拽时显示 `ring-2 ring-primary` 高亮
- **粘贴**：`onPaste` 检查 `clipboardData.items`，提取 `image/*` 类型文件
- **预览**：缩略图列表（64x64），每张带 ✕ 移除按钮
- **Toast 提示**：超过 5MB、超过 9 张、模型不支持时显示错误提示

### 2. 发送前转 data URL (components/chat.tsx)

```ts
// components/chat.tsx — onSubmit handler
onSubmit={(text, images) => {
  if (images && images.length > 0) {
    Promise.all(
      images.map(async (img) => {
        const buffer = await img.file.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = btoa(binary)
        return {
          type: "file" as const,
          mediaType: img.file.type,
          filename: img.file.name,
          url: `data:${img.file.type};base64,${base64}`,
        }
      })
    ).then((files) => {
      sendMessage({ text, files }, sendOptions)
    })
  } else {
    sendMessage({ text }, sendOptions)
  }
}}
```

转换流程：
1. `File.arrayBuffer()` → ArrayBuffer
2. 转 Uint8Array → 逐字节拼接二进制字符串
3. `btoa()` → base64 编码
4. 拼成 data URL: `data:${mediaType};base64,${base64}`
5. 构造 `{ type: "file", mediaType, filename, url }` part

### 3. 用户消息渲染 (components/chat-message.tsx)

```tsx
// components/chat-message.tsx (role === "user")
{message.parts
  .filter((part: any) => part.type === "file")
  .map((part: any, index: number) => {
    const filePart = part as {
      type: "file"
      url?: string
      mediaType?: string
      data?: unknown
    }
    const url =
      filePart.url ??
      (typeof filePart.data === "string" ? filePart.data : undefined)
    if (url && filePart.mediaType?.startsWith("image/")) {
      return (
        <img
          key={`file-${index}`}
          src={url}
          alt="uploaded"
          className="max-h-48 max-w-64 rounded-lg object-contain"
        />
      )
    }
    return null
  })}
```

- 过滤 `type === "file"` 的 parts
- 从 `url` 或 `data` 字段获取图片源
- 仅渲染 `mediaType` 以 `image/` 开头的文件
- 图片限制：`max-h-48 max-w-64`，圆角，`object-contain`

## 后端实现

### normalizeModelMessageContent 辅助函数

```ts
// app/api/chat/route.ts

function normalizeModelMessageContent<T extends Array<{ role: string; content: unknown }>>(
  messages: T
): T {
  return messages.map((msg) => {
    if ((msg.role === "user" || msg.role === "assistant") && Array.isArray(msg.content)) {
      const newContent = (msg.content as Array<Record<string, unknown>>).map((part) => {
        // 处理 file part: { type: "file", data: { type: "url", url: "data:..." } }
        if (part.type === "file" && typeof part.data === "object" && part.data !== null) {
          const data = part.data as { type: string; url?: unknown }
          if (data.type === "url") {
            const urlStr = String(data.url ?? "")
            const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(urlStr)
            if (match) {
              const [, rawMediaType, base64Flag, rawPayload] = match
              const mediaType = rawMediaType ? rawMediaType.split(";")[0] : undefined
              const payload = base64Flag
                ? rawPayload
                : btoa(unescape(encodeURIComponent(rawPayload)))
              return {
                ...part,
                mediaType: (part.mediaType as string) || mediaType,
                data: { type: "data" as const, data: payload },
              }
            }
          }
        }
        // 处理 image part: { type: "image", image: "data:..." }
        if (part.type === "image" && typeof part.image === "string" && part.image.startsWith("data:")) {
          const urlStr = part.image
          const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(urlStr)
          if (match) {
            const [, rawMediaType, base64Flag, rawPayload] = match
            const mediaType = rawMediaType ? rawMediaType.split(";")[0] : undefined
            const payload = base64Flag
              ? rawPayload
              : btoa(unescape(encodeURIComponent(rawPayload)))
            return {
              ...part,
              mediaType: (part.mediaType as string) || mediaType,
              image: { type: "data" as const, data: payload },
            }
          }
        }
        return part
      })
      return { ...msg, content: newContent }
    }
    return msg
  }) as T
}
```

**作用：** 将 data URL 格式的 file/image part 转换为 `{ type: "data", data: "<base64>" }` 格式，避免被错误包装为 `{ type: "url", url: "data:..." }`。

**正则表达式：** `/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/`
- 捕获组 1: mediaType（如 `image/png`）
- 捕获组 2: base64 标志（`;base64`）
- 捕获组 3: payload 数据

**处理范围：**
- file part 中 `part.data.type === "url"` 且 url 以 `data:` 开头
- image part 中 `part.image` 是字符串且以 `data:` 开头

**目的：** 防止 Anthropic 通过 Gateway 发送时触发 `anthropic-beta` header 冲突导致 HTTP 500。

### 视觉模型回退

```ts
// app/api/chat/route.ts

// 检测消息中是否包含视觉内容
const hasVisualParts = modelMessages.some(
  (m) =>
    Array.isArray((m as { content?: unknown }).content) &&
    ((m as { content: Array<{ type: string; mediaType?: string }> }).content.some(
      (p) =>
        p.type === "image" ||
        (p.type === "file" && p.mediaType?.startsWith("image/"))
    ) ||
    // 检查 data URL 格式的 file part
    (m as { content: Array<{ type: string; data?: { type?: string; url?: unknown } }> }).content.some(
      (p) =>
        p.type === "file" &&
        p.data?.type === "url" &&
        typeof p.data.url === "string" &&
        p.data.url.startsWith("data:image/")
    ) ||
    // 检查已规范化的 data 格式 file part
    (m as { content: Array<{ type: string; data?: { type?: string; data?: unknown } }> }).content.some(
      (p) => p.type === "file" && p.data?.type === "data"
    ))
)

let visualFallbackNote: string | undefined
if (modelId.startsWith("anthropic/") && hasVisualParts) {
  const fallback = "openai/gpt-5.6-terra"
  if (isModelAllowed(fallback)) {
    visualFallbackNote = `（系统提示：由于当前选择的 ${modelId} 模型暂不支持图片消息格式，已自动切换到 ${fallback} 处理本次请求。）`
    ;(modelId as string) = fallback
  }
}
```

**回退条件：**
1. 当前模型以 `anthropic/` 开头
2. 消息中包含视觉内容（image part、image file part、或 data URL 格式的图片）
3. 回退目标模型 `openai/gpt-5.6-terra` 在允许列表中

**回退处理：**
- 自动切换 `modelId` 为 `openai/gpt-5.6-terra`
- 生成 `visualFallbackNote` 提示文本

**系统提示注入：**

```ts
if (visualFallbackNote) {
  systemParts.push(
    `【重要】请在回复的开头（第一行）单独用一行小字或括号告知用户：${visualFallbackNote}，然后再正常回答问题。`
  )
}
```

模型被要求在回复开头告知用户模型已切换，然后再正常回答问题。

### 调用流程

```ts
// app/api/chat/route.ts
let modelMessages = await convertToModelMessages(messages)
modelMessages = normalizeModelMessageContent(modelMessages)  // 规范化 data URL

// 检测视觉内容 → Anthropic 回退
const hasVisualParts = modelMessages.some(...)
if (modelId.startsWith("anthropic/") && hasVisualParts) {
  modelId = "openai/gpt-5.6-terra"  // 自动切换
}
```

## 限制

| 项 | 值 | 说明 |
|----|----|------|
| 单图大小 | ≤ 5 MB | `MAX_IMAGE_BYTES = 5 * 1024 * 1024`，超过会 toast 提示，不加入待发送队列 |
| 格式 | JPEG / PNG / GIF / WebP | 由 `file.type.startsWith("image/")` 过滤 |
| 一次最多 | 9 张 | `MAX_IMAGES = 9`，前端限制数组长度，超出的截断 |
| 数据编码 | base64 data URL | 浏览器端编码，不上传到后端再转发 |
| base64 膨胀 | ~33% | 5 MB 的 PNG 实际 ~7 MB 文本；token 成本高 |

## 完整数据流

```
用户选择 / 拖拽 / 粘贴图片
    │
    ▼ components/prompt-form.tsx
    │  校验：类型 image/*、大小 ≤ 5MB、数量 ≤ 9
    │  → 预览缩略图 (URL.createObjectURL)
    │
    ▼ 用户点击发送
    │
    ▼ components/chat.tsx — filesToParts()
    │  File → arrayBuffer → Uint8Array → btoa → base64 data URL
    │  → { type: "file", mediaType, filename, url: "data:..." }
    │
    ▼ sendMessage({ text, files }, sendOptions)
    │
    ▼ POST /api/chat { messages, id, model }
    │
    ▼ app/api/chat/route.ts
    │  1. convertToModelMessages(messages)
    │  2. normalizeModelMessageContent() → 规范化 data URL 为 { type: "data", data }
    │  3. hasVisualParts 检测
    │  4. 若 anthropic/ + hasVisualParts → 回退到 openai/gpt-5.6-terra
    │  5. 注入 visualFallbackNote 到 system prompt
    │  6. streamText({ model: modelId, ... })
    │
    ▼ 模型识别图片内容 → 生成回复
    │
    ▼ SSE 流返回前端
    │
    ▼ components/chat-message.tsx
    │  用户消息：渲染图片气泡 (max-h-48 max-w-64)
    │  助手消息：文本回复 + 工具结果
```

## 注意事项

- base64 膨胀约 33%，5 MB 的 PNG 实际 ~7 MB 文本；token 成本高，建议发缩略图/压缩后图
- 纯文本模型调图片会报错 `image_content`，前端白名单模式尽量避免用户踩坑
- Anthropic 模型通过 Gateway 发送图片时会触发 `code-execution-web-tools-2026-02-09` beta header 冲突导致 HTTP 500，已通过自动回退到 GPT 解决
- `normalizeModelMessageContent` 在 `convertToModelMessages` 之后执行，确保 data URL 被正确转换为 `{ type: "data", data }` 格式
- 视觉回退提示由模型在回复开头告知用户，保证用户无感知地获得正常响应
- 匿名模式完全能发图片（`/api/chat` 允许匿名），落盘时 data URL 会占用磁盘空间
