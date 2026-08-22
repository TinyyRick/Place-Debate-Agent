import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { DebateMessageSchema, ModeratorResultSchema } from "@/lib/schemas/debate";
import { FinalistScoreSchema, PlaceCandidateSchema, PlaceFactPackSchema } from "@/lib/schemas/place";
import { PreferenceDeltaSchema, UserPreferenceSchema } from "@/lib/schemas/preference";
import { CoordinatesSchema, LocationContextSchema, WeatherContextSchema } from "@/lib/schemas/location";

export const DebateStateSchema = new StateSchema({
  originalQuery: z.string().min(1),
  gpsCoordinates: CoordinatesSchema.optional(),
  location: LocationContextSchema.optional(),
  weather: WeatherContextSchema.optional(),
  userPreference: UserPreferenceSchema.optional(),
  originalPreference: UserPreferenceSchema.optional(),
  currentPreference: UserPreferenceSchema.optional(),
  interventionText: z.string().default(""),
  preferenceDelta: PreferenceDeltaSchema.optional(),
  requiredEvidenceTypes: z.array(z.enum(["METRO_ACCESS"])).default([]),
  missingEvidenceTypes: z.array(z.enum(["METRO_ACCESS"])).default([]),
  beforeInterventionScores: z.array(FinalistScoreSchema).default([]),
  afterInterventionScores: z.array(FinalistScoreSchema).default([]),
  rawPois: z.array(PlaceCandidateSchema).default([]),
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
