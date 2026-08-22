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
import type { UserPreference } from "@/lib/schemas/preference";
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

export function createPlaceAgent(
  factPack: PlaceFactPack,
  userPreference: UserPreference,
  model: StructuredModel = createChatModel(),
) {
  const identity = `你代表地点“${factPack.name}”，目标是基于证据说服用户，但必须诚实。只可使用给定 FactPack；事实性论点必须引用 evidenceIds。缺失信息必须视为未知。输出简短中文。`;

  return {
    async opening(): Promise<OpeningOutput> {
      const output = await model.invoke(
        OpeningOutputSchema,
        [
          { role: "system", content: identity },
          {
            role: "user",
            content: `用户偏好：${JSON.stringify(userPreference)}\n你的 FactPack：${evidenceSummary(factPack)}\n做 60–120 字的开场陈述。`,
          },
        ],
        "place_opening",
      );
      assertEvidenceIds(output.evidenceIds, [factPack]);
      return output;
    },

    async attack(competitors: PlaceFactPack[], openings: DebateMessage[]): Promise<AttackOutput> {
      const output = await model.invoke(
        AttackOutputSchema,
        [
          { role: "system", content: identity },
          {
            role: "user",
            content: `用户偏好：${JSON.stringify(userPreference)}\n你的 FactPack：${evidenceSummary(factPack)}\n竞争地点：${JSON.stringify(competitors)}\n开场陈述：${JSON.stringify(openings)}\n选择一个竞争对手，指出一个与用户偏好相关、证据充分的具体弱点。`,
          },
        ],
        "place_attack",
      );
      const target = competitors.find((item) => item.id === output.targetPoiId);
      if (!target) throw new Error(`${factPack.name} attacked an unknown competitor.`);
      assertEvidenceIds(output.evidenceIds, [target]);
      return output;
    },

    async rebuttal(attacks: DebateMessage[]): Promise<RebuttalOutput> {
      const output = await model.invoke(
        RebuttalOutputSchema,
        [
          { role: "system", content: identity },
          {
            role: "user",
            content: `用户偏好：${JSON.stringify(userPreference)}\n你的 FactPack：${evidenceSummary(factPack)}\n针对你的实际攻击：${JSON.stringify(attacks)}\n只回应这些攻击，不讨论未被攻击的内容。`,
          },
        ],
        "place_rebuttal",
      );
      assertEvidenceIds(output.evidenceIds, [factPack]);
      return output;
    },
  };
}
