"use client"

import * as React from "react"
import Link from "next/link"
import { UserIcon, LogOutIcon, ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"

export function AuthButton() {
  const { user, setAuth } = useAuth()
  const [name, setName] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  async function handleLogin() {
    if (!name.trim()) return
    setLoading(true)
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        credentials: "include",
      })
      if (res.ok) {
        const data = await res.json()
        setAuth(data)
        setOpen(false)
        setName("")
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE", credentials: "include" })
    setAuth(null)
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm">
          <UserIcon className="size-3.5" />
          <span className="max-w-20 truncate">{user.name}</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleLogout}
          aria-label="Logout"
        >
          <LogOutIcon className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserIcon className="size-4" data-icon="inline-start" />
          登录
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>登录</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="输入用户名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          <DialogClose asChild>
            <Button onClick={handleLogin} disabled={!name.trim() || loading}>
              {loading ? "登录中…" : "登录"}
            </Button>
          </DialogClose>
        </div>
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            没有账号？
            <Link
              href="/register"
              className="ml-1 font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              去注册 <ArrowRightIcon className="inline size-3.5 align-middle" />
            </Link>
          </span>
          <span>
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              独立登录页 <ArrowRightIcon className="inline size-3.5 align-middle" />
            </Link>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
