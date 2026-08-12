# 项目架构文档

## 概述

一个基于 **Next.js + Vercel AI SDK** 的轻量级聊天机器人模板，集成了 shadcn/ui 组件库和 Vercel AI Gateway，支持多模型切换、工具调用和流式响应。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | Next.js 16 (App Router) | React 19 服务端组件 + 客户端组件 |
| AI SDK | Vercel AI SDK 7 | `streamText` 流式生成 + `useChat` 前端 Hook |
| UI 组件 | shadcn/ui + shadcn/react | 基于 Base UI 的组件系统 |
| 样式 | Tailwind CSS 4 | 工具类优先的 CSS 框架 |
| 模型网关 | Vercel AI Gateway | 统一 API 调用多家厂商模型 |
| 类型校验 | Zod 4 | 工具输入/输出的运行时类型校验 |
| 语言 | TypeScript 5 | 全栈类型安全 |

## 架构总览

```
┌──────────────────────────────────────────────────────────┐
│                        浏览器                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │                    Next.js 页面                     │  │
│  │  ┌──────────────┐  ┌────────────────────────────┐ │  │
│  │  │  SiteHeader   │  │       Chat 组件             │ │  │
│  │  │  (导航+主题)   │  │  ┌──────────────────────┐  │ │  │
│  │  └──────────────┘  │  │   Suggestions         │  │ │  │
│  │                     │  │   (空状态建议词)       │  │ │  │
│  │                     │  └──────────────────────┘  │ │  │
│  │                     │  ┌──────────────────────┐  │ │  │
│  │                     │  │  MessageScroller      │  │ │  │
│  │                     │  │  ┌────────────────┐  │  │ │  │
│  │                     │  │  │ ChatMessage x N │  │  │ │  │
│  │                     │  │  │ ├─ TextPart     │  │  │ │  │
│  │                     │  │  │ ├─ GithubRepoPart│ │  │ │  │
│  │                     │  │  │ ├─ AskUserPart   │  │  │ │  │
│  │                     │  │  │ ├─ WebSearchPart │  │  │ │  │
│  │                     │  │  │ ├─ WeatherPart   │  │  │ │  │
│  │                     │  │  │ └─ SourcesPart   │  │  │ │  │
│  │                     │  │  └────────────────┘  │  │ │  │
│  │                     │  └──────────────────────┘  │ │  │
│  │                     │  ┌──────────────────────┐  │ │  │
│  │                     │  │  PromptForm          │  │ │  │
│  │                     │  │  ├─ ModelSelect      │  │ │  │
│  │                     │  │  ├─ Textarea (输入)  │  │ │  │
│  │                     │  │  └─ SendButton       │  │ │  │
│  │                     │  └──────────────────────┘  │ │  │
│  │                     │  ┌──────────────────────┐  │ │  │
│  │                     │  │  QuestionCard        │  │ │  │
│  │                     │  │  (ask_user 问卷弹窗)  │  │ │  │
│  │                     │  └──────────────────────┘  │ │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP (SSE 流式)
                       ▼
┌──────────────────────────────────────────────────────────┐
│              Next.js API Route (/api/chat)               │
│                                                          │
│  1. 解析请求 body (model, messages)                       │
│  2. isModelAllowed() 校验模型是否在允许列表                │
│  3. getTools(modelId) 获取该模型可用的工具集               │
│  4. validateUIMessages() 校验消息格式                      │
│  5. streamText() 调用 AI Gateway → 流式返回               │
│  └─ stopWhen: isStepCount(5)  最多 5 步工具循环            │
│  └─ maxOutputTokens: 8192    单次最大输出 token            │
│  6. toUIMessageStream() 转换为 UI 消息流                   │
│  7. createUIMessageStreamResponse() 返回 SSE 响应           │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│               Vercel AI Gateway                           │
│                                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │
│  │  Anthropic  │ │   OpenAI    │ │   Inclusionai       │ │
│  │  Claude     │ │   GPT       │ │   Ling (Free)       │ │
│  └─────────────┘ └─────────────┘ └─────────────────────┘ │
│                                                          │
│  一个 API Key 统一调用所有厂商，无加价                      │
└──────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. 模型配置 — `lib/models.ts`

模型列表的单一数据源，前端下拉框和后端校验共用。

```ts
export const MODELS = [
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "openai/gpt-5.6-terra", name: "GPT 5.6 Terra" },
  { id: "inclusionai/ling-3.0-tiny-free", name: "Ling 3.0 Tiny (Free)" },
]

export const DEFAULT_MODEL = MODELS[0].id
export function isModelAllowed(id: string) { ... }
```

- 模型 ID 格式：`厂商/模型名`（AI Gateway 约定）
- `DEFAULT_MODEL` 取数组第一个元素
- `isModelAllowed()` 后端校验，防止用户传入未授权模型

### 2. 后端 API — `app/api/chat/route.ts`

单文件、单端点，处理所有聊天请求。

**请求流程：**

```
POST /api/chat
  body: { model: "anthropic/claude-sonnet-5", messages: [...] }
     │
     ├─→ 校验 model → isModelAllowed()
     ├─→ 获取工具 → getTools(modelId)
     ├─→ 校验消息 → validateUIMessages()
     ├─→ 流式生成 → streamText({ model, messages, tools })
     │      └─ 模型可自主调用工具，结果返回给模型继续生成
     │      └─ 最多 5 步循环 (stopWhen: isStepCount(5))
     └─→ 返回 SSE 流 → createUIMessageStreamResponse()
```

**安全限制：**
- `maxDuration: 30` — API 路由最长执行 30 秒
- `MAX_OUTPUT_TOKENS: 8192` — 单次最大输出 8192 token
- `isStepCount(5)` — 工具调用最多循环 5 步
- `abortSignal: req.signal` — 客户端断开时中止生成
- 消息格式校验 — 防止恶意构造的 tool part

### 3. 工具系统 — `tools/`

每个工具是一个独立文件，在 `tools/index.ts` 中聚合。

| 工具 | 文件 | 类型 | 说明 |
|------|------|------|------|
| `github_repo` | [tools/github_repo.ts](tools/github_repo.ts) | 服务端执行 | 查询 GitHub 仓库 stars/forks/language |
| `ask_user` | [tools/ask_user.ts](tools/ask_user.ts) | 人机交互 | 模型向用户提问，前端渲染问卷 |
| `web_search` | [tools/web_search.ts](tools/web_search.ts) | 厂商原生 | 按模型前缀选择 OpenAI/Anthropic 搜索 |
| `weather` | [tools/weather.ts](tools/weather.ts) | 服务端执行 | 查询城市多日天气预报和出行建议 |

**工具分发逻辑：**

```ts
// tools/index.ts
const baseTools = { github_repo, ask_user, weather }  // 所有模型可用

export function getTools(modelId: string) {
  const webSearch = getWebSearch(modelId)  // 仅 openai/ 和 anthropic/ 有
  return webSearch ? { ...baseTools, web_search: webSearch } : baseTools
}
```

**工具调用机制：**

1. 模型收到用户消息 → 自主决定是否需要工具
2. 模型返回 `tool-call` → 后端自动执行工具 `execute` 函数
3. 工具结果返回给模型 → 模型基于结果继续生成回复
4. 循环直到模型不再调用工具或达到 5 步上限

> `ask_user` 是特例：它没有 `execute` 函数，调用时流程暂停，等待前端用户回答后才继续。

### 4. 前端组件 — `components/`

**组件树：**

```
<Chat>
  ├── <Suggestions />          空状态建议词
  ├── <MessageScroller>        消息滚动容器
  │   └── <ChatMessage> x N    每条消息
  │       └── part.type →      按类型分发渲染组件
  │           ├── "text"              → <TextPart />
  │           ├── "tool-github_repo"  → <GithubRepoPart />
  │           ├── "tool-ask_user"     → <AskUserPart />
  │           ├── "tool-web_search"   → <WebSearchPart />
  │           ├── "tool-weather"      → <WeatherPart />
  │           └── "source-url"        → <SourcesPart />
  ├── <QuestionCard />         ask_user 的问卷卡片（固定底部）
  └── <PromptForm>             输入区
      ├── <ModelSelect />      模型下拉框
      ├── <Textarea />         文本输入
      └── <SendButton />       发送/停止
```

**核心 Hook：** `useChat`（来自 `@ai-sdk/react`）

- 管理消息列表、发送状态、错误处理
- 自动发送到 `/api/chat` 并接收 SSE 流
- `sendMessage()` 自动附带当前选中的 model

### 5. 消息渲染 — Part 系统

助手消息不是一个整体字符串，而是 **typed parts 的数组**。每个 part 有独立的类型和状态机：

```
part.state 流转：
  input-streaming → input-available → output-available
                                  → output-error
```

| 状态 | 含义 | 渲染表现 |
|------|------|----------|
| `input-streaming` | 工具参数正在生成 | 显示 spinner |
| `input-available` | 参数已生成，开始执行 | 显示"正在查询…" |
| `output-available` | 工具执行完成 | 显示结果数据 |
| `output-error` | 执行失败 | 显示错误信息 |

消息类型通过 `InferUITools<typeof baseTools>` 从工具定义自动推断，`part.input` 和 `part.output` 完全类型安全。

## 数据流

```
用户输入 "北京明天天气怎么样"
    │
    ▼
useChat.sendMessage({ text, model: "anthropic/claude-sonnet-5" })
    │
    ▼ POST /api/chat  (body: { model, messages: [...] })
    │
    ▼ streamText({ model, messages, tools })
    │
    ▼ 模型决定调用 weather 工具
    │   tool-call: { toolName: "weather", input: { city: "北京", days: 2 } }
    │
    ▼ 后端执行 weather.execute({ city: "北京", days: 2 })
    │   → Open-Meteo API: 地理编码 → 天气预报
    │   → 返回: { city: "北京", forecasts: [{ dayLabel: "今天", ... }, { dayLabel: "明天", ... }] }
    │
    ▼ 工具结果返回给模型
    │   tool-result: { output: { city: "北京", forecasts: [...] } }
    │
    ▼ 模型基于天气数据生成最终回复（流式）
    │   "北京明天多云，气温 15-22°C，建议穿薄外套..."
    │
    ▼ SSE 流返回前端
    │
    ▼ useChat 接收流，更新 message.parts
    │   ├── tool-weather part: state → output-available → <WeatherPart /> 渲染天气卡片
    │   └── text part: 流式追加 → <TextPart /> 渲染 Markdown
    │
    ▼ 用户看到天气卡片 + 文字建议
```

## 配置

### 环境变量

| 变量 | 必要性 | 说明 |
|------|--------|------|
| `AI_GATEWAY_API_KEY` | 本地开发需要 | AI Gateway API Key，Vercel 部署时用 OIDC 自动认证 |

### 模型配置

模型列表在 `lib/models.ts` 中硬编码，直接编辑 `MODELS` 数组即可增删模型。第一个元素是默认模型。

## 安全

`/api/chat` 路由是**公开且无认证的**，每次请求都会消耗 AI Gateway 额度。生产环境需注意：

- **速率限制** — 使用 Vercel WAF 或 `@upstash/ratelimit`
- **额度上限** — 在 AI Gateway 设置 spend limit
- **认证** — 如果不是公开服务，添加用户认证
- **输入校验** — 已内置消息格式校验和模型白名单

## 扩展指南

### 添加新模型

编辑 `lib/models.ts` 的 `MODELS` 数组：

```ts
{ id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite" }
```

### 添加新工具

1. 创建 `tools/<name>.ts`，导出 `tool()` 定义
2. 在 `tools/index.ts` 的 `baseTools` 中注册
3. 创建 `components/parts/<name>-part.tsx` 渲染组件
4. 在 `components/chat-message.tsx` 添加 `case "tool-<name>"`

### 添加新 UI 组件

```bash
npx shadcn@latest add <component-name>
```

## 与其他框架对比

| 维度 | 本项目 (AI SDK) | Mastra | LangChain |
|------|-----------------|--------|-----------|
| 定位 | 聊天 UI 模板 | Agent 框架 | LLM 应用框架 |
| 语言 | TypeScript | TypeScript | Python/TS |
| Agent 概念 | 无 | 有（Agent 类） | 有 |
| 工作流 | 无（单次请求） | 图状态机 | LCEL 链 |
| 记忆 | 无 | 内置持久化 | 内置 |
| 可观测性 | 无 | 内置 Traces/Evals | LangSmith |
| 多 Agent | 不支持 | 支持 | 支持 |
| 代码量 | ~200 行 | ~60 行/Agent | 中等 |
| 适用场景 | 简单聊天助手 | 生产级 Agent | 复杂 LLM 应用 |
