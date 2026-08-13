"use client"

import * as React from "react"
import { UploadIcon, FileTextIcon, TrashIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

interface KnowledgeDoc {
  id: string
  name: string
  chunkCount: number
  createdAt: number
}

export function KnowledgeUpload() {
  const [docs, setDocs] = React.useState<KnowledgeDoc[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const refreshDocs = React.useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge", { credentials: "include" })
      const data = await res.json()
      setDocs(data.docs ?? [])
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    refreshDocs()
  }, [refreshDocs])

  async function handleUpload(files: FileList | null) {
    if (!files) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append("file", file)
        await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" })
      }
      await refreshDocs()
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/knowledge?id=${id}`, { method: "DELETE", credentials: "include" })
    await refreshDocs()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">知识库文档</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Spinner /> : <UploadIcon className="size-4" data-icon="inline-start" />}
          上传文档
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          加载中…
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          暂无文档。上传 .txt 或 .md 文件后，助手可以检索其中内容。
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-sm"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{doc.name}</span>
              <span className="text-xs text-muted-foreground">{doc.chunkCount} 块</span>
              <button
                onClick={() => handleDelete(doc.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete document"
              >
                <TrashIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
