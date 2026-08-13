import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { MODELS } from "@/lib/models"
import { Chat } from "@/components/chat"
import { loadChat } from "@/lib/storage"
import type { ChatUIMessage } from "@/tools"

export const metadata: Metadata = {
  title: "Chat",
  description: "A chatbot with memory and context management.",
}

export const dynamic = "force-dynamic"

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  const { chatId } = await params
  const messages = await loadChat(chatId)

  // 会话不存在时加载空数组，Chat 组件会显示空状态
  return (
    <Chat
      models={MODELS}
      chatId={chatId}
      initialMessages={messages as unknown as ChatUIMessage[]}
    />
  )
}
