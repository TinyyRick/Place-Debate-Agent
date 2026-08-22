import type { DestinationCategory, PlaceCandidate } from "@/lib/schemas/place";

const CATEGORY_RULES: ReadonlyArray<{ category: DestinationCategory; typeCodes?: readonly string[]; terms: readonly string[] }> = [
  { category: "museum", typeCodes: ["1401"], terms: ["博物馆", "纪念馆"] },
  { category: "gallery", terms: ["美术馆", "艺术馆", "画廊", "展览馆"] },
  { category: "bookstore", terms: ["书店", "书局", "书城"] },
  { category: "cafe", terms: ["咖啡", "咖啡馆", "咖啡厅"] },
  { category: "cinema", terms: ["电影院", "影城"] },
  { category: "park", terms: ["公园", "森林", "湿地", "绿地", "植物园"] },
  { category: "shopping", typeCodes: ["0600"], terms: ["商场", "购物中心", "百货", "奥特莱斯"] },
  { category: "entertainment", typeCodes: ["0800"], terms: ["剧院", "演艺", "游乐", "密室", "桌游"] },
  { category: "cultural", typeCodes: ["1400"], terms: ["文化", "文学", "图书馆", "故居", "书院"] },
  { category: "attraction", typeCodes: ["1100"], terms: ["风景", "景区", "寺", "塔", "古迹", "遗址"] },
];

function matchesRule(candidate: PlaceCandidate, rule: (typeof CATEGORY_RULES)[number]) {
  const text = `${candidate.name} ${candidate.category}`;
  return rule.typeCodes?.some((code) => candidate.typeCode.startsWith(code))
    || rule.terms.some((term) => text.includes(term));
}

export function classifyDestinationCategory(candidate: PlaceCandidate): DestinationCategory {
  return CATEGORY_RULES.find((rule) => matchesRule(candidate, rule))?.category ?? "other";
}

const CATEGORY_BASE_QUALITY: Record<DestinationCategory, number> = {
  park: 0.88,
  attraction: 0.9,
  museum: 0.92,
  gallery: 0.9,
  bookstore: 0.84,
  cafe: 0.74,
  cinema: 0.84,
  shopping: 0.64,
  entertainment: 0.78,
  cultural: 0.86,
  other: 0.35,
};

export function calculatePlaceQuality(candidate: PlaceCandidate, category = classifyDestinationCategory(candidate)) {
  const ratingScore = candidate.rating === undefined ? 0.6 : candidate.rating / 5;
  const parentPenalty = candidate.parentId ? 0.3 : 0;
  const indoorShopPenalty = candidate.indoorCpid && candidate.indoorCpid !== candidate.id ? 0.1 : 0;
  const childBonus = (candidate.childCount ?? 0) > 0 ? 0.04 : 0;
  return Number(Math.max(0, Math.min(1,
    CATEGORY_BASE_QUALITY[category] * 0.7 + ratingScore * 0.3 + childBonus - parentPenalty - indoorShopPenalty,
  )).toFixed(4));
}

export function isDestinationCategory(category: DestinationCategory) {
  return category !== "other";
}
