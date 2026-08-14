"use client"

import Link from "next/link"

import { AuthButton } from "@/components/auth-button"
import { NewChatButton } from "@/components/new-chat-button"
import { ThemeToggle } from "@/components/theme-toggle"

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-2 px-6 py-3">
      <Link href="/" className="text-sm font-medium hover:underline">
        Chat
      </Link>

      <div className="flex items-center gap-2">
        <NewChatButton />
        <ThemeToggle />
        <AuthButton />
      </div>
    </header>
  )
}
