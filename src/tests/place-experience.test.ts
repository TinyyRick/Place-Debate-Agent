import { describe, expect, it, vi } from "vitest";
import { filterIntentCompatiblePois, hardFilterPois, rankCandidates } from "@/lib/ranking/ranker";
import { experienceMatchScore, isExperienceCompatible, NEUTRAL_EXPERIENCE_PROFILE, scorePlaceExperiences } from "@/lib/experience/place-experience-scorer";
import { PlaceCandidateSchema } from "@/lib/schemas/place";
import { deterministicModel } from "./fixtures/deterministic-model";
import type { StructuredModel } from "@/lib/agents/model-factory";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { ZodType } from "zod";

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
  it("scores large candidate sets in chunks and degrades only a failed chunk", async () => {
    let calls = 0;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const chunkModel: StructuredModel = {
      async invoke<T extends Record<string, unknown>>(schema: ZodType<T>, messages: BaseMessageLike[]): Promise<T> {
        calls += 1;
        const lastMessage = messages.at(-1) as { content: string };
        const chunk = JSON.parse(lastMessage.content) as Array<{ poiId: string }>;
        if (calls === 2) throw new Error("invalid structured output");
        return schema.parse({ items: chunk.map(({ poiId }) => ({
          poiId, activityLevel: 0.5, engagementType: "exploration", socialFit: "either", pace: 0.5, spatial: "mixed", stimulation: 0.5, costTier: "low",
        })) });
      },
    };
    const candidates = Array.from({ length: 31 }, (_, index) => PlaceCandidateSchema.parse({
      id: `candidate-${index}`, name: `候选地点${index}`, category: "风景名胜;公园广场", typeCode: "110000",
      longitude: 118.8 + index / 10_000, latitude: 32.06, address: "南京", distanceMeters: 500 + index,
    }));

    const result = await scorePlaceExperiences(candidates, chunkModel);
    const scored = result.candidates;

    expect(calls).toBe(3);
    expect(scored).toHaveLength(31);
    expect(result.metrics).toEqual({ totalCandidates: 31, totalChunks: 3, failedChunks: 1, fallbackCandidates: 15 });
    expect(scored[0]?.experienceProfile?.engagementType).toBe("exploration");
    expect(scored[15]?.experienceProfile).toEqual(NEUTRAL_EXPERIENCE_PROFILE);
    expect(warning).toHaveBeenCalledWith("Place experience scoring chunk failed; using neutral profiles.", expect.objectContaining({ poiIds: expect.arrayContaining(["candidate-15"]) }));
    warning.mockRestore();
  });

  it("rejects an indoor place for a specific outdoor experience while retaining mixed-space places", () => {
    const outdoorIntent = { ...wanderIntent, spatial: "outdoor" as const };
    const indoorMuseum = { ...wanderIntent, spatial: "indoor" as const };
    const mixedPlace = { ...wanderIntent, spatial: "mixed" as const };
    const fallbackFunctionalPlace = { ...wanderIntent, engagementType: "functional" as const, source: "fallback" as const };

    expect(isExperienceCompatible(outdoorIntent, indoorMuseum)).toBe(false);
    expect(isExperienceCompatible(outdoorIntent, mixedPlace)).toBe(true);
    expect(isExperienceCompatible(wanderIntent, fallbackFunctionalPlace)).toBe(true);
  });

  it("filters 手语博物馆 when the request is for outdoor scenery", async () => {
    const outdoorIntent = { ...wanderIntent, spatial: "outdoor" as const };
    const candidates = [
      { id: "sign-language-museum", name: "手语博物馆", category: "科教文化服务;博物馆", typeCode: "140100" },
      { id: "outdoor-park", name: "玄武湖公园", category: "风景名胜;公园广场", typeCode: "110000" },
    ].map((candidate, index) => PlaceCandidateSchema.parse({
      ...candidate,
      longitude: 118.8 + index / 100,
      latitude: 32.06,
      address: "南京",
      distanceMeters: 800 + index * 100,
    }));
    const { candidates: scored } = await scorePlaceExperiences(candidates, deterministicModel);
    const museum = scored.find((candidate) => candidate.id === "sign-language-museum");

    expect(museum?.experienceProfile?.spatial).toBe("indoor");
    expect(filterIntentCompatiblePois(hardFilterPois(scored), outdoorIntent).map((candidate) => candidate.id)).not.toContain("sign-language-museum");
  });

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

    const { candidates: scored } = await scorePlaceExperiences(candidates, deterministicModel);
    const filtered = filterIntentCompatiblePois(hardFilterPois(scored), wanderIntent);
    const ranked = rankCandidates(filtered, preference, wanderIntent);

    expect(scored).toHaveLength(3);
    expect(scored.find((candidate) => candidate.id === "study-room")?.experienceProfile?.engagementType).toBe("functional");
    expect(filtered.map((candidate) => candidate.id)).toEqual(["nanjing-museum", "old-camera-museum"]);
    expect(ranked.map((candidate) => candidate.id)).toEqual(expect.arrayContaining(["nanjing-museum", "old-camera-museum"]));
    expect(experienceMatchScore(wanderIntent, scored[0].experienceProfile!)).toBeLessThan(experienceMatchScore(wanderIntent, scored[1].experienceProfile!));
  });

  it("excludes a single-purpose fruit shop from indoor exploration", async () => {
    const indoorExplorer = { ...wanderIntent, spatial: "indoor" as const };
    const candidates = [
      { id: "cut-fruit", name: "切果NOW", category: "购物服务;综合市场", typeCode: "060200" },
      { id: "nanjing-museum", name: "南京博物馆", category: "科教文化服务;博物馆", typeCode: "140100" },
      { id: "old-camera-museum", name: "老相机艺术馆", category: "科教文化服务;展览馆", typeCode: "140200" },
    ].map((candidate, index) => PlaceCandidateSchema.parse({
      ...candidate,
      longitude: 118.8 + index / 100,
      latitude: 32.06,
      address: "南京",
      distanceMeters: 800 + index * 100,
    }));

    const { candidates: scored } = await scorePlaceExperiences(candidates, deterministicModel);
    const filtered = filterIntentCompatiblePois(hardFilterPois(scored), indoorExplorer);

    expect(scored.find((candidate) => candidate.id === "cut-fruit")?.experienceProfile?.engagementType).toBe("functional");
    expect(filtered.map((candidate) => candidate.id)).not.toContain("cut-fruit");
  });

  it("treats quiet rest as rest, excludes retail, and preserves a self-study room", async () => {
    const quietRestIntent = {
      activityLevel: 0.1,
      engagementType: "rest" as const,
      socialFit: "either" as const,
      pace: 0.1,
      spatial: "mixed" as const,
      stimulation: 0.1,
      costTier: "low" as const,
    };
    const candidates = [
      { id: "vape-shop", name: "幸运星电子烟", category: "购物服务;专卖店", typeCode: "061000" },
      { id: "study-room", name: "壹心空间自习室", category: "科教文化服务;科教文化场所", typeCode: "140000" },
      { id: "museum-storage", name: "南京博物院文物库房", category: "科教文化服务;博物馆", typeCode: "140100" },
    ].map((candidate, index) => PlaceCandidateSchema.parse({
      ...candidate, longitude: 118.8 + index / 100, latitude: 32.06, address: "南京", distanceMeters: 800 + index * 100,
    }));

    const preScoring = hardFilterPois(candidates);
    const { candidates: scored } = await scorePlaceExperiences(preScoring, deterministicModel);
    const compatible = filterIntentCompatiblePois(scored, quietRestIntent);

    expect(preScoring.map((candidate) => candidate.id)).not.toContain("museum-storage");
    expect(scored.find((candidate) => candidate.id === "vape-shop")?.experienceProfile?.engagementType).toBe("consumption");
    expect(compatible.map((candidate) => candidate.id)).not.toContain("vape-shop");
    expect(compatible.map((candidate) => candidate.id)).toContain("study-room");
  });
});
