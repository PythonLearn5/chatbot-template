"use client"

import * as React from "react"
import { BarChart3Icon, RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

interface UsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  byModel: Record<string, { requests: number; tokens: number }>
  byDay: Record<string, { requests: number; tokens: number }>
  errorCount: number
  avgDurationMs: number
}

export function StatsPanel() {
  const [stats, setStats] = React.useState<UsageStats | null>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/stats?days=7", { credentials: "include" })
      if (res.ok) {
        setStats(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">用量统计（7天）</h3>
        <button
          onClick={refresh}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Refresh stats"
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          加载中…
        </div>
      ) : !stats ? (
        <p className="text-xs text-muted-foreground">暂无数据</p>
      ) : (
        <div className="grid grid-cols-2 gap-1 text-xs">
          <div className="rounded-md bg-muted/50 px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">请求数</div>
            <div className="font-medium">{stats.totalRequests}</div>
          </div>
          <div className="rounded-md bg-muted/50 px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">输入Token</div>
            <div className="font-medium">{stats.totalInputTokens.toLocaleString()}</div>
          </div>
          <div className="rounded-md bg-muted/50 px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">输出Token</div>
            <div className="font-medium">{stats.totalOutputTokens.toLocaleString()}</div>
          </div>
          <div className="rounded-md bg-muted/50 px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">平均耗时</div>
            <div className="font-medium">{stats.avgDurationMs}ms</div>
          </div>
          {stats.errorCount > 0 && (
            <div className="col-span-2 rounded-md bg-red-500/10 px-2 py-1.5 text-red-600">
              错误：{stats.errorCount} 次
            </div>
          )}
        </div>
      )}
    </div>
  )
}
