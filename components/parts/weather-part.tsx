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
    case "output-available":
      if ("error" in part.output) {
        return (
          <div className="text-sm text-destructive">{part.output.error}</div>
        )
      }
      return (
        <div className="flex w-fit items-center gap-3 px-1.5 text-sm text-muted-foreground">
          <CloudSunIcon className="size-4" />
          <span className="font-medium text-foreground">
            {part.output.city}
          </span>
          <span>{part.output.temperature}°C</span>
          <span>{part.output.weatherDescription}</span>
          <span>风速 {part.output.windSpeed} km/h</span>
        </div>
      )
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
