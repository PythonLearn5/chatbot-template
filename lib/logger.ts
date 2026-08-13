// ============================================================================
// 可观测性模块 — 请求日志 + Token 用量统计
// 日志存储在 .data/logs/ 下（JSONL 格式）
// ============================================================================

import "server-only"
import { promises as fs } from "fs"
import path from "path"

const LOG_DIR = path.join(process.cwd(), ".data", "logs")

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

async function ensureLogDir() {
  await fs.mkdir(LOG_DIR, { recursive: true })
}

// 记录请求日志
export async function logRequest(log: RequestLog): Promise<void> {
  await ensureLogDir()
  const line = JSON.stringify(log) + "\n"
  await fs.appendFile(path.join(LOG_DIR, "requests.jsonl"), line)
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

// 读取统计
export async function getUsageStats(days = 7): Promise<UsageStats> {
  await ensureLogDir()
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000

  let content = ""
  try {
    content = await fs.readFile(path.join(LOG_DIR, "requests.jsonl"), "utf-8")
  } catch {
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

  const logs: RequestLog[] = content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RequestLog
      } catch {
        return null
      }
    })
    .filter((log): log is RequestLog => log !== null && log.timestamp >= cutoff)

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
    stats.totalInputTokens += log.inputTokens ?? 0
    stats.totalOutputTokens += log.outputTokens ?? 0
    if (log.status === "error") stats.errorCount++
    totalDuration += log.durationMs

    const model = log.model
    if (!stats.byModel[model]) {
      stats.byModel[model] = { requests: 0, tokens: 0 }
    }
    stats.byModel[model].requests++
    stats.byModel[model].tokens += (log.totalTokens ?? 0)

    const day = new Date(log.timestamp).toISOString().slice(0, 10)
    if (!stats.byDay[day]) {
      stats.byDay[day] = { requests: 0, tokens: 0 }
    }
    stats.byDay[day].requests++
    stats.byDay[day].tokens += (log.totalTokens ?? 0)
  }

  stats.avgDurationMs = logs.length > 0 ? Math.round(totalDuration / logs.length) : 0
  return stats
}
