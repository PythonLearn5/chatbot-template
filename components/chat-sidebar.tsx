"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { MessageSquareIcon, PlusIcon, TrashIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { ChatMeta } from "@/lib/storage"
import { KnowledgeUpload } from "@/components/knowledge-upload"
import { MCPPanel } from "@/components/mcp-panel"
import { StatsPanel } from "@/components/stats-panel"

export function ChatSidebar({
  chats,
  currentChatId,
  onRefresh,
}: {
  chats: ChatMeta[]
  currentChatId?: string
  onRefresh?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [deleting, setDeleting] = React.useState<string | null>(null)

  async function handleDelete(e: React.MouseEvent, chatId: string) {
    e.preventDefault()
    e.stopPropagation()
    setDeleting(chatId)
    try {
      await fetch(`/api/chats/${chatId}`, { method: "DELETE", credentials: "include" })
      onRefresh?.()
      if (pathname === `/c/${chatId}`) {
        router.push("/")
      }
    } finally {
      setDeleting(null)
    }
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-muted/30">
      <div className="p-3">
        <Link href="/">
          <Button variant="default" className="w-full">
            <PlusIcon data-icon="inline-start" />
            新对话
          </Button>
        </Link>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto p-2">
        {chats.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            暂无历史对话
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {chats.map((chat) => (
              <Link
                key={chat.id}
                href={`/c/${chat.id}`}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted",
                  currentChatId === chat.id && "bg-muted font-medium"
                )}
              >
                <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{chat.title}</span>
                <button
                  onClick={(e) => handleDelete(e, chat.id)}
                  disabled={deleting === chat.id}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  aria-label="删除对话"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </Link>
            ))}
          </div>
        )}
      </div>
      <Separator />
      <div className="flex flex-col gap-4 p-3 text-xs">
        <KnowledgeUpload />
        <Separator />
        <MCPPanel />
        <Separator />
        <StatsPanel />
      </div>
    </aside>
  )
}
