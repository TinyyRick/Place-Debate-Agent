import { z } from "zod";
import { CoordinatesSchema, type Coordinates } from "@/lib/schemas/location";

const ResponseSchema = z.object({ status: z.string(), info: z.string(), locations: z.string().optional() });

export async function convertGpsToAmap(gps: Coordinates, fetcher: typeof fetch = fetch): Promise<Coordinates> {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) throw new Error("AMAP_WEB_SERVICE_KEY is not configured in .env.local.");
  const url = new URL("https://restapi.amap.com/v3/assistant/coordinate/convert");
  url.search = new URLSearchParams({ key, locations: `${gps.longitude},${gps.latitude}`, coordsys: "gps", output: "JSON" }).toString();
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error("AMap coordinate conversion request failed.");
  const payload = ResponseSchema.parse(await response.json());
  if (payload.status !== "1" || !payload.locations) throw new Error(`AMap coordinate conversion failed: ${payload.info}.`);
  const [longitude, latitude] = payload.locations.split(";")[0].split(",").map(Number);
  return CoordinatesSchema.parse({ longitude, latitude });
}
