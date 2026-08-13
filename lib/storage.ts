// ============================================================================
// 存储抽象层 — 使用文件系统 JSON 持久化，本地开发零依赖
// 生产环境可替换为 Vercel KV / PostgreSQL
// ============================================================================

import "server-only"
import { promises as fs } from "fs"
import path from "path"
import type { UIMessage } from "ai"

// 存储目录：项目根目录下的 .data/chats
const DATA_DIR = path.join(process.cwd(), ".data")
const CHATS_DIR = path.join(DATA_DIR, "chats")
const MEMORY_DIR = path.join(DATA_DIR, "memory")

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
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
}

// ============================================================================
// 会话存储 — 读写聊天记录
// ============================================================================
export async function saveChat(
  chatId: string,
  messages: UIMessage[],
  title?: string
): Promise<ChatMeta> {
  await ensureDir(CHATS_DIR)
  const now = Date.now()

  // 读取现有元数据（如果有）
  const metaPath = path.join(CHATS_DIR, `${chatId}.meta.json`)
  let meta: ChatMeta
  try {
    const existing = JSON.parse(await fs.readFile(metaPath, "utf-8"))
    meta = {
      ...existing,
      updatedAt: now,
      messageCount: messages.length,
      title: title ?? existing.title,
    }
  } catch {
    meta = {
      id: chatId,
      title: title ?? "新对话",
      createdAt: now,
      updatedAt: now,
      messageCount: messages.length,
    }
  }

  // 并行写入消息和元数据
  await Promise.all([
    fs.writeFile(
      path.join(CHATS_DIR, `${chatId}.messages.json`),
      JSON.stringify(messages)
    ),
    fs.writeFile(metaPath, JSON.stringify(meta)),
  ])

  return meta
}

export async function loadChat(chatId: string): Promise<UIMessage[]> {
  try {
    const content = await fs.readFile(
      path.join(CHATS_DIR, `${chatId}.messages.json`),
      "utf-8"
    )
    return JSON.parse(content) as UIMessage[]
  } catch {
    return []
  }
}

export async function listChats(): Promise<ChatMeta[]> {
  try {
    const files = await fs.readdir(CHATS_DIR)
    const metaFiles = files.filter((f) => f.endsWith(".meta.json"))
    const metas = await Promise.all(
      metaFiles.map(async (f) => {
        const content = await fs.readFile(path.join(CHATS_DIR, f), "utf-8")
        return JSON.parse(content) as ChatMeta
      })
    )
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function deleteChat(chatId: string): Promise<void> {
  await ensureDir(CHATS_DIR)
  const tasks: Promise<void>[] = [
    fs.unlink(path.join(CHATS_DIR, `${chatId}.messages.json`)).catch(() => {}),
    fs.unlink(path.join(CHATS_DIR, `${chatId}.meta.json`)).catch(() => {}),
  ]
  await Promise.all(tasks)
}

export async function getChatMeta(chatId: string): Promise<ChatMeta | null> {
  try {
    const content = await fs.readFile(
      path.join(CHATS_DIR, `${chatId}.meta.json`),
      "utf-8"
    )
    return JSON.parse(content) as ChatMeta
  } catch {
    return null
  }
}

// ============================================================================
// 长期记忆存储 — Phase 4 使用
// ============================================================================
export interface MemoryEntry {
  id: string
  type: "profile" | "fact" | "preference"
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

export async function saveMemory(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">): Promise<MemoryEntry> {
  await ensureDir(MEMORY_DIR)
  const indexPath = path.join(MEMORY_DIR, "index.json")

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

export async function loadAllMemories(): Promise<MemoryEntry[]> {
  try {
    const content = await fs.readFile(
      path.join(MEMORY_DIR, "index.json"),
      "utf-8"
    )
    return JSON.parse(content) as MemoryEntry[]
  } catch {
    return []
  }
}

export async function searchMemories(query: string): Promise<MemoryEntry[]> {
  const all = await loadAllMemories()
  const q = query.toLowerCase()
  return all.filter(
    (e) =>
      e.value.toLowerCase().includes(q) ||
      e.key.toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q)
  )
}
