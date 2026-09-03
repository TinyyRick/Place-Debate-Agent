import { z } from "zod";
import { DestinationCategorySchema } from "./place";
import { UserPreferenceSchema } from "./preference";
import { ExperienceProfileSchema } from "./experience";
export { ExperienceProfileSchema } from "./experience";
export type { ExperienceProfile } from "./experience";

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
export const ClarificationSlotSchema = z.enum([
  "experience_type",
  "activity_type",
  "companion",
  "budget",
  "time",
  "transport",
]);

export const ExplicitTargetSchema = z.object({
  // Preserve the user's concrete destination/activity wording. Search Planner,
  // rather than the LLM, decides how AMap should query it.
  // Models occasionally emit an empty text here; IntentProfileSchema drops the
  // whole explicitTarget in that case instead of failing the parse.
  text: z.string().max(40),
  specificity: z.enum(["broad", "specific"]),
}).optional();

export const IntentProfileSchema = z.object({
  goal: z.string().min(1).max(80),
  activityIntensity: z.enum(["low", "medium", "high"]),
  activityMode: z.array(z.string().min(1).max(80)).max(6),
  experienceGoal: z.array(z.string().min(1).max(80)).max(6),
  constraints: z.array(z.string().min(1).max(80)).max(8),
  avoid: z.array(z.string().min(1).max(80)).max(8),
  // These belong to the intent contract rather than only to the presentation
  // preference. They remain optional when the user has not stated them.
  companion: z.enum(["solo", "couple", "friends", "family"]).optional().catch(undefined),
  budget: z.enum(["free", "low", "medium", "flexible"]).optional().catch(undefined),
  // Explicitly named destination categories are preserved through retrieval so
  // they cannot be diluted into a broad leisure interpretation.
  mentionedCategories: z.array(z.enum([
    "park", "museum", "gallery", "bookstore", "cafe", "cinema", "fitness", "shopping", "cultural",
  ])).default([]),
  // Models occasionally emit an empty explicitTarget object when the query
  // names no concrete destination; drop it instead of failing the whole parse.
  explicitTarget: ExplicitTargetSchema.transform((target) => (target && target.text.trim().length > 0 ? target : undefined)).optional(),
  missingSlots: z.array(ClarificationSlotSchema).max(5),
});

export const IntentProfileInterpretationSchema = z.object({
  intentProfile: IntentProfileSchema,
  preference: UserPreferenceSchema,
  experienceProfile: ExperienceProfileSchema,
});

export type UserIntent = z.infer<typeof UserIntentSchema>;
export type IntentProfile = z.infer<typeof IntentProfileSchema>;
export type ClarificationSlot = z.infer<typeof ClarificationSlotSchema>;
