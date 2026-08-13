# 速率限制 (Rate Limiting)

## 目标

防止 API 被滥用导致 AI Gateway 额度耗尽，实现：
- 每用户/IP 请求次数限制（多策略：分钟 / 小时 / 天）
- 流式响应中断后的额度统计（ratelimit 是进入接口就计数）
- 429 响应 + `Retry-After` 响应头 + 前端友好 Alert 提示

## 技术方案

**零依赖**：使用内存 `Map<string, number[]>` 实现滑动窗口，不引入 @upstash/ratelimit / Redis / Vercel KV。
- 每 10 分钟自动清理过期时间戳（`setInterval` 后台定时 GC）
- identifier 优先使用已登录 `userId`，未登录回退 IP（x-forwarded-for / x-real-ip / socket.remoteAddress）

## 架构

```
请求进入
    │
    ▼
API 路由入口
    │
    ▼
rateLimit(identifier, limit, windowMs)
    │
    ├─ success → 继续处理（Map 里追加当前时间戳）
    │
    └─ limit exceeded → 429 Too Many Requests
                         + Retry-After 头
                         + 友好错误提示
```

## 依赖

> 无外部依赖。纯 TS + Map 实现。

## 环境变量

> 无。若后续要接 Upstash，可以保留占位模式：env 存在时走 Redis，否则走内存。

## 实现要点

### 1. 限流器配置

```ts
// lib/ratelimit.ts
const windows = new Map<string, number[]>()

setInterval(() => {  // 每 10 分钟清理
  for (const [k, arr] of windows) {
    const cutoff = Date.now() - MAX_WINDOW_MS
    const kept = arr.filter((t) => t > cutoff)
    kept.length ? windows.set(k, kept) : windows.delete(k)
  }
}, 10 * 60 * 1000).unref?.()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): {
  success: boolean
  limit: number
  remaining: number
  reset: number  // epoch ms
} {
  const cutoff = Date.now() - windowMs
  const arr = (windows.get(key) ?? []).filter((t) => t > cutoff)
  if (arr.length >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      reset: Math.min(...arr) + windowMs,
    }
  }
  arr.push(Date.now())
  windows.set(key, arr)
  return {
    success: true,
    limit,
    remaining: limit - arr.length,
    reset: Date.now() + windowMs,
  }
}
```

4 个预设策略：

```ts
export const RATE_LIMITS = {
  defaultPerIp:  { limit: 60, windowMs: 60 * 1000 },          // IP / 60 次 / 分钟
  chat:          { limit: 60, windowMs: 60 * 1000 },          // 聊天主接口 / 60 次 / 分钟
  auth:          { limit: 10, windowMs: 60 * 60 * 1000 },     // 登录注册 / 10 次 / 小时
  createChat:    { limit: 10, windowMs: 60 * 60 * 1000 },     // 新建会话 / 10 次 / 小时
  upload:        { limit: 20, windowMs: 24 * 60 * 60 * 1000 },// 知识库上传 / 20 次 / 天
  memory:        { limit: 100,windowMs: 24 * 60 * 60 * 1000 },// 记忆 / 100 次 / 天
}
```

### 2. API 路由集成

```ts
// app/api/chat/route.ts
import { rateLimit, RATE_LIMITS, getRequestIdentifier } from "@/lib/ratelimit"

export async function POST(req: Request) {
  const user = await authenticateUser(req).catch(() => undefined)
  const identifier = getRequestIdentifier(req, user?.id)

  const rl = rateLimit(identifier, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs)
  if (!rl.success) {
    return Response.json(
      { error: "今日请求次数已达上限，请稍后再试。" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))),
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      }
    )
  }
  // 继续处理...
}
```

已接入限流的接口清单：
- `/api/chat` (POST) — `RATE_LIMITS.chat`
- `/api/auth` (POST) — `RATE_LIMITS.auth`
- `/api/chats` (POST create) — `RATE_LIMITS.createChat`
- `/api/memory` (GET) — `RATE_LIMITS.memory`
- `/api/upload` (POST) — `RATE_LIMITS.upload`
- `/api/mcp/*` / `/api/knowledge/*` — 默认 `RATE_LIMITS.defaultPerIp`

### 3. 前端提示

```tsx
// components/chat.tsx
const { error } = useChat(...)
const status = useChatStatus()

return (
  <>
    {error && (error as any)?.status === 429 && (
      <div className="fixed top-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive shadow-lg animate-in fade-in slide-in-from-top-2">
        请求过于频繁：今日对话次数已达上限，请稍后再试。
      </div>
    )}
    {/* ... */}
  </>
)
```

### 4. identifier 计算规则

```ts
export function getRequestIdentifier(req: Request, userId?: string) {
  if (userId) return `user:${userId}`                                    // 已登录：按 userId
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (fwd) return `ip:${fwd}`
  const realIp = req.headers.get("x-real-ip")
  if (realIp) return `ip:${realIp}`
  return `ip:anonymous`                                                  // 兜底
}
```

## 限流策略表（实际实现）

| 接口 | 限制 | 窗口期 | 标识 |
|------|------|:------:|------|
| `/api/chat` (POST) | 60 次 | 1 分钟 | userId / IP |
| `/api/auth` (POST) | 10 次 | 1 小时 | IP |
| `/api/chats` (POST create) | 10 次 | 1 小时 | userId |
| `/api/upload` (POST) | 20 次 | 24 小时 | userId |
| `/api/memory` (GET) | 100 次 | 24 小时 | userId |
| 默认 / 其他受保护 API | 60 次 | 1 分钟 | userId / IP |

## 注意事项

- 内存限流**服务端重启就清零**，这对本地 demo 是 OK 的；生产环境要改成 Redis/Upstash。
- Next.js HMR 每次热重载会重跑 setInterval（进程不重启没事），`.unref()` 保证不阻塞退出。
- Edge Runtime 部署时内存 Map 是每个函数实例独立的，要真正一致限流得用 KV/Redis。
