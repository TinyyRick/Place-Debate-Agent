import { describe, expect, it } from "vitest";
import { interpretIntent } from "@/lib/agents/intent-agent";
import { createSearchPlan } from "@/lib/search/search-plan";
import { planExperience } from "@/lib/intent/experience-planner";
import { filterIntentCompatiblePois, rankCandidates, selectDiverseCandidates } from "@/lib/ranking/ranker";
import { PlaceCandidateSchema } from "@/lib/schemas/place";
import { deterministicModel } from "./fixtures/deterministic-model";

describe("intent-driven AMap search plans", () => {
  it.each([
    ["我想去健身房锻炼", "fitness", ["fitness"], "080100"],
    ["想在室内逛逛", "shopping", ["shopping", "museum", "gallery", "bookstore", "cultural"], "060100"],
    ["不花钱，室内走走，不去咖啡馆", "shopping", ["shopping", "museum", "gallery", "bookstore", "cultural"], "060100"],
  ] as const)("plans %s only after extracting a profile", async (query, goal, categories, firstTypeCode) => {
    const { intentProfile, preference } = await interpretIntent(query, deterministicModel);
    const plan = createSearchPlan(intentProfile);
    expect(plan.intent.primaryGoal).toBe(goal);
    expect(plan.allowedCategories).toEqual(categories);
    expect(plan.queries[0]?.typeCodes).toBe(firstTypeCode);
    expect(plan.queries.map((item) => item.label)).toEqual(categories);
    expect(preference.freeTextConstraints).toEqual(["不要太累", "有点意思"]);
  });

  it("keeps uncertain indoor exploration in missingSlots and records exclusions", async () => {
    const { intentProfile } = await interpretIntent("想去室内逛逛，不想去咖啡馆", deterministicModel);
    expect(intentProfile).toEqual({ goal: "休闲", activityIntensity: "medium", activityMode: ["indoor_walk"], experienceGoal: [], constraints: ["indoor"], avoid: ["cafe"], missingSlots: ["experience_type"] });
  });

  it("treats low-intensity exploration as walking around, not mostly seated", async () => {
    const { intentProfile, preference } = await interpretIntent("不想太累，有点意思", deterministicModel);
    const planned = planExperience(intentProfile, preference);
    expect(intentProfile).toMatchObject({ activityIntensity: "low", activityMode: ["light_exploration"], experienceGoal: ["exploration"] });
    expect(planned.movementPreference).toBe("walk_around");
    expect(planned.activityLevel).toBe("low");
  });

  it("retrieves and ranks a mixed indoor exploration pool rather than only malls", async () => {
    const { intentProfile, preference, userExperienceProfile } = await interpretIntent("室内，一个人，想逛逛", deterministicModel);
    const plan = createSearchPlan(intentProfile);
    expect(intentProfile.companion).toBe("solo");
    expect(plan.queries.map((query) => query.label)).toEqual(["shopping", "museum", "gallery", "bookstore", "cultural"]);

    const candidates = [
      { id: "mall", name: "新街口购物中心", category: "购物服务;商场", typeCode: "060100" },
      { id: "museum", name: "南京博物馆", category: "科教文化服务;博物馆", typeCode: "140100" },
      { id: "gallery", name: "南京美术馆", category: "科教文化服务;美术馆", typeCode: "140200" },
      { id: "bookstore", name: "先锋书店", category: "购物服务;专卖店", typeCode: "060000" },
      { id: "cultural", name: "文学客厅", category: "科教文化服务;文化场所", typeCode: "140000" },
    ].map((candidate, index) => PlaceCandidateSchema.parse({ ...candidate, longitude: 118.8 + index / 100, latitude: 32.06, address: "南京", distanceMeters: 900 + index * 100, rating: 4.5 }));
    const scoredCandidates = candidates.map((candidate) => ({
      ...candidate,
      experienceProfile: { activityLevel: 0.6, engagementType: "exploration" as const, socialFit: "either" as const, pace: 0.5, spatial: "indoor" as const, stimulation: 0.5, costTier: "low" as const },
    }));
    const selected = selectDiverseCandidates(rankCandidates(filterIntentCompatiblePois(scoredCandidates, userExperienceProfile), planExperience(intentProfile, preference), userExperienceProfile));
    expect(selected).toHaveLength(3);
    expect(selected.every((candidate) => candidate.destinationCategory !== "shopping")).toBe(true);
  });
});
