import type { IntentProfile, UserIntent } from "@/lib/schemas/intent";
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

function resolveSearchIntent(profile: IntentProfile): UserIntent {
  const text = [profile.goal, profile.experience, ...profile.constraints, ...profile.avoid].join(" ").toLowerCase();
  if (/健身|锻炼|瑜伽|游泳/.test(text)) return { primaryGoal: "fitness", requiredCategories: ["fitness"], excludedCategories: [], searchTerms: ["健身房", "健身", "运动馆"], strictCategoryMatch: true, summary: profile.goal };
  if (/学习|看书|自习|阅读/.test(text)) return { primaryGoal: "study", requiredCategories: ["bookstore", "cultural", "cafe"], excludedCategories: text.includes("咖啡") ? ["cafe"] : [], searchTerms: ["图书馆", "书店", "书局"], strictCategoryMatch: true, summary: profile.goal };
  const indoorWalk = /室内|逛|购物|商业|indoor|walk/.test(text);
  if (indoorWalk) return { primaryGoal: "shopping", requiredCategories: ["shopping", "museum", "gallery"], excludedCategories: text.includes("咖啡") ? ["cafe"] : [], searchTerms: ["商场", "购物中心", "展览馆"], strictCategoryMatch: true, summary: profile.goal };
  return { primaryGoal: "leisure", requiredCategories: ["park", "museum", "bookstore", "gallery", "cultural"], excludedCategories: text.includes("咖啡") ? ["cafe"] : [], searchTerms: ["公园", "博物馆", "书店"], strictCategoryMatch: false, summary: profile.goal };
}

export function createSearchPlan(intentProfile: IntentProfile): SearchPlan {
  const intent = resolveSearchIntent(intentProfile);
  return SearchPlanSchema.parse({
    intentProfile,
    intent,
    radiusMeters: intent.primaryGoal === "fitness" || intent.primaryGoal === "shopping" ? 10_000 : 8_000,
    queries: PLAN_BY_GOAL[intent.primaryGoal],
    allowedCategories: intent.requiredCategories,
    prohibitedCategories: intent.excludedCategories,
    rankingPriorities: [intentProfile.experience, ...intentProfile.constraints, intentProfile.avoid.length ? "avoid_exclusions" : "destination_quality"],
    speculativeQueries: [],
  });
}
