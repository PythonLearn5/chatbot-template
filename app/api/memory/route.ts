// ============================================================================
// 记忆 API — 加用户隔离 + 速率限制
// GET    → 获取所有记忆
// POST   → 新增 / 更新记忆 (upsert 语义)
// DELETE → 删除记忆 (?id=xxx)
// ============================================================================
import { NextResponse } from "next/server"
import {
  loadAllMemories,
  saveMemory,
  type MemoryEntry,
} from "@/lib/storage"
import { authenticateUser } from "@/lib/auth"
import { rateLimit, RATE_LIMITS, getRequestIdentifier } from "@/lib/ratelimit"

type MemType = MemoryEntry["type"]
const TYPES: ReadonlyArray<MemType> = ["profile", "fact", "preference"]

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

export async function POST(req: Request) {
  const user = await authenticateUser(req)
  const identifier = getRequestIdentifier(req, user?.id)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.memory.limit,
    RATE_LIMITS.memory.windowMs
  )
  if (!rl.success) {
    return NextResponse.json({ error: "请求过于频繁。" }, { status: 429 })
  }
  try {
    const body = (await req.json()) as {
      type?: string
      key?: string
      value?: string
    }
    const type = (body.type as MemType | undefined) ?? "fact"
    const key = (body.key ?? "").trim()
    const value = (body.value ?? "").trim()
    if (!TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid type." }, { status: 400 })
    }
    if (!key || !value) {
      return NextResponse.json(
        { error: "key 和 value 必填。" },
        { status: 400 }
      )
    }
    const stored = await saveMemory({ type, key, value }, user?.id)
    return NextResponse.json(stored)
  } catch {
    return NextResponse.json(
      { error: "Failed to save memory." },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  const user = await authenticateUser(req)
  const url = new URL(req.url)
  const id = url.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "ID required." }, { status: 400 })
  }
  try {
    const { supabase } = await import("@/lib/db")
    const q = supabase.from("memories").delete().eq("id", id)
    const res = user?.id ? q.eq("user_id", user.id) : q.is("user_id", null)
    const { error } = await res
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete memory." },
      { status: 500 }
    )
  }
}
