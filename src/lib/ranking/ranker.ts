import type { FinalistScore, PlaceFactPack, PlaceCandidate } from "@/lib/schemas/place";
import type { UserPreference } from "@/lib/schemas/preference";
import { FINAL_RANKING_WEIGHTS, INTERVENTION_FINALIST_WEIGHTS, QUALITY_FILTER_CONFIG, RANKING_WEIGHTS } from "./config";
import { calculatePlaceQuality, classifyDestinationCategory, isDestinationCategory } from "./taxonomy";
import { derivePlaceActivityProfile } from "./activity-profile";

export { RANKING_WEIGHTS } from "./config";
export { FINAL_RANKING_WEIGHTS } from "./config";
export { INTERVENTION_FINALIST_WEIGHTS } from "./config";

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

function interestScore(candidate: PlaceCandidate, preference: UserPreference) {
  switch (candidate.destinationCategory) {
    case "park": return preference.naturePreference;
    case "attraction": return preference.naturePreference * 0.55 + preference.culturePreference * 0.45;
    case "museum": case "gallery": case "cultural": return preference.culturePreference;
    case "bookstore": return preference.culturePreference * 0.85 + preference.indoorPreference * 0.15;
    case "cafe": return preference.indoorPreference * 0.6 + 0.35;
    case "cinema": return preference.indoorPreference * 0.5 + preference.culturePreference * 0.5;
    case "entertainment": return 0.55;
    case "shopping": return 0.3;
    default: return 0.2;
  }
}

function activityScore(candidate: PlaceCandidate, activityLevel: UserPreference["activityLevel"]) {
  const indoorFriendly = ["museum", "gallery", "bookstore", "cafe", "cinema", "cultural"].includes(candidate.destinationCategory);
  if (activityLevel === "low") return indoorFriendly ? 1 : candidate.destinationCategory === "shopping" ? 0.75 : 0.55;
  if (activityLevel === "high") return ["park", "attraction", "entertainment"].includes(candidate.destinationCategory) ? 1 : 0.7;
  return 0.8;
}

function noveltyScore(candidate: PlaceCandidate, preference: UserPreference) {
  const asksForInterest = preference.freeTextConstraints.some((constraint) =>
    ["有意思", "新奇", "特别", "逛"].some((term) => constraint.includes(term)),
  );
  if (!asksForInterest) return 0.6;
  return ["museum", "gallery", "bookstore", "attraction", "cultural", "entertainment"].includes(candidate.destinationCategory) ? 1 : 0.55;
}

export function rankCandidates(candidates: PlaceCandidate[], preference: UserPreference) {
  return candidates.map(enrichCandidate).map((candidate) => {
    const distance = Math.max(0, 1 - candidate.distanceMeters / QUALITY_FILTER_CONFIG.fallbackDistanceMeters);
    const score = RANKING_WEIGHTS.interestFit * interestScore(candidate, preference)
      + RANKING_WEIGHTS.distance * distance
      + RANKING_WEIGHTS.activityFit * activityScore(candidate, preference.activityLevel)
      + RANKING_WEIGHTS.placeQuality * (candidate.placeQuality ?? 0)
      + RANKING_WEIGHTS.novelty * noveltyScore(candidate, preference);
    return { ...candidate, preliminaryScore: Number(score.toFixed(4)) };
  }).sort((left, right) => (right.preliminaryScore ?? 0) - (left.preliminaryScore ?? 0));
}

function isIndoor(candidate: PlaceCandidate) { return ["museum", "gallery", "bookstore", "cafe", "cinema", "cultural"].includes(candidate.destinationCategory); }
function travelFit(candidate: PlaceCandidate, preference: UserPreference) {
  const walking = candidate.route?.walking.durationMinutes;
  const driving = candidate.route?.driving.durationMinutes;
  const score = (minutes: number | undefined, cap: number) => minutes === undefined ? undefined : Math.max(0, 1 - minutes / cap);
  if (preference.transportPreference === "walking") return score(walking, 45) ?? 0.4;
  if (preference.transportPreference === "driving") return score(driving, 35) ?? 0.4;
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
export function finalRankCandidates(candidates: PlaceCandidate[], preference: UserPreference) {
  return candidates.map((candidate) => {
    const base = candidate.preliminaryScore ?? 0;
    const score = FINAL_RANKING_WEIGHTS.interestFit * interestScore(candidate, preference)
      + FINAL_RANKING_WEIGHTS.travelFit * travelFit(candidate, preference)
      + FINAL_RANKING_WEIGHTS.activityFit * activityScore(candidate, preference.activityLevel)
      + FINAL_RANKING_WEIGHTS.weatherFit * weatherFit(candidate, preference)
      + FINAL_RANKING_WEIGHTS.placeQuality * (candidate.placeQuality ?? 0)
      + FINAL_RANKING_WEIGHTS.novelty * noveltyScore(candidate, preference);
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
export function selectDiverseCandidates(ranked: PlaceCandidate[], limit = 3) {
  const selected: PlaceCandidate[] = [];
  const addIfDistinct = (candidate: PlaceCandidate) => {
    if (selected.length >= limit || selected.some((chosen) => areSameDestination(chosen, candidate))) return;
    selected.push(candidate);
  };
  const categories = new Set<string>();
  for (const candidate of ranked) {
    if (!categories.has(candidate.destinationCategory)) {
      addIfDistinct(candidate);
      categories.add(candidate.destinationCategory);
    }
  }
  for (const candidate of ranked) addIfDistinct(candidate);
  return selected;
}

export function createFactPacks(candidates: PlaceCandidate[]): PlaceFactPack[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    distanceMeters: candidate.distanceMeters,
    ...(candidate.rating === undefined ? {} : { rating: candidate.rating }),
    ...(candidate.route ? { route: candidate.route, travelTimeMinutes: candidate.route.walking.durationMinutes ?? candidate.route.driving.durationMinutes } : {}),
    ...(candidate.weather ? { weather: candidate.weather } : {}),
    ...(candidate.locationLabel ? { locationLabel: candidate.locationLabel } : {}),
    ...(candidate.activityProfile ? { activityProfile: candidate.activityProfile } : {}),
    ...(candidate.metroAccess ? { metroAccess: candidate.metroAccess } : {}),
    evidence: [
      { id: `AMAP_${candidate.id}_CATEGORY`, type: "category" as const, value: candidate.category, source: "amap-nearby-poi" },
      { id: `AMAP_${candidate.id}_DISTANCE`, type: "distance" as const, value: candidate.distanceMeters, source: "amap-nearby-poi" },
      ...(candidate.rating === undefined ? [] : [{ id: `AMAP_${candidate.id}_RATING`, type: "rating" as const, value: candidate.rating, source: "amap-nearby-poi" }]),
      ...(candidate.route?.walking.available && candidate.route.walking.durationMinutes !== undefined ? [{ id: `AMAP_${candidate.id}_ROUTE_WALKING`, type: "route_time" as const, value: candidate.route.walking.durationMinutes, source: "amap", fetchedAt: new Date().toISOString() }] : []),
      ...(candidate.route?.driving.available && candidate.route.driving.durationMinutes !== undefined ? [{ id: `AMAP_${candidate.id}_ROUTE_DRIVING`, type: "route_time" as const, value: candidate.route.driving.durationMinutes, source: "amap", fetchedAt: new Date().toISOString() }] : []),
      ...(candidate.weather?.available && candidate.weather.weather ? [{ id: `AMAP_${candidate.id}_WEATHER`, type: "weather" as const, value: `${candidate.weather.temperatureC ?? ""}°C ${candidate.weather.weather}`, source: "amap", fetchedAt: candidate.weather.reportTime }] : []),
      ...(candidate.weather?.assessment ? [{ id: `AMAP_${candidate.id}_WEATHER_ASSESSMENT`, type: "weather_assessment" as const, value: candidate.weather.assessment.outdoorComfort, source: "deterministic-weather-assessment", fetchedAt: candidate.weather.reportTime }] : []),
      ...(candidate.activityProfile ? [{ id: `DERIVED_${candidate.id}_ACTIVITY_PROFILE`, type: "activity_profile" as const, value: candidate.activityProfile.activityType, source: "derived_category_rule" }] : []),
      ...(candidate.metroAccess?.available && candidate.metroAccess.stationName && candidate.metroAccess.distanceMeters !== undefined ? [{ id: `AMAP_${candidate.id}_METRO_ACCESS`, type: "metro_access" as const, value: `${candidate.metroAccess.stationName} ${candidate.metroAccess.distanceMeters}m`, source: "amap" }] : []),
      ...(candidate.locationLabel ? [{ id: `AMAP_${candidate.id}_CURRENT_LOCATION`, type: "location" as const, value: candidate.locationLabel, source: "amap" }] : []),
    ],
  }));
}
