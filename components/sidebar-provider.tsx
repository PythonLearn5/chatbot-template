"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { ChatSidebar } from "@/components/chat-sidebar"
import type { ChatMeta } from "@/lib/storage"

// 从 URL 中提取当前 chatId
function useChatIdFromPath() {
  const pathname = usePathname()
  const match = pathname?.match(/^\/c\/(.+)$/)
  return match?.[1]
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = React.useState<ChatMeta[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const chatId = useChatIdFromPath()

  // 加载会话列表
  const refreshChats = React.useCallback(async () => {
    try {
      const res = await fetch("/api/chats")
      const data = await res.json()
      setChats(data.chats ?? [])
    } catch {
      setChats([])
    } finally {
      setLoaded(true)
    }
  }, [])

  React.useEffect(() => {
    refreshChats()
  }, [refreshChats, chatId])

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {loaded && (
        <ChatSidebar
          chats={chats}
          currentChatId={chatId}
          onRefresh={refreshChats}
        />
      )}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  )
}
