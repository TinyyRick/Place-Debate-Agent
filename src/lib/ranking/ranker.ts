import type { DestinationCategory, FinalistScore, PlaceFactPack, PlaceCandidate } from "@/lib/schemas/place";
import type { UserPreference } from "@/lib/schemas/preference";
import type { ExperienceProfile } from "@/lib/schemas/experience";
import type { IntentProfile } from "@/lib/schemas/intent";
import { experienceMatchScore, isExperienceCompatible, NEUTRAL_EXPERIENCE_PROFILE } from "@/lib/experience/place-experience-scorer";
import { FINAL_RANKING_WEIGHTS, INTERVENTION_FINALIST_WEIGHTS, QUALITY_FILTER_CONFIG, RANKING_WEIGHTS } from "./config";
import { calculatePlaceQuality, classifyDestinationCategory, isDestinationCategory } from "./taxonomy";
import { derivePlaceActivityProfile } from "./activity-profile";

export { RANKING_WEIGHTS } from "./config";
export { FINAL_RANKING_WEIGHTS } from "./config";
export { INTERVENTION_FINALIST_WEIGHTS } from "./config";

export const HIGH_RATING_THRESHOLD = 4.2;
export type RankingRequirements = { preferNear: boolean; preferHighRating: boolean; requireDirectMetro: boolean };

export function deriveRankingRequirements(profile: IntentProfile): RankingRequirements {
  const text = [profile.goal, ...profile.constraints, ...profile.experienceGoal, ...profile.activityMode].join(" ");
  return {
    preferNear: /近一点|近点|附近|距离近|不要太远|没那么远/.test(text),
    preferHighRating: /评分高|高评分|评分好|评价高|口碑好/.test(text),
    requireDirectMetro: /地铁直达|地铁.*(?:不换乘|无需换乘|零换乘)|(?:不换乘|无需换乘|零换乘).*地铁/.test(text),
  };
}

export function applyKnownCandidateRequirements(candidates: PlaceCandidate[], requirements: RankingRequirements) {
  return requirements.preferHighRating
    ? candidates.filter((candidate) => candidate.rating !== undefined && candidate.rating >= HIGH_RATING_THRESHOLD)
    : candidates;
}

export function applyRouteCandidateRequirements(candidates: PlaceCandidate[], requirements: RankingRequirements) {
  return requirements.requireDirectMetro
    ? candidates.filter((candidate) => candidate.route?.transit?.status === "available" && candidate.route.transit.directMetro === true)
    : candidates;
}

function hasExcludedTerm(candidate: PlaceCandidate) {
  return QUALITY_FILTER_CONFIG.excludedNameTerms.some((term) => candidate.name.includes(term))
    || QUALITY_FILTER_CONFIG.excludedCategoryTerms.some((term) => candidate.category.includes(term));
}

/** Match only the suffix of a compound POI name: never reject independent names merely because they contain “门”. */
function hasSubPoiSuffix(candidate: PlaceCandidate) {
  const suffix = candidate.name.split(/[-—–]/).at(-1)?.replace(/（.*?）|\(.*?\)/g, "").trim() ?? "";
  return suffix !== candidate.name && QUALITY_FILTER_CONFIG.subPoiSuffixTerms.some((term) => suffix === term || suffix.startsWith(term));
}

function enrichCandidate(candidate: PlaceCandidate) {
  const destinationCategory = classifyDestinationCategory(candidate);
  return { ...candidate, destinationCategory, placeQuality: calculatePlaceQuality(candidate, destinationCategory), activityProfile: derivePlaceActivityProfile(destinationCategory) };
}

function isEligibleDestination(candidate: PlaceCandidate, distanceLimit: number, allowOther = false) {
  const enriched = enrichCandidate(candidate);
  return enriched.distanceMeters <= distanceLimit
    && !hasExcludedTerm(enriched)
    && !hasSubPoiSuffix(enriched)
    && (allowOther || isDestinationCategory(enriched.destinationCategory));
}

function betterCandidate(left: PlaceCandidate, right: PlaceCandidate) {
  const leftQuality = left.placeQuality ?? 0;
  const rightQuality = right.placeQuality ?? 0;
  if (leftQuality !== rightQuality) return leftQuality > rightQuality ? left : right;
  return left.distanceMeters <= right.distanceMeters ? left : right;
}

function deduplicateCandidates(candidates: PlaceCandidate[]) {
  const byKey = new Map<string, PlaceCandidate>();
  const parentIds = new Set(candidates.flatMap((candidate) => candidate.parentId ? [candidate.parentId] : []));
  for (const candidate of candidates) {
    const key = candidate.parentId
      ? `parent:${candidate.parentId}`
      : parentIds.has(candidate.id)
        ? `parent:${candidate.id}`
      : `${candidate.name.trim().toLowerCase()}-${candidate.longitude.toFixed(4)}-${candidate.latitude.toFixed(4)}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? betterCandidate(existing, candidate) : candidate);
  }
  return [...byKey.values()];
}

/** Filters infrastructure first; fallback expands only distance/category strictness, never infrastructure exclusions. */
export function hardFilterPois(candidates: PlaceCandidate[]) {
  const preferred = deduplicateCandidates(
    candidates.filter((candidate) => isEligibleDestination(candidate, QUALITY_FILTER_CONFIG.preferredDistanceMeters)),
  );
  if (preferred.length >= 3) return preferred;

  const fallback = deduplicateCandidates(
    candidates.filter((candidate) => isEligibleDestination(candidate, QUALITY_FILTER_CONFIG.fallbackDistanceMeters, true)),
  );
  const selectedIds = new Set(preferred.map((candidate) => candidate.id));
  return [...preferred, ...fallback.filter((candidate) => !selectedIds.has(candidate.id))];
}

/**
 * This is intentionally a hard, deterministic gate.  It runs after destination
 * quality filtering so facilities cannot re-enter through an intent fallback.
 */
function matchesExplicitTarget(candidate: PlaceCandidate, explicitTarget: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s·・,，。()（）/\\-]/g, "");
  const normalizedTarget = normalize(explicitTarget).replace(/^想(去|找|看|玩)?/, "");
  const targetCore = normalizedTarget.replace(/(场馆|中心|场|馆|店|空间)$/, "");
  const candidateText = normalize(`${candidate.name}${candidate.category}`);
  const targetAliases = ["网吧", "网咖", "电竞馆"].includes(normalizedTarget)
    ? ["网吧", "网咖", "电竞馆", "互联网上网服务"]
    : [normalizedTarget];
  return targetAliases.some((alias) => candidateText.includes(alias))
    || (targetCore.length >= 2 && candidateText.includes(targetCore));
}

export function filterIntentCompatiblePois(
  candidates: PlaceCandidate[],
  intentExperience: ExperienceProfile,
  strictCategories?: readonly DestinationCategory[],
  explicitTarget?: string,
) {
  return candidates.flatMap((candidate) => {
    // `destinationCategory` has a schema default of "other", so always derive
    // from AMap fields here instead of treating that default as classification.
    const category = classifyDestinationCategory(candidate);
    const experienceProfile = candidate.experienceProfile ?? NEUTRAL_EXPERIENCE_PROFILE;
    if (explicitTarget && !matchesExplicitTarget(candidate, explicitTarget)) return [];
    // An explicitly requested category (for example, cafe) is a stronger
    // retrieval constraint than the generic profile label assigned to a POI.
    // It never admits another category, so retail outside that request remains
    // excluded by the deterministic category gate.
    const explicitlyRequested = strictCategories?.includes(category) ?? false;
    const restDestinationCompatible = intentExperience.engagementType === "rest"
      && ["cafe", "bookstore", "cultural", "park"].includes(category)
      && (intentExperience.spatial === "mixed" || experienceProfile.spatial === "mixed" || intentExperience.spatial === experienceProfile.spatial);
    if (!explicitTarget && !explicitlyRequested && !restDestinationCompatible && !isExperienceCompatible(intentExperience, experienceProfile)) return [];
    return [{ ...candidate, destinationCategory: category, experienceProfile }];
  });
}

function interestScore(candidate: PlaceCandidate, preference: UserPreference) {
  switch (candidate.destinationCategory) {
    case "park": return preference.naturePreference;
    case "attraction": return preference.naturePreference * 0.55 + preference.culturePreference * 0.45;
    case "museum": case "gallery": case "cultural": return preference.culturePreference;
    case "bookstore": return preference.culturePreference * 0.85 + preference.indoorPreference * 0.15;
    case "cafe": return preference.indoorPreference * 0.6 + 0.35;
    case "cinema": return preference.indoorPreference * 0.5 + preference.culturePreference * 0.5;
    case "fitness": return preference.activityLevel === "high" ? 1 : preference.activityLevel === "medium" ? 0.82 : 0.62;
    case "entertainment": return 0.55;
    case "shopping": return 0.3;
    default: return 0.2;
  }
}

function activityScore(candidate: PlaceCandidate, activityLevel: UserPreference["activityLevel"]) {
  const indoorFriendly = ["museum", "gallery", "bookstore", "cafe", "cinema", "cultural"].includes(candidate.destinationCategory);
  if (activityLevel === "low") return indoorFriendly ? 1 : candidate.destinationCategory === "shopping" ? 0.75 : 0.55;
  if (activityLevel === "high") return ["park", "attraction", "entertainment", "fitness"].includes(candidate.destinationCategory) ? 1 : 0.7;
  return 0.8;
}

function noveltyScore(candidate: PlaceCandidate, intentExperience: ExperienceProfile) {
  const asksForInterest = intentExperience.engagementType === "exploration";
  if (!asksForInterest) return 0.6;
  return ["museum", "gallery", "bookstore", "attraction", "cultural", "entertainment"].includes(candidate.destinationCategory) ? 1 : 0.55;
}

export function rankCandidates(candidates: PlaceCandidate[], preference: UserPreference, intentExperience: ExperienceProfile, strictTargetMatch = false, requirements: RankingRequirements = { preferNear: false, preferHighRating: false, requireDirectMetro: false }) {
  return candidates.map(enrichCandidate).map((candidate) => {
    const distance = Math.max(0, 1 - candidate.distanceMeters / QUALITY_FILTER_CONFIG.fallbackDistanceMeters);
    const rating = candidate.rating === undefined ? 0 : candidate.rating / 5;
    const score = strictTargetMatch
      ? requirements.preferNear && requirements.preferHighRating
        ? 0.55 * distance + 0.30 * rating + 0.15 * (candidate.placeQuality ?? 0)
        : requirements.preferHighRating
          ? 0.40 * distance + 0.40 * rating + 0.20 * (candidate.placeQuality ?? 0)
          : requirements.preferNear
            ? 0.70 * distance + 0.30 * (candidate.placeQuality ?? 0)
            : 0.55 * distance + 0.45 * (candidate.placeQuality ?? 0)
      : RANKING_WEIGHTS.interestFit * experienceMatchScore(intentExperience, candidate.experienceProfile ?? NEUTRAL_EXPERIENCE_PROFILE)
        + RANKING_WEIGHTS.distance * distance
        + RANKING_WEIGHTS.activityFit * activityScore(candidate, preference.activityLevel)
        + RANKING_WEIGHTS.placeQuality * (candidate.placeQuality ?? 0)
        + RANKING_WEIGHTS.novelty * noveltyScore(candidate, intentExperience);
    return { ...candidate, preliminaryScore: Number(score.toFixed(4)) };
  }).sort((left, right) => (right.preliminaryScore ?? 0) - (left.preliminaryScore ?? 0));
}

function isIndoor(candidate: PlaceCandidate) { return ["museum", "gallery", "bookstore", "cafe", "cinema", "cultural", "fitness", "shopping"].includes(candidate.destinationCategory); }
function travelFit(candidate: PlaceCandidate, preference: UserPreference) {
  const walking = candidate.route?.walking.durationMinutes;
  const driving = candidate.route?.driving.durationMinutes;
  const score = (minutes: number | undefined, cap: number) => minutes === undefined ? undefined : Math.max(0, 1 - minutes / cap);
  if (preference.transportPreference === "walking") return score(walking, 45) ?? 0.4;
  if (preference.transportPreference === "driving") return score(driving, 35) ?? 0.4;
  if (preference.transportPreference === "metro") {
    const transit = candidate.route?.transit;
    if (!transit?.available || transit.durationMinutes === undefined) return 0.05;
    const durationFit = score(transit.durationMinutes, 90) ?? 0.05;
    const walkingFit = Math.max(0, 1 - (transit.walkingDistanceMeters ?? 2_000) / 2_000);
    return Math.min(1, durationFit * 0.75 + walkingFit * 0.20 + (transit.directMetro ? 0.05 : 0));
  }
  return walking !== undefined && walking <= 20 ? score(walking, 35)! : score(driving, 35) ?? score(walking, 45) ?? 0.4;
}
function weatherFit(candidate: PlaceCandidate, preference: UserPreference) {
  const weather = candidate.weather;
  if (!weather?.available || isIndoor(candidate)) return 1;
  const rainy = /雨|雪|雷/.test(weather.weather ?? "");
  const hot = (weather.temperatureC ?? 0) >= 30;
  if (rainy) return 0.35 + preference.rainTolerance * 0.45;
  if (hot) return 0.45 + preference.heatTolerance * 0.45;
  return 1;
}
export function finalRankCandidates(candidates: PlaceCandidate[], preference: UserPreference, intentExperience: ExperienceProfile, strictTargetMatch = false, requirements: RankingRequirements = { preferNear: false, preferHighRating: false, requireDirectMetro: false }) {
  return candidates.map((candidate) => {
    const base = candidate.preliminaryScore ?? 0;
    const directTargetTravelFit = travelFit(candidate, preference);
    const rating = candidate.rating === undefined ? 0 : candidate.rating / 5;
    const score = strictTargetMatch
      ? requirements.preferNear && requirements.preferHighRating
        ? 0.55 * directTargetTravelFit + 0.30 * rating + 0.10 * (candidate.placeQuality ?? 0) + 0.05 * weatherFit(candidate, preference)
        : requirements.preferHighRating
          ? 0.40 * directTargetTravelFit + 0.40 * rating + 0.15 * (candidate.placeQuality ?? 0) + 0.05 * weatherFit(candidate, preference)
          : requirements.preferNear
            ? 0.70 * directTargetTravelFit + 0.20 * (candidate.placeQuality ?? 0) + 0.10 * weatherFit(candidate, preference)
            : 0.55 * directTargetTravelFit + 0.35 * (candidate.placeQuality ?? 0) + 0.1 * weatherFit(candidate, preference)
      : FINAL_RANKING_WEIGHTS.interestFit * experienceMatchScore(intentExperience, candidate.experienceProfile ?? NEUTRAL_EXPERIENCE_PROFILE)
        + FINAL_RANKING_WEIGHTS.travelFit * travelFit(candidate, preference)
        + FINAL_RANKING_WEIGHTS.activityFit * activityScore(candidate, preference.activityLevel)
        + FINAL_RANKING_WEIGHTS.weatherFit * weatherFit(candidate, preference)
        + FINAL_RANKING_WEIGHTS.placeQuality * (candidate.placeQuality ?? 0)
        + FINAL_RANKING_WEIGHTS.novelty * noveltyScore(candidate, intentExperience);
    return { ...candidate, preliminaryScore: Number((score || base).toFixed(4)) };
  }).sort((left, right) => (right.preliminaryScore ?? 0) - (left.preliminaryScore ?? 0));
}

function interventionActivityFit(candidate: PlaceCandidate, preference: UserPreference) {
  const profile = candidate.activityProfile ?? derivePlaceActivityProfile(candidate.destinationCategory);
  const indoor = preference.indoorPreference * (profile.indoorOutdoor === "indoor" ? 1 : profile.indoorOutdoor === "mixed" ? 0.55 : 0.1);
  const movement = preference.movementPreference === "flexible" ? 0.7 : preference.movementPreference === profile.movementStyle ? 1 : profile.movementStyle === "mixed" ? 0.65 : 0.15;
  return (indoor + movement) / 2;
}
function interventionTransitFit(candidate: PlaceCandidate, preference: UserPreference) {
  if (preference.transportPreference !== "metro") return 0.5;
  if (candidate.route?.transit) return travelFit(candidate, preference);
  if (!candidate.metroAccess?.available || candidate.metroAccess.distanceMeters === undefined) return 0.1;
  return Math.max(0, 1 - candidate.metroAccess.distanceMeters / 1500);
}
export function scoreFinalistsAfterIntervention(candidates: PlaceCandidate[], preference: UserPreference): FinalistScore[] {
  return candidates.map((candidate) => {
    const profile = candidate.activityProfile ?? derivePlaceActivityProfile(candidate.destinationCategory);
    const dimensions = {
      preferenceFit: interestScore(candidate, preference),
      travelFit: travelFit(candidate, preference),
      activityFit: interventionActivityFit({ ...candidate, activityProfile: profile }, preference),
      weatherFit: profile.weatherExposure === "low" ? 1 : weatherFit(candidate, preference),
      placeQuality: candidate.placeQuality ?? 0,
      transitFit: interventionTransitFit(candidate, preference),
    };
    const total = Object.entries(INTERVENTION_FINALIST_WEIGHTS).reduce((sum, [key, weight]) => sum + dimensions[key as keyof typeof dimensions] * weight, 0);
    return { poiId: candidate.id, total: Number(total.toFixed(4)), dimensions };
  }).sort((a, b) => b.total - a.total);
}

function areSameDestination(left: PlaceCandidate, right: PlaceCandidate) {
  if (left.parentId && left.parentId === right.parentId) return true;
  const normalizedLeft = left.name.replaceAll(" ", "").toLowerCase();
  const normalizedRight = right.name.replaceAll(" ", "").toLowerCase();
  const namesOverlap = normalizedLeft === normalizedRight
    || (Math.min(normalizedLeft.length, normalizedRight.length) >= 4
      && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)));
  const coordinateGap = Math.hypot(left.longitude - right.longitude, left.latitude - right.latitude) * 111_000;
  return namesOverlap || (coordinateGap <= QUALITY_FILTER_CONFIG.sameDestinationDistanceMeters
    && left.destinationCategory === right.destinationCategory);
}

/** Selects distinct categories first, then fills remaining slots without same-destination duplicates. */
export function selectDiverseCandidates(ranked: PlaceCandidate[], limit = 3, strictCategories?: readonly DestinationCategory[]) {
  const eligible = strictCategories ? ranked.filter((candidate) => strictCategories.includes(candidate.destinationCategory)) : ranked;
  const selected: PlaceCandidate[] = [];
  const addIfDistinct = (candidate: PlaceCandidate) => {
    if (selected.length >= limit || selected.some((chosen) => areSameDestination(chosen, candidate))) return;
    selected.push(candidate);
  };
  const categories = new Set<string>();
  for (const candidate of eligible) {
    if (!categories.has(candidate.destinationCategory)) {
      addIfDistinct(candidate);
      categories.add(candidate.destinationCategory);
    }
  }
  for (const candidate of eligible) addIfDistinct(candidate);
  return selected;
}

export function createFactPacks(candidates: PlaceCandidate[]): PlaceFactPack[] {
  const transitValue = (route: NonNullable<NonNullable<PlaceCandidate["route"]>["transit"]>) => [
    route.usesMetro
      ? route.directMetro ? "地铁零换乘直达" : `地铁需换乘${route.transferCount ?? "未知"}次`
      : "公共交通方案不含地铁",
    `${route.durationMinutes}分钟`,
    `接驳步行${route.walkingDistanceMeters ?? "未知"}米`,
    ...(route.lineNames.length ? [route.lineNames.join(" → ")] : []),
  ].join("；");
  const strategyLabels = { fastest: "最快方案", leastWalking: "最少步行方案", leastTransfers: "最少换乘方案" } as const;
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    distanceMeters: candidate.distanceMeters,
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    ...(candidate.rating === undefined ? {} : { rating: candidate.rating }),
    ...(candidate.averageCostYuan === undefined ? {} : { averageCostYuan: candidate.averageCostYuan }),
    ...(candidate.route ? { route: candidate.route, travelTimeMinutes: candidate.route.transit?.durationMinutes ?? candidate.route.walking.durationMinutes ?? candidate.route.driving.durationMinutes } : {}),
    ...(candidate.weather ? { weather: candidate.weather } : {}),
    ...(candidate.locationLabel ? { locationLabel: candidate.locationLabel } : {}),
    ...(candidate.activityProfile ? { activityProfile: candidate.activityProfile } : {}),
    ...(candidate.metroAccess ? { metroAccess: candidate.metroAccess } : {}),
    evidence: [
      { id: `AMAP_${candidate.id}_CATEGORY`, type: "category" as const, value: candidate.category, source: "amap-nearby-poi" },
      { id: `AMAP_${candidate.id}_DISTANCE`, type: "distance" as const, value: candidate.distanceMeters, source: "amap-nearby-poi" },
      ...(candidate.rating === undefined ? [] : [{ id: `AMAP_${candidate.id}_RATING`, type: "rating" as const, value: candidate.rating, source: "amap-nearby-poi" }]),
      ...(candidate.averageCostYuan === undefined ? [] : [{ id: `AMAP_${candidate.id}_AVERAGE_COST`, type: "average_cost" as const, value: candidate.averageCostYuan, source: "amap-nearby-poi" }]),
      ...(candidate.route?.walking.available && candidate.route.walking.durationMinutes !== undefined ? [{ id: `AMAP_${candidate.id}_ROUTE_WALKING`, type: "route_time" as const, value: candidate.route.walking.durationMinutes, source: "amap", fetchedAt: new Date().toISOString() }] : []),
      ...(candidate.route?.driving.available && candidate.route.driving.durationMinutes !== undefined ? [{ id: `AMAP_${candidate.id}_ROUTE_DRIVING`, type: "route_time" as const, value: candidate.route.driving.durationMinutes, source: "amap", fetchedAt: new Date().toISOString() }] : []),
      ...(candidate.route?.transit?.available && candidate.route.transit.durationMinutes !== undefined ? [{
        id: `AMAP_${candidate.id}_TRANSIT_ROUTE`,
        type: "transit_route" as const,
        value: transitValue(candidate.route.transit),
        source: "amap-route-2.0",
        fetchedAt: new Date().toISOString(),
      }] : []),
      ...Object.entries(candidate.route?.transitStrategies ?? {}).flatMap(([strategy, route]) => route?.available && route.durationMinutes !== undefined ? [{
        id: `AMAP_${candidate.id}_TRANSIT_${strategy.toUpperCase()}`,
        type: "transit_route" as const,
        value: `${strategyLabels[strategy as keyof typeof strategyLabels]}；${transitValue(route)}`,
        source: "amap-route-2.0",
        fetchedAt: new Date().toISOString(),
      }] : []),
      ...(candidate.weather?.available && candidate.weather.weather ? [{ id: `AMAP_${candidate.id}_WEATHER`, type: "weather" as const, value: `${candidate.weather.temperatureC ?? ""}°C ${candidate.weather.weather}`, source: "amap", fetchedAt: candidate.weather.reportTime }] : []),
      ...(candidate.weather?.assessment ? [{ id: `AMAP_${candidate.id}_WEATHER_ASSESSMENT`, type: "weather_assessment" as const, value: candidate.weather.assessment.outdoorComfort, source: "deterministic-weather-assessment", fetchedAt: candidate.weather.reportTime }] : []),
      ...(candidate.activityProfile ? [{ id: `DERIVED_${candidate.id}_ACTIVITY_PROFILE`, type: "activity_profile" as const, value: candidate.activityProfile.activityType, source: "derived_category_rule" }] : []),
      ...(candidate.metroAccess?.available && candidate.metroAccess.stationName && candidate.metroAccess.distanceMeters !== undefined ? [{ id: `AMAP_${candidate.id}_METRO_ACCESS`, type: "metro_access" as const, value: `${candidate.metroAccess.stationName} ${candidate.metroAccess.distanceMeters}m`, source: "amap" }] : []),
      ...(candidate.locationLabel ? [{ id: `AMAP_${candidate.id}_CURRENT_LOCATION`, type: "location" as const, value: candidate.locationLabel, source: "amap" }] : []),
    ],
  }));
}
