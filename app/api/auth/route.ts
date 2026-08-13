// ============================================================================
// 认证 API
// POST   → 注册/登录（返回 token，设置 cookie）
// DELETE → 登出（清除 cookie）
// GET    → 获取当前用户信息
// ============================================================================

import { NextResponse } from "next/server"
import { registerUser, authenticateUser } from "@/lib/auth"

// 注册/登录
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = (body as { name?: string })?.name?.trim()

    if (!name) {
      return NextResponse.json(
        { error: "Name is required." },
        { status: 400 }
      )
    }

    const user = await registerUser(name)

    const response = NextResponse.json({
      token: user.token,
      userId: user.id,
      name: user.name,
    })
    response.cookies.set("auth-token", user.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    })
    return response
  } catch {
    return NextResponse.json(
      { error: "Authentication failed." },
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
    token: user.token,
    userId: user.id,
    name: user.name,
  })
}

// 登出
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete("auth-token")
  return response
}
