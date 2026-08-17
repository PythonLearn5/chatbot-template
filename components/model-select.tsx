"use client"

import * as React from "react"

import { type GatewayModel } from "@/lib/models"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// 模型分组显示
function buildGroups(models: GatewayModel[]) {
  const free = models.filter((m) => m.name.includes("(Free)"))
  const paid = models.filter((m) => !m.name.includes("(Free)"))
  const flagship = paid.filter(
    (m) =>
      m.id.includes("opus") ||
      m.id.includes("sonnet") ||
      m.id.includes("sol") ||
      m.id.includes("terra") ||
      m.id.includes("grok") ||
      m.id.includes("gemini-3.7") ||
      m.id.includes("qwen3.8-max") ||
      m.id.includes("kimi-k3")
  )
  const midRange = paid.filter((m) => !flagship.includes(m))

  return [
    { label: "旗舰模型", items: flagship },
    { label: "高性价比", items: midRange },
    { label: "免费模型", items: free },
  ].filter((g) => g.items.length > 0)
}

export function ModelSelect({
  models,
  value,
  onValueChange,
}: {
  models: GatewayModel[]
  value: string
  onValueChange: (value: string) => void
}) {
  const groups = React.useMemo(() => buildGroups(models), [models])

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next)
      }}
    >
      <SelectTrigger aria-label="Model" className="bg-background">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="min-w-72">
        {groups.map((group, gi) => (
          <React.Fragment key={group.label}>
            {gi > 0 && <SelectSeparator />}
            <SelectGroup>
              <SelectLabel className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </SelectLabel>
              {group.items.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <span className="flex w-full flex-col items-start gap-0.5">
                    <span className="font-medium">{model.name}</span>
                    {model.description && (
                      <span className="text-[10px] text-muted-foreground">
                        {model.description}
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </React.Fragment>
        ))}
      </SelectContent>
    </Select>
  )
}
