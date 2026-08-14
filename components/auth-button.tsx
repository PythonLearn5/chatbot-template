"use client"

import * as React from "react"
import Link from "next/link"
import { UserIcon, LogOutIcon, ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
  const [mode, setMode] = React.useState<"login" | "register">("login")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [name, setName] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  const [profileOpen, setProfileOpen] = React.useState(false)
  const [logoutLoading, setLogoutLoading] = React.useState(false)
  const profileRef = React.useRef<HTMLDivElement>(null)

  async function handleSubmit() {
    const emailVal = email.trim()
    if (!emailVal || !password) return
    if (mode === "register" && password.length < 6) {
      setErr("密码至少 6 位")
      return
    }
    setErr(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode === "login" ? "login" : "register",
          email: emailVal,
          password,
          name: name.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        try {
          const data = JSON.parse(txt || "{}")
          setErr(data?.error ?? `提交失败（${res.status}）`)
        } catch {
          setErr(txt || `提交失败（${res.status}）`)
        }
        return
      }
      const data = await res.json()
      setAuth(data)
      setOpen(false)
      setEmail("")
      setPassword("")
      setName("")
    } catch (e: any) {
      setErr(e?.message ?? "网络异常，请稍后再试。")
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    setLogoutLoading(true)
    try {
      await fetch("/api/auth", { method: "DELETE", credentials: "include" })
      setAuth(null)
      setProfileOpen(false)
    } finally {
      setLogoutLoading(false)
    }
  }

  React.useEffect(() => {
    if (!profileOpen) return
    function onClick(e: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [profileOpen])

  if (user) {
    return (
      <div className="relative" ref={profileRef}>
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm transition-colors hover:bg-muted/80"
        >
          <UserIcon className="size-3.5" />
          <span className="max-w-24 truncate">{user.name}</span>
          <svg
            className={`size-3 text-muted-foreground transition-transform ${profileOpen ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {profileOpen && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-border bg-popover p-4 shadow-lg">
            <div className="flex flex-col items-center gap-1.5 pb-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserIcon className="size-6" />
              </div>
              <span className="text-sm font-medium">{user.name}</span>
            </div>

            <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-xs text-muted-foreground">邮箱</dt>
                <dd className="text-xs font-medium">{user.email}</dd>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <dt className="text-xs text-muted-foreground">用户 ID</dt>
                <dd className="max-w-32 truncate text-xs font-mono text-muted-foreground">
                  {user.userId}
                </dd>
              </div>
            </dl>

            <Button
              variant="destructive"
              size="sm"
              className="mt-3 w-full"
              onClick={handleLogout}
              disabled={logoutLoading}
            >
              <LogOutIcon className="size-4" data-icon="inline-start" />
              {logoutLoading ? "退出中…" : "退出登录"}
            </Button>
          </div>
        )}
      </div>
    )
  }

  const isLogin = mode === "login"

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) {
          setErr(null)
          setPassword("")
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserIcon className="size-4" data-icon="inline-start" />
          登录
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isLogin ? "登录" : "注册"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="邮箱"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          {!isLogin && (
            <Input
              type="text"
              placeholder="昵称（可选）"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          )}
          <Input
            type="password"
            placeholder={isLogin ? "密码" : "密码（至少 6 位）"}
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          {err && (
            <Alert variant="destructive">
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}
          <DialogClose asChild>
            <Button
              onClick={handleSubmit}
              disabled={!email.trim() || !password || loading}
            >
              {loading
                ? "提交中…"
                : isLogin
                  ? "登录"
                  : "注册并登录"}
            </Button>
          </DialogClose>

          <button
            type="button"
            onClick={() => {
              setMode(isLogin ? "register" : "login")
              setErr(null)
            }}
            className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {isLogin ? "没有账号？去注册" : "已有账号？去登录"}
            <ArrowRightIcon className="ml-0.5 inline size-3.5 align-middle" />
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            <Link
              href="/register"
              className="font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              独立注册页 <ArrowRightIcon className="inline size-3.5 align-middle" />
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
