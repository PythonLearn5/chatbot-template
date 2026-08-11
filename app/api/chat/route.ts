import { GatewayError } from "@ai-sdk/gateway"
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai"

import { DEFAULT_MODEL, isModelAllowed } from "@/lib/models"
import { getTools, type ChatUIMessage } from "@/lib/tools"

export async function POST(req: Request) {
  const { messages, model }: { messages: ChatUIMessage[]; model?: string } =
    await req.json()

  const modelId = model ?? DEFAULT_MODEL

  if (!isModelAllowed(modelId)) {
    return Response.json(
      { error: `Model ${modelId} is not available.` },
      { status: 400 }
    )
  }

  const result = streamText({
    model: modelId,
    messages: await convertToModelMessages(messages),
    tools: getTools(modelId),
    stopWhen: isStepCount(5),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendSources: true,
      onError: (error) =>
        GatewayError.isInstance(error)
          ? error.message
          : "Something went wrong. Please try again.",
    }),
  })
}
