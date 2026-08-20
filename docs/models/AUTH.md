# 认证系统 (Authentication)

## 概述

本系统使用**邮箱 + 密码**认证（非用户名制），基于 Supabase PostgreSQL 持久化用户和令牌。密码使用 Node 内置 `crypto.scryptSync` 加盐哈希存储，令牌为 `crypto.randomBytes(32)` 生成的 64 位 hex 字符串。无需任何外部认证依赖（不使用 NextAuth / Auth.js / OAuth）。

> 设计原则：**零配置可跑 demo**。聊天主接口 `/api/chat` 允许匿名（未登录也能玩），但所有持久化写入都按用户隔离。

## 技术方案

| 组件 | 方案 |
|------|------|
| 认证方式 | 邮箱 + 密码（非用户名制） |
| 密码哈希 | Node `crypto.scryptSync`，16 字节随机 salt（hex），64 字节 keylen，存储为 `salt:hash` |
| 令牌生成 | `crypto.randomBytes(32).toString("hex")` → 64 位 hex 字符串 |
| 令牌存储 | Supabase `auth_tokens` 表（非文件系统） |
| 令牌保留 | 每用户最多保留最近 10 个令牌（登录时清理旧令牌） |
| 令牌校验 | `crypto.timingSafeEqual` 常数时间比较 |
| Cookie | httpOnly，`SameSite=Lax`，30 天 Max-Age |
| 外部依赖 | 无（不使用 NextAuth / Auth.js） |

## 架构

```
浏览器                        Next.js
┌───────────────┐            ┌──────────────────────────────────┐
│ AuthButton    │──POST──→   │ /api/auth                         │
│ (邮箱+密码弹窗) │←Cookie     │  action=register → registerUser() │
│               │ auth-token │  action=login    → loginUser()     │
└───────────────┘            │  生成 64位 hex token               │
                             │  Supabase auth_tokens 表存储       │
                             │  Set-Cookie httpOnly 30天          │
                                     │
                             middleware.ts (边缘拦截)
                                     │  受保护API需 auth-token
                                     │  仅判 token 存在 + 64 hex 格式
                                     │  不做 hash 校验（Edge 不能访问 DB）
                                     ▼
                    ┌──────────────────────────────────┐
                    │ /api/memory     记忆 CRUD          │
                    │ /api/upload     知识库上传         │
                    │ /api/knowledge  知识库列表/删除   │
                    │ /api/mcp/*      MCP 服务器配置     │
                    │ /api/stats      用量统计          │
                    │ /api/prompt-templates 自定义模板   │
                    └──────────────────────────────────┘
                                     │
                    每个 API 路由内部 authenticateUser() 做 hash 校验
                    失败 → 返回 401
```

## 相关文件

```
lib/auth.ts                      # 认证核心：注册/登录/令牌校验/AuthError
lib/db.ts                        # Supabase 客户端（service_role key）
middleware.ts                    # 边缘中间件：token 存在 + 格式检查
app/api/auth/route.ts            # 认证 API：POST注册/登录, GET当前用户, DELETE登出
components/auth-button.tsx       # 登录/登出按钮 UI
components/site-header.tsx       # 集成 AuthButton
```

## 环境变量

```
NEXT_PUBLIC_SUPABASE_URL          # Supabase 项目 URL
SUPABASE_SERVICE_ROLE_KEY         # Supabase service_role key（绕过 RLS）
```

> `lib/db.ts` 使用 `createClient(url, serviceRoleKey, { auth: { persistSession: false } })` 创建单例客户端，服务端使用 service_role key 绕过行级安全（RLS）。

## Supabase 表结构

```sql
-- 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 会话令牌表
CREATE TABLE auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
```

## 实现要点

### 1. 密码哈希（scrypt + 随机 salt）

```ts
// lib/auth.ts
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
```

- salt：16 字节随机数，hex 编码（32 字符）
- hash：scryptSync 输出 64 字节，hex 编码（128 字符）
- 存储格式：`salt:hash`（冒号分隔）
- 校验：`crypto.timingSafeEqual` 常数时间比较，防止时序攻击

### 2. 令牌生成与存储

```ts
// 令牌生成
const token = crypto.randomBytes(32).toString("hex")  // 64 位 hex 字符串

// 存入 Supabase auth_tokens 表
await supabase.from("auth_tokens").insert({ token, user_id: userId })
```

- 令牌为 32 字节随机数，hex 编码后 64 字符
- 直接以明文存入 `auth_tokens` 表（token 字段为主键）
- 登录时签发新令牌，并保留最近 10 个（旧令牌自动删除）

### 3. 用户注册（registerUser）

```ts
export async function registerUser(input: RegisterInput): Promise<{ user: PublicUser; token: string }> {
  const email = input.email.trim().toLowerCase()
  const password = input.password

  // 邮箱格式校验
  if (!isEmail(email)) {
    throw new AuthError("邮箱格式不正确", "INVALID_EMAIL")
  }
  // 密码强度：至少 6 位
  if (!password || password.length < 6) {
    throw new AuthError("密码至少 6 位", "WEAK_PASSWORD")
  }

  // 检查邮箱是否已存在
  const { data: existing } = await supabase
    .from("users").select("id").eq("email", email).maybeSingle()
  if (existing) {
    throw new AuthError("该邮箱已注册", "EMAIL_EXISTS")
  }

  // 生成用户 ID 和令牌
  const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const token = crypto.randomBytes(32).toString("hex")

  // 插入用户 + 令牌
  await supabase.from("users").insert({
    id: userId, email,
    name: input.name?.trim() || email.split("@")[0],
    password_hash: hashPassword(password),
  }).select().single()
  await supabase.from("auth_tokens").insert({ token, user_id: userId })

  return { user: toPublic(data), token }
}
```

- 用户 ID 格式：`user-{timestamp}-{random6}`（如 `user-1736123456789-a3b4c5`）
- 邮箱统一小写存储
- 用户名默认取邮箱 `@` 前部分

### 4. 用户登录（loginUser）

```ts
export async function loginUser(input: LoginInput): Promise<{ user: PublicUser; token: string }> {
  const email = input.email.trim().toLowerCase()

  if (!isEmail(email)) {
    throw new AuthError("邮箱格式不正确", "INVALID_EMAIL")
  }
  if (!input.password) {
    throw new AuthError("请输入密码", "MISSING_PASSWORD")
  }

  const { data, error } = await supabase
    .from("users").select().eq("email", email).maybeSingle()

  if (error || !data) {
    throw new AuthError("邮箱或密码错误", "INVALID_CREDENTIALS")
  }
  if (!verifyPassword(input.password, data.password_hash)) {
    throw new AuthError("邮箱或密码错误", "INVALID_CREDENTIALS")
  }

  // 签发新 token
  const token = crypto.randomBytes(32).toString("hex")
  await supabase.from("auth_tokens").insert({ token, user_id: data.id })

  // 清理旧 token（保留最近 10 个）
  const { data: tokens } = await supabase
    .from("auth_tokens").select("token, created_at")
    .eq("user_id", data.id)
    .order("created_at", { ascending: false })

  if (tokens && tokens.length > 10) {
    const toDelete = tokens.slice(10).map((t) => t.token)
    await supabase.from("auth_tokens").delete().in("token", toDelete)
  }

  return { user: toPublic(data), token }
}
```

- 令牌保留策略：每用户最多 10 个，按 `created_at DESC` 排序后删除超出的旧令牌
- 密码错误与用户不存在返回相同错误信息（防枚举攻击）

### 5. 令牌校验（getUserByToken）

```ts
export async function getUserByToken(token: string): Promise<PublicUser | null> {
  if (!token) return null

  const { data: tokenRow, error: tokenError } = await supabase
    .from("auth_tokens").select("user_id").eq("token", token).maybeSingle()

  if (tokenError || !tokenRow) return null

  const { data, error } = await supabase
    .from("users").select().eq("id", tokenRow.user_id).maybeSingle()

  if (error || !data) return null
  return toPublic(data)
}
```

### 6. 令牌提取（extractTokenFromRequest）

```ts
export function extractTokenFromRequest(req: Request): string {
  // 优先检查 Authorization: Bearer <token>
  const authHeader = req.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }
  // 回退到 Cookie auth-token
  const cookie = req.headers.get("cookie") ?? ""
  const match = cookie.match(/auth-token=([^;]+)/)
  return match?.[1] ?? ""
}
```

- 优先从 `Authorization: Bearer <token>` 头提取（便于 curl / API 调用）
- 回退到 Cookie 中的 `auth-token`（正则 `/auth-token=([^;]+)/`）

### 7. 认证中间件（authenticateUser）

```ts
export async function authenticateUser(req: Request): Promise<PublicUser | null> {
  const token = extractTokenFromRequest(req)
  return await getUserByToken(token)
}
```

- 返回 `PublicUser | null`（不抛异常，由调用方决定如何处理 null）

### 8. 边缘中间件（middleware.ts）

```ts
// middleware.ts （Edge Runtime 兼容）

const PUBLIC_PATHS = ["/", "/favicon.ico", "/api/auth", "/api/chat"]
const PUBLIC_PREFIXES = ["/_next/", "/static/", "/opengraph-image", "/sitemap", "/api/chats", "/api/auth/"]
const PROTECTED_API_PREFIXES = ["/api/memory", "/api/upload", "/api/knowledge", "/api/mcp", "/api/stats"]

// 64 位 hex（crypto.randomBytes(32).toString("hex") = 64 hex 字符）
const HEX_TOKEN = /^[a-f0-9]{64}$/i

export function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) return NextResponse.next()
  if (!pathname.startsWith("/api/")) return NextResponse.next()

  if (isProtectedApi(pathname)) {
    const token = req.cookies.get("auth-token")?.value
    if (!token || !HEX_TOKEN.test(token)) {
      return NextResponse.json(
        { error: "未登录：请先点击右上角登录后再使用此功能。" },
        { status: 401 }
      )
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
```

**关键说明：**
- middleware **只检查 token 存在 + 格式**（64 位 hex），不做 hash 校验
- Edge Runtime 无法访问 Supabase DB，真正的令牌完整性校验在每个 API 路由内部的 `authenticateUser(req)` 中完成
- `/api/chats*` 已加入 `PUBLIC_PREFIXES` → 匿名也能读写会话（数据隔离在路由内部用 userId 做）
- 401 响应中文提示：`"未登录：请先点击右上角登录后再使用此功能。"`

### 9. 认证 API（app/api/auth/route.ts）

```ts
const COOKIE_NAME = "auth-token"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30  // 30 天（秒）

// POST → 注册或登录（根据 action 字段）
export async function POST(req: Request) {
  const body = await req.json()
  const action = body.action ?? "register"

  let result
  if (action === "login") {
    result = await loginUser({ email, password })
  } else {
    result = await registerUser({ email, password, name: body.name })
  }

  const response = NextResponse.json({
    token: result.token,
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
  })
  // 设置 httpOnly Cookie
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE,
  })
  return response
}

// GET → 获取当前用户
export async function GET(req: Request) {
  const user = await authenticateUser(req)
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
  return NextResponse.json({ token: ..., userId, email, name })
}

// DELETE → 登出（清除 token）
export async function DELETE(req: Request) {
  const token = extractTokenFromRequest(req)
  await logoutToken(token)
  const response = NextResponse.json({ success: true })
  response.cookies.delete(COOKIE_NAME)
  return response
}
```

- Cookie 属性：`httpOnly: true`，`sameSite: "lax"`，`path: "/"`，`maxAge: 2592000`（30 天）
- `logoutToken` 从 `auth_tokens` 表删除令牌记录

## AuthError 错误码

```ts
export class AuthError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
    this.name = "AuthError"
  }
}
```

| 错误码 | 场景 | 错误消息 |
|--------|------|---------|
| `INVALID_EMAIL` | 邮箱格式不正确 | 邮箱格式不正确 |
| `WEAK_PASSWORD` | 密码少于 6 位 | 密码至少 6 位 |
| `EMAIL_EXISTS` | 注册时邮箱已存在 | 该邮箱已注册 |
| `MISSING_PASSWORD` | 登录时未提供密码 | 请输入密码 |
| `INVALID_CREDENTIALS` | 邮箱或密码错误 | 邮箱或密码错误 |

## 邮箱与密码校验规则

```ts
// 邮箱格式校验（正则）
function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

// 密码强度：最少 6 个字符
if (!password || password.length < 6) {
  throw new AuthError("密码至少 6 位", "WEAK_PASSWORD")
}
```

## 登录流程

1. 右上角点击「登录」→ 弹窗输入邮箱 + 密码
2. `POST /api/auth { action: "register"|"login", email, password, name? }`：
   - `action=register` → 注册新账号（邮箱不能重复）
   - `action=login` → 登录已有账号（校验密码）
3. 服务端响应：
   - `Set-Cookie: auth-token=<hex64>; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`
   - JSON: `{ token, userId, email, name }`
4. 前端刷新 Header 显示用户名；侧栏对话列表、记忆、知识库、统计均变为该用户独立空间

## 受保护接口清单

| 路径 | 是否需要登录 | 说明 |
|------|:---:|------|
| `/api/chat` (POST) | 否 | 聊天主接口（匿名可玩） |
| `/api/auth` | 否 | 自身：注册/登录/登出 |
| `/api/chats/*` | 否 | 会话列表/CRUD（匿名可用，按 userId 隔离） |
| `/api/memory` | 是 | 记忆 CRUD |
| `/api/upload` | 是 | 知识库上传 |
| `/api/knowledge/*` | 是 | 知识库列表/删除 |
| `/api/mcp/*` | 是 | MCP 服务器管理 |
| `/api/stats` | 是 | 用量统计 |
| `/api/prompt-templates` | 是（路由内校验） | 自定义提示词模板 |

## 数据隔离策略

- **会话隔离**：`/api/chats/*` 按 `userId` 隔离（匿名 = 共享匿名空间）
- **记忆隔离**：`/api/memory` 的 save_memory / recall_memory 按 `userId` 隔离
- **知识库隔离**：`/api/upload`、`/api/knowledge/*` 按 `userId` 隔离
- **MCP 配置**：全局共享（不按用户隔离）
- **用量统计**：`/api/stats` 查询全局日志（middleware 要求登录）
