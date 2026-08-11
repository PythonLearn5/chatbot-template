"use client"

import { PlusIcon } from "lucide-react"

import { useChatActions } from "@/components/chat-actions"
import { Button } from "@/components/ui/button"

export function NewChatButton() {
  const { isBusy, onNewChat } = useChatActions()

  return (
    <Button variant="secondary" onClick={onNewChat} disabled={isBusy}>
      <PlusIcon data-icon="inline-start" />
      New chat
    </Button>
  )
}
