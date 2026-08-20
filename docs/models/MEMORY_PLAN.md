# Context Manager & Memory 规划

## 现状分析

### 当前项目的记忆状况

```
用户打开浏览器 → 开始聊天 → 刷新页面 → 对话全部丢失
```

| 能力 | 当前状态 |
|------|----------|
| 单次对话内上下文 | 有（前端 messages 数组在内存中保持） |
| 刷新页面恢复对话 | 无 |
| 多会话管理 | 无 |
| 跨会话长期记忆 | 无 |
| 上下文窗口控制 | 无（全部消息发给模型，可能超 token 上限） |
| 用户偏好记忆 | 无 |

### AI SDK 7 提供的基础设施

AI SDK 7 本身**不内置 memory 模块**，但提供了以下回调和管理机制：

| API | 用途 |
|-----|------|
| `useChat({ id })` | 聊天会话唯一标识 |
| `useChat({ messages })` | 传入初始消息（从存储加载） |
| `useChat({ onFinish })` | 客户端响应完成回调 |
| `toUIMessageStream({ onEnd })` | 服务端流结束回调（持久化时机） |
| `toUIMessageStream({ originalMessages })` | 启用持久化模式 |
| `prepareSendMessagesRequest` | 自定义请求体（只发最后一条消息） |
| `pruneMessages` | 消息裁剪（控制上下文窗口大小） |
| `runtimeContext` | 运行时共享上下文 |
| `prepareStep` | 每步准备时覆盖 messages |

## 规划目标

```
┌──────────────────────────────────────────────────────────┐
│                     目标架构                              │
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
│              │  (SQLite/Vercel)│                          │
│              └────────────────┘                          │
└──────────────────────────────────────────────────────────┘
```

### 分阶段实施

| 阶段 | 目标 | 复杂度 |
|------|------|--------|
| Phase 1 | 会话持久化 — 刷新页面不丢对话 | 低 |
| Phase 2 | 上下文窗口管理 — 控制发送给模型的消息量 | 中 |
| Phase 3 | 多会话管理 — 侧边栏切换不同对话 | 中 |
| Phase 4 | 长期记忆 — 跨会话记住用户偏好 | 高 |

---

## Phase 1：会话持久化

**目标：** 刷新页面后对话不丢失，能恢复完整历史。

### 架构设计

```
浏览器                          Next.js 后端                    存储
┌───────────────┐              ┌────────────────────┐        ┌────────┐
│  useChat      │              │  /api/chat         │        │ SQLite │
│  id=chat-xxx  │──POST──────→│  onEnd 回调        │──写入──│        │
│  messages     │              │  → saveMessages()  │        │ chats  │
│  ↑ 从存储加载 │←─GET─────────│  /api/chats/:id    │──读取──│        │
└───────────────┘              └────────────────────┘        └────────┘
```

### 新增文件

```
lib/
  storage.ts          # 存储抽象层（SQLite / Vercel KV / 文件）
  chat-store.ts       # 聊天 CRUD（saveChat, loadChat, listChats）
app/api/
  chat/route.ts       # 修改：添加 onEnd 回调持久化
  chats/
    [id]/route.ts     # 新增：GET 加载历史, DELETE 删除会话
    route.ts          # 新增：GET 会话列表, POST 新建会话
components/
  chat.tsx            # 修改：传入 id + initialMessages
```

### 实现要点

#### 1. 存储层 `lib/storage.ts`

```ts
// 抽象接口，可切换实现
export interface ChatStorage {
  saveChat(chatId: string, messages: UIMessage[]): Promise<void>
  loadChat(chatId: string): Promise<UIMessage[]>
  listChats(): Promise<ChatMeta[]>
  deleteChat(chatId: string): Promise<void>
}
```

推荐方案（按部署环境选择）：

| 环境 | 方案 | 依赖 |
|------|------|------|
| 本地开发 | SQLite (better-sqlite3) | `better-sqlite3` |
| Vercel 部署 | Vercel KV (Redis) | `@vercel/kv` |
| 自托管 | PostgreSQL | `pg` + 数据库 |

#### 2. 后端 API 修改 `app/api/chat/route.ts`

```ts
// 在 toUIMessageStream 中添加 onEnd 回调
return createUIMessageStreamResponse({
  stream: toUIMessageStream({
    stream: result.stream,
    sendSources: true,
    originalMessages: messages,  // 启用持久化模式
    onEnd: async ({ messages: allMessages, responseMessage }) => {
      // 流结束时持久化全部消息
      const chatId = (body as { id?: string })?.id
      if (chatId) {
        await saveChat(chatId, allMessages)
      }
    },
    onError: () => "Something went wrong.",
  }),
})
```

#### 3. 前端修改 `components/chat.tsx`

```ts
const { messages, sendMessage, ... } = useChat<ChatUIMessage>({
  id: chatId,                    // 会话 ID（从 URL 参数获取）
  messages: initialMessages,     // 从服务端加载的历史消息
  onFinish: (event) => {
    // 客户端也可触发持久化（作为兜底）
  },
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
})
```

#### 4. 会话 ID 路由

```
/                    → 新对话（无 id）
/c/[chatId]          → 已有会话（加载历史）
```

---

## Phase 2：上下文窗口管理

**目标：** 对话变长后，只发送最近 N 条消息给模型，避免超出 token 限制。

### 架构设计

```
全部历史消息（存储中）           发送给模型的消息
┌──────────────────┐           ┌──────────────────┐
│ msg 1 (旧)       │           │                  │
│ msg 2            │    裁剪    │ msg 8 (最近)     │
│ msg 3            │ ────────→ │ msg 9            │
│ ...              │  保留最近N │ msg 10           │
│ msg 8            │           │ msg 11 (最新)    │
│ msg 9            │           └──────────────────┘
│ msg 10           │
│ msg 11 (最新)    │
└──────────────────┘
```

### 实现方案

使用 AI SDK 内置的 `pruneMessages` 函数：

```ts
// app/api/chat/route.ts
import { pruneMessages } from "ai"

const MAX_CONTEXT_MESSAGES = 20  // 保留最近 20 条

const result = streamText({
  model: modelId,
  messages: pruneMessages({
    messages: await convertToModelMessages(messages),
    reasoning: "none",          // 移除推理过程
    toolCalls: "before-last-5-messages",  // 只保留最近 5 条的工具调用
    emptyMessages: "remove",
  }),
  tools,
  // ...
})
```

### 滑动窗口策略

```
对话轮数      发送策略
1-20 条      全部发送
21-40 条     只发最近 20 条 + 系统摘要
40+ 条       摘要 + 最近 10 条
```

### 摘要生成（可选增强）

当对话超过阈值时，用模型生成前半段对话的摘要：

```ts
// 当 messages.length > 20 时
const oldMessages = messages.slice(0, -10)
const recentMessages = messages.slice(-10)

// 用模型摘要旧消息
const { text: summary } = await generateText({
  model: modelId,
  prompt: `总结以下对话的关键信息：\n${formatMessages(oldMessages)}`,
})

// 发送：摘要 + 最近消息
const contextMessages = [
  { role: "system", content: `之前对话摘要：${summary}` },
  ...recentMessages,
]
```

---

## Phase 3：多会话管理

**目标：** 侧边栏展示多个对话，可切换。

### 架构设计

```
┌──────────────────────────────────────────────────┐
│  ┌──────────┐  ┌────────────────────────────┐   │
│  │ 侧边栏    │  │       聊天区域              │   │
│  │          │  │                            │   │
│  │ + 新对话  │  │  消息列表...               │   │
│  │          │  │                            │   │
│  │ 会话1 ●  │  │                            │   │
│  │ 会话2   │  │  ┌──────────────────────┐  │   │
│  │ 会话3   │  │  │  输入框 + 模型选择    │  │   │
│  │          │  │  └──────────────────────┘  │   │
│  └──────────┘  └────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### 新增文件

```
components/
  chat-sidebar.tsx       # 侧边栏组件
  chat-sidebar-item.tsx # 单个会话项
app/api/chats/
  route.ts              # GET 列表, POST 新建
  [id]/route.ts         # GET 加载, DELETE 删除
app/c/[chatId]/
  page.tsx              # 动态路由页面
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

### 自动标题生成

```ts
// 首次对话后自动生成标题
async function generateChatTitle(firstMessage: string, modelId: string) {
  const { text } = await generateText({
    model: modelId,
    prompt: `用 10 字以内中文概括这个对话主题：${firstMessage}`,
  })
  return text
}
```

---

## Phase 4：长期记忆

**目标：** 跨会话记住用户偏好、重要事实。

### 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                        Memory 系统                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ 用户画像      │  │ 事实记忆      │  │ 偏好记忆         │   │
│  │ (who)        │  │ (what)       │  │ (how)           │   │
│  │              │  │              │  │                  │   │
│  │ 姓名/职业    │  │ "用户有猫"   │  │ "喜欢简洁回答"  │   │
│  │ 城市/时区    │  │ "在做Next项目"│  │ "用中文回复"    │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
│         └─────────────────┴───────────────────┘             │
│                           │                                  │
│                   ┌───────┴───────┐                          │
│                   │ Memory Store  │                          │
│                   │ (KV/向量库)   │                          │
│                   └───────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### 记忆类型

| 类型 | 存储方式 | 写入时机 | 读取时机 |
|------|----------|----------|----------|
| 用户画像 | KV (键值对) | 首次对话/用户主动告知 | 每次对话开始 |
| 事实记忆 | 向量库 (语义检索) | 对话中发现关键事实 | 与当前话题相关时 |
| 偏好记忆 | KV (键值对) | 用户明确表达偏好 | 每次对话开始 |

### 实现方案

#### 方案 A：自定义记忆工具（推荐，最灵活）

```ts
// tools/memory.ts — 定义记忆工具
export const saveMemory = tool({
  description: "Save important facts or user preferences for future conversations. Call this when the user shares personal info, preferences, or important context.",
  inputSchema: z.object({
    type: z.enum(["profile", "fact", "preference"]),
    content: z.string(),
    key: z.string().optional(),
  }),
  execute: async ({ type, content, key }) => {
    await memoryStore.save({ type, content, key: key ?? crypto.randomUUID() })
    return { saved: true }
  },
})

export const recallMemory = tool({
  description: "Recall relevant memories when the conversation touches on past topics. Search by keyword or semantic similarity.",
  inputSchema: z.object({
    query: z.string().describe("What to remember"),
  }),
  execute: async ({ query }) => {
    const memories = await memoryStore.search(query)
    return { memories }
  },
})
```

模型会自主决定何时保存和回忆记忆。

#### 方案 B：系统提示注入（简单方案）

```ts
// 每次对话开始时，从存储加载用户画像，注入到系统提示
const userProfile = await loadUserProfile(userId)

const result = streamText({
  system: `你是一个聊天助手。以下是用户信息：
${userProfile.name ? `- 姓名：${userProfile.name}` : ""}
${userProfile.location ? `- 位置：${userProfile.location}` : ""}
${userProfile.preferences?.join("\n") ?? ""}`,
  model: modelId,
  messages: await convertToModelMessages(messages),
  tools,
  // ...
})
```

#### 方案 C：第三方记忆服务

集成社区记忆包：

| 服务 | npm 包 | 特点 |
|------|--------|------|
| Letta | `@letta-ai/vercel-ai-sdk-provider` | 持久长期记忆，Agent 级别 |
| Mem0 | `@mem0/vercel-ai-provider` | 记忆层，自动提取和检索 |
| Supermemory | `@supermemory/tools` | 长期记忆工具 |

### 记忆存储结构

```ts
// KV 存储（简单键值对，适合用户画像和偏好）
interface MemoryEntry {
  id: string
  type: "profile" | "fact" | "preference"
  key: string          // 如 "name", "location", "language"
  value: string
  createdAt: number
  updatedAt: number
}

// 向量存储（语义检索，适合事实记忆）
interface VectorMemoryEntry {
  id: string
  content: string       // 记忆内容
  embedding: number[]   // 向量
  metadata: {
    chatId: string      // 来源会话
    timestamp: number
  }
}
```

---

## 完整数据流（四阶段全部实现后）

```
用户打开浏览器
    │
    ▼
路由 /c/[chatId] → 服务端加载历史消息 + 用户画像
    │
    ▼
useChat({ id: chatId, messages: initialMessages })
    │
    ▼ 用户输入 "北京明天天气怎么样？对了，我之前说过我用中文"
    │
    ▼ prepareSendMessagesRequest → 只发最后一条 + chatId
    │
    ▼ POST /api/chat { id, model, messages: [最后一条] }
    │
    ▼ 后端：
    │   1. loadChat(id) → 加载完整历史
    │   2. loadUserProfile() → 用户画像注入 system prompt
    │   3. pruneMessages() → 裁剪到最近 20 条
    │   4. streamText({ system: "用户偏好：中文回复...", messages, tools })
    │   5. 模型调用 weather 工具 → 获取天气
    │   6. 模型调用 saveMemory 工具 → 保存"用户用中文"偏好
    │   7. 模型生成回复（中文）
    │   8. onEnd 回调 → saveChat(id, allMessages)
    │
    ▼ SSE 流返回前端
    │
    ▼ 用户看到：天气卡片 + 中文出行建议
    │
    ▼ 刷新页面 → 历史消息恢复 → 用户画像保留 → 对话无缝继续
```

## 技术选型建议

| 组件 | 推荐方案 | 备选 |
|------|----------|------|
| 会话存储 | Vercel KV (Redis) | SQLite / PostgreSQL |
| 消息裁剪 | `pruneMessages()` (AI SDK 内置) | 自定义滑动窗口 |
| 标题生成 | `generateText()` 调用模型 | 截取首条消息 |
| 长期记忆 | 自定义工具 + KV 存储 | Letta / Mem0 |
| 向量检索 | Vercel PG + pgvector | Pinecone / Weaviate |
| 上下文注入 | `system` 参数 | `runtimeContext` |

## 依赖变更

```json
{
  "dependencies": {
    "@vercel/kv": "^3.0.0",           // Phase 1: 会话持久化
    "better-sqlite3": "^11.0.0"       // Phase 1: 本地开发备选
  }
}
```

Phase 4 如需向量检索，额外添加：

```json
{
  "dependencies": {
    "ai": "^7.0.58",                  // 已有，内置 embed 函数
    "@vercel/postgres": "^2.0.0"      // Phase 4: 向量存储
  }
}
```

## 实施优先级建议

1. **Phase 1（会话持久化）** — 基础能力，刷新不丢对话，用户感知最强
2. **Phase 2（上下文管理）** — 实用性高，防止长对话报错
3. **Phase 3（多会话）** — 体验提升，但依赖 Phase 1 完成
4. **Phase 4（长期记忆）** — 高级功能，可在 Phase 1-3 稳定后实施
