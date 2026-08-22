import { z } from "zod";
import { MetroAccessContextSchema, type MetroAccessContext, type PlaceCandidate } from "@/lib/schemas/place";

const ResponseSchema = z.object({ status: z.string(), pois: z.array(z.object({ name: z.string().optional(), location: z.string().optional(), distance: z.union([z.string(), z.number()]).optional(), type: z.string().optional() })).default([]) });
const numeric = (value: string | number | undefined) => Number.isFinite(Number(value)) ? Number(value) : undefined;
function normalizeStationName(name: string) { return name.replace(/\s*地铁站\s*[0-9一二三四五六七八九十]+号?[出入]?口\s*$/, "").replace(/\s*[0-9一二三四五六七八九十]+号?[出入]口\s*$/, "").replace(/\s*(地铁站|站)\s*$/, "").trim(); }

/** Queries only a finalist's surrounding transit POIs and collapses exits to their station name. */
export async function getMetroAccess(candidate: PlaceCandidate, fetcher: typeof fetch = fetch): Promise<MetroAccessContext> {
  const key = process.env.AMAP_WEB_SERVICE_KEY; if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL("https://restapi.amap.com/v5/place/around");
  url.search = new URLSearchParams({ key, location: `${candidate.longitude},${candidate.latitude}`, radius: "1500", types: "150500", page_size: "25", page_num: "1" }).toString();
  const response = await fetcher(url, { cache: "no-store" }); if (!response.ok) return { available: false };
  const payload = ResponseSchema.parse(await response.json());
  if (payload.status !== "1") return { available: false };
  const stations = payload.pois.flatMap((poi) => poi.name && numeric(poi.distance) !== undefined ? [{ name: normalizeStationName(poi.name), distanceMeters: numeric(poi.distance)! }] : []);
  if (!stations.length) return { available: false };
  const closest = stations.sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  return MetroAccessContextSchema.parse({ available: true, stationName: closest.name, distanceMeters: closest.distanceMeters });
}
