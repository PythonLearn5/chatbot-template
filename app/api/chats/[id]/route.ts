// ============================================================================
// 单个会话 API — 加认证隔离
// GET    → 加载消息历史
// DELETE → 删除会话
// PATCH  → 更新 systemPrompt 等设置
// ============================================================================
import { NextResponse } from "next/server"
import { loadChat, deleteChat, getChatMeta, saveChat } from "@/lib/storage"
import { authenticateUser } from "@/lib/auth"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await authenticateUser(req)
  try {
    const [messages, meta] = await Promise.all([
      loadChat(id, user?.id),
      getChatMeta(id, user?.id),
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
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await authenticateUser(req)
  try {
    await deleteChat(id, user?.id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete chat." },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await authenticateUser(req)
  try {
    const body = await req.json()
    const { systemPrompt, promptTemplateId } = body as {
      systemPrompt?: string
      promptTemplateId?: string
    }

    const meta = await getChatMeta(id, user?.id)
    const messages = await loadChat(id, user?.id)

    await saveChat(
      id,
      messages,
      meta?.title,
      systemPrompt,
      promptTemplateId,
      user?.id
    )

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to update chat." },
      { status: 500 }
    )
  }
}
