// ============================================================================
// 认证模块 — 邮箱 + 密码（Supabase PostgreSQL 持久化）
// 密码使用 Node 内置 crypto 的 scrypt 加盐哈希存储
// ============================================================================

import "server-only"
import crypto from "crypto"
import { supabase } from "@/lib/db"

export interface User {
  id: string
  email: string
  name: string
  passwordHash: string
  createdAt: number
}

export interface PublicUser {
  id: string
  email: string
  name: string
  createdAt: number
}

interface DBUser {
  id: string
  email: string
  name: string
  password_hash: string
  created_at: string
}

function toPublic(row: DBUser): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
  }
}

// ---------------------------------------------------------------------------
// 密码哈希（scrypt + 随机 salt）
// ---------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto.scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":")
    if (!salt || !hash) return false
    const test = crypto.scryptSync(password, salt, 64).toString("hex")
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

export interface RegisterInput {
  email: string
  password: string
  name?: string
}

export interface LoginInput {
  email: string
  password: string
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/** 注册新用户，返回 token */
export async function registerUser(input: RegisterInput): Promise<{ user: PublicUser; token: string }> {
  const email = input.email.trim().toLowerCase()
  const password = input.password

  if (!isEmail(email)) {
    throw new AuthError("邮箱格式不正确", "INVALID_EMAIL")
  }
  if (!password || password.length < 6) {
    throw new AuthError("密码至少 6 位", "WEAK_PASSWORD")
  }

  // 检查邮箱是否已存在
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  if (existing) {
    throw new AuthError("该邮箱已注册", "EMAIL_EXISTS")
  }

  const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const token = crypto.randomBytes(32).toString("hex")

  // 插入用户
  const { data, error } = await supabase
    .from("users")
    .insert({
      id: userId,
      email,
      name: input.name?.trim() || email.split("@")[0],
      password_hash: hashPassword(password),
    })
    .select()
    .single()

  if (error) throw error

  // 插入 token
  await supabase.from("auth_tokens").insert({ token, user_id: userId })

  return { user: toPublic(data), token }
}

/** 用邮箱+密码登录，返回 token */
export async function loginUser(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
  const email = input.email.trim().toLowerCase()

  if (!isEmail(email)) {
    throw new AuthError("邮箱格式不正确", "INVALID_EMAIL")
  }
  if (!input.password) {
    throw new AuthError("请输入密码", "MISSING_PASSWORD")
  }

  const { data, error } = await supabase
    .from("users")
    .select()
    .eq("email", email)
    .maybeSingle()

  if (error || !data) {
    throw new AuthError("邮箱或密码错误", "INVALID_CREDENTIALS")
  }

  if (!verifyPassword(input.password, data.password_hash)) {
    throw new AuthError("邮箱或密码错误", "INVALID_CREDENTIALS")
  }

  // 签发新 token，每用户保留最近 10 个
  const token = crypto.randomBytes(32).toString("hex")
  await supabase.from("auth_tokens").insert({ token, user_id: data.id })

  // 清理旧 token（保留最近 10 个）
  const { data: tokens } = await supabase
    .from("auth_tokens")
    .select("token, created_at")
    .eq("user_id", data.id)
    .order("created_at", { ascending: false })

  if (tokens && tokens.length > 10) {
    const toDelete = tokens.slice(10).map((t: { token: string }) => t.token)
    await supabase.from("auth_tokens").delete().in("token", toDelete)
  }

  return { user: toPublic(data), token }
}

/** 通过 token 查找用户 */
export async function getUserByToken(token: string): Promise<PublicUser | null> {
  if (!token) return null

  const { data: tokenRow, error: tokenError } = await supabase
    .from("auth_tokens")
    .select("user_id")
    .eq("token", token)
    .maybeSingle()

  if (tokenError || !tokenRow) return null

  const { data, error } = await supabase
    .from("users")
    .select()
    .eq("id", tokenRow.user_id)
    .maybeSingle()

  if (error || !data) return null
  return toPublic(data)
}

/** 登出指定 token */
export async function logoutToken(token: string): Promise<void> {
  if (!token) return
  await supabase.from("auth_tokens").delete().eq("token", token)
}

// 从请求头提取 token
export function extractTokenFromRequest(req: Request): string {
  const authHeader = req.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  const cookie = req.headers.get("cookie") ?? ""
  const match = cookie.match(/auth-token=([^;]+)/)
  return match?.[1] ?? ""
}

// 认证中间件：返回用户或 null
export async function authenticateUser(req: Request): Promise<PublicUser | null> {
  const token = extractTokenFromRequest(req)
  return await getUserByToken(token)
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
    this.name = "AuthError"
  }
}
