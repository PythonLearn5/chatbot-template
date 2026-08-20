# 工具系统 (Tools)

本项目内置 8 个工具，支持模型自主调用以完成搜索、查询、记忆、代码执行等任务，同时支持通过 MCP 动态加载外部工具。

---

## 一、工具目录

工具定义位于 `tools/` 目录，包含 8 个工具文件 + 1 个索引文件：

```
tools/
├── index.ts           # 工具集入口：getTools()、scopedMemoryTools()、getWebSearch()、createKnowledgeTool()
├── github_repo.ts     # GitHub 仓库信息查询
├── ask_user.ts        # 人机交互（模型向用户提问）
├── web_search.ts      # 网页搜索（provider 原生）
├── weather.ts         # 天气预报 + 出行建议
├── memory.ts          # 记忆工具（save_memory + recall_memory）
├── knowledge.ts       # 知识库 RAG 检索
├── code-run.ts        # 沙箱代码执行（Python / JavaScript）
```

---

## 二、tools/index.ts 核心接口

### getTools(modelId, userId?)

返回 `ToolSet`，包含 8 个工具：

```ts
export function getTools(modelId: string, userId?: string): ToolSet {
  const { save_memory, recall_memory } = scopedMemoryTools(userId)
  const webSearch = getWebSearch(modelId) ?? FALLBACK_WEB_SEARCH
  const knowledge = createKnowledgeTool(userId)
  return {
    github_repo: githubRepo,
    ask_user: askUser,
    weather,
    save_memory,
    recall_memory,
    knowledge,
    web_search: webSearch,
    code_run: codeRun,
  } as ToolSet
}
```

- `modelId`：用于决定 web_search 使用哪个 provider 的搜索实现。
- `userId`：用于 memory 和 knowledge 工具的用户隔离。

### scopedMemoryTools(userId)

工厂函数，创建用户隔离的 `save_memory` + `recall_memory` 工具：

```ts
function scopedMemoryTools(userId?: string) {
  const save_memory = tool({
    description: saveMemoryTool.description,
    inputSchema: z.object({
      type: z.enum(["profile", "fact", "preference"]),
      key: z.string(),
      value: z.string(),
    }),
    execute: async ({ type, key, value }) => {
      await saveMemory({ type, key, value }, userId)
      return { saved: true }
    },
  })

  const recall_memory = tool({
    description: recallMemoryTool.description,
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await searchMemories(query, userId)
      return { memories: results.map(...), count: results.length }
    },
  })

  return { save_memory, recall_memory }
}
```

### getWebSearch(modelId)

根据模型前缀返回 provider 原生的网页搜索工具，或返回 `FALLBACK_WEB_SEARCH`（空结果）：

```ts
export function getWebSearch(modelId: string) {
  if (modelId.startsWith("openai/")) return openai.tools.webSearch()
  if (modelId.startsWith("anthropic/")) return anthropic.tools.webSearch_20260209()
  return undefined
}
```

当模型不支持原生搜索时，使用 `FALLBACK_WEB_SEARCH`（返回空结果）：

```ts
const FALLBACK_WEB_SEARCH = tool({
  description: "Web search not available for this model.",
  inputSchema: z.object({ query: z.string() }),
  execute: async () => ({ results: [], count: 0 }),
})
```

### createKnowledgeTool(userId)

工厂函数，创建用户隔离的知识库检索工具：

```ts
export function createKnowledgeTool(userId?: string) {
  return tool({
    description: "Search the private knowledge base...",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await retrieve(query, 5, userId)
      return { results: results.map(...), count: results.length }
    },
  })
}
```

---

## 三、8 个内置工具

| 工具 | 文件 | 类型 | 说明 |
|------|------|------|------|
| `github_repo` | `tools/github_repo.ts` | Server execute | 查询 GitHub 仓库 stars/forks/openIssues/language/description |
| `ask_user` | `tools/ask_user.ts` | Human-in-loop | 模型向用户提问（每个问题含 3 个选项），暂停等待用户回答 |
| `web_search` | `tools/web_search.ts` | Provider-native | 网页搜索，OpenAI 前缀用 OpenAI 搜索，Anthropic 前缀用 Anthropic 搜索 |
| `weather` | `tools/weather.ts` | Server execute | 城市天气预报（1-7 天）+ 出行建议（Open-Meteo API） |
| `save_memory` | `tools/memory.ts` | Server execute | 保存用户信息/偏好/事实（按 userId 隔离） |
| `recall_memory` | `tools/memory.ts` | Server execute | 按关键词检索历史记忆（按 userId 隔离） |
| `knowledge` | `tools/knowledge.ts` | Server execute | 搜索私有知识库（RAG 语义检索，按 userId 隔离） |
| `code_run` | `tools/code-run.ts` | Server execute | 沙箱执行 Python/JavaScript 代码（10 秒超时，仅标准库） |

### 各工具详情

#### github_repo
- 输入：`repo`（`owner/name` 格式，如 `vercel/next.js`）
- 调用 GitHub REST API `https://api.github.com/repos/{repo}`
- 5 秒超时
- 输出：`repo, description, stars, forks, openIssues, language, url` 或 `{ error }`

#### ask_user
- 输入：`questions` 数组，每项含 `question` + `choices`（恰好 3 个选项）
- 无 `execute` 函数（human-in-the-loop），暂停流等待用户回答
- 输出：用户对每个问题的回答

#### web_search
- 输入：`query`
- OpenAI 前缀 → `openai.tools.webSearch()`
- Anthropic 前缀 → `anthropic.tools.webSearch_20260209()`
- 其他 → `FALLBACK_WEB_SEARCH`（空结果）

#### weather
- 输入：`city`（城市名）、`days`（1-7 天，可选，默认 1）
- 两步：先地理编码（`geocoding-api.open-meteo.com`），再获取天气预报（`api.open-meteo.com`）
- 8 秒超时
- 输出：每日 `date, dayLabel, tempMax, tempMin, windSpeedMax, weatherCode, weatherDescription, travelAdvice`
- WMO 天气代码映射为中文描述
- 根据温度/天气/风力/温差生成出行建议

#### save_memory
- 输入：`type`（profile/fact/preference）、`key`、`value`
- 调用 `saveMemory({ type, key, value }, userId)`
- 按 `user_id` 隔离存储到 Supabase `memories` 表

#### recall_memory
- 输入：`query`
- 调用 `searchMemories(query, userId)`，按关键词在 value/key/type 中搜索
- 按 `user_id` 隔离

#### knowledge
- 输入：`query`
- 调用 `retrieve(query, 5, userId)`，通过 pgvector 向量语义检索
- 返回 `chunk, docId, score`
- 按 `user_id` 隔离

#### code_run
- 输入：`language`（python/javascript，默认 python）、`code`（完整脚本）
- 在 `os.tmpdir()` 创建临时目录，写入文件
- 通过 `child_process.execFile` 执行，10 秒超时，maxBuffer 1MB
- 仅支持标准库（无 pip install）
- 执行后清理临时文件
- 输出：`stdout, stderr, exitCode, success`

---

## 四、工具调用机制

```
1. 模型接收用户消息 → 决定是否需要工具
2. 模型返回 tool-call → 后端执行工具的 execute 函数
3. 工具结果返回给模型 → 模型继续生成
4. 循环直到没有更多工具调用或达到步数上限
```

- 步数上限：`stopWhen: isStepCount(10)` — 最多 10 步
- 每步可包含多个工具调用
- 通过 `prepareStep`（`lib/agent-steps.ts` 的 `decidePrepareStep`）动态管理多步工作流

---

## 五、MCP 动态工具

### 加载流程

```ts
// app/api/chat/route.ts
const tools = getTools(modelId, userId)
try {
  const mcpConfigs = await listMCPServers()
  if (mcpConfigs.some((c) => c.enabled)) {
    const mcpTools = await loadMCPTools(mcpConfigs)
    if (Object.keys(mcpTools).length > 0) {
      Object.assign(tools, mcpTools)  // 合并到工具集
    }
  }
} catch {
  // MCP 加载失败不影响主流程
}
```

### lib/mcp-client.ts — loadMCPTools(configs)

- 遍历所有 `enabled` 且有 `url` 的 MCP 服务器配置
- 使用 `@ai-sdk/mcp` 的 `createMCPClient` 连接
- 支持传输类型：`streamable-http`（映射为 `http`）和 `sse`
- 通过 `client.tools()` 获取工具列表
- **工具名前缀**：`${config.name}_${toolName}` — 避免命名冲突
- **单服务器失败不阻塞**：某个 MCP 服务器连接失败时 `catch` 并继续连接其他服务器

---

## 六、Part 渲染

### 分发机制

每个工具在前端有对应的 part 组件。`components/chat-message.tsx` 通过 switch-case 按 `part.type` 分发：

```tsx
switch (part.type) {
  case "tool-code_run":      return <CodeRunPart part={part} />
  case "tool-ask_user":      return <AskUserPart part={part} />
  case "tool-github_repo":   return <GithubRepoPart part={part} />
  case "tool-knowledge":     return <KnowledgePart part={part} />
  case "tool-recall_memory": return <RecallMemoryPart part={part} />
  case "tool-save_memory":   return <SaveMemoryPart part={part} />
  case "tool-web_search":    return <WebSearchPart part={part} />
  case "tool-weather":       return <WeatherPart part={part} />
  default:                   return null  // MCP 工具走默认渲染
}
```

- `default` 分支返回 `null`，MCP 工具的通用渲染（spinner/output/error 状态）由 `ToolProcessPart` 聚合展示。

### Part 组件（components/parts/ 目录，共 11 个文件）

| 组件 | 文件 | 说明 |
|------|------|------|
| TextPart | `text-part.tsx` | 文本回复渲染 |
| GithubRepoPart | `github-repo-part.tsx` | GitHub 仓库信息卡片 |
| WebSearchPart | `web-search-part.tsx` | 搜索结果展示 |
| AskUserPart | `ask-user-part.tsx` | 模型提问 + 用户回答交互 |
| SourcesPart | `sources-part.tsx` | 引用来源展示 |
| WeatherPart | `weather-part.tsx` | 天气预报卡片 |
| KnowledgePart | `knowledge-part.tsx` | 知识库检索结果 |
| RecallMemoryPart | `recall-memory-part.tsx` | 记忆检索结果 |
| SaveMemoryPart | `save-memory-part.tsx` | 记忆保存状态 |
| CodeRunPart | `code-run-part.tsx` | 代码执行输入/输出 |
| ToolProcessPart | `tool-process-part.tsx` | 工具调用过程聚合面板（含 MCP 工具） |

`ToolProcessPart` 聚合所有工具调用部分（`part.type` 以 `tool-` 开头），以可折叠面板形式展示思考/执行过程，MCP 工具也通过此组件进行通用渲染（spinner → output → error 三态）。
