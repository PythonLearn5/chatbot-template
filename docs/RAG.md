# 私有知识库 (RAG)

## 目标

让聊天机器人能检索和回答用户私有文档内容，实现：
- 文档上传与自动分块
- 向量化存储（Embedding）
- 对话时语义检索相关内容
- 检索结果注入 system prompt 作为「相关上下文」

## 技术方案

| 组件 | 方案 |
|------|------|
| 向量库 | 文件系统 JSONL（本地零依赖，`.data/knowledge/vectors/{docId}.jsonl`） |
| Embedding | AI SDK `embed({ model: "text-embedding-3-small" })`，走 Vercel AI Gateway |
| 文档分块 | 固定长度滑动窗口（1000 字 / 200 overlap） |
| 检索 | 余弦相似度 top-K = 5 |
| 支持格式 | `.txt` / `.md`（PDF/Word 请先另存为 `.md` 或 `.txt` 再上传） |

## 架构

```
文档上传流程：
┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
│ 上传文件  │───→│ 校验格式   │───→│ 分块      │───→│ 向量化    │
│ .txt/.md │    │ 限制<10MB │    │ 1000字    │    │ embed()  │
└──────────┘    └───────────┘    └──────────┘    └─────┬────┘
                                                       │
                    ┌───────────────────────────────────┴──────────────┐
                    │ 持久化到：                                        │
                    │  .data/knowledge/docs/{docId}.txt                │
                    │  .data/knowledge/vectors/{docId}.jsonl           │
                    │  .data/users/{hash}/knowledge/...  (登录后)      │
                    └──────────────────────────────────────────────────┘

对话检索流程：
┌──────────┐    ┌───────────┐    ┌──────────┐    ┌─────────────────────┐
│ 用户问题  │───→│ 向量化     │───→│ 余弦检索  │───→│ Top-5 块注入到       │
│          │    │ embed()   │    │ 所有文件  │    │ system prompt 末尾    │
└──────────┘    └───────────┘    └──────────┘    └─────────────────────┘
```

## 修改 / 新增文件

```
lib/
  rag.ts                     # 分块 + embed + 存储 + 检索 (含 chunkText 合并)
app/api/
  upload/route.ts            # 文档上传 API (FormData)
  knowledge/route.ts         # 文档列表 + 删除 API
tools/
  knowledge.ts               # RAG 工具（模型自主调用 retrieve）
components/
  knowledge-upload.tsx       # 上传 UI + 已上传列表 + 删除
  parts/knowledge-part.tsx   # 模型调用 knowledge 工具时的渲染
```

## 依赖

> 无额外依赖。使用 AI SDK 内置 `embed()`。

## 环境变量

> 不需要单独配置；`OPENAI_API_KEY` 或 `AI_GATEWAY_API_KEY` 已经覆盖 `text-embedding-3-small`。

## 实现要点

### 1. 分块（滑动窗口）

```ts
// lib/rag.ts
export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200,
): string[] {
  if (!text) return []
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end))
    start += chunkSize - overlap
    if (start >= text.length) break
  }
  return chunks
}
```

### 2. 向量化与存储

```ts
// lib/rag.ts
export async function embedAndStore(
  docId: string,
  filename: string,
  text: string,
  userId?: string,
) {
  const chunks = chunkText(text)
  const vectors: VectorEntry[] = []
  for (let i = 0; i < chunks.length; i++) {
    const { embedding } = await embed({
      model: "text-embedding-3-small",
      value: chunks[i],
    })
    vectors.push({ docId, chunkIndex: i, chunk: chunks[i], embedding })
  }
  await saveDoc(docId, filename, text, userId)
  await saveVectors(docId, vectors, userId)
  return { docId, filename, chunks: chunks.length }
}

export async function retrieve(query: string, topK = 5, userId?: string) {
  const { embedding: q } = await embed({
    model: "text-embedding-3-small", value: query,
  })
  const all = await loadAllVectors(userId)
  return all
    .map((v) => ({ ...v, score: cosine(q, v.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}
```

### 3. 注入到 system prompt

```ts
// app/api/chat/route.ts
if (modelMessages.length > 0) {
  const lastUser = [...modelMessages].reverse().find((m) => m.role === "user")
  const lastUserText = (lastUser?.content as unknown[])?.find?.(
    (p) => (p as any)?.type === "text"
  )?.text
  if (lastUserText) {
    const hits = await retrieve(lastUserText, 5, userId)
    if (hits.length) {
      systemParts.push(
        `## 相关上下文（来自私有知识库，仅参考）\n` +
        hits.map((h, i) =>
          `[${i + 1}] ${h.docId}:${h.chunkIndex}\n${h.chunk}`
        ).join("\n\n")
      )
    }
  }
}
```

### 4. knowledge 工具（模型自主调用）

```ts
// tools/knowledge.ts
export const knowledge = tool({
  description: "Search private knowledge base. Use when user asks about uploaded documents.",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const hits = await retrieve(query, 5, runtimeUserId)
    return {
      results: hits.map((h) => ({
        docId: h.docId,
        chunkIndex: h.chunkIndex,
        snippet: h.chunk.slice(0, 400),
        score: h.score,
      })),
      count: hits.length,
    }
  },
})
```

### 5. 上传 API 校验

```ts
// app/api/upload/route.ts
const ALLOWED = ["text/plain", "text/markdown", "text/x-markdown"]
const ALLOWED_EXT = [".txt", ".md", ".markdown"]
const MAX_SIZE = 10 * 1024 * 1024  // 10 MB

if (!ALLOWED.includes(file.type) && !ALLOWED_EXT.some((e) => filename.toLowerCase().endsWith(e))) {
  return Response.json(
    { error: "仅支持 .txt / .md 格式；PDF / Word 请先另存为 .md 或 .txt 后再上传。" },
    { status: 415 }
  )
}
if (file.size > MAX_SIZE) {
  return Response.json({ error: "文件过大，请上传小于 10MB 的文件。" }, { status: 413 })
}
```

## 存储路径（按用户隔离）

| 场景 | 路径 |
|------|------|
| 匿名上传文档内容 | `.data/knowledge/docs/{docId}.txt` |
| 匿名上传向量 | `.data/knowledge/vectors/{docId}.jsonl` |
| 登录用户文档 | `.data/users/{sha256(userId)}/knowledge/docs/{docId}.txt` |
| 登录用户向量 | `.data/users/{sha256(userId)}/knowledge/vectors/{docId}.jsonl` |
| 匿名元数据（列表） | `.data/knowledge/list.json` |
| 登录用户元数据 | `.data/users/{sha256(userId)}/knowledge/list.json` |

## 注意事项

- `text-embedding-3-small` 是 OpenAI 的 embedding 模型，**需要 OpenAI key 或 Vercel AI Gateway key 可用**；否则 5xx 报错。
- 检索是「全量扫」+ 余弦排序（本地小数据 OK，>100 份文档要换向量数据库 pgvector / pinecone 等）。
- 目前没有增量分块/重建，修改文件需要删除再上传。
