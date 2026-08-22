import type { StructuredModel } from "@/lib/agents/model-factory";
import type { BaseMessageLike } from "@langchain/core/messages";
import type { ZodType } from "zod";

export const deterministicModel: StructuredModel = {
  async invoke<T extends Record<string, unknown>>(
    schema: ZodType<T>,
    messages: BaseMessageLike[],
    name: string,
  ): Promise<T> {
    const prompt = JSON.stringify(messages);
    const placeId = prompt.includes("代表地点“南京博物院”")
      ? "nanjing-museum"
      : prompt.includes("代表地点“先锋书店”")
        ? "pioneer-bookstore"
        : "xuanwu-lake";
    const ownEvidence = {
      "xuanwu-lake": "AMAP_xuanwu-lake_DISTANCE",
      "nanjing-museum": "AMAP_nanjing-museum_CATEGORY",
      "pioneer-bookstore": "AMAP_pioneer-bookstore_CATEGORY",
    }[placeId];
    const attackTarget = placeId === "nanjing-museum" ? "xuanwu-lake" : "nanjing-museum";
    const attackEvidence = placeId === "nanjing-museum"
      ? "AMAP_xuanwu-lake_CATEGORY"
      : "AMAP_nanjing-museum_CATEGORY";
    const responseToAttackId = prompt.includes("attack-xuanwu-lake-nanjing-museum")
      ? "attack-xuanwu-lake-nanjing-museum"
      : prompt.includes("attack-pioneer-bookstore-nanjing-museum")
        ? "attack-pioneer-bookstore-nanjing-museum"
        : "attack-nanjing-museum-xuanwu-lake";
    const attackerPoiId = responseToAttackId.split("-").slice(1, -2).join("-");
    const values: Record<string, unknown> = {
      user_preference: {
        activityLevel: "low",
        indoorPreference: 0.7,
        naturePreference: 0.6,
        culturePreference: 0.8,
        budgetLevel: "medium",
        companions: "solo",
        freeTextConstraints: ["不要太累", "有点意思"],
      },
      preference_update: {
        updatedPreference: {
          activityLevel: "low",
          naturePreference: 0.6,
          culturePreference: prompt.includes("历史建筑") ? 0.95 : 0.8,
          budgetLevel: "medium",
          companions: "solo",
          transportPreference: prompt.includes("地铁附近") ? "metro" : "flexible",
          movementPreference: prompt.includes("不想去坐着不动") ? "walk_around" : "flexible",
          distanceTolerance: prompt.includes("稍微远一点") ? "flexible_if_transit" : "near",
          indoorPreference: prompt.includes("室内") ? 0.9 : 0.7,
          heatTolerance: prompt.includes("不怕热") ? 0.9 : 0.5,
          rainTolerance: 0.5,
          freeTextConstraints: ["不要太累", "有点意思"],
        },
      },
      place_opening: {
        claim: "我能以清晰可核验的地点条件回应你的偏好。",
        evidenceIds: [ownEvidence],
      },
      final_duel: { claim: "我承认对手有优势，但当前二选一我更贴近你的核心取舍。", evidenceIds: [ownEvidence] },
      place_attack: {
        targetPoiId: attackTarget,
        claim: "对方的路程时间更长，需要权衡体力。",
        evidenceIds: [attackEvidence],
      },
      place_rebuttal: {
        claim: "我的室内条件可以降低天气带来的影响。",
        evidenceIds: [ownEvidence],
        responseToAttackId,
        attackerPoiId,
      },
      moderator_result: {
        conflictAxes: ["户外自然与室内文化", "路程时间"],
        rankingByCurrentFit: [
          { poiId: "nanjing-museum", reason: "室内且文化匹配度高" },
          { poiId: "pioneer-bookstore", reason: "室内且适合低活动量" },
          { poiId: "xuanwu-lake", reason: "自然偏好匹配但天气需权衡" },
        ],
        tradeoffs: [
          { poiId: "nanjing-museum", strengths: ["室内"], weaknesses: ["路程较长"] },
          { poiId: "pioneer-bookstore", strengths: ["室内"], weaknesses: ["评分相对较低"] },
          { poiId: "xuanwu-lake", strengths: ["自然"], weaknesses: ["高温天气"] },
        ],
        recommendationSummary: "若更看重轻松与文化，优先比较两个室内地点；最终选择仍由你决定。",
        preferenceImpact: "用户补充会改变文化与耐热取舍，但候选未重新排序。",
      },
    };

    return schema.parse(values[name]);
  },
};
