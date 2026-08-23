import { z } from "zod";
import type { StructuredModel } from "@/lib/agents/model-factory";
import { ExperienceProfileSchema, type ExperienceProfile } from "@/lib/schemas/experience";
import { PlaceCandidateSchema, type PlaceCandidate } from "@/lib/schemas/place";

// DeepSeek's structured-output endpoint requires an object at the JSON-schema
// root, so the batch array is wrapped without changing its item contract.
const BatchExperienceResponseSchema = z.object({
  items: z.array(z.object({ poiId: z.string().min(1) }).merge(ExperienceProfileSchema)),
});

/** Safety net for an omitted model item; it is intentionally not category-derived. */
export const NEUTRAL_EXPERIENCE_PROFILE: ExperienceProfile = {
  activityLevel: 0.5,
  engagementType: "consumption",
  socialFit: "either",
  pace: 0.5,
  spatial: "mixed",
  stimulation: 0.5,
  costTier: "medium",
};

export function isExperienceCompatible(intent: ExperienceProfile, poi: ExperienceProfile) {
  if (intent.engagementType === "exploration" && poi.engagementType === "functional") return false;
  return Math.abs(intent.activityLevel - poi.activityLevel) <= 0.5;
}

export function experienceMatchScore(intent: ExperienceProfile, poi: ExperienceProfile) {
  const numericDistance = Math.abs(intent.activityLevel - poi.activityLevel)
    + Math.abs(intent.pace - poi.pace)
    + Math.abs(intent.stimulation - poi.stimulation);
  const categoricalPenalty = (intent.engagementType === poi.engagementType ? 0 : 1)
    + (poi.socialFit === "either" || intent.socialFit === poi.socialFit ? 0 : 1)
    + (poi.spatial === "mixed" || intent.spatial === poi.spatial ? 0 : 1);
  return Number(Math.max(0, Math.min(1, 1 - (numericDistance + categoricalPenalty) / 6)).toFixed(4));
}

export async function scorePlaceExperiences(candidates: PlaceCandidate[], model: StructuredModel) {
  if (!candidates.length) return [];
  const response = await model.invoke(BatchExperienceResponseSchema, [
    {
      role: "system",
      content: "你是地点体验评分器。根据地点名称、AMap 类型码与类别，为每个地点输出固定七维 ExperienceProfile。不要推荐、不要解释、不要捏造具体设施或价格。自习室、办事点等以专注/办事为主的地点应为 functional；博物馆、展览馆、可游逛艺术空间应为 exploration。必须把所有结果放在 items 数组中，并为输入的每个 poiId 返回一项。",
    },
    {
      role: "user",
      content: JSON.stringify(candidates.map((candidate) => ({
        poiId: candidate.id,
        name: candidate.name,
        typeCode: candidate.typeCode,
        category: candidate.category,
        address: candidate.address,
      }))),
    },
  ], "place_experience_batch");
  const inputIds = new Set(candidates.map((candidate) => candidate.id));
  const byId = new Map(response.items.filter((item) => inputIds.has(item.poiId)).map((item) => [item.poiId, item]));
  return candidates.map((candidate) => PlaceCandidateSchema.parse({
    ...candidate,
    experienceProfile: byId.get(candidate.id) ?? NEUTRAL_EXPERIENCE_PROFILE,
  }));
}
