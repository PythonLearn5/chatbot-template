import type { Metadata } from "next"
import { gateway, GatewayAuthenticationError } from "@ai-sdk/gateway"

import { MODELS, type GatewayModel } from "@/lib/models"
import { Chat } from "@/components/chat"
import { SetupNotice } from "@/components/setup-notice"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Chat",
  description:
    "A chatbot template built using shadcn/ui, shadcn/react and shadcn/typeset, powered by the Vercel AI Gateway.",
}

// Fetch the model catalog per request instead of freezing it — and the
// setup notice — into the page at build time.
export const dynamic = "force-dynamic"

export default async function Page() {
  let models: GatewayModel[]

  try {
    const { models: available } = await gateway.getAvailableModels()
    models = available
      .filter((model) => MODELS.includes(model.id))
      .map((model) => ({ id: model.id, name: model.name }))
      .sort((a, b) => MODELS.indexOf(a.id) - MODELS.indexOf(b.id))
  } catch (error) {
    return (
      <SetupNotice isAuthError={GatewayAuthenticationError.isInstance(error)} />
    )
  }

  return (
    <Chat models={models}>
      <SiteHeader />
    </Chat>
  )
}
