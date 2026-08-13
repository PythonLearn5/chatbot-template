// ============================================================================
// 存储抽象层 — 使用文件系统 JSON 持久化，本地开发零依赖
// 生产环境可替换为 Vercel KV / PostgreSQL
// 按 userId 隔离：文件路径 .data/users/{userId}/...
// ============================================================================

import "server-only"
import { promises as fs } from "fs"
import path from "path"
import type { UIMessage } from "ai"

const DATA_DIR = path.join(process.cwd(), ".data")

function userDir(userId: string): string {
  // 对 userId 做 hash，避免特殊字符
  const hash = require("crypto")
    .createHash("sha256")
    .update(userId)
    .digest("hex")
    .slice(0, 12)
  return path.join(DATA_DIR, "users", hash)
}

function chatsDir(userId: string): string {
  return path.join(userDir(userId), "chats")
}

function memoryDir(userId: string): string {
  return path.join(userDir(userId), "memory")
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

// 未登录共享目录（向后兼容）
const ANON_CHATS_DIR = path.join(DATA_DIR, "chats")
const ANON_MEMORY_DIR = path.join(DATA_DIR, "memory")

function getChatsDir(userId?: string): string {
  return userId ? chatsDir(userId) : ANON_CHATS_DIR
}

function getMemoryDir(userId?: string): string {
  return userId ? memoryDir(userId) : ANON_MEMORY_DIR
}

// ============================================================================
// 会话元数据
// ============================================================================
export interface ChatMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  systemPrompt?: string
  promptTemplateId?: string
}

// ============================================================================
// 会话存储 — 读写聊天记录（按 userId 隔离）
// ============================================================================
export async function saveChat(
  chatId: string,
  messages: UIMessage[],
  title?: string,
  systemPrompt?: string,
  promptTemplateId?: string,
  userId?: string
): Promise<ChatMeta> {
  const dir = getChatsDir(userId)
  await ensureDir(dir)
  const now = Date.now()

  const metaPath = path.join(dir, `${chatId}.meta.json`)
  let meta: ChatMeta
  try {
    const existing = JSON.parse(await fs.readFile(metaPath, "utf-8"))
    meta = {
      ...existing,
      updatedAt: now,
      messageCount: messages.length,
      title: title ?? existing.title,
      systemPrompt: systemPrompt ?? existing.systemPrompt,
      promptTemplateId: promptTemplateId ?? existing.promptTemplateId,
    }
  } catch {
    meta = {
      id: chatId,
      title: title ?? "新对话",
      createdAt: now,
      updatedAt: now,
      messageCount: messages.length,
      systemPrompt,
      promptTemplateId,
    }
  }

  await Promise.all([
    fs.writeFile(
      path.join(dir, `${chatId}.messages.json`),
      JSON.stringify(messages)
    ),
    fs.writeFile(metaPath, JSON.stringify(meta)),
  ])

  return meta
}

export async function loadChat(
  chatId: string,
  userId?: string
): Promise<UIMessage[]> {
  try {
    const content = await fs.readFile(
      path.join(getChatsDir(userId), `${chatId}.messages.json`),
      "utf-8"
    )
    return JSON.parse(content) as UIMessage[]
  } catch {
    return []
  }
}

export async function listChats(userId?: string): Promise<ChatMeta[]> {
  const dir = getChatsDir(userId)
  try {
    const files = await fs.readdir(dir)
    const metaFiles = files.filter((f) => f.endsWith(".meta.json"))
    const metas = await Promise.all(
      metaFiles.map(async (f) => {
        const content = await fs.readFile(path.join(dir, f), "utf-8")
        return JSON.parse(content) as ChatMeta
      })
    )
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function deleteChat(
  chatId: string,
  userId?: string
): Promise<void> {
  const dir = getChatsDir(userId)
  await ensureDir(dir)
  const tasks: Promise<void>[] = [
    fs.unlink(path.join(dir, `${chatId}.messages.json`)).catch(() => {}),
    fs.unlink(path.join(dir, `${chatId}.meta.json`)).catch(() => {}),
    fs.unlink(path.join(dir, `${chatId}.summary.json`)).catch(() => {}),
  ]
  await Promise.all(tasks)
}

export async function getChatMeta(
  chatId: string,
  userId?: string
): Promise<ChatMeta | null> {
  try {
    const content = await fs.readFile(
      path.join(getChatsDir(userId), `${chatId}.meta.json`),
      "utf-8"
    )
    return JSON.parse(content) as ChatMeta
  } catch {
    return null
  }
}

// ============================================================================
// 摘要缓存
// ============================================================================
export interface SummaryCache {
  chatId: string
  summary: string
  summarizedCount: number
  createdAt: number
  updatedAt: number
}

export async function loadSummary(
  chatId: string,
  userId?: string
): Promise<SummaryCache | null> {
  try {
    const content = await fs.readFile(
      path.join(getChatsDir(userId), `${chatId}.summary.json`),
      "utf-8"
    )
    return JSON.parse(content) as SummaryCache
  } catch {
    return null
  }
}

export async function saveSummary(
  chatId: string,
  summary: string,
  summarizedCount: number,
  userId?: string
): Promise<SummaryCache> {
  const dir = getChatsDir(userId)
  await ensureDir(dir)
  const now = Date.now()
  const existing = await loadSummary(chatId, userId)
  const entry: SummaryCache = {
    chatId,
    summary,
    summarizedCount,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await fs.writeFile(
    path.join(dir, `${chatId}.summary.json`),
    JSON.stringify(entry)
  )
  return entry
}

export async function deleteSummary(
  chatId: string,
  userId?: string
): Promise<void> {
  await fs
    .unlink(path.join(getChatsDir(userId), `${chatId}.summary.json`))
    .catch(() => {})
}

// ============================================================================
// 长期记忆存储 — 按 userId 隔离
// ============================================================================
export interface MemoryEntry {
  id: string
  type: "profile" | "fact" | "preference"
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

export async function saveMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">,
  userId?: string
): Promise<MemoryEntry> {
  const dir = getMemoryDir(userId)
  await ensureDir(dir)
  const indexPath = path.join(dir, "index.json")

  let entries: MemoryEntry[] = []
  try {
    entries = JSON.parse(await fs.readFile(indexPath, "utf-8"))
  } catch {
    // 首次创建
  }

  const now = Date.now()
  const existingIdx = entries.findIndex(
    (e) => e.type === entry.type && e.key === entry.key
  )

  let result: MemoryEntry
  if (existingIdx >= 0) {
    result = { ...entries[existingIdx], value: entry.value, updatedAt: now }
    entries[existingIdx] = result
  } else {
    result = {
      ...entry,
      id: `${entry.type}-${entry.key}-${now}`,
      createdAt: now,
      updatedAt: now,
    }
    entries.push(result)
  }

  await fs.writeFile(indexPath, JSON.stringify(entries))
  return result
}

export async function loadAllMemories(
  userId?: string
): Promise<MemoryEntry[]> {
  try {
    const content = await fs.readFile(
      path.join(getMemoryDir(userId), "index.json"),
      "utf-8"
    )
    return JSON.parse(content) as MemoryEntry[]
  } catch {
    return []
  }
}

export async function searchMemories(
  query: string,
  userId?: string
): Promise<MemoryEntry[]> {
  const all = await loadAllMemories(userId)
  const q = query.toLowerCase()
  return all.filter(
    (e) =>
      e.value.toLowerCase().includes(q) ||
      e.key.toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q)
  )
}
