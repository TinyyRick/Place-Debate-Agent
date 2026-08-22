import {
  AttackOutputSchema,
  OpeningOutputSchema,
  RebuttalOutputSchema,
  type AttackOutput,
  type DebateMessage,
  type OpeningOutput,
  type RebuttalOutput,
} from "@/lib/schemas/debate";
import type { PlaceFactPack } from "@/lib/schemas/place";
import type { PreferenceDelta, UserPreference } from "@/lib/schemas/preference";
import type { UserIntent } from "@/lib/schemas/intent";
import { createChatModel, type StructuredModel } from "./model-factory";

function evidenceSummary(factPack: PlaceFactPack) {
  return JSON.stringify(factPack);
}

function assertEvidenceIds(ids: string[], allowedPacks: PlaceFactPack[]) {
  const allowed = new Set(allowedPacks.flatMap((pack) => pack.evidence.map((item) => item.id)));
  const invalid = ids.filter((id) => !allowed.has(id));
  if (invalid.length > 0) {
    throw new Error(`Agent returned evidence outside its FactPacks: ${invalid.join(", ")}`);
  }
}
function enforceEvidenceBudget<T extends { evidenceIds: string[] }>(output: T): T { return { ...output, evidenceIds: output.evidenceIds.slice(0, 3) }; }
function assertMetroGrounding(claim: string, packs: PlaceFactPack[]) {
  if (/地铁附近|靠近地铁|地铁方便|地铁可达|地铁便利/.test(claim) && !packs.some((pack) => pack.evidence.some((item) => item.type === "metro_access"))) {
    throw new Error("Claim mentioned metro access without METRO_ACCESS evidence.");
  }
}

function normalizedClaim(value: string) { return value.replaceAll(/\s+/g, "").trim(); }

function assertClaimSafety(claim: string) {
  const unsupportedInferences = ["趣味性有保障", "趣味性可由高评分", "体验差", "文化价值低", "评分支撑趣味", "安静", "氛围很好", "适合学习", "出门即达", "几乎不用走"];
  if (unsupportedInferences.some((phrase) => claim.includes(phrase))) {
    throw new Error(`Claim contains an unsupported evidence inference: ${claim}`);
  }
}

export function createPlaceAgent(
  factPack: PlaceFactPack,
  userPreference: UserPreference,
  model: StructuredModel = createChatModel(),
  userIntent?: UserIntent,
) {
  const identity = `你代表地点“${factPack.name}”，目标是基于证据说服用户，但必须诚实。只可使用给定 FactPack；METRO_ACCESS 是谈论地铁距离的唯一依据，缺失时只能说无法判断。PlaceActivityProfile 是 derived_category_rule，只能以“按场所类型通常更偏……”的谨慎方式说明活动类型，不能冒充高德原始事实。WEATHER_ASSESSMENT 是唯一可用的天气舒适度结论。CATEGORY=cafe 只能表述为“餐饮休闲类活动”，绝不可说安静、氛围好、适合学习。不得补充设施、展览、景观细节、拥挤度或任何未提供事实；缺失信息必须视为未知。输出简短中文。`;
  const studyWordBan = userIntent?.primaryGoal === "study"
    ? "本次是学习检索，但用户任务不是地点事实；claim 禁止使用“安静”“学习”“阅读”“氛围”“环境”“适合”等词，只能陈述类别、距离、路线、天气、评分和谨慎的活动类型。"
    : "";

  return {
    async opening(): Promise<OpeningOutput> {
      const output = await model.invoke(
        OpeningOutputSchema,
        [
          { role: "system", content: `${identity} ${studyWordBan}` },
          {
            role: "user",
            content: `用户意图：${JSON.stringify(userIntent)}\n用户偏好：${JSON.stringify(userPreference)}\n你的 FactPack：${evidenceSummary(factPack)}\n${studyWordBan}\n做 60–120 字的开场陈述。像地点在争取用户：先抓住 1–2 个最重要偏好，再用事实支撑并形成明确立场，不要逐字段罗列。用户意图只能说明用户正在寻找的类别，不能证明本地点具有任何额外属性；尤其 cafe 绝不能说安静、适合学习、适合阅读或环境好。若 FactPack 中存在 ROUTE_WALKING、ROUTE_DRIVING 或 WEATHER evidence，必须如实提到对应事实并在 evidenceIds 中引用这些可用 evidence（不得编造它们的含义）。`,
          },
        ],
        "place_opening",
      );
      const bounded = enforceEvidenceBudget(output); assertClaimSafety(bounded.claim);
      assertEvidenceIds(bounded.evidenceIds, [factPack]); assertMetroGrounding(bounded.claim, [factPack]); return bounded;
    },

    async attack(competitors: PlaceFactPack[], openings: DebateMessage[]): Promise<AttackOutput> {
      const output = await model.invoke(
        AttackOutputSchema,
        [
          { role: "system", content: `${identity} ${studyWordBan}` },
          {
            role: "user",
            content: `用户偏好：${JSON.stringify(userPreference)}\n你的 FactPack：${evidenceSummary(factPack)}\n竞争地点：${JSON.stringify(competitors)}\n开场陈述：${JSON.stringify(openings)}\n选择一个竞争对手，优先指出该地点事实与用户偏好之间的实际 trade-off；没有强证据时使用“可能”或“相对不占优势”。targetPoiId 必须等于你选择的竞争地点 id。WEATHER 只可说明户外舒适度、炎热或降雨影响；RATING 只可说明公开评分相对高低；CATEGORY 只可说明活动类型匹配，均不得推断“无趣/体验差/文化价值低”等未提供事实。evidenceIds 必须只包含该 target FactPack 中真实存在的 id，逐字复制；绝不能包含你自己 FactPack 的 evidence id，也不能混用多个地点的 evidence。`,
          },
        ],
        "place_attack",
      );
      const bounded = enforceEvidenceBudget(output); assertClaimSafety(bounded.claim);
      const target = competitors.find((item) => item.id === output.targetPoiId);
      if (!target) throw new Error(`${factPack.name} attacked an unknown competitor.`);
      assertEvidenceIds(bounded.evidenceIds, [target]); assertMetroGrounding(bounded.claim, [target]); return bounded;
    },

    async rebuttal(
      attack: DebateMessage,
      originalPreference: UserPreference = userPreference,
      currentPreference: UserPreference = userPreference,
      preferenceDelta: PreferenceDelta = { interventionText: "", changedFields: [] },
    ): Promise<RebuttalOutput> {
      const output = await model.invoke(
        RebuttalOutputSchema,
        [
          { role: "system", content: `${identity} ${studyWordBan}` },
          {
            role: "user",
            content: `原始用户偏好：${JSON.stringify(originalPreference)}\n当前用户偏好：${JSON.stringify(currentPreference)}\n本次偏好变化：${JSON.stringify(preferenceDelta)}\n你的 FactPack：${evidenceSummary(factPack)}\n针对你的唯一实际攻击：${JSON.stringify(attack)}\n必须令 responseToAttackId 等于该攻击 id，attackerPoiId 等于该攻击 speakerPoiId。先承认对方提出的具体 trade-off，再仅用自己的 FactPack 回应，并明确连接这次偏好变化；不要复制或复述攻击原文，不得新增事实。`,
          },
        ],
        "place_rebuttal",
      );
      if (output.responseToAttackId !== attack.id || output.attackerPoiId !== attack.speakerPoiId) {
        throw new Error(`Rebuttal must bind to attack ${attack.id} and attacker ${attack.speakerPoiId}.`);
      }
      if (normalizedClaim(output.claim) === normalizedClaim(attack.claim)) {
        throw new Error(`Rebuttal for attack ${attack.id} copied the attack claim.`);
      }
      const bounded = enforceEvidenceBudget(output); assertClaimSafety(bounded.claim);
      assertEvidenceIds(bounded.evidenceIds, [factPack]); assertMetroGrounding(bounded.claim, [factPack]); return bounded;
    },
  };
}
