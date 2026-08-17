import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { headers } from "next/headers"

import { MODELS } from "@/lib/models"
import { Chat } from "@/components/chat"
import { loadChat } from "@/lib/storage"
import { authenticateUser } from "@/lib/auth"
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
  const reqHeaders = await headers()
  const user = await authenticateUser(
    new Request("https://placeholder", { headers: reqHeaders })
  )
  const messages = await loadChat(chatId, user?.id)

  if (messages.length === 0) {
    notFound()
  }

  return (
    <Chat
      models={MODELS}
      chatId={chatId}
      initialMessages={messages as unknown as ChatUIMessage[]}
    />
  )
}
