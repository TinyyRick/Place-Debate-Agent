import { z } from "zod";

export const UserPreferenceSchema = z.object({
  activityLevel: z.enum(["low", "medium", "high"]),
  indoorPreference: z.number().min(0).max(1),
  naturePreference: z.number().min(0).max(1),
  culturePreference: z.number().min(0).max(1),
  budgetLevel: z.enum(["low", "medium", "flexible"]),
  companions: z.enum(["solo", "couple", "friends", "family"]).catch("solo"),
  transportPreference: z.enum(["walking", "driving", "metro", "flexible"]).default("flexible"),
  movementPreference: z.enum(["flexible", "mostly_seated", "walk_around", "light_active"]).default("flexible"),
  distanceTolerance: z.enum(["near", "moderate", "flexible_if_transit"]).default("near"),
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
    "movementPreference",
    "distanceTolerance",
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
