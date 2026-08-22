import { z } from "zod";
import { WeatherContextSchema, type WeatherContext } from "@/lib/schemas/location";
const ResponseSchema = z.object({ status: z.string(), lives: z.array(z.object({ weather: z.string().optional(), temperature: z.union([z.string(), z.number()]).optional(), humidity: z.union([z.string(), z.number()]).optional(), winddirection: z.string().optional(), windpower: z.string().optional(), reporttime: z.string().optional() })).default([]) });
const number = (value: string | number | undefined) => Number.isFinite(Number(value)) ? Number(value) : undefined;
export async function getCurrentWeather(adcode: string, fetcher: typeof fetch = fetch): Promise<WeatherContext> {
  const key = process.env.AMAP_WEB_SERVICE_KEY; if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL("https://restapi.amap.com/v3/weather/weatherInfo"); url.search = new URLSearchParams({ key, city: adcode, extensions: "base" }).toString();
  const response = await fetcher(url, { cache: "no-store" }); if (!response.ok) return { available: false };
  const payload = ResponseSchema.parse(await response.json()); const live = payload.status === "1" ? payload.lives[0] : undefined;
  return WeatherContextSchema.parse(live?.weather ? { available: true, weather: live.weather, temperatureC: number(live.temperature), humidity: number(live.humidity), windDirection: live.winddirection, windPower: live.windpower, reportTime: live.reporttime } : { available: false });
}
