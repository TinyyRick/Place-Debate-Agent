import type { UserIntent } from "@/lib/schemas/intent";
import { SearchPlanSchema, type SearchPlan } from "@/lib/schemas/search-plan";

const PLAN_BY_GOAL = {
  fitness: [{ label: "fitness", typeCodes: "080100", keywords: ["健身房", "健身", "运动馆"] }],
  shopping: [{ label: "shopping", typeCodes: "060100", keywords: ["商场", "购物中心", "百货"] }],
  study: [
    // Use the two semantic parent domains.  Fine AMap subtypes are sparse in
    // some neighbourhoods; the compatibility filter still admits only library/
    // bookstore categories, never cafés or generic retail.
    { label: "library", typeCodes: "140000", keywords: ["图书馆", "自习"] },
    { label: "bookstore", typeCodes: "060000", keywords: ["书店", "书局"] },
    { label: "study_cafe", typeCodes: "050000", keywords: ["咖啡馆", "安静"] },
  ],
  leisure: [
    { label: "scenic", typeCodes: "110000", keywords: ["公园", "景区", "古迹"] },
    { label: "culture", typeCodes: "140000", keywords: ["博物馆", "美术馆", "图书馆"] },
    { label: "retail", typeCodes: "060000", keywords: ["书店", "商场"] },
    { label: "food", typeCodes: "050000", keywords: ["咖啡"] },
    { label: "recreation", typeCodes: "080000", keywords: ["电影院", "剧院"] },
  ],
} as const;

export function createSearchPlan(intent: UserIntent): SearchPlan {
  return SearchPlanSchema.parse({
    intent,
    radiusMeters: intent.primaryGoal === "fitness" || intent.primaryGoal === "shopping" ? 10_000 : 8_000,
    queries: PLAN_BY_GOAL[intent.primaryGoal],
    allowedCategories: intent.requiredCategories,
    prohibitedCategories: intent.excludedCategories,
  });
}
