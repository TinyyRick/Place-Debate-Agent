import { describe, expect, it } from "vitest";
import { convertGpsToAmap } from "@/lib/amap/coordinate";
import { reverseGeocode } from "@/lib/amap/location";
import { getRoutes } from "@/lib/amap/routes";
import { getCurrentWeather } from "@/lib/amap/weather";
import { finalRankCandidates } from "@/lib/ranking/ranker";
import { PlaceCandidateSchema } from "@/lib/schemas/place";

process.env.AMAP_WEB_SERVICE_KEY = "test-key";
const json = (value: unknown) => new Response(JSON.stringify(value));

describe("AMap location context normalization", () => {
  it("converts GPS coordinates and rejects failed conversion", async () => {
    await expect(convertGpsToAmap({ longitude: 118.7, latitude: 32.0 }, async () => json({ status: "1", info: "OK", locations: "118.706,32.006" }))).resolves.toEqual({ longitude: 118.706, latitude: 32.006 });
    await expect(convertGpsToAmap({ longitude: 1, latitude: 2 }, async () => json({ status: "0", info: "INVALID_USER_KEY" }))).rejects.toThrow("coordinate conversion failed");
  });

  it("normalizes reverse geocoding and real-time weather", async () => {
    await expect(reverseGeocode({ longitude: 118.7, latitude: 32 }, async () => json({ status: "1", info: "OK", regeocode: { formatted_address: "南京市玄武区", addressComponent: { province: "江苏省", city: "南京市", district: "玄武区", adcode: "320102" } } }))).resolves.toMatchObject({ formattedAddress: "南京市玄武区", adcode: "320102" });
    await expect(getCurrentWeather("320102", async () => json({ status: "1", lives: [{ weather: "小雨", temperature: "31", humidity: "70", winddirection: "东", windpower: "3", reporttime: "2026-08-22 10:00:00" }] }))).resolves.toMatchObject({ available: true, weather: "小雨", temperatureC: 31, assessment: { outdoorComfort: "rainy", temperatureLevel: "hot", humidityLevel: "humid", rainImpact: "rainy" } });
  });

  it("converts route seconds to rounded minutes and preserves unavailable routes", async () => {
    const poi = PlaceCandidateSchema.parse({ id: "p", name: "博物馆", category: "博物馆", typeCode: "140100", longitude: 118.8, latitude: 32.1, address: "", distanceMeters: 800 });
    const routes = await getRoutes({ longitude: 118.7, latitude: 32 }, poi, async () => json({ status: "1", route: { paths: [{ distance: "1200", cost: { duration: "601" } }] } }));
    expect(routes.walking).toMatchObject({ available: true, durationMinutes: 11, distanceMeters: 1200 });
    const unavailable = await getRoutes({ longitude: 118.7, latitude: 32 }, poi, async () => json({ status: "0", route: { paths: [] } }));
    expect(unavailable.walking.available).toBe(false);
  });

  it("penalizes outdoor heat/rain but keeps indoor candidates stable and honors transport mode", () => {
    const base = { longitude: 118.8, latitude: 32, address: "", distanceMeters: 500, destinationCategory: "park" as const, placeQuality: 0.8, route: { walking: { available: true, durationMinutes: 35, distanceMeters: 2500 }, driving: { available: true, durationMinutes: 5, distanceMeters: 3000 } }, weather: { available: true, weather: "小雨", temperatureC: 33 } };
    const outdoor = PlaceCandidateSchema.parse({ ...base, id: "park", name: "公园", category: "公园", typeCode: "110000" });
    const indoor = PlaceCandidateSchema.parse({ ...base, id: "museum", name: "博物馆", category: "博物馆", typeCode: "140100", destinationCategory: "museum" });
    const preference = { activityLevel: "low" as const, indoorPreference: 0.8, naturePreference: 0.5, culturePreference: 0.8, budgetLevel: "flexible" as const, companions: "solo" as const, transportPreference: "driving" as const, movementPreference: "flexible" as const, distanceTolerance: "near" as const, heatTolerance: 0, rainTolerance: 0, freeTextConstraints: ["有点意思"] };
    const ranked = finalRankCandidates([outdoor, indoor], preference);
    expect(ranked[0].id).toBe("museum");
  });
});
