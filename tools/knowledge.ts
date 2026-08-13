import "server-only"
import { tool } from "ai"
import { z } from "zod"
import { retrieve } from "@/lib/rag"

// ============================================================================
// knowledge 工具工厂 — 模型自主检索私有知识库
// 模型在用户询问已上传文档相关内容时自动调用
// ============================================================================
export function createKnowledgeTool(userId?: string) {
  return tool({
    description:
      "Search the private knowledge base for relevant information from uploaded documents. Use this when the user asks about specific documents, uploaded content, or private information that may have been indexed.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The search query to find relevant information in the knowledge base"),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          chunk: z.string(),
          docId: z.string(),
          score: z.number(),
        })
      ),
      count: z.number(),
    }),
    execute: async ({ query }) => {
      try {
        const results = await retrieve(query, 5, userId)
        return {
          results: results.map((r) => ({
            chunk: r.chunk,
            docId: r.docId,
            score: r.score,
          })),
          count: results.length,
        }
      } catch {
        return { results: [], count: 0 }
      }
    },
  })
}
