import type { DestinationCategory } from "@/lib/schemas/place";
import type { IntentProfile, UserIntent } from "@/lib/schemas/intent";
import type { ExperienceProfile } from "@/lib/schemas/experience";
import { SearchPlanSchema, type SearchPlan } from "@/lib/schemas/search-plan";

type SearchableCategory = Exclude<DestinationCategory, "other">;
type SearchQuery = { label: string; typeCodes: string; keywords: string[]; searchKeyword?: string };

const QUERY_BY_CATEGORY: Record<SearchableCategory, SearchQuery> = {
  park: { label: "park", typeCodes: "110000", keywords: ["公园", "绿地"] },
  attraction: { label: "attraction", typeCodes: "110000", keywords: ["景区", "古迹"] },
  museum: { label: "museum", typeCodes: "140100", keywords: ["博物馆", "纪念馆"] },
  gallery: { label: "gallery", typeCodes: "140200", keywords: ["美术馆", "展览馆"] },
  bookstore: { label: "bookstore", typeCodes: "061205|060800", keywords: ["书店", "书局", "文化书店", "独立书店"], searchKeyword: "书店" },
  cafe: { label: "cafe", typeCodes: "050000", keywords: ["咖啡馆"] },
  cinema: { label: "cinema", typeCodes: "080600", keywords: ["电影院", "影城"] },
  fitness: { label: "fitness", typeCodes: "080100", keywords: ["健身房", "健身", "运动馆"] },
  shopping: { label: "shopping", typeCodes: "060100", keywords: ["商场", "购物中心", "百货"] },
  entertainment: { label: "entertainment", typeCodes: "080000", keywords: ["剧院", "演艺"] },
  cultural: { label: "cultural", typeCodes: "140000", keywords: ["文化空间", "图书馆"] },
};

function profileText(profile: IntentProfile) {
  // `avoid` is handled by hasAvoidedCategory. Including it here would make
  // “不去咖啡馆” look like a positive request for the cafe category.
  return [profile.goal, ...profile.activityMode, ...profile.experienceGoal, ...profile.constraints].join(" ").toLowerCase();
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

function activeMentionedCategories(profile: IntentProfile): SearchableCategory[] {
  return profile.mentionedCategories.filter((category) => !hasAvoidedCategory(profile, category));
}

function hasSpecificTarget(profile: IntentProfile) {
  return profile.explicitTarget?.specificity === "specific";
}

function resolveCategories(profile: IntentProfile, experienceProfile?: ExperienceProfile): SearchableCategory[] {
  const explicitCategories = activeMentionedCategories(profile);
  if (explicitCategories.length > 0) return explicitCategories;
  const text = profileText(profile);
  // These are stable experience directions written by the clarification node.
  // They take precedence over the original broad free-text interpretation.
  if (text.includes("reading_cultural_exploration")) return ["bookstore", "cultural"];
  if (text.includes("exhibition_exploration")) return ["museum", "gallery"];
  if (text.includes("commercial_browsing")) return ["shopping"];
  if (/健身|锻炼|瑜伽|游泳/.test(text)) return ["fitness"];
  if (/咖啡|cafe/.test(text)) return ["cafe"];
  if (/电影|影院|影城|cinema/.test(text)) return ["cinema"];
  if (/学习|看书|自习|阅读/.test(text)) return ["bookstore", "cultural"];
  if (/购物|商场|逛街/.test(text)) return ["shopping"];

  // A resolved clarification is stronger than broad words retained from the
  // original request (for example, a generic leisure goal). Otherwise an
  // explicit "室内坐着休息" answer is incorrectly decoded as indoor browsing.
  if (experienceProfile?.engagementType === "rest") {
    return experienceProfile.spatial === "indoor" ? ["cafe", "park"] : ["park"];
  }

  const indoorExploration = /室内|indoor/.test(text)
    && (/逛|walk|exploration|探索/.test(text) || profile.goal.includes("休闲"));
  if (indoorExploration) return ["shopping", "museum", "gallery", "bookstore", "cultural"];

  if (/文化|展览|博物|美术|书店|阅读/.test(text)) return ["museum", "gallery", "bookstore", "cultural"];

  if (experienceProfile) {
    const categories = new Set<SearchableCategory>();
    switch (experienceProfile.engagementType) {
      case "exploration":
        if (experienceProfile.spatial === "outdoor") categories.add("park");
        categories.add("museum"); categories.add("gallery"); categories.add("cultural");
        break;
      case "consumption":
        categories.add("shopping");
        if (experienceProfile.spatial === "indoor") { categories.add("cinema"); categories.add("cafe"); }
        break;
      case "functional":
        categories.add("fitness"); categories.add("shopping");
        break;
      case "social":
        categories.add("cafe"); categories.add("shopping"); categories.add("cultural");
        break;
    }
    if (categories.size > 0) return [...categories];
  }
  return ["park", "museum", "bookstore", "gallery", "cultural"];
}

function resolveSearchIntent(profile: IntentProfile, experienceProfile?: ExperienceProfile): UserIntent {
  const inferredCategories = resolveCategories(profile, experienceProfile);
  const text = profileText(profile);
  const explicitTarget = hasSpecificTarget(profile) ? profile.explicitTarget?.text : undefined;
  const explicitCategories = activeMentionedCategories(profile);
  const categories: DestinationCategory[] = explicitTarget && explicitCategories.length === 0
    ? ["other"]
    : inferredCategories;
  const primaryGoal = categories[0] === "fitness" ? "fitness" : /学习|看书|自习|阅读/.test(text) ? "study" : categories[0] === "shopping" ? "shopping" : "leisure";
  const excludedCategories = (Object.keys(QUERY_BY_CATEGORY) as SearchableCategory[])
    .filter((category) => hasAvoidedCategory(profile, category));
  return {
    primaryGoal,
    requiredCategories: categories.filter((category) => category === "other" || !excludedCategories.includes(category)),
    excludedCategories,
    searchTerms: explicitTarget ? [explicitTarget] : inferredCategories.flatMap((category) => QUERY_BY_CATEGORY[category].keywords).slice(0, 4),
    strictCategoryMatch: activeMentionedCategories(profile).length > 0,
    summary: profile.goal,
  };
}

export function createSearchPlan(intentProfile: IntentProfile, experienceProfile?: ExperienceProfile): SearchPlan {
  const intent = resolveSearchIntent(intentProfile, experienceProfile);
  const categories = intent.requiredCategories.filter((category): category is SearchableCategory => category !== "other");
  const explicitTarget = hasSpecificTarget(intentProfile) ? intentProfile.explicitTarget?.text : undefined;
  const explicitCategories = activeMentionedCategories(intentProfile);
  const categoryQueries = categories.map((category) => QUERY_BY_CATEGORY[category]);
  const queries = explicitTarget
    ? [{
        label: "explicit-target",
        typeCodes: explicitCategories[0] ? QUERY_BY_CATEGORY[explicitCategories[0]].typeCodes : "",
        keywords: [explicitTarget],
        searchKeyword: explicitTarget,
      }]
    : categoryQueries;
  return SearchPlanSchema.parse({
    intentProfile,
    intent,
    radiusMeters: explicitTarget || intent.primaryGoal === "fitness" ? 10_000 : 8_000,
    // Every allowed category gets a concrete AMap request; no category is only
    // declarative metadata in the plan.
    queries,
    allowedCategories: intent.requiredCategories,
    strictCategoryMatch: intent.strictCategoryMatch,
    strictTargetMatch: Boolean(explicitTarget),
    prohibitedCategories: intent.excludedCategories,
    rankingPriorities: [...intentProfile.experienceGoal, ...intentProfile.activityMode, ...intentProfile.constraints, intentProfile.avoid.length ? "avoid_exclusions" : "destination_quality"],
    speculativeQueries: [],
  });
}
