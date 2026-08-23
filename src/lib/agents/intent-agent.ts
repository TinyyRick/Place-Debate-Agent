import { IntentProfileInterpretationSchema, type IntentProfile } from "@/lib/schemas/intent";
import type { ExperienceProfile } from "@/lib/schemas/experience";
import { PreferenceDeltaSchema, UserPreferenceSchema, type PreferenceDelta, type UserPreference } from "@/lib/schemas/preference";
import type { StructuredModel } from "./model-factory";
import { z } from "zod";

const PreferenceUpdateSchema = z.object({ updatedPreference: UserPreferenceSchema });

export async function interpretIntent(
  originalQuery: string,
  model: StructuredModel,
): Promise<{ intentProfile: IntentProfile; preference: UserPreference; userExperienceProfile: ExperienceProfile }> {
  const interpretation = await model.invoke(
    IntentProfileInterpretationSchema,
    [
      {
        role: "system",
        content:
          "你是地点决策助手的 Intent Extractor。只提取用户已经表达的需求，输出 intentProfile、preference 和 userExperienceProfile。intentProfile 的 goal、activityIntensity、activityMode、experienceGoal、constraints、avoid、companion、budget 都描述用户想获得的体验与限制；不得填写任何 POI 类型、搜索关键词或推荐方案。userExperienceProfile 必须用固定七维体验向量描述用户，不得使用地点类别。用户说一个人时 companion=solo 且 userExperienceProfile.socialFit=solo；说不花钱/免费时 budget=free 且 costTier=free。没有明确说出时 companion 和 budget 保持未填写，但仍给 userExperienceProfile 提供保守的中性估计。低强度不等于久坐：若用户说“不想太累”且同时表达“有点意思/探索/体验”，activityMode 应包含 light_exploration，experienceGoal 应包含 exploration，而不是 mostly_seated；对应的 userExperienceProfile.engagementType 应为 exploration。missingSlots 只能从 experience_type、activity_type、companion、budget、time、transport 中选择。默认空数组：不要因为缺少时间、预算、交通而要求澄清。只有用户目标有多个会导致完全不同推荐方向的解释时才使用 experience_type（例如“室内逛逛”“出去玩玩”）；用户想做某类事情但活动不明确时才使用 activity_type（例如“想运动”）。",
      },
      { role: "user", content: originalQuery },
    ],
    "intent_profile",
  );
  return {
    intentProfile: interpretation.intentProfile,
    preference: UserPreferenceSchema.parse(interpretation.preference),
    userExperienceProfile: interpretation.userExperienceProfile,
  };
}

export async function updateIntentFromClarification(originalQuery: string, previousProfile: IntentProfile, answer: string, model: StructuredModel) {
  const interpretation = await model.invoke(IntentProfileInterpretationSchema, [
    { role: "system", content: "你是地点决策助手的 Intent Extractor。根据原始需求与用户的澄清，更新 intentProfile；只保留用户说过的信息。已经获得的 missingSlots 必须移除；不要输出 POI 类型、搜索词或推荐。" },
    { role: "user", content: `原始需求：${originalQuery}\n当前 IntentProfile：${JSON.stringify(previousProfile)}\n用户澄清：${answer}` },
  ], "intent_profile_update");
  return {
    intentProfile: interpretation.intentProfile,
    preference: UserPreferenceSchema.parse(interpretation.preference),
    userExperienceProfile: interpretation.userExperienceProfile,
  };
}

function sameValue(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }

export async function updatePreferenceFromIntervention(
  previousPreference: UserPreference,
  interventionText: string,
  model: StructuredModel,
): Promise<{ updatedPreference: UserPreference; preferenceDelta: PreferenceDelta }> {
  if (!interventionText.trim()) {
    return { updatedPreference: previousPreference, preferenceDelta: PreferenceDeltaSchema.parse({ interventionText: "", changedFields: [] }) };
  }
  const { updatedPreference } = await model.invoke(
    PreferenceUpdateSchema,
    [
      { role: "system", content: "你是地点决策助手的偏好更新器。只更新用户这次补充明确改变的字段；其余字段必须与 previousPreference 完全一致。不得从地点事实推断偏好。" },
      { role: "user", content: `previousPreference: ${JSON.stringify(previousPreference)}\ninterventionText: ${interventionText}` },
    ],
    "preference_update",
  );
  // Explicit user phrases are deterministic guardrails over the structured model output.
  const explicit = { ...updatedPreference };
  if (interventionText.includes("室内")) explicit.indoorPreference = Math.max(explicit.indoorPreference, 0.9);
  if (interventionText.includes("不想去坐着不动")) explicit.movementPreference = "walk_around";
  if (interventionText.includes("地铁附近")) explicit.transportPreference = "metro";
  if (interventionText.includes("稍微远一点")) explicit.distanceTolerance = "flexible_if_transit";
  const normalizedPreference = UserPreferenceSchema.parse(explicit);
  const changedFields = (Object.keys(previousPreference) as Array<keyof UserPreference>).flatMap((field) => {
    const before = previousPreference[field];
    const after = normalizedPreference[field];
    return sameValue(before, after) ? [] : [{ field, before, after }];
  });
  return {
    updatedPreference: normalizedPreference,
    preferenceDelta: PreferenceDeltaSchema.parse({ interventionText, changedFields }),
  };
}
