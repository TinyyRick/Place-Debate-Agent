import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { CandidateDecisionSchema, DebateMessageSchema, ModeratorResultSchema } from "@/lib/schemas/debate";
import { FinalistScoreSchema, PlaceCandidateSchema, PlaceFactPackSchema } from "@/lib/schemas/place";
import { PreferenceDeltaSchema, UserPreferenceSchema } from "@/lib/schemas/preference";
import { UserIntentSchema } from "@/lib/schemas/intent";
import { IntentProfileSchema } from "@/lib/schemas/intent";
import { ExperienceProfileSchema } from "@/lib/schemas/experience";
import { SearchPlanSchema } from "@/lib/schemas/search-plan";
import { CoordinatesSchema, LocationContextSchema, WeatherContextSchema } from "@/lib/schemas/location";

export const DebateStateSchema = new StateSchema({
  originalQuery: z.string().min(1),
  gpsCoordinates: CoordinatesSchema.optional(),
  location: LocationContextSchema.optional(),
  weather: WeatherContextSchema.optional(),
  userPreference: UserPreferenceSchema.optional(),
  originalPreference: UserPreferenceSchema.optional(),
  currentPreference: UserPreferenceSchema.optional(),
  userIntent: UserIntentSchema.optional(),
  intentProfile: IntentProfileSchema.optional(),
  userExperienceProfile: ExperienceProfileSchema.optional(),
  needsClarification: z.boolean().default(false),
  searchPlan: SearchPlanSchema.optional(),
  interventionText: z.string().default(""),
  preferenceDelta: PreferenceDeltaSchema.optional(),
  requiredEvidenceTypes: z.array(z.enum(["METRO_ACCESS"])).default([]),
  missingEvidenceTypes: z.array(z.enum(["METRO_ACCESS"])).default([]),
  beforeInterventionScores: z.array(FinalistScoreSchema).default([]),
  afterInterventionScores: z.array(FinalistScoreSchema).default([]),
  candidateDecision: CandidateDecisionSchema.optional(),
  eliminatedPoiIds: z.array(z.string()).default([]),
  survivingCandidateIds: z.array(z.string()).default([]),
  excludedPoiIds: z.array(z.string()).default([]),
  excludedCategories: z.array(z.string()).default([]),
  candidateRound: z.number().int().min(1).default(1),
  previousCandidateRounds: z.array(z.array(PlaceCandidateSchema)).default([]),
  refreshReason: z.string().default(""),
  selectedPoiId: z.string().optional(),
  finalDuelMessages: z.array(DebateMessageSchema).default([]),
  rawPois: z.array(PlaceCandidateSchema).default([]),
  scoredPois: z.array(PlaceCandidateSchema).default([]),
  filteredPois: z.array(PlaceCandidateSchema).default([]),
  rankedCandidates: z.array(PlaceCandidateSchema).default([]),
  selectedCandidates: z.array(PlaceCandidateSchema).default([]),
  enrichedCandidates: z.array(PlaceCandidateSchema).default([]),
  factPacks: z.array(PlaceFactPackSchema).default([]),
  openingMessages: z.array(DebateMessageSchema).default([]),
  attackMessages: z.array(DebateMessageSchema).default([]),
  rebuttalMessages: z.array(DebateMessageSchema).default([]),
  moderatorResult: ModeratorResultSchema.optional(),
});

export type DebateState = typeof DebateStateSchema.State;
