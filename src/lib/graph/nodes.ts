import { interpretIntent } from "@/lib/agents/intent-agent";
import { moderateDebate } from "@/lib/agents/moderator-agent";
import { createPlaceAgent } from "@/lib/agents/place-agent-factory";
import type { StructuredModel } from "@/lib/agents/model-factory";
import { mockPlaces } from "@/lib/mock/places";
import type { DebateMessage } from "@/lib/schemas/debate";
import type { DebateStateSchema } from "./state";

function requirePreference(state: typeof DebateStateSchema.State) {
  if (!state.userPreference) throw new Error("User preference has not been parsed.");
  return state.userPreference;
}

export function createDebateNodes(model: StructuredModel) {
  return {
    parseIntent: async (state: typeof DebateStateSchema.State) => ({
      userPreference: await interpretIntent(state.originalQuery, model),
    }),

    loadMockPlaces: () => ({ factPacks: mockPlaces }),

    openingRound: async (state: typeof DebateStateSchema.State) => {
      const preference = requirePreference(state);
      const outputs = await Promise.all(
        state.factPacks.map((place) => createPlaceAgent(place, preference, model).opening()),
      );
      return {
        openingMessages: outputs.map<DebateMessage>((output, index) => ({
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
          type: "attack",
          speakerPoiId: state.factPacks[index].id,
          targetPoiId: output.targetPoiId,
          claim: output.claim,
          evidenceIds: output.evidenceIds,
        })),
      };
    },

    rebuttalRound: async (state: typeof DebateStateSchema.State) => {
      const preference = requirePreference(state);
      const attackedPlaces = state.factPacks.filter((place) =>
        state.attackMessages.some((attack) => attack.targetPoiId === place.id),
      );
      const outputs = await Promise.all(
        attackedPlaces.map((place) =>
          createPlaceAgent(place, preference, model).rebuttal(
            state.attackMessages.filter((attack) => attack.targetPoiId === place.id),
          ),
        ),
      );
      return {
        rebuttalMessages: outputs.map<DebateMessage>((output, index) => ({
          type: "rebuttal",
          speakerPoiId: attackedPlaces[index].id,
          claim: output.claim,
          evidenceIds: output.evidenceIds,
        })),
      };
    },

    moderatorSummary: async (state: typeof DebateStateSchema.State) => ({
      moderatorResult: await moderateDebate(
        requirePreference(state),
        state.factPacks,
        [...state.openingMessages, ...state.attackMessages, ...state.rebuttalMessages],
        model,
      ),
    }),
  };
}
