// ============================================================================
// 会话列表 API
// GET  → 获取所有会话列表
// POST → 新建会话（返回 chatId）
// ============================================================================
import { NextResponse } from "next/server"
import { saveChat } from "@/lib/storage"

export async function GET() {
  try {
    const { listChats } = await import("@/lib/storage")
    const chats = await listChats()
    return NextResponse.json({ chats })
  } catch {
    return NextResponse.json(
      { error: "Failed to list chats." },
      { status: 500 }
    )
  }
}

export async function POST() {
  try {
    const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await saveChat(chatId, [], "新对话")
    return NextResponse.json({ id: chatId })
  } catch {
    return NextResponse.json(
      { error: "Failed to create chat." },
      { status: 500 }
    )
  }
}
