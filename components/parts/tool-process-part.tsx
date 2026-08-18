"use client"

import * as React from "react"
import {
  WrenchIcon,
  ChevronRightIcon,
  BrainIcon,
  CheckIcon,
  AlertTriangleIcon,
  DatabaseIcon,
  GlobeIcon,
  BrainCircuitIcon,
  MessageSquareIcon,
  CloudSunIcon,
  SearchIcon,
  ServerIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

// 工具图标映射
const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  save_memory: BrainCircuitIcon,
  recall_memory: BrainCircuitIcon,
  knowledge: DatabaseIcon,
  web_search: SearchIcon,
  weather: CloudSunIcon,
  github_repo: GlobeIcon,
  ask_user: MessageSquareIcon,
  code_run: ServerIcon,
}

// 判断是否为 MCP 工具（带服务器名前缀，如 "Kael MCP_web_fetch"）
function isMCPTool(name: string): boolean {
  return name.includes("_") && !["save_memory", "recall_memory", "knowledge", "web_search", "weather", "github_repo", "ask_user"].includes(name)
}

function getToolDisplayName(name: string): string {
  const KNOWN: Record<string, string> = {
    save_memory: "保存记忆",
    recall_memory: "回忆记忆",
    knowledge: "知识库检索",
    web_search: "网络搜索",
    weather: "天气查询",
    github_repo: "GitHub 仓库",
    ask_user: "用户提问",
    code_run: "代码执行",
  }
  if (KNOWN[name]) return KNOWN[name]
  if (isMCPTool(name)) {
    const [server, ...rest] = name.split("_")
    return `MCP: ${server} → ${rest.join("_")}`
  }
  return name
}

function getToolIcon(name: string): React.ComponentType<{ className?: string }> {
  const base = name.split("_")[0]
  return TOOL_ICONS[base] ?? ServerIcon
}

interface ToolProcess {
  id: string
  toolName: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
  type: string
}

function formatToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const obj = input as Record<string, unknown>
  const parts: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const val = typeof v === "string" ? v : JSON.stringify(v)
    parts.push(`${k}: ${val.length > 80 ? val.slice(0, 80) + "…" : val}`)
  }
  return parts.join(" · ")
}

function formatToolOutput(output: unknown): string {
  if (!output) return ""
  if (typeof output === "string") return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

export function ToolProcessPart({ parts }: { parts: any[] }) {
  // 聚合所有 tool- 类型的 part
  const toolParts: ToolProcess[] = React.useMemo(() => {
    return parts
      .filter((p: any) => p.type?.startsWith("tool-"))
      .map((p: any) => ({
        id: p.toolCallId || `${p.type}-${Math.random().toString(36).slice(2, 8)}`,
        toolName: (p.type as string).replace(/^tool-/, ""),
        state: p.state ?? "input-available",
        input: p.input,
        output: p.output,
        errorText: p.errorText,
        type: p.type,
      }))
  }, [parts])

  if (toolParts.length === 0) return null

  const completed = toolParts.filter((t) => t.state === "output-available").length
  const errors = toolParts.filter((t) => t.state === "output-error").length
  const running = toolParts.filter(
    (t) => t.state === "input-streaming" || t.state === "output-streaming"
  ).length

  const summary = [
    `${toolParts.length} 个步骤`,
    running > 0 ? `${running} 进行中` : null,
    completed > 0 ? `${completed} 完成` : null,
    errors > 0 ? `${errors} 失败` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <ToolProcessCollapsible
      toolParts={toolParts}
      completed={completed}
      errors={errors}
      running={running}
      summary={summary}
    />
  )
}

function ToolProcessCollapsible({
  toolParts,
  completed,
  errors,
  running,
  summary,
}: {
  toolParts: ToolProcess[]
  completed: number
  errors: number
  running: number
  summary: string
}) {
  const [open, setOpen] = React.useState(false)

  const isRunning = running > 0
  const hasError = errors > 0

  return (
    <div className="mb-3 overflow-hidden rounded-lg border bg-muted/30 text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <BrainIcon
          className={cn(
            "size-3.5 shrink-0",
            isRunning ? "text-blue-500" : hasError ? "text-red-500" : "text-muted-foreground"
          )}
        />
        <span className="font-medium text-muted-foreground">思考过程</span>
        <span className="text-xs text-muted-foreground/80">{summary}</span>
        <span className="ml-auto flex items-center gap-1">
          {isRunning && <Spinner className="size-3" />}
          {!isRunning && !hasError && completed > 0 && (
            <CheckIcon className="size-3.5 text-green-500" />
          )}
          {hasError && (
            <AlertTriangleIcon className="size-3.5 text-red-500" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t bg-background/50">
          {toolParts.map((tool, i) => (
            <ToolStep key={tool.id} tool={tool} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolStep({ tool, index }: { tool: ToolProcess; index: number }) {
  const Icon = getToolIcon(tool.toolName)
  const displayName = getToolDisplayName(tool.toolName)
  const isRunning =
    tool.state === "input-streaming" ||
    tool.state === "output-streaming" ||
    tool.state === "input-available"
  const isDone = tool.state === "output-available"
  const isError = tool.state === "output-error"

  const inputStr = formatToolInput(tool.toolName, tool.input)
  const outputStr = formatToolOutput(tool.output)

  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b px-3 py-2 last:border-b-0",
        isError && "bg-red-500/5"
      )}
    >
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
        {index + 1}
      </div>
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{displayName}</span>
          <span
            className={cn(
              "text-[10px]",
              isRunning && "text-blue-500",
              isDone && "text-green-500",
              isError && "text-red-500"
            )}
          >
            {isRunning && "执行中…"}
            {isDone && "完成"}
            {isError && "失败"}
          </span>
          {isMCPTool(tool.toolName) && (
            <span className="rounded bg-violet-500/10 px-1 py-0.5 text-[9px] text-violet-500">
              MCP
            </span>
          )}
        </div>
        {inputStr && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {inputStr}
          </div>
        )}
        {isDone && outputStr && (
          <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-1.5 text-[10px] text-muted-foreground">
            {outputStr.slice(0, 600)}
            {outputStr.length > 600 ? "…" : ""}
          </pre>
        )}
        {isError && tool.errorText && (
          <div className="mt-0.5 text-[11px] text-red-500">
            {tool.errorText}
          </div>
        )}
      </div>
      <div className="shrink-0">
        {isRunning && <Spinner className="size-3" />}
        {isDone && <CheckIcon className="size-3 text-green-500" />}
        {isError && <AlertTriangleIcon className="size-3 text-red-500" />}
      </div>
    </div>
  )
}
