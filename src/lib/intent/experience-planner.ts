import type { IntentProfile } from "@/lib/schemas/intent";
import { UserPreferenceSchema, type UserPreference } from "@/lib/schemas/preference";

/** Deterministic experience translation; it never selects POI types or ranks POIs. */
export function planExperience(profile: IntentProfile, preference: UserPreference): UserPreference {
  const values = new Set([...profile.activityMode, ...profile.experienceGoal, ...profile.constraints].map((value) => value.toLowerCase()));
  const exploration = values.has("light_exploration") || values.has("exploration") || values.has("体验感") || values.has("有点意思");
  const indoor = values.has("indoor") || values.has("室内");
  const noCost = values.has("no_cost") || values.has("不花钱");
  return UserPreferenceSchema.parse({
    ...preference,
    activityLevel: profile.activityIntensity,
    movementPreference: exploration ? "walk_around" : preference.movementPreference,
    indoorPreference: indoor ? Math.max(preference.indoorPreference, 0.9) : preference.indoorPreference,
    budgetLevel: noCost ? "low" : preference.budgetLevel,
  });
}
