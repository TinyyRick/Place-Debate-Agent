import { z } from "zod";
import { PlaceFactPackSchema } from "./place";
import { UserPreferenceSchema } from "./preference";

export const OpeningOutputSchema = z.object({
  claim: z.string().min(1).max(240),
  evidenceIds: z.array(z.string()).min(1),
});

export const AttackOutputSchema = OpeningOutputSchema.extend({
  targetPoiId: z.string().min(1),
});

export const RebuttalOutputSchema = OpeningOutputSchema;

export const DebateMessageSchema = z.object({
  type: z.enum(["opening", "attack", "rebuttal"]),
  speakerPoiId: z.string().min(1),
  targetPoiId: z.string().min(1).optional(),
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
});

export const DebateResultSchema = z.object({
  originalQuery: z.string(),
  userPreference: UserPreferenceSchema,
  factPacks: z.array(PlaceFactPackSchema),
  openingMessages: z.array(DebateMessageSchema),
  attackMessages: z.array(DebateMessageSchema),
  rebuttalMessages: z.array(DebateMessageSchema),
  moderatorResult: ModeratorResultSchema,
});

export type OpeningOutput = z.infer<typeof OpeningOutputSchema>;
export type AttackOutput = z.infer<typeof AttackOutputSchema>;
export type RebuttalOutput = z.infer<typeof RebuttalOutputSchema>;
export type DebateMessage = z.infer<typeof DebateMessageSchema>;
export type ModeratorResult = z.infer<typeof ModeratorResultSchema>;
export type DebateResult = z.infer<typeof DebateResultSchema>;
