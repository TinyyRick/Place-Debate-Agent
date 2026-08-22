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

export type UserIntent = z.infer<typeof UserIntentSchema>;
