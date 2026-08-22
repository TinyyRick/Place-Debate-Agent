import {
  ModeratorResultSchema,
  type DebateMessage,
  type ModeratorResult,
} from "@/lib/schemas/debate";
import type { PlaceFactPack } from "@/lib/schemas/place";
import type { UserPreference } from "@/lib/schemas/preference";
import type { PreferenceDelta } from "@/lib/schemas/preference";
import type { StructuredModel } from "./model-factory";
import type { FinalistScore } from "@/lib/schemas/place";

export async function moderateDebate(
  originalPreference: UserPreference,
  currentPreference: UserPreference,
  preferenceDelta: PreferenceDelta,
  beforeScores: FinalistScore[],
  afterScores: FinalistScore[],
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
          "你是中立主持人。仅根据 FactPacks、before/after deterministic scores 和辩论内容总结当前匹配度、冲突轴与取舍。明确区分事实、取舍和推断；缺失证据必须写为未知。METRO_ACCESS 缺失时不得称地铁方便。必须在 preferenceImpact 中说明用户补充改变了哪些偏好及其评分影响；候选池没有重新召回。最终选择权属于用户。",
      },
      {
        role: "user",
        content: `原始用户偏好：${JSON.stringify(originalPreference)}\n当前用户偏好：${JSON.stringify(currentPreference)}\n偏好变化：${JSON.stringify(preferenceDelta)}\n干预前分数：${JSON.stringify(beforeScores)}\n干预后分数：${JSON.stringify(afterScores)}\nFactPacks：${JSON.stringify(factPacks)}\n完整辩论：${JSON.stringify(messages)}`,
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
