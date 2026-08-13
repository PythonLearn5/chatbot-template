// ============================================================================
// 私有知识库 (RAG) — 文档向量化 + 语义检索
// 使用 AI SDK embed() 通过 AI Gateway 生成向量
// 向量存储在文件系统（本地开发），生产可替换为 pgvector
//
// 新增：按 userId 隔离
//   已登录 → .data/users/{sha256(userId)[:12]}/knowledge/...
//   匿名   → .data/knowledge/...
// ============================================================================

import "server-only"
import { promises as fs } from "fs"
import path from "path"
import { createHash } from "crypto"
import { embed } from "ai"

const DATA_DIR = path.join(process.cwd(), ".data")
const ANON_KNOWLEDGE_DIR = path.join(DATA_DIR, "knowledge")

function userIdHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12)
}

function knowledgeDir(userId?: string): string {
  if (!userId) return ANON_KNOWLEDGE_DIR
  return path.join(DATA_DIR, "users", userIdHash(userId), "knowledge")
}

function vectorsDir(userId?: string): string {
  return path.join(knowledgeDir(userId), "vectors")
}

function docsDir(userId?: string): string {
  return path.join(knowledgeDir(userId), "docs")
}

function listPath(userId?: string): string {
  return path.join(knowledgeDir(userId), "list.json")
}

async function ensureDirs(userId?: string) {
  await Promise.all([
    fs.mkdir(vectorsDir(userId), { recursive: true }),
    fs.mkdir(docsDir(userId), { recursive: true }),
  ])
}

interface VectorEntry {
  id: string
  docId: string
  chunk: string
  embedding: number[]
  createdAt: number
}

export interface KnowledgeDoc {
  id: string
  name: string
  chunkCount: number
  size: number
  createdAt: number
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

// 余弦相似度
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

// ----------------------------------------------------------------------------
// 持久化辅助
// ----------------------------------------------------------------------------

async function readList(userId?: string): Promise<KnowledgeDoc[]> {
  try {
    const buf = await fs.readFile(listPath(userId), "utf-8")
    return JSON.parse(buf) as KnowledgeDoc[]
  } catch {
    return []
  }
}

async function writeList(list: KnowledgeDoc[], userId?: string) {
  await fs.writeFile(listPath(userId), JSON.stringify(list, null, 2))
}

async function saveVectors(
  docId: string,
  entries: VectorEntry[],
  userId?: string
) {
  const file = path.join(vectorsDir(userId), `${docId}.jsonl`)
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  await fs.writeFile(file, lines)
}

async function loadAllVectors(
  userId?: string
): Promise<VectorEntry[]> {
  const dir = vectorsDir(userId)
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const all: VectorEntry[] = []
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue
    try {
      const content = await fs.readFile(path.join(dir, f), "utf-8")
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          all.push(JSON.parse(trimmed) as VectorEntry)
        } catch {
          // 忽略坏行
        }
      }
    } catch {
      // 忽略坏文件
    }
  }
  return all
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
  await ensureDirs(userId)
  const chunks = chunkText(text)
  const entries: VectorEntry[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    try {
      const { embedding } = await embed({
        model: "text-embedding-3-small",
        value: chunk,
      })
      entries.push({
        id: `${docId}-${i}`,
        docId,
        chunk,
        embedding,
        createdAt: Date.now(),
      })
    } catch (err) {
      // embedding 失败：终止并抛给上层（通常是 API key 问题）
      throw err
    }
  }

  // 1) 存文档原文
  const docFile = path.join(docsDir(userId), `${docId}.txt`)
  await fs.writeFile(docFile, text)

  // 2) 存向量
  await saveVectors(docId, entries, userId)

  // 3) 更新列表
  const list = await readList(userId)
  const doc: KnowledgeDoc = {
    id: docId,
    name: docName,
    chunkCount: entries.length,
    size: Buffer.byteLength(text, "utf-8"),
    createdAt: Date.now(),
  }
  list.unshift(doc)
  await writeList(list, userId)

  return doc
}

// 列出所有文档
export async function listDocs(
  userId?: string
): Promise<KnowledgeDoc[]> {
  return readList(userId)
}

// 删除文档 + 向量 + 原文
export async function deleteDoc(
  docId: string,
  userId?: string
): Promise<boolean> {
  await ensureDirs(userId)
  const list = await readList(userId)
  const idx = list.findIndex((d) => d.id === docId)
  if (idx === -1) return false
  list.splice(idx, 1)
  await writeList(list, userId)

  const vectorFile = path.join(vectorsDir(userId), `${docId}.jsonl`)
  const docFile = path.join(docsDir(userId), `${docId}.txt`)
  await Promise.all([
    fs.unlink(vectorFile).catch(() => {}),
    fs.unlink(docFile).catch(() => {}),
  ])
  return true
}

export interface SearchHit {
  id: string
  docId: string
  chunk: string
  score: number
}

// 语义检索 top-K
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
  const all = await loadAllVectors(userId)
  if (all.length === 0) return []
  const scored: SearchHit[] = all.map((v) => ({
    id: v.id,
    docId: v.docId,
    chunk: v.chunk,
    score: cosineSimilarity(embedding, v.embedding),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
