import { Command, MemorySaver, isInterrupted } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createDebateGraph, resumeDebate, startDebate } from "@/lib/graph/debate-graph";
import { battleAdvantageScore, planBattlePairings } from "@/lib/graph/nodes";
import { DebateResultSchema } from "@/lib/schemas/debate";
import { mockCandidates, mockPlaces } from "@/lib/mock/places";
import type { SearchPlan } from "@/lib/schemas/search-plan";
import type { Coordinates } from "@/lib/schemas/location";
import { deterministicModel } from "./fixtures/deterministic-model";
import { buildTravelDebateBrief } from "@/lib/agents/place-agent-factory";

function dependencies(counts?: { places: number; routes: number }) {
  return [{ retrievePlaces: async (...args: [Coordinates, SearchPlan]) => { const [, plan] = args; if (counts) counts.places++; const explicitTarget = plan.intentProfile.explicitTarget?.text; const fitnessRequest = plan.intent.primaryGoal === "fitness" || Boolean(explicitTarget); const category = fitnessRequest ? "体育休闲服务;运动场馆;健身中心" : plan.intent.primaryGoal === "shopping" ? "购物服务;商场" : undefined; const typeCode = fitnessRequest ? "080111" : plan.intent.primaryGoal === "shopping" ? "060100" : undefined; return category && typeCode ? mockCandidates.map((candidate, index) => ({ ...candidate, name: `${index + 1}号${explicitTarget ?? (fitnessRequest ? "健身中心" : "购物中心")}`, category, typeCode, longitude: 118.8 + index * 0.01, latitude: 32.06 + index * 0.01 })) : mockCandidates; } }, { resolveLocation: async () => ({ source: "test" as const, amapCoordinates: { longitude: 118.8, latitude: 32.06 }, formattedAddress: "南京", adcode: "320102", cityCode: "025" }), getWeather: async () => ({ available: true, weather: "多云", temperatureC: 30, assessment: { outdoorComfort: "hot" as const, temperatureLevel: "hot" as const, humidityLevel: "normal" as const, rainImpact: "none" as const } }), getRoutes: async (...args: unknown[]) => { if (counts) counts.routes++; const options = args[2] as { includeTransit?: boolean } | undefined; return { walking: { available: true, durationMinutes: 12 }, driving: { available: true, durationMinutes: 5 }, ...(options?.includeTransit ? { transit: { status: "available" as const, available: true, durationMinutes: 25, walkingDistanceMeters: 500, transferCount: 0, usesMetro: true, directMetro: true, lineNames: ["地铁3号线"] } } : {}) }; }, getMetroAccess: async () => ({ available: true, stationName: "测试站", distanceMeters: 300 }) }] as const;
}

describe("intent clarification and retrieval graph", () => {
  it("surfaces the human-useful contrast when a farther place is faster by transit", () => {
    const farther = {
      ...mockPlaces[0], distanceMeters: 2_000, rating: 4.5,
      route: { walking: { available: true, durationMinutes: 28 }, driving: { available: true, durationMinutes: 9 }, transit: { status: "available" as const, available: true, durationMinutes: 16, walkingDistanceMeters: 300, transferCount: 0, usesMetro: true, directMetro: true, lineNames: ["地铁3号线"] } },
    };
    const nearer = {
      ...mockPlaces[1], distanceMeters: 1_200, rating: 4.3,
      route: { walking: { available: true, durationMinutes: 20 }, driving: { available: true, durationMinutes: 8 }, transit: { status: "available" as const, available: true, durationMinutes: 29, walkingDistanceMeters: 900, transferCount: 1, usesMetro: true, directMetro: false, lineNames: ["地铁2号线", "地铁1号线"] } },
    };
    expect(buildTravelDebateBrief(farther, nearer).notableContrasts).toEqual([
      "我方直线距离多800米，但公共交通总耗时少13分钟",
      "我方地铁零换乘直达，对方不是零换乘直达",
      "我方公共交通接驳步行少600米",
      "我方评分高0.2分",
    ]);
  });

  it("treats strategy-specific transit and verified per-capita cost gaps as battle advantages", () => {
    const cheaper = {
      ...mockPlaces[0], averageCostYuan: 35,
      route: {
        walking: { available: true, durationMinutes: 20 }, driving: { available: true, durationMinutes: 8 },
        transitStrategies: {
          fastest: { status: "available" as const, available: true, durationMinutes: 18, walkingDistanceMeters: 700, transferCount: 1, usesMetro: true, directMetro: false, lineNames: ["1号线", "2号线"] },
          leastWalking: { status: "available" as const, available: true, durationMinutes: 26, walkingDistanceMeters: 180, transferCount: 1, usesMetro: true, directMetro: false, lineNames: ["1号线", "2号线"] },
          leastTransfers: { status: "available" as const, available: true, durationMinutes: 25, walkingDistanceMeters: 400, transferCount: 0, usesMetro: true, directMetro: true, lineNames: ["3号线"] },
        },
      },
    };
    const expensive = {
      ...mockPlaces[1], averageCostYuan: 70,
      route: {
        walking: { available: true, durationMinutes: 20 }, driving: { available: true, durationMinutes: 8 },
        transitStrategies: {
          fastest: { status: "available" as const, available: true, durationMinutes: 29, walkingDistanceMeters: 900, transferCount: 2, usesMetro: true, directMetro: false, lineNames: ["1号线", "2号线", "4号线"] },
          leastWalking: { status: "available" as const, available: true, durationMinutes: 35, walkingDistanceMeters: 850, transferCount: 1, usesMetro: true, directMetro: false, lineNames: ["1号线", "2号线"] },
          leastTransfers: { status: "available" as const, available: true, durationMinutes: 38, walkingDistanceMeters: 900, transferCount: 1, usesMetro: true, directMetro: false, lineNames: ["1号线", "2号线"] },
        },
      },
    };
    const brief = buildTravelDebateBrief(cheaper, expensive);
    expect(brief.notableContrasts).toEqual(expect.arrayContaining([
      "我方高德人均消费低35元",
      "我方最快方案少11分钟",
      "我方最少步行方案少走670米",
      "我方最少换乘方案少换乘1次",
    ]));
    expect(battleAdvantageScore(cheaper, expensive)).toBeGreaterThan(0);
  });

  it("plans only balanced pairings with a material evidence-backed advantage", () => {
    const cafes = mockPlaces.map((place, index) => ({
      ...place,
      distanceMeters: [338, 129, 869][index],
      rating: [4.4, 4.5, 4.5][index],
      route: {
        walking: { available: true, durationMinutes: [9, 10, 18][index] },
        driving: { available: true, durationMinutes: 5 },
        transit: { status: "available" as const, available: true, durationMinutes: [15, 14, 24][index], walkingDistanceMeters: [350, 150, 916][index], transferCount: 0, usesMetro: false, directMetro: false, lineNames: [] },
      },
    }));
    const pairings = planBattlePairings(cafes);
    expect(pairings.length).toBeGreaterThan(0);
    expect(pairings.length).toBeLessThan(3);
    expect(new Set(pairings.map((pair) => pair.speaker.id)).size).toBe(pairings.length);
    expect(new Set(pairings.map((pair) => pair.target.id)).size).toBe(pairings.length);
    expect(pairings.every((pair) => battleAdvantageScore(pair.speaker, pair.target) > 0)).toBe(true);

    const identical = cafes.map((place) => ({ ...place, distanceMeters: 100, rating: 4.5, route: cafes[0].route }));
    expect(planBattlePairings(identical)).toEqual([]);
  });

  it("reports distinct candidate-decision and final-selection interrupt states", async () => {
    const [source, context] = dependencies();
    const runtime = { graph: createDebateGraph(deterministicModel, source, context, new MemorySaver()) };
    const started = await startDebate("想找附近健身房", undefined, runtime);
    expect(started.status).toBe("awaiting_candidate_decision");
    if (started.status !== "awaiting_candidate_decision") throw new Error("Expected candidate decision.");
    const eliminatedPoiId = started.debate.factPacks[0].id;
    const resumed = await resumeDebate(started.threadId, { actionType: "eliminate_candidate", eliminatedPoiId }, runtime);
    expect(resumed.status).toBe("awaiting_final_selection");
  });

  it("interrupts for ambiguous indoor exploration, then retrieves after a clarification", async () => {
    const counts = { places: 0, routes: 0 }; const [source, context] = dependencies(counts); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver()); const config = { configurable: { thread_id: "clarify" } };
    const paused = await graph.invoke({ originalQuery: "想室内逛逛" }, config);
    const clarification = (paused as unknown as { __interrupt__: Array<{ value: { question: string; options: string[] } }> }).__interrupt__[0]?.value;
    expect(isInterrupted(paused)).toBe(true); expect(clarification?.question).toBe("你更想哪种？"); expect(clarification?.options).toEqual(["商场/商业空间", "展览馆/博物馆", "书店/文化空间", "都可以，直接推荐"]);
    const done = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { answer: "都可以，直接推荐" } }), config));
    expect(done.intentProfile.missingSlots).toEqual([]); expect(done.factPacks).toHaveLength(3); expect(done.openingMessages).toHaveLength(3); expect(done.attackMessages.length).toBeGreaterThan(0); expect(done.attackMessages.length).toBeLessThan(3); expect(done.rebuttalMessages).toHaveLength(done.attackMessages.length); expect(new Set(done.attackMessages.map((message) => message.targetPoiId)).size).toBe(done.attackMessages.length); expect(done.rebuttalMessages.every((message) => done.attackMessages.some((attack) => message.speakerPoiId === attack.targetPoiId && message.attackerPoiId === attack.speakerPoiId && message.responseToAttackId === attack.id))).toBe(true); expect(counts).toEqual({ places: 1, routes: 3 });
  });

  it("writes a bookstore/cultural clarification into the resumed intent and search plan", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver()); const config = { configurable: { thread_id: "bookstore-clarification" } };
    const paused = await graph.invoke({ originalQuery: "想室内逛逛" }, config);
    expect(isInterrupted(paused)).toBe(true);

    const done = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { answer: "书店/文化空间" } }), config));

    expect(done.intentProfile.experienceGoal).toContain("reading_cultural_exploration");
    expect(done.intentProfile.missingSlots).not.toContain("experience_type");
    expect(done.experienceProfile).toMatchObject({ engagementType: "exploration", spatial: "indoor" });
    expect(done.searchPlan.allowedCategories).toEqual(["bookstore", "cultural"]);
    expect(done.searchPlan.queries.map((query) => query.label)).toEqual(["bookstore", "cultural"]);
    expect(done.searchPlan.queries[0]).toMatchObject({ typeCodes: "061205|060800", searchKeyword: "书店" });
  });

  it("retrieves a clear fitness request directly and reaches the debate decision", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver());
    const output = await graph.invoke({ originalQuery: "想找附近健身房" }, { configurable: { thread_id: "fitness" } });
    const done = DebateResultSchema.parse(output);
    expect(isInterrupted(output)).toBe(true); expect(done.intentProfile.mentionedCategories).toEqual(["fitness"]); expect(done.searchPlan.intent.primaryGoal).toBe("fitness"); expect(done.searchPlan.strictCategoryMatch).toBe(true); expect(done.searchPlan.queries.map((query) => query.label)).toEqual(["fitness"]); expect(done.openingMessages).toHaveLength(3);
  });

  it("uses functional experience context for an ambiguous exercise clarification", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver());
    const output = await graph.invoke({ originalQuery: "想出去找个地方运动一下" }, { configurable: { thread_id: "functional-clarification" } });
    const clarification = (output as unknown as { __interrupt__: Array<{ value: { question: string; options: string[]; allowCustomAnswer?: boolean } }> }).__interrupt__[0]?.value;
    expect(isInterrupted(output)).toBe(true);
    expect(clarification?.question).toBe("你更偏向哪种运动环境？");
    expect(clarification?.allowCustomAnswer).toBeUndefined();
    expect(clarification?.options).toEqual(["优先室内运动", "优先户外运动", "室内外都可以，直接推荐"]);
  });

  it("uses rest experience context for an ambiguous sitting clarification", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver());
    const output = await graph.invoke({ originalQuery: "想找地方坐坐" }, { configurable: { thread_id: "rest-clarification" } });
    const clarification = (output as unknown as { __interrupt__: Array<{ value: { options: string[] } }> }).__interrupt__[0]?.value;
    expect(isInterrupted(output)).toBe(true);
    expect(clarification?.options).toEqual(["室内坐着休息", "室内轻松走走/逛逛", "户外阴凉处休息", "室内外都可以，直接推荐"]);
  });

  it("clarifies an ambiguous heat-avoidance rest request before retrieval", async () => {
    const counts = { places: 0, routes: 0 }; const [source, context] = dependencies(counts); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver()); const config = { configurable: { thread_id: "hot-rest-clarification" } };
    const output = await graph.invoke({ originalQuery: "太热了，想找个可以休息的地方" }, config);
    const clarification = (output as unknown as { __interrupt__: Array<{ value: { options: string[] } }> }).__interrupt__[0]?.value;
    expect(isInterrupted(output)).toBe(true);
    expect(counts.places).toBe(0);
    expect(clarification).toMatchObject({
      question: "你更想怎么休息？",
      options: ["室内坐着休息", "室内轻松走走/逛逛", "户外阴凉处休息", "室内外都可以，直接推荐"],
    });
    const resumed = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { answer: "室内坐着休息" } }), config));
    expect(resumed.intentProfile.missingSlots).toEqual([]);
    expect(resumed.intentProfile.explicitTarget).toBeUndefined();
    expect(resumed.intentProfile.activityMode).toContain("seated_rest");
    expect(resumed.experienceProfile).toMatchObject({ engagementType: "rest", spatial: "indoor" });
    expect(resumed.searchPlan.queries.map((query) => query.label)).toContain("cafe");
  });

  it.each(["羽毛球", "游泳"])("uses the explicit %s target directly without clarification", async (target) => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver());
    const output = await graph.invoke({ originalQuery: `我想找个评分高、没那么远的${target}馆` }, { configurable: { thread_id: `explicit-${target}` } });
    const done = DebateResultSchema.parse(output);
    expect(isInterrupted(output)).toBe(true);
    expect(done.intentProfile.explicitTarget).toEqual({ text: target, specificity: "specific" });
    expect(done.searchPlan.strictTargetMatch).toBe(true);
    expect(done.searchPlan.queries[0]).toMatchObject({ label: "explicit-target", searchKeyword: target });
    expect(done.factPacks.every((place) => place.name.includes(target))).toBe(true);
  });

  it("uses 网吧 as a direct retrieval target even when the sentence also says 坐坐", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver());
    const output = await graph.invoke({ originalQuery: "想找个网吧坐坐" }, { configurable: { thread_id: "explicit-internet-cafe" } });
    const done = DebateResultSchema.parse(output);
    expect(done.intentProfile.explicitTarget).toEqual({ text: "网吧", specificity: "specific" });
    expect(done.intentProfile.missingSlots).not.toContain("activity_type");
    expect(done.searchPlan).toMatchObject({ strictTargetMatch: true, strictCategoryMatch: false });
    expect(done.searchPlan.queries[0]).toMatchObject({ label: "explicit-target", searchKeyword: "网吧" });
    expect(done.factPacks.every((place) => place.name.includes("网吧"))).toBe(true);
  });

  it("uses verified zero-transfer transit routes for a high-rated nearby direct-metro target", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver());
    const done = DebateResultSchema.parse(await graph.invoke({ originalQuery: "想找评分高、近一点、地铁直达的羽毛球馆" }, { configurable: { thread_id: "direct-metro-target" } }));
    expect(done.userPreference).toMatchObject({ transportPreference: "metro", distanceTolerance: "near" });
    expect(done.factPacks).toHaveLength(3);
    expect(done.factPacks.every((place) => place.rating !== undefined && place.rating >= 4.2 && place.route?.transit?.directMetro)).toBe(true);
    expect(done.factPacks.every((place) => place.evidence.some((evidence) => evidence.type === "transit_route"))).toBe(true);
  });

  it("turns a free-form clarification answer into a strict target search", async () => {
    const [source, context] = dependencies(); const graph = createDebateGraph(deterministicModel, source, context, new MemorySaver()); const config = { configurable: { thread_id: "custom-sport" } };
    const paused = await graph.invoke({ originalQuery: "想出去找个地方运动一下" }, config);
    expect(isInterrupted(paused)).toBe(true);
    const done = DebateResultSchema.parse(await graph.invoke(new Command({ resume: { answer: "羽毛球" } }), config));
    expect(done.intentProfile.explicitTarget).toEqual({ text: "羽毛球", specificity: "specific" });
    expect(done.searchPlan.queries[0]).toMatchObject({ label: "explicit-target", searchKeyword: "羽毛球" });
    expect(done.factPacks.every((place) => place.name.includes("羽毛球"))).toBe(true);
  });
});
