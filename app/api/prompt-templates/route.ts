import { NextResponse } from "next/server"
import {
  listCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
} from "@/lib/storage"
import { authenticateUser } from "@/lib/auth"

export async function GET(req: Request) {
  const user = await authenticateUser(req)
  try {
    const templates = await listCustomTemplates(user?.id)
    return NextResponse.json({ templates })
  } catch {
    return NextResponse.json(
      { error: "Failed to load prompt templates." },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const user = await authenticateUser(req)
  try {
    const body = await req.json()
    const { id, name, icon, description, systemPrompt } = body as {
      id?: string
      name?: unknown
      icon?: unknown
      description?: unknown
      systemPrompt?: unknown
    }

    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      typeof description !== "string" ||
      typeof systemPrompt !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid payload." },
        { status: 400 }
      )
    }

    const template = await saveCustomTemplate(
      {
        id,
        name: name.trim(),
        icon: typeof icon === "string" && icon ? icon : "Sparkles",
        description: description.trim(),
        systemPrompt,
      },
      user?.id
    )
    return NextResponse.json({ template })
  } catch {
    return NextResponse.json(
      { error: "Failed to save prompt template." },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  const user = await authenticateUser(req)
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "Missing id." }, { status: 400 })
    }
    await deleteCustomTemplate(id, user?.id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete prompt template." },
      { status: 500 }
    )
  }
}
