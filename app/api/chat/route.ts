// ============================================================================
// AI SDK 核心工具函数
// convertToModelMessages: 将前端 UI 消息格式转换为模型能理解的格式
// createUIMessageStreamResponse: 将流包装为 HTTP SSE 响应返回给浏览器
// isStepCount: 工具调用步数限制器（防止模型无限调用工具）
// streamText: 核心函数——调用 LLM 进行流式文本生成
// toUIMessageStream: 将模型原始流转换为前端可消费的 UI 消息流
// validateUIMessages: 校验前端发来的消息格式是否合法（防止恶意构造）
// pruneMessages: 裁剪历史消息，控制发送给模型的上下文窗口大小
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
import { getTools, type ChatUIMessage } from "@/tools"
import { saveChat, loadAllMemories, loadSummary, saveSummary } from "@/lib/storage"

// Next.js Edge / Serverless 函数最大执行时间（秒）
export const maxDuration = 30

// 单次请求最大输出 token 数
const MAX_OUTPUT_TOKENS = 8192

// Phase 2: 上下文窗口管理 — 最多保留最近 N 条消息
const MAX_CONTEXT_MESSAGES = 20

// Phase 2 增强: 摘要生成 — 超过此阈值时对旧消息生成摘要
const SUMMARY_THRESHOLD = 30        // 超过 30 条消息时触发摘要
const RECENT_KEEP_COUNT = 10        // 摘要后保留最近 10 条完整消息
const SUMMARY_MAX_TOKENS = 500       // 摘要最大 token 数

// ============================================================================
// POST 处理函数——处理所有聊天请求
// ============================================================================
export async function POST(req: Request) {
  // ── 第 1 步：解析请求体 ──────────────────────────────────────────
  // body: { model, messages, id(会话ID) }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  // ── 第 2 步：提取并校验模型 ID ──────────────────────────────────
  const model = (body as { model?: unknown })?.model
  const modelId = typeof model === "string" ? model : DEFAULT_MODEL

  if (!isModelAllowed(modelId)) {
    return Response.json(
      { error: `Model ${modelId} is not available.` },
      { status: 400 }
    )
  }

  // 提取会话 ID（Phase 1: 持久化用）
  const chatId = (body as { id?: unknown })?.id
  const chatIdStr = typeof chatId === "string" ? chatId : undefined

  // ── 第 3 步：获取该模型可用的工具集 ──────────────────────────────
  const tools = getTools(modelId)

  // ── 第 4 步：校验消息格式 ────────────────────────────────────────
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

  // ── 第 5 步：Phase 2 — 上下文窗口管理（含摘要生成增强）────────────
  // 策略：
  //   1. 消息 <= 20 条：直接裁剪后发送
  //   2. 消息 > 30 条：对旧消息生成摘要（带缓存），发送 [摘要 + 最近10条]
  //
  // 摘要缓存：已摘要的消息数缓存在 .data/chats/{chatId}.summary.json
  // 新增消息超过 RECENT_KEEP_COUNT 时才重新生成摘要，避免每次请求都调用模型
  let modelMessages = await convertToModelMessages(messages)
  let summarySystemPrompt: string | undefined

  if (modelMessages.length > SUMMARY_THRESHOLD && chatIdStr) {
    // ── 摘要模式：消息过多，生成旧消息摘要 ──
    const toSummarizeCount = modelMessages.length - RECENT_KEEP_COUNT
    const recentMessages = modelMessages.slice(-RECENT_KEEP_COUNT)

    // 检查缓存的摘要是否仍然有效
    const cachedSummary = await loadSummary(chatIdStr)
    let summary: string | null = null

    if (cachedSummary && cachedSummary.summarizedCount >= toSummarizeCount) {
      // 缓存有效，直接使用
      summary = cachedSummary.summary
    } else {
      // 缓存过期或不存在，重新生成摘要
      const oldMessages = modelMessages.slice(0, toSummarizeCount)
      try {
        const { text: generatedSummary } = await generateText({
          model: modelId,
          maxOutputTokens: SUMMARY_MAX_TOKENS,
          messages: [
            {
              role: "user",
              content: `请用中文简洁地总结以下对话的关键信息（包括讨论的主题、重要结论、用户的需求等），200字以内：\n\n${formatMessagesForSummary(oldMessages)}`,
            },
          ],
        })
        if (generatedSummary) {
          summary = generatedSummary
          // 缓存摘要
          await saveSummary(chatIdStr, summary, toSummarizeCount)
        }
      } catch {
        // 摘要生成失败，降级为简单裁剪
      }
    }

    if (summary) {
      // 使用摘要 + 最近消息
      summarySystemPrompt = `以下是之前对话的摘要，请结合摘要和最新消息进行回复：\n\n${summary}`
      modelMessages = recentMessages
    } else {
      // 摘要失败，降级为 pruneMessages 裁剪
      modelMessages = pruneMessages({
        messages: modelMessages,
        reasoning: "none",
        toolCalls: "before-last-5-messages",
        emptyMessages: "remove",
      })
    }
  } else if (modelMessages.length > MAX_CONTEXT_MESSAGES) {
    // ── 普通裁剪模式：消息稍多但未达摘要阈值 ──
    modelMessages = pruneMessages({
      messages: modelMessages,
      reasoning: "none",
      toolCalls: "before-last-5-messages",
      emptyMessages: "remove",
    })
  }

  // ── 第 6 步：Phase 4 — 长期记忆注入 system prompt ────────────────
  // 从存储加载用户画像和偏好，与摘要合并为 system prompt
  let systemPrompt: string | undefined
  const systemParts: string[] = []

  // 加入摘要（如果第 5 步生成了）
  if (summarySystemPrompt) {
    systemParts.push(summarySystemPrompt)
  }

  // 加入用户记忆（画像和偏好）
  if (chatIdStr) {
    try {
      const memories = await loadAllMemories()
      if (memories.length > 0) {
        const profileEntries = memories.filter((m) => m.type === "profile")
        const preferenceEntries = memories.filter((m) => m.type === "preference")

        const lines: string[] = []
        if (profileEntries.length > 0) {
          lines.push("用户信息：")
          for (const e of profileEntries) {
            lines.push(`- ${e.key}: ${e.value}`)
          }
        }
        if (preferenceEntries.length > 0) {
          lines.push("用户偏好：")
          for (const e of preferenceEntries) {
            lines.push(`- ${e.key}: ${e.value}`)
          }
        }
        if (lines.length > 0) {
          systemParts.push(`以下是之前对话中了解到的用户信息，请在回复时参考：\n${lines.join("\n")}`)
        }
      }
    } catch {
      // 记忆加载失败不影响主流程
    }
  }

  if (systemParts.length > 0) {
    systemPrompt = systemParts.join("\n\n---\n\n")
  }

  // ── 第 7 步：调用 AI Gateway 进行流式生成 ────────────────────────
  const result = streamText({
    model: modelId,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: isStepCount(5),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: req.signal,
  })

  // ── 第 8 步：Phase 1 — 返回 SSE 流，结束时持久化 ─────────────────
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendSources: true,
      originalMessages: messages,
      onEnd: async ({ messages: allMessages }) => {
        // 流结束时持久化全部消息到存储
        if (chatIdStr) {
          try {
            // 生成会话标题（取第一条用户消息前 30 字）
            const firstUserMsg = allMessages.find((m) => m.role === "user")
            const title = firstUserMsg
              ? firstUserMsg.parts
                  .filter((p) => p.type === "text")
                  .map((p) => (p as { text: string }).text)
                  .join("")
                  .slice(0, 30) || "新对话"
              : "新对话"
            await saveChat(chatIdStr, allMessages, title)
          } catch {
            // 持久化失败不影响响应
          }
        }
      },
      onError: () => "Something went wrong. Please try again.",
    }),
  })
}

// ============================================================================
// 辅助函数：将模型消息格式化为纯文本，用于摘要生成的输入
// ============================================================================
function formatMessagesForSummary(messages: Array<{ role: string; content: unknown }>): string {
  return messages
    .map((msg) => {
      const role = msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : "系统"
      // content 可能是字符串或数组（包含 text/tool-call 等 part）
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
