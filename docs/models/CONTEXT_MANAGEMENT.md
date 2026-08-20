# 上下文窗口管理 (Context Management)

本文档描述聊天 API 中的上下文窗口管理机制，包括消息裁剪（pruning）和对话摘要（summarization）。

---

## 一、位置

核心逻辑位于 `app/api/chat/route.ts` 的 `POST` 函数中。

---

## 二、常量

```ts
const MAX_CONTEXT_MESSAGES = 20    // 最大上下文消息数（超过则裁剪）
const SUMMARY_THRESHOLD = 30      // 摘要触发阈值（超过则摘要）
const RECENT_KEEP_COUNT = 10       // 摘要后保留的最近消息数
const SUMMARY_MAX_TOKENS = 500     // 摘要生成最大 token 数
```

---

## 三、处理流程

```
1. convertToModelMessages(messages) → normalizeModelMessageContent()（修复 data URL）
2. 视觉降级检查（Anthropic + 图片 → GPT 5.6 Terra）
3. 上下文管理：
   ├─ 消息数 > 30（SUMMARY_THRESHOLD）→ 摘要 + 保留最近 10 条
   ├─ 消息数 > 20（MAX_CONTEXT_MESSAGES）→ pruneMessages 裁剪
   └─ 消息数 ≤ 20 → 原样发送
```

### 步骤 1：消息标准化

```ts
let modelMessages = await convertToModelMessages(messages)
modelMessages = normalizeModelMessageContent(modelMessages)
```

`normalizeModelMessageContent` 修复 content 中的 file/image data URL：
- 将 `{ type: "url", url: "data:..." }` 转为 `{ type: "data", data: "<base64>" }`
- 避免部分 provider/gateway 解析错误（如 Anthropic `anthropic-beta` 冲突）

### 步骤 2：视觉降级检查

```ts
const hasVisualParts = modelMessages.some(/* 检测 image/file 部分 */)
if (modelId.startsWith("anthropic/") && hasVisualParts) {
  const fallback = "openai/gpt-5.6-terra"
  if (isModelAllowed(fallback)) {
    visualFallbackNote = `（系统提示：已自动切换到 ${fallback}）`
    modelId = fallback
  }
}
```

- Anthropic 模型通过 Gateway 发送含图片消息时触发 `code-execution-web-tools-2026-02-09` beta header 冲突导致 500
- 自动切换到 `openai/gpt-5.6-terra`，用户无感知
- `visualFallbackNote` 会在 system prompt 中提示模型告知用户切换

### 步骤 3a：摘要（消息数 > 30）

```ts
if (modelMessages.length > SUMMARY_THRESHOLD && chatIdStr) {
  const toSummarizeCount = modelMessages.length - RECENT_KEEP_COUNT
  const recentMessages = modelMessages.slice(-RECENT_KEEP_COUNT)
  const cachedSummary = await loadSummary(chatIdStr, userId)

  // 检查缓存
  if (cachedSummary && cachedSummary.summarizedCount >= toSummarizeCount) {
    summary = cachedSummary.summary  // 使用缓存
  } else {
    // 生成新摘要
    const oldMessages = modelMessages.slice(0, toSummarizeCount)
    const { text: generatedSummary } = await generateText({
      model: modelId,
      maxOutputTokens: SUMMARY_MAX_TOKENS,
      messages: [{
        role: "user",
        content: `请用中文简洁地总结以下对话的关键信息，200字以内：\n\n${formatMessagesForSummary(oldMessages)}`,
      }],
    })
    if (generatedSummary) {
      summary = generatedSummary
      await saveSummary(chatIdStr, summary, toSummarizeCount, userId)
    }
  }

  if (summary) {
    summarySystemPrompt = `以下是之前对话的摘要：\n\n${summary}`
    modelMessages = recentMessages  // 仅发送最近 10 条
  } else {
    // 摘要失败 → 降级为裁剪
    modelMessages = pruneMessages({ messages: modelMessages, ... })
  }
}
```

**摘要缓存校验逻辑**：
- `cachedSummary.summarizedCount >= toSummarizeCount` → 缓存有效
- 否则重新生成摘要

**摘要生成**：
- 使用当前 `modelId` 调用 `generateText`
- `maxOutputTokens: 500`
- 提示词：`"请用中文简洁地总结以下对话的关键信息，200字以内：\n\n{old messages}"`
- 成功后 `saveSummary` 保存到 `chats` 表
- 失败（catch）→ 降级为 `pruneMessages`

### 步骤 3b：裁剪（消息数 > 20 且 ≤ 30）

```ts
else if (modelMessages.length > MAX_CONTEXT_MESSAGES) {
  modelMessages = pruneMessages({
    messages: modelMessages,
    reasoning: "none",                          // 移除推理过程
    toolCalls: "before-last-5-messages",         // 保留最近 5 条消息的工具调用
    emptyMessages: "remove",                     // 移除空消息
  })
}
```

### 步骤 3c：原样发送（消息数 ≤ 20）

无需处理，全部消息发送给模型。

---

## 四、摘要缓存（lib/storage.ts）

### SummaryCache 接口

```ts
export interface SummaryCache {
  chatId: string
  summary: string
  summarizedCount: number
  createdAt: number
  updatedAt: number
}
```

存储在 Supabase `chats` 表的以下列：
- `summary` — 摘要文本
- `summarized_count` — 已摘要的消息数
- `summary_created_at` — 首次摘要时间
- `summary_updated_at` — 最后更新时间

### loadSummary(chatId, userId)

从 `chats` 表读取 `summary, summarized_count, summary_created_at, summary_updated_at` 列。无摘要时返回 `null`。

### saveSummary(chatId, summary, summarizedCount, userId)

更新 `chats` 表的摘要列：
- **保留 `summary_created_at`**：先查询现有值，若不存在则用当前时间。
- 更新 `summary, summarized_count, summary_created_at, summary_updated_at, updated_at`。

### deleteSummary(chatId, userId)

将摘要列全部置为 `null`：
```ts
await supabase.from("chats").update({
  summary: null,
  summarized_count: 0,
  summary_created_at: null,
  summary_updated_at: null,
}).eq("id", chatId).eq("user_id", userId ?? null)
```

---

## 五、formatMessagesForSummary 辅助函数

将消息格式化为 `[role] text` 行，供摘要提示词使用：

```ts
function formatMessagesForSummary(messages: Array<{ role: string; content: unknown }>): string {
  return messages
    .map((msg) => {
      const role =
        msg.role === "user" ? "用户"
        : msg.role === "assistant" ? "助手"
        : "系统"
      let text = ""
      if (typeof msg.content === "string") {
        text = msg.content
      } else if (Array.isArray(msg.content)) {
        text = (msg.content as Array<{ type: string; text?: string }>)
          .filter((part) => part.type === "text" && part.text)
          .map((part) => part.text!)
          .join(" ")
      }
      return `[${role}] ${text}`
    })
    .join("\n")
}
```

- `user` → `用户`
- `assistant` → `助手`
- 其他 → `系统`
- 从 content 数组中提取 `type: "text"` 部分的文本

---

## 六、System Prompt 注入

摘要作为 system prompt 的一部分注入：

```ts
if (summary) {
  summarySystemPrompt = `以下是之前对话的摘要：\n\n${summary}`
  modelMessages = recentMessages  // 仅使用最近 10 条消息
}
```

`summarySystemPrompt` 会被加入 `systemParts` 数组，与其他 system 部分用 `"\n\n---\n\n"` 连接。

---

## 七、流程图

```
完整消息历史 (>30 条)
├── 旧消息 (前 N-10 条) → generateText → summary → system prompt
└── 最近消息 (后 10 条) → 原样发送给模型

完整消息历史 (21-30 条)
└── pruneMessages: reasoning=none, toolCalls=before-last-5, emptyMessages=remove

完整消息历史 (≤20 条)
└── 全部原样发送给模型
```

### 摘要缓存判断

```
消息数 > 30
├── 缓存存在且 summarizedCount >= toSummarizeCount?
│   ├── 是 → 使用缓存摘要，仅发送最近 10 条
│   └── 否 → 生成新摘要
│       ├── 成功 → 保存摘要，注入 system prompt，仅发送最近 10 条
│       └── 失败 → 降级为 pruneMessages 裁剪
```
