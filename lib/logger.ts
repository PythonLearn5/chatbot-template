// ============================================================================
// 可观测性模块 — 请求日志 + Token 用量统计
// 日志存储在 Supabase request_logs 表
// ============================================================================

import "server-only"
import { supabase } from "@/lib/db"

export interface RequestLog {
  timestamp: number
  chatId?: string
  userId?: string
  model: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  status: "success" | "error"
  error?: string
  toolCalls?: string[]
}

export interface UsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  byModel: Record<string, { requests: number; tokens: number }>
  byDay: Record<string, { requests: number; tokens: number }>
  errorCount: number
  avgDurationMs: number
}

// 记录请求日志
export async function logRequest(log: RequestLog): Promise<void> {
  const { error } = await supabase.from("request_logs").insert({
    timestamp: new Date(log.timestamp).toISOString(),
    chat_id: log.chatId ?? null,
    user_id: log.userId ?? null,
    model: log.model,
    duration_ms: log.durationMs,
    input_tokens: log.inputTokens ?? null,
    output_tokens: log.outputTokens ?? null,
    total_tokens: log.totalTokens ?? null,
    status: log.status,
    error: log.error ?? null,
    tool_calls: log.toolCalls ?? null,
  })
  if (error) throw error
}

// 读取统计
export async function getUsageStats(days = 7): Promise<UsageStats> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("request_logs")
    .select("model, duration_ms, input_tokens, output_tokens, total_tokens, status, timestamp")
    .gte("timestamp", cutoff)

  if (error || !data) {
    return {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byModel: {},
      byDay: {},
      errorCount: 0,
      avgDurationMs: 0,
    }
  }

  const logs = data as Array<{
    model: string
    duration_ms: number | null
    input_tokens: number | null
    output_tokens: number | null
    total_tokens: number | null
    status: string
    timestamp: string
  }>

  const stats: UsageStats = {
    totalRequests: logs.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byModel: {},
    byDay: {},
    errorCount: 0,
    avgDurationMs: 0,
  }

  let totalDuration = 0
  for (const log of logs) {
    stats.totalInputTokens += log.input_tokens ?? 0
    stats.totalOutputTokens += log.output_tokens ?? 0
    if (log.status === "error") stats.errorCount++
    totalDuration += log.duration_ms ?? 0

    const model = log.model
    if (!stats.byModel[model]) {
      stats.byModel[model] = { requests: 0, tokens: 0 }
    }
    stats.byModel[model].requests++
    stats.byModel[model].tokens += log.total_tokens ?? 0

    const day = new Date(log.timestamp).toISOString().slice(0, 10)
    if (!stats.byDay[day]) {
      stats.byDay[day] = { requests: 0, tokens: 0 }
    }
    stats.byDay[day].requests++
    stats.byDay[day].tokens += log.total_tokens ?? 0
  }

  stats.avgDurationMs = logs.length > 0 ? Math.round(totalDuration / logs.length) : 0
  return stats
}
