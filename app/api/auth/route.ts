// ============================================================================
// 认证 API
// POST   → 注册或登录（根据 action 字段）
//   action=register → 注册新账号
//   action=login    → 登录已有账号
// DELETE → 登出（清除当前 token）
// GET    → 获取当前用户信息
// ============================================================================

import { NextResponse } from "next/server"
import {
  registerUser,
  loginUser,
  authenticateUser,
  logoutToken,
  extractTokenFromRequest,
  AuthError,
} from "@/lib/auth"

const COOKIE_NAME = "auth-token"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  })
}

// 注册 / 登录
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: string
      email?: string
      password?: string
      name?: string
    }

    const action = body.action ?? "register"
    const email = body.email?.trim() ?? ""
    const password = body.password ?? ""

    if (!email || !password) {
      return NextResponse.json(
        { error: "邮箱和密码必填。" },
        { status: 400 }
      )
    }

    let result: { user: { id: string; email: string; name: string; createdAt: number }; token: string }

    try {
      if (action === "login") {
        result = await loginUser({ email, password })
      } else {
        result = await registerUser({ email, password, name: body.name })
      }
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json(
          { error: e.message, code: e.code },
          { status: 400 }
        )
      }
      throw e
    }

    const response = NextResponse.json({
      token: result.token,
      userId: result.user.id,
      email: result.user.email,
      name: result.user.name,
    })
    setAuthCookie(response, result.token)
    return response
  } catch {
    return NextResponse.json(
      { error: "认证服务异常，请稍后再试。" },
      { status: 500 }
    )
  }
}

// 获取当前用户
export async function GET(req: Request) {
  const user = await authenticateUser(req)
  if (!user) {
    return NextResponse.json(
      { error: "Not authenticated." },
      { status: 401 }
    )
  }
  return NextResponse.json({
    token: extractTokenFromRequest(req),
    userId: user.id,
    email: user.email,
    name: user.name,
  })
}

// 登出
export async function DELETE(req: Request) {
  const token = extractTokenFromRequest(req)
  await logoutToken(token)
  const response = NextResponse.json({ success: true })
  response.cookies.delete(COOKIE_NAME)
  return response
}
