import { BookOpenIcon } from "lucide-react"

import { type KnowledgeToolPart } from "@/tools"
import { Spinner } from "@/components/ui/spinner"

export function KnowledgePart({ part }: { part: KnowledgeToolPart }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在检索知识库{part.input?.query ? `「${part.input.query}」` : ""}…
        </div>
      )
    case "output-available": {
      const output = part.output as {
        results?: Array<{ chunk: string; docId: string; score: number }>
        count?: number
        error?: string
      }
      if (output.error) {
        return <div className="text-sm text-destructive">{output.error}</div>
      }
      const results = output.results ?? []
      const count = output.count ?? 0
      if (count === 0) {
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookOpenIcon className="size-4" />
            <span>未找到相关知识</span>
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {results.slice(0, 3).map((r, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
              <BookOpenIcon className="mt-0.5 size-4 shrink-0" />
              <span className="line-clamp-3">{r.chunk}</span>
            </div>
          ))}
          {count > 3 && (
            <span className="text-xs">还有 {count - 3} 条结果…</span>
          )}
        </div>
      )
    }
    case "output-error":
      return (
        <div className="text-sm text-destructive">
          知识库检索失败：{part.errorText}
        </div>
      )
    default:
      return null
  }
}
