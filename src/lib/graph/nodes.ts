import { interpretIntent, updateIntentFromClarification, updatePreferenceFromIntervention } from "@/lib/agents/intent-agent";
import { moderateDebate } from "@/lib/agents/moderator-agent";
import { createPlaceAgent } from "@/lib/agents/place-agent-factory";
import type { StructuredModel } from "@/lib/agents/model-factory";
import { retrieveNearbyPois } from "@/lib/amap/places";
import { createSearchPlan } from "@/lib/search/search-plan";
import { planExperience } from "@/lib/intent/experience-planner";
import { scorePlaceExperiences } from "@/lib/experience/place-experience-scorer";
import { getRoutes } from "@/lib/amap/routes";
import { resolveLocation } from "@/lib/amap/location";
import { getCurrentWeather } from "@/lib/amap/weather";
import { getMetroAccess } from "@/lib/amap/metro";
import { createFactPacks, filterIntentCompatiblePois, finalRankCandidates, hardFilterPois, rankCandidates, scoreFinalistsAfterIntervention, selectDiverseCandidates } from "@/lib/ranking/ranker";
import type { PlaceCandidate } from "@/lib/schemas/place";
import type { Coordinates, LocationContext, RouteContext, WeatherContext } from "@/lib/schemas/location";
import { CandidateDecisionSchema, OpeningOutputSchema, type DebateMessage } from "@/lib/schemas/debate";
import type { DebateStateSchema } from "./state";
import { interrupt } from "@langchain/langgraph";
import { UserPreferenceSchema, type UserPreference } from "@/lib/schemas/preference";
import { UserIntentSchema, type UserIntent } from "@/lib/schemas/intent";
import { IntentProfileSchema, type IntentProfile } from "@/lib/schemas/intent";
import { ExperienceProfileSchema, type ExperienceProfile } from "@/lib/schemas/experience";
import type { SearchPlan } from "@/lib/schemas/search-plan";

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
function requireUserExperienceProfile(state: typeof DebateStateSchema.State): ExperienceProfile {
  if (!state.userExperienceProfile) throw new Error("User experience profile has not been extracted.");
  return ExperienceProfileSchema.parse(state.userExperienceProfile);
}
function requireSearchPlan(state: typeof DebateStateSchema.State): SearchPlan {
  if (!state.searchPlan) throw new Error("AMap search plan has not been created.");
  return state.searchPlan;
}

export interface PlaceDataSource {
  retrievePlaces: (origin: { longitude: number; latitude: number }, plan: SearchPlan) => Promise<PlaceCandidate[]>;
}
export interface ContextDataSource {
  resolveLocation: (gps?: Coordinates) => Promise<LocationContext>;
  getWeather: (adcode: string) => Promise<WeatherContext>;
  getRoutes: (origin: Coordinates, destination: PlaceCandidate) => Promise<RouteContext>;
  getMetroAccess?: (candidate: PlaceCandidate) => Promise<import("@/lib/schemas/place").MetroAccessContext>;
}

export function createDebateNodes(
  model: StructuredModel,
  dataSource: PlaceDataSource = { retrievePlaces: retrieveNearbyPois },
  contextDataSource: ContextDataSource = { resolveLocation, getWeather: getCurrentWeather, getRoutes, getMetroAccess },
) {
  return {
    parseIntent: async (state: typeof DebateStateSchema.State) => {
      const { intentProfile, preference: userPreference, userExperienceProfile } = await interpretIntent(state.originalQuery, model);
      return { intentProfile, userExperienceProfile, userPreference, originalPreference: userPreference, currentPreference: userPreference };
    },

    experiencePlanner: (state: typeof DebateStateSchema.State) => {
      const currentPreference = planExperience(requireIntentProfile(state), requirePreference(state));
      return { userPreference: currentPreference, currentPreference, userExperienceProfile: requireUserExperienceProfile(state) };
    },

    completenessCheck: (state: typeof DebateStateSchema.State) => ({ needsClarification: requireIntentProfile(state).missingSlots.length > 0 }),

    clarificationInterrupt: async (state: typeof DebateStateSchema.State) => {
      const profile = requireIntentProfile(state);
      const slots = profile.missingSlots;
      const question = slots.includes("experience_type")
        ? "你更想哪种？"
        : `为了更贴近你的需求，请补充：${slots.join("、")}。也可以选择“直接推荐”。`;
      const resumed = interrupt({ intentProfile: profile, missingSlots: slots, question, options: slots.includes("experience_type") ? ["商场/商业空间", "展览馆/博物馆", "书店/文化空间", "都可以，直接推荐"] : ["直接推荐"] }) as { answer?: unknown } | string;
      const answer = typeof resumed === "string" ? resumed : typeof resumed?.answer === "string" ? resumed.answer : "直接推荐";
      const { intentProfile, preference, userExperienceProfile } = await updateIntentFromClarification(state.originalQuery, profile, answer, model);
      return { intentProfile, userExperienceProfile, userPreference: preference, currentPreference: preference, needsClarification: false };
    },

    createSearchPlan: (state: typeof DebateStateSchema.State) => {
      const searchPlan = createSearchPlan(requireIntentProfile(state));
      return { searchPlan, userIntent: searchPlan.intent };
    },

    resolveLocation: async (state: typeof DebateStateSchema.State) => ({ location: await contextDataSource.resolveLocation(state.gpsCoordinates) }),

    retrievePlaces: async (state: typeof DebateStateSchema.State) => {
      if (!state.location) throw new Error("Location has not been resolved.");
      return { rawPois: await dataSource.retrievePlaces(state.location.amapCoordinates, requireSearchPlan(state)) };
    },

    placeExperienceScorer: async (state: typeof DebateStateSchema.State) => ({
      scoredPois: await scorePlaceExperiences(state.rawPois, model),
    }),

    filterPlaces: (state: typeof DebateStateSchema.State) => ({
      filteredPois: filterIntentCompatiblePois(hardFilterPois(state.scoredPois), requireUserExperienceProfile(state))
        .filter((candidate) => !state.excludedPoiIds.includes(candidate.id)),
    }),

    preliminaryRank: (state: typeof DebateStateSchema.State) => {
      const rankedCandidates = rankCandidates(state.filteredPois, requirePreference(state), requireUserExperienceProfile(state));
      const selectedCandidates = selectDiverseCandidates(rankedCandidates);
      return { rankedCandidates: rankedCandidates.slice(0, 10), selectedCandidates };
    },

    candidateQualityCheck: (state: typeof DebateStateSchema.State) => {
      if (state.selectedCandidates.length < 3) {
        throw new Error(`Only ${state.selectedCandidates.length} candidates match the ${requireIntent(state).primaryGoal} intent; no unrelated fallback is allowed.`);
      }
      return {};
    },

    enrichRoutesAndWeather: async (state: typeof DebateStateSchema.State) => {
      if (!state.location) throw new Error("Location has not been resolved.");
      const weather = await contextDataSource.getWeather(state.location.adcode);
      const enrichedCandidates = await Promise.all(state.selectedCandidates.map(async (candidate) => ({
        ...candidate,
        route: await contextDataSource.getRoutes(state.location!.amapCoordinates, candidate),
        weather,
        locationLabel: state.location!.formattedAddress,
      })));
      return { weather, enrichedCandidates };
    },

    finalRank: (state: typeof DebateStateSchema.State) => ({ selectedCandidates: selectDiverseCandidates(finalRankCandidates(state.enrichedCandidates, requirePreference(state), requireUserExperienceProfile(state))) }),

    buildFactPacks: (state: typeof DebateStateSchema.State) => {
      const factPacks = createFactPacks(state.selectedCandidates);
      return { factPacks, beforeInterventionScores: scoreFinalistsAfterIntervention(state.selectedCandidates, requirePreference(state)) };
    },

    openingRound: async (state: typeof DebateStateSchema.State) => {
      const preference = requirePreference(state);
      const outputs = await Promise.all(
        state.factPacks.map((place) => createPlaceAgent(place, preference, model, requireIntent(state)).opening()),
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
      const outputs = await Promise.all(
        state.factPacks.map((place) =>
          createPlaceAgent(place, preference, model, requireIntent(state)).attack(
            state.factPacks.filter((competitor) => competitor.id !== place.id),
            state.openingMessages,
          ),
        ),
      );
      return {
        attackMessages: outputs.map<DebateMessage>((output, index) => ({
          id: `attack-${state.factPacks[index].id}-${output.targetPoiId}`,
          type: "attack",
          speakerPoiId: state.factPacks[index].id,
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
      const rawPois = await dataSource.retrievePlaces(state.location.amapCoordinates, requireSearchPlan(state));
      return { rawPois, currentPreference: updatedPreference, userPreference: updatedPreference, preferenceDelta, interventionText: decision.feedbackText, excludedPoiIds: [...state.excludedPoiIds, ...state.factPacks.map((place) => place.id)], previousCandidateRounds: [...state.previousCandidateRounds, state.selectedCandidates], candidateRound: 2, refreshReason: decision.feedbackText };
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
      if (!state.preferenceDelta) throw new Error("Preference delta is required after user intervention.");
      const outputs = await Promise.all(
        state.attackMessages.map(async (attack) => {
          const place = state.factPacks.find((candidate) => candidate.id === attack.targetPoiId);
          if (!place) throw new Error(`Attack ${attack.id} targeted an unknown place.`);
          return {
            attack,
            place,
            output: await createPlaceAgent(place, currentPreference, model, requireIntent(state)).rebuttal(attack, originalPreference, currentPreference, state.preferenceDelta!),
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

    moderatorSummary: async (state: typeof DebateStateSchema.State) => ({
      moderatorResult: await moderateDebate(
        requireOriginalPreference(state),
        requirePreference(state),
        state.preferenceDelta ?? { interventionText: "", changedFields: [] },
        state.beforeInterventionScores,
        state.afterInterventionScores,
        state.factPacks,
        [...state.openingMessages, ...state.attackMessages, ...state.rebuttalMessages],
        model,
      ),
    }),
  };
}
