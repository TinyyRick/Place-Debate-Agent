import {
  ModeratorResultSchema,
  type DebateMessage,
  type ModeratorResult,
} from "@/lib/schemas/debate";
import type { PlaceFactPack } from "@/lib/schemas/place";
import type { UserPreference } from "@/lib/schemas/preference";
import type { StructuredModel } from "./model-factory";

export async function moderateDebate(
  preference: UserPreference,
  factPacks: PlaceFactPack[],
  messages: DebateMessage[],
  model: StructuredModel,
): Promise<ModeratorResult> {
  const result = await model.invoke(
    ModeratorResultSchema,
    [
      {
        role: "system",
        content:
          "你是中立主持人。仅根据 FactPacks 和辩论内容总结当前匹配度、冲突轴与取舍，不捏造事实，不把建议包装成绝对裁决，最终选择权属于用户。",
      },
      {
        role: "user",
        content: `用户偏好：${JSON.stringify(preference)}\nFactPacks：${JSON.stringify(factPacks)}\n完整辩论：${JSON.stringify(messages)}`,
      },
    ],
    "moderator_result",
  );

  const placeIds = new Set(factPacks.map((place) => place.id));
  const referencedIds = [
    ...result.rankingByCurrentFit.map((item) => item.poiId),
    ...result.tradeoffs.map((item) => item.poiId),
  ];
  if (referencedIds.some((id) => !placeIds.has(id))) {
    throw new Error("Moderator referenced an unknown place.");
  }
  if (
    result.rankingByCurrentFit.length !== factPacks.length ||
    new Set(result.rankingByCurrentFit.map((item) => item.poiId)).size !== factPacks.length
  ) {
    throw new Error("Moderator ranking must include every candidate exactly once.");
  }

  return result;
}
