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
| `github_repo` | [tools/github_repo.ts](../tools/github_repo.ts) | 服务端执行 | 查询 GitHub 仓库 stars/forks/language |
| `ask_user` | [tools/ask_user.ts](../tools/ask_user.ts) | 人机交互 | 模型向用户提问，前端渲染问卷 |
| `web_search` | [tools/web_search.ts](../tools/web_search.ts) | 厂商原生 | 按模型前缀选择 OpenAI/Anthropic 搜索 |
| `weather` | [tools/weather.ts](../tools/weather.ts) | 服务端执行 | 查询城市多日天气预报和出行建议 |

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

## 主流项目架构详细对比

以下对当前主流 AI 应用架构方案进行详细对比，涵盖本项目及业界广泛使用的框架。

### 架构模式对比

| 框架 | 架构模式 | 核心抽象 | 状态管理 | 部署方式 |
|------|----------|----------|----------|----------|
| **本项目 (AI SDK)** | 单文件 API Route + React Hook | `streamText()` 函数 | 无状态（每次请求独立） | Next.js 部署 |
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
| **工作流编排** | 无 | 图状态机 | LCEL 链 | 图状态机 | 角色分配 | DAG 可视化 | 无 |
| **Human-in-loop** | ask_user 工具 | suspend/resume | 回调机制 | 检查点中断 | 任务委派 | 人工节点 | Run 状态管理 |
| **持久记忆** | 无 | 内置 Memory | Memory 抽象 | Checkpoint | 共享记忆 | 数据库会话 | Thread 托管 |
| **RAG 支持** | 无 | 内置 | 内置 | 需组合 | 无 | 内置 | File Search |
| **可观测性** | 无 | Traces/Evals | LangSmith | LangSmith | 有限 | 内置面板 | Dashboard |
| **评估测试** | 无 | 内置 Evals | 无 | 无 | 无 | 内置 | 无 |
| **可视化 UI** | 有（聊天界面） | Mastra Studio | 无 | 无 | 无 | 有（编排界面） | Playground |
| **MCP 协议** | 无 | 支持 | 无 | 无 | 无 | 支持 | 无 |
| **自托管** | 是 | 是 | 是 | 是 | 是 | 是 | 否（SaaS） |
| **开源协议** | MIT | Apache-2.0 | MIT | MIT | MIT | 开源 | 闭源 |

### 技术栈与生态对比

| 框架 | 主语言 | 运行时 | 包管理 | 社区规模 (GitHub Stars) | 生态成熟度 |
|------|--------|--------|--------|--------------------------|------------|
| **本项目** | TypeScript | Node.js / Edge | pnpm | — | 高（AI SDK 生态） |
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
| **快速搭建聊天 UI** | 本项目 | 最轻量，开箱即用，代码量最少 |
| **生产级单 Agent 应用** | Mastra | TypeScript 原生，内置记忆和可观测性 |
| **复杂多步骤工作流** | LangGraph | 图状态机，精确控制每一步 |
| **多角色协作任务** | CrewAI | 角色分工明确，适合团队模拟 |
| **低代码可视化编排** | Dify | 拖拽式 DAG，非开发者也能使用 |
| **自主长期运行 Agent** | AutoGPT | 自主规划 + 执行循环 |
| **快速原型不关心基础设施** | Assistants API | 托管一切，无需后端 |
| **企业级 RAG + Agent** | LangChain | 生态最丰富，组件最多 |
| **TypeScript 全栈 Agent** | Mastra | TS 原生，无 Python 依赖 |
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
 └─ streamText + useChat + tools
```

### 详细架构说明

#### 本项目（Vercel AI SDK 模板）

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐
│  React   │────→│  Next.js API │────→│  AI Gateway │
│ useChat  │ SSE │  streamText  │     │  (多厂商)   │
└─────────┘     └──────────────┘     └─────────────┘
```

- 无 Agent 抽象，无工作流，无记忆
- 优势：极简，~200 行核心代码，AI SDK 生态无缝衔接
- 劣势：无持久状态，无多 Agent，无可观测性

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
