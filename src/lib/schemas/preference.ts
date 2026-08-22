import { z } from "zod";

export const UserPreferenceSchema = z.object({
  activityLevel: z.enum(["low", "medium", "high"]),
  indoorPreference: z.number().min(0).max(1),
  naturePreference: z.number().min(0).max(1),
  culturePreference: z.number().min(0).max(1),
  budgetLevel: z.enum(["low", "medium", "flexible"]),
  companions: z.enum(["solo", "couple", "friends", "family"]),
  transportPreference: z.enum(["walking", "driving", "flexible"]).default("flexible"),
  heatTolerance: z.number().min(0).max(1).default(0.5),
  rainTolerance: z.number().min(0).max(1).default(0.5),
  freeTextConstraints: z.array(z.string()),
});

export const PreferenceChangeSchema = z.object({
  field: z.enum([
    "activityLevel",
    "indoorPreference",
    "naturePreference",
    "culturePreference",
    "budgetLevel",
    "companions",
    "transportPreference",
    "heatTolerance",
    "rainTolerance",
    "freeTextConstraints",
  ]),
  before: z.union([z.string(), z.number(), z.array(z.string())]),
  after: z.union([z.string(), z.number(), z.array(z.string())]),
});

export const PreferenceDeltaSchema = z.object({
  interventionText: z.string(),
  changedFields: z.array(PreferenceChangeSchema),
});

export type UserPreference = z.infer<typeof UserPreferenceSchema>;
export type PreferenceDelta = z.infer<typeof PreferenceDeltaSchema>;
