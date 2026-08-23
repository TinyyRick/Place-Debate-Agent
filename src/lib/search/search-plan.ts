import type { DestinationCategory } from "@/lib/schemas/place";
import type { IntentProfile, UserIntent } from "@/lib/schemas/intent";
import { SearchPlanSchema, type SearchPlan } from "@/lib/schemas/search-plan";

type SearchableCategory = Exclude<DestinationCategory, "other">;

const QUERY_BY_CATEGORY: Record<SearchableCategory, { label: string; typeCodes: string; keywords: string[] }> = {
  park: { label: "park", typeCodes: "110000", keywords: ["公园", "绿地"] },
  attraction: { label: "attraction", typeCodes: "110000", keywords: ["景区", "古迹"] },
  museum: { label: "museum", typeCodes: "140100", keywords: ["博物馆", "纪念馆"] },
  gallery: { label: "gallery", typeCodes: "140200", keywords: ["美术馆", "展览馆"] },
  bookstore: { label: "bookstore", typeCodes: "060000", keywords: ["书店", "书局"] },
  cafe: { label: "cafe", typeCodes: "050000", keywords: ["咖啡馆"] },
  cinema: { label: "cinema", typeCodes: "080600", keywords: ["电影院", "影城"] },
  fitness: { label: "fitness", typeCodes: "080100", keywords: ["健身房", "健身", "运动馆"] },
  shopping: { label: "shopping", typeCodes: "060100", keywords: ["商场", "购物中心", "百货"] },
  entertainment: { label: "entertainment", typeCodes: "080000", keywords: ["剧院", "演艺"] },
  cultural: { label: "cultural", typeCodes: "140000", keywords: ["文化空间", "图书馆"] },
};

function profileText(profile: IntentProfile) {
  return [profile.goal, ...profile.activityMode, ...profile.experienceGoal, ...profile.constraints, ...profile.avoid].join(" ").toLowerCase();
}

function hasAvoidedCategory(profile: IntentProfile, category: SearchableCategory) {
  const terms: Record<SearchableCategory, string[]> = {
    cafe: ["cafe", "咖啡"], cinema: ["cinema", "电影"], shopping: ["shopping", "购物", "商场"],
    fitness: ["fitness", "健身"], park: ["park", "公园"], attraction: ["attraction", "景区"],
    museum: ["museum", "博物馆"], gallery: ["gallery", "美术馆", "展览馆"], bookstore: ["bookstore", "书店"],
    entertainment: ["entertainment", "娱乐"], cultural: ["cultural", "文化"],
  };
  const avoided = profile.avoid.join(" ").toLowerCase();
  return terms[category].some((term) => avoided.includes(term));
}

function resolveCategories(profile: IntentProfile): SearchableCategory[] {
  const text = profileText(profile);
  // These are stable experience directions written by the clarification node.
  // They take precedence over the original broad free-text interpretation.
  if (text.includes("reading_cultural_exploration")) return ["bookstore", "cultural"];
  if (text.includes("exhibition_exploration")) return ["museum", "gallery"];
  if (text.includes("commercial_browsing")) return ["shopping"];
  if (/健身|锻炼|瑜伽|游泳/.test(text)) return ["fitness"];
  if (/学习|看书|自习|阅读/.test(text)) return ["bookstore", "cultural"];
  if (/购物|商场|逛街/.test(text)) return ["shopping"];

  const indoorExploration = /室内|indoor/.test(text)
    && (/逛|walk|exploration|探索/.test(text) || profile.goal.includes("休闲"));
  if (indoorExploration) return ["shopping", "museum", "gallery", "bookstore", "cultural"];

  if (/文化|展览|博物|美术|书店|阅读/.test(text)) return ["museum", "gallery", "bookstore", "cultural"];
  return ["park", "museum", "bookstore", "gallery", "cultural"];
}

function resolveSearchIntent(profile: IntentProfile): UserIntent {
  const categories = resolveCategories(profile);
  const text = profileText(profile);
  const primaryGoal = categories[0] === "fitness" ? "fitness" : /学习|看书|自习|阅读/.test(text) ? "study" : categories[0] === "shopping" ? "shopping" : "leisure";
  const excludedCategories = (Object.keys(QUERY_BY_CATEGORY) as SearchableCategory[])
    .filter((category) => hasAvoidedCategory(profile, category));
  return {
    primaryGoal,
    requiredCategories: categories.filter((category) => !excludedCategories.includes(category)),
    excludedCategories,
    searchTerms: categories.flatMap((category) => QUERY_BY_CATEGORY[category].keywords).slice(0, 4),
    strictCategoryMatch: primaryGoal !== "leisure",
    summary: profile.goal,
  };
}

export function createSearchPlan(intentProfile: IntentProfile): SearchPlan {
  const intent = resolveSearchIntent(intentProfile);
  const categories = intent.requiredCategories.filter((category): category is SearchableCategory => category !== "other");
  return SearchPlanSchema.parse({
    intentProfile,
    intent,
    radiusMeters: intent.primaryGoal === "fitness" ? 10_000 : 8_000,
    // Every allowed category gets a concrete AMap request; no category is only
    // declarative metadata in the plan.
    queries: categories.map((category) => QUERY_BY_CATEGORY[category]),
    allowedCategories: categories,
    prohibitedCategories: intent.excludedCategories,
    rankingPriorities: [...intentProfile.experienceGoal, ...intentProfile.activityMode, ...intentProfile.constraints, intentProfile.avoid.length ? "avoid_exclusions" : "destination_quality"],
    speculativeQueries: [],
  });
}
