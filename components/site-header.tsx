"use client"

import * as React from "react"
import Link from "next/link"

import { AuthButton } from "@/components/auth-button"
import { NewChatButton } from "@/components/new-chat-button"
import { useAuth } from "@/hooks/use-auth"

export function SiteHeader() {
  const { user } = useAuth()

  return (
    <header className="flex items-center justify-between gap-2 px-6 py-3">
      <Link href="/" className="text-sm font-medium hover:underline">
        Chat
      </Link>

      <div className="flex items-center gap-2">
        {!user && (
          <>
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              登录
            </Link>
            <Link
              href="/register"
              className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
            >
              新用户注册
            </Link>
          </>
        )}
        <NewChatButton />
        <AuthButton />
      </div>
    </header>
  )
}
