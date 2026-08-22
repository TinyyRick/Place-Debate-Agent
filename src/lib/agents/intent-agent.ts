import { IntentInterpretationSchema, UserIntentSchema, type UserIntent } from "@/lib/schemas/intent";
import { PreferenceDeltaSchema, UserPreferenceSchema, type PreferenceDelta, type UserPreference } from "@/lib/schemas/preference";
import type { StructuredModel } from "./model-factory";
import { z } from "zod";

const PreferenceUpdateSchema = z.object({ updatedPreference: UserPreferenceSchema });

export async function interpretIntent(
  originalQuery: string,
  model: StructuredModel,
): Promise<{ intent: UserIntent; preference: UserPreference }> {
  const interpretation = await model.invoke(
    IntentInterpretationSchema,
    [
      {
        role: "system",
        content:
          "你是地点决策助手的意图解释器。输出 intent 与 preference：intent 是用户想完成的事情，必须区分 fitness(健身运动)、shopping(室内逛街购物)、study(学习阅读) 和 leisure(普通游玩)；preference 是该事情应如何进行。若用户明确说健身、逛街购物、学习阅读，strictCategoryMatch 必须为 true，requiredCategories 只能包含匹配任务的地点类别；不得把偏好、地点事实或建议混入 intent。数值偏好范围为 0 到 1；只提取用户表达或可谨慎推断的约束。",
      },
      { role: "user", content: originalQuery },
    ],
    "intent_interpretation",
  );
  return { intent: normalizeExplicitIntent(originalQuery, interpretation.intent), preference: UserPreferenceSchema.parse(interpretation.preference) };
}

/** Explicit task words are guardrails: a structured model may not dilute them into generic leisure. */
function normalizeExplicitIntent(query: string, intent: UserIntent): UserIntent {
  const withGoal = (primaryGoal: UserIntent["primaryGoal"], requiredCategories: UserIntent["requiredCategories"], terms: string[]) =>
    UserIntentSchema.parse({ ...intent, primaryGoal, requiredCategories, excludedCategories: [], searchTerms: terms, strictCategoryMatch: true });
  if (/健身房|健身|瑜伽|游泳/.test(query)) return withGoal("fitness", ["fitness"], ["健身房", "健身", "运动馆"]);
  if (/逛街|购物|商场|买东西/.test(query)) return withGoal("shopping", ["shopping"], ["商场", "购物中心", "百货"]);
  if (/学习|看书|自习|阅读/.test(query)) return withGoal("study", ["bookstore", "cultural", "cafe"], ["图书馆", "书店", "书局", "安静咖啡馆"]);
  return UserIntentSchema.parse(intent);
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
