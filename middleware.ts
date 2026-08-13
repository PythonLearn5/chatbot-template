/**
 * Next.js 中间件（Edge Runtime 兼容）
 * ------------------------------------
 * 策略：
 *  - 公开路由（/, /_next/*, /favicon.ico, /api/auth, /api/chat）：放行
 *  - 受保护 API（/api/chats/*, /api/memory, /api/upload, /api/knowledge/*, /api/mcp, /api/stats）：
 *      需要 Cookie `auth-token` 存在（32 位 hex 格式，和 lib/auth.ts 对齐）
 *      否则返回 401 JSON，提示前端去登录
 *  - 前端访问页面（非 /api/*）：全部放行（登录态由 Header 的 AuthButton 管理，无账号也能体验 demo）
 *
 * 说明：
 *   这里不做严格 token 签名验证（middleware 不能读文件.hash），仅判 token 存在 + 格式对。
 *   真正的鉴权在每个 API 路由的 `authenticateUser(req)`（lib/auth.ts）里做完整 hash 校验。
 */
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATHS = [
  "/",
  "/favicon.ico",
  "/api/auth",
  "/api/chat",
]

const PUBLIC_PREFIXES = [
  "/_next/",
  "/static/",
  "/opengraph-image",
  "/sitemap",
  "/api/chats",
  "/api/auth/",
]

// 注意：
//   /api/chats* 已加入 PUBLIC_PREFIXES → 匿名也能读写自己的本地会话
//   真正的数据隔离在各个 API 路由里用 authenticateUser() 的 userId 做（匿名 = 共享 ANON 目录）

const PROTECTED_API_PREFIXES = [
  "/api/memory",
  "/api/upload",
  "/api/knowledge",
  "/api/mcp",
  "/api/stats",
]

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p))
}

function isProtectedApi(path: string): boolean {
  return PROTECTED_API_PREFIXES.some((p) =>
    path === p || path.startsWith(`${p}/`)
  )
}

// 32 位 hex（和 lib/auth.ts 生成的 token 格式一致）
const HEX32 = /^[a-f0-9]{32}$/i

export function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  // 非 API 请求（页面 / 静态资源）：放行
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next()
  }

  // 受保护 API：检查 auth-token cookie
  if (isProtectedApi(pathname)) {
    const token = req.cookies.get("auth-token")?.value
    if (!token || !HEX32.test(token)) {
      return NextResponse.json(
        { error: "未登录：请先点击右上角登录后再使用此功能。" },
        { status: 401 }
      )
    }
  }

  return NextResponse.next()
}

// 仅在根路径和所有 /api/* 上执行 middleware，减少冷启动开销
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
