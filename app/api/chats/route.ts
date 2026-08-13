// ============================================================================
// 会话列表 API — 加认证 + 速率限制
// GET  → 获取会话列表（按用户隔离）
// POST → 新建会话
// ============================================================================
import { NextResponse } from "next/server"
import { saveChat, listChats } from "@/lib/storage"
import { authenticateUser } from "@/lib/auth"
import { rateLimit, RATE_LIMITS, getRequestIdentifier } from "@/lib/ratelimit"

export async function GET(req: Request) {
  try {
    const user = await authenticateUser(req)
    const chats = await listChats(user?.id)
    return NextResponse.json({ chats })
  } catch {
    return NextResponse.json(
      { error: "Failed to list chats." },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  // 速率限制
  const user = await authenticateUser(req)
  const identifier = getRequestIdentifier(req, user?.id)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.createChat.limit,
    RATE_LIMITS.createChat.windowMs
  )
  if (!rl.success) {
    return NextResponse.json(
      { error: "新建会话过于频繁，请稍后再试。" },
      { status: 429 }
    )
  }

  try {
    const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await saveChat(chatId, [], "新对话", undefined, undefined, user?.id)
    return NextResponse.json({ id: chatId })
  } catch {
    return NextResponse.json(
      { error: "Failed to create chat." },
      { status: 500 }
    )
  }
}
