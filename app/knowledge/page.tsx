"use client"

import * as React from "react"
import { UploadIcon, FileTextIcon, TrashIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

interface KnowledgeDoc {
  id: string
  name: string
  chunkCount: number
  size: number
  createdAt: number
}

export default function KnowledgePage() {
  const [docs, setDocs] = React.useState<KnowledgeDoc[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState("")
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
        await fetch("/api/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        })
      }
      await refreshDocs()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/knowledge?id=${id}`, {
      method: "DELETE",
      credentials: "include",
    })
    await refreshDocs()
  }

  const filtered = React.useMemo(() => {
    if (!query) return docs
    const q = query.toLowerCase()
    return docs.filter((d) => d.name.toLowerCase().includes(q))
  }, [docs, query])

  const totalSize = React.useMemo(
    () => docs.reduce((s, d) => s + (d.size ?? 0), 0),
    [docs]
  )
  const totalChunks = React.useMemo(
    () => docs.reduce((s, d) => s + d.chunkCount, 0),
    [docs]
  )

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">知识库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          上传文档后，AI 在对话时会自动检索其中内容作为上下文参考。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">文档数</div>
            <div className="mt-1 text-2xl font-semibold">{docs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">分块总数</div>
            <div className="mt-1 text-2xl font-semibold">{totalChunks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">存储大小</div>
            <div className="mt-1 text-2xl font-semibold">
              {(totalSize / 1024).toFixed(1)} KB
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>文档管理</CardTitle>
              <CardDescription>
                支持上传 .txt / .md / .markdown 文本文件
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="搜索文档名…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8 sm:w-56"
                />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.markdown"
                multiple
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? (
                  <Spinner className="size-4" data-icon="inline-start" />
                ) : (
                  <UploadIcon className="size-4" data-icon="inline-start" />
                )}
                上传文档
              </Button>
            </div>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Spinner />
              加载中…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <FileTextIcon className="size-10 text-muted-foreground/50" />
              <div className="text-sm text-muted-foreground">
                {docs.length === 0
                  ? "暂无文档，点击右上角「上传文档」开始。"
                  : "没有匹配的文档。"}
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <FileTextIcon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{doc.name}</div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{doc.chunkCount} 个分块</span>
                      <span>
                        {doc.size !== undefined
                          ? `${(doc.size / 1024).toFixed(1)} KB`
                          : ""}
                      </span>
                      <span>
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label="删除文档"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
