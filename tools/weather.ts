import { tool } from "ai"
import { z } from "zod"

export const weather = tool({
  description:
    "Get weather forecast and travel advice for a city. Supports today, tomorrow, and multi-day forecasts. Use this when the user asks about weather, travel conditions, or packing suggestions for a trip.",
  inputSchema: z.object({
    city: z.string().describe("The city name, e.g. \"Beijing\", \"Shanghai\", \"New York\""),
    days: z
      .number()
      .int()
      .min(1)
      .max(7)
      .optional()
      .describe("Number of forecast days (1=today, 2=today+tomorrow, up to 7). Defaults to 1 (today only)."),
  }),
  outputSchema: z.union([
    z.object({ error: z.string() }),
    z.object({
      city: z.string(),
      forecasts: z.array(
        z.object({
          date: z.string(),
          dayLabel: z.string(),
          tempMax: z.number(),
          tempMin: z.number(),
          windSpeedMax: z.number(),
          weatherCode: z.number(),
          weatherDescription: z.string(),
          travelAdvice: z.string(),
        })
      ),
    }),
  ]),
  execute: async ({ city, days }, { abortSignal }) => {
    const forecastDays = Math.min(Math.max(days ?? 1, 1), 7)
    const timeout = AbortSignal.timeout(8000)
    const signal = abortSignal
      ? AbortSignal.any([abortSignal, timeout])
      : timeout

    try {
      // Step 1: Geocode the city name to get coordinates
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`,
        { signal }
      )
      if (!geoRes.ok) {
        return { error: `无法定位城市"${city}"。` }
      }
      const geoData = await geoRes.json()
      if (!geoData.results || geoData.results.length === 0) {
        return { error: `未找到城市"${city}"。` }
      }

      const { latitude, longitude, name } = geoData.results[0]

      // Step 2: Fetch daily forecast
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max` +
          `&forecast_days=${forecastDays}&timezone=auto`,
        { signal }
      )
      if (!weatherRes.ok) {
        return { error: `无法获取"${city}"的天气数据。` }
      }
      const weatherData = await weatherRes.json()
      const daily = weatherData.daily

      const dates: string[] = daily.time ?? []
      const tempMaxArr: number[] = daily.temperature_2m_max ?? []
      const tempMinArr: number[] = daily.temperature_2m_min ?? []
      const windMaxArr: number[] = daily.wind_speed_10m_max ?? []
      const codeArr: number[] = daily.weather_code ?? []

      const forecasts = dates.map((date, i) => {
        const tempMax = Number(tempMaxArr[i] ?? 0)
        const tempMin = Number(tempMinArr[i] ?? 0)
        const windSpeedMax = Number(windMaxArr[i] ?? 0)
        const weatherCode = Number(codeArr[i] ?? 0)
        const weatherDescription = describeWeatherCode(weatherCode)
        const dayLabel = i === 0 ? "今天" : i === 1 ? "明天" : i === 2 ? "后天" : `第${i + 1}天`

        return {
          date: String(date),
          dayLabel,
          tempMax,
          tempMin,
          windSpeedMax,
          weatherCode,
          weatherDescription,
          travelAdvice: generateTravelAdvice(tempMax, tempMin, weatherCode, windSpeedMax),
        }
      })

      return {
        city: String(name),
        forecasts,
      }
    } catch {
      return { error: `无法连接天气服务查询"${city}"。` }
    }
  },
})

// WMO Weather Code -> description
function describeWeatherCode(code: number): string {
  const map: Record<number, string> = {
    0: "晴",
    1: "大部晴朗",
    2: "多云",
    3: "阴天",
    45: "雾",
    48: "雾凇",
    51: "小雨",
    53: "中雨",
    55: "大雨",
    56: "冻雨",
    57: "强冻雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "阵雨",
    81: "中阵雨",
    82: "强阵雨",
    85: "阵雪",
    86: "强阵雪",
    95: "雷暴",
    96: "雷暴伴冰雹",
    99: "强雷暴伴冰雹",
  }
  return map[code] ?? "未知"
}

function generateTravelAdvice(
  tempMax: number,
  tempMin: number,
  weatherCode: number,
  windSpeed: number
): string {
  const tips: string[] = []
  const avgTemp = (tempMax + tempMin) / 2

  // Temperature advice (based on average of max/min)
  if (avgTemp < 0) {
    tips.push("气温低于0°C，建议穿厚羽绒服、戴帽子和手套，注意防寒保暖")
  } else if (avgTemp < 10) {
    tips.push("气温较低，建议穿厚外套或大衣")
  } else if (avgTemp < 20) {
    tips.push("气温凉爽，建议穿薄外套或长袖")
  } else if (avgTemp < 30) {
    tips.push("气温舒适，适合出行")
  } else {
    tips.push("气温较高，注意防晒补水，穿轻薄透气衣物")
  }

  // Weather condition advice
  if ([95, 96, 99].includes(weatherCode)) {
    tips.push("有雷暴天气，建议避免户外活动")
  } else if ([61, 63, 65, 80, 81, 82].includes(weatherCode)) {
    tips.push("有降雨，记得带伞")
  } else if ([71, 73, 75, 85, 86].includes(weatherCode)) {
    tips.push("有降雪，路面可能湿滑，注意交通安全")
  } else if ([45, 48].includes(weatherCode)) {
    tips.push("有雾，能见度低，驾车请减速慢行")
  }

  // Wind advice
  if (windSpeed > 30) {
    tips.push("风力较大，户外活动请注意安全")
  }

  // Day/night温差
  const diff = tempMax - tempMin
  if (diff >= 10) {
    tips.push(`昼夜温差大（${diff.toFixed(0)}°C），建议携带外套备用`)
  }

  return tips.join("；")
}
