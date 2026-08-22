import type { PlaceFactPack, PlaceCandidate } from "@/lib/schemas/place";
import type { UserPreference } from "@/lib/schemas/preference";

const MAX_DISTANCE_METERS = 5_000;

export const RANKING_WEIGHTS = {
  distance: 0.45,
  interest: 0.30,
  activity: 0.15,
  rating: 0.10,
} as const;

function categoryKind(candidate: PlaceCandidate) {
  if (candidate.typeCode.startsWith("1100")) return "nature";
  if (candidate.typeCode.startsWith("1400")) return "culture";
  return "shopping";
}

function activityScore(candidate: PlaceCandidate, activityLevel: UserPreference["activityLevel"]) {
  const kind = categoryKind(candidate);
  if (activityLevel === "low") return kind === "nature" ? 0.55 : 1;
  if (activityLevel === "high") return kind === "nature" ? 1 : 0.7;
  return 0.8;
}

function interestScore(candidate: PlaceCandidate, preference: UserPreference) {
  const kind = categoryKind(candidate);
  if (kind === "nature") return preference.naturePreference;
  if (kind === "culture") return preference.culturePreference;
  return 0.35;
}

export function hardFilterPois(candidates: PlaceCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (candidate.distanceMeters > MAX_DISTANCE_METERS) return false;
    if (!/^(1100|1400|0600)/.test(candidate.typeCode)) return false;
    const dedupeKey = `${candidate.name.trim().toLowerCase()}-${candidate.longitude.toFixed(4)}-${candidate.latitude.toFixed(4)}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
}

export function rankCandidates(candidates: PlaceCandidate[], preference: UserPreference) {
  return candidates
    .map((candidate) => {
      const distance = Math.max(0, 1 - candidate.distanceMeters / MAX_DISTANCE_METERS);
      const rating = candidate.rating === undefined ? 0.5 : candidate.rating / 5;
      const score = RANKING_WEIGHTS.distance * distance
        + RANKING_WEIGHTS.interest * interestScore(candidate, preference)
        + RANKING_WEIGHTS.activity * activityScore(candidate, preference.activityLevel)
        + RANKING_WEIGHTS.rating * rating;
      return { ...candidate, preliminaryScore: Number(score.toFixed(4)) };
    })
    .sort((left, right) => (right.preliminaryScore ?? 0) - (left.preliminaryScore ?? 0));
}

export function createFactPacks(candidates: PlaceCandidate[]): PlaceFactPack[] {
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    distanceMeters: candidate.distanceMeters,
    ...(candidate.rating === undefined ? {} : { rating: candidate.rating }),
    evidence: [
      { id: `AMAP_${candidate.id}_CATEGORY`, type: "category" as const, value: candidate.category, source: "amap-nearby-poi" },
      { id: `AMAP_${candidate.id}_DISTANCE`, type: "distance" as const, value: candidate.distanceMeters, source: "amap-nearby-poi" },
      ...(candidate.rating === undefined ? [] : [{ id: `AMAP_${candidate.id}_RATING`, type: "rating" as const, value: candidate.rating, source: "amap-nearby-poi" }]),
    ],
  }));
}
