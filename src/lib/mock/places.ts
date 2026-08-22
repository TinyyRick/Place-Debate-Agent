import { PlaceFactPackSchema, PlaceCandidateSchema, type PlaceCandidate, type PlaceFactPack } from "@/lib/schemas/place";

export const mockCandidates: PlaceCandidate[] = PlaceCandidateSchema.array().parse([
  { id: "xuanwu-lake", name: "玄武湖", category: "park", typeCode: "110000", longitude: 118.8, latitude: 32.08, address: "", distanceMeters: 2100, rating: 4.7 },
  { id: "nanjing-museum", name: "南京博物院", category: "museum", typeCode: "140000", longitude: 118.84, latitude: 32.04, address: "", distanceMeters: 4200, rating: 4.8 },
  { id: "pioneer-bookstore", name: "先锋书店", category: "bookstore", typeCode: "060000", longitude: 118.82, latitude: 32.05, address: "", distanceMeters: 3700, rating: 4.6 },
]);

export const mockPlaces: PlaceFactPack[] = PlaceFactPackSchema.array().parse([
  {
    id: "xuanwu-lake",
    name: "玄武湖",
    category: "park",
    distanceMeters: 2100,
    travelTimeMinutes: 12,
    weather: { available: true, weather: "多云", temperatureC: 33, reportTime: "2026-08-22 12:00:00" },
    rating: 4.7,
    evidence: [
      { id: "XW_CATEGORY", type: "category", value: "park", source: "mock-place-data" },
      { id: "XW_DISTANCE", type: "distance", value: 2100, source: "mock-place-data" },
      { id: "XW_ROUTE", type: "route_time", value: 12, source: "mock-place-data" },
      { id: "XW_WEATHER", type: "weather", value: "33°C / cloudy", source: "mock-place-data" },
      { id: "XW_RATING", type: "rating", value: 4.7, source: "mock-place-data" },
    ],
  },
  {
    id: "nanjing-museum",
    name: "南京博物院",
    category: "museum",
    distanceMeters: 4200,
    travelTimeMinutes: 18,
    weather: { available: true, weather: "多云", temperatureC: 33, reportTime: "2026-08-22 12:00:00" },
    rating: 4.8,
    evidence: [
      { id: "NM_CATEGORY", type: "category", value: "museum", source: "mock-place-data" },
      { id: "NM_DISTANCE", type: "distance", value: 4200, source: "mock-place-data" },
      { id: "NM_ROUTE", type: "route_time", value: 18, source: "mock-place-data" },
      { id: "NM_WEATHER", type: "weather", value: "indoor", source: "mock-place-data" },
      { id: "NM_RATING", type: "rating", value: 4.8, source: "mock-place-data" },
    ],
  },
  {
    id: "pioneer-bookstore",
    name: "先锋书店",
    category: "bookstore",
    distanceMeters: 3700,
    travelTimeMinutes: 16,
    weather: { available: true, weather: "多云", temperatureC: 33, reportTime: "2026-08-22 12:00:00" },
    rating: 4.6,
    evidence: [
      { id: "PB_CATEGORY", type: "category", value: "bookstore", source: "mock-place-data" },
      { id: "PB_DISTANCE", type: "distance", value: 3700, source: "mock-place-data" },
      { id: "PB_ROUTE", type: "route_time", value: 16, source: "mock-place-data" },
      { id: "PB_WEATHER", type: "weather", value: "indoor", source: "mock-place-data" },
      { id: "PB_RATING", type: "rating", value: 4.6, source: "mock-place-data" },
    ],
  },
]);
