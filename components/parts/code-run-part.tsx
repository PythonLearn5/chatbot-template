"use client"

import * as React from "react"
import {
  TerminalIcon,
  CheckIcon,
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export function CodeRunPart({ part }: { part: any }) {
  const state = part.state as string
  const input = part.input as
    | { language?: string; code?: string }
    | undefined
  const output = part.output as
    | { stdout?: string; stderr?: string; exitCode?: number; success?: boolean }
    | undefined
  const errorText = part.errorText as string | undefined

  const [showCode, setShowCode] = React.useState(false)
  const [showOutput, setShowOutput] = React.useState(true)

  const language = input?.language ?? "python"

  if (state === "input-streaming" || state === "input-available") {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        <TerminalIcon className="size-3.5" />
        <span>执行 {language} 代码中…</span>
      </div>
    )
  }

  if (state === "output-error") {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-red-500">
          <AlertTriangleIcon className="size-3.5" />
          代码执行失败
        </div>
        {errorText && (
          <pre className="mt-1 overflow-auto whitespace-pre-wrap text-xs text-red-400">
            {errorText}
          </pre>
        )}
      </div>
    )
  }

  if (state !== "output-available" || !output) return null

  const hasError = output.exitCode !== 0
  const hasStdout = output.stdout && output.stdout.trim().length > 0
  const hasStderr = output.stderr && output.stderr.trim().length > 0

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20 text-sm">
      {/* 代码区域 */}
      {input?.code && (
        <div>
          <button
            onClick={() => setShowCode((s) => !s)}
            className="flex w-full items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
          >
            {showCode ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
            <TerminalIcon className="size-3" />
            <span className="font-medium">{language}</span>
            <span className="text-muted-foreground/70">
              {input.code.split("\n").length} 行代码
            </span>
          </button>
          {showCode && (
            <pre className="overflow-auto bg-background/50 p-3 text-xs leading-relaxed">
              <code className="font-mono">{input.code}</code>
            </pre>
          )}
        </div>
      )}

      {/* 输出区域 */}
      <div>
        <button
          onClick={() => setShowOutput((s) => !s)}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/40",
            !showCode && !input?.code && "border-b"
          )}
        >
          {showOutput ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
          <div className="flex items-center gap-1.5">
            {hasError ? (
              <AlertTriangleIcon className="size-3 text-red-500" />
            ) : (
              <CheckIcon className="size-3 text-green-500" />
            )}
            <span className="font-medium">
              {hasError ? "执行出错" : "执行成功"}
            </span>
          </div>
          <span className="text-muted-foreground/70">
            退出码 {output.exitCode}
          </span>
        </button>

        {showOutput && (
          <div className="space-y-1 p-3">
            {hasStdout && (
              <div>
                <div className="mb-0.5 text-[10px] uppercase text-muted-foreground/60">
                  stdout
                </div>
                <pre className="overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-xs text-green-600 dark:text-green-400">
                  {output.stdout}
                </pre>
              </div>
            )}
            {hasStderr && (
              <div>
                <div className="mb-0.5 text-[10px] uppercase text-muted-foreground/60">
                  stderr
                </div>
                <pre className="overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-xs text-red-500">
                  {output.stderr}
                </pre>
              </div>
            )}
            {!hasStdout && !hasStderr && (
              <div className="text-xs text-muted-foreground">
                无输出
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
