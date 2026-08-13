// ============================================================================
// 速率限制模块 — 内存限流（本地开发零依赖）
// 生产环境可替换为 @upstash/ratelimit + Vercel KV
// ============================================================================

import "server-only"

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

export interface RateLimitResult {
  success: boolean
  remaining: number
  reset: number // reset timestamp (ms)
}

// 滑动窗口限流
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

// 预设限流策略
export const RATE_LIMITS = {
  chat: { limit: 120, windowMs: 60 * 60 * 1000 },         // 120次/小时
  createChat: { limit: 60, windowMs: 60 * 60 * 1000 },    // 60次/小时
  upload: { limit: 50, windowMs: 24 * 60 * 60 * 1000 },   // 50次/天
  memory: { limit: 200, windowMs: 24 * 60 * 60 * 1000 },  // 200次/天
} as const

// 获取请求标识符（用户 ID 或 IP）
export function getRequestIdentifier(req: Request, userId?: string): string {
  if (userId) return `user:${userId}`
  const forwarded = req.headers.get("x-forwarded-for")
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown"
  return `ip:${ip}`
}
