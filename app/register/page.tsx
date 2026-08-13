import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthForm } from "@/components/auth-form"

export const metadata: Metadata = {
  title: "注册",
  description: "注册 chatbot-template，体验跨会话的记忆、知识库与个人上下文。",
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="register" />
    </Suspense>
  )
}
