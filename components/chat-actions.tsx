"use client"

import * as React from "react"

type ChatActions = {
  isBusy: boolean
  onNewChat: () => void
}

const ChatActionsContext = React.createContext<ChatActions | null>(null)

export function ChatActionsProvider({
  isBusy,
  onNewChat,
  children,
}: ChatActions & {
  children: React.ReactNode
}) {
  return (
    <ChatActionsContext.Provider value={{ isBusy, onNewChat }}>
      {children}
    </ChatActionsContext.Provider>
  )
}

export function useChatActions() {
  const context = React.useContext(ChatActionsContext)
  if (!context) {
    throw new Error("useChatActions must be used within ChatActionsProvider")
  }
  return context
}
