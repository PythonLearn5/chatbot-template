// See https://vercel.com/ai-gateway/models.
export const MODELS = [
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "openai/gpt-5.6-terra", name: "GPT 5.6 Terra" },
  { id: "alibaba/qwen3.8-27b", name: "Qwen 3.8 27B (Free)" },
  { id: "nvidia/nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning (Free)" },
  { id: "poolside/laguna-s-2.1-free", name: "Laguna S 2.1 (Free)" },
  { id: "inclusionai/ling-3.0-tiny-free", name: "Ling 3.0 Tiny (Free)" },
]

export const DEFAULT_MODEL = MODELS[0].id

export interface GatewayModel {
  id: string
  name: string
}

export function isModelAllowed(id: string) {
  return MODELS.some((model) => model.id === id)
}
