# 项目架构文档

## 概述

一个**生产级** AI 聊天机器人模板，基于 Next.js 16 (App Router)、Vercel AI SDK 7、shadcn/ui 和 Vercel AI Gateway 构建。集成了 8 大核心模块：认证、速率限制、8 个内置工具 + 动态 MCP 工具、请求日志与用量统计、长期用户记忆、基于 pgvector 的 RAG 私有知识库、上下文窗口管理（摘要压缩）、以及动态工具过滤的 Agent 步骤工作流。所有持久化数据存储在 Supabase PostgreSQL 中，按用户隔离。支持 10 家厂商 17 个模型（含 5 个免费模型）。中文为主要语言。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | Next.js 16 (App Router) | React 19 服务端组件 + 客户端组件 |
| AI SDK | Vercel AI SDK 7 | `streamText` + `useChat`，`prepareStep` Agent 工作流 |
| UI 组件 | shadcn/ui + shadcn/react | 基于 Base UI 的组件系统 |
| 样式 | Tailwind CSS 4 | 工具类优先的 CSS 框架 |
| 模型网关 | Vercel AI Gateway | 一个 API Key 统一调用 10 家厂商 17 个模型 |
| 数据库 | Supabase (PostgreSQL) | pgvector 扩展用于 RAG 向量检索 |
| 类型校验 | Zod 4 | 工具输入/输出的运行时类型校验 |
| 语言 | TypeScript 5 | 全栈类型安全 |

## 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│                            浏览器                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
││                        Next.js 页面                          │  │
│  │  ┌──────────────┐  ┌────────────────────────────────────┐ │  │
│  │  │  SiteHeader   │  │            Chat 组件              │ │  │
│  │  │  (导航+主题    │  │  ┌──────────────────────────────┐ │ │  │
│  │  │   +AuthButton)│  │  │  ChatSidebar (会话列表)       │ │ │  │
│  │  └──────────────┘  │  └──────────────────────────────┘ │ │  │
│  │                     │  ┌──────────────────────────────┐ │ │  │
│  │                     │  │  MessageScroller              │ │ │  │
│  │                     │  │  ┌────────────────────────┐  │ │ │  │
│  │                     │  │  │  ChatMessage x N        │  │ │ │  │
│  │                     │  │  │  (part-based 渲染)       │  │ │ │  │
│  │                     │  │  │  ├─ TextPart             │  │ │ │  │
│  │                     │  │  │  ├─ GithubRepoPart       │  │ │ │  │
│  │                     │  │  │  ├─ AskUserPart          │  │ │ │  │
│  │                     │  │  │  ├─ WebSearchPart        │  │ │ │  │
│  │                     │  │  │  ├─ WeatherPart          │  │ │ │  │
│  │                     │  │  │  ├─ SaveMemoryPart       │  │ │ │  │
│  │                     │  │  │  ├─ RecallMemoryPart     │  │ │ │  │
│  │                     │  │  │  ├─ KnowledgePart       │  │ │ │  │
│  │                     │  │  │  ├─ CodeRunPart          │  │ │ │  │
│  │                     │  │  │  └─ SourcesPart          │  │ │ │  │
│  │                     │  │  └────────────────────────┘  │ │ │  │
│  │                     │  └──────────────────────────────┘ │ │  │
│  │                     │  ┌──────────────────────────────┐ │ │  │
│  │                     │  │  PromptForm                  │ │ │  │
│  │                     │  │  ├─ ModelSelect (17 模型)     │ │ │  │
│  │                     │  │  ├─ FileUpload (图片上传)     │ │ │  │
│  │                     │  │  ├─ Textarea (输入)           │ │ │  │
│  │                     │  │  └─ SendButton               │ │ │  │
│  │                     │  └──────────────────────────────┘ │ │  │
│  │                     │  ┌──────────────────────────────┐ │ │  │
│  │                     │  │  SystemPromptDialog          │ │ │  │
│  │                     │  │  (自定义角色模板编辑器)        │ │ │  │
│  │                     │  └──────────────────────────────┘ │ │  │
│  │                     │  ┌──────────────────────────────┐ │ │  │
│  │                     │  │  KnowledgeUpload (RAG 上传)  │ │ │  │
│  │                     │  │  McpPanel (MCP 服务器管理)     │ │ │  │
│  │                     │  │  StatsPanel (用量统计)        │ │ │  │
│  │                     │  └──────────────────────────────┘ │ │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP (SSE 流式)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│              Next.js API Route (/api/chat)                       │
│                                                                  │
│  1. 认证：authenticateUser(req) → userId (可选)                   │
│  2. 速率限制：RATE_LIMITS.chat (120次/小时)，超限返回 429          │
│  3. 解析 body：isModelAllowed() 校验模型 + chatId                 │
│  4. 工具集：getTools(modelId, userId) + MCP 动态工具              │
│  5. 校验消息：validateUIMessages()                                │
│  6. 上下文管理：规范化 → 视觉降级 → 裁剪/摘要                       │
│  7. 系统 Prompt 组装：降级提示 + 自定义 + 摘要 + 记忆 + 工具引导    │
│  8. streamText：prepareStep → decidePrepareStep                  │
│     └─ stopWhen: isStepCount(10)，maxOutputTokens: 8192          │
│  9. SSE 响应：toUIMessageStream + onEnd (saveChat) + onError      │
│ 10. 日志：onEnd 记录成功，onError 记录失败                         │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│               Vercel AI Gateway                                  │
│                                                                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────────┐  │
│  │ Anthropic │ │  OpenAI   │ │   xAI     │ │    Google       │  │
│  │ Claude    │ │   GPT     │ │   Grok    │ │    Gemini       │  │
│  └───────────┘ └───────────┘ └───────────┘ └─────────────────┘  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────────────┐  │
│  │ DeepSeek  │ │ Alibaba   │ │ Moonshot  │ │  NVIDIA         │  │
│  │           │ │  Qwen     │ │   Kimi    │ │  Nemotron       │  │
│  └───────────┘ └───────────┘ └───────────┘ └─────────────────┘  │
│  ┌───────────┐ ┌───────────┐                                   │
│  │ Poolside  │ │InclusionAI│                                   │
│  │  Laguna   │ │   Ling    │                                   │
│  └───────────┘ └───────────┘                                   │
│                                                                  │
│  一个 API Key 统一调用所有厂商，无加价                              │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│               Supabase (PostgreSQL + pgvector)                   │
│                                                                  │
│  ┌────────┐ ┌──────────┐ ┌───────┐ ┌──────────┐ ┌────────────┐  │
│  │ users  │ │auth_tokens│ │ chats │ │ memories │ │prompt_     │  │
│  │        │ │          │ │(+摘要) │ │          │ │templates   │  │
│  └────────┘ └──────────┘ └───────┘ └──────────┘ └────────────┘  │
│  ┌─────────────┐ ┌──────────────────┐ ┌──────────┐ ┌─────────┐  │
│  │knowledge_   │ │knowledge_vectors  │ │mcp_servers│ │request_ │  │
│  │docs         │ │(VECTOR(1536)+HNSW)│ │          │ │logs     │  │
│  └─────────────┘ └──────────────────┘ └──────────┘ └─────────┘  │
│                                                                  │
│  9 张表，全部按 user_id 隔离（匿名用户共享 null 命名空间）          │
└──────────────────────────────────────────────────────────────────┘
```

## 8 大核心模块（全部已实现）

### 1. 认证 — `lib/auth.ts`

邮箱 + 密码认证，基于 Supabase PostgreSQL 持久化。

- **密码哈希**：Node `crypto.scryptSync`，16 字节随机 salt，64 字节 keylen，格式 `salt:hash`
- **Token**：`crypto.randomBytes(32).toString("hex")` → 64 位 hex 字符串
- **存储**：`auth_tokens` 表，每用户保留最近 10 个 token
- **传递**：`Authorization: Bearer <token>` 或 `auth-token` Cookie（httpOnly，30 天 max-age）
- **中间件**：`middleware.ts` 在 Edge Runtime 保护受保护路由
- **公共 API**：`registerUser` / `loginUser` / `getUserByToken` / `authenticateUser` / `extractTokenFromRequest`

### 2. 速率限制 — `lib/ratelimit.ts`

内存限流（本地开发零依赖），固定窗口策略。

| 预设 | 限额 | 窗口 | 适用路由 |
|------|------|------|----------|
| `chat` | 120 次 | 1 小时 | `/api/chat` |
| `createChat` | 60 次 | 1 小时 | `POST /api/chats` |
| `upload` | 50 次 | 24 小时 | `/api/upload` |
| `memory` | 200 次 | 24 小时 | `/api/memory` |

- 标识符：登录用户用 `user:<id>`，匿名用户用 `ip:<forwarded-for>`
- 超限返回 `429` + `Retry-After` 头
- 定期清理过期条目（每 10 分钟）

### 3. 工具系统 — `tools/`

8 个内置工具，每个工具是独立文件，在 `tools/index.ts` 中聚合。

| 工具 | 文件 | 类型 | 说明 |
|------|------|------|------|
| `github_repo` | `tools/github_repo.ts` | 服务端执行 | 查询 GitHub 仓库 stars/forks/language |
| `ask_user` | `tools/ask_user.ts` | 人机交互 | 模型向用户提问，前端渲染问卷 |
| `web_search` | `tools/web_search.ts` | 厂商原生 | 按模型前缀选择 OpenAI/Anthropic 搜索 |
| `weather` | `tools/weather.ts` | 服务端执行 | 查询城市多日天气预报和出行建议 |
| `save_memory` | `tools/memory.ts` | 服务端执行 | 保存用户记忆（profile/fact/preference） |
| `recall_memory` | `tools/memory.ts` | 服务端执行 | 按关键词检索用户记忆 |
| `knowledge` | `tools/knowledge.ts` | 服务端执行 | RAG 语义检索私有知识库 |
| `code_run` | `tools/code-run.ts` | 沙箱执行 | 执行 Python/JavaScript 代码（10 秒超时） |

**工具分发逻辑：**

```ts
// tools/index.ts
export function getTools(modelId: string, userId?: string): ToolSet {
  const { save_memory, recall_memory } = scopedMemoryTools(userId)
  const webSearch = getWebSearch(modelId) ?? FALLBACK_WEB_SEARCH
  const knowledge = createKnowledgeTool(userId)
  return {
    github_repo, ask_user, weather,
    save_memory, recall_memory,
    knowledge, web_search: webSearch,
    code_run,
  }
}
```

- `save_memory` / `recall_memory` / `knowledge` 通过闭包按 `userId` 隔离
- `web_search` 按模型前缀（`openai/` 或 `anthropic/`）选择厂商原生搜索，其余模型使用 fallback
- `ask_user` 是特例：没有 `execute` 函数，调用时流程暂停，等待前端用户回答后才继续

### 4. 可观测性 — `lib/logger.ts`

请求日志 + Token 用量统计，存储在 Supabase `request_logs` 表。

- **`logRequest()`**：记录每次请求的时间戳、chatId、userId、模型、耗时、输入/输出 token、状态、错误信息、工具调用列表
- **`getUsageStats()`**：聚合统计（默认 7 天），返回按模型/按天的请求量和 token 用量、错误数、平均耗时
- **调用时机**：`/api/chat` 路由的 `onEnd`（成功）和 `onError`（失败）回调

### 5. 长期记忆 — `lib/storage.ts`

长期用户记忆，按 `userId` 隔离，存储在 `memories` 表。

- **记忆类型**：`profile`（用户信息）、`fact`（事实）、`preference`（偏好）
- **存储方式**：`upsert`，冲突列为 `user_id,type,key`（同一用户同类同 key 覆盖）
- **注入方式**：系统 Prompt 中注入用户信息和偏好（`save_memory` 工具主动保存 → 下次对话自动注入）
- **检索方式**：`recall_memory` 工具按关键词模糊匹配（key/value/type 全文搜索）

### 6. RAG 私有知识库 — `lib/rag.ts`

文档向量化 + 语义检索，基于 Supabase pgvector。

- **分块策略**：`chunkText(text, chunkSize=1000, overlap=200)`，固定滑动窗口
- **向量化模型**：`text-embedding-3-small`（1536 维）
- **向量存储**：`knowledge_vectors` 表，`VECTOR(1536)` 类型 + HNSW 索引
- **检索方式**：`match_knowledge_vectors` RPC，余弦距离（`<=>`），按 `user_id` 过滤
- **文档管理**：`knowledge_docs` 表记录文档元数据，删除时 CASCADE 删除向量
- **用户隔离**：文档和向量按 `user_id` 隔离，匿名用户共享 `null` 命名空间

### 7. 上下文窗口管理

防止长对话超出模型上下文窗口，两级策略：

```
消息数 > 30 (SUMMARY_THRESHOLD) 且有 chatId
  → 取最近 10 条 (RECENT_KEEP_COUNT)，其余生成摘要
  → 若有缓存摘要且 summarizedCount >= 待摘要数 → 直接用缓存
  → 否则 generateText 生成摘要（SUMMARY_MAX_TOKENS=500），存入 chats 表
  → 摘要注入 systemPrompt，modelMessages 只保留最近 10 条

消息数 > 20 (MAX_CONTEXT_MESSAGES) 但 ≤ 30
  → pruneMessages 裁剪（移除推理、旧工具调用、空消息）
```

摘要缓存存储在 `chats` 表的 `summary` / `summarized_count` / `summary_created_at` / `summary_updated_at` 列。

### 8. Agent 步骤工作流 — `lib/agent-steps.ts`

基于 AI SDK `prepareStep` 的动态工具过滤工作流。

**步骤画像（`planSteps`）：** 根据首条用户消息分类

| 类型 | 触发条件 | 步骤计划 |
|------|----------|----------|
| 简单问题 | ≤20 字 或 含 "翻译/解释/hello/你好" | 最多 2 步，全工具 |
| 研究类问题 | 含 "调研/对比/研究/survey/compare/vs" | 3 步搜索（仅 web_search + knowledge）+ 2 步纯文本 |
| 默认 | 其他 | 最多 10 步，全工具 |

**动态工具裁剪（`decidePrepareStep`）：**

```
stepNumber >= 8 → 禁用所有工具（强制文本兜底）
  └─ 若上一步有 toolResults → 再给最后 1 步
  └─ 否则 stop: true

有 toolResults → 继续下一步（可能还需综合结果）
第 1 步 → 允许所有工具（经画像过滤）
之后无 toolResults → stop: true（避免空步骤）
```

叠加画像白名单：`null` = 不裁剪，`[]` = 禁用所有工具，`string[]` = 仅保留命名的工具。

## 模型注册表 — `lib/models.ts`

17 个模型，覆盖 10 家厂商。模型列表是前端下拉框和后端校验的单一数据源。

**旗舰模型：**
- Claude Opus 5、Claude Sonnet 5、GPT 5.6 Sol、GPT 5.6 Terra、Grok 4.6、Gemini 3.7 Flash

**中端/高性价比：**
- GPT 5.6 Luna、DeepSeek V4 Pro、Gemini 3.5 Flash Lite、Qwen 3.7 Flash、Qwen 3.8 Max、Kimi K3

**免费模型（5 个）：**
- Qwen 3.8 27B、Nemotron 3.5 Lightning、Laguna S 2.1、Ling 3.0 Tiny、Ling 3.0 Flash

```ts
export const DEFAULT_MODEL = "alibaba/qwen3.8-27b"  // 免费，默认选中
export function isModelAllowed(id: string) { ... }  // 后端校验
```

## 数据库 Schema — 9 张表（Supabase）

| 表名 | 用途 | 关键列 |
|------|------|--------|
| `users` | 用户账户 | `id, email, name, password_hash, created_at` |
| `auth_tokens` | 认证令牌 | `token, user_id, created_at` |
| `chats` | 聊天会话 | `id, user_id, title, messages, message_count, system_prompt, prompt_template_id, summary, summarized_count, summary_created_at, summary_updated_at` |
| `memories` | 长期记忆 | `id, user_id, type, key, value, created_at, updated_at`（唯一约束 `user_id,type,key`） |
| `prompt_templates` | 自定义角色模板 | `id, user_id, name, icon, description, system_prompt` |
| `knowledge_docs` | RAG 文档元数据 | `id, user_id, name, chunk_count, size, created_at` |
| `knowledge_vectors` | RAG 向量 | `id, doc_id, user_id, chunk, embedding(VECTOR(1536)), created_at`（HNSW 索引） |
| `mcp_servers` | MCP 服务器配置 | `id, name, url, transport, enabled` |
| `request_logs` | 请求日志 | `timestamp, chat_id, user_id, model, duration_ms, input_tokens, output_tokens, total_tokens, status, error, tool_calls` |

所有表按 `user_id` 隔离。匿名用户使用 `null` 命名空间（共享）。

## API 路由 — 9 个文件，10 个端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 核心 AI 路由，集成全部 8 大模块 |
| `/api/auth` | POST/GET/DELETE | 注册/登录/获取当前用户/登出 |
| `/api/chats` | GET/POST | 列出/创建会话 |
| `/api/chats/[id]` | GET/DELETE/PATCH | 加载/删除/更新会话设置 |
| `/api/knowledge` | GET/DELETE | 知识库文档管理 |
| `/api/mcp` | GET/POST/PATCH/DELETE | MCP 服务器管理 |
| `/api/memory` | GET/POST/DELETE | 记忆 CRUD |
| `/api/prompt-templates` | GET/POST/DELETE | 自定义角色模板 CRUD |
| `/api/stats` | GET | 用量统计 |
| `/api/upload` | POST | 文档上传（RAG） |

## 聊天路由流程 — `app/api/chat/route.ts`

```
POST /api/chat
  body: { model, messages, id?, ... }
     │
     ├─→ 模块 1：认证 authenticateUser(req) → userId (可选)
     ├─→ 模块 2：速率限制 rateLimit(chat: 120/hr)，超限 → 429 + Retry-After
     ├─→ 解析 body：isModelAllowed(modelId) 校验，提取 chatId
     ├─→ 模块 3：工具集 getTools(modelId, userId) + loadMCPTools() 动态工具
     ├─→ 校验消息 validateUIMessages()
     ├─→ 模块 7：上下文管理
     │    ├─ normalizeModelMessageContent() → data URL 转为 base64 data parts
     │    ├─ 视觉降级：anthropic/ + 图片 → openai/gpt-5.6-terra
     │    └─ prune/summarize（>20 裁剪，>30 摘要）
     ├─→ 模块 5+6：系统 Prompt 组装
     │    ├─ 视觉降级提示
     │    ├─ chatMeta.systemPrompt（自定义角色）
     │    ├─ summarySystemPrompt（摘要）
     │    ├─ 用户记忆（profile + preference）
     │    └─ 工具引导（save_memory / recall_memory / code_run）
     ├─→ 模块 8：streamText({ model, system, messages, tools })
     │    ├─ prepareStep → decidePrepareStep（动态工具过滤）
     │    ├─ stopWhen: isStepCount(10)（最多 10 步）
     │    ├─ maxOutputTokens: 8192
     │    └─ abortSignal: req.signal
     ├─→ 模块 4：日志
     │    ├─ onEnd → logRequest(success)
     │    └─ onError → logRequest(error)
     └─→ SSE 响应 toUIMessageStream + onEnd(saveChat) + onError(logRequest)
```

## 关键常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `maxDuration` | 30 | API 路由最长执行 30 秒 |
| `MAX_OUTPUT_TOKENS` | 8192 | 单次最大输出 token |
| `MAX_CONTEXT_MESSAGES` | 20 | 超过则裁剪消息 |
| `SUMMARY_THRESHOLD` | 30 | 超过则生成摘要 |
| `RECENT_KEEP_COUNT` | 10 | 摘要时保留最近消息数 |
| `SUMMARY_MAX_TOKENS` | 500 | 摘要最大 token |

## 前端组件 — `components/`

**核心组件：**

- `Chat` — 基于 `useChat` Hook（`@ai-sdk/react`），管理消息列表、发送状态、错误处理
- `ChatSidebar` — 会话列表，支持加载/删除/切换
- `ChatMessage` — Part-based 渲染，按 `part.type` 分发到对应组件
- `PromptForm` — 输入区：模型选择 + 文件上传 + 文本输入 + 发送/停止
- `SystemPromptDialog` — 自定义角色模板编辑器
- `KnowledgeUpload` — RAG 文档上传
- `McpPanel` — MCP 服务器管理
- `StatsPanel` — 用量统计面板
- `AuthButton` / `AuthForm` — 认证 UI

**Part 组件（11 个，位于 `components/parts/`）：**

```
part.type → 渲染组件
├── "text"                 → <TextPart />
├── "tool-github_repo"     → <GithubRepoPart />
├── "tool-ask_user"        → <AskUserPart />
├── "tool-web_search"      → <WebSearchPart />
├── "tool-weather"         → <WeatherPart />
├── "tool-save_memory"     → <SaveMemoryPart />
├── "tool-recall_memory"   → <RecallMemoryPart />
├── "tool-knowledge"       → <KnowledgePart />
├── "tool-code_run"        → <CodeRunPart />
├── "source-url"           → <SourcesPart />
└── (通用工具)             → <ToolProcessPart />
```

**Part 状态机：**

```
input-streaming → input-available → output-available
                                  → output-error
```

## MCP 支持

基于 `@ai-sdk/mcp` v2，连接外部 MCP 服务器加载动态工具。

- **传输协议**：仅支持 SSE 和 HTTP（不支持 stdio）
- **传输映射**：`"streamable-http"` → `"http"`，其余 → `"sse"`
- **配置存储**：`mcp_servers` 表（全局配置，非用户隔离）
- **工具命名**：`${config.name}_${toolName}`（前缀避免冲突）
- **加载流程**：`listMCPServers()` → `loadMCPTools()` → `Object.assign(tools, mcpTools)`
- **容错**：MCP 加载失败不影响主流程（catch 后继续）

## 多模态

- **图片上传**：支持拖拽、粘贴、文件选择
- **视觉模型白名单**：`openai/*` 和 `anthropic/*`
- **自动降级**：检测到 `anthropic/` + 图片消息 → 自动切换到 `openai/gpt-5.6-terra`（Gateway beta header 冲突规避）
- **内容规范化**：`normalizeModelMessageContent()` 将 data URL 转为 base64 data parts，避免 provider 解析错误

## 安全

### 中间件保护 — `middleware.ts` (Edge Runtime)

| 路由类型 | 访问策略 |
|----------|----------|
| `/api/chat`、`/api/chats*` | 公开（匿名可使用，数据隔离靠 userId） |
| `/api/auth` | 公开（注册/登录） |
| `/api/memory`、`/api/upload`、`/api/knowledge`、`/api/mcp`、`/api/stats` | 需登录（Cookie `auth-token` 存在且为 64 位 hex） |
| 前端页面 | 全部放行（登录态由 Header 管理） |

中间件仅校验 token 格式，真正的鉴权在各 API 路由的 `authenticateUser()` 中完成（数据库 hash 校验）。

### 认证安全

- **Token**：64 位 hex（32 字节随机），httpOnly Cookie，30 天 max-age
- **密码**：`scryptSync` + 16 字节 salt + 64 字节 keylen
- **Token 轮换**：每用户保留最近 10 个 token，自动清理旧的

## 配置

### 环境变量

| 变量 | 必要性 | 说明 |
|------|--------|------|
| `AI_GATEWAY_API_KEY` | 本地开发需要 | AI Gateway API Key，Vercel 部署时用 OIDC 自动认证 |
| `SUPABASE_URL` | 需要 | Supabase 项目 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 需要 | Supabase 服务端密钥 |

### 模型配置

模型列表在 `lib/models.ts` 中硬编码，直接编辑 `MODELS` 数组即可增删模型。`DEFAULT_MODEL` 指向默认选中的模型。

## 扩展指南

### 添加新模型

编辑 `lib/models.ts` 的 `MODELS` 数组：

```ts
{ id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", description: "..." }
```

### 添加新工具

1. 创建 `tools/<name>.ts`，导出 `tool()` 定义（Zod inputSchema + execute 函数）
2. 在 `tools/index.ts` 的 `getTools()` 返回值中注册
3. 创建 `components/parts/<name>-part.tsx` 渲染组件
4. 在 `components/chat-message.tsx` 添加 `case "tool-<name>"`

### 添加新 UI 组件

```bash
npx shadcn@latest add <component-name>
```

### 添加新的速率限制预设

在 `lib/ratelimit.ts` 的 `RATE_LIMITS` 对象中添加，然后在对应 API 路由中调用 `rateLimit()`。

### 添加新的 MCP 服务器

通过 `/api/mcp` 接口添加配置（name + url + transport），或直接在 `mcp_servers` 表中插入记录。

## 与其他框架对比

| 维度 | 本项目 (AI SDK) | Mastra | LangChain |
|------|-----------------|--------|-----------|
| 定位 | 生产级聊天模板 | Agent 框架 | LLM 应用框架 |
| 语言 | TypeScript | TypeScript | Python/TS |
| Agent 概念 | 有（prepareStep 工作流） | 有（Agent 类） | 有 |
| 工作流 | 有（动态步骤画像 + 工具过滤） | 图状态机 | LCEL 链 |
| 记忆 | 有（长期记忆 + 系统注入） | 内置持久化 | 内置 |
| 可观测性 | 有（请求日志 + 用量统计） | 内置 Traces/Evals | LangSmith |
| 多 Agent | 不支持 | 支持 | 支持 |
| RAG | 有（pgvector + HNSW） | 内置 | 内置 |
| MCP 协议 | 有（SSE + HTTP） | 支持 | 无 |
| 代码量 | ~2000 行 | ~60 行/Agent | 中等 |
| 适用场景 | 生产级聊天应用 | 生产级 Agent | 复杂 LLM 应用 |

## 主流项目架构详细对比

以下对当前主流 AI 应用架构方案进行详细对比，涵盖本项目及业界广泛使用的框架。

### 架构模式对比

| 框架 | 架构模式 | 核心抽象 | 状态管理 | 部署方式 |
|------|----------|----------|----------|----------|
| **本项目 (AI SDK)** | API Route + Agent 工作流 | `streamText()` + `prepareStep` | Supabase PostgreSQL 持久化 | Next.js 部署 |
| **Mastra** | Agent 类 + 工作流引擎 | `Agent` / `Workflow` / `Harness` 类 | 内置 Memory + Thread 持久化 | 独立 Server 或嵌入 Next.js |
| **LangChain** | LCEL 链 + 组件组合 | `Chain` / `Runnable` 接口 | Memory 抽象（多后端） | Python 服务 / LangServe |
| **LangGraph** | 图状态机 | `StateGraph` 节点 + 边 | 检查点（Checkpoint）持久化 | Python 服务 / LangGraph Cloud |
| **CrewAI** | 角色协作 | `Crew` / `Agent` / `Task` | 共享记忆 | Python 服务 |
| **AutoGPT** | 自主循环 + 构建块 | `Block` / `Graph` | 工作区文件系统 | 独立平台 |
| **Dify** | 可视化编排 | DAG 工作流编辑器 | 会话变量 + 数据库 | Docker / Dify Cloud |
| **OpenAI Assistants API** | 托管 Agent | `Assistant` / `Thread` / `Run` | OpenAI 托管 Thread | OpenAI 云 |

### 功能特性对比

| 特性 | 本项目 | Mastra | LangChain | LangGraph | CrewAI | Dify | Assistants API |
|------|--------|--------|-----------|-----------|--------|------|---------------|
| **多模型支持** | Gateway 统一接入 | 40+ Provider | 50+ Provider | 50+ Provider | 有限 | 多 Provider | 仅 OpenAI |
| **流式响应** | 内置 (SSE) | 内置 | 内置 | 内置 | 无原生 | 内置 | 内置 |
| **工具调用** | Zod Schema | Zod Schema | Pydantic | Pydantic | 工具装饰器 | 可视化配置 | JSON Schema |
| **多 Agent 协作** | 无 | 有 | 有（有限） | 有 | 核心特性 | 无 | 无 |
| **工作流编排** | prepareStep 动态策略 | 图状态机 | LCEL 链 | 图状态机 | 角色分配 | DAG 可视化 | 无 |
| **Human-in-loop** | ask_user 工具 | suspend/resume | 回调机制 | 检查点中断 | 任务委派 | 人工节点 | Run 状态管理 |
| **持久记忆** | 有（Supabase） | 内置 Memory | Memory 抽象 | Checkpoint | 共享记忆 | 数据库会话 | Thread 托管 |
| **RAG 支持** | 有（pgvector + HNSW） | 内置 | 内置 | 需组合 | 无 | 内置 | File Search |
| **可观测性** | 有（请求日志 + 统计） | Traces/Evals | LangSmith | LangSmith | 有限 | 内置面板 | Dashboard |
| **评估测试** | 无 | 内置 Evals | 无 | 无 | 无 | 内置 | 无 |
| **可视化 UI** | 有（聊天界面 + 管理面板） | Mastra Studio | 无 | 无 | 无 | 有（编排界面） | Playground |
| **MCP 协议** | 有（SSE + HTTP） | 支持 | 无 | 无 | 无 | 支持 | 无 |
| **自托管** | 是 | 是 | 是 | 是 | 是 | 是 | 否（SaaS） |
| **开源协议** | MIT | Apache-2.0 | MIT | MIT | MIT | 开源 | 闭源 |

### 技术栈与生态对比

| 框架 | 主语言 | 运行时 | 包管理 | 社区规模 (GitHub Stars) | 生态成熟度 |
|------|--------|--------|--------|--------------------------|------------|
| **本项目** | TypeScript | Node.js / Edge | yarn | — | 高（AI SDK 生态） |
| **Mastra** | TypeScript | Node.js | npm | ~27k | 成长中 |
| **LangChain** | Python / TS | Python / Node | pip / npm | ~98k | 非常成熟 |
| **LangGraph** | Python / TS | Python / Node | pip / npm | ~39k | 成熟 |
| **CrewAI** | Python | Python 3.9+ | pip | ~42k | 成熟 |
| **AutoGPT** | Python / TS | Python / Node | pip / npm | ~186k | 成熟 |
| **Dify** | Python / TS | Docker | docker | ~95k | 成熟 |
| **Assistants API** | 无（HTTP） | OpenAI 云 | — | — | 闭源 SaaS |

### 适用场景对比

| 场景 | 推荐框架 | 理由 |
|------|----------|------|
| **生产级聊天应用（含认证/记忆/RAG）** | 本项目 | 全栈集成，8 大模块开箱即用 |
| **生产级单 Agent 应用** | Mastra / 本项目 | TS 原生，内置记忆和可观测性 |
| **复杂多步骤工作流** | LangGraph | 图状态机，精确控制每一步 |
| **多角色协作任务** | CrewAI | 角色分工明确，适合团队模拟 |
| **低代码可视化编排** | Dify | 拖拽式 DAG，非开发者也能使用 |
| **自主长期运行 Agent** | AutoGPT | 自主规划 + 执行循环 |
| **快速原型不关心基础设施** | Assistants API | 托管一切，无需后端 |
| **企业级 RAG + Agent** | LangChain | 生态最丰富，组件最多 |
| **TypeScript 全栈 Agent** | Mastra / 本项目 | TS 原生，无 Python 依赖 |
| **多 Provider 统一接入** | 本项目 / Mastra | AI Gateway / 模型路由 |

### 架构复杂度对比

```
简单 ←──────────────────────────────────────────→ 复杂

本项目     Mastra    LangChain   LangGraph   CrewAI    Dify
 │           │          │           │          │         │
 │           │          │           │          │         └─ 可视化编排 + 数据库 + API
 │           │          │           │          └─ 角色 + 任务 + 协作
 │           │          │           └─ 图节点 + 边 + 检查点
 │           │          └─ Chain + Memory + Retriever + Callback
 │           └─ Agent + Workflow + Memory + Harness + Eval
 └─ streamText + prepareStep + 8 模块 + Supabase
```

### 详细架构说明

#### 本项目（生产级 AI SDK 模板）

```
┌──────────┐     ┌───────────────┐     ┌─────────────┐
│  React   │────→│  Next.js API  │────→│  AI Gateway │
│ useChat  │ SSE │  streamText   │     │  (10 厂商)  │
└──────────┘     │  +prepareStep │     └─────────────┘
                 └───────┬───────┘
                         │
              ┌──────────┴──────────┐
              │     8 大模块          │
              │  ┌────┐ ┌────┐ ┌───┐ │
              │  │认证│ │限流│ │日志│ │
              │  └────┘ └────┘ └───┘ │
              │  ┌────┐ ┌────┐ ┌───┐ │
              │  │记忆│ │RAG │ │工具│ │
              │  └────┘ └────┘ └───┘ │
              │  ┌──────┐  ┌──────┐  │
              │  │上下文│  │Agent │  │
              │  │管理  │  │工作流│  │
              │  └──────┘  └──────┘  │
              └──────────┬──────────┘
                         │
              ┌──────────┴──────────┐
              │    Supabase (PG)     │
              │  9 张表 + pgvector   │
              └─────────────────────┘
```

- 8 大模块全集成：认证、限流、工具、日志、记忆、RAG、上下文管理、Agent 工作流
- 优势：全栈集成，开箱即用，用户隔离，MCP 支持，多模态降级
- 劣势：不支持多 Agent 协作，无评估测试

#### Mastra

```
┌─────────────────────────────────────────┐
│            Mastra Server (4111)          │
│  ┌────────┐ ┌──────────┐ ┌──────┐      │
│  │ Agent  │ │ Workflow │ │Memory│      │
│  │ (类)   │ │ (图状态机)│ │(持久)│      │
│  └───┬────┘ └────┬─────┘ └──┬───┘      │
│      └───────────┴─────────┘           │
│  ┌─────────────────────────────┐        │
│  │  Observability + Evals      │        │
│  └─────────────────────────────┘        │
└──────────────┬──────────────────────────┘
               │
        40+ LLM Provider
```

- TypeScript 原生，Agent 作为一等公民
- 内置 Memory（语义召回 + 观察记忆）和 Harness（多模式 Agent）
- 优势：TS 全栈，内置可观测性，workflow 可暂停恢复
- 劣势：框架较重，学习成本中等

#### LangChain / LangGraph

```
┌────────────────────────────────────────┐
│            LangGraph 应用               │
│  ┌──────────────────────────────────┐  │
│  │       StateGraph                 │  │
│  │  ┌────┐    ┌────┐    ┌────┐     │  │
│  │  │Node│───→│Node│───→│Node│     │  │
│  │  └────┘    └────┘    └────┘     │  │
│  │       ↕ Checkpoint 持久化       │  │
│  └──────────────────────────────────┘  │
│  ┌──────────┐  ┌────────┐              │
│  │ Memory   │  │LangSmith│             │
│  └──────────┘  └────────┘              │
└────────────────────────────────────────┘
```

- Python 生态最丰富，组件库庞大
- LangGraph 提供精确的图状态控制和检查点恢复
- 优势：生态成熟，组件丰富，LangSmith 可观测性
- 劣势：Python 优先 TS 版本滞后，复杂度高，容易过度抽象

#### Dify

```
┌────────────────────────────────────────┐
│              Dify 平台                  │
│  ┌──────────┐  ┌───────────────────┐  │
│  │ 可视化编排 │  │   API 服务层      │  │
│  │  (DAG)    │  │  (REST + SSE)    │  │
│  └─────┬────┘  └────────┬──────────┘  │
│  ┌─────┴────────────────┴──────────┐  │
│  │  RAG / Agent / 工具 / 知识库     │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │  数据库 (PostgreSQL + 向量库)    │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

- 低代码可视化编排，非开发者可使用
- 内置 RAG、知识库、Agent 全栈能力
- 优势：开箱即用，可视化，适合非技术团队
- 劣势：自定义灵活性低，Docker 部署较重
