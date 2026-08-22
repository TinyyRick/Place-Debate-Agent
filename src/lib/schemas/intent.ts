import { z } from "zod";
import { DestinationCategorySchema } from "./place";
import { UserPreferenceSchema } from "./preference";

/** Intent is the task to accomplish; preference describes how it should feel. */
export const UserIntentSchema = z.object({
  primaryGoal: z.enum(["fitness", "shopping", "study", "leisure"]),
  requiredCategories: z.array(DestinationCategorySchema).min(1),
  excludedCategories: z.array(DestinationCategorySchema).default([]),
  searchTerms: z.array(z.string().min(1)).min(1).max(4),
  strictCategoryMatch: z.boolean(),
  summary: z.string().min(1).max(160),
});

export const IntentInterpretationSchema = z.object({
  intent: UserIntentSchema,
  preference: UserPreferenceSchema,
});

/** User language, deliberately separate from POI taxonomy and retrieval rules. */
export const IntentProfileSchema = z.object({
  goal: z.string().min(1).max(80),
  experience: z.string().min(1).max(120),
  constraints: z.array(z.string().min(1).max(80)).max(8),
  avoid: z.array(z.string().min(1).max(80)).max(8),
  missing_slots: z.array(z.string().min(1).max(80)).max(5),
});

export const IntentProfileInterpretationSchema = z.object({
  intentProfile: IntentProfileSchema,
  preference: UserPreferenceSchema,
});

export type UserIntent = z.infer<typeof UserIntentSchema>;
export type IntentProfile = z.infer<typeof IntentProfileSchema>;
