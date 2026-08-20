# 私有知识库 (RAG)

## 概述

让聊天机器人能检索和回答用户私有文档内容。使用 Supabase pgvector 存储向量嵌入（非文件系统 JSONl），通过 HNSW 索引实现 O(log n) 高效语义检索。文档上传后自动分块、向量化、存储；对话时通过 `knowledge` 工具由模型自主检索。

> 技术方案：Supabase PostgreSQL + pgvector 扩展 + HNSW 索引 + AI SDK `embed()`，无文件系统依赖。

## 技术方案

| 组件 | 方案 |
|------|------|
| 向量库 | Supabase pgvector（`knowledge_vectors` 表，VECTOR(1536)） |
| Embedding | AI SDK `embed({ model: "text-embedding-3-small", value })`，1536 维 |
| 文档分块 | 固定滑动窗口（1000 字 / 200 overlap） |
| 检索 | pgvector 余弦距离 `<=>` + HNSW 索引，top-K = 5 |
| 检索方式 | Supabase RPC `match_knowledge_vectors()` |
| 用户隔离 | `user_id` 过滤（NULL = 匿名空间） |
| 支持格式 | `.txt` / `.md` / `.markdown` |
| 文档大小 | 最大 10MB |
| 外部依赖 | `ai`（AI SDK）、`@supabase/supabase-js` |

## 架构

```
文档上传流程：
┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
│ 上传文件  │───→│ 校验格式   │───→│ 分块      │───→│ 向量化    │
│ .txt/.md │    │ 限制<10MB │    │ 1000字    │    │ embed()  │
└──────────┘    └───────────┘    │ 200 overlap│    └─────┬────┘
                                  └──────────┘          │
                                                         │
                    ┌───────────────────────────────────┴──────────────┐
                    │ 持久化到 Supabase：                               │
                    │  knowledge_docs（文档元数据）                     │
                    │  knowledge_vectors（向量 + chunk 文本）            │
                    │  HNSW 索引（vector_cosine_ops）                    │
                    └──────────────────────────────────────────────────┘

对话检索流程：
┌──────────┐    ┌───────────┐    ┌──────────────────────┐
│ 用户问题  │───→│ 向量化     │───→│ RPC: match_knowledge_  │
│          │    │ embed()   │    │ vectors()              │
└──────────┘    └───────────┘    │  HNSW + 余弦距离排序    │
                                  │  top-5 + user_id 过滤  │
                                  └───────────┬────────────┘
                                              │
                                  ┌──────────▼──────────┐
                                  │ knowledge 工具返回    │
                                  │ { results, count }   │
                                  │  供模型生成回答       │
                                  └─────────────────────┘
```

## 相关文件

```
lib/rag.ts                        # 分块 + embed + 存储 + 检索核心
lib/db.ts                         # Supabase 客户端
app/api/upload/route.ts           # 文档上传 API (FormData)
app/api/knowledge/route.ts        # 文档列表 + 删除 API
tools/knowledge.ts                # knowledge 工具工厂（模型自主调用）
tools/index.ts                    # 工具注册（createKnowledgeTool）
components/knowledge-upload.tsx   # 上传 UI + 已上传列表 + 删除
supabase/migrations/
  001_init_schema.sql             # knowledge_docs + knowledge_vectors 表
  002_match_vectors.sql           # match_knowledge_vectors RPC 函数
```

## 环境变量

```
NEXT_PUBLIC_SUPABASE_URL          # Supabase 项目 URL
SUPABASE_SERVICE_ROLE_KEY         # Supabase service_role key（绕过 RLS）
OPENAI_API_KEY / AI_GATEWAY_API_KEY  # text-embedding-3-small 模型密钥
```

> `text-embedding-3-small` 是 OpenAI 的 embedding 模型，需要 OpenAI key 或 Vercel AI Gateway key 可用。

## Supabase 表结构

```sql
-- 知识库文档表
CREATE TABLE knowledge_docs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  name        TEXT NOT NULL,
  chunk_count INT DEFAULT 0,
  size        INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_knowledge_docs_user_id ON knowledge_docs(user_id);

-- 知识库向量表（pgvector）
CREATE TABLE knowledge_vectors (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  user_id     TEXT,
  chunk       TEXT NOT NULL,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kv_user_id ON knowledge_vectors(user_id);
CREATE INDEX idx_kv_embedding ON knowledge_vectors
  USING hnsw (embedding vector_cosine_ops);
```

**关键设计：**
- `knowledge_vectors.doc_id` 外键 `ON DELETE CASCADE`：删除文档时自动删除关联向量
- HNSW 索引（`vector_cosine_ops`）：提供 O(log n) 近似最近邻检索（非 O(n) 全量扫描）
- `VECTOR(1536)`：与 `text-embedding-3-small` 模型输出维度一致

## match_knowledge_vectors RPC

```sql
-- supabase/migrations/002_match_vectors.sql
CREATE OR REPLACE FUNCTION match_knowledge_vectors(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  filter_user_id text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  doc_id text,
  chunk text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kv.id,
    kv.doc_id,
    kv.chunk,
    1 - (kv.embedding <=> query_embedding) AS similarity
  FROM knowledge_vectors kv
  WHERE filter_user_id IS NULL OR kv.user_id = filter_user_id
  ORDER BY kv.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

- `<=>` 运算符：pgvector 余弦距离（范围 0~2，0 = 最相似）
- `similarity = 1 - distance`：转换为 0~1 相似度分数（1 = 完全相同）
- `filter_user_id`：用户隔离过滤（NULL 时返回所有用户的数据）
- `STABLE` 标记：只读函数，可被查询优化器缓存
- `LIMIT match_count`：限制返回 top-K 条结果

## 实现要点

### 1. 文档分块（固定滑动窗口）

```ts
// lib/rag.ts
export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200
): string[] {
  const clean = text ?? ""
  if (!clean.length) return []
  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length)
    chunks.push(clean.slice(start, end))
    if (end >= clean.length) break
    start += chunkSize - overlap  // 每次前进 800 字（1000 - 200）
  }
  return chunks.length > 0 ? chunks : [clean]
}
```

- 默认 `chunkSize = 1000`，`overlap = 200`
- 每次窗口前进 `chunkSize - overlap = 800` 字
- 空文本返回 `[]`；非空但无法分块时返回 `[text]`

### 2. 向量化与存储（embedAndStore）

```ts
// lib/rag.ts
export async function embedAndStore(
  docId: string,
  docName: string,
  text: string,
  userId?: string
): Promise<KnowledgeDoc> {
  const chunks = chunkText(text)
  const now = new Date().toISOString()

  // 1. upsert 文档记录
  const { data: docRow, error: docError } = await supabase
    .from("knowledge_docs")
    .upsert({
      id: docId,
      user_id: userId ?? null,
      name: docName,
      chunk_count: chunks.length,
      size: Buffer.byteLength(text, "utf-8"),
      created_at: now,
    }, { onConflict: "id" })
    .select()
    .single()

  if (docError) throw docError

  // 2. 删除旧向量（重新上传时）
  await supabase.from("knowledge_vectors").delete().eq("doc_id", docId)

  // 3. 逐块向量化并插入
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const { embedding } = await embed({
      model: "text-embedding-3-small",
      value: chunk,
    })
    await supabase.from("knowledge_vectors").insert({
      id: `${docId}-${i}`,       // 向量 ID = docId-序号
      doc_id: docId,
      user_id: userId ?? null,
      chunk,
      embedding,
      created_at: now,
    })
  }

  return toDoc(docRow)
}
```

**关键设计：**
- 文档记录使用 `upsert`（`onConflict: "id"`），支持重新上传覆盖
- `size` 字段使用 `Buffer.byteLength(text, "utf-8")` 计算字节数（非字符数）
- 重新上传时先删除旧向量（`.delete().eq("doc_id", docId)`）
- 向量 ID 格式：`${docId}-${i}`（如 `doc-1736123456789-a3b4c5-0`）
- 向量化是**逐块顺序执行**（非并行），每个 chunk 调用一次 `embed()`

### 3. 列出文档（listDocs）

```ts
export async function listDocs(userId?: string): Promise<KnowledgeDoc[]> {
  let query = supabase.from("knowledge_docs").select()
  if (userId) {
    query = query.eq("user_id", userId)
  } else {
    query = query.is("user_id", null)  // 匿名空间
  }
  const { data, error } = await query.order("created_at", { ascending: false })

  if (error || !data) return []
  return data.map(toDoc)
}
```

- 按 `created_at DESC` 排序（最新的在前）
- 用户隔离：登录用户查自己的文档，匿名用户查 `user_id IS NULL` 的文档

### 4. 删除文档（deleteDoc）

```ts
export async function deleteDoc(docId: string, userId?: string): Promise<boolean> {
  const { error } = await supabase
    .from("knowledge_docs")
    .delete()
    .eq("id", docId)
    .eq("user_id", userId ?? null)

  return !error
}
```

- 删除文档记录时，`knowledge_vectors` 表中关联的向量通过 `ON DELETE CASCADE` 自动删除
- 用户隔离：`.eq("user_id", userId ?? null)` 确保只能删自己的文档

### 5. 语义检索（retrieve）

```ts
export interface SearchHit {
  id: string
  docId: string
  chunk: string
  score: number
}

export async function retrieve(
  query: string,
  topK = 5,
  userId?: string
): Promise<SearchHit[]> {
  if (!query || !query.trim()) return []

  // 1. 向量化查询
  const { embedding } = await embed({
    model: "text-embedding-3-small",
    value: query,
  })

  // 2. 调用 Supabase RPC 检索
  const { data, error } = await supabase.rpc("match_knowledge_vectors", {
    query_embedding: embedding,
    match_count: topK,
    filter_user_id: userId ?? null,
  })

  if (error || !data) return []

  // 3. 转换结果
  return data.map((row) => ({
    id: row.id,
    docId: row.doc_id,
    chunk: row.chunk,
    score: row.similarity,  // 0~1，1 = 完全相似
  }))
}
```

- 检索通过 Supabase RPC 调用 `match_knowledge_vectors` 函数
- HNSW 索引提供 O(log n) 检索性能（非 O(n) 全量扫描）
- `score` = `similarity`（1 - 余弦距离），范围 0~1

### 6. knowledge 工具（模型自主调用）

```ts
// tools/knowledge.ts
export function createKnowledgeTool(userId?: string) {
  return tool({
    description:
      "Search the private knowledge base for relevant information from uploaded documents. Use this when the user asks about specific documents, uploaded content, or private information that may have been indexed.",
    inputSchema: z.object({
      query: z.string().describe("The search query to find relevant information in the knowledge base"),
    }),
    outputSchema: z.object({
      results: z.array(z.object({
        chunk: z.string(),
        docId: z.string(),
        score: z.number(),
      })),
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
```

- 工具工厂模式：`createKnowledgeTool(userId)` 创建绑定了 `userId` 的工具实例
- 模型在用户询问已上传文档相关内容时**自主调用**此工具
- 返回 `{ results: [{ chunk, docId, score }], count }`
- 检索失败时返回空结果（不抛异常）

### 7. 工具注册

```ts
// tools/index.ts
import { createKnowledgeTool } from "./knowledge"

export function getTools(modelId: string, userId?: string): ToolSet {
  const knowledge = createKnowledgeTool(userId)
  return {
    github_repo, ask_user, weather,
    save_memory, recall_memory,
    knowledge,          // ← RAG 检索工具
    web_search: webSearch,
    code_run: codeRun,
  } as ToolSet
}
```

- `knowledge` 工具在 `getTools()` 中注册，绑定当前用户的 `userId`
- 聊天路由调用 `getTools(modelId, userId)` 获取工具集

### 8. 上传 API 校验

```ts
// app/api/upload/route.ts
export async function POST(req: Request) {
  // 认证 + 速率限制
  const user = await authenticateUser(req)

  const formData = await req.formData()
  const file = formData.get("file") as File | null

  // 格式白名单
  const ALLOWED_MIME = new Set([
    "text/plain", "text/markdown", "text/x-markdown", "application/markdown",
  ])
  const ALLOWED_EXT = [".txt", ".md", ".markdown"]

  const extOk = ALLOWED_EXT.some((e) => filename.toLowerCase().endsWith(e))
  const mimeOk = ALLOWED_MIME.has(file.type)
  if (!extOk && !mimeOk) {
    // 针对 PDF / Word 给出明确提示
    return NextResponse.json(
      { error: `不支持的文件格式。PDF/Word 请先转成 .md 或 .txt。` },
      { status: 415 }
    )
  }

  // 大小限制：10MB
  const MAX_BYTES = 10 * 1024 * 1024
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large（最大 10MB）" },
      { status: 413 }
    )
  }

  // 读取内容并向量化
  const text = await file.text()
  const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const doc = await embedAndStore(docId, file.name, text, user?.id)

  return NextResponse.json({
    id: doc.id, name: doc.name, chunkCount: doc.chunkCount,
  })
}
```

**上传校验规则：**
- 允许 MIME：`text/plain`、`text/markdown`、`text/x-markdown`、`application/markdown`
- 允许扩展名：`.txt`、`.md`、`.markdown`
- 满足任一条件即可（MIME 或扩展名）
- 最大 10MB
- 文档 ID 格式：`doc-{timestamp}-{random6}`
- PDF / Word 文件会给出明确转换提示

## 存储与隔离

| 场景 | 存储位置 | 隔离方式 |
|------|---------|---------|
| 文档元数据 | `knowledge_docs` 表 | `user_id` 字段（NULL = 匿名） |
| 向量 + chunk 文本 | `knowledge_vectors` 表 | `user_id` 字段（NULL = 匿名） |
| 检索 | `match_knowledge_vectors` RPC | `filter_user_id` 参数 |
| 删除 | `knowledge_docs` DELETE | `ON DELETE CASCADE` 自动删向量 |

**用户隔离策略：**
- 登录用户：所有操作带 `user_id = userId`
- 匿名用户：所有操作带 `user_id IS NULL`（共享匿名空间）
- 检索时：`filter_user_id` 传入 `userId` 或 `null`

## 注意事项

- `text-embedding-3-small` 是 OpenAI 的 embedding 模型，**需要 OpenAI key 或 Vercel AI Gateway key 可用**；否则 embedding 调用会 5xx 报错。
- 向量化是逐块顺序执行，大文档（如 1MB 文本 → ~1000 个 chunk）上传会比较慢。
- 没有增量分块/重建，修改文件需要删除再上传。
- `knowledge_vectors` 通过 HNSW 索引实现 O(log n) 检索，适合中等规模知识库。
- `embedAndStore` 中向量插入出错会抛异常并中断；但已插入的向量不会回滚（无事务包裹）。
