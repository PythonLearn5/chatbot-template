"use client"

import { type ChatUIMessage } from "@/tools"
import { AskUserPart } from "@/components/parts/ask-user-part"
import { CodeRunPart } from "@/components/parts/code-run-part"
import { GithubRepoPart } from "@/components/parts/github-repo-part"
import { KnowledgePart } from "@/components/parts/knowledge-part"
import { RecallMemoryPart } from "@/components/parts/recall-memory-part"
import { SaveMemoryPart } from "@/components/parts/save-memory-part"
import { SourcesPart } from "@/components/parts/sources-part"
import { TextPart } from "@/components/parts/text-part"
import { ToolProcessPart } from "@/components/parts/tool-process-part"
import { WebSearchPart } from "@/components/parts/web-search-part"
import { WeatherPart } from "@/components/parts/weather-part"
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
        {/* 思考过程面板：聚合所有工具调用（含 MCP 工具） */}
        <ToolProcessPart parts={message.parts} />

        {/* 文本回复 */}
        {message.parts
          .filter((part: any) => part.type === "text")
          .map((part: any, index: number) => (
            <TextPart key={`text-${index}`} part={part} />
          ))}

        {/* 工具结果详情（可折叠展示） */}
        {message.parts
          .filter((part: any) => part.type?.startsWith("tool-"))
          .map((part: any, index: number) => {
            const key =
              (part as { toolCallId?: string }).toolCallId ||
              `${part.type}-${index}`
            switch (part.type) {
              case "tool-code_run":
                return <CodeRunPart key={key} part={part} />
              case "tool-ask_user":
                return <AskUserPart key={key} part={part} />
              case "tool-github_repo":
                return <GithubRepoPart key={key} part={part} />
              case "tool-knowledge":
                return <KnowledgePart key={key} part={part} />
              case "tool-recall_memory":
                return <RecallMemoryPart key={key} part={part} />
              case "tool-save_memory":
                return <SaveMemoryPart key={key} part={part} />
              case "tool-web_search":
                return <WebSearchPart key={key} part={part} />
              case "tool-weather":
                return <WeatherPart key={key} part={part} />
              default:
                return null
            }
          })}

        {!isStreaming && <SourcesPart parts={message.parts} />}
      </MessageContent>
    </Message>
  )
}
