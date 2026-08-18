import { type InferUITools, type UIDataTypes, type UIMessage } from "ai"
import { tool, type ToolSet } from "ai"
import { z } from "zod"

import { askUser } from "./ask_user"
import { githubRepo } from "./github_repo"
import { getWebSearch } from "./web_search"
import { weather } from "./weather"
import { saveMemoryTool, recallMemoryTool } from "./memory"
import { createKnowledgeTool } from "./knowledge"
import { codeRun } from "./code-run"
import { saveMemory, searchMemories } from "@/lib/storage"

// scoped 工具工厂：memory 工具按 userId 隔离
function scopedMemoryTools(userId?: string) {
  const save_memory = tool({
    description: saveMemoryTool.description,
    inputSchema: z.object({
      type: z.enum(["profile", "fact", "preference"]),
      key: z.string(),
      value: z.string(),
    }),
    outputSchema: z.object({ saved: z.boolean() }),
    execute: async ({ type, key, value }) => {
      try {
        await saveMemory({ type, key, value }, userId)
        return { saved: true }
      } catch {
        return { saved: false }
      }
    },
  })

  const recall_memory = tool({
    description: recallMemoryTool.description,
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.object({
      memories: z.array(
        z.object({ type: z.string(), key: z.string(), value: z.string() })
      ),
      count: z.number(),
    }),
    execute: async ({ query }) => {
      try {
        const results = await searchMemories(query, userId)
        return {
          memories: results.map((m) => ({
            type: m.type,
            key: m.key,
            value: m.value,
          })),
          count: results.length,
        }
      } catch {
        return { memories: [], count: 0 }
      }
    },
  })

  return { save_memory, recall_memory }
}

const FALLBACK_WEB_SEARCH = tool({
  description: "Web search not available for this model.",
  inputSchema: z.object({ query: z.string() }),
  execute: async () => ({ results: [], count: 0 }),
})

export function getTools(modelId: string, userId?: string): ToolSet {
  const { save_memory, recall_memory } = scopedMemoryTools(userId)
  const webSearch = getWebSearch(modelId) ?? FALLBACK_WEB_SEARCH
  const knowledge = createKnowledgeTool(userId)
  return {
    github_repo: githubRepo,
    ask_user: askUser,
    weather,
    save_memory,
    recall_memory,
    knowledge,
    web_search: webSearch,
    code_run: codeRun,
  } as ToolSet
}

type ChatTools = {
  github_repo: any
  ask_user: any
  weather: any
  save_memory: any
  recall_memory: any
  knowledge: any
  web_search: any
} & Record<string, any>

type AnyDict = Record<string, any>
type CommonToolPart = {
  type: string
  toolCallId: string
  toolName?: string
  title?: string
  state:
    | "input-streaming"
    | "input-available"
    | "output-streaming"
    | "output-available"
    | "output-error"
  input?: AnyDict
  output?: AnyDict
  errorText?: string
  runtime?: unknown
  addResult?: unknown
  [k: string]: any
}

export type ChatUIMessage = any
export type ChatMessagePart = any

export type TextMessagePart = Extract<any, any>
export type SourceUrlPart = any

export type GithubRepoToolPart = CommonToolPart
export type AskUserToolPart = CommonToolPart
export type WebSearchToolPart = CommonToolPart
export type WeatherToolPart = CommonToolPart
export type SaveMemoryToolPart = CommonToolPart
export type RecallMemoryToolPart = CommonToolPart
export type KnowledgeToolPart = CommonToolPart
