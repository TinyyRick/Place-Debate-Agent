import { z } from "zod";
import { RouteContextSchema, RouteModeSchema, type Coordinates, type RouteContext } from "@/lib/schemas/location";
import type { PlaceCandidate } from "@/lib/schemas/place";
const ResponseSchema = z.object({ status: z.string(), route: z.object({ paths: z.array(z.object({ distance: z.union([z.string(), z.number()]).optional(), cost: z.object({ duration: z.union([z.string(), z.number()]).optional() }).optional() })).default([]) }).optional() });
const number = (value: string | number | undefined) => Number.isFinite(Number(value)) ? Number(value) : undefined;
async function getRoute(mode: "walking" | "driving", origin: Coordinates, destination: PlaceCandidate, fetcher: typeof fetch): Promise<z.infer<typeof RouteModeSchema>> {
  const key = process.env.AMAP_WEB_SERVICE_KEY; if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL(`https://restapi.amap.com/v5/direction/${mode}`); url.search = new URLSearchParams({ key, origin: `${origin.longitude},${origin.latitude}`, destination: `${destination.longitude},${destination.latitude}`, destination_id: destination.id, ...(mode === "driving" ? { strategy: "32" } : {}), show_fields: "cost" }).toString();
  try { const response = await fetcher(url, { cache: "no-store" }); if (!response.ok) return { available: false }; const payload = ResponseSchema.parse(await response.json()); const path = payload.status === "1" ? payload.route?.paths[0] : undefined; const durationSeconds = number(path?.cost?.duration); const distanceMeters = number(path?.distance); return durationSeconds === undefined || distanceMeters === undefined ? { available: false } : { available: true, durationMinutes: Math.ceil(durationSeconds / 60), distanceMeters }; } catch { return { available: false }; }
}
export async function getRoutes(origin: Coordinates, destination: PlaceCandidate, fetcher: typeof fetch = fetch): Promise<RouteContext> {
  const [walking, driving] = await Promise.all([getRoute("walking", origin, destination, fetcher), getRoute("driving", origin, destination, fetcher)]);
  return RouteContextSchema.parse({ walking, driving });
}
