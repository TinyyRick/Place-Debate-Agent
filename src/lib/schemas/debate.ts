import { z } from "zod";
import { FinalistScoreSchema, PlaceCandidateSchema, PlaceFactPackSchema } from "./place";
import { PreferenceDeltaSchema, UserPreferenceSchema } from "./preference";
import { UserIntentSchema } from "./intent";
import { IntentProfileSchema } from "./intent";
import { ExperienceProfileSchema } from "./experience";
import { SearchPlanSchema } from "./search-plan";
import { LocationContextSchema, WeatherContextSchema } from "./location";

export const OpeningOutputSchema = z.object({
  claim: z.string().min(1).max(240),
  evidenceIds: z.array(z.string()).min(1),
});

export const AttackOutputSchema = OpeningOutputSchema.extend({
  targetPoiId: z.string().min(1),
});

export const RebuttalOutputSchema = OpeningOutputSchema.extend({
  responseToAttackId: z.string().min(1),
  attackerPoiId: z.string().min(1),
});
export const CandidateDecisionSchema = z.discriminatedUnion("actionType", [
  z.object({ actionType: z.literal("eliminate_candidate"), eliminatedPoiId: z.string().min(1) }),
  z.object({ actionType: z.literal("refresh_candidates"), feedbackText: z.string().default(""), selectedReasons: z.array(z.string()).default([]) }),
  z.object({ actionType: z.literal("continue_with_feedback"), feedbackText: z.string().default("") }),
]);

export const DebateMessageSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["opening", "attack", "rebuttal"]),
  speakerPoiId: z.string().min(1),
  targetPoiId: z.string().min(1).optional(),
  responseToAttackId: z.string().min(1).optional(),
  attackerPoiId: z.string().min(1).optional(),
  claim: z.string().min(1).max(240),
  evidenceIds: z.array(z.string()).min(1),
});

export const RankingItemSchema = z.object({
  poiId: z.string().min(1),
  reason: z.string().min(1),
});

export const TradeoffSchema = z.object({
  poiId: z.string().min(1),
  strengths: z.array(z.string()).min(1),
  weaknesses: z.array(z.string()).min(1),
});

export const ModeratorResultSchema = z.object({
  conflictAxes: z.array(z.string()).min(1),
  rankingByCurrentFit: z.array(RankingItemSchema).min(1),
  tradeoffs: z.array(TradeoffSchema).min(1),
  recommendationSummary: z.string().min(1),
  preferenceImpact: z.string().min(1),
});

export const DebateResultSchema = z.object({
  originalQuery: z.string(),
  userPreference: UserPreferenceSchema,
  originalPreference: UserPreferenceSchema,
  currentPreference: UserPreferenceSchema,
  intentProfile: IntentProfileSchema,
  experienceProfile: ExperienceProfileSchema,
  userIntent: UserIntentSchema,
  searchPlan: SearchPlanSchema,
  interventionText: z.string(),
  preferenceDelta: PreferenceDeltaSchema.optional(),
  requiredEvidenceTypes: z.array(z.enum(["METRO_ACCESS"])),
  missingEvidenceTypes: z.array(z.enum(["METRO_ACCESS"])),
  beforeInterventionScores: z.array(FinalistScoreSchema),
  afterInterventionScores: z.array(FinalistScoreSchema),
  eliminatedPoiIds: z.array(z.string()),
  survivingCandidateIds: z.array(z.string()),
  excludedPoiIds: z.array(z.string()),
  candidateRound: z.number().int(),
  selectedPoiId: z.string().optional(),
  finalDuelMessages: z.array(DebateMessageSchema),
  location: LocationContextSchema,
  weather: WeatherContextSchema,
  rawPois: z.array(PlaceCandidateSchema),
  scoredPois: z.array(PlaceCandidateSchema),
  filteredPois: z.array(PlaceCandidateSchema),
  rankedCandidates: z.array(PlaceCandidateSchema),
  selectedCandidates: z.array(PlaceCandidateSchema),
  enrichedCandidates: z.array(PlaceCandidateSchema),
  factPacks: z.array(PlaceFactPackSchema),
  openingMessages: z.array(DebateMessageSchema),
  attackMessages: z.array(DebateMessageSchema),
  rebuttalMessages: z.array(DebateMessageSchema),
  moderatorResult: ModeratorResultSchema.optional(),
});

export type OpeningOutput = z.infer<typeof OpeningOutputSchema>;
export type AttackOutput = z.infer<typeof AttackOutputSchema>;
export type RebuttalOutput = z.infer<typeof RebuttalOutputSchema>;
export type CandidateDecision = z.infer<typeof CandidateDecisionSchema>;
export type DebateMessage = z.infer<typeof DebateMessageSchema>;
export type ModeratorResult = z.infer<typeof ModeratorResultSchema>;
export type DebateResult = z.infer<typeof DebateResultSchema>;
