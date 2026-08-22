import { describe, expect, it } from "vitest";
import { interpretIntent } from "@/lib/agents/intent-agent";
import { createSearchPlan } from "@/lib/search/search-plan";
import { deterministicModel } from "./fixtures/deterministic-model";

describe("intent-driven AMap search plans", () => {
  it.each([
    ["我想去健身房锻炼", "fitness", ["fitness"], "080100"],
    ["想在室内逛逛", "shopping", ["shopping", "museum", "gallery"], "060100"],
    ["不花钱，室内走走，不去咖啡馆", "shopping", ["shopping", "museum", "gallery"], "060100"],
  ] as const)("plans %s only after extracting a profile", async (query, goal, categories, firstTypeCode) => {
    const { intentProfile, preference } = await interpretIntent(query, deterministicModel);
    const plan = createSearchPlan(intentProfile);
    expect(plan.intent.primaryGoal).toBe(goal);
    expect(plan.allowedCategories).toEqual(categories);
    expect(plan.queries[0]?.typeCodes).toBe(firstTypeCode);
    expect(preference.freeTextConstraints).toEqual(["不要太累", "有点意思"]);
  });

  it("keeps uncertain indoor exploration in missing_slots and records exclusions", async () => {
    const { intentProfile } = await interpretIntent("想去室内逛逛，不想去咖啡馆", deterministicModel);
    expect(intentProfile).toEqual({ goal: "休闲", experience: "indoor_walk", constraints: ["indoor"], avoid: ["cafe"], missing_slots: ["exploration_type"] });
  });
});
