# 可观测性 (Observability)

## 目标

为聊天系统添加监控与追踪能力，实现：
- 每次请求的模型、token 数、耗时、用户、会话记录
- 错误自动捕获和分类（模型 5xx / 限流 429 / 鉴权 401 / 其他）
- Token 用量统计（按用户 / 按模型 / 按天）
- 7 天趋势面板

## 技术方案

**零外部服务**：AI SDK 的 `streamText({ onEnd, onError })` 回调 + 自研 JSONL 追加写。无 OpenTelemetry / Langfuse / LangSmith 等依赖。

## 架构

```
请求进入  streamText({ ... })
      │
      ├─ onEnd({ usage, responseMessages, finishReason })
      │    └─ logRequest({..., status:"success"})
      │
      ├─ onError(error)
      │    └─ logRequest({..., status:"error", error:error.message})
      │
      ▼
追加写入 .data/logs/requests_YYYY-MM-DD.jsonl  (按日切分)
      │
      ▼
GET /api/stats?days=7
      │
      └─ getUsageStats(days) 聚合 → { byDate, byModel, summary }
```

## 修改 / 新增文件

```
lib/logger.ts              # 请求日志 (logRequest) + 聚合 (getUsageStats)
app/api/stats/route.ts     # 统计 API
components/stats-panel.tsx # 7 天面板（侧边栏底部）
app/api/chat/route.ts      # onEnd / onError 接入
```

## 依赖

> 无额外依赖。只用 Node.js `fs.appendFile` + JSONL 行分割读取。

## 实现要点

### 1. RequestLog 结构

```ts
// lib/logger.ts
export interface RequestLog {
  timestamp: number
  chatId?: string
  userId?: string
  model: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  finishReason?: string
  status: "success" | "error"
  error?: string
  errorType?: "gateway" | "ratelimit" | "auth" | "validation" | "unknown"
  toolCalls?: string[]
}
```

### 2. 日志写入

```ts
const LOG_DIR = path.join(process.cwd(), ".data", "logs")

export async function logRequest(log: RequestLog) {
  await fs.mkdir(LOG_DIR, { recursive: true })
  const date = new Date(log.timestamp).toISOString().slice(0, 10)
  const file = path.join(LOG_DIR, `requests_${date}.jsonl`)
  await fs.appendFile(file, JSON.stringify(log) + "\n")
}
```

### 3. 聚合分析

```ts
export async function getUsageStats(days = 7) {
  const logs: RequestLog[] = await readRecentLogs(days)
  const byDate: Record<string, DailyStats> = {}
  const byModel: Record<string, ModelStats> = {}
  let totalRequests = 0, totalInput = 0, totalOutput = 0, totalErrors = 0, totalMs = 0

  for (const log of logs) {
    totalRequests++
    totalInput += log.inputTokens ?? 0
    totalOutput += log.outputTokens ?? 0
    totalMs += log.durationMs
    if (log.status === "error") totalErrors++
    // 按日聚合
    const d = new Date(log.timestamp).toISOString().slice(0, 10)
    byDate[d] = mergeDaily(byDate[d], log)
    byModel[log.model] = mergeModel(byModel[log.model], log)
  }

  return {
    byDate,
    byModel,
    summary: {
      totalRequests,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      errorRate: totalRequests ? totalErrors / totalRequests : 0,
      avgDurationMs: totalRequests ? Math.round(totalMs / totalRequests) : 0,
      totalErrors,
      windowDays: days,
    },
  }
}
```

### 4. route.ts 集成

```ts
// app/api/chat/route.ts
const startTime = Date.now()

const result = streamText({
  ...
  onEnd: async ({ usage, finishReason }) => {
    await logRequest({
      timestamp: startTime,
      chatId: chatIdStr,
      userId,
      model: modelId,
      durationMs: Date.now() - startTime,
      inputTokens: usage?.promptTokens,
      outputTokens: usage?.completionTokens,
      totalTokens: usage?.totalTokens,
      finishReason: String(finishReason ?? ""),
      status: "success",
    })
    // ...持久化消息
  },
})

return createUIMessageStreamResponse(
  result.toUIMessageStream({
    onError: (err) => {
      logRequest({
        timestamp: startTime,
        chatId: chatIdStr,
        userId,
        model: modelId,
        durationMs: Date.now() - startTime,
        status: "error",
        error: String(err),
        errorType: classify(err),  // gateway / ratelimit / auth / validation / unknown
      })
      return "出错了：" + String(err)
    },
  }),
  {
    generateId: () => nanoid(),
  }
)
```

### 5. 前端面板

侧边栏底部第 3 个面板（`components/stats-panel.tsx`）：
- 顶部 5 张卡片：`总请求` / `输入 Token` / `输出 Token` / `平均耗时` / `错误数`
- 7 天折线图（条形）按日期 show 请求数 / token 数
- 底部：模型对比表格（requests / tokens / 错误率）

## 指标定义 & 实际返回

| 字段 | 位置 | 说明 |
|------|------|------|
| `summary.totalRequests` | `GET /api/stats` | 窗口内总请求数 |
| `summary.totalInputTokens` | " | 累计 prompt tokens |
| `summary.totalOutputTokens` | " | 累计 completion tokens |
| `summary.avgDurationMs` | " | 平均响应时长（ms） |
| `summary.errorRate` | " | 0~1，错误数/总请求数 |
| `summary.totalErrors` | " | 错误数量 |
| `byDate[YYYY-MM-DD]` | " | 每日请求/token/错误 |
| `byModel[modelId]` | " | 按模型聚合 |

## 存储

- 位置：`.data/logs/requests_YYYY-MM-DD.jsonl`
- 每个 JSONL 行是一条 `RequestLog` JSON
- 聚合按日从最新到旧读 `days` 个文件

## 注意事项

- JSONL 是 append-only，不会自动压缩/归档；长期运行请定期刪除或迁移旧日期文件。
- Edge Runtime 下 `fs` 不可用；Edge 部署要换为 Vercel KV / Postgres 或其他持久层。
- Token 数来自 AI SDK 的 `usage`；流式 token 计数和实际计费可能有 ±5% 偏差，正常。
