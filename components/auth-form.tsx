"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { UserPlusIcon, LogInIcon, ArrowRightIcon, SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useAuth } from "@/hooks/use-auth"

export type AuthMode = "login" | "register"

interface Props {
  mode: AuthMode
}

const TITLES: Record<AuthMode, { title: string; desc: string; cta: string }> = {
  login: {
    title: "欢迎回来",
    desc: "输入邮箱和密码登录，继续你的对话、记忆与知识库。",
    cta: "登录",
  },
  register: {
    title: "创建账号",
    desc: "使用邮箱注册账号，密码至少 6 位。",
    cta: "注册并登录",
  },
}

export function AuthForm({ mode }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams?.get("redirect") ?? "/"
  const { setAuth } = useAuth()

  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [name, setName] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const meta = TITLES[mode]

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const emailVal = email.trim()
    const pwdVal = password
    if (!emailVal || !pwdVal) return
    if (mode === "register" && pwdVal.length < 6) {
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
          password: pwdVal,
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
      const payload = await res.json()
      setAuth(payload) // 通知全站组件（Header / AuthButton / chat 空状态）同步
      router.replace(redirect)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message ?? "网络异常，请稍后再试。")
    } finally {
      setLoading(false)
    }
  }

  const otherHref =
    mode === "login"
      ? `/register${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`
      : `/login${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""}`
  const otherLabel = mode === "login" ? "没有账号？去注册" : "已有账号？去登录"

  return (
    <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center justify-center px-6 py-12">
      <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <SparklesIcon className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{meta.desc}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="email"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              邮箱
            </label>
            <Input
              id="email"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          {mode === "register" && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="name"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                昵称（可选）
              </label>
              <Input
                id="name"
                autoComplete="name"
                placeholder="留空则使用邮箱前缀"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="password"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              密码
            </label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {err && (
            <Alert variant="destructive">
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={!email.trim() || !password || loading}
            className="w-full"
          >
            {loading ? (
              "提交中…"
            ) : mode === "login" ? (
              <>
                <LogInIcon className="size-4" data-icon="inline-start" />
                {meta.cta}
              </>
            ) : (
              <>
                <UserPlusIcon className="size-4" data-icon="inline-start" />
                {meta.cta}
              </>
            )}
          </Button>

          <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
            <Link
              href={otherHref}
              className="font-medium text-primary hover:underline"
            >
              {otherLabel}
              <ArrowRightIcon className="ml-0.5 inline size-3.5 align-middle" />
            </Link>
            <Link href="/" className="hover:underline">
              返回首页
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
