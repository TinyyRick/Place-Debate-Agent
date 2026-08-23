import { Command, MemorySaver, isInterrupted } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createDebateGraph } from "@/lib/graph/debate-graph";
import { DebateResultSchema } from "@/lib/schemas/debate";
import { mockCandidates } from "@/lib/mock/places";
import type { SearchPlan } from "@/lib/schemas/search-plan";
import type { Coordinates } from "@/lib/schemas/location";
import { deterministicModel } from "./fixtures/deterministic-model";

function dependencies(counts?: { places: number; routes: number }) {
  return [{ retrievePlaces: async (...args: [Coordinates, SearchPlan]) => { const [, plan] = args; if (counts) counts.places++; const category = plan.intent.primaryGoal === "fitness" ? "体育休闲服务;运动场馆;健身中心" : plan.intent.primaryGoal === "shopping" ? "购物服务;商场" : undefined; const typeCode = plan.intent.primaryGoal === "fitness" ? "080111" : plan.intent.primaryGoal === "shopping" ? "060100" : undefined; return category && typeCode ? mockCandidates.map((candidate, index) => ({ ...candidate, name: `${index + 1}号${plan.intent.primaryGoal === "fitness" ? "健身中心" : "购物中心"}`, category, typeCode, longitude: 118.8 + index * 0.01, latitude: 32.06 + index * 0.01 })) : mockCandidates; } }, { resolveLocation: async () => ({ source: "test" as const, amapCoordinates: { longitude: 118.8, latitude: 32.06 }, formattedAddress: "南京", adcode: "320102" }), getWeather: async () => ({ available: true, weather: "多云", temperatureC: 30, assessment: { outdoorComfort: "hot" as const, temperatureLevel: "hot" as const, humidityLevel: "normal" as const, rainImpact: "none" as const } }), getRoutes: async () => { if (counts) counts.routes++; return { walking: { available: true, durationMinutes: 12 }, driving: { available: true, durationMinutes: 5 } }; }, getMetroAccess: async () => ({ available: true, stationName: "测试站", distanceMeters: 300 }) }] as const;
}

describe("intent clarification and retrieval graph", () => {
  it("interrupts for ambiguous indoor exploration, then retrieves after a clarification", async () => {
    const counts = { places: 0, routes: 0 }; const [source, context] = dependencies(counts); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver()); const config = { configurable: { thread_id: "clarify" } };
    const paused = await graph.invoke({ originalQuery: "想室内逛逛" }, config);
    const clarification = (paused as unknown as { __interrupt__: Array<{ value: { question: string; options: string[] } }> }).__interrupt__[0]?.value;
    expect(isInterrupted(paused)).toBe(true); expect(clarification?.question).toBe("你更想哪种？"); expect(clarification?.options).toEqual(["商场/商业空间", "展览馆/博物馆", "书店/文化空间", "都可以，直接推荐"]);
    const done = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { answer: "都可以，直接推荐" } }), config));
    expect(done.intentProfile.missingSlots).toEqual([]); expect(done.factPacks).toHaveLength(3); expect(done.openingMessages).toEqual([]); expect(done.attackMessages).toEqual([]); expect(counts).toEqual({ places: 1, routes: 3 });
  });

  it("retrieves a clear fitness request directly without a clarification or debate round", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver());
    const output = await graph.invoke({ originalQuery: "想找附近健身房" }, { configurable: { thread_id: "fitness" } });
    const done = DebateResultSchema.parse(output);
    expect(isInterrupted(output)).toBe(false); expect(done.searchPlan.intent.primaryGoal).toBe("fitness"); expect(done.openingMessages).toEqual([]);
  });
});
