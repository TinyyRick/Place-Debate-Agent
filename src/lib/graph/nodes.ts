import { interpretIntent, updateIntentFromClarification, updatePreferenceFromIntervention } from "@/lib/agents/intent-agent";
import { buildModeratorResult } from "@/lib/agents/moderator-agent";
import { createPlaceAgent } from "@/lib/agents/place-agent-factory";
import type { StructuredModel } from "@/lib/agents/model-factory";
import { retrieveNearbyPoisWithMetrics } from "@/lib/amap/places";
import { createSearchPlan } from "@/lib/search/search-plan";
import { planExperience } from "@/lib/intent/experience-planner";
import { scorePlaceExperiences } from "@/lib/experience/place-experience-scorer";
import { getRoutes, type RouteRequestOptions } from "@/lib/amap/routes";
import { resolveLocation } from "@/lib/amap/location";
import { getCurrentWeather } from "@/lib/amap/weather";
import { getMetroAccess } from "@/lib/amap/metro";
import { applyKnownCandidateRequirements, applyRouteCandidateRequirements, createFactPacks, deriveRankingRequirements, filterIntentCompatiblePois, finalRankCandidates, hardFilterPois, rankCandidates, scoreFinalistsAfterIntervention, selectDiverseCandidates } from "@/lib/ranking/ranker";
import type { PlaceCandidate, PlaceFactPack } from "@/lib/schemas/place";
import type { Coordinates, LocationContext, RouteContext, WeatherContext } from "@/lib/schemas/location";
import { CandidateDecisionSchema, OpeningOutputSchema, type DebateMessage } from "@/lib/schemas/debate";
import type { DebateStateSchema } from "./state";
import { interrupt } from "@langchain/langgraph";
import { UserPreferenceSchema, type UserPreference } from "@/lib/schemas/preference";
import { UserIntentSchema, type UserIntent } from "@/lib/schemas/intent";
import { IntentProfileSchema, type IntentProfile } from "@/lib/schemas/intent";
import { ExperienceProfileSchema, type ExperienceProfile } from "@/lib/schemas/experience";
import type { AMapQueryMetric, SearchPlan } from "@/lib/schemas/search-plan";

function requirePreference(state: typeof DebateStateSchema.State): UserPreference {
  if (!state.currentPreference && !state.userPreference) throw new Error("User preference has not been parsed.");
  return UserPreferenceSchema.parse(state.currentPreference ?? state.userPreference);
}
function requireOriginalPreference(state: typeof DebateStateSchema.State): UserPreference {
  if (!state.originalPreference) throw new Error("Original user preference has not been parsed.");
  return UserPreferenceSchema.parse(state.originalPreference);
}
function requireIntent(state: typeof DebateStateSchema.State): UserIntent {
  if (!state.userIntent) throw new Error("User intent has not been parsed.");
  return UserIntentSchema.parse(state.userIntent);
}
function requireIntentProfile(state: typeof DebateStateSchema.State): IntentProfile {
  if (!state.intentProfile) throw new Error("Intent profile has not been extracted.");
  return IntentProfileSchema.parse(state.intentProfile);
}
function requireExperienceProfile(state: typeof DebateStateSchema.State): ExperienceProfile {
  if (!state.experienceProfile) throw new Error("Experience profile has not been extracted.");
  return ExperienceProfileSchema.parse(state.experienceProfile);
}
function requireSearchPlan(state: typeof DebateStateSchema.State): SearchPlan {
  if (!state.searchPlan) throw new Error("AMap search plan has not been created.");
  return state.searchPlan;
}

function numericRank(place: PlaceFactPack, places: PlaceFactPack[], value: (item: PlaceFactPack) => number | undefined, lowerIsBetter: boolean) {
  const own = value(place);
  if (own === undefined) return undefined;
  return 1 + places.filter((item) => {
    const other = value(item);
    return other !== undefined && (lowerIsBetter ? other < own : other > own);
  }).length;
}

export function buildOpeningComparison(place: PlaceFactPack, places: PlaceFactPack[]) {
  return {
    candidateCount: places.length,
    distanceRank: numericRank(place, places, (item) => item.distanceMeters, true) ?? places.length,
    ...(numericRank(place, places, (item) => item.route?.walking.durationMinutes, true) === undefined ? {} : { walkingTimeRank: numericRank(place, places, (item) => item.route?.walking.durationMinutes, true) }),
    ...(numericRank(place, places, (item) => item.rating, false) === undefined ? {} : { ratingRank: numericRank(place, places, (item) => item.rating, false) }),
    ...(numericRank(place, places, (item) => item.route?.transit?.durationMinutes, true) === undefined ? {} : { transitTimeRank: numericRank(place, places, (item) => item.route?.transit?.durationMinutes, true) }),
    ...(numericRank(place, places, (item) => item.averageCostYuan, true) === undefined ? {} : { costRank: numericRank(place, places, (item) => item.averageCostYuan, true) }),
  };
}

/** Positive only when the speaker has a material, evidence-backed advantage over the target. */
export function battleAdvantageScore(speaker: PlaceFactPack, target: PlaceFactPack) {
  let score = 0;
  if (target.distanceMeters - speaker.distanceMeters >= Math.max(300, target.distanceMeters * 0.2)) score += 2;
  if (speaker.rating !== undefined && target.rating !== undefined && speaker.rating - target.rating >= 0.2) score += 1;
  const walkingGap = (target.route?.walking.durationMinutes ?? 0) - (speaker.route?.walking.durationMinutes ?? 0);
  if (walkingGap >= 5) score += 2;
  const speakerTransit = speaker.route?.transit;
  const targetTransit = target.route?.transit;
  if (speakerTransit?.directMetro && targetTransit && !targetTransit.directMetro) score += 3;
  if (speakerTransit?.durationMinutes !== undefined && targetTransit?.durationMinutes !== undefined && targetTransit.durationMinutes - speakerTransit.durationMinutes >= 8) score += 2;
  if (speakerTransit?.walkingDistanceMeters !== undefined && targetTransit?.walkingDistanceMeters !== undefined && targetTransit.walkingDistanceMeters - speakerTransit.walkingDistanceMeters >= 500) score += 1;
  const speakerStrategies = speaker.route?.transitStrategies;
  const targetStrategies = target.route?.transitStrategies;
  if (speakerStrategies?.fastest?.durationMinutes !== undefined && targetStrategies?.fastest?.durationMinutes !== undefined && targetStrategies.fastest.durationMinutes - speakerStrategies.fastest.durationMinutes >= 8) score += 2;
  if (speakerStrategies?.leastWalking?.walkingDistanceMeters !== undefined && targetStrategies?.leastWalking?.walkingDistanceMeters !== undefined && targetStrategies.leastWalking.walkingDistanceMeters - speakerStrategies.leastWalking.walkingDistanceMeters >= 500) score += 2;
  if (speakerStrategies?.leastTransfers?.transferCount !== undefined && targetStrategies?.leastTransfers?.transferCount !== undefined && targetStrategies.leastTransfers.transferCount > speakerStrategies.leastTransfers.transferCount) score += 2;
  if (speaker.averageCostYuan !== undefined && target.averageCostYuan !== undefined) {
    const costGap = target.averageCostYuan - speaker.averageCostYuan;
    if (costGap >= Math.max(15, target.averageCostYuan * 0.2)) score += 2;
  }
  return score;
}

/** Chooses the more informative of the two balanced three-place cycle directions. */
export function planBattlePairings(places: PlaceFactPack[]) {
  if (places.length !== 3) return [];
  const cycles = [1, 2].map((shift) => places.map((speaker, index) => ({ speaker, target: places[(index + shift) % places.length] })));
  const selected = cycles.sort((left, right) => right.reduce((sum, pair) => sum + battleAdvantageScore(pair.speaker, pair.target), 0)
    - left.reduce((sum, pair) => sum + battleAdvantageScore(pair.speaker, pair.target), 0))[0];
  return selected.filter((pair) => battleAdvantageScore(pair.speaker, pair.target) > 0);
}

/** Only uncertainty that changes the recommendation direction may interrupt. */
export function coreClarificationSlots(slots: IntentProfile["missingSlots"]) {
  return slots.filter((slot): slot is "experience_type" | "activity_type" => slot === "experience_type" || slot === "activity_type");
}

export interface PlaceDataSource {
  retrievePlaces: (origin: { longitude: number; latitude: number }, plan: SearchPlan) => Promise<PlaceCandidate[] | { pois: PlaceCandidate[]; queryMetrics: AMapQueryMetric[] }>;
}
export interface ContextDataSource {
  resolveLocation: (gps?: Coordinates) => Promise<LocationContext>;
  getWeather: (adcode: string) => Promise<WeatherContext>;
  getRoutes: (origin: Coordinates, destination: PlaceCandidate, options?: RouteRequestOptions) => Promise<RouteContext>;
  getMetroAccess?: (candidate: PlaceCandidate) => Promise<import("@/lib/schemas/place").MetroAccessContext>;
}

export function createDebateNodes(
  model: StructuredModel,
  dataSource: PlaceDataSource = { retrievePlaces: retrieveNearbyPoisWithMetrics },
  contextDataSource: ContextDataSource = { resolveLocation, getWeather: getCurrentWeather, getRoutes, getMetroAccess },
) {
  return {
    parseIntent: async (state: typeof DebateStateSchema.State) => {
      const { intentProfile, preference: userPreference, experienceProfile } = await interpretIntent(state.originalQuery, model);
      return { intentProfile, experienceProfile, userPreference, originalPreference: userPreference, currentPreference: userPreference };
    },

    experiencePlanner: (state: typeof DebateStateSchema.State) => {
      const currentPreference = planExperience(requireIntentProfile(state), requirePreference(state));
      return { userPreference: currentPreference, currentPreference, experienceProfile: requireExperienceProfile(state) };
    },

    completenessCheck: (state: typeof DebateStateSchema.State) => {
      const profile = requireIntentProfile(state);
      const slots = coreClarificationSlots(profile.missingSlots)
        .filter((slot) => !(slot === "activity_type" && (profile.mentionedCategories.length > 0 || profile.explicitTarget?.specificity === "specific")));
      return { needsClarification: slots.length > 0 };
    },

    clarificationInterrupt: async (state: typeof DebateStateSchema.State) => {
      const profile = requireIntentProfile(state);
      const currentExperienceProfile = requireExperienceProfile(state);
      const slots = coreClarificationSlots(profile.missingSlots);
      const experienceDirection = slots.includes("experience_type");
      const question = currentExperienceProfile.engagementType === "functional"
        ? "你更偏向哪种运动环境？"
        : currentExperienceProfile.engagementType === "rest"
        ? "你更想怎么休息？"
        : experienceDirection
        ? "你更想哪种？"
        : "你更想做哪类活动？";
      const options = profile.mentionedCategories.includes("fitness")
        ? ["健身房/健身中心", "户外运动场", "游泳馆", "都可以，直接推荐"]
        : currentExperienceProfile.engagementType === "functional"
        ? ["优先室内运动", "优先户外运动", "室内外都可以，直接推荐"]
        : currentExperienceProfile.engagementType === "rest"
        ? ["室内坐着休息", "室内轻松走走/逛逛", "户外阴凉处休息", "室内外都可以，直接推荐"]
        : experienceDirection
        ? ["商场/商业空间", "展览馆/博物馆", "书店/文化空间", "都可以，直接推荐"]
        : ["轻松散步/公园", "逛展/文化空间", "商场/商业空间", "都可以，直接推荐"];
      const resumed = interrupt({
        intentProfile: profile,
        missingSlots: slots,
        question,
        options,
      }) as { answer?: unknown } | string;
      const answer = typeof resumed === "string" ? resumed : typeof resumed?.answer === "string" ? resumed.answer : "直接推荐";
      const { intentProfile, preference, experienceProfile } = await updateIntentFromClarification(state.originalQuery, profile, answer, model);
      return { intentProfile, experienceProfile, userPreference: preference, currentPreference: preference, needsClarification: false };
    },

    createSearchPlan: (state: typeof DebateStateSchema.State) => {
      const searchPlan = createSearchPlan(requireIntentProfile(state), requireExperienceProfile(state));
      return { searchPlan, userIntent: searchPlan.intent };
    },

    resolveLocation: async (state: typeof DebateStateSchema.State) => ({ location: await contextDataSource.resolveLocation(state.gpsCoordinates) }),

    retrievePlaces: async (state: typeof DebateStateSchema.State) => {
      if (!state.location) throw new Error("Location has not been resolved.");
      const retrieved = await dataSource.retrievePlaces(state.location.amapCoordinates, requireSearchPlan(state));
      return Array.isArray(retrieved) ? { rawPois: retrieved } : { rawPois: retrieved.pois, amapQueryMetrics: retrieved.queryMetrics };
    },

    preExperienceFilter: (state: typeof DebateStateSchema.State) => ({
      // This first-layer filter is deterministic and deliberately runs before
      // the LLM so POI infrastructure and duplicate sub-locations never spend
      // a structured-output slot.
      preScoringPois: hardFilterPois(state.rawPois),
    }),

    placeExperienceScorer: async (state: typeof DebateStateSchema.State) => {
      const scored = await scorePlaceExperiences(state.preScoringPois, model);
      return { scoredPois: scored.candidates, experienceScoringMetrics: scored.metrics };
    },

    filterPlaces: (state: typeof DebateStateSchema.State) => {
      const searchPlan = requireSearchPlan(state);
      const explicitTarget = searchPlan.strictTargetMatch ? searchPlan.intentProfile.explicitTarget?.text : undefined;
      return {
        filteredPois: filterIntentCompatiblePois(
          state.scoredPois,
          requireExperienceProfile(state),
          searchPlan.strictCategoryMatch ? searchPlan.allowedCategories : undefined,
          explicitTarget,
        ).filter((candidate) => !state.excludedPoiIds.includes(candidate.id)),
      };
    },

    preliminaryRank: (state: typeof DebateStateSchema.State) => {
      const searchPlan = requireSearchPlan(state);
      const requirements = deriveRankingRequirements(searchPlan.intentProfile);
      const eligibleCandidates = applyKnownCandidateRequirements(state.filteredPois, requirements);
      if (requirements.preferHighRating && eligibleCandidates.length === 0) throw new Error("没有找到评分达到 4.2 且符合其他要求的地点。");
      const rankedCandidates = rankCandidates(eligibleCandidates, requirePreference(state), requireExperienceProfile(state), searchPlan.strictTargetMatch, requirements);
      const routeCandidateLimit = requirePreference(state).transportPreference === "metro" ? Math.min(10, rankedCandidates.length) : 3;
      const selectedCandidates = searchPlan.strictTargetMatch
        ? rankedCandidates.slice(0, routeCandidateLimit)
        : selectDiverseCandidates(rankedCandidates, routeCandidateLimit, searchPlan.strictCategoryMatch ? searchPlan.allowedCategories : undefined);
      return { rankedCandidates: rankedCandidates.slice(0, 10), selectedCandidates };
    },

    candidateQualityCheck: (state: typeof DebateStateSchema.State) => {
      const searchPlan = requireSearchPlan(state);
      const requirements = deriveRankingRequirements(searchPlan.intentProfile);
      if (state.selectedCandidates.length < 3 && !searchPlan.strictCategoryMatch && !searchPlan.strictTargetMatch && !requirements.preferHighRating && !requirements.requireDirectMetro) {
        throw new Error(`Only ${state.selectedCandidates.length} candidates match the ${requireIntent(state).primaryGoal} intent; no unrelated fallback is allowed.`);
      }
      return {};
    },

    enrichRoutesAndWeather: async (state: typeof DebateStateSchema.State) => {
      if (!state.location) throw new Error("Location has not been resolved.");
      const weather = await contextDataSource.getWeather(state.location.adcode);
      const enrichedCandidates = await Promise.all(state.selectedCandidates.map(async (candidate) => ({
        ...candidate,
        // Battle may compare real travel trade-offs even when transport was not
        // an explicit retrieval constraint, so finalists always receive transit evidence.
        route: await contextDataSource.getRoutes(state.location!.amapCoordinates, candidate, { includeTransit: true, cityCode: state.location!.cityCode }),
        weather,
        locationLabel: state.location!.formattedAddress,
      })));
      return { weather, enrichedCandidates };
    },

    finalRank: (state: typeof DebateStateSchema.State) => {
      const searchPlan = requireSearchPlan(state);
      const requirements = deriveRankingRequirements(searchPlan.intentProfile);
      const eligibleCandidates = applyRouteCandidateRequirements(state.enrichedCandidates, requirements);
      if (requirements.requireDirectMetro && eligibleCandidates.length === 0) {
        const routeWasVerifiable = state.enrichedCandidates.some((candidate) => candidate.route?.transit?.status === "available" || candidate.route?.transit?.status === "no_route");
        throw new Error(routeWasVerifiable ? "没有找到可确认地铁零换乘直达且符合其他要求的地点。" : "暂时无法从高德路线数据验证地铁是否直达，请稍后重试。");
      }
      const ranked = finalRankCandidates(eligibleCandidates, requirePreference(state), requireExperienceProfile(state), searchPlan.strictTargetMatch, requirements);
      return { selectedCandidates: searchPlan.strictTargetMatch ? ranked.slice(0, 3) : selectDiverseCandidates(ranked, 3, searchPlan.strictCategoryMatch ? searchPlan.allowedCategories : undefined) };
    },

    buildFactPacks: (state: typeof DebateStateSchema.State) => {
      const factPacks = createFactPacks(state.selectedCandidates);
      return { factPacks, beforeInterventionScores: scoreFinalistsAfterIntervention(state.selectedCandidates, requirePreference(state)) };
    },

    openingRound: async (state: typeof DebateStateSchema.State) => {
      const preference = requirePreference(state);
      const outputs = await Promise.all(
        state.factPacks.map((place) => createPlaceAgent(place, preference, model, requireIntent(state)).opening(buildOpeningComparison(place, state.factPacks))),
      );
      return {
        openingMessages: outputs.map<DebateMessage>((output, index) => ({
          id: `opening-${state.factPacks[index].id}`,
          type: "opening",
          speakerPoiId: state.factPacks[index].id,
          claim: output.claim,
          evidenceIds: output.evidenceIds,
        })),
      };
    },

    attackRound: async (state: typeof DebateStateSchema.State) => {
      const preference = requirePreference(state);
      if (state.factPacks.length !== 3) throw new Error("Battle requires exactly three Place Agents.");
      const outputs = await Promise.all(planBattlePairings(state.factPacks).map(async ({ speaker, target }) => ({
        speaker,
        output: await createPlaceAgent(speaker, preference, model, requireIntent(state)).attack(target, state.openingMessages),
      })));
      return {
        attackMessages: outputs.map<DebateMessage>(({ speaker, output }) => ({
          id: `attack-${speaker.id}-${output.targetPoiId}`,
          type: "attack",
          speakerPoiId: speaker.id,
          targetPoiId: output.targetPoiId,
          claim: output.claim,
          evidenceIds: output.evidenceIds,
        })),
      };
    },

    userIntervention: async (state: typeof DebateStateSchema.State) => {
      // Interrupt is deliberately the first operation: LangGraph restarts this node on resume.
      const resumed = interrupt({
        currentPreference: requirePreference(state),
        candidates: state.factPacks.map((place) => ({ id: place.id, name: place.name, category: place.category })),
        openingSummaries: state.openingMessages.map((message) => ({ speakerPoiId: message.speakerPoiId, claim: message.claim })),
        attackSummaries: state.attackMessages.map((message) => ({ id: message.id, speakerPoiId: message.speakerPoiId, targetPoiId: message.targetPoiId, claim: message.claim })),
      }) as { intervention?: unknown } | string;
      const interventionText = typeof resumed === "string" ? resumed.trim() : typeof resumed?.intervention === "string" ? resumed.intervention.trim() : "";
      return { interventionText };
    },

    candidateDecision: (state: typeof DebateStateSchema.State) => {
      const resumed = interrupt({ candidates: state.factPacks.map((place) => ({ id: place.id, name: place.name, category: place.category })), openingMessages: state.openingMessages, attackMessages: state.attackMessages, actions: ["eliminate_candidate", "refresh_candidates"] });
      return { candidateDecision: CandidateDecisionSchema.parse(resumed) };
    },

    eliminateCandidate: (state: typeof DebateStateSchema.State) => {
      const decision = state.candidateDecision;
      if (decision?.actionType !== "eliminate_candidate" || !state.factPacks.some((place) => place.id === decision.eliminatedPoiId)) throw new Error("Invalid candidate elimination.");
      const survivingCandidateIds = state.factPacks.filter((place) => place.id !== decision.eliminatedPoiId).map((place) => place.id);
      if (survivingCandidateIds.length !== 2) throw new Error("Candidate elimination must leave exactly two survivors.");
      return { eliminatedPoiIds: [...state.eliminatedPoiIds, decision.eliminatedPoiId], survivingCandidateIds };
    },

    finalDuel: async (state: typeof DebateStateSchema.State) => {
      const survivors = state.factPacks.filter((place) => state.survivingCandidateIds.includes(place.id));
      const outputs = await Promise.all(survivors.map(async (place) => {
        const opponent = survivors.find((candidate) => candidate.id !== place.id)!;
        const output = await model.invoke(OpeningOutputSchema, [{ role: "system", content: "你是地点决赛辩手。用自然中文给出最后一次 60-120 字发言：承认对手一个真实优势，再说明当前二选一为什么该选你。只能引用自己的 FactPack，最多三个证据，不要逐项报数据。" }, { role: "user", content: `当前偏好:${JSON.stringify(requirePreference(state))}\n我:${JSON.stringify(place)}\n对手:${JSON.stringify(opponent)}\n用户淘汰了:${state.eliminatedPoiIds.join(",")}` }], "final_duel");
        return { place, output };
      }));
      return { finalDuelMessages: outputs.map(({ place, output }) => ({ id: `duel-${place.id}`, type: "rebuttal" as const, speakerPoiId: place.id, claim: output.claim, evidenceIds: output.evidenceIds.slice(0, 3) })) };
    },

    finalSelection: (state: typeof DebateStateSchema.State) => {
      const selectedPoiId = interrupt({ candidates: state.survivingCandidateIds, finalDuelMessages: state.finalDuelMessages });
      if (typeof selectedPoiId !== "string" || !state.survivingCandidateIds.includes(selectedPoiId)) throw new Error("Final selection must be one of the surviving candidates.");
      return { selectedPoiId };
    },

    refreshCandidates: async (state: typeof DebateStateSchema.State) => {
      if (state.candidateRound >= 2) throw new Error("A debate can refresh candidates at most once.");
      const decision = state.candidateDecision;
      if (decision?.actionType !== "refresh_candidates") throw new Error("Refresh requires an explicit refresh action.");
      const { updatedPreference, preferenceDelta } = await updatePreferenceFromIntervention(requirePreference(state), decision.feedbackText, model);
      if (!state.location) throw new Error("Location has not been resolved.");
      const retrieved = await dataSource.retrievePlaces(state.location.amapCoordinates, requireSearchPlan(state));
      const retrievalState = Array.isArray(retrieved) ? { rawPois: retrieved } : { rawPois: retrieved.pois, amapQueryMetrics: retrieved.queryMetrics };
      return { ...retrievalState, currentPreference: updatedPreference, userPreference: updatedPreference, preferenceDelta, interventionText: decision.feedbackText, excludedPoiIds: [...state.excludedPoiIds, ...state.factPacks.map((place) => place.id)], previousCandidateRounds: [...state.previousCandidateRounds, state.selectedCandidates], candidateRound: 2, refreshReason: decision.feedbackText };
    },

    updatePreference: async (state: typeof DebateStateSchema.State) => {
      const { updatedPreference, preferenceDelta } = await updatePreferenceFromIntervention(requirePreference(state), state.interventionText, model);
      return { userPreference: updatedPreference, currentPreference: updatedPreference, preferenceDelta };
    },

    detectMissingEvidence: (state: typeof DebateStateSchema.State) => {
      const requiredEvidenceTypes = requirePreference(state).transportPreference === "metro" ? ["METRO_ACCESS" as const] : [];
      const missingEvidenceTypes = requiredEvidenceTypes.filter((type) => type === "METRO_ACCESS" && state.factPacks.some((pack) => !pack.metroAccess));
      return { requiredEvidenceTypes, missingEvidenceTypes };
    },

    enrichInterventionEvidence: async (state: typeof DebateStateSchema.State) => {
      if (!contextDataSource.getMetroAccess) throw new Error("Metro evidence source is not configured.");
      const candidates = await Promise.all(state.selectedCandidates.map(async (candidate) => ({ ...candidate, metroAccess: await contextDataSource.getMetroAccess!(candidate) })));
      return { selectedCandidates: candidates, factPacks: createFactPacks(candidates) };
    },

    rerankFinalists: (state: typeof DebateStateSchema.State) => ({ afterInterventionScores: scoreFinalistsAfterIntervention(state.selectedCandidates, requirePreference(state)) }),

    rebuttalRound: async (state: typeof DebateStateSchema.State) => {
      const currentPreference = requirePreference(state);
      const originalPreference = requireOriginalPreference(state);
      const outputs = await Promise.all(
        state.attackMessages.map(async (attack) => {
          const place = state.factPacks.find((candidate) => candidate.id === attack.targetPoiId);
          if (!place) throw new Error(`Attack ${attack.id} targeted an unknown place.`);
          return {
            attack,
            place,
            output: await createPlaceAgent(place, currentPreference, model, requireIntent(state)).rebuttal(attack, originalPreference, currentPreference, state.preferenceDelta),
          };
        }),
      );
      return {
        rebuttalMessages: outputs.map<DebateMessage>(({ attack, place, output }) => ({
          id: `rebuttal-${attack.id}`,
          type: "rebuttal",
          speakerPoiId: place.id,
          attackerPoiId: attack.speakerPoiId,
          responseToAttackId: attack.id,
          claim: output.claim,
          evidenceIds: output.evidenceIds,
        })),
      };
    },

    moderatorSummary: (state: typeof DebateStateSchema.State) => ({
      moderatorResult: buildModeratorResult(
        state.preferenceDelta ?? { interventionText: "", changedFields: [] },
        state.afterInterventionScores,
        state.factPacks,
      ),
    }),
  };
}
