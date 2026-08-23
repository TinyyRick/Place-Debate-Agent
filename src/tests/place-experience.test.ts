import { describe, expect, it } from "vitest";
import { filterIntentCompatiblePois, hardFilterPois, rankCandidates } from "@/lib/ranking/ranker";
import { experienceMatchScore, scorePlaceExperiences } from "@/lib/experience/place-experience-scorer";
import { PlaceCandidateSchema } from "@/lib/schemas/place";
import { deterministicModel } from "./fixtures/deterministic-model";

const wanderIntent = {
  activityLevel: 0.7,
  engagementType: "exploration" as const,
  socialFit: "solo" as const,
  pace: 0.5,
  spatial: "mixed" as const,
  stimulation: 0.5,
  costTier: "low" as const,
};

const preference = {
  activityLevel: "low" as const,
  indoorPreference: 0.5,
  naturePreference: 0.5,
  culturePreference: 0.8,
  budgetLevel: "low" as const,
  companions: "solo" as const,
  transportPreference: "flexible" as const,
  movementPreference: "walk_around" as const,
  distanceTolerance: "near" as const,
  heatTolerance: 0.5,
  rainTolerance: 0.5,
  freeTextConstraints: [],
};

describe("place experience layer", () => {
  it("excludes a self-study room from a solo wandering request while retaining museums", async () => {
    const candidates = [
      { id: "study-room", name: "一心空间自习室", category: "科教文化服务;科教文化场所", typeCode: "140000" },
      { id: "nanjing-museum", name: "南京博物馆", category: "科教文化服务;博物馆", typeCode: "140100" },
      { id: "old-camera-museum", name: "老相机艺术馆", category: "科教文化服务;展览馆", typeCode: "140200" },
    ].map((candidate, index) => PlaceCandidateSchema.parse({
      ...candidate,
      longitude: 118.8 + index / 100,
      latitude: 32.06,
      address: "南京",
      distanceMeters: 800 + index * 100,
    }));

    const scored = await scorePlaceExperiences(candidates, deterministicModel);
    const filtered = filterIntentCompatiblePois(hardFilterPois(scored), wanderIntent);
    const ranked = rankCandidates(filtered, preference, wanderIntent);

    expect(scored).toHaveLength(3);
    expect(scored.find((candidate) => candidate.id === "study-room")?.experienceProfile?.engagementType).toBe("functional");
    expect(filtered.map((candidate) => candidate.id)).toEqual(["nanjing-museum", "old-camera-museum"]);
    expect(ranked.map((candidate) => candidate.id)).toEqual(expect.arrayContaining(["nanjing-museum", "old-camera-museum"]));
    expect(experienceMatchScore(wanderIntent, scored[0].experienceProfile!)).toBeLessThan(experienceMatchScore(wanderIntent, scored[1].experienceProfile!));
  });
});
