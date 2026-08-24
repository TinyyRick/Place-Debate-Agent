import { z } from "zod";

/** A fixed set of experiential dimensions shared by user intent and POIs. */
export const ExperienceProfileSchema = z.object({
  activityLevel: z.number().min(0).max(1),
  // `rest` means a low-stimulation, non-task-oriented stay. It is deliberately
  // distinct from `functional` (for example, studying) and `consumption`.
  engagementType: z.enum(["exploration", "consumption", "functional", "social", "rest"]),
  socialFit: z.enum(["solo", "group", "either"]),
  pace: z.number().min(0).max(1),
  spatial: z.enum(["indoor", "outdoor", "mixed"]),
  stimulation: z.number().min(0).max(1),
  costTier: z.enum(["free", "low", "medium", "high"]),
  source: z.enum(["model", "fallback"]).optional(),
});

export type ExperienceProfile = z.infer<typeof ExperienceProfileSchema>;
