"use client"

import * as React from "react"
import { useChat } from "@ai-sdk/react"
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import Link from "next/link"
import { LogInIcon, UserPlusIcon } from "lucide-react"

import { DEFAULT_MODEL, type GatewayModel } from "@/lib/models"
import { type ChatUIMessage } from "@/tools"
import { ChatMessage } from "@/components/chat-message"
import { PromptForm, type ImageAttachment } from "@/components/prompt-form"
import { QuestionCard } from "@/components/question-card"
import { Suggestions } from "@/components/suggestions"
import { SystemPromptDialog } from "@/components/system-prompt-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useAuth } from "@/hooks/use-auth"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"

export function Chat({
  models,
  chatId,
  initialMessages,
}: {
  models: GatewayModel[]
  chatId?: string
  initialMessages?: ChatUIMessage[]
}) {
  const [model, setModel] = React.useState(DEFAULT_MODEL)

  // Phase 1: 传入 chatId 和 initialMessages 实现持久化
  // chatId 变化时 useChat 会重新创建实例，加载新的历史消息
  const { messages, sendMessage, status, stop, error, addToolOutput } =
    useChat<ChatUIMessage>({
      id: chatId,
      messages: initialMessages,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    })

  const resolvedModel = models.some((m) => m.id === model)
    ? model
    : (models[0]?.id ?? "")

  const { user } = useAuth()

  const isBusy = status === "submitted" || status === "streaming"

  const errorMsg = error?.message ?? ""
  const errorIs429 =
    /429|过于频繁|次数已达上限|请稍后再试|请明天再试/i.test(errorMsg)
  const errorIs401 = /未登录|Unauthorized|请先.*登录|请点击.*登录/i.test(errorMsg)

  const lastMessage = messages.at(-1)
  const pendingQuestion =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.find(
          (part: any) =>
            part.type === "tool-ask_user" &&
            (part.state === "input-streaming" ||
              part.state === "input-available")
        )
      : undefined

  // 每次发送消息时附带 chatId，后端用于持久化
  const sendOptions = {
    body: { model: resolvedModel, id: chatId },
  }

  return (
    <div className="relative mx-auto flex min-h-0 w-full flex-1 flex-col">
      {errorIs429 && (
        <div className="fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-xl border border-destructive/60 bg-destructive/10 px-4 py-2 text-sm text-destructive shadow-lg animate-in fade-in slide-in-from-top-2">
          ⛔ 请求过于频繁：当前窗口对话次数已达上限，请稍后再试。
        </div>
      )}
      {errorIs401 && (
        <div className="fixed left-1/2 top-4 z-[100] -translate-x-1/2 rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 shadow-lg animate-in fade-in slide-in-from-top-2">
          🔒 未登录：请点击右上角「登录」，然后再管理会话/上传知识库等操作。
        </div>
      )}
      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>What can I help with?</EmptyTitle>
              <EmptyDescription>
                Pick a model and start chatting. Responses stream through the
                Vercel AI Gateway.
              </EmptyDescription>
              {!user && (
                <div className="mx-auto mt-4 flex flex-wrap items-center justify-center gap-2">
                  <Link
                    href="/login"
                    className={
                      "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-2xl border border-border bg-background px-3 text-sm font-medium transition-all hover:bg-muted hover:text-foreground " +
                      "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 " +
                      "has-data-[icon=inline-start]:pl-2"
                    }
                  >
                    <LogInIcon className="size-4" data-icon="inline-start" />
                    登录
                  </Link>
                  <Link
                    href="/register"
                    className={
                      "inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-2xl border border-transparent bg-primary px-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80 " +
                      "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 " +
                      "has-data-[icon=inline-start]:pl-2"
                    }
                  >
                    <UserPlusIcon className="size-4" data-icon="inline-start" />
                    注册新账号
                  </Link>
                </div>
              )}
            </EmptyHeader>
            <EmptyContent>
              <Suggestions
                onSelect={(prompt) =>
                  sendMessage({ text: prompt }, sendOptions)
                }
              />
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <MessageScrollerProvider>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6">
                {messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <ChatMessage
                      message={message}
                      isStreaming={isBusy && message.id === lastMessage?.id}
                    />
                  </MessageScrollerItem>
                ))}
                {status === "submitted" && (
                  <MessageScrollerItem messageId="thinking">
                    <div className="flex shimmer items-center gap-2 px-3 text-sm text-muted-foreground">
                      Thinking…
                    </div>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
              {pendingQuestion && (
                <QuestionCard
                  part={pendingQuestion}
                  onAnswer={(toolCallId, answer) =>
                    addToolOutput({
                      tool: "ask_user",
                      toolCallId,
                      output: answer,
                      options: sendOptions,
                    })
                  }
                />
              )}
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-6 pb-6">
        {error && !errorIs401 && !errorIs429 && (
          <Alert variant="destructive">
            <AlertTitle>Request failed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between">
          <div />
          <SystemPromptDialog chatId={chatId} />
        </div>
        <PromptForm
          models={models}
          model={resolvedModel}
          onModelChange={setModel}
          isBusy={isBusy}
          onSubmit={(text, images) => {
            if (images && images.length > 0) {
              Promise.all(
                images.map(async (img) => {
                  const buffer = await img.file.arrayBuffer()
                  const bytes = new Uint8Array(buffer)
                  let binary = ""
                  for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i])
                  }
                  const base64 = btoa(binary)
                  return {
                    type: "file" as const,
                    mediaType: img.file.type,
                    filename: img.file.name,
                    url: `data:${img.file.type};base64,${base64}`,
                  }
                })
              ).then((files) => {
                sendMessage({ text, files }, sendOptions)
              })
            } else {
              sendMessage({ text }, sendOptions)
            }
          }}
          onStop={() => stop()}
        />
      </div>
    </div>
  )
}
