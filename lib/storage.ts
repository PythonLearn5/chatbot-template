// ============================================================================
// 存储抽象层 — Supabase PostgreSQL 持久化
// 按 userId 隔离：chats / memories / prompt_templates
// ============================================================================

import "server-only"
import type { UIMessage } from "ai"
import { supabase } from "@/lib/db"

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

interface DBChat {
  id: string
  user_id: string | null
  title: string
  messages: UIMessage[]
  message_count: number
  system_prompt: string | null
  prompt_template_id: string | null
  summary: string | null
  summarized_count: number
  summary_created_at: string | null
  summary_updated_at: string | null
  created_at: string
  updated_at: string
}

function toMeta(row: DBChat): ChatMeta {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    messageCount: row.message_count,
    systemPrompt: row.system_prompt ?? undefined,
    promptTemplateId: row.prompt_template_id ?? undefined,
  }
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
  const now = new Date().toISOString()

  // 查询是否已存在
  const { data: existing } = await supabase
    .from("chats")
    .select()
    .eq("id", chatId)
    .eq("user_id", userId ?? null)
    .maybeSingle()

  const updateData: Record<string, unknown> = {
    messages,
    message_count: messages.length,
    updated_at: now,
  }
  if (title !== undefined) updateData.title = title
  if (systemPrompt !== undefined) updateData.system_prompt = systemPrompt
  if (promptTemplateId !== undefined) updateData.prompt_template_id = promptTemplateId

  if (existing) {
    const { data, error } = await supabase
      .from("chats")
      .update(updateData)
      .eq("id", chatId)
      .select()
      .single()
    if (error) throw error
    return toMeta(data)
  }

  const { data, error } = await supabase
    .from("chats")
    .insert({
      id: chatId,
      user_id: userId ?? null,
      title: title ?? "新对话",
      messages,
      message_count: messages.length,
      system_prompt: systemPrompt ?? null,
      prompt_template_id: promptTemplateId ?? null,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (error) throw error
  return toMeta(data)
}

export async function loadChat(
  chatId: string,
  userId?: string
): Promise<UIMessage[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("messages")
    .eq("id", chatId)
    .eq("user_id", userId ?? null)
    .maybeSingle()

  if (error || !data) return []
  return (data.messages as UIMessage[]) ?? []
}

export async function listChats(userId?: string): Promise<ChatMeta[]> {
  let query = supabase.from("chats").select()
  if (userId) {
    query = query.eq("user_id", userId)
  } else {
    query = query.is("user_id", null)
  }
  const { data, error } = await query.order("updated_at", { ascending: false })

  if (error || !data) return []
  return (data as unknown as DBChat[]).map(toMeta)
}

export async function deleteChat(
  chatId: string,
  userId?: string
): Promise<void> {
  const { error } = await supabase
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId ?? null)
  if (error) throw error
}

export async function getChatMeta(
  chatId: string,
  userId?: string
): Promise<ChatMeta | null> {
  const { data, error } = await supabase
    .from("chats")
    .select()
    .eq("id", chatId)
    .eq("user_id", userId ?? null)
    .maybeSingle()

  if (error || !data) return null
  return toMeta(data as unknown as DBChat)
}

// ============================================================================
// 摘要缓存（存储在 chats 表的 summary 列）
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
  const { data, error } = await supabase
    .from("chats")
    .select("summary, summarized_count, summary_created_at, summary_updated_at")
    .eq("id", chatId)
    .eq("user_id", userId ?? null)
    .maybeSingle()

  if (error || !data || !data.summary) return null
  return {
    chatId,
    summary: data.summary,
    summarizedCount: data.summarized_count ?? 0,
    createdAt: data.summary_created_at
      ? new Date(data.summary_created_at).getTime()
      : Date.now(),
    updatedAt: data.summary_updated_at
      ? new Date(data.summary_updated_at).getTime()
      : Date.now(),
  }
}

export async function saveSummary(
  chatId: string,
  summary: string,
  summarizedCount: number,
  userId?: string
): Promise<SummaryCache> {
  const now = new Date().toISOString()

  const { data: existing } = await supabase
    .from("chats")
    .select("summary_created_at")
    .eq("id", chatId)
    .eq("user_id", userId ?? null)
    .maybeSingle()

  const createdAt = existing?.summary_created_at ?? now

  const { error } = await supabase
    .from("chats")
    .update({
      summary,
      summarized_count: summarizedCount,
      summary_created_at: createdAt,
      summary_updated_at: now,
      updated_at: now,
    })
    .eq("id", chatId)
    .eq("user_id", userId ?? null)

  if (error) throw error

  return {
    chatId,
    summary,
    summarizedCount,
    createdAt: new Date(createdAt).getTime(),
    updatedAt: new Date(now).getTime(),
  }
}

export async function deleteSummary(
  chatId: string,
  userId?: string
): Promise<void> {
  await supabase
    .from("chats")
    .update({
      summary: null,
      summarized_count: 0,
      summary_created_at: null,
      summary_updated_at: null,
    })
    .eq("id", chatId)
    .eq("user_id", userId ?? null)
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

interface DBMemory {
  id: string
  user_id: string | null
  type: string
  key: string
  value: string
  created_at: string
  updated_at: string
}

function toMemoryEntry(row: DBMemory): MemoryEntry {
  return {
    id: row.id,
    type: row.type as MemoryEntry["type"],
    key: row.key,
    value: row.value,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }
}

export async function saveMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">,
  userId?: string
): Promise<MemoryEntry> {
  const now = new Date().toISOString()
  const id = `${entry.type}-${entry.key}-${Date.now()}`

  const { data, error } = await supabase
    .from("memories")
    .upsert(
      {
        id,
        user_id: userId ?? null,
        type: entry.type,
        key: entry.key,
        value: entry.value,
        created_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,type,key" }
    )
    .select()
    .single()

  if (error) throw error
  return toMemoryEntry(data as unknown as DBMemory)
}

export async function loadAllMemories(
  userId?: string
): Promise<MemoryEntry[]> {
  let query = supabase.from("memories").select()
  if (userId) {
    query = query.eq("user_id", userId)
  } else {
    query = query.is("user_id", null)
  }
  const { data, error } = await query.order("created_at", { ascending: false })

  if (error || !data) return []
  return (data as unknown as DBMemory[]).map(toMemoryEntry)
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

// ============================================================================
// 自定义角色模板 — 按 userId 隔离
// ============================================================================
export interface CustomPromptTemplate {
  id: string
  name: string
  icon: string
  description: string
  systemPrompt: string
  createdAt: number
  updatedAt: number
  custom?: true
}

interface DBTemplate {
  id: string
  user_id: string | null
  name: string
  icon: string | null
  description: string | null
  system_prompt: string
  created_at: string
  updated_at: string
}

function toTemplate(row: DBTemplate): CustomPromptTemplate {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? "",
    description: row.description ?? "",
    systemPrompt: row.system_prompt,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    custom: true,
  }
}

export async function listCustomTemplates(
  userId?: string
): Promise<CustomPromptTemplate[]> {
  let query = supabase.from("prompt_templates").select()
  if (userId) {
    query = query.eq("user_id", userId)
  } else {
    query = query.is("user_id", null)
  }
  const { data, error } = await query.order("created_at", { ascending: false })

  if (error || !data) return []
  return (data as unknown as DBTemplate[]).map(toTemplate)
}

export async function saveCustomTemplate(
  template: Omit<CustomPromptTemplate, "id" | "createdAt" | "updatedAt"> & {
    id?: string
  },
  userId?: string
): Promise<CustomPromptTemplate> {
  const now = new Date().toISOString()

  if (template.id) {
    const { data: existing } = await supabase
      .from("prompt_templates")
      .select()
      .eq("id", template.id)
      .eq("user_id", userId ?? null)
      .maybeSingle()

    if (existing) {
      const { data, error } = await supabase
        .from("prompt_templates")
        .update({
          name: template.name,
          icon: template.icon,
          description: template.description,
          system_prompt: template.systemPrompt,
          updated_at: now,
        })
        .eq("id", template.id)
        .select()
        .single()

      if (error) throw error
      return toTemplate(data as unknown as DBTemplate)
    }
  }

  const newId = template.id ?? `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await supabase
    .from("prompt_templates")
    .insert({
      id: newId,
      user_id: userId ?? null,
      name: template.name,
      icon: template.icon,
      description: template.description,
      system_prompt: template.systemPrompt,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (error) throw error
  return toTemplate(data as unknown as DBTemplate)
}

export async function deleteCustomTemplate(
  templateId: string,
  userId?: string
): Promise<void> {
  const { error } = await supabase
    .from("prompt_templates")
    .delete()
    .eq("id", templateId)
    .eq("user_id", userId ?? null)
  if (error) throw error
}
