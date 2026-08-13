// ============================================================================
// 知识库 API
// GET  → 列出所有文档
// DELETE → 删除文档 (?id=xxx)
// （受 middleware 保护：必须登录）
// ============================================================================

import { NextResponse } from "next/server"
import { listDocs, deleteDoc } from "@/lib/rag"
import { authenticateUser } from "@/lib/auth"

export async function GET(req: Request) {
  try {
    const user = await authenticateUser(req)
    const docs = await listDocs(user?.id)
    return NextResponse.json({ docs })
  } catch (e: any) {
    const status = /未登录|Unauthorized/i.test(e?.message ?? "") ? 401 : 500
    return NextResponse.json(
      { error: e?.message ?? "Failed to list documents." },
      { status }
    )
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  if (!id) {
    return NextResponse.json(
      { error: "Document ID required." },
      { status: 400 }
    )
  }
  try {
    const user = await authenticateUser(req)
    const deleted = await deleteDoc(id, user?.id)
    if (!deleted) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 }
      )
    }
    return NextResponse.json({ success: true })
  } catch (e: any) {
    const status = /未登录|Unauthorized/i.test(e?.message ?? "") ? 401 : 500
    return NextResponse.json(
      { error: e?.message ?? "Failed to delete document." },
      { status }
    )
  }
}
