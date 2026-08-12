// ============================================================================
// AI SDK 核心工具函数
// convertToModelMessages: 将前端 UI 消息格式转换为模型能理解的格式
// createUIMessageStreamResponse: 将流包装为 HTTP SSE 响应返回给浏览器
// isStepCount: 工具调用步数限制器（防止模型无限调用工具）
// streamText: 核心函数——调用 LLM 进行流式文本生成
// toUIMessageStream: 将模型原始流转换为前端可消费的 UI 消息流
// validateUIMessages: 校验前端发来的消息格式是否合法（防止恶意构造）
// ============================================================================
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  validateUIMessages,
} from "ai"

// 模型配置：DEFAULT_MODEL 是默认模型 ID，isModelAllowed 校验模型是否在白名单中
import { DEFAULT_MODEL, isModelAllowed } from "@/lib/models"
// 工具系统：getTools 根据模型 ID 返回该模型可用的工具集，ChatUIMessage 是消息类型
import { getTools, type ChatUIMessage } from "@/tools"

// Next.js Edge / Serverless 函数最大执行时间（秒）
// 超时后请求会被中止，流式响应也会断开
export const maxDuration = 30

// 单次请求最大输出 token 数，防止模型生成过长回复消耗过多额度
const MAX_OUTPUT_TOKENS = 8192

// ============================================================================
// POST 处理函数——处理所有聊天请求
//
// 安全提示：此端点是公开的、无认证的，每次请求都会消耗 AI Gateway 额度。
// 上线前需要添加：速率限制（Vercel WAF / @upstash/ratelimit）、用户认证、
// AI Gateway 消费上限。详见 README "Security" 章节。
// ============================================================================
export async function POST(req: Request) {
  // ── 第 1 步：解析请求体 ──────────────────────────────────────────
  // 前端 useChat 发来的 body 格式: { model: "anthropic/claude-sonnet-5", messages: [...] }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    // JSON 解析失败，说明请求格式不对
    return Response.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  // ── 第 2 步：提取并校验模型 ID ──────────────────────────────────
  // 从 body 中取出 model 字段，如果没传则用默认模型
  const model = (body as { model?: unknown })?.model
  const modelId = typeof model === "string" ? model : DEFAULT_MODEL

  // 校验模型是否在白名单中（lib/models.ts 的 MODELS 数组）
  // 防止用户传入未授权的模型 ID
  if (!isModelAllowed(modelId)) {
    return Response.json(
      { error: `Model ${modelId} is not available.` },
      { status: 400 }
    )
  }

  // ── 第 3 步：获取该模型可用的工具集 ──────────────────────────────
  // 不同模型可用工具不同：web_search 仅 openai/ 和 anthropic/ 有
  // github_repo、ask_user、weather 对所有模型可用
  const tools = getTools(modelId)

  // ── 第 4 步：校验消息格式 ────────────────────────────────────────
  // 前端发来的 messages 数组可能包含文本、工具调用、工具结果等多种 part
  // validateUIMessages 会用 Zod schema 逐条校验，防止恶意构造的 tool part
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

  // ── 第 5 步：调用 AI Gateway 进行流式生成 ────────────────────────
  // streamText 是核心：
  //   - model: 模型 ID（如 "anthropic/claude-sonnet-5"），AI Gateway 会路由到对应厂商
  //   - messages: 经过转换的模型消息（convertToModelMessages 把 UI 消息转为 API 格式）
  //   - tools: 工具集，模型可自主决定是否调用
  //   - stopWhen: isStepCount(5) → 模型调用工具后会把结果拿回来继续生成，
  //               最多循环 5 步防止无限消耗
  //   - maxOutputTokens: 单次最大输出 8192 token
  //   - abortSignal: 绑定请求信号，客户端断开连接时自动中止生成
  //
  // 工具调用流程（模型自主决策）：
  //   用户消息 → 模型判断需要工具 → 返回 tool-call → 后端执行 execute()
  //   → 结果返回模型 → 模型基于结果继续生成 → 可能再次调用工具
  //   → 直到不再需要工具或达到 5 步上限 → 输出最终文本
  const result = streamText({
    model: modelId,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(5),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: req.signal,
  })

  // ── 第 6 步：返回 SSE 流式响应 ───────────────────────────────────
  // toUIMessageStream: 将模型原始流转换为前端 useChat 能消费的 UI 消息流
  //   - sendSources: true → 发送 web_search 的来源 URL，前端渲染为引用链接
  //   - onError: 流出错时返回的兜底消息（不暴露内部错误给用户）
  // createUIMessageStreamResponse: 包装为标准 HTTP 响应（Content-Type: text/event-stream）
  //
  // 前端 useChat 接收这个 SSE 流后：
  //   1. tool-call part → 渲染对应工具组件（如 <WeatherPart />）
  //   2. text part → 流式追加渲染 Markdown（边生成边显示）
  //   3. source-url part → 渲染搜索来源引用
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendSources: true,
      onError: () => "Something went wrong. Please try again.",
    }),
  })
}
