import { UserPreferenceSchema, type UserPreference } from "@/lib/schemas/preference";
import type { StructuredModel } from "./model-factory";

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
