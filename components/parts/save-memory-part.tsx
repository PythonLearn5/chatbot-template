import { CheckIcon } from "lucide-react"

import { type SaveMemoryToolPart } from "@/tools"
import { Spinner } from "@/components/ui/spinner"

export function SaveMemoryPart({ part }: { part: SaveMemoryToolPart }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在保存记忆…
        </div>
      )
    case "output-available": {
      const output = part.output as { saved?: boolean; error?: string }
      if (output.saved === false) {
        return (
          <div className="text-sm text-destructive">记忆保存失败</div>
        )
      }
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckIcon className="size-4 text-green-500" />
          <span>已记住</span>
        </div>
      )
    }
    case "output-error":
      return (
        <div className="text-sm text-destructive">
          记忆保存失败：{part.errorText}
        </div>
      )
    default:
      return null
  }
}
