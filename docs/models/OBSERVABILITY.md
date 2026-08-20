# 可观测性 (Observability)

## 概述

为聊天系统提供请求日志和用量统计能力。日志存储在 Supabase `request_logs` 表（非 JSONL 文件），通过 AI SDK 的 `streamText({ onEnd, onError })` 回调自动记录每次请求的模型、token 数、耗时、状态等信息。统计接口按模型和按天聚合，前端面板展示 7 天趋势。

> 技术方案：Supabase PostgreSQL 持久化 + AI SDK 回调，无 OpenTelemetry / Langfuse / LangSmith 依赖。

## 技术方案

| 组件 | 方案 |
|------|------|
| 日志存储 | Supabase `request_logs` 表（非 JSONL 文件） |
| 日志写入 | AI SDK `streamText({ onEnd, onError })` 回调 → `logRequest()` |
| 聚合查询 | `getUsageStats(days)` 从 Supabase SELECT + JS 聚合 |
| 索引 | `timestamp DESC` + `user_id` |
| 统计 API | `GET /api/stats?days=7`（受 middleware 保护，需登录） |
| 前端面板 | `components/stats-panel.tsx`（侧栏底部） |
| 外部依赖 | 无（使用 Supabase 客户端） |

## 相关文件

```
lib/logger.ts                     # 请求日志 (logRequest) + 聚合 (getUsageStats)
app/api/stats/route.ts            # 统计 API
app/api/chat/route.ts             # onEnd / onError 回调接入
components/stats-panel.tsx        # 7 天用量统计面板
lib/db.ts                         # Supabase 客户端
```

## 环境变量

```
NEXT_PUBLIC_SUPABASE_URL          # Supabase 项目 URL
SUPABASE_SERVICE_ROLE_KEY         # Supabase service_role key（绕过 RLS）
```

## Supabase 表结构

```sql
-- 请求日志表（append-only）
CREATE TABLE request_logs (
  id             BIGSERIAL PRIMARY KEY,
  timestamp      TIMESTAMPTZ DEFAULT now(),
  chat_id        TEXT,
  user_id        TEXT,
  model          TEXT,
  duration_ms    INT,
  input_tokens   INT,
  output_tokens  INT,
  total_tokens   INT,
  status         TEXT NOT NULL,
  error          TEXT,
  tool_calls     JSONB
);
CREATE INDEX idx_request_logs_timestamp ON request_logs(timestamp DESC);
CREATE INDEX idx_request_logs_user_id   ON request_logs(user_id);
```

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
  status: "success" | "error"
  error?: string
  toolCalls?: string[]
}
```

### 2. UsageStats 结构

```ts
export interface UsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  byModel: Record<string, { requests: number; tokens: number }>
  byDay: Record<string, { requests: number; tokens: number }>
  errorCount: number
  avgDurationMs: number
}
```

### 3. 日志写入（logRequest）

```ts
// lib/logger.ts
export async function logRequest(log: RequestLog): Promise<void> {
  const { error } = await supabase.from("request_logs").insert({
    timestamp: new Date(log.timestamp).toISOString(),
    chat_id: log.chatId ?? null,
    user_id: log.userId ?? null,
    model: log.model,
    duration_ms: log.durationMs,
    input_tokens: log.inputTokens ?? null,
    output_tokens: log.outputTokens ?? null,
    total_tokens: log.totalTokens ?? null,
    status: log.status,
    error: log.error ?? null,
    tool_calls: log.toolCalls ?? null,
  })
  if (error) throw error
}
```

- `timestamp` 转换为 ISO 字符串存入 `TIMESTAMPTZ` 列
- 可选字段为 null 时存 `null`（非 undefined）
- 写入失败抛出异常（由调用方 `.catch(() => {})` 吞掉）

### 4. 聚合分析（getUsageStats）

```ts
export async function getUsageStats(days = 7): Promise<UsageStats> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("request_logs")
    .select("model, duration_ms, input_tokens, output_tokens, total_tokens, status, timestamp")
    .gte("timestamp", cutoff)

  // 出错时返回零值统计（不抛异常）
  if (error || !data) {
    return {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byModel: {},
      byDay: {},
      errorCount: 0,
      avgDurationMs: 0,
    }
  }

  const stats: UsageStats = {
    totalRequests: logs.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byModel: {},
    byDay: {},
    errorCount: 0,
    avgDurationMs: 0,
  }

  let totalDuration = 0
  for (const log of logs) {
    stats.totalInputTokens += log.input_tokens ?? 0
    stats.totalOutputTokens += log.output_tokens ?? 0
    if (log.status === "error") stats.errorCount++
    totalDuration += log.duration_ms ?? 0

    // 按模型聚合
    const model = log.model
    if (!stats.byModel[model]) {
      stats.byModel[model] = { requests: 0, tokens: 0 }
    }
    stats.byModel[model].requests++
    stats.byModel[model].tokens += log.total_tokens ?? 0

    // 按天聚合
    const day = new Date(log.timestamp).toISOString().slice(0, 10)  // YYYY-MM-DD
    if (!stats.byDay[day]) {
      stats.byDay[day] = { requests: 0, tokens: 0 }
    }
    stats.byDay[day].requests++
    stats.byDay[day].tokens += log.total_tokens ?? 0
  }

  stats.avgDurationMs = logs.length > 0 ? Math.round(totalDuration / logs.length) : 0
  return stats
}
```

**聚合逻辑说明：**
- 查询条件：`timestamp >= cutoff`（cutoff = 当前时间 - N 天）
- 按模型聚合：`byModel[model] = { requests, tokens }`（tokens = total_tokens 累加）
- 按天聚合：day key = `new Date(log.timestamp).toISOString().slice(0, 10)`（YYYY-MM-DD）
- 平均耗时：`Math.round(totalDuration / logs.length)`
- 出错时返回零值统计（不抛异常）

### 5. 聊天路由集成（onEnd / onError）

```ts
// app/api/chat/route.ts
const startTime = Date.now()

const result = streamText({
  model: modelId,
  system: systemPrompt,
  messages: modelMessages,
  tools: tools,
  stopWhen: isStepCount(10),
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  abortSignal: req.signal,

  // 成功结束时记录日志
  onEnd: async ({ usage }) => {
    await logRequest({
      timestamp: startTime,
      chatId: chatIdStr,
      userId,
      model: modelId,
      durationMs: Date.now() - startTime,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      totalTokens: usage?.totalTokens,
      status: "success",
    }).catch(() => {})
  },
})

// 流返回 + 错误处理
return createUIMessageStreamResponse({
  stream: toUIMessageStream({
    stream: result.stream,
    sendSources: true,
    originalMessages: messages,
    onEnd: async ({ messages: allMessages }) => {
      // 持久化会话消息
      if (chatIdStr) {
        await saveChat(chatIdStr, allMessages, title, undefined, undefined, userId)
      }
    },
    onError: (error) => {
      const errText = String(error || "")

      // 错误分类
      const isGateway500 = errText.includes("GatewayInternalServerError") || errText.includes("anthropic-beta")
      const isNetworkErr = errText.includes("fetch") || errText.includes("network")

      let msg = "出错了，请稍后重试。"
      if (isGateway500) {
        msg = "模型请求失败：当前模型不支持该格式的图片消息，请尝试切换到其他模型（如 GPT）或仅发送纯文本。"
      } else if (isNetworkErr) {
        msg = "网络连接异常，请检查网络后重试。"
      } else if (errText && errText.length < 200) {
        msg = `请求失败：${errText}`
      }

      // 记录错误日志
      logRequest({
        timestamp: startTime,
        chatId: chatIdStr,
        userId,
        model: modelId,
        durationMs: Date.now() - startTime,
        status: "error",
        error: String(error),
      }).catch(() => {})

      return msg  // 返回中文错误消息给前端
    },
  }),
})
```

**错误分类逻辑：**
- `GatewayInternalServerError` 或 `anthropic-beta` → 网关 500 错误（模型不支持图片消息格式）
- `fetch` 或 `network` → 网络连接异常
- 其他错误且长度 < 200 → 原样返回
- 默认 → "出错了，请稍后重试。"

### 6. 统计 API

```ts
// app/api/stats/route.ts
export async function GET(req: Request) {
  const url = new URL(req.url)
  const days = Number(url.searchParams.get("days") ?? "7")

  try {
    const stats = await getUsageStats(days)
    return NextResponse.json(stats)
  } catch {
    return NextResponse.json(
      { error: "Failed to load stats." },
      { status: 500 }
    )
  }
}
```

- `GET /api/stats?days=7` → 返回 `UsageStats` JSON
- 默认 `days=7`
- 受 middleware 保护（`/api/stats` 在 `PROTECTED_API_PREFIXES` 中，需登录）

### 7. 前端统计面板

```tsx
// components/stats-panel.tsx
"use client"

interface UsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  byModel: Record<string, { requests: number; tokens: number }>
  byDay: Record<string, { requests: number; tokens: number }>
  errorCount: number
  avgDurationMs: number
}

export function StatsPanel() {
  const [stats, setStats] = React.useState<UsageStats | null>(null)

  const refresh = React.useCallback(async () => {
    const res = await fetch("/api/stats?days=7", { credentials: "include" })
    if (res.ok) {
      setStats(await res.json())
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  // 展示：
  // - 请求数（totalRequests）
  // - 输入Token（totalInputTokens）
  // - 输出Token（totalOutputTokens）
  // - 平均耗时（avgDurationMs）
  // - 错误数（errorCount，> 0 时红色显示）
}
```

面板展示内容：
- 标题：「用量统计（7天）」+ 刷新按钮
- 2×2 网格卡片：
  - 请求数（`totalRequests`）
  - 输入 Token（`totalInputTokens`，`toLocaleString()` 格式化）
  - 输出 Token（`totalOutputTokens`，`toLocaleString()` 格式化）
  - 平均耗时（`avgDurationMs` + "ms"）
- 错误数（`errorCount > 0` 时跨列红色显示）

## 指标定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalRequests` | number | 窗口内总请求数 |
| `totalInputTokens` | number | 累计输入 token 数 |
| `totalOutputTokens` | number | 累计输出 token 数 |
| `byModel` | `Record<string, { requests, tokens }>` | 按模型聚合（tokens = total_tokens 累加） |
| `byDay` | `Record<string, { requests, tokens }>` | 按天聚合（key = YYYY-MM-DD） |
| `errorCount` | number | 错误请求数（status === "error"） |
| `avgDurationMs` | number | 平均响应时长（ms，`Math.round` 取整） |

## 存储

- 位置：Supabase `request_logs` 表
- 索引：`timestamp DESC`（时间查询）+ `user_id`（用户查询）
- 无自动清理/轮转（不同于 JSONL 的按日切分文件，PostgreSQL 表不会自动归档）
- 长期运行需手动清理或设置 Supabase 保留策略

## 注意事项

- 日志写入失败被 `.catch(() => {})` 吞掉，不影响主流程（聊天仍能正常返回）。
- Token 数来自 AI SDK 的 `usage` 对象；流式 token 计数和实际计费可能有偏差。
- `getUsageStats` 出错时返回零值统计（不抛异常），确保前端面板不会因后端报错而崩溃。
- `request_logs` 表无自动清理机制，长期运行会持续增长，需定期维护。
