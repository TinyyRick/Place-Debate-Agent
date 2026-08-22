import { PreferenceDeltaSchema, UserPreferenceSchema, type PreferenceDelta, type UserPreference } from "@/lib/schemas/preference";
import type { StructuredModel } from "./model-factory";
import { z } from "zod";

const PreferenceUpdateSchema = z.object({ updatedPreference: UserPreferenceSchema });

export async function interpretIntent(
  originalQuery: string,
  model: StructuredModel,
): Promise<UserPreference> {
  return model.invoke(
    UserPreferenceSchema,
    [
      {
        role: "system",
        content:
          "你是地点决策助手的意图解释器。把用户自然语言转换为结构化偏好。数值偏好范围为 0 到 1；只提取用户表达或可谨慎推断的约束，不添加地点事实。",
      },
      { role: "user", content: originalQuery },
    ],
    "user_preference",
  );
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
  const changedFields = (Object.keys(previousPreference) as Array<keyof UserPreference>).flatMap((field) => {
    const before = previousPreference[field];
    const after = updatedPreference[field];
    return sameValue(before, after) ? [] : [{ field, before, after }];
  });
  return {
    updatedPreference,
    preferenceDelta: PreferenceDeltaSchema.parse({ interventionText, changedFields }),
  };
}
