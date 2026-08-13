"use client"

import { type ChatUIMessage } from "@/tools"
import { AskUserPart } from "@/components/parts/ask-user-part"
import { GithubRepoPart } from "@/components/parts/github-repo-part"
import { KnowledgePart } from "@/components/parts/knowledge-part"
import { RecallMemoryPart } from "@/components/parts/recall-memory-part"
import { SaveMemoryPart } from "@/components/parts/save-memory-part"
import { SourcesPart } from "@/components/parts/sources-part"
import { TextPart } from "@/components/parts/text-part"
import { WebSearchPart } from "@/components/parts/web-search-part"
import { WeatherPart } from "@/components/parts/weather-part"
import { WrenchIcon } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

export function ChatMessage({
  message,
  isStreaming = false,
}: {
  message: ChatUIMessage
  isStreaming?: boolean
}) {
  if (message.role === "user") {
    return (
      <Message align="end">
        <MessageContent className="flex flex-col items-end gap-2">
          {message.parts
            .filter((part: any) => part.type === "file")
            .map((part: any, index: number) => {
              const filePart = part as {
                type: "file"
                url?: string
                mediaType?: string
                data?: unknown
              }
              const url =
                filePart.url ??
                (typeof filePart.data === "string"
                  ? filePart.data
                  : undefined)
              if (url && filePart.mediaType?.startsWith("image/")) {
                return (
                  <img
                    key={`file-${index}`}
                    src={url}
                    alt="uploaded"
                    className="max-h-48 max-w-64 rounded-lg object-contain"
                  />
                )
              }
              return null
            })}
          <Bubble align="end" variant="muted">
            <BubbleContent>
              {message.parts
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text)
                .join("")}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message align="start">
      <MessageContent>
        {message.parts.map((part: any, index: number) => {
          const key =
            (part as { toolCallId?: string }).toolCallId ||
            `${part.type}-${index}`
          switch (part.type) {
            case "text":
              return <TextPart key={key} part={part} />
            case "tool-github_repo":
              return <GithubRepoPart key={key} part={part} />
            case "tool-ask_user":
              return <AskUserPart key={key} part={part} />
            case "tool-web_search":
              return <WebSearchPart key={key} part={part} />
            case "tool-weather":
              return <WeatherPart key={key} part={part} />
            case "tool-save_memory":
              return <SaveMemoryPart key={key} part={part} />
            case "tool-recall_memory":
              return <RecallMemoryPart key={key} part={part} />
            case "tool-knowledge":
              return <KnowledgePart key={key} part={part} />
            default: {
              const anyPart = part as {
                type: string
                state?: string
                input?: unknown
                output?: unknown
                errorText?: string
              }
              if (!anyPart.type.startsWith("tool-")) return null
              const toolName = anyPart.type.replace(/^tool-/, "")
              if (anyPart.state === "input-streaming" || anyPart.state === "input-available") {
                return (
                  <div key={key} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner />
                    <WrenchIcon className="size-3.5" />
                    <span>{toolName}</span>
                  </div>
                )
              }
              if (anyPart.state === "output-error") {
                return (
                  <div key={key} className="text-sm text-destructive">
                    {toolName} 失败：{anyPart.errorText ?? "未知错误"}
                  </div>
                )
              }
              if (anyPart.state === "output-available") {
                const out = anyPart.output as unknown
                const text = typeof out === "string" ? out : JSON.stringify(out, null, 2)
                return (
                  <div
                    key={key}
                    className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground"
                  >
                    <WrenchIcon className="mt-0.5 size-3.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{toolName}</div>
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                        {text.slice(0, 1000)}
                      </pre>
                    </div>
                  </div>
                )
              }
              return null
            }
          }
        })}
        {!isStreaming && <SourcesPart parts={message.parts} />}
      </MessageContent>
    </Message>
  )
}
