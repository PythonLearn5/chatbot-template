import "server-only"
import { tool } from "ai"
import { z } from "zod"
import { saveMemory, searchMemories } from "@/lib/storage"

// ============================================================================
// save_memory 工具 — 模型自主保存用户信息/偏好/重要事实
// 模型会在对话中发现关键信息时自动调用
// ============================================================================
export const saveMemoryTool = tool({
  description:
    "Save important information about the user for future conversations. Call this when the user shares personal info (name, location, profession), preferences (language, response style), or important facts. Use type 'profile' for who the user is, 'preference' for how they want things done, 'fact' for other important context.",
  inputSchema: z.object({
    type: z
      .enum(["profile", "fact", "preference"])
      .describe("profile = user identity (name, location, profession); preference = how user wants responses; fact = other important context"),
    key: z
      .string()
      .describe("Short identifier, e.g. 'name', 'location', 'language', 'response_style'"),
    value: z
      .string()
      .describe("The value to remember, e.g. '张三', '北京', '中文', '简洁回答'"),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ type, key, value }) => {
    try {
      await saveMemory({ type, key, value })
      return {
        saved: true,
        message: `已记住：${type}/${key} = ${value}`,
      }
    } catch {
      return {
        saved: false,
        message: "记忆保存失败",
      }
    }
  },
})

// ============================================================================
// recall_memory 工具 — 模型主动检索过去的记忆
// 模型在需要回顾历史信息时自动调用
// ============================================================================
export const recallMemoryTool = tool({
  description:
    "Recall memories from previous conversations. Search by keyword to find saved user profiles, preferences, or facts. Use this when you need to check what you know about the user.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("What to remember, e.g. 'name', 'location', 'language preference'"),
  }),
  outputSchema: z.object({
    memories: z.array(
      z.object({
        type: z.string(),
        key: z.string(),
        value: z.string(),
      })
    ),
    count: z.number(),
  }),
  execute: async ({ query }) => {
    try {
      const results = await searchMemories(query)
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
