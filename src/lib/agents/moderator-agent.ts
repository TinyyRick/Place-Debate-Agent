import {
  ModeratorResultSchema,
  type ModeratorResult,
} from "@/lib/schemas/debate";
import type { PlaceFactPack, FinalistScore } from "@/lib/schemas/place";
import type { PreferenceDelta } from "@/lib/schemas/preference";
import { describePreferenceDelta } from "@/lib/preference-labels";

const DIMENSION_LABELS: Record<string, string> = {
  preferenceFit: "需求契合",
  travelFit: "路程便利",
  activityFit: "活动强度",
  weatherFit: "天气适配",
  placeQuality: "地点品质",
  transitFit: "公共交通",
};

const percent = (score: FinalistScore) => Math.round(score.total * 100);

function topDimensions(score: FinalistScore, count = 2): string[] {
  return Object.entries(score.dimensions)
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([key]) => DIMENSION_LABELS[key] ?? key);
}

function weakestDimension(score: FinalistScore): string {
  const [key] = Object.entries(score.dimensions).sort((left, right) => left[1] - right[1])[0] ?? [];
  return key ? DIMENSION_LABELS[key] ?? key : "综合表现";
}

// 主持人总结不走 LLM：排名、优势短板与结论全部由确定性评分拼装，只陈述分数与维度事实。
export function buildModeratorResult(
  preferenceDelta: PreferenceDelta,
  afterScores: FinalistScore[],
  factPacks: PlaceFactPack[],
): ModeratorResult {
  const nameOf = (poiId: string) => factPacks.find((place) => place.id === poiId)?.name ?? poiId;
  const ranked = [...afterScores].sort((left, right) => right.total - left.total);

  const rankingByCurrentFit = ranked.map((score) => ({
    poiId: score.poiId,
    reason: `综合匹配 ${percent(score)} 分，${topDimensions(score).join("、")}相对突出`,
  }));

  const tradeoffs = afterScores.map((score) => ({
    poiId: score.poiId,
    strengths: topDimensions(score).map((label) => `${label}占优`),
    weaknesses: [`${weakestDimension(score)}相对较弱`],
  }));

  const conflictAxes: string[] = [];
  const leader = ranked[0];
  const runnerUp = ranked[1];
  if (leader && runnerUp) {
    if (leader.total - runnerUp.total < 0.03) {
      conflictAxes.push("两地综合匹配分差距很小，胜负只在细节");
    } else {
      const biggest = Object.keys(leader.dimensions).reduce(
        (best, key) => {
          const delta = Math.abs((leader.dimensions[key] ?? 0) - (runnerUp.dimensions[key] ?? 0));
          return delta > best.delta ? { key, delta } : best;
        },
        { key: "", delta: -1 },
      );
      const label = DIMENSION_LABELS[biggest.key] ?? biggest.key;
      conflictAxes.push(
        biggest.delta > 0
          ? `${nameOf(leader.poiId)} 与 ${nameOf(runnerUp.poiId)} 在「${label}」上差距最大`
          : "两地各维度表现接近",
      );
    }
  }
  if (conflictAxes.length === 0) conflictAxes.push("缺少可比的第二名，直接推荐综合匹配最高的地点");

  const recommendationSummary = leader
    ? `综合匹配度最高的是${nameOf(leader.poiId)}（${percent(leader)} 分），${topDimensions(leader).join("、")}表现更好。`
    : "没有可推荐的地点。";
  const deltaText = describePreferenceDelta(preferenceDelta);
  const preferenceImpact = preferenceDelta.interventionText
    ? `你补充了「${preferenceDelta.interventionText}」；${deltaText}。最终选择权在你。`
    : `${deltaText}，最终选择权在你。`;

  return ModeratorResultSchema.parse({
    conflictAxes,
    rankingByCurrentFit,
    tradeoffs,
    recommendationSummary,
    preferenceImpact,
  });
}
