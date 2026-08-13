"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({ children, open, onOpenChange }: {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogRoot>
  )
}

function DialogRoot({ children, open: openProp, onOpenChange }: {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = React.useState(openProp ?? false)

  React.useEffect(() => {
    if (openProp !== undefined) setOpen(openProp)
  }, [openProp])

  const handleOpenChange = (v: boolean) => {
    setOpen(v)
    onOpenChange?.(v)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => handleOpenChange(false)}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative z-10 w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function DialogTrigger({ children, asChild }: {
  children: React.ReactNode
  asChild?: boolean
}) {
  return <>{children}</>
}

function DialogContent({ children, className }: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full rounded-xl border bg-background p-6 shadow-lg",
        className
      )}
    >
      {children}
    </div>
  )
}

function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>
}

function DialogTitle({ children, className }: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2 className={cn("text-lg font-semibold", className)}>{children}</h2>
  )
}

function DialogClose({ children, asChild }: {
  children: React.ReactNode
  asChild?: boolean
}) {
  return <>{children}</>
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
}
