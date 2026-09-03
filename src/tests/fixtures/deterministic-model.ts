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
    const userText = JSON.stringify(messages.at(-1));
    const lastMessage = messages.at(-1);
    const lastContent = typeof lastMessage === "object" && lastMessage !== null && "content" in lastMessage && typeof lastMessage.content === "string"
      ? lastMessage.content
      : undefined;
    const jsonAfter = <T>(label: string): T | undefined => {
      if (!lastContent) return undefined;
      const start = lastContent.indexOf(label);
      if (start < 0) return undefined;
      const value = lastContent.slice(start + label.length).split("\n", 1)[0];
      try { return JSON.parse(value) as T; } catch { return undefined; }
    };
    const specificActivity = userText.includes("羽毛球")
      ? "羽毛球"
      : userText.includes("游泳")
        ? "游泳"
        : userText.includes("攀岩")
          ? "攀岩"
          : undefined;
    const isExercise = /健身|运动|羽毛球|游泳|攀岩/.test(userText);
    const isRest = /安静坐|安静休息|休息|放松|坐坐/.test(userText);
    const experiencePlaces = name === "place_experience_batch" && lastContent
      ? JSON.parse(lastContent) as Array<{ poiId: string; name: string }>
      : [];
    const ownPack = jsonAfter<{ id: string; evidence: Array<{ id: string; type: string }> }>("你的 FactPack：");
    const assignedCompetitor = jsonAfter<{ id: string; evidence: Array<{ id: string; type: string }> }>("系统指定的对手 FactPack：");
    const receivedAttack = jsonAfter<{ id: string; speakerPoiId: string }>("针对你的唯一实际攻击：");
    const placeId = ownPack?.id ?? (prompt.includes("代表地点“南京博物院”")
      ? "nanjing-museum"
      : prompt.includes("代表地点“先锋书店”")
        ? "pioneer-bookstore"
        : "xuanwu-lake");
    const ownEvidence = ownPack?.evidence[0]?.id ?? ({
      "xuanwu-lake": "AMAP_xuanwu-lake_DISTANCE",
      "nanjing-museum": "AMAP_nanjing-museum_CATEGORY",
      "pioneer-bookstore": "AMAP_pioneer-bookstore_CATEGORY",
    }[placeId] ?? "AMAP_xuanwu-lake_DISTANCE");
    const attackTarget = assignedCompetitor?.id ?? (placeId === "nanjing-museum" ? "xuanwu-lake" : "nanjing-museum");
    const attackEvidence = assignedCompetitor?.evidence.find((item) => item.type === "distance" || item.type === "transit_route")?.id
      ?? assignedCompetitor?.evidence[0]?.id
      ?? (placeId === "nanjing-museum"
      ? "AMAP_xuanwu-lake_CATEGORY"
      : "AMAP_nanjing-museum_CATEGORY");
    const responseToAttackId = receivedAttack?.id ?? (prompt.includes("attack-xuanwu-lake-nanjing-museum")
      ? "attack-xuanwu-lake-nanjing-museum"
      : prompt.includes("attack-pioneer-bookstore-nanjing-museum")
        ? "attack-pioneer-bookstore-nanjing-museum"
        : "attack-nanjing-museum-xuanwu-lake");
    const attackerPoiId = receivedAttack?.speakerPoiId ?? responseToAttackId.split("-").slice(1, -2).join("-");
    const values: Record<string, unknown> = {
      intent_profile: {
        intentProfile: {
          goal: isExercise ? "运动" : isRest ? "休息" : "休闲",
          activityIntensity: userText.includes("不想太累") ? "low" : isExercise ? "high" : "medium",
          activityMode: [
            ...(userText.includes("不想太累") && (userText.includes("有点意思") || userText.includes("体验")) ? ["light_exploration"] : []),
            ...(userText.includes("室内") ? ["indoor_walk"] : []),
          ],
          experienceGoal: [
            ...(userText.includes("有点意思") || userText.includes("体验") ? ["exploration"] : []),
          ],
          constraints: [
            ...(userText.includes("室内") ? ["indoor"] : []),
            ...(userText.includes("不花钱") ? ["no_cost"] : []),
            ...(userText.includes("评分高") ? ["评分高"] : []),
            ...(/近一点|近点|距离近|附近|没那么远/.test(userText) ? ["距离近"] : []),
            ...(userText.includes("地铁直达") ? ["地铁直达"] : []),
          ],
          avoid: /不.*咖啡/.test(userText) ? ["cafe"] : [],
          mentionedCategories: [
            ...(userText.includes("健身") ? ["fitness"] : []),
            ...(/咖啡|cafe/i.test(userText) && !/不.*咖啡/.test(userText) ? ["cafe"] : []),
            ...(userText.includes("电影") ? ["cinema"] : []),
            ...(userText.includes("书店") ? ["bookstore"] : []),
          ],
          ...(specificActivity
            ? { explicitTarget: { text: specificActivity, specificity: "specific" } }
            : userText.includes("运动")
              ? { explicitTarget: { text: "运动", specificity: "broad" } }
              : {}),
          ...(userText.includes("一个人") ? { companion: "solo" } : {}),
          ...(userText.includes("不花钱") ? { budget: "free" } : {}),
          missingSlots: (userText.includes("室内逛") && !userText.includes("不花钱")) || userText.includes("随便逛逛") ? ["experience_type"] : (isExercise && !specificActivity) || isRest ? ["activity_type"] : [],
        },
        preference: {
          activityLevel: "low",
          indoorPreference: 0.7,
          naturePreference: 0.6,
          culturePreference: 0.8,
          budgetLevel: "medium",
          companions: "solo",
          transportPreference: userText.includes("地铁") ? "metro" : "flexible",
          distanceTolerance: /近一点|近点|距离近|附近|没那么远/.test(userText) ? "near" : "moderate",
          freeTextConstraints: [
            "不要太累",
            "有点意思",
            ...(userText.includes("评分高") ? ["评分高"] : []),
            ...(/近一点|近点|距离近|附近|没那么远/.test(userText) ? ["距离近"] : []),
            ...(userText.includes("地铁直达") ? ["地铁直达"] : []),
          ],
        },
        experienceProfile: {
          activityLevel: isExercise ? 0.8 : isRest ? 0.1 : 0.7,
          engagementType: isExercise ? "functional" : isRest ? "rest" : "exploration",
          socialFit: userText.includes("一个人") ? "solo" : "either",
          pace: isRest ? 0.1 : 0.5,
          spatial: userText.includes("室内") ? "indoor" : "mixed",
          stimulation: isRest ? 0.1 : 0.5,
          costTier: userText.includes("不花钱") ? "free" : "low",
        },
      },
      intent_profile_update: {
        intentProfile: {
          goal: specificActivity ? `进行${specificActivity}` : "休闲",
          activityIntensity: specificActivity ? "medium" : "low",
          activityMode: specificActivity ? ["physical_activity"] : ["indoor_walk"],
          experienceGoal: specificActivity ? ["exercise"] : ["exploration"],
          constraints: specificActivity ? [] : ["indoor"],
          avoid: [],
          mentionedCategories: [],
          ...(specificActivity ? { explicitTarget: { text: specificActivity, specificity: "specific" } } : {}),
          missingSlots: [],
        },
        preference: {
          activityLevel: "low", indoorPreference: 0.8, naturePreference: 0.4, culturePreference: 0.7,
          budgetLevel: "flexible", companions: "solo", freeTextConstraints: [],
        },
        experienceProfile: specificActivity
          ? { activityLevel: 0.7, engagementType: "functional", socialFit: "either", pace: 0.6, spatial: "mixed", stimulation: 0.5, costTier: "low" }
          : { activityLevel: 0.5, engagementType: "exploration", socialFit: "either", pace: 0.5, spatial: "indoor", stimulation: 0.5, costTier: "low" },
      },
      place_experience_batch: { items: experiencePlaces.map((place) => ({
        poiId: place.poiId,
        activityLevel: /自习|学习|切果|水果|电子烟/.test(place.name) ? 0.1 : 0.6,
        engagementType: /电子烟/.test(place.name) ? "consumption" : /自习|学习|切果|水果/.test(place.name) ? "functional" : "exploration",
        socialFit: "either",
        pace: /自习|学习|切果|水果|电子烟/.test(place.name) ? 0.2 : 0.5,
        spatial: "indoor",
        stimulation: /自习|学习|切果|水果|电子烟/.test(place.name) ? 0.2 : 0.5,
        costTier: "low",
      })) },
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
