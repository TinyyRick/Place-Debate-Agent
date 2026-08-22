import { Command, MemorySaver, isInterrupted } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createDebateGraph } from "@/lib/graph/debate-graph";
import { DebateResultSchema } from "@/lib/schemas/debate";
import { mockCandidates } from "@/lib/mock/places";
import type { SearchPlan } from "@/lib/schemas/search-plan";
import type { Coordinates } from "@/lib/schemas/location";
import { deterministicModel } from "./fixtures/deterministic-model";

function dependencies(counts?: { places: number; routes: number }) {
  return [{ retrievePlaces: async (...args: [Coordinates, SearchPlan]) => { void args; if (counts) counts.places++; return mockCandidates; } }, { resolveLocation: async () => ({ source: "test" as const, amapCoordinates: { longitude: 118.8, latitude: 32.06 }, formattedAddress: "南京", adcode: "320102" }), getWeather: async () => ({ available: true, weather: "多云", temperatureC: 30, assessment: { outdoorComfort: "hot" as const, temperatureLevel: "hot" as const, humidityLevel: "normal" as const, rainImpact: "none" as const } }), getRoutes: async () => { if (counts) counts.routes++; return { walking: { available: true, durationMinutes: 12 }, driving: { available: true, durationMinutes: 5 } }; }, getMetroAccess: async () => ({ available: true, stationName: "测试站", distanceMeters: 300 }) }] as const;
}

describe("candidate decision graph", () => {
  it("interrupts for a decision, eliminates exactly one without rerunning AMap, then saves final selection", async () => {
    const counts = { places: 0, routes: 0 }; const [source, context] = dependencies(counts); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver()); const config = { configurable: { thread_id: "duel" } };
    const paused = await graph.invoke({ originalQuery: "想出去走走" }, config);
    expect(isInterrupted(paused)).toBe(true); expect(paused.openingMessages).toHaveLength(3); expect(paused.attackMessages).toHaveLength(3);
    const duel = await graph.invoke(new Command({ resume: { actionType: "eliminate_candidate", eliminatedPoiId: paused.factPacks[0].id } }), config);
    expect(isInterrupted(duel)).toBe(true); expect(duel.survivingCandidateIds).toHaveLength(2); expect(duel.finalDuelMessages).toHaveLength(2); expect(counts).toEqual({ places: 1, routes: 3 });
    const done = DebateResultSchema.parse(await graph.invoke(new Command({ resume: duel.survivingCandidateIds[0] }), config));
    expect(done.selectedPoiId).toBe(duel.survivingCandidateIds[0]);
  });
});
