// ============================================================================
// 认证模块 — 邮箱 + 密码（本地开发，文件系统 JSON 持久化）
// 密码使用 Node 内置 crypto 的 scrypt 加盐哈希存储
// 生产环境可升级为 Auth.js (OAuth) / Clerk / Postgres + pgcrypto
// ============================================================================

import "server-only"
import { promises as fs } from "fs"
import path from "path"
import crypto from "crypto"

const AUTH_DIR = path.join(process.cwd(), ".data", "auth")
const USERS_DB = path.join(AUTH_DIR, "users.json")
const TOKEN_INDEX = path.join(AUTH_DIR, "tokens.json")

export interface User {
  id: string
  email: string
  name: string
  /** scrypt salted hash, 格式: saltHex:hashHex */
  passwordHash: string
  createdAt: number
}

export interface PublicUser {
  id: string
  email: string
  name: string
  createdAt: number
}

interface StoredUser extends User {
  tokens: string[]
}

function toPublic(u: StoredUser): PublicUser {
  const { passwordHash: _ph, tokens: _t, ...rest } = u
  return rest
}

async function ensureAuthDir() {
  await fs.mkdir(AUTH_DIR, { recursive: true })
}

// ---------------------------------------------------------------------------
// 密码哈希（scrypt + 随机 salt）
// ---------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex")
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
// JSON 文件"数据库"读写
// ---------------------------------------------------------------------------

async function readUsers(): Promise<StoredUser[]> {
  try {
    const content = await fs.readFile(USERS_DB, "utf-8")
    return JSON.parse(content) as StoredUser[]
  } catch {
    return []
  }
}

async function writeUsers(users: StoredUser[]) {
  await ensureAuthDir()
  await fs.writeFile(USERS_DB, JSON.stringify(users, null, 2))
}

async function readTokenIndex(): Promise<Record<string, string>> {
  // token → userId 的映射，用于快速查找登录态
  try {
    const content = await fs.readFile(TOKEN_INDEX, "utf-8")
    return JSON.parse(content) as Record<string, string>
  } catch {
    return {}
  }
}

async function writeTokenIndex(index: Record<string, string>) {
  await ensureAuthDir()
  await fs.writeFile(TOKEN_INDEX, JSON.stringify(index, null, 2))
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

  const users = await readUsers()
  if (users.some((u) => u.email === email)) {
    throw new AuthError("该邮箱已注册", "EMAIL_EXISTS")
  }

  const token = crypto.randomBytes(32).toString("hex")
  const now = Date.now()
  const newUser: StoredUser = {
    id: `user-${now}-${Math.random().toString(36).slice(2, 8)}`,
    email,
    name: input.name?.trim() || email.split("@")[0],
    passwordHash: hashPassword(password),
    createdAt: now,
    tokens: [token],
  }
  users.push(newUser)
  await writeUsers(users)

  // 更新 token 索引
  const index = await readTokenIndex()
  index[token] = newUser.id
  await writeTokenIndex(index)

  return { user: toPublic(newUser), token }
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

  const users = await readUsers()
  const idx = users.findIndex((u) => u.email === email)
  if (idx === -1) {
    throw new AuthError("邮箱或密码错误", "INVALID_CREDENTIALS")
  }
  const stored = users[idx]
  if (!verifyPassword(input.password, stored.passwordHash)) {
    throw new AuthError("邮箱或密码错误", "INVALID_CREDENTIALS")
  }

  // 签发新 token
  const token = crypto.randomBytes(32).toString("hex")
  stored.tokens.push(token)
  // 保留最近 10 个 token
  if (stored.tokens.length > 10) {
    const removed = stored.tokens.splice(0, stored.tokens.length - 10)
    const index = await readTokenIndex()
    for (const r of removed) delete index[r]
    await writeTokenIndex(index)
  }

  users[idx] = stored
  await writeUsers(users)

  const index = await readTokenIndex()
  index[token] = stored.id
  await writeTokenIndex(index)

  return { user: toPublic(stored), token }
}

/** 通过 token 查找用户 */
export async function getUserByToken(token: string): Promise<PublicUser | null> {
  if (!token) return null
  const index = await readTokenIndex()
  const userId = index[token]
  if (!userId) return null
  const users = await readUsers()
  const u = users.find((x) => x.id === userId)
  if (!u) return null
  if (!u.tokens.includes(token)) return null
  return toPublic(u)
}

/** 登出指定 token */
export async function logoutToken(token: string): Promise<void> {
  if (!token) return
  const index = await readTokenIndex()
  const userId = index[token]
  if (!userId) return

  const users = await readUsers()
  const idx = users.findIndex((u) => u.id === userId)
  if (idx >= 0) {
    users[idx].tokens = users[idx].tokens.filter((t) => t !== token)
    await writeUsers(users)
  }
  delete index[token]
  await writeTokenIndex(index)
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
