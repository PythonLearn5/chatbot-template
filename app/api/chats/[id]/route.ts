// ============================================================================
// 单个会话 API
// GET    → 加载会话的完整消息历史
// DELETE → 删除会话
// ============================================================================
import { NextResponse } from "next/server"
import { loadChat, deleteChat, getChatMeta } from "@/lib/storage"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const [messages, meta] = await Promise.all([
      loadChat(id),
      getChatMeta(id),
    ])
    if (!meta && messages.length === 0) {
      return NextResponse.json(
        { error: "Chat not found." },
        { status: 404 }
      )
    }
    return NextResponse.json({ id, messages, meta })
  } catch {
    return NextResponse.json(
      { error: "Failed to load chat." },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    await deleteChat(id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete chat." },
      { status: 500 }
    )
  }
}
