"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  PlusIcon,
  MessageSquareIcon,
  DatabaseIcon,
  ServerIcon,
  BarChart3Icon,
  BrainCircuitIcon,
  WandIcon,
  TrashIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { ChatMeta } from "@/lib/storage"

const MENU_ITEMS = [
  { href: "/", icon: PlusIcon, label: "新聊天", exact: true, section: "tools" },
  { href: "/knowledge", icon: DatabaseIcon, label: "知识库", exact: false, section: "tools" },
  { href: "/mcp", icon: ServerIcon, label: "MCP 服务器", exact: false, section: "tools" },
  { href: "/stats", icon: BarChart3Icon, label: "用量统计", exact: false, section: "tools" },
  { href: "/memory", icon: BrainCircuitIcon, label: "长期记忆", exact: false, section: "tools" },
  { href: "/prompts", icon: WandIcon, label: "提示词模板", exact: false, section: "tools" },
] as const

type MenuHref = (typeof MENU_ITEMS)[number]["href"]
type MenuItem = (typeof MENU_ITEMS)[number]

function isActive(href: MenuHref, exact: boolean, pathname: string) {
  if (exact) return pathname === href
  if (href === "/") return pathname === "/" || pathname.startsWith("/c/")
  return pathname === href || pathname.startsWith(href + "/")
}

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
  const [collapsed, setCollapsed] = React.useState(false)

  async function handleDelete(e: React.MouseEvent, chatId: string) {
    e.preventDefault()
    e.stopPropagation()
    setDeleting(chatId)
    try {
      await fetch(`/api/chats/${chatId}`, {
        method: "DELETE",
        credentials: "include",
      })
      onRefresh?.()
      if (pathname === `/c/${chatId}`) {
        router.push("/")
      }
    } finally {
      setDeleting(null)
    }
  }

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-muted/30 transition-[width] duration-200",
        collapsed ? "w-14" : "w-64"
      )}
    >
      {collapsed ? (
        <CollapsedSidebar
          pathname={pathname}
          onToggle={() => setCollapsed(false)}
        />
      ) : (
        <>
          <div className="flex items-center gap-1 p-3">
            <div className="flex-1 text-sm font-semibold text-muted-foreground">
              AI Chat
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="收起侧栏"
            >
              <PanelLeftCloseIcon className="size-4" />
            </button>
          </div>

          <div className="px-3 pb-2">
            <Link href="/">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3 px-3 font-normal",
                  isActive("/", true, pathname) ||
                    pathname.startsWith("/c/")
                    ? "bg-muted font-medium"
                    : "hover:bg-muted/60"
                )}
              >
                <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                新聊天
              </Button>
            </Link>
          </div>

          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {MENU_ITEMS.filter((m) => m.href !== "/").map((item) => {
              const Icon = item.icon
              const active = isActive(item.href, item.exact, pathname)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted/60",
                    active && "bg-muted font-medium"
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{item.label}</span>
                </Link>
              )
            })}
          </div>

          <Separator />

          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              最近
            </div>
            <button
              onClick={() => onRefresh?.()}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="刷新会话"
            >
              <MoreHorizontalIcon className="size-3.5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {chats.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
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
                      currentChatId === chat.id &&
                        "bg-muted font-medium"
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
        </>
      )}
    </aside>
  )
}

function CollapsedSidebar({
  pathname,
  onToggle,
}: {
  pathname: string
  onToggle: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center py-3">
      <button
        onClick={onToggle}
        className="mb-2 rounded-md p-2 text-muted-foreground hover:bg-muted"
        aria-label="展开侧栏"
      >
        <PanelLeftOpenIcon className="size-4" />
      </button>
      <Separator className="mb-2 w-8" />
      {MENU_ITEMS.map((item: MenuItem) => {
        const Icon = item.icon
        const active = isActive(item.href, item.exact, pathname)
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={cn(
              "my-0.5 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted text-foreground"
            )}
          >
            <Icon className="size-4" />
          </Link>
        )
      })}
    </div>
  )
}
