import { CloudSunIcon } from "lucide-react"

import { type WeatherToolPart } from "@/tools"
import { Spinner } from "@/components/ui/spinner"

export function WeatherPart({ part }: { part: WeatherToolPart }) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在查询{part.input?.city ? ` ${part.input.city} ` : ""}天气…
        </div>
      )
    case "output-available": {
      if (!part.output) {
        return null
      }
      if ("error" in part.output) {
        return (
          <div className="text-sm text-destructive">{String((part.output as any).error)}</div>
        )
      }
      const o = part.output as any
      return (
        <div className="flex w-fit flex-col gap-1.5 px-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CloudSunIcon className="size-4" />
            <span className="font-medium text-foreground">
              {o.city}
            </span>
          </div>
          {(o.forecasts ?? []).map((f: any, i: number) => (
            <div key={i} className="flex items-center gap-3 pl-6">
              <span className="w-16 shrink-0 font-medium text-foreground">{f.dayLabel}</span>
              <span className="w-20 shrink-0 text-muted-foreground">{f.date}</span>
              <span>{f.tempMin}–{f.tempMax}°C</span>
              <span>{f.weatherDescription}</span>
              <span>最大风速 {f.windSpeedMax} km/h</span>
            </div>
          ))}
          {o.travelAdvice && (
            <div className="pl-6 text-xs text-foreground/80 italic">
              🧳 出行建议：{o.travelAdvice}
            </div>
          )}
        </div>
      )
    }
    case "output-error":
      return (
        <div className="text-sm text-destructive">
          天气查询失败：{part.errorText}
        </div>
      )
    default:
      return null
  }
}
