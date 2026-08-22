import type { DestinationCategory, PlaceActivityProfile } from "@/lib/schemas/place";

/** Conservative, auditable category rules; not a claim about a specific venue's facilities. */
export function derivePlaceActivityProfile(category: DestinationCategory): PlaceActivityProfile {
  const profiles: Record<DestinationCategory, Omit<PlaceActivityProfile, "source">> = {
    cafe: { indoorOutdoor: "indoor", movementStyle: "mostly_seated", weatherExposure: "low", activityType: "餐饮休闲类活动" },
    museum: { indoorOutdoor: "indoor", movementStyle: "walk_around", weatherExposure: "low", activityType: "参观类活动" },
    gallery: { indoorOutdoor: "indoor", movementStyle: "walk_around", weatherExposure: "low", activityType: "参观类活动" },
    bookstore: { indoorOutdoor: "indoor", movementStyle: "mixed", weatherExposure: "low", activityType: "阅读零售类活动" },
    cinema: { indoorOutdoor: "indoor", movementStyle: "mostly_seated", weatherExposure: "low", activityType: "观影类活动" },
    fitness: { indoorOutdoor: "indoor", movementStyle: "light_active", weatherExposure: "low", activityType: "健身运动类活动" },
    park: { indoorOutdoor: "outdoor", movementStyle: "walk_around", weatherExposure: "high", activityType: "公园游逛类活动" },
    attraction: { indoorOutdoor: "outdoor", movementStyle: "walk_around", weatherExposure: "high", activityType: "景点游逛类活动" },
    cultural: { indoorOutdoor: "mixed", movementStyle: "walk_around", weatherExposure: "medium", activityType: "文化活动" },
    entertainment: { indoorOutdoor: "mixed", movementStyle: "light_active", weatherExposure: "medium", activityType: "娱乐活动" },
    shopping: { indoorOutdoor: "mixed", movementStyle: "walk_around", weatherExposure: "medium", activityType: "购物游逛类活动" },
    other: { indoorOutdoor: "unknown", movementStyle: "unknown", weatherExposure: "unknown", activityType: "活动类型未知" },
  };
  return { ...profiles[category], source: "derived_category_rule" };
}
