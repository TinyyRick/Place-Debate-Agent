import { describe, expect, it } from "vitest";
import { createFactPacks, hardFilterPois, rankCandidates } from "@/lib/ranking/ranker";
import type { PlaceCandidate } from "@/lib/schemas/place";
import type { UserPreference } from "@/lib/schemas/preference";

const preference: UserPreference = {
  activityLevel: "low",
  indoorPreference: 0.4,
  naturePreference: 0.8,
  culturePreference: 0.5,
  budgetLevel: "flexible",
  companions: "solo",
  freeTextConstraints: ["有点意思"],
};

const candidates: PlaceCandidate[] = [
  { id: "near-park", name: "近处公园", category: "风景名胜", typeCode: "110000", longitude: 118.8, latitude: 32.06, address: "", distanceMeters: 500, rating: 4.5 },
  { id: "far-museum", name: "远处博物馆", category: "博物馆", typeCode: "140000", longitude: 118.9, latitude: 32.1, address: "", distanceMeters: 5_100 },
  { id: "wrong-type", name: "餐厅", category: "餐饮", typeCode: "050000", longitude: 118.81, latitude: 32.06, address: "", distanceMeters: 300, rating: 5 },
  { id: "duplicate-park", name: "近处公园", category: "风景名胜", typeCode: "110000", longitude: 118.80001, latitude: 32.06001, address: "", distanceMeters: 550, rating: 4.6 },
  { id: "museum", name: "博物馆", category: "博物馆", typeCode: "140000", longitude: 118.82, latitude: 32.07, address: "", distanceMeters: 1_000 },
];

describe("candidate filtering and ranking", () => {
  it("keeps only supported, nearby, de-duplicated POIs", () => {
    expect(hardFilterPois(candidates).map((candidate) => candidate.id)).toEqual(["near-park", "museum"]);
  });

  it("uses deterministic scores and produces grounded AMap evidence", () => {
    const ranked = rankCandidates(hardFilterPois(candidates), preference);
    expect(ranked.map((candidate) => candidate.id)).toEqual(["near-park", "museum"]);
    expect(ranked[0].preliminaryScore).toBe(0.8175);

    const [factPack] = createFactPacks(ranked);
    expect(factPack.evidence.map((evidence) => evidence.id)).toEqual([
      "AMAP_near-park_CATEGORY",
      "AMAP_near-park_DISTANCE",
      "AMAP_near-park_RATING",
    ]);
  });
});
