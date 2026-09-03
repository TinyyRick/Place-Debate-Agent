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
    await expect(reverseGeocode({ longitude: 118.7, latitude: 32 }, async () => json({ status: "1", info: "OK", regeocode: { formatted_address: "南京市玄武区", addressComponent: { province: "江苏省", city: "南京市", district: "玄武区", adcode: "320102", citycode: "025" } } }))).resolves.toMatchObject({ formattedAddress: "南京市玄武区", adcode: "320102", cityCode: "025" });
    await expect(getCurrentWeather("320102", async () => json({ status: "1", lives: [{ weather: "小雨", temperature: "31", humidity: "70", winddirection: "东", windpower: "3", reporttime: "2026-08-22 10:00:00" }] }))).resolves.toMatchObject({ available: true, weather: "小雨", temperatureC: 31, assessment: { outdoorComfort: "rainy", temperatureLevel: "hot", humidityLevel: "humid", rainImpact: "rainy" } });
  });

  it("keeps fastest, least-walking and least-transfer transit strategies separately", async () => {
    const poi = PlaceCandidateSchema.parse({ id: "p", name: "羽毛球馆", category: "运动场馆", typeCode: "080101", longitude: 118.8, latitude: 32.1, address: "", distanceMeters: 800 });
    const transitStrategies: string[] = [];
    const routes = await getRoutes({ longitude: 118.7, latitude: 32 }, poi, { includeTransit: true, cityCode: "025" }, async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("transit")) {
        const strategy = url.searchParams.get("strategy") ?? "";
        transitStrategies.push(strategy);
        const transits = strategy === "8"
          ? [
              { cost: { duration: "1200" }, segments: [{ walking: { distance: "300" }, bus: { buslines: [{ name: "地铁1号线", type: "地铁线路" }] } }] },
              { cost: { duration: "900" }, segments: [{ walking: { distance: "900" }, bus: { buslines: [{ name: "地铁1号线", type: "地铁线路" }, { name: "地铁2号线", type: "地铁线路" }] } }] },
            ]
          : strategy === "3"
            ? [
                { cost: { duration: "1500" }, segments: [{ walking: { distance: "100" }, bus: { buslines: [{ name: "地铁3号线", type: "地铁线路" }] } }] },
                { cost: { duration: "1200" }, segments: [{ walking: { distance: "350" }, bus: { buslines: [{ name: "地铁1号线", type: "地铁线路" }] } }] },
              ]
            : [
                { cost: { duration: "1800" }, segments: [{ walking: { distance: "250" }, bus: { buslines: [{ name: "地铁3号线", type: "地铁线路" }] } }] },
                { cost: { duration: "1000" }, segments: [{ walking: { distance: "200" }, bus: { buslines: [{ name: "地铁1号线", type: "地铁线路" }, { name: "地铁2号线", type: "地铁线路" }] } }] },
              ];
        return json({ status: "1", route: { transits } });
      }
      return json({ status: "1", route: { paths: [{ distance: "1200", cost: { duration: "600" } }] } });
    });
    expect(transitStrategies.sort()).toEqual(["2", "3", "8"]);
    expect(routes.transitStrategies).toMatchObject({
      fastest: { durationMinutes: 15, walkingDistanceMeters: 900, transferCount: 1 },
      leastWalking: { durationMinutes: 25, walkingDistanceMeters: 100, transferCount: 0 },
      leastTransfers: { durationMinutes: 30, walkingDistanceMeters: 250, transferCount: 0 },
    });
    expect(routes.transit).toMatchObject({ status: "available", directMetro: true, transferCount: 0, durationMinutes: 25, walkingDistanceMeters: 100 });
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
    const intentExperience = { activityLevel: 0.5, engagementType: "exploration" as const, socialFit: "solo" as const, pace: 0.5, spatial: "mixed" as const, stimulation: 0.5, costTier: "low" as const };
    const ranked = finalRankCandidates([outdoor, indoor], preference, intentExperience);
    expect(ranked[0].id).toBe("museum");
  });
});
