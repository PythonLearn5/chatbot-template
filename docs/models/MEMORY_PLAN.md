# Context Manager & Memory 实现文档

## 概述

全部 4 个阶段均已实现。本系统基于 Supabase PostgreSQL，提供：

- **Phase 1 — 会话持久化**：刷新页面不丢对话
- **Phase 2 — 上下文窗口管理**：消息裁剪 + 摘要缓存
- **Phase 3 — 多会话管理**：侧边栏切换不同对话
- **Phase 4 — 长期记忆**：跨会话记住用户画像/偏好/事实

## 涉及文件

```
lib/
  storage.ts                    # 存储抽象层（Supabase PostgreSQL）
  db.ts                         # Supabase 客户端
app/api/
  chat/route.ts                 # Phase 2 摘要 + Phase 4 记忆注入
  chats/route.ts                # Phase 1+3: GET 列表, POST 新建
  chats/[id]/route.ts           # Phase 1: GET 加载, DELETE, PATCH 更新
app/c/[chatId]/page.tsx         # Phase 1: 动态路由页面
components/
  chat.tsx                      # useChat({ id, messages })
  chat-sidebar.tsx             # Phase 3: 侧边栏
tools/
  memory.ts                     # Phase 4: save_memory / recall_memory 工具定义
  index.ts                      # Phase 4: scopedMemoryTools 工厂
supabase/migrations/
  001_init_schema.sql           # chats / memories 表定义
```

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                     目标架构（已实现）                     │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │ Session  │  │ Context   │  │ Long-term Memory     │  │
│  │ Manager  │  │ Manager   │  │ (用户画像/偏好/事实)  │  │
│  │ (会话管理)│  │ (上下文管理)│  │                      │  │
│  └────┬─────┘  └─────┬─────┘  └──────────┬───────────┘  │
│       │              │                    │              │
│       └──────────────┴────────────────────┘              │
│                      │                                   │
│              ┌───────┴────────┐                          │
│              │  Storage Layer │                          │
│              │  (Supabase PG) │                          │
│              └────────────────┘                          │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 1：会话持久化（已实现）

**目标：** 刷新页面后对话不丢失，能恢复完整历史。

### 数据表结构

```sql
-- supabase/migrations/001_init_schema.sql
CREATE TABLE chats (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT,
  title               TEXT DEFAULT '新对话',
  messages            JSONB DEFAULT '[]',
  message_count       INT DEFAULT 0,
  system_prompt       TEXT,
  prompt_template_id  TEXT,
  summary             TEXT,
  summarized_count    INT DEFAULT 0,
  summary_created_at  TIMESTAMPTZ,
  summary_updated_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_chats_user_id     ON chats(user_id);
CREATE INDEX idx_chats_updated_at  ON chats(updated_at DESC);
```

### ChatMeta 接口

```ts
// lib/storage.ts
export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  systemPrompt?: string
  promptTemplateId?: string
}
```

### 存储函数

```ts
// lib/storage.ts

// 保存（存在则更新，不存在则插入）
export async function saveChat(
  chatId: string,
  messages: UIMessage[],
  title?: string,
  systemPrompt?: string,
  promptTemplateId?: string,
  userId?: string
): Promise<ChatMeta>

// 加载消息历史
export async function loadChat(chatId: string, userId?: string): Promise<UIMessage[]>

// 列出用户所有会话（按 updated_at 降序）
export async function listChats(userId?: string): Promise<ChatMeta[]>

// 删除会话
export async function deleteChat(chatId: string, userId?: string): Promise<void>

// 获取元数据
export async function getChatMeta(chatId: string, userId?: string): Promise<ChatMeta | null>
```

- 所有函数按 `userId` 隔离，匿名用户 `user_id` 为 `null`
- `saveChat` 先查询是否已存在，存在则 `UPDATE`，不存在则 `INSERT`
- `listChats` 按 `updated_at` 降序排列

### API 路由

#### `app/api/chats/route.ts`

```ts
// GET → 获取会话列表（按用户隔离）
export async function GET(req: Request) {
  const user = await authenticateUser(req)
  const chats = await listChats(user?.id)
  return NextResponse.json({ chats })
}

// POST → 新建会话（带速率限制）
export async function POST(req: Request) {
  const user = await authenticateUser(req)
  const rl = rateLimit(identifier, RATE_LIMITS.createChat.limit, RATE_LIMITS.createChat.windowMs)
  if (!rl.success) return Response.json({ error: "新建会话过于频繁，请稍后再试。" }, { status: 429 })
  const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await saveChat(chatId, [], "新对话", undefined, undefined, user?.id)
  return NextResponse.json({ id: chatId })
}
```

#### `app/api/chats/[id]/route.ts`

```ts
// GET → 加载消息历史 + 元数据
export async function GET(req, { params }) {
  const { id } = await params
  const user = await authenticateUser(req)
  const [messages, meta] = await Promise.all([loadChat(id, user?.id), getChatMeta(id, user?.id)])
  if (!meta && messages.length === 0) return NextResponse.json({ error: "Chat not found." }, { status: 404 })
  return NextResponse.json({ id, messages, meta })
}

// DELETE → 删除会话
export async function DELETE(req, { params }) {
  await deleteChat(id, user?.id)
}

// PATCH → 更新 systemPrompt 等设置
export async function PATCH(req, { params }) {
  const { systemPrompt, promptTemplateId } = body
  await saveChat(id, messages, meta?.title, systemPrompt, promptTemplateId, user?.id)
}
```

### 前端集成

```ts
// components/chat.tsx
const { messages, sendMessage, status, stop, error, addToolOutput } =
  useChat<ChatUIMessage>({
    id: chatId,                    // 会话 ID
    messages: initialMessages,     // 从服务端加载的历史消息
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })
```

### 动态路由页面

```ts
// app/c/[chatId]/page.tsx
export default async function ChatPage({ params }) {
  const { chatId } = await params
  const user = await authenticateUser(...)
  const messages = await loadChat(chatId, user?.id)
  if (messages.length === 0) notFound()
  return <Chat models={MODELS} chatId={chatId} initialMessages={messages} />
}
```

### 持久化时机（onEnd 回调）

```ts
// app/api/chat/route.ts
return createUIMessageStreamResponse({
  stream: toUIMessageStream({
    stream: result.stream,
    sendSources: true,
    originalMessages: messages,
    onEnd: async ({ messages: allMessages }) => {
      if (chatIdStr) {
        try {
          const firstUserMsg = allMessages.find((m) => m.role === "user")
          const title = firstUserMsg
            ? firstUserMsg.parts
                .filter((p) => p.type === "text")
                .map((p) => p.text)
                .join("")
                .slice(0, 30) || "新对话"
            : "新对话"
          await saveChat(chatIdStr, allMessages, title, undefined, undefined, userId)
        } catch { /* 忽略 */ }
      }
    },
  }),
})
```

**标题生成规则：** 首条用户消息文本截取前 30 字符；若无法提取则为 `"新对话"`。

---

## Phase 2：上下文窗口管理（已实现）

**目标：** 对话变长后，只发送最近 N 条消息给模型，避免超出 token 限制。

### 关键常量

```ts
// app/api/chat/route.ts
const MAX_CONTEXT_MESSAGES = 20
const SUMMARY_THRESHOLD = 30
const RECENT_KEEP_COUNT = 10
const SUMMARY_MAX_TOKENS = 500
```

| 常量 | 值 | 说明 |
|------|----|------|
| `MAX_CONTEXT_MESSAGES` | 20 | 超过此数量触发裁剪 |
| `SUMMARY_THRESHOLD` | 30 | 超过此数量触发摘要 |
| `RECENT_KEEP_COUNT` | 10 | 摘要时保留的最近消息数 |
| `SUMMARY_MAX_TOKENS` | 500 | 摘要生成最大 token |

### 双层策略

```
消息数量          策略
1-20             全部发送
21-30            pruneMessages 裁剪
  >30            摘要 + 保留最近 10 条
```

#### 摘要路径（> 30 条）

```ts
if (modelMessages.length > SUMMARY_THRESHOLD && chatIdStr) {
  const toSummarizeCount = modelMessages.length - RECENT_KEEP_COUNT
  const recentMessages = modelMessages.slice(-RECENT_KEEP_COUNT)
  const cachedSummary = await loadSummary(chatIdStr, userId)
  let summary: string | null = null

  // 优先使用缓存摘要（已摘要数量 >= 待摘要数量时）
  if (cachedSummary && cachedSummary.summarizedCount >= toSummarizeCount) {
    summary = cachedSummary.summary
  } else {
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
    modelMessages = recentMessages        // 只保留最近 10 条
  } else {
    modelMessages = pruneMessages({...})  // 降级为裁剪
  }
}
```

#### 裁剪路径（> 20 条）

```ts
else if (modelMessages.length > MAX_CONTEXT_MESSAGES) {
  modelMessages = pruneMessages({
    messages: modelMessages,
    reasoning: "none",                    // 移除推理过程
    toolCalls: "before-last-5-messages",   // 只保留最近 5 条的工具调用
    emptyMessages: "remove",              // 移除空消息
  })
}
```

### 摘要缓存

摘要存储在 `chats` 表的专用列中：

```sql
-- chats 表中的摘要相关列
summary             TEXT,          -- 摘要文本
summarized_count    INT DEFAULT 0, -- 已摘要的消息数量
summary_created_at  TIMESTAMPTZ,   -- 首次摘要时间
summary_updated_at  TIMESTAMPTZ    -- 最后更新摘要时间
```

```ts
// lib/storage.ts

export interface SummaryCache {
  chatId: string
  summary: string
  summarizedCount: number
  createdAt: number
  updatedAt: number
}

export async function loadSummary(chatId: string, userId?: string): Promise<SummaryCache | null>
export async function saveSummary(chatId: string, summary: string, summarizedCount: number, userId?: string): Promise<SummaryCache>
export async function deleteSummary(chatId: string, userId?: string): Promise<void>
```

- `saveSummary` 保留首次创建时间 `summary_created_at`，只更新 `summary_updated_at`
- 缓存命中条件：`cachedSummary.summarizedCount >= toSummarizeCount`

### formatMessagesForSummary 辅助函数

```ts
function formatMessagesForSummary(messages: Array<{ role: string; content: unknown }>): string {
  return messages.map((msg) => {
    const role = msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : "系统"
    // 提取文本内容
    return `[${role}] ${text}`
  }).join("\n")
}
```

---

## Phase 3：多会话管理（已实现）

**目标：** 侧边栏展示多个对话，可切换。

### 侧边栏组件

```ts
// components/chat-sidebar.tsx
export function ChatSidebar({
  chats: ChatMeta[],
  currentChatId?: string,
  onRefresh?: () => void,
})
```

功能：
- 顶部：新聊天按钮 + 导航菜单（知识库、MCP 服务器、用量统计、长期记忆、提示词模板）
- 中部：「最近」标题 + 刷新按钮
- 列表：每个会话显示标题（截断），点击跳转 `/c/${chat.id}`
- 删除：hover 显示 🗑 按钮，删除后若在当前会话则跳转 `/`
- 可折叠：`collapsed` 状态，折叠后只显示图标列

### 路由

```
/                    → 新对话（无 id）
/c/[chatId]          → 已有会话（加载历史）
```

### 会话列表数据结构

```ts
interface ChatMeta {
  id: string
  title: string          // 首条用户消息的前 30 字
  createdAt: number
  updatedAt: number
  messageCount: number
}
```

### API

```ts
// app/api/chats/route.ts
// GET  → listChats(userId) → 按 updated_at 降序
// POST → 创建新会话（带速率限制）
```

---

## Phase 4：长期记忆（已实现）

**目标：** 跨会话记住用户偏好、重要事实。

### 数据表结构

```sql
-- supabase/migrations/001_init_schema.sql
CREATE TABLE memories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  type       TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, type, key)
);
CREATE INDEX idx_memories_user_id ON memories(user_id);
```

- `UNIQUE(user_id, type, key)` 约束确保同一用户同一类型同一键的唯一性，用于 upsert
- 匿名用户 `user_id` 为 `null`

### 记忆类型

| 类型 | 字段值 | 用途 | 示例 |
|------|--------|------|------|
| 用户画像 | `profile` | 用户身份信息 | 姓名、职业、位置 |
| 事实记忆 | `fact` | 重要上下文 | "用户有猫"、"在做 Next 项目" |
| 偏好记忆 | `preference` | 回复方式偏好 | "喜欢简洁回答"、"用中文回复" |

### MemoryEntry 接口

```ts
// lib/storage.ts
export interface MemoryEntry {
  id: string
  type: "profile" | "fact" | "preference"
  key: string
  value: string
  createdAt: number
  updatedAt: number
}
```

### 存储函数

```ts
// lib/storage.ts

// upsert 写入（onConflict: "user_id,type,key"）
export async function saveMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">,
  userId?: string
): Promise<MemoryEntry>

// 加载用户所有记忆（按 created_at 降序）
export async function loadAllMemories(userId?: string): Promise<MemoryEntry[]>

// 子串搜索（非向量/语义检索）
export async function searchMemories(query: string, userId?: string): Promise<MemoryEntry[]>
```

**重要：** `searchMemories` 是简单的子串匹配，**不是向量/语义检索**。实现方式：
1. 调用 `loadAllMemories(userId)` 加载全部记忆
2. 对 `value`、`key`、`type` 三个字段做 `.toLowerCase().includes(query.toLowerCase())` 过滤

### saveMemory 实现

```ts
export async function saveMemory(entry, userId) {
  const id = `${entry.type}-${entry.key}-${Date.now()}`
  const { data, error } = await supabase
    .from("memories")
    .upsert(
      {
        id, user_id: userId ?? null,
        type: entry.type, key: entry.key, value: entry.value,
        created_at: now, updated_at: now,
      },
      { onConflict: "user_id,type,key" }
    )
    .select().single()
  return toMemoryEntry(data)
}
```

### 记忆工具

#### 工具定义 (tools/memory.ts)

```ts
// save_memory 工具
export const saveMemoryTool = tool({
  description: "Save important information about the user for future conversations...",
  inputSchema: z.object({
    type: z.enum(["profile", "fact", "preference"]),
    key: z.string(),
    value: z.string(),
  }),
  outputSchema: z.object({ saved: z.boolean(), message: z.string() }),
  execute: async ({ type, key, value }) => {
    await saveMemory({ type, key, value })
    return { saved: true, message: `已记住：${type}/${key} = ${value}` }
  },
})

// recall_memory 工具
export const recallMemoryTool = tool({
  description: "Recall memories from previous conversations...",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({
    memories: z.array(z.object({ type: z.string(), key: z.string(), value: z.string() })),
    count: z.number(),
  }),
  execute: async ({ query }) => {
    const results = await searchMemories(query)
    return { memories: results.map(...), count: results.length }
  },
})
```

#### 按用户隔离 (tools/index.ts)

```ts
// scoped 工具工厂：memory 工具按 userId 隔离
function scopedMemoryTools(userId?: string) {
  const save_memory = tool({
    description: saveMemoryTool.description,
    inputSchema: z.object({ type: z.enum(["profile", "fact", "preference"]), key: z.string(), value: z.string() }),
    outputSchema: z.object({ saved: z.boolean() }),
    execute: async ({ type, key, value }) => {
      await saveMemory({ type, key, value }, userId)  // 传入 userId
      return { saved: true }
    },
  })

  const recall_memory = tool({
    description: recallMemoryTool.description,
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await searchMemories(query, userId)  // 传入 userId
      return { memories: results.map(...), count: results.length }
    },
  })

  return { save_memory, recall_memory }
}

export function getTools(modelId: string, userId?: string): ToolSet {
  const { save_memory, recall_memory } = scopedMemoryTools(userId)
  // ... 其他工具
  return { github_repo, ask_user, weather, save_memory, recall_memory, knowledge, web_search, code_run }
}
```

### 系统提示注入

```ts
// app/api/chat/route.ts
if (userId) {
  try {
    const memories = await loadAllMemories(userId)
    if (memories.length > 0) {
      const profileEntries = memories.filter((m) => m.type === "profile")
      const preferenceEntries = memories.filter((m) => m.type === "preference")
      const lines: string[] = []
      if (profileEntries.length > 0) {
        lines.push("用户信息：")
        for (const e of profileEntries) lines.push(`- ${e.key}: ${e.value}`)
      }
      if (preferenceEntries.length > 0) {
        lines.push("用户偏好：")
        for (const e of preferenceEntries) lines.push(`- ${e.key}: ${e.value}`)
      }
      if (lines.length > 0) {
        systemParts.push(`请在回复时参考以下用户信息：\n${lines.join("\n")}`)
      }
    }
  } catch { /* 忽略 */ }
}
```

- 仅注入 `profile` 和 `preference` 类型记忆（`fact` 类型不注入系统提示）
- 格式化为 bullet list（`- key: value`）

### 记忆工具引导

系统提示中还包含记忆工具的使用引导：

```ts
systemParts.push([
  "你拥有以下记忆工具，请主动使用它们：",
  "- save_memory：当用户分享个人信息（姓名、职业、位置）、偏好（语言、回复风格）、或重要事实时，调用此工具保存。",
  "- recall_memory：当需要回顾之前记住的用户信息时调用。",
  "规则：用户说出个人偏好/信息时，先调用 save_memory 保存，再回复。不要在回复中提及「我已保存到记忆」等技术细节。",
].join("\n"))
```

---

## 完整数据流

```
用户打开浏览器
    │
    ▼
路由 /c/[chatId] → 服务端加载历史消息 + 用户画像
    │
    ▼
useChat({ id: chatId, messages: initialMessages })
    │
    ▼ 用户输入 "北京明天天气怎么样？对了，我用中文"
    │
    ▼ POST /api/chat { id, model, messages }
    │
    ▼ 后端：
    │   1. loadChat(id) → 加载完整历史（前端只发最新消息，后端从存储加载）
    │   2. Phase 2: 上下文管理
    │      ├─ 消息 > 30 → 摘要 + 保留最近 10 条
    │      └─ 消息 > 20 → pruneMessages 裁剪
    │   3. Phase 4: loadAllMemories(userId) → 注入 profile/preference 到 system prompt
    │   4. streamText({ system: "用户偏好：中文回复...", messages, tools })
    │   5. 模型调用 weather 工具 → 获取天气
    │   6. 模型调用 save_memory 工具 → 保存"用户用中文"偏好
    │   7. 模型生成回复（中文）
    │   8. onEnd 回调 → saveChat(id, allMessages, title)
    │
    ▼ SSE 流返回前端
    │
    ▼ 用户看到：天气卡片 + 中文出行建议
    │
    ▼ 刷新页面 → 历史消息恢复 → 用户画像保留 → 对话无缝继续
```

## 技术选型总结

| 组件 | 实际方案 | 说明 |
|------|----------|------|
| 会话存储 | Supabase PostgreSQL | `chats` 表，JSONB 存储 messages |
| 消息裁剪 | `pruneMessages()` (AI SDK 内置) | reasoning="none", toolCalls="before-last-5-messages" |
| 摘要缓存 | Supabase `chats` 表专用列 | summary, summarized_count, summary_created_at, summary_updated_at |
| 标题生成 | 截取首条消息前 30 字 | 无需模型调用，降级为 "新对话" |
| 长期记忆 | Supabase `memories` 表 | UNIQUE(user_id, type, key) upsert |
| 记忆检索 | 子串匹配 | `searchMemories` 加载全部后 `.includes()` 过滤 |
| 上下文注入 | `system` 参数 | profile + preference 格式化为 bullet list |
