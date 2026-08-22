import { describe, expect, it } from "vitest";
import { runDebate } from "@/lib/graph/debate-graph";
import { mockCandidates } from "@/lib/mock/places";
import { deterministicModel } from "./fixtures/deterministic-model";

describe("debate graph", () => {
  it("runs from START through moderatorSummary to END with a mock model", async () => {
    const result = await runDebate("想出去走走，但是不要太累。", deterministicModel, {
      retrievePlaces: async () => mockCandidates,
    }, undefined, {
      resolveLocation: async () => ({ source: "test", amapCoordinates: { longitude: 118.8, latitude: 32.06 }, formattedAddress: "南京市玄武区", adcode: "320102" }),
      getWeather: async () => ({ available: true, weather: "多云", temperatureC: 30, reportTime: "2026-08-22 12:00:00" }),
      getRoutes: async () => ({ walking: { available: true, durationMinutes: 12, distanceMeters: 800 }, driving: { available: true, durationMinutes: 5, distanceMeters: 1200 } }),
    });

    expect(result.userPreference.activityLevel).toBe("low");
    expect(result.factPacks).toHaveLength(3);
    expect(result.openingMessages).toHaveLength(3);
    expect(result.attackMessages).toHaveLength(3);
    expect(result.rebuttalMessages).toHaveLength(2);
    expect(result.moderatorResult.rankingByCurrentFit).toHaveLength(3);
  });
});
