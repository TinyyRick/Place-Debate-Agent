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
import type { TransitRoute } from "@/lib/schemas/location";
import type { PreferenceDelta, UserPreference } from "@/lib/schemas/preference";
import type { UserIntent } from "@/lib/schemas/intent";
import { createChatModel, type StructuredModel } from "./model-factory";

export type OpeningComparisonContext = {
  candidateCount: number;
  distanceRank: number;
  walkingTimeRank?: number;
  ratingRank?: number;
  transitTimeRank?: number;
  costRank?: number;
};

type RouteSnapshot = {
  straightLineMeters: number;
  walkingMinutes?: number;
  drivingMinutes?: number;
  transit?: {
    minutes?: number;
    directMetro?: boolean;
    walkingMeters?: number;
    transfers?: number;
    lines: string[];
  };
  rating?: number;
  averageCostYuan?: number;
  strategies?: {
    fastest?: { minutes?: number; walkingMeters?: number; transfers?: number };
    leastWalking?: { minutes?: number; walkingMeters?: number; transfers?: number };
    leastTransfers?: { minutes?: number; walkingMeters?: number; transfers?: number };
  };
};

function compactTransit(route: TransitRoute | undefined) {
  if (!route?.available) return undefined;
  return {
    ...(route.durationMinutes === undefined ? {} : { minutes: route.durationMinutes }),
    ...(route.walkingDistanceMeters === undefined ? {} : { walkingMeters: route.walkingDistanceMeters }),
    ...(route.transferCount === undefined ? {} : { transfers: route.transferCount }),
  };
}

function routeSnapshot(pack: PlaceFactPack): RouteSnapshot {
  const transit = pack.route?.transit;
  return {
    straightLineMeters: pack.distanceMeters,
    ...(pack.route?.walking.durationMinutes === undefined ? {} : { walkingMinutes: pack.route.walking.durationMinutes }),
    ...(pack.route?.driving.durationMinutes === undefined ? {} : { drivingMinutes: pack.route.driving.durationMinutes }),
    ...(transit?.available ? {
      transit: {
        ...(transit.durationMinutes === undefined ? {} : { minutes: transit.durationMinutes }),
        ...(transit.directMetro === undefined ? {} : { directMetro: transit.directMetro }),
        ...(transit.walkingDistanceMeters === undefined ? {} : { walkingMeters: transit.walkingDistanceMeters }),
        ...(transit.transferCount === undefined ? {} : { transfers: transit.transferCount }),
        lines: transit.lineNames,
      },
    } : {}),
    ...(pack.rating === undefined ? {} : { rating: pack.rating }),
    ...(pack.averageCostYuan === undefined ? {} : { averageCostYuan: pack.averageCostYuan }),
    ...(pack.route?.transitStrategies ? {
      strategies: {
        ...(compactTransit(pack.route.transitStrategies.fastest) ? { fastest: compactTransit(pack.route.transitStrategies.fastest) } : {}),
        ...(compactTransit(pack.route.transitStrategies.leastWalking) ? { leastWalking: compactTransit(pack.route.transitStrategies.leastWalking) } : {}),
        ...(compactTransit(pack.route.transitStrategies.leastTransfers) ? { leastTransfers: compactTransit(pack.route.transitStrategies.leastTransfers) } : {}),
      },
    } : {}),
  };
}

/** Pre-computes factual contrasts so the model can reason like a debater instead of rereading two JSON blobs as a list. */
export function buildTravelDebateBrief(speaker: PlaceFactPack, target: PlaceFactPack) {
  const mine = routeSnapshot(speaker);
  const theirs = routeSnapshot(target);
  const notableContrasts: string[] = [];
  if (mine.straightLineMeters > theirs.straightLineMeters && mine.transit?.minutes !== undefined && theirs.transit?.minutes !== undefined && mine.transit.minutes < theirs.transit.minutes) {
    notableContrasts.push(`我方直线距离多${mine.straightLineMeters - theirs.straightLineMeters}米，但公共交通总耗时少${theirs.transit.minutes - mine.transit.minutes}分钟`);
  }
  if (mine.transit?.directMetro && theirs.transit && !theirs.transit.directMetro) notableContrasts.push("我方地铁零换乘直达，对方不是零换乘直达");
  if (mine.walkingMinutes !== undefined && theirs.walkingMinutes !== undefined && mine.walkingMinutes < theirs.walkingMinutes) notableContrasts.push(`我方步行少${theirs.walkingMinutes - mine.walkingMinutes}分钟`);
  if (mine.transit?.walkingMeters !== undefined && theirs.transit?.walkingMeters !== undefined && mine.transit.walkingMeters < theirs.transit.walkingMeters) notableContrasts.push(`我方公共交通接驳步行少${theirs.transit.walkingMeters - mine.transit.walkingMeters}米`);
  if (mine.rating !== undefined && theirs.rating !== undefined && mine.rating > theirs.rating) notableContrasts.push(`我方评分高${(mine.rating - theirs.rating).toFixed(1)}分`);
  if (mine.averageCostYuan !== undefined && theirs.averageCostYuan !== undefined && mine.averageCostYuan < theirs.averageCostYuan) notableContrasts.push(`我方高德人均消费低${Math.round(theirs.averageCostYuan - mine.averageCostYuan)}元`);
  const strategyComparisons = [
    ["最快方案", mine.strategies?.fastest, theirs.strategies?.fastest],
    ["最少步行方案", mine.strategies?.leastWalking, theirs.strategies?.leastWalking],
    ["最少换乘方案", mine.strategies?.leastTransfers, theirs.strategies?.leastTransfers],
  ] as const;
  for (const [label, myRoute, theirRoute] of strategyComparisons) {
    if (myRoute?.minutes !== undefined && theirRoute?.minutes !== undefined && theirRoute.minutes - myRoute.minutes >= 8) notableContrasts.push(`我方${label}少${theirRoute.minutes - myRoute.minutes}分钟`);
    if (label === "最少步行方案" && myRoute?.walkingMeters !== undefined && theirRoute?.walkingMeters !== undefined && theirRoute.walkingMeters - myRoute.walkingMeters >= 500) notableContrasts.push(`我方${label}少走${theirRoute.walkingMeters - myRoute.walkingMeters}米`);
    if (label === "最少换乘方案" && myRoute?.transfers !== undefined && theirRoute?.transfers !== undefined && myRoute.transfers < theirRoute.transfers) notableContrasts.push(`我方${label}少换乘${theirRoute.transfers - myRoute.transfers}次`);
  }
  return { mine, theirs, notableContrasts };
}

function buildOpeningBrief(factPack: PlaceFactPack, comparison?: OpeningComparisonContext) {
  const route = routeSnapshot(factPack);
  const possibleAngles: string[] = [];
  if (route.walkingMinutes !== undefined) possibleAngles.push(`步行${route.walkingMinutes}分钟可达`);
  if (route.transit?.minutes !== undefined) possibleAngles.push(`${route.transit.directMetro ? "地铁零换乘直达" : "公共交通"}${route.transit.minutes}分钟${route.transit.walkingMeters === undefined ? "" : `，接驳步行${route.transit.walkingMeters}米`}`);
  if (route.rating !== undefined) possibleAngles.push(`高德评分${route.rating}分`);
  if (route.averageCostYuan !== undefined) possibleAngles.push(`高德人均消费约${route.averageCostYuan}元`);
  const suggestedLead = comparison?.walkingTimeRank === 1
    ? "用步行省事作为主卖点"
    : comparison?.transitTimeRank === 1
      ? "用公共交通总耗时作为主卖点"
      : comparison?.costRank === 1
        ? "若用户在意预算，可用高德人均消费作为主卖点"
      : comparison?.ratingRank === 1
        ? "用评分作为信任信号，但不要把评分推导成具体体验"
        : "选最贴合用户当前要求的一项事实，不必假装样样领先";
  return { route, possibleAngles, suggestedLead };
}

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
function assertIncludesTargetEvidence(ids: string[], target: PlaceFactPack) {
  const targetEvidence = new Set(target.evidence.map((item) => item.id));
  if (!ids.some((id) => targetEvidence.has(id))) {
    throw new Error(`Attack against ${target.id} must cite at least one item from the target FactPack.`);
  }
}
function enforceEvidenceBudget<T extends { evidenceIds: string[] }>(output: T): T { return { ...output, evidenceIds: output.evidenceIds.slice(0, 3) }; }

// Last-resort attack when the model cannot produce a grounded one: reuse the
// programmatically computed contrast so the round can still proceed honestly.
function deterministicAttackFallback(speaker: PlaceFactPack, target: PlaceFactPack): AttackOutput | null {
  const contrast = buildTravelDebateBrief(speaker, target).notableContrasts[0];
  if (!contrast) return null;
  const evidenceIdOf = (pack: PlaceFactPack, type: PlaceFactPack["evidence"][number]["type"]) => pack.evidence.find((item) => item.type === type)?.id;
  const ids: string[] = [];
  let matchedAxis = false;
  for (const [pattern, type] of [[/评分/, "rating"], [/人均消费/, "average_cost"]] as const) {
    if (pattern.test(contrast)) {
      matchedAxis = true;
      for (const pack of [speaker, target]) { const id = evidenceIdOf(pack, type); if (id) ids.push(id); }
    }
  }
  if (!matchedAxis) {
    for (const pack of [speaker, target]) {
      const id = evidenceIdOf(pack, "transit_route") ?? evidenceIdOf(pack, "route_time");
      if (id) ids.push(id);
    }
  }
  if (ids.length === 0) return null;
  return { targetPoiId: target.id, claim: `${contrast.replaceAll("我方", "我").replaceAll("对方", target.name)}，这一点值得优先考虑。`, evidenceIds: ids.slice(0, 3) };
}

function assertMetroGrounding(claim: string, packs: PlaceFactPack[]) {
  const evidenceTypes = new Set(packs.flatMap((pack) => pack.evidence.map((item) => item.type)));
  if (/地铁附近|靠近地铁|地铁站距离/.test(claim) && !evidenceTypes.has("metro_access")) {
    throw new Error("Claim mentioned station proximity without METRO_ACCESS evidence.");
  }
  if (/地铁直达|零换乘|无需换乘|需要换乘|需换乘|不直达|公共交通|公交路线/.test(claim) && !evidenceTypes.has("transit_route")) {
    throw new Error("Claim mentioned a transit route without TRANSIT_ROUTE evidence.");
  }
  if (/地铁方便|地铁可达|地铁便利/.test(claim) && !evidenceTypes.has("metro_access") && !evidenceTypes.has("transit_route")) {
    throw new Error("Claim mentioned metro convenience without route or station evidence.");
  }
}

function normalizedClaim(value: string) { return value.replaceAll(/\s+/g, "").trim(); }

function assertClaimSafety(claim: string) {
  const unsupportedInferences = ["趣味性有保障", "趣味性可由高评分", "体验差", "文化价值低", "评分支撑趣味", "安静", "氛围很好", "适合学习", "出门即达", "几乎不用走", "吹空调", "有空调", "空调房", "够再点", "够再买", "省下的钱可以买", "省下的钱能买"];
  if (unsupportedInferences.some((phrase) => claim.includes(phrase))) {
    throw new Error(`Claim contains an unsupported evidence inference: ${claim}`);
  }
}

function assertCostGrounding(claim: string, evidenceIds: string[], packs: PlaceFactPack[]) {
  if (!/人均|消费|便宜|更贵|花费|省下(?:的钱|\d+元)|预算(?:差不多|相近)|\d+(?:\.\d+)?元/.test(claim)) return;
  const citedCostEvidence = packs
    .flatMap((pack) => pack.evidence)
    .filter((evidence) => evidence.type === "average_cost" && evidenceIds.includes(evidence.id));
  const isComparison = /差不多|同样|上下|相比|便宜|更贵|省下|(?:低|高)\d+元|两家|双方/.test(claim);
  const requiredCount = isComparison ? 2 : 1;
  if (new Set(citedCostEvidence.map((evidence) => evidence.id)).size < requiredCount) {
    throw new Error(`Cost claim requires ${requiredCount} cited AVERAGE_COST evidence item(s).`);
  }
}

function assertRatingGrounding(claim: string, evidenceIds: string[], packs: PlaceFactPack[]) {
  if (!/评分|分数/.test(claim)) return;
  const citedRatingEvidence = packs
    .flatMap((pack) => pack.evidence)
    .filter((evidence) => evidence.type === "rating" && evidenceIds.includes(evidence.id));
  const requiredCount = /同样|相同|双方|两家|相比|比.+(?:高|低)/.test(claim) ? 2 : 1;
  if (new Set(citedRatingEvidence.map((evidence) => evidence.id)).size < requiredCount) {
    throw new Error(`Rating claim requires ${requiredCount} cited RATING evidence item(s).`);
  }
}

export function createPlaceAgent(
  factPack: PlaceFactPack,
  userPreference: UserPreference,
  model: StructuredModel = createChatModel(),
  userIntent?: UserIntent,
) {
  const identity = `你代表地点“${factPack.name}”，像一位熟悉自己优缺点、正在礼貌争取用户的本地推荐者，用第一人称“我”自然说话。你不是数据播报员：先给明确态度，再挑一两个真正影响选择的事实解释，句子要有“虽然……但……”“看起来……实际……”这类真实取舍，不能把字段逐项念完。目标是基于证据说服用户，但必须诚实。只可使用给定 FactPack；METRO_ACCESS 只支持地铁站距离，TRANSIT_ROUTE 才能支持是否地铁直达、换乘次数、公共交通总耗时和接驳步行；AVERAGE_COST 只支持高德返回的人均消费，缺失时必须视为未知，绝不能说免费或更便宜。PlaceActivityProfile 是 derived_category_rule，只能以“按场所类型通常更偏……”的谨慎方式说明活动类型，不能冒充高德原始事实。WEATHER_ASSESSMENT 是唯一可用的天气舒适度结论。CATEGORY=cafe 只能表述为“餐饮休闲类活动”，绝不可说安静、氛围好、适合学习。不得补充设施、展览、景观细节、拥挤度或任何未提供事实；缺失信息必须视为未知。输出简短中文；不要出现英文单词、字段名或地点编号。`;
  const studyWordBan = userIntent?.primaryGoal === "study"
    ? "本次是学习检索，但用户任务不是地点事实；claim 禁止使用“安静”“学习”“阅读”“氛围”“环境”“适合”等词，只能陈述类别、距离、路线、天气、评分和谨慎的活动类型。"
    : "";

  return {
    async opening(comparison?: OpeningComparisonContext): Promise<OpeningOutput> {
      const output = await model.invoke(
        OpeningOutputSchema,
        [
          { role: "system", content: `${identity} ${studyWordBan}` },
          {
            role: "user",
            content: `用户意图：${JSON.stringify(userIntent)}\n用户偏好：${JSON.stringify(userPreference)}\n你的 FactPack：${evidenceSummary(factPack)}\n开场策略提示（程序从同一批事实中整理，不是新增事实）：${JSON.stringify(buildOpeningBrief(factPack, comparison))}\n相对位次（仅用于选择论述重点，claim 不要说“排名第几”）：${JSON.stringify(comparison)}\n${studyWordBan}\n做 70–140 字的第一人称拉票。开头直接回应用户最在意的事，再用一到两个相互关联的事实讲清“为什么选我”。若直线距离一般但地铁总耗时、零换乘或接驳步行更有优势，可以诚实说“我看起来不算最近，但实际坐地铁……”。若步行可达且评分不错，可以自然说“走路……分钟就到，评分……也不低”。这些只是表达范式，数值和结论必须来自 FactPack。一段开场通常只选一种最合适的交通方式，再搭配评分或类别即可；只有两种路线至少相差5分钟时，才值得比较谁更快。不要用括号堆数据，不要逐字段罗列，也不要复述距离、路线、评分、天气和类别五件事。天气只有在确实改变用户选择时才可作为主论点，所有同类候选共享的天气不能冒充本地点独有优势。室内类别不等于有空调、座位舒适或环境良好；FactPack 没有设施证据时绝不能说“吹空调”等具体体验。用户意图只能说明用户正在寻找的类别，不能证明本地点具有任何额外属性；尤其 cafe 绝不能说安静、适合学习、适合阅读或环境好。claim 只能引用自己 FactPack 的事实。`,
          },
        ],
        "place_opening",
      );
      const bounded = enforceEvidenceBudget(output); assertClaimSafety(bounded.claim);
      assertEvidenceIds(bounded.evidenceIds, [factPack]); assertMetroGrounding(bounded.claim, [factPack]); return bounded;
    },

    async attack(competitor: PlaceFactPack, openings: DebateMessage[]): Promise<AttackOutput> {
      const messages = [
          { role: "system", content: `${identity} ${studyWordBan}` },
          {
            role: "user",
            content: `用户偏好：${JSON.stringify(userPreference)}\n你的 FactPack：${evidenceSummary(factPack)}\n系统指定的对手 FactPack：${JSON.stringify(competitor)}\n程序整理的出行与消费对比账单：${JSON.stringify(buildTravelDebateBrief(factPack, competitor))}\n开场陈述：${JSON.stringify(openings)}\n这是经过程序级显著性检查的平衡配对，不能另选对手；targetPoiId 必须等于 ${competitor.id}。像替用户算一笔真实的出行账，只选择一个最影响决策的比较轴（实际步行、最快方案、最少步行方案、最少换乘方案、评分、高德人均消费或明确体验匹配之一），用双方直接证据完成一次真正的质疑。攻击结论只能使用对比账单 notableContrasts 已列出的我方优势；没有列出的维度不得自行声称“差不多”或更占优势。优先发现反直觉差异：例如对方直线距离看着更近，但最快方案反而更慢；或者对方默认路线省时，但最少步行方案需要更多时间；也可以在双方都有人均消费证据时比较真实预算负担。选择人均消费轴时，只陈述双方高德人均数值及明确差额，并引用双方 AVERAGE_COST；不得混入评分、天气或路线，也不得推导差价能购买什么。不要把直线距离等同于真实出行时间，也不要把缺少 cost 的地点说成免费或更便宜。语气可以有锋芒，但要像正常人说话，不要写成数据审计报告。禁止在一段话里罗列多个无关轴，也禁止先证明对手更好再称为攻击。即使用户没有明确提出交通要求，明显更远、耗时更长或地铁不直达可作为次级取舍，但不能盖过用户明确目标。WEATHER 只可说明户外舒适度；RATING 只可说明公开评分差异；AVERAGE_COST 只可说明高德人均消费差异；CATEGORY 只可说明活动类型匹配。evidenceIds 可引用你和对手 FactPack 中的真实 id，最多三个，其中至少一个必须来自对手；不得引用其他地点。`,
          },
        ] as const;
      const validate = (output: AttackOutput) => {
        const bounded = enforceEvidenceBudget(output); assertClaimSafety(bounded.claim);
        if (output.targetPoiId !== competitor.id) throw new Error(`${factPack.name} attacked an unexpected competitor.`);
        assertEvidenceIds(bounded.evidenceIds, [factPack, competitor]);
        assertIncludesTargetEvidence(bounded.evidenceIds, competitor);
        assertMetroGrounding(bounded.claim, [factPack, competitor]);
        assertCostGrounding(bounded.claim, bounded.evidenceIds, [factPack, competitor]);
        assertRatingGrounding(bounded.claim, bounded.evidenceIds, [factPack, competitor]);
        return bounded;
      };
      const first = await model.invoke(AttackOutputSchema, [...messages], "place_attack");
      try {
        return validate(first);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown grounding error";
        const correctionBoundary = reason.startsWith("Cost claim")
          ? "重写版禁止出现人均、消费、金额、预算差异、便宜、贵、评分或分数，只讨论一个有双方路线证据的交通轴。"
          : reason.startsWith("Rating claim")
            ? "重写版禁止出现评分或分数，只讨论已引用完整证据的那个非评分轴。"
            : "重写版只讨论一个有完整双方证据的轴。";
        const allowedEvidenceIds = [factPack, competitor].flatMap((pack) => pack.evidence.map((item) => item.id)).join("、");
        const corrected = await model.invoke(AttackOutputSchema, [
          ...messages,
          { role: "user", content: `上一版被程序拒绝：${reason} ${correctionBoundary} 只保留一个对比轴；不得推导差价能买什么。你只能引用这些 evidence id：${allowedEvidenceIds}。` },
        ], "place_attack");
        try {
          return validate(corrected);
        } catch (secondError) {
          const fallback = deterministicAttackFallback(factPack, competitor);
          if (fallback) return validate(fallback);
          throw secondError;
        }
      }
    },

    async rebuttal(
      attack: DebateMessage,
      originalPreference: UserPreference = userPreference,
      currentPreference: UserPreference = userPreference,
      preferenceDelta?: PreferenceDelta,
    ): Promise<RebuttalOutput> {
      const messages = [
          { role: "system", content: `${identity} ${studyWordBan}` },
          {
            role: "user",
            content: `原始用户偏好：${JSON.stringify(originalPreference)}\n当前用户偏好：${JSON.stringify(currentPreference)}\n${preferenceDelta ? `本次偏好变化：${JSON.stringify(preferenceDelta)}\n` : ""}你的 FactPack：${evidenceSummary(factPack)}\n你的可用出行方式：${JSON.stringify(routeSnapshot(factPack))}\n针对你的唯一实际攻击：${JSON.stringify(attack)}\n必须令 responseToAttackId 等于该攻击 id，attackerPoiId 等于该攻击 speakerPoiId。先用一句话承认对手指出的真实短板，再像正常人解释这个短板是否会真正影响选择。回应“离得远/走得久”时，可以用自己 FactPack 中另一种真实路线说明取舍，例如“直线距离确实远一点，但地铁零换乘且总耗时……”；这属于回应整体出行成本，不算转移话题。只有替代路线确实减少时间、换乘或接驳步行时才能称为优势。不能只说“还能接受”“也不错”，必须给出可核验原因。路线受到质疑时，claim 和 evidenceIds 都只围绕路线，绝不能加入评分、天气或类别来淡化短板；若自己的替代路线也没有优势，就明确说“现有证据无法抵消这一差距”。用户偏好 near 时绝不能擅自称更远的距离“在可接受范围内”。不得重新复述 Opening，不得新增事实。`,
          },
        ] as const;
      const validate = (output: RebuttalOutput) => {
        if (output.responseToAttackId !== attack.id || output.attackerPoiId !== attack.speakerPoiId) {
          throw new Error(`Rebuttal must bind to attack ${attack.id} and attacker ${attack.speakerPoiId}.`);
        }
        if (normalizedClaim(output.claim) === normalizedClaim(attack.claim)) {
          throw new Error(`Rebuttal for attack ${attack.id} copied the attack claim.`);
        }
        const bounded = enforceEvidenceBudget(output); assertClaimSafety(bounded.claim);
        assertEvidenceIds(bounded.evidenceIds, [factPack]); assertMetroGrounding(bounded.claim, [factPack]); return bounded;
      };
      const first = await model.invoke(RebuttalOutputSchema, [...messages], "place_rebuttal");
      try {
        return validate(first);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown grounding error";
        const correctionBoundary = reason.startsWith("Cost claim")
          ? "重写版禁止出现人均、消费、金额、预算差异、便宜、贵、评分或分数，只用已有证据回应短板。"
          : reason.startsWith("Rating claim")
            ? "重写版禁止出现评分或分数，只用已有事实回应短板。"
            : /transit route|station proximity|metro convenience/.test(reason)
              ? "重写版禁止出现地铁、换乘、公共交通、公交等表述；只能如实承认步行距离或耗时差距，或明确说“现有证据无法抵消这一差距”。"
              : "重写版只引用你 FactPack 中真实存在的证据回应。";
        const corrected = await model.invoke(RebuttalOutputSchema, [...messages, { role: "user", content: `上一版被程序拒绝：${reason} ${correctionBoundary} 仍必须绑定同一攻击 id 与攻击者，不得复述开场，不得新增事实。你只能引用这些 evidence id：${factPack.evidence.map((item) => item.id).join("、")}。` }], "place_rebuttal");
        try {
          return validate(corrected);
        } catch (error) {
          const fallbackReason = error instanceof Error ? error.message : "";
          if (fallbackReason.startsWith("Rebuttal must bind") || fallbackReason.includes("copied the attack claim")) throw error;
          const fallbackEvidenceId = factPack.evidence.find((item) => item.type === "distance")?.id ?? factPack.evidence[0]!.id;
          return { responseToAttackId: attack.id, attackerPoiId: attack.speakerPoiId, claim: "现有证据无法抵消这一差距。", evidenceIds: [fallbackEvidenceId] };
        }
      }
    },
  };
}
