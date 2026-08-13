"use client"

import * as React from "react"
import { UserIcon, LogOutIcon } from "lucide-react"

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

interface AuthUser {
  token: string
  userId: string
  name: string
}

export function AuthButton() {
  const [user, setUser] = React.useState<AuthUser | null>(null)
  const [name, setName] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    // 从 cookie 检查是否已登录
    fetch("/api/auth", { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then(data => data && setUser(data))
      .catch(() => {})
  }, [])

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
        setUser(data)
        setOpen(false)
        setName("")
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    await fetch("/api/auth", { method: "DELETE", credentials: "include" })
    setUser(null)
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
      </DialogContent>
    </Dialog>
  )
}
