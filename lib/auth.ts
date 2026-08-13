// ============================================================================
// 认证模块 — 轻量级 token 认证（本地开发）
// 生产环境可升级为 Auth.js (OAuth) 或 Clerk
// ============================================================================

import "server-only"
import { promises as fs } from "fs"
import path from "path"
import crypto from "crypto"

const AUTH_DIR = path.join(process.cwd(), ".data", "auth")

export interface User {
  id: string
  name: string
  token: string
  createdAt: number
}

async function ensureAuthDir() {
  await fs.mkdir(AUTH_DIR, { recursive: true })
}

function getAuthFilePath(token: string): string {
  // 用 token 的 hash 作为文件名，避免特殊字符
  const hash = crypto.createHash("sha256").update(token).digest("hex")
  return path.join(AUTH_DIR, `${hash}.json`)
}

// 注册新用户，返回 token
export async function registerUser(name: string): Promise<User> {
  await ensureAuthDir()
  const user: User = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name || "Anonymous",
    token: crypto.randomBytes(32).toString("hex"),
    createdAt: Date.now(),
  }
  await fs.writeFile(getAuthFilePath(user.token), JSON.stringify(user))
  return user
}

// 通过 token 查找用户
export async function getUserByToken(token: string): Promise<User | null> {
  if (!token) return null
  try {
    const content = await fs.readFile(getAuthFilePath(token), "utf-8")
    return JSON.parse(content) as User
  } catch {
    return null
  }
}

// 从请求头提取 token
export function extractTokenFromRequest(req: Request): string {
  // 优先从 Authorization header 提取
  const authHeader = req.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  // 其次从 cookie 提取
  const cookie = req.headers.get("cookie") ?? ""
  const match = cookie.match(/auth-token=([^;]+)/)
  return match?.[1] ?? ""
}

// 认证中间件：返回用户或 null
export async function authenticateUser(req: Request): Promise<User | null> {
  const token = extractTokenFromRequest(req)
  return await getUserByToken(token)
}
