import { z } from "zod";
import { DestinationCategorySchema } from "./place";
import { UserIntentSchema } from "./intent";
import { IntentProfileSchema } from "./intent";

export const AMapSearchQuerySchema = z.object({
  label: z.string().min(1),
  typeCodes: z.string().min(1),
  keywords: z.array(z.string()).min(1),
  searchKeyword: z.string().min(1).optional(),
});

export const AMapQueryMetricSchema = z.object({
  label: z.string().min(1),
  typeCodes: z.string().min(1),
  rawCount: z.number().int().nonnegative(),
});

export const SearchPlanSchema = z.object({
  intentProfile: IntentProfileSchema,
  intent: UserIntentSchema,
  radiusMeters: z.number().int().positive().max(20_000),
  queries: z.array(AMapSearchQuerySchema).min(1),
  allowedCategories: z.array(DestinationCategorySchema).min(1),
  prohibitedCategories: z.array(DestinationCategorySchema).default([]),
  rankingPriorities: z.array(z.string().min(1)).min(1),
  // Reserved for future speculative retrieval; this stage always leaves it empty.
  speculativeQueries: z.array(AMapSearchQuerySchema).default([]),
});

export type SearchPlan = z.infer<typeof SearchPlanSchema>;
export type AMapQueryMetric = z.infer<typeof AMapQueryMetricSchema>;
