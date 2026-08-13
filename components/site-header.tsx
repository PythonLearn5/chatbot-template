import Link from "next/link"

import { AuthButton } from "@/components/auth-button"
import { NewChatButton } from "@/components/new-chat-button"

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-2 px-6 py-3">
      <Link href="/" className="text-sm font-medium">
        Chat
      </Link>
      <div className="flex items-center gap-2">
        <NewChatButton />
        <AuthButton />
      </div>
    </header>
  )
}
