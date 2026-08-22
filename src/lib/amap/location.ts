import { z } from "zod";
import { CoordinatesSchema, LocationContextSchema, type Coordinates, type LocationContext } from "@/lib/schemas/location";
import { convertGpsToAmap } from "./coordinate";
import { NANJING_TEST_LOCATION } from "./places";

const RegeoSchema = z.object({ status: z.string(), info: z.string(), regeocode: z.object({ formatted_address: z.string().optional(), addressComponent: z.object({ province: z.string().optional(), city: z.union([z.string(), z.array(z.string())]).optional(), district: z.string().optional(), adcode: z.string().optional() }).optional() }).optional() });

export async function reverseGeocode(amapCoordinates: Coordinates, fetcher: typeof fetch = fetch) {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL("https://restapi.amap.com/v3/geocode/regeo");
  url.search = new URLSearchParams({ key, location: `${amapCoordinates.longitude},${amapCoordinates.latitude}`, extensions: "base" }).toString();
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error("AMap reverse geocoding request failed.");
  const payload = RegeoSchema.parse(await response.json());
  const component = payload.regeocode?.addressComponent;
  if (payload.status !== "1" || !payload.regeocode?.formatted_address || !component?.adcode) throw new Error(`AMap reverse geocoding failed: ${payload.info}.`);
  return { formattedAddress: payload.regeocode.formatted_address, province: component.province, city: typeof component.city === "string" ? component.city : undefined, district: component.district, adcode: component.adcode };
}

export async function resolveLocation(gpsCoordinates?: Coordinates): Promise<LocationContext> {
  const source = gpsCoordinates ? "browser" : "test";
  const amapCoordinates = gpsCoordinates ? await convertGpsToAmap(gpsCoordinates) : CoordinatesSchema.parse(NANJING_TEST_LOCATION);
  return LocationContextSchema.parse({ source, ...(gpsCoordinates ? { gpsCoordinates } : {}), amapCoordinates, ...await reverseGeocode(amapCoordinates) });
}
