import { z } from "zod";
import { PlaceCandidateSchema, type PlaceCandidate } from "@/lib/schemas/place";
import type { Coordinates } from "@/lib/schemas/location";
import type { AMapQueryMetric, SearchPlan } from "@/lib/schemas/search-plan";

export const NANJING_TEST_LOCATION = {
  longitude: 118.796877,
  latitude: 32.060255,
} as const;

const AMapResponseSchema = z.object({
  status: z.string(),
  info: z.string(),
  infocode: z.string(),
  pois: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    parent: z.string().optional(),
    type: z.string().optional(),
    typecode: z.string().optional(),
    location: z.string().optional(),
    address: z.union([z.string(), z.array(z.unknown())]).optional(),
    distance: z.union([z.string(), z.number()]).optional(),
    children: z.array(z.object({ id: z.string().optional() })).optional(),
    business: z.object({ rating: z.union([z.string(), z.number()]).optional() }).optional(),
    indoor: z.object({ cpid: z.string().optional() }).optional(),
  })).default([]),
});

function toFiniteNumber(value: string | number | undefined) {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function parseLocation(location: string | undefined) {
  const [longitude, latitude] = (location ?? "").split(",").map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : undefined;
}

function straightLineDistanceMeters(longitude: number, latitude: number, origin: Coordinates) {
  const toRadians = (value: number) => value * (Math.PI / 180);
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = toRadians(latitude - origin.latitude);
  const deltaLongitude = toRadians(longitude - origin.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(origin.latitude))
    * Math.cos(toRadians(latitude))
    * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function retrieveNearbyPoisWithMetrics(origin: Coordinates = NANJING_TEST_LOCATION, plan: SearchPlan): Promise<{ pois: PlaceCandidate[]; queryMetrics: AMapQueryMetric[] }> {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");

  const responses = await Promise.all(plan.queries.map(async (query) => {
    const url = new URL("https://restapi.amap.com/v5/place/around");
    url.search = new URLSearchParams({
      key,
      location: `${origin.longitude},${origin.latitude}`,
      radius: String(plan.radiusMeters),
      types: query.typeCodes,
      ...(query.searchKeyword ? { keywords: query.searchKeyword } : {}),
      page_size: "25",
      page_num: "1",
      show_fields: "business,children,indoor",
    }).toString();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`AMap ${query.label} POI request failed with HTTP ${response.status}.`);
    const payload = AMapResponseSchema.parse(await response.json());
    if (payload.status !== "1") throw new Error(`AMap ${query.label} POI request failed: ${payload.info} (${payload.infocode}).`);
    return { query, pois: payload.pois };
  }));

  const byId = new Map<string, PlaceCandidate>();
  for (const { pois } of responses) for (const poi of pois) {
    const location = parseLocation(poi.location);
    if (!poi.id || !poi.name || !poi.type || !poi.typecode || !location) continue;
    const rating = toFiniteNumber(poi.business?.rating);
    const candidate = {
      id: poi.id,
      name: poi.name,
      category: poi.type,
      typeCode: poi.typecode,
      longitude: location.longitude,
      latitude: location.latitude,
      address: typeof poi.address === "string" ? poi.address : "",
      distanceMeters: toFiniteNumber(poi.distance)
        ?? straightLineDistanceMeters(location.longitude, location.latitude, origin),
      ...(rating !== undefined && rating >= 0 && rating <= 5 ? { rating } : {}),
      ...(poi.parent ? { parentId: poi.parent } : {}),
      childCount: poi.children?.length ?? 0,
      ...(poi.indoor?.cpid ? { indoorCpid: poi.indoor.cpid } : {}),
    };
    byId.set(poi.id, PlaceCandidateSchema.parse(candidate));
  }
  const queryMetrics = responses.map(({ query, pois }) => ({ label: query.label, typeCodes: query.typeCodes, rawCount: pois.length }));
  console.info("AMap raw POI recall", { queryMetrics });
  return { pois: [...byId.values()], queryMetrics };
}

export async function retrieveNearbyPois(origin: Coordinates = NANJING_TEST_LOCATION, plan: SearchPlan): Promise<PlaceCandidate[]> {
  return (await retrieveNearbyPoisWithMetrics(origin, plan)).pois;
}
