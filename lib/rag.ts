// ============================================================================
// 私有知识库 (RAG) — 文档向量化 + 语义检索
// 向量存储在 Supabase pgvector，检索使用 HNSW 索引
// ============================================================================

import "server-only"
import { embed } from "ai"
import { supabase } from "@/lib/db"

export interface KnowledgeDoc {
  id: string
  name: string
  chunkCount: number
  size: number
  createdAt: number
}

interface DBKnowledgeDoc {
  id: string
  user_id: string | null
  name: string
  chunk_count: number
  size: number
  created_at: string
}

function toDoc(row: DBKnowledgeDoc): KnowledgeDoc {
  return {
    id: row.id,
    name: row.name,
    chunkCount: row.chunk_count,
    size: row.size,
    createdAt: new Date(row.created_at).getTime(),
  }
}

// 文档分块（固定滑动窗口）
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
    start += chunkSize - overlap
  }
  return chunks.length > 0 ? chunks : [clean]
}

// ----------------------------------------------------------------------------
// 公共 API
// ----------------------------------------------------------------------------

// 向量化并存储文档（支持 userId）
export async function embedAndStore(
  docId: string,
  docName: string,
  text: string,
  userId?: string
): Promise<KnowledgeDoc> {
  const chunks = chunkText(text)
  const now = new Date().toISOString()

  // 插入文档记录
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

  // 先删除旧向量（如果重新上传）
  await supabase.from("knowledge_vectors").delete().eq("doc_id", docId)

  // 逐块向量化并插入
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    try {
      const { embedding } = await embed({
        model: "text-embedding-3-small",
        value: chunk,
      })
      const { error: vecError } = await supabase.from("knowledge_vectors").insert({
        id: `${docId}-${i}`,
        doc_id: docId,
        user_id: userId ?? null,
        chunk,
        embedding,
        created_at: now,
      })
      if (vecError) throw vecError
    } catch (err) {
      throw err
    }
  }

  return toDoc(docRow as unknown as DBKnowledgeDoc)
}

// 列出所有文档
export async function listDocs(
  userId?: string
): Promise<KnowledgeDoc[]> {
  let query = supabase.from("knowledge_docs").select()
  if (userId) {
    query = query.eq("user_id", userId)
  } else {
    query = query.is("user_id", null)
  }
  const { data, error } = await query.order("created_at", { ascending: false })

  if (error || !data) return []
  return (data as unknown as DBKnowledgeDoc[]).map(toDoc)
}

// 删除文档 + 向量（CASCADE 自动删向量）
export async function deleteDoc(
  docId: string,
  userId?: string
): Promise<boolean> {
  const { error } = await supabase
    .from("knowledge_docs")
    .delete()
    .eq("id", docId)
    .eq("user_id", userId ?? null)

  return !error
}

export interface SearchHit {
  id: string
  docId: string
  chunk: string
  score: number
}

// 语义检索 top-K（使用 pgvector 的余弦距离运算符 <=>）
export async function retrieve(
  query: string,
  topK = 5,
  userId?: string
): Promise<SearchHit[]> {
  if (!query || !query.trim()) return []

  const { embedding } = await embed({
    model: "text-embedding-3-small",
    value: query,
  })

  // 使用 RPC 调用 pgvector 的余弦距离检索
  const { data, error } = await supabase.rpc("match_knowledge_vectors", {
    query_embedding: embedding,
    match_count: topK,
    filter_user_id: userId ?? null,
  })

  if (error || !data) return []

  return (data as Array<{
    id: string
    doc_id: string
    chunk: string
    similarity: number
  }>).map((row) => ({
    id: row.id,
    docId: row.doc_id,
    chunk: row.chunk,
    score: row.similarity,
  }))
}
