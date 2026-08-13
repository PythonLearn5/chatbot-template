// ============================================================================
// 文档上传 API — 接收文本文件，分块并向量化存储
// POST /api/upload (FormData: file)
// ============================================================================

import { NextResponse } from "next/server"
import { embedAndStore } from "@/lib/rag"
import { rateLimit, RATE_LIMITS, getRequestIdentifier } from "@/lib/ratelimit"
import { authenticateUser } from "@/lib/auth"

export async function POST(req: Request) {
  // 速率限制
  const user = await authenticateUser(req)
  const identifier = getRequestIdentifier(req, user?.id)
  const rl = rateLimit(identifier, RATE_LIMITS.upload.limit, RATE_LIMITS.upload.windowMs)
  if (!rl.success) {
    return NextResponse.json(
      { error: "上传次数已达上限，请明天再试。" },
      { status: 429, headers: { "Retry-After": "3600" } }
    )
  }

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 })
    }

    const filename = file.name || ""
    const low = filename.toLowerCase()

    // 1) 格式白名单：仅 txt / md / markdown
    const ALLOWED_MIME = new Set([
      "text/plain",
      "text/markdown",
      "text/x-markdown",
      "application/markdown",
    ])
    const ALLOWED_EXT = [".txt", ".md", ".markdown"]

    const extOk = ALLOWED_EXT.some((e) => low.endsWith(e))
    const mimeOk = ALLOWED_MIME.has(file.type)
    if (!extOk && !mimeOk) {
      // 明确提示 PDF/Word 不支持
      const looksLikePdf =
        low.endsWith(".pdf") || file.type === "application/pdf"
      const looksLikeDoc =
        low.match(/\.(docx?|rtf|odt)$/) ||
        file.type.startsWith("application/msword") ||
        file.type.startsWith(
          "application/vnd.openxmlformats-officedocument.word"
        )
      const hint = looksLikePdf
        ? "PDF 文件暂不支持：请用 Adobe Acrobat / Word 另存为 .md 或 .txt 后再上传。"
        : looksLikeDoc
          ? "Word (.doc/.docx) 暂不支持：请在 Word 中另存为「纯文本(.txt)」或 Markdown 后再上传。"
          : "仅支持 .txt / .md / .markdown 格式；其他格式请先转成 Markdown 或纯文本再上传。"
      return NextResponse.json(
        { error: `不支持的文件格式「${file.type || filename}」。${hint}` },
        { status: 415 }
      )
    }

    // 2) 大小限制：10MB（对齐 RAG.md 文档）
    const MAX_BYTES = 10 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large（最大 10MB）；请拆分或压缩后再上传。" },
        { status: 413 }
      )
    }

    // 3) 读取文件内容
    const text = await file.text()
    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: "文件内容为空，没有可向量化的文本。" },
        { status: 400 }
      )
    }

    // 4) 生成文档 ID 并向量化
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const doc = await embedAndStore(docId, file.name, text, user?.id)

    return NextResponse.json({
      id: doc.id,
      name: doc.name,
      chunkCount: doc.chunkCount,
    })
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Failed to process file. " +
          "若为 embedding 模型报错，请确认 OPENAI_API_KEY / AI_GATEWAY_API_KEY 可用。",
      },
      { status: 500 }
    )
  }
}
