// ============================================================================
// AI SDK 核心路由 — 集成所有 8 个模块
// ============================================================================
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  pruneMessages,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai"

import { DEFAULT_MODEL, isModelAllowed } from "@/lib/models"
import { decidePrepareStep } from "@/lib/agent-steps"
import { getTools, type ChatUIMessage } from "@/tools"
import {
  saveChat,
  loadAllMemories,
  loadSummary,
  saveSummary,
  getChatMeta,
} from "@/lib/storage"
import { authenticateUser } from "@/lib/auth"
import { rateLimit, RATE_LIMITS, getRequestIdentifier } from "@/lib/ratelimit"
import { logRequest } from "@/lib/logger"
import { loadMCPTools } from "@/lib/mcp-client"
import { listMCPServers } from "@/lib/mcp-config"

export const maxDuration = 30
const MAX_OUTPUT_TOKENS = 8192
const MAX_CONTEXT_MESSAGES = 20
const SUMMARY_THRESHOLD = 30
const RECENT_KEEP_COUNT = 10
const SUMMARY_MAX_TOKENS = 500

export async function POST(req: Request) {
  const startTime = Date.now()

  // ── 模块 1：认证 ─────────────────────────────────────────────
  const user = await authenticateUser(req)
  const userId = user?.id

  // ── 模块 2：速率限制 ──────────────────────────────────────────
  const identifier = getRequestIdentifier(req, userId)
  const rl = rateLimit(
    identifier,
    RATE_LIMITS.chat.limit,
    RATE_LIMITS.chat.windowMs
  )
  if (!rl.success) {
    return Response.json(
      { error: "今日请求次数已达上限，请明天再试。" },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))
          ),
        },
      }
    )
  }

  // ── 解析请求体 ────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const model = (body as { model?: unknown })?.model
  let modelId = typeof model === "string" ? model : DEFAULT_MODEL
  if (!isModelAllowed(modelId)) {
    return Response.json(
      { error: `Model ${modelId} is not available.` },
      { status: 400 }
    )
  }

  const chatId = (body as { id?: unknown })?.id
  const chatIdStr = typeof chatId === "string" ? chatId : undefined

  // ── 模块 7 + 模块 3：工具集（基础工具 + MCP 动态工具）──────────
  const tools = getTools(modelId, userId)
  try {
    const mcpConfigs = await listMCPServers()
    if (mcpConfigs.some((c) => c.enabled)) {
      const mcpTools = (await loadMCPTools(mcpConfigs)) as Record<
        string,
        unknown
      >
      if (Object.keys(mcpTools).length > 0) {
        Object.assign(tools, mcpTools)
      }
    }
  } catch {
    // MCP 加载失败不影响主流程
  }

  // ── 消息校验 ──────────────────────────────────────────────────
  let messages: ChatUIMessage[]
  try {
    const validated = await validateUIMessages<ChatUIMessage>({
      messages: (body as { messages?: unknown })?.messages,
      tools: tools as Parameters<typeof validateUIMessages>[0]["tools"],
    })
    messages = validated
  } catch {
    return Response.json({ error: "Invalid messages." }, { status: 400 })
  }

  // 抽取「首条用户消息文本」用于 Agent 步骤画像（planSteps）
  const firstUserMsg = messages.find((m) => (m as { role: string }).role === "user")
  const firstUserText: string | undefined = (() => {
    if (!firstUserMsg) return undefined
    const parts = (firstUserMsg as { parts?: Array<{ type?: string; text?: string }> }).parts ?? []
    return parts
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("") || undefined
  })()

  // ── Phase 2：上下文窗口管理（裁剪 + 摘要）─────────────────────
  let modelMessages = await convertToModelMessages(messages)
  // Fix: 规范化 content 中的 file/image data URL，避免被错误包装为 { type: "url", url: "data:..." }
  modelMessages = normalizeModelMessageContent(modelMessages)

  // Fix: Anthropic/Claude 当前通过 Gateway 发送含图片/文件的消息时会触发
  // `code-execution-web-tools-2026-02-09` beta header 冲突导致 HTTP 500。
  // 检测到此组合时自动切换到支持视觉的 GPT 5.6 Terra，保证用户无感知地获得正常响应。
  const hasVisualParts = modelMessages.some(
    (m) =>
      Array.isArray((m as { content?: unknown }).content) &&
      ((m as { content: Array<{ type: string; mediaType?: string }> }).content.some(
        (p) =>
          p.type === "image" ||
          (p.type === "file" && p.mediaType?.startsWith("image/"))
      ) ||
        (m as { content: Array<{ type: string; data?: { type?: string; url?: unknown } }> }).content.some(
          (p) =>
            p.type === "file" &&
            p.data?.type === "url" &&
            typeof p.data.url === "string" &&
            p.data.url.startsWith("data:image/")
        ) ||
        (m as { content: Array<{ type: string; data?: { type?: string; data?: unknown } }> }).content.some(
          (p) => p.type === "file" && p.data?.type === "data"
        ))
  )
  let visualFallbackNote: string | undefined
  if (modelId.startsWith("anthropic/") && hasVisualParts) {
    const fallback = "openai/gpt-5.6-terra"
    if (isModelAllowed(fallback)) {
      visualFallbackNote = `（系统提示：由于当前选择的 ${modelId} 模型暂不支持图片消息格式，已自动切换到 ${fallback} 处理本次请求。）`
      ;(modelId as string) = fallback
    }
  }

  let summarySystemPrompt: string | undefined

  if (modelMessages.length > SUMMARY_THRESHOLD && chatIdStr) {
    const toSummarizeCount = modelMessages.length - RECENT_KEEP_COUNT
    const recentMessages = modelMessages.slice(-RECENT_KEEP_COUNT)
    const cachedSummary = await loadSummary(chatIdStr, userId)
    let summary: string | null = null

    if (cachedSummary && cachedSummary.summarizedCount >= toSummarizeCount) {
      summary = cachedSummary.summary
    } else {
      const oldMessages = modelMessages.slice(0, toSummarizeCount)
      try {
        const { text: generatedSummary } = await generateText({
          model: modelId,
          maxOutputTokens: SUMMARY_MAX_TOKENS,
          messages: [
            {
              role: "user",
              content: `请用中文简洁地总结以下对话的关键信息，200字以内：\n\n${formatMessagesForSummary(oldMessages)}`,
            },
          ],
        })
        if (generatedSummary) {
          summary = generatedSummary
          await saveSummary(
            chatIdStr,
            summary,
            toSummarizeCount,
            userId
          )
        }
      } catch {
        // 降级为裁剪
      }
    }

    if (summary) {
      summarySystemPrompt = `以下是之前对话的摘要：\n\n${summary}`
      modelMessages = recentMessages
    } else {
      modelMessages = pruneMessages({
        messages: modelMessages,
        reasoning: "none",
        toolCalls: "before-last-5-messages",
        emptyMessages: "remove",
      })
    }
  } else if (modelMessages.length > MAX_CONTEXT_MESSAGES) {
    modelMessages = pruneMessages({
      messages: modelMessages,
      reasoning: "none",
      toolCalls: "before-last-5-messages",
      emptyMessages: "remove",
    })
  }

  // ── 模块 6 + 摘要 + 记忆：构建 system prompt ──────────────────
  const systemParts: string[] = []

  if (visualFallbackNote) {
    systemParts.push(
      `【重要】请在回复的开头（第一行）单独用一行小字或括号告知用户：${visualFallbackNote}，然后再正常回答问题。`
    )
  }

  if (chatIdStr) {
    try {
      const meta = await getChatMeta(chatIdStr, userId)
      if (meta?.systemPrompt) {
        systemParts.push(meta.systemPrompt)
      }
    } catch {
      // 忽略
    }
  }

  if (summarySystemPrompt) {
    systemParts.push(summarySystemPrompt)
  }

  if (userId) {
    try {
      const memories = await loadAllMemories(userId)
      if (memories.length > 0) {
        const profileEntries = memories.filter((m) => m.type === "profile")
        const preferenceEntries = memories.filter((m) => m.type === "preference")
        const lines: string[] = []
        if (profileEntries.length > 0) {
          lines.push("用户信息：")
          for (const e of profileEntries) lines.push(`- ${e.key}: ${e.value}`)
        }
        if (preferenceEntries.length > 0) {
          lines.push("用户偏好：")
          for (const e of preferenceEntries) lines.push(`- ${e.key}: ${e.value}`)
        }
        if (lines.length > 0) {
          systemParts.push(
            `请在回复时参考以下用户信息：\n${lines.join("\n")}`
          )
        }
      }
    } catch {
      // 忽略
    }
  }

  const systemPrompt =
    systemParts.length > 0 ? systemParts.join("\n\n---\n\n") : undefined

  // ── 模块 4：日志（onEnd/onError）──────────────────────────────
  // ── 模块 8：Agent 工作流（prepareStep + 10 步）─────────────────
  const result = streamText({
    model: modelId,
    system: systemPrompt,
    messages: modelMessages,
    tools: tools as any,
    stopWhen: isStepCount(10),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: req.signal,

    // 模块 8：Agent 工作流 — 多步工作流动态策略（委托 lib/agent-steps.ts）
    prepareStep: async (args: any) => {
      const stepNumber = (args?.stepNumber ?? 1) as number
      const steps = (args?.steps ?? []) as unknown[]
      return decidePrepareStep(
        { stepNumber, steps, firstUserMessage: firstUserText },
        tools as any
      ) as any
    },

    onEnd: async ({ usage }) => {
      await logRequest({
        timestamp: startTime,
        chatId: chatIdStr,
        userId,
        model: modelId,
        durationMs: Date.now() - startTime,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        status: "success",
      }).catch(() => {})
    },
  })

  // ── SSE 流返回 + 持久化 ────────────────────────────────────────
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendSources: true,
      originalMessages: messages,
      onEnd: async ({ messages: allMessages }) => {
        if (chatIdStr) {
          try {
            const firstUserMsg = allMessages.find((m) => m.role === "user")
            const title = firstUserMsg
              ? firstUserMsg.parts
                  .filter(
                    (p: any) => (p as { type: string }).type === "text"
                  )
                  .map((p: any) => (p as { text: string }).text)
                  .join("")
                  .slice(0, 30) || "新对话"
              : "新对话"
            await saveChat(chatIdStr, allMessages, title, undefined, undefined, userId)
          } catch {
            // 忽略
          }
        }
      },
      onError: (error) => {
        const errText = String(error || "")
        const isGateway500 = errText.includes("GatewayInternalServerError") || errText.includes("anthropic-beta")
        const isNetworkErr = errText.includes("fetch") || errText.includes("network")
        let msg = "出错了，请稍后重试。"
        if (isGateway500) {
          msg = "模型请求失败：当前模型不支持该格式的图片消息，请尝试切换到其他模型（如 GPT）或仅发送纯文本。"
        } else if (isNetworkErr) {
          msg = "网络连接异常，请检查网络后重试。"
        } else if (errText && errText.length < 200) {
          msg = `请求失败：${errText}`
        }
        logRequest({
          timestamp: startTime,
          chatId: chatIdStr,
          userId,
          model: modelId,
          durationMs: Date.now() - startTime,
          status: "error",
          error: String(error),
        }).catch(() => {})
        return msg
      },
    }),
  })
}

// 辅助函数：格式化消息供摘要使用
function formatMessagesForSummary(
  messages: Array<{ role: string; content: unknown }>
): string {
  return messages
    .map((msg) => {
      const role =
        msg.role === "user"
          ? "用户"
          : msg.role === "assistant"
            ? "助手"
            : "系统"
      let text = ""
      if (typeof msg.content === "string") {
        text = msg.content
      } else if (Array.isArray(msg.content)) {
        text = (msg.content as Array<{ type: string; text?: string }>)
          .filter((part) => part.type === "text" && part.text)
          .map((part) => part.text!)
          .join(" ")
      }
      return `[${role}] ${text}`
    })
    .join("\n")
}

// 辅助函数：规范化 content 中 file/image 部分的 data URL，
// 将 { type: "url", url: "data:..." } STRING 转为 { type: "data", data: "<base64>" }，
// 以避免部分 provider/gateway 解析错误（如 Anthropic anthropic-beta 冲突）。
function normalizeModelMessageContent<T extends Array<{ role: string; content: unknown }>>(
  messages: T
): T {
  return messages.map((msg) => {
    if (
      (msg.role === "user" || msg.role === "assistant") &&
      Array.isArray(msg.content)
    ) {
      const newContent = (msg.content as Array<Record<string, unknown>>).map(
        (part) => {
          if (
            part.type === "file" &&
            typeof part.data === "object" &&
            part.data !== null
          ) {
            const data = part.data as { type: string; url?: unknown }
            if (data.type === "url") {
              const urlStr = String(data.url ?? "")
              const match =
                /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(
                  urlStr
                )
              if (match) {
                const [, rawMediaType, base64Flag, rawPayload] = match
                const mediaType = rawMediaType
                  ? rawMediaType.split(";")[0]
                  : undefined
                const payload =
                  base64Flag
                    ? rawPayload
                    : btoa(unescape(encodeURIComponent(rawPayload)))
                return {
                  ...part,
                  mediaType: (part.mediaType as string) || mediaType,
                  data: { type: "data" as const, data: payload },
                }
              }
            }
          }
          if (
            part.type === "image" &&
            typeof part.image === "string" &&
            part.image.startsWith("data:")
          ) {
            const urlStr = part.image
            const match =
              /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(urlStr)
            if (match) {
              const [, rawMediaType, base64Flag, rawPayload] = match
              const mediaType = rawMediaType
                ? rawMediaType.split(";")[0]
                : undefined
              const payload =
                base64Flag
                  ? rawPayload
                  : btoa(unescape(encodeURIComponent(rawPayload)))
              return {
                ...part,
                mediaType: (part.mediaType as string) || mediaType,
                image: { type: "data" as const, data: payload },
              }
            }
          }
          return part
        }
      )
      return { ...msg, content: newContent }
    }
    return msg
  }) as T
}
