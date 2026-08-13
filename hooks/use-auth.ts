"use client"

import * as React from "react"

export interface AuthUser {
  userId: string
  name: string
  token?: string
}

const STORAGE_KEY = "chat.auth.user"
const EVENT_NAME = "chat:auth-change"

function readStorage(): AuthUser | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function writeStorage(user: AuthUser | null) {
  if (typeof window === "undefined") return
  try {
    if (user) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

/**
 * 拉一次服务器 /api/auth 确认登录态，并同步写入 LocalStorage
 * （本地 cookie 只能通过 httpOnly 服务端读，客户端靠缓存 + 事件广播）
 */
export async function refreshAuthFromServer(): Promise<AuthUser | null> {
  if (typeof window === "undefined") return null
  try {
    const res = await fetch("/api/auth", {
      credentials: "include",
      headers: { "Cache-Control": "no-store" },
    })
    if (!res.ok) {
      writeStorage(null)
      return null
    }
    const data = (await res.json()) as AuthUser | null
    writeStorage(data ?? null)
    return data
  } catch {
    return readStorage()
  }
}

/**
 * 共享登录态 hook：
 *  - 首次挂载：从 localStorage 取（首屏不闪烁），再异步从 server 校验刷新
 *  - 监听 auth:change / storage 事件：跨组件/跨 Tab 状态同步
 */
export function useAuth(): {
  user: AuthUser | null
  setAuth: (u: AuthUser | null) => void
  refresh: () => Promise<AuthUser | null>
} {
  const [user, setUser] = React.useState<AuthUser | null>(() => readStorage())

  // 服务器校验 + 监听事件
  React.useEffect(() => {
    let alive = true
    refreshAuthFromServer().then((u) => {
      if (alive) setUser(u)
    })

    const onSync = () => setUser(readStorage())
    window.addEventListener(EVENT_NAME, onSync)
    window.addEventListener("storage", onSync) // 跨 Tab
    return () => {
      alive = false
      window.removeEventListener(EVENT_NAME, onSync)
      window.removeEventListener("storage", onSync)
    }
  }, [])

  const setAuth = React.useCallback((u: AuthUser | null) => {
    writeStorage(u)
    setUser(u)
  }, [])

  const refresh = React.useCallback(async () => {
    const u = await refreshAuthFromServer()
    setUser(u)
    return u
  }, [])

  return { user, setAuth, refresh }
}
