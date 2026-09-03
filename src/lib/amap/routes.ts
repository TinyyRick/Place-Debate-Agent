import { z } from "zod";
import { RouteContextSchema, RouteModeSchema, TransitRouteSchema, type Coordinates, type RouteContext, type TransitRoute, type TransitStrategyRoutes } from "@/lib/schemas/location";
import type { PlaceCandidate } from "@/lib/schemas/place";
const ResponseSchema = z.object({ status: z.string(), route: z.object({ paths: z.array(z.object({ distance: z.union([z.string(), z.number()]).optional(), cost: z.object({ duration: z.union([z.string(), z.number()]).optional() }).optional() })).default([]) }).optional() });
const TransitResponseSchema = z.object({
  status: z.string(),
  route: z.object({ transits: z.union([z.array(z.unknown()), z.unknown()]).optional() }).optional(),
});
const number = (value: string | number | undefined) => Number.isFinite(Number(value)) ? Number(value) : undefined;
const asRecord = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const asArray = (value: unknown) => value === undefined ? [] : Array.isArray(value) ? value : [value];

export type RouteRequestOptions = { includeTransit?: boolean; cityCode?: string };
type TransitStrategyName = keyof TransitStrategyRoutes;
const TRANSIT_STRATEGIES: Array<{ name: TransitStrategyName; amapStrategy: string }> = [
  { name: "fastest", amapStrategy: "8" },
  { name: "leastWalking", amapStrategy: "3" },
  { name: "leastTransfers", amapStrategy: "2" },
];

async function getRoute(mode: "walking" | "driving", origin: Coordinates, destination: PlaceCandidate, fetcher: typeof fetch): Promise<z.infer<typeof RouteModeSchema>> {
  const key = process.env.AMAP_WEB_SERVICE_KEY; if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL(`https://restapi.amap.com/v5/direction/${mode}`); url.search = new URLSearchParams({ key, origin: `${origin.longitude},${origin.latitude}`, destination: `${destination.longitude},${destination.latitude}`, destination_id: destination.id, ...(mode === "driving" ? { strategy: "32" } : {}), show_fields: "cost" }).toString();
  try { const response = await fetcher(url, { cache: "no-store" }); if (!response.ok) return { available: false }; const payload = ResponseSchema.parse(await response.json()); const path = payload.status === "1" ? payload.route?.paths[0] : undefined; const durationSeconds = number(path?.cost?.duration); const distanceMeters = number(path?.distance); return durationSeconds === undefined || distanceMeters === undefined ? { available: false } : { available: true, durationMinutes: Math.ceil(durationSeconds / 60), distanceMeters }; } catch { return { available: false }; }
}

function findValue(record: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) if (record?.[key] !== undefined) return record[key];
}

function collectTransitLines(value: unknown, lines: Array<{ name: string; type: string }>) {
  if (Array.isArray(value)) { for (const item of value) collectTransitLines(item, lines); return; }
  const record = asRecord(value); if (!record) return;
  const name = typeof record.name === "string" ? record.name : "";
  const type = typeof record.type === "string" ? record.type : "";
  if (name && (type || /地铁|轨道|号线|公交|\d+路/.test(name))) lines.push({ name, type });
  for (const key of ["bus", "steps", "buslines", "busLines"]) collectTransitLines(record[key], lines);
}

function walkingDistance(segments: unknown[]) {
  return segments.reduce<number>((sum, segment) => {
    const walking = asRecord(asRecord(segment)?.walking);
    return sum + (number(findValue(walking, "distance", "distanceMeter", "distance_meter") as string | number | undefined) ?? 0);
  }, 0);
}

function normalizeTransit(transitValue: unknown): TransitRoute | undefined {
  const transit = asRecord(transitValue); if (!transit) return undefined;
  const segments = asArray(transit.segments);
  const rawLines: Array<{ name: string; type: string }> = [];
  for (const segment of segments) collectTransitLines(asRecord(segment)?.bus, rawLines);
  const seen = new Set<string>();
  const lines = rawLines.filter((line) => { const key = `${line.name}|${line.type}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const usesMetro = lines.some((line) => /地铁|轨道|subway|metro/i.test(`${line.name} ${line.type}`));
  const durationSeconds = number(findValue(asRecord(transit.cost), "duration") as string | number | undefined)
    ?? number(findValue(transit, "duration") as string | number | undefined);
  const transferCount = Math.max(0, lines.length - 1);
  return TransitRouteSchema.parse({
    status: "available",
    available: true,
    ...(durationSeconds === undefined ? {} : { durationMinutes: Math.ceil(durationSeconds / 60) }),
    walkingDistanceMeters: walkingDistance(segments),
    transferCount,
    usesMetro,
    directMetro: usesMetro && transferCount === 0,
    lineNames: lines.map((line) => line.name),
  });
}

function selectStrategyRoute(routes: TransitRoute[], strategy: TransitStrategyName) {
  const unknown = Number.MAX_SAFE_INTEGER;
  return [...routes].sort((left, right) => strategy === "fastest"
    ? (left.durationMinutes ?? unknown) - (right.durationMinutes ?? unknown)
    : strategy === "leastWalking"
      ? (left.walkingDistanceMeters ?? unknown) - (right.walkingDistanceMeters ?? unknown)
        || (left.durationMinutes ?? unknown) - (right.durationMinutes ?? unknown)
      : (left.transferCount ?? unknown) - (right.transferCount ?? unknown)
        || (left.durationMinutes ?? unknown) - (right.durationMinutes ?? unknown))[0];
}

async function getTransitRoute(origin: Coordinates, destination: PlaceCandidate, cityCode: string | undefined, strategy: TransitStrategyName, amapStrategy: string, fetcher: typeof fetch): Promise<TransitRoute> {
  if (!cityCode) return TransitRouteSchema.parse({ status: "unavailable", available: false, lineNames: [] });
  const key = process.env.AMAP_WEB_SERVICE_KEY; if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL("https://restapi.amap.com/v5/direction/transit/integrated");
  url.search = new URLSearchParams({ key, origin: `${origin.longitude},${origin.latitude}`, destination: `${destination.longitude},${destination.latitude}`, city1: cityCode, city2: cityCode, strategy: amapStrategy, AlternativeRoute: "3", show_fields: "cost" }).toString();
  try {
    const response = await fetcher(url, { cache: "no-store" }); if (!response.ok) return { status: "unavailable", available: false, lineNames: [] };
    const payload = TransitResponseSchema.parse(await response.json());
    if (payload.status !== "1") return { status: "unavailable", available: false, lineNames: [] };
    const routes = asArray(payload.route?.transits).flatMap((item) => { const route = normalizeTransit(item); return route ? [route] : []; });
    if (!routes.length) return { status: "no_route", available: false, lineNames: [] };
    return selectStrategyRoute(routes, strategy);
  } catch {
    return TransitRouteSchema.parse({ status: "unavailable", available: false, lineNames: [] });
  }
}

export async function getRoutes(origin: Coordinates, destination: PlaceCandidate, optionsOrFetcher: RouteRequestOptions | typeof fetch = {}, suppliedFetcher: typeof fetch = fetch): Promise<RouteContext> {
  const options = typeof optionsOrFetcher === "function" ? {} : optionsOrFetcher;
  const fetcher = typeof optionsOrFetcher === "function" ? optionsOrFetcher : suppliedFetcher;
  const [walking, driving, strategyEntries] = await Promise.all([
    getRoute("walking", origin, destination, fetcher),
    getRoute("driving", origin, destination, fetcher),
    options.includeTransit
      ? Promise.all(TRANSIT_STRATEGIES.map(async ({ name, amapStrategy }) => [name, await getTransitRoute(origin, destination, options.cityCode, name, amapStrategy, fetcher)] as const))
      : Promise.resolve(undefined),
  ]);
  const transitStrategies = strategyEntries ? Object.fromEntries(strategyEntries) as TransitStrategyRoutes : undefined;
  const availableRoutes = transitStrategies
    ? Object.values(transitStrategies).filter((route): route is TransitRoute => Boolean(route?.available))
    : [];
  // Keep the legacy `transit` summary for ranking and direct-metro constraints.
  // Prefer a direct route when one exists, then fewer transfers and less time.
  const transit = availableRoutes.sort((left, right) => Number(right.directMetro) - Number(left.directMetro)
    || (left.transferCount ?? Number.MAX_SAFE_INTEGER) - (right.transferCount ?? Number.MAX_SAFE_INTEGER)
    || (left.durationMinutes ?? Number.MAX_SAFE_INTEGER) - (right.durationMinutes ?? Number.MAX_SAFE_INTEGER))[0]
    ?? (strategyEntries ? transitStrategies?.fastest : undefined);
  return RouteContextSchema.parse({ walking, driving, ...(transit ? { transit } : {}), ...(transitStrategies ? { transitStrategies } : {}) });
}
