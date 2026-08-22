import { z } from "zod";
import { WeatherAssessmentSchema, WeatherContextSchema, type WeatherAssessment, type WeatherContext } from "@/lib/schemas/location";
const ResponseSchema = z.object({ status: z.string(), lives: z.array(z.object({ weather: z.string().optional(), temperature: z.union([z.string(), z.number()]).optional(), humidity: z.union([z.string(), z.number()]).optional(), winddirection: z.string().optional(), windpower: z.string().optional(), reporttime: z.string().optional() })).default([]) });
const number = (value: string | number | undefined) => Number.isFinite(Number(value)) ? Number(value) : undefined;

/** One deterministic weather reading shared by every agent and the moderator. */
export function assessWeather(weather: Pick<WeatherContext, "weather" | "temperatureC" | "humidity">): WeatherAssessment {
  const description = weather.weather ?? "";
  const severe = /暴雨|大暴雨|雷暴|台风|冰雹/.test(description);
  const rainy = /雨|雪|雷/.test(description);
  const temperatureLevel = (weather.temperatureC ?? 0) >= 30 ? "hot" : (weather.temperatureC ?? 0) >= 25 ? "warm" : "comfortable";
  const humidityLevel = (weather.humidity ?? 0) >= 70 ? "humid" : "normal";
  const rainImpact = severe ? "severe" : rainy ? "rainy" : "none";
  const outdoorComfort = severe ? "severe" : rainy ? "rainy" : temperatureLevel === "hot" && humidityLevel === "humid" ? "hot_humid" : temperatureLevel;
  return WeatherAssessmentSchema.parse({ outdoorComfort, temperatureLevel, humidityLevel, rainImpact });
}

export async function getCurrentWeather(adcode: string, fetcher: typeof fetch = fetch): Promise<WeatherContext> {
  const key = process.env.AMAP_WEB_SERVICE_KEY; if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL("https://restapi.amap.com/v3/weather/weatherInfo"); url.search = new URLSearchParams({ key, city: adcode, extensions: "base" }).toString();
  const response = await fetcher(url, { cache: "no-store" }); if (!response.ok) return { available: false };
  const payload = ResponseSchema.parse(await response.json()); const live = payload.status === "1" ? payload.lives[0] : undefined;
  if (!live?.weather) return WeatherContextSchema.parse({ available: false });
  const base = { available: true as const, weather: live.weather, temperatureC: number(live.temperature), humidity: number(live.humidity), windDirection: live.winddirection, windPower: live.windpower, reportTime: live.reporttime };
  return WeatherContextSchema.parse({ ...base, assessment: assessWeather(base) });
}
