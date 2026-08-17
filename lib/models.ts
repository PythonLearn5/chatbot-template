// See https://vercel.com/ai-gateway/models.
// 价格参考: https://vercel.com/ai-gateway/models (2026-08)
export const MODELS = [
  // ── 旗舰模型 ──────────────────────────────────────────────
  {
    id: "anthropic/claude-opus-5",
    name: "Claude Opus 5",
    description: "Anthropic 最强旗舰 · $5/$25",
  },
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    description: "Anthropic 性能旗舰 · $2/$10",
  },
  {
    id: "openai/gpt-5.6-sol",
    name: "GPT 5.6 Sol",
    description: "OpenAI 旗舰 · $5/$30",
  },
  {
    id: "openai/gpt-5.6-terra",
    name: "GPT 5.6 Terra",
    description: "OpenAI 均衡版 · $2/$12",
  },
  {
    id: "xai/grok-4.6",
    name: "Grok 4.6",
    description: "xAI 最新旗舰 · $2/$6",
  },
  {
    id: "google/gemini-3.7-flash",
    name: "Gemini 3.7 Flash",
    description: "Google 最新 · $1.50/$7.50",
  },

  // ── 中端/高性价比 ────────────────────────────────────────
  {
    id: "openai/gpt-5.6-luna",
    name: "GPT 5.6 Luna",
    description: "OpenAI 经济版 · $0.20/$1.20",
  },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    name: "DeepSeek V4 Pro",
    description: "DeepSeek 最新 · $0.60/$1.98",
  },
  {
    id: "google/gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash Lite",
    description: "Google 轻量 · $0.30/$2.50",
  },
  {
    id: "alibaba/qwen3.7-flash",
    name: "Qwen 3.7 Flash",
    description: "阿里云高性价比 · $0.03/$0.13",
  },
  {
    id: "alibaba/qwen3.8-max",
    name: "Qwen 3.8 Max",
    description: "阿里云旗舰 · $2/$6",
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    description: "月之暗面旗舰 · $3/$15",
  },

  // ── 免费模型（Input/Output 均 Free）──────────────────────
  {
    id: "alibaba/qwen3.8-27b",
    name: "Qwen 3.8 27B (Free)",
    description: "阿里云开源 · 免费",
  },
  {
    id: "nvidia/nemotron-3.5-lightning",
    name: "Nemotron 3.5 Lightning (Free)",
    description: "NVIDIA 开源 · 免费",
  },
  {
    id: "poolside/laguna-s-2.1-free",
    name: "Laguna S 2.1 (Free)",
    description: "Poolside 开源 · 免费",
  },
  {
    id: "inclusionai/ling-3.0-tiny-free",
    name: "Ling 3.0 Tiny (Free)",
    description: "InclusionAI · 免费",
  },
  {
    id: "inclusionai/ling-3.0-flash-free",
    name: "Ling 3.0 Flash (Free)",
    description: "InclusionAI · 免费",
  },
]

export const DEFAULT_MODEL = MODELS[0].id

export interface GatewayModel {
  id: string
  name: string
  description?: string
}

export function isModelAllowed(id: string) {
  return MODELS.some((model) => model.id === id)
}
