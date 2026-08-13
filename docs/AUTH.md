# 认证系统 (Authentication)

## 目标

为 `/api/chats/*`、`/api/memory`、`/api/upload`、`/api/knowledge/*`、`/api/mcp`、`/api/stats` 添加认证保护，实现：
- 用户登录/注册（用户名即可，零密码零第三方 OAuth）
- 会话隔离（用户只能访问自己的对话）
- 记忆隔离（save_memory / recall_memory 按用户 ID 隔离）
- 知识库 / MCP 配置 / 统计 按用户 ID 隔离
- 速率限制基础标识（identifier 优先用 userId，回退 IP）

> 设计原则：**零配置可跑 demo**。聊天主接口 `/api/chat` 允许匿名（未登录也能玩），但所有持久化写入（除了匿名写入 `.data/chats`）都按用户隔离。

## 技术方案

使用**自实现轻量 Token + httpOnly Cookie**（Next.js 16 App Router 原生能力，不需要 Auth.js / NextAuth，不用任何 OAuth App 配置）。

## 架构

```
浏览器                       Next.js
┌───────────────┐           ┌─────────────────────────────┐
│ AuthButton    │──POST──→  │ /api/auth (login/register)  │
│  (用户名弹窗)  │←Cookie    │  生成 32位 hex token        │
└───────────────┘  auth-token│  sha256(token) 存 hash      │
                             │  Set-Cookie httpOnly 30天    │
                                     │
                             middleware.ts (边缘拦截)
                                     │  需 auth-token (仅受保护API)
                                     ▼
                    ┌──────────────────────────────────┐
                    │ /api/chats/*    会话列表/增删改    │
                    │ /api/memory     记忆读写          │
                    │ /api/upload     知识库上传        │
                    │ /api/knowledge  知识库列表/删除   │
                    │ /api/mcp        MCP 服务器配置    │
                    │ /api/stats      用量统计          │
                    └──────────────────────────────────┘
                                     │
                    storage.ts 按 userId(.data/users/{hash}/...) 隔离
```

## 修改 / 新增文件

```
middleware.ts                    # 认证中间件（Edge Runtime）
lib/auth.ts                      # Token 生成 / 校验 / authenticateUser
lib/storage.ts                   # 所有操作加 userId 可选参数
app/api/auth/route.ts            # 登录 / 注册 / 当前用户 / 登出
components/auth-button.tsx       # 登录/登出按钮（Dialog 输入用户名）
components/site-header.tsx       # 集成 AuthButton
lib/ratelimit.ts                 # identifier 优先使用 userId
```

## 环境变量

> 无任何必需环境变量。token 用 Node.js `crypto.randomBytes(16)` 生成，并以 `sha256(token)` 存于磁盘，避免明文泄露。

## 依赖

> 无外部依赖。全部使用 Node.js 内置 `crypto` + Next.js 原生 Cookie / Response。

## 实现要点

### 1. Token 生成与校验

```ts
// lib/auth.ts
import { createHash, randomBytes } from "node:crypto"
import { promises as fs } from "node:fs"

const AUTH_DIR = ".data/auth"

// 生成 32 位 hex token
const token = randomBytes(16).toString("hex")

// 以 sha256(token) 作为文件名存，避免明文泄露
const hash = createHash("sha256").update(token).digest("hex")
// .data/auth/tokens/${hash}.json  → { userId, username, createdAt, expiresAt }
```

`authenticateUser(req)` 支持两种读取 token 的方式（便于 curl / 浏览器通用）：
- `Authorization: Bearer <token>`
- `Cookie: auth-token=<token>`

### 2. 认证中间件

```ts
// middleware.ts （Edge Runtime 友好）
export function middleware(req) {
  const pathname = req.nextUrl.pathname
  // 公开：/  /_next/*  /api/auth  /api/chat(允许匿名聊天)
  if (isPublic(pathname)) return NextResponse.next()
  // 非 API 请求（页面）：放行，登录态由 Header 按钮决定
  if (!pathname.startsWith("/api/")) return NextResponse.next()
  // 受保护 API：需 Cookie auth-token(32 hex)
  const token = req.cookies.get("auth-token")?.value
  if (isProtected(pathname) && isValidHex32(token)) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  return NextResponse.next()
}
```

> 注意：middleware 只判 token 存在和格式，不读文件 hash（Edge 不支持）。真正的完整性校验在每个 API 路由内部的 `await authenticateUser(req)` 中做（失败时同样返回 401）。

### 3. 存储层按用户隔离

```ts
// lib/storage.ts
// 所有函数签名：saveChat(chatId, messages, title?, systemPrompt?, promptTemplateId?, userId?)
function userRoot(userId: string | undefined): string {
  if (!userId) return ".data"  // 匿名回退（向后兼容）
  const hash = sha256(userId)
  return `.data/users/${hash}`
}
// 实际路径：
//   匿名 → .data/chats/{id}.messages.json
//   登录 → .data/users/{sha256(userId)}/chats/{id}.messages.json
```

### 4. API 路由添加认证

```ts
// app/api/chats/route.ts
export async function GET(req) {
  const user = await authenticateUser(req)  // 未登录返回 401
  const chats = await listChats(user.id)
  return Response.json(chats)
}
```

```ts
// app/api/chat/route.ts — 聊天主接口：允许匿名
const user = await authenticateUser(req).catch(() => undefined)
const userId = user?.id  // 可能为 undefined → 走 storage 的匿名路径
```

## 登录流程

1. 右上角点击「登录」→ 弹窗输入用户名（无密码，仅作标识）
2. `POST /api/auth { username }`：
   - 首次出现的用户名 → 注册（新建 userId + token）
   - 已有用户名 → 登录（复用原有 userId，发新 token）
3. 服务端响应：
   - `Set-Cookie: auth-token=<hex32>; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`
   - JSON: `{ ok:true, username, userId }`
4. 前端刷新 Header 显示用户名；侧栏对话列表、知识库、MCP、统计均变为该用户独立空间

## 受保护接口清单

| 路径 | 是否需要登录 | 说明 |
|------|:----------:|------|
| `/api/chat` (POST) | 否 | 聊天主接口（匿名可玩） |
| `/api/auth` | 否 | 自身：注册/登录/登出 |
| `/api/chats/*` | 是 | 会话列表 / 新建 / 更新 / 删除 |
| `/api/memory` | 是 | 记忆检索 |
| `/api/upload` | 是 | 知识库文件上传 |
| `/api/knowledge/*` | 是 | 知识库列表 / 删除 |
| `/api/mcp/*` | 是 | MCP 服务器 列 / 加 / 删 |
| `/api/stats` | 是 | 用量统计 |
