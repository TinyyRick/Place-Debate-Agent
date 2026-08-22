import { interpretIntent, updatePreferenceFromIntervention } from "@/lib/agents/intent-agent";
import { moderateDebate } from "@/lib/agents/moderator-agent";
import { createPlaceAgent } from "@/lib/agents/place-agent-factory";
import type { StructuredModel } from "@/lib/agents/model-factory";
import { retrieveNearbyPois } from "@/lib/amap/places";
import { getRoutes } from "@/lib/amap/routes";
import { resolveLocation } from "@/lib/amap/location";
import { getCurrentWeather } from "@/lib/amap/weather";
import { getMetroAccess } from "@/lib/amap/metro";
import { createFactPacks, finalRankCandidates, hardFilterPois, rankCandidates, scoreFinalistsAfterIntervention, selectDiverseCandidates } from "@/lib/ranking/ranker";
import type { PlaceCandidate } from "@/lib/schemas/place";
import type { Coordinates, LocationContext, RouteContext, WeatherContext } from "@/lib/schemas/location";
import type { DebateMessage } from "@/lib/schemas/debate";
import type { DebateStateSchema } from "./state";
import { interrupt } from "@langchain/langgraph";
import { UserPreferenceSchema, type UserPreference } from "@/lib/schemas/preference";

function requirePreference(state: typeof DebateStateSchema.State): UserPreference {
  if (!state.currentPreference && !state.userPreference) throw new Error("User preference has not been parsed.");
  return UserPreferenceSchema.parse(state.currentPreference ?? state.userPreference);
}
function requireOriginalPreference(state: typeof DebateStateSchema.State): UserPreference {
  if (!state.originalPreference) throw new Error("Original user preference has not been parsed.");
  return UserPreferenceSchema.parse(state.originalPreference);
}

export interface PlaceDataSource {
  retrievePlaces: (origin: { longitude: number; latitude: number }) => Promise<PlaceCandidate[]>;
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
      const userPreference = await interpretIntent(state.originalQuery, model);
      return { userPreference, originalPreference: userPreference, currentPreference: userPreference };
    },

    resolveLocation: async (state: typeof DebateStateSchema.State) => ({ location: await contextDataSource.resolveLocation(state.gpsCoordinates) }),

    retrievePlaces: async (state: typeof DebateStateSchema.State) => {
      if (!state.location) throw new Error("Location has not been resolved.");
      return { rawPois: await dataSource.retrievePlaces(state.location.amapCoordinates) };
    },

    filterPlaces: (state: typeof DebateStateSchema.State) => ({
      filteredPois: hardFilterPois(state.rawPois),
    }),

    preliminaryRank: (state: typeof DebateStateSchema.State) => {
      const rankedCandidates = rankCandidates(state.filteredPois, requirePreference(state));
      const selectedCandidates = selectDiverseCandidates(rankedCandidates);
      if (selectedCandidates.length < 3) {
        throw new Error(`Only ${selectedCandidates.length} valid destination candidates remained after fallback; at least 3 are required.`);
      }
      return { rankedCandidates: rankedCandidates.slice(0, 10), selectedCandidates };
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

    finalRank: (state: typeof DebateStateSchema.State) => ({ selectedCandidates: selectDiverseCandidates(finalRankCandidates(state.enrichedCandidates, requirePreference(state))) }),

    buildFactPacks: (state: typeof DebateStateSchema.State) => {
      const factPacks = createFactPacks(state.selectedCandidates);
      return { factPacks, beforeInterventionScores: scoreFinalistsAfterIntervention(state.selectedCandidates, requirePreference(state)) };
    },

    openingRound: async (state: typeof DebateStateSchema.State) => {
      const preference = requirePreference(state);
      const outputs = await Promise.all(
        state.factPacks.map((place) => createPlaceAgent(place, preference, model).opening()),
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
          createPlaceAgent(place, preference, model).attack(
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
            output: await createPlaceAgent(place, currentPreference, model).rebuttal(attack, originalPreference, currentPreference, state.preferenceDelta!),
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
