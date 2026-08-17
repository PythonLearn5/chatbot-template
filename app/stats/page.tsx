"use client"

import * as React from "react"
import {
  BarChart3Icon,
  RefreshCwIcon,
  MessagesSquareIcon,
  ArrowRightToLineIcon,
  ArrowLeftFromLineIcon,
  ClockIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface UsageStats {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  byModel: Record<string, { requests: number; tokens: number }>
  byDay: Record<string, { requests: number; tokens: number }>
  errorCount: number
  avgDurationMs: number
}

const RANGES = [
  { value: 1, label: "今日" },
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 3 个月" },
] as const

export default function StatsPage() {
  const [stats, setStats] = React.useState<UsageStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [days, setDays] = React.useState<(typeof RANGES)[number]["value"]>(7)
  const [menuOpen, setMenuOpen] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/stats?days=${days}`, {
        credentials: "include",
      })
      if (res.ok) {
        setStats(await res.json())
      }
    } finally {
      setLoading(false)
    }
  }, [days])

  React.useEffect(() => {
    refresh()
  }, [refresh])

  const maxDayTokens = React.useMemo(() => {
    if (!stats) return 0
    return Math.max(
      ...Object.values(stats.byDay).map((d) => d.tokens),
      1
    )
  }, [stats])

  const sortedDays = React.useMemo(() => {
    if (!stats) return []
    return Object.entries(stats.byDay).sort(([a], [b]) => a.localeCompare(b))
  }, [stats])

  const rangeLabel = RANGES.find((r) => r.value === days)?.label ?? "近 7 天"

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto px-8 py-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用量统计</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看 AI 请求次数、Token 消耗与性能表现。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button
              variant="outline"
              onClick={() => setMenuOpen((o) => !o)}
              className="min-w-[140px] justify-between"
            >
              {rangeLabel}
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform",
                  menuOpen && "rotate-180"
                )}
              />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-full overflow-hidden rounded-md border bg-background shadow-sm">
                {RANGES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => {
                      setDays(r.value)
                      setMenuOpen(false)
                    }}
                    className={cn(
                      "block w-full px-3 py-2 text-left text-sm hover:bg-muted",
                      r.value === days && "bg-muted font-medium"
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={refresh}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="刷新"
          >
            <RefreshCwIcon
              className={cn("size-4", loading && "animate-spin")}
            />
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<MessagesSquareIcon className="size-4 text-blue-500" />}
          label="请求总数"
          value={stats?.totalRequests ?? 0}
          loading={loading}
        />
        <StatCard
          icon={<ArrowLeftFromLineIcon className="size-4 text-emerald-500" />}
          label="输入 Token"
          value={stats?.totalInputTokens.toLocaleString() ?? 0}
          loading={loading}
        />
        <StatCard
          icon={<ArrowRightToLineIcon className="size-4 text-violet-500" />}
          label="输出 Token"
          value={stats?.totalOutputTokens.toLocaleString() ?? 0}
          loading={loading}
        />
        <StatCard
          icon={<ClockIcon className="size-4 text-amber-500" />}
          label="平均耗时"
          value={loading ? "0" : `${stats?.avgDurationMs ?? 0} ms`}
          loading={loading}
        />
        <StatCard
          icon={<AlertTriangleIcon className="size-4 text-red-500" />}
          label="错误次数"
          value={stats?.errorCount ?? 0}
          loading={loading}
          variant={stats && stats.errorCount > 0 ? "danger" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>按日期 Token 消耗</CardTitle>
          <CardDescription>
            每日总 Token（输入 + 输出）使用量
          </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              加载中…
            </div>
          ) : sortedDays.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <div className="flex h-48 items-end gap-2">
              {sortedDays.map(([date, d]) => (
                <div
                  key={date}
                  className="flex flex-1 flex-col items-center gap-2"
                  title={`${date}: ${d.tokens.toLocaleString()} tokens, ${d.requests} 次`}
                >
                  <div className="relative flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-blue-500/80 to-blue-400 transition-all hover:from-blue-500 hover:to-blue-400"
                      style={{
                        height: `${Math.max(
                          4,
                          (d.tokens / maxDayTokens) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {date.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>按模型分布</CardTitle>
          <CardDescription>每个模型的请求数与 Token 用量</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Spinner />
              加载中…
            </div>
          ) : !stats || Object.keys(stats.byModel).length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              暂无数据
            </div>
          ) : (
            <div className="divide-y">
              {Object.entries(stats.byModel).map(([model, v]) => (
                <div
                  key={model}
                  className="flex items-center gap-4 px-6 py-3 hover:bg-muted/30"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <BarChart3Icon className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {model}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {v.requests.toLocaleString()} 次请求
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    {v.tokens.toLocaleString()}
                    <div className="text-[10px] text-muted-foreground">
                      tokens
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  loading,
  variant = "default",
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  loading: boolean
  variant?: "default" | "danger"
}) {
  return (
    <Card
      className={cn(
        variant === "danger" &&
          "border-red-500/20 bg-red-500/5 dark:bg-red-500/10"
      )}
    >
      <CardContent className="flex flex-col gap-2 pt-6">
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
        <div className="text-2xl font-semibold tracking-tight">
          {loading ? "—" : value}
        </div>
      </CardContent>
    </Card>
  )
}
