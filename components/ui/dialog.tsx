"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface DialogContextValue {
  open: boolean
  setOpen: (v: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error("Dialog components must be used inside <Dialog>")
  return ctx
}

function Dialog({ children, open: openProp, onOpenChange }: {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = React.useState(openProp ?? false)

  const controlled = openProp !== undefined
  const open = controlled ? openProp : internalOpen

  const setOpen = React.useCallback(
    (v: boolean) => {
      if (!controlled) setInternalOpen(v)
      onOpenChange?.(v)
    },
    [controlled, onOpenChange]
  )

  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({ children, asChild }: {
  children: React.ReactNode
  asChild?: boolean
}) {
  const { setOpen } = useDialogContext()
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: (e: React.MouseEvent) => {
        ;(children as React.ReactElement<any>).props.onClick?.(e)
        if (!e.defaultPrevented) setOpen(true)
      },
    })
  }
  return (
    <button type="button" onClick={() => setOpen(true)}>
      {children}
    </button>
  )
}

function DialogPortal({ children }: { children: React.ReactNode }) {
  const { open } = useDialogContext()
  if (!open) return null
  return <>{children}</>
}

function DialogContent({ children, className }: {
  children: React.ReactNode
  className?: string
}) {
  const { setOpen } = useDialogContext()
  return (
    <DialogPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        onClick={() => setOpen(false)}
      >
        <div className="absolute inset-0 bg-black/50" />
        <div
          className={cn(
            "relative z-10 mx-auto w-full max-w-lg rounded-xl border bg-background p-6 shadow-lg",
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
          {children}
        </div>
      </div>
    </DialogPortal>
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
  const { setOpen } = useDialogContext()
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: (e: React.MouseEvent) => {
        ;(children as React.ReactElement<any>).props.onClick?.(e)
        if (!e.defaultPrevented) setOpen(false)
      },
    })
  }
  return (
    <button type="button" onClick={() => setOpen(false)}>
      {children}
    </button>
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
}
