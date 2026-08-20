# 速率限制 (Rate Limiting)

## 概述

防止 API 被滥用导致 AI Gateway 额度耗尽。使用内存 `Map<string, RateLimitEntry>` 实现固定窗口限流（非滑动窗口），零外部依赖。每 10 分钟自动清理过期条目。

> 标识符策略：已登录用户按 `userId`，未登录回退 IP（`x-forwarded-for` 第一段或 `"unknown"`）。

## 技术方案

| 组件 | 方案 |
|------|------|
| 存储结构 | 内存 `Map<string, RateLimitEntry>`（固定窗口） |
| 条目结构 | `{ count: number, resetAt: number }` |
| 清理机制 | `setInterval` 每 10 分钟删除 `resetAt < now` 的条目 |
| 标识符 | `user:${userId}`（已登录）或 `ip:${x-forwarded-for[0] | "unknown"}`（未登录） |
| 外部依赖 | 无（不使用 @upstash/ratelimit / Redis / Vercel KV） |

## 相关文件

```
lib/ratelimit.ts                  # 限流核心：rateLimit() + getRequestIdentifier() + RATE_LIMITS
app/api/chat/route.ts             # 聊天接口限流
app/api/chats/route.ts            # 新建会话限流
app/api/upload/route.ts           # 上传限流
app/api/memory/route.ts           # 记忆接口限流
```

## 环境变量

> 无。纯内存实现，服务端重启即清零。生产环境如需持久化限流，可替换为 @upstash/ratelimit + Vercel KV。

## 实现要点

### 1. 数据结构

```ts
// lib/ratelimit.ts

interface RateLimitEntry {
  count: number
  resetAt: number
}

// 内存存储：Map<identifier, RateLimitEntry>
const store = new Map<string, RateLimitEntry>()

// 定期清理过期条目（每 10 分钟）
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key)
    }
  }
}, 10 * 60 * 1000)
```

> **注意**：源码中 `setInterval` 的返回 ID 未存储，也未调用 `.unref()`。这意味着定时器会阻止 Node 进程正常退出。对本地开发环境无影响。

### 2. 限流函数

```ts
export interface RateLimitResult {
  success: boolean
  remaining: number
  reset: number // reset timestamp (ms)
}

export function rateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const entry = store.get(identifier)

  if (!entry || entry.resetAt < now) {
    // 新窗口
    store.set(identifier, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: limit - 1, reset: now + windowMs }
  }

  if (entry.count >= limit) {
    // 已超限
    return { success: false, remaining: 0, reset: entry.resetAt }
  }

  // 增加计数
  entry.count++
  return { success: true, remaining: limit - entry.count, reset: entry.resetAt }
}
```

**固定窗口算法说明：**
- 首次请求：创建新条目，`count = 1`，`resetAt = now + windowMs`
- 后续请求：在窗口内递增 `count`，直到 `count >= limit` 返回失败
- 窗口过期：`resetAt < now` 时重置为新窗口
- 非滑动窗口：不会在每次请求时过滤时间戳，而是在窗口过期时整体重置

### 3. 预设限流策略

```ts
export const RATE_LIMITS = {
  chat:      { limit: 120, windowMs: 60 * 60 * 1000 },        // 120次/小时
  createChat:{ limit: 60,  windowMs: 60 * 60 * 1000 },        // 60次/小时
  upload:    { limit: 50,  windowMs: 24 * 60 * 60 * 1000 },  // 50次/天
  memory:    { limit: 200, windowMs: 24 * 60 * 60 * 1000 },  // 200次/天
} as const
```

> **注意**：只有 4 个预设策略。旧文档中的 `defaultPerIp` 和 `auth` 预设不存在于实际代码中。`/api/mcp/*` 和 `/api/knowledge/*` 未接入限流。

### 4. 请求标识符计算

```ts
export function getRequestIdentifier(req: Request, userId?: string): string {
  if (userId) return `user:${userId}`
  const forwarded = req.headers.get("x-forwarded-for")
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown"
  return `ip:${ip}`
}
```

- 已登录：`user:${userId}`（如 `user-1736123456789-a3b4c5`）
- 未登录：`ip:${x-forwarded-for第一段}`（如 `ip:192.168.1.1`）
- 兜底：`ip:unknown`（无 `x-forwarded-for` 头时）

## 限流策略表（实际实现）

| 接口 | 限制 | 窗口期 | 标识符 | 预设 |
|------|------|:------:|--------|------|
| `/api/chat` (POST) | 120 次 | 1 小时 | userId / IP | `RATE_LIMITS.chat` |
| `/api/chats` (POST create) | 60 次 | 1 小时 | userId / IP | `RATE_LIMITS.createChat` |
| `/api/upload` (POST) | 50 次 | 24 小时 | userId / IP | `RATE_LIMITS.upload` |
| `/api/memory` (GET) | 200 次 | 24 小时 | userId / IP | `RATE_LIMITS.memory` |
| `/api/memory` (POST) | 200 次 | 24 小时 | userId / IP | `RATE_LIMITS.memory` |

> **注意**：记忆接口的限流在 **GET** 和 **POST** 方法上均接入（共用 `RATE_LIMITS.memory` 预设）。

## API 路由集成

### /api/chat（聊天主接口）

```ts
// app/api/chat/route.ts
import { rateLimit, RATE_LIMITS, getRequestIdentifier } from "@/lib/ratelimit"

export async function POST(req: Request) {
  const user = await authenticateUser(req)
  const userId = user?.id

  // 速率限制
  const identifier = getRequestIdentifier(req, userId)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.chat.limit,      // 120
    RATE_LIMITS.chat.windowMs    // 3600000 (1小时)
  )
  if (!rl.success) {
    return Response.json(
      { error: "今日请求次数已达上限，请明天再试。" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))
          ),
        },
      }
    )
  }
  // 继续处理...
}
```

429 响应：
- 状态码：`429 Too Many Requests`
- 响应头：`Retry-After: <剩余秒数>`（最少 1）
- 响应体：`{ error: "今日请求次数已达上限，请明天再试。" }`

### /api/chats（新建会话）

```ts
// app/api/chats/route.ts
export async function POST(req: Request) {
  const user = await authenticateUser(req)
  const identifier = getRequestIdentifier(req, user?.id)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.createChat.limit,    // 60
    RATE_LIMITS.createChat.windowMs  // 3600000 (1小时)
  )
  if (!rl.success) {
    return NextResponse.json(
      { error: "新建会话过于频繁，请稍后再试。" },
      { status: 429 }
    )
  }
  // 继续处理...
}
```

### /api/upload（知识库上传）

```ts
// app/api/upload/route.ts
export async function POST(req: Request) {
  const user = await authenticateUser(req)
  const identifier = getRequestIdentifier(req, user?.id)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.upload.limit,     // 50
    RATE_LIMITS.upload.windowMs   // 86400000 (24小时)
  )
  if (!rl.success) {
    return NextResponse.json(
      { error: "上传次数已达上限，请明天再试。" },
      { status: 429, headers: { "Retry-After": "3600" } }
    )
  }
  // 继续处理...
}
```

### /api/memory（记忆接口）

```ts
// app/api/memory/route.ts
export async function GET(req: Request) {
  const user = await authenticateUser(req)
  const identifier = getRequestIdentifier(req, user?.id)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.memory.limit,     // 200
    RATE_LIMITS.memory.windowMs   // 86400000 (24小时)
  )
  if (!rl.success) {
    return NextResponse.json(
      { error: "请求过于频繁。" },
      { status: 429 }
    )
  }
  // 继续处理...
}

// POST 方法同样使用 RATE_LIMITS.memory 限流
```

## 注意事项

- 内存限流**服务端重启就清零**，这对本地 demo 是 OK 的；生产环境要改成 Redis/Upstash。
- `setInterval` 的返回 ID 未存储，也未调用 `.unref()`，定时器会阻止进程退出。对开发环境无影响。
- Edge Runtime 部署时内存 Map 是每个函数实例独立的，要真正一致限流得用 KV/Redis。
- `lib/ratelimit.ts` 导入了 `"server-only"`，确保仅在服务端运行。
