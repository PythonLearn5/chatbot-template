// See https://vercel.com/ai-gateway/models.
export const MODELS = ["anthropic/claude-sonnet-5", "openai/gpt-5.6-terra"]

export const DEFAULT_MODEL = MODELS[0]

export interface GatewayModel {
  id: string
  name: string
}

export function isModelAllowed(id: string) {
  return MODELS.includes(id)
}
