import { Command, MemorySaver, isInterrupted } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createDebateGraph } from "@/lib/graph/debate-graph";
import { DebateResultSchema } from "@/lib/schemas/debate";
import { mockCandidates } from "@/lib/mock/places";
import type { PlaceCandidate } from "@/lib/schemas/place";
import { deterministicModel } from "./fixtures/deterministic-model";

function dependencies(counts?: { places: number; weather: number; routes: number; metro?: number }) {
  return [{ retrievePlaces: async () => { if (counts) counts.places++; return mockCandidates; } }, {
    resolveLocation: async () => ({ source: "test" as const, amapCoordinates: { longitude: 118.8, latitude: 32.06 }, formattedAddress: "南京市玄武区", adcode: "320102" }),
    getWeather: async () => { if (counts) counts.weather++; return { available: true, weather: "多云", temperatureC: 30, humidity: 74, reportTime: "2026-08-22 12:00:00", assessment: { outdoorComfort: "hot_humid" as const, temperatureLevel: "hot" as const, humidityLevel: "humid" as const, rainImpact: "none" as const } }; },
    getRoutes: async () => { if (counts) counts.routes++; return { walking: { available: true, durationMinutes: 12, distanceMeters: 800 }, driving: { available: true, durationMinutes: 5, distanceMeters: 1200 } }; },
    getMetroAccess: async (candidate: PlaceCandidate) => { if (counts) counts.metro = (counts.metro ?? 0) + 1; return { available: true, stationName: `${candidate.name}站`, distanceMeters: 300 }; },
  }] as const;
}

describe("debate graph interrupt and resume", () => {
  it("interrupts after Attack, then resumes the same thread without repeating prior data or rounds", async () => {
    const counts = { places: 0, weather: 0, routes: 0 };
    const [dataSource, context] = dependencies(counts);
    const graph = createDebateGraph(deterministicModel, dataSource, context, new MemorySaver());
    const config = { configurable: { thread_id: "hitl-thread" } };

    const paused = await graph.invoke({ originalQuery: "想出去走走，但是不要太累。" }, config);
    expect(isInterrupted(paused)).toBe(true);
    expect(paused.openingMessages).toHaveLength(3);
    expect(paused.attackMessages).toHaveLength(3);
    expect(paused.rebuttalMessages).toHaveLength(0);
    expect(paused.moderatorResult).toBeUndefined();
    expect(counts).toEqual({ places: 1, weather: 1, routes: 3 });

    const completed = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { intervention: "其实我不怕热，我更想看历史建筑。" } }), config));
    expect(completed.rebuttalMessages).toHaveLength(3);
    expect(completed.moderatorResult.rankingByCurrentFit).toHaveLength(3);
    expect(completed.currentPreference.heatTolerance).toBe(0.9);
    expect(completed.currentPreference.culturePreference).toBe(0.95);
    expect(completed.preferenceDelta.changedFields.map((change) => change.field)).toEqual(["culturePreference", "heatTolerance"]);
    expect({ ...completed.currentPreference, heatTolerance: 0.5, culturePreference: 0.8 }).toEqual(completed.originalPreference);
    expect(counts).toEqual({ places: 1, weather: 1, routes: 3 });
  });

  it("allows empty intervention and keeps the preference unchanged", async () => {
    const [dataSource, context] = dependencies();
    const graph = createDebateGraph(deterministicModel, dataSource, context, new MemorySaver());
    const config = { configurable: { thread_id: "empty-intervention" } };
    await graph.invoke({ originalQuery: "想出去走走，但是不要太累。" }, config);
    const completed = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { intervention: "" } }), config));
    expect(completed.preferenceDelta.changedFields).toEqual([]);
    expect(completed.currentPreference).toEqual(completed.originalPreference);
  });

  it("keeps two checkpointer threads isolated", async () => {
    const [dataSource, context] = dependencies();
    const graph = createDebateGraph(deterministicModel, dataSource, context, new MemorySaver());
    await Promise.all(["thread-a", "thread-b"].map((thread_id) => graph.invoke({ originalQuery: "想出去走走，但是不要太累。" }, { configurable: { thread_id } })));
    const [first, second] = await Promise.all([
      graph.invoke(new Command({ resume: { intervention: "其实我不怕热，我更想看历史建筑。" } }), { configurable: { thread_id: "thread-a" } }),
      graph.invoke(new Command({ resume: { intervention: "" } }), { configurable: { thread_id: "thread-b" } }),
    ]);
    expect(DebateResultSchema.parse(first).currentPreference.heatTolerance).toBe(0.9);
    expect(DebateResultSchema.parse(second).currentPreference.heatTolerance).toBe(0.5);
  });

  it("takes the metro evidence branch and deterministically reranks the fixed finalists", async () => {
    const counts = { places: 0, weather: 0, routes: 0, metro: 0 };
    const [dataSource, context] = dependencies(counts);
    const graph = createDebateGraph(deterministicModel, dataSource, context, new MemorySaver());
    const config = { configurable: { thread_id: "metro-thread" } };
    await graph.invoke({ originalQuery: "想出去走走，但是不要太累。" }, config);
    const result = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { intervention: "可以稍微远一点，只要在地铁附近就行，我想去个室内的地方，但是不想去坐着不动。" } }), config));
    expect(result.currentPreference).toMatchObject({ indoorPreference: 0.9, movementPreference: "walk_around", transportPreference: "metro", distanceTolerance: "flexible_if_transit" });
    expect(result.missingEvidenceTypes).toEqual(["METRO_ACCESS"]);
    expect(result.factPacks.every((place) => place.metroAccess?.available)).toBe(true);
    expect(counts.metro).toBe(3);
    expect(result.afterInterventionScores).not.toEqual(result.beforeInterventionScores);
  });
});
