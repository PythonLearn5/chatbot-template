// ============================================================================
// 统计 API — 返回用量统计
// GET /api/stats?days=7
// ============================================================================

import { NextResponse } from "next/server"
import { getUsageStats } from "@/lib/logger"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const days = Number(url.searchParams.get("days") ?? "7")

  try {
    const stats = await getUsageStats(days)
    return NextResponse.json(stats)
  } catch {
    return NextResponse.json(
      { error: "Failed to load stats." },
      { status: 500 }
    )
  }
}
