import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthForm } from "@/components/auth-form"

export const metadata: Metadata = {
  title: "登录",
  description: "登录 chatbot-template，继续你的对话与知识库。",
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="login" />
    </Suspense>
  )
}
