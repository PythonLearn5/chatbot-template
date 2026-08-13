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
  isStepCount,
  pruneMessages,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai"

import { DEFAULT_MODEL, isModelAllowed } from "@/lib/models"
import { getTools, type ChatUIMessage } from "@/tools"
import { saveChat, loadAllMemories } from "@/lib/storage"

// Next.js Edge / Serverless 函数最大执行时间（秒）
export const maxDuration = 30

// 单次请求最大输出 token 数
const MAX_OUTPUT_TOKENS = 8192

// Phase 2: 上下文窗口管理 — 最多保留最近 N 条消息
const MAX_CONTEXT_MESSAGES = 20

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

  // ── 第 5 步：Phase 2 — 上下文窗口管理 ────────────────────────────
  // 转换为模型消息格式，然后裁剪到最近 MAX_CONTEXT_MESSAGES 条
  // 移除旧的推理过程和工具调用细节，只保留最近几轮的工具调用
  let modelMessages = await convertToModelMessages(messages)
  if (modelMessages.length > MAX_CONTEXT_MESSAGES) {
    modelMessages = pruneMessages({
      messages: modelMessages,
      reasoning: "none",
      toolCalls: "before-last-5-messages",
      emptyMessages: "remove",
    })
  }

  // ── 第 6 步：Phase 4 — 长期记忆注入 system prompt ────────────────
  // 从存储加载用户画像和偏好，注入到 system 消息中
  let systemPrompt: string | undefined
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
          systemPrompt = `以下是之前对话中了解到的用户信息，请在回复时参考：\n${lines.join("\n")}`
        }
      }
    } catch {
      // 记忆加载失败不影响主流程
    }
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
