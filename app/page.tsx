import type { Metadata } from "next"

import { MODELS } from "@/lib/models"
import { Chat } from "@/components/chat"

export const metadata: Metadata = {
  title: "Chat",
  description: "A chatbot with memory and context management.",
}

export default function Page() {
  return <Chat models={MODELS} />
}
