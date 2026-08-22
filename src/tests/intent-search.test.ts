import { describe, expect, it } from "vitest";
import { interpretIntent } from "@/lib/agents/intent-agent";
import { createSearchPlan } from "@/lib/search/search-plan";
import { deterministicModel } from "./fixtures/deterministic-model";

describe("intent-driven AMap search plans", () => {
  it.each([
    ["我想去健身房锻炼", "fitness", ["fitness"], "080100"],
    ["想在室内逛街购物", "shopping", ["shopping"], "060100"],
    ["找个地方学习看书", "study", ["bookstore", "cultural", "cafe"], "140000"],
    ["想出去走走但是不要太累", "leisure", ["park", "museum", "bookstore"], "110000"],
  ] as const)("maps %s to a distinct %s plan", async (query, goal, categories, firstTypeCode) => {
    const { intent, preference } = await interpretIntent(query, deterministicModel);
    const plan = createSearchPlan(intent);
    expect(intent.primaryGoal).toBe(goal);
    expect(intent.requiredCategories).toEqual(categories);
    expect(plan.allowedCategories).toEqual(categories);
    expect(plan.queries[0]?.typeCodes).toBe(firstTypeCode);
    expect(preference.freeTextConstraints).toEqual(["不要太累", "有点意思"]);
  });
});
