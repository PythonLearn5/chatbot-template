import Link from "next/link"

import { NewChatButton } from "@/components/new-chat-button"

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-2 px-6 py-3">
      <Link href="/" className="text-sm font-medium">
        Chat
      </Link>
      <NewChatButton />
    </header>
  )
}
