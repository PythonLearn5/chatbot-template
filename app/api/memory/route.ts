// ============================================================================
// 记忆 API
// GET → 获取所有记忆条目（注入 system prompt）
// ============================================================================
import { NextResponse } from "next/server"
import { loadAllMemories } from "@/lib/storage"

export async function GET() {
  try {
    const memories = await loadAllMemories()
    return NextResponse.json({ memories })
  } catch {
    return NextResponse.json(
      { error: "Failed to load memories." },
      { status: 500 }
    )
  }
}
