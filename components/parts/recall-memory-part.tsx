import { BrainIcon } from "lucide-react"

import { type RecallMemoryToolPart } from "@/tools"
import { Spinner } from "@/components/ui/spinner"

export function RecallMemoryPart({ part }: { part: RecallMemoryToolPart }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在回忆{part.input?.query ? `「${part.input.query}」` : ""}…
        </div>
      )
    case "output-available": {
      const output = part.output as {
        memories?: Array<{ type: string; key: string; value: string }>
        count?: number
        error?: string
      }
      if (output.error) {
        return (
          <div className="text-sm text-destructive">{output.error}</div>
        )
      }
      const memories = output.memories ?? []
      const count = output.count ?? 0
      if (count === 0) {
        return (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BrainIcon className="size-4" />
            <span>没有找到相关记忆</span>
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          {memories.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <BrainIcon className="size-4 shrink-0" />
              <span className="text-foreground">{m.key}</span>
              <span>{m.value}</span>
              <span className="text-xs">({m.type})</span>
            </div>
          ))}
        </div>
      )
    }
    case "output-error":
      return (
        <div className="text-sm text-destructive">
          记忆检索失败：{part.errorText}
        </div>
      )
    default:
      return null
  }
}
