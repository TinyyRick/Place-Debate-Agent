import { z } from "zod";

export const UserPreferenceSchema = z.object({
  activityLevel: z.enum(["low", "medium", "high"]),
  indoorPreference: z.number().min(0).max(1),
  naturePreference: z.number().min(0).max(1),
  culturePreference: z.number().min(0).max(1),
  budgetLevel: z.enum(["low", "medium", "flexible"]),
  companions: z.enum(["solo", "couple", "friends", "family"]),
  freeTextConstraints: z.array(z.string()),
});

export type UserPreference = z.infer<typeof UserPreferenceSchema>;
