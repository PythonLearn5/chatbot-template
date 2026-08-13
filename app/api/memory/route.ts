// ============================================================================
// 记忆 API — 加用户隔离 + 速率限制
// GET → 获取当前用户的所有记忆
// ============================================================================
import { NextResponse } from "next/server"
import { loadAllMemories } from "@/lib/storage"
import { authenticateUser } from "@/lib/auth"
import { rateLimit, RATE_LIMITS, getRequestIdentifier } from "@/lib/ratelimit"

export async function GET(req: Request) {
  const user = await authenticateUser(req)
  const identifier = getRequestIdentifier(req, user?.id)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.memory.limit,
    RATE_LIMITS.memory.windowMs
  )
  if (!rl.success) {
    return NextResponse.json(
      { error: "请求过于频繁。" },
      { status: 429 }
    )
  }
  try {
    const memories = await loadAllMemories(user?.id)
    return NextResponse.json({ memories })
  } catch {
    return NextResponse.json(
      { error: "Failed to load memories." },
      { status: 500 }
    )
  }
}
