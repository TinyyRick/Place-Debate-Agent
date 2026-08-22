import { describe, expect, it } from "vitest";
import { createPlaceAgent } from "@/lib/agents/place-agent-factory";
import type { StructuredModel } from "@/lib/agents/model-factory";
import { mockPlaces } from "@/lib/mock/places";
import type { UserPreference } from "@/lib/schemas/preference";

const preference: UserPreference = {
  activityLevel: "low",
  indoorPreference: 0.7,
  naturePreference: 0.5,
  culturePreference: 0.8,
  budgetLevel: "medium",
  companions: "solo",
  transportPreference: "flexible",
  movementPreference: "flexible",
  distanceTolerance: "near",
  heatTolerance: 0.5,
  rainTolerance: 0.5,
  freeTextConstraints: ["不要太累"],
};

describe("place-agent evidence validation", () => {
  it("rejects an attack that cites the speaker's evidence instead of the target's", async () => {
    const invalidEvidenceModel: StructuredModel = {
      async invoke(schema, _messages, name) {
        if (name !== "place_attack") throw new Error("Unexpected test call.");
        return schema.parse({
          targetPoiId: "nanjing-museum",
          claim: "对方的路程更长。",
          evidenceIds: ["XW_DISTANCE"],
        });
      },
    };
    const agent = createPlaceAgent(mockPlaces[0], preference, invalidEvidenceModel);

    await expect(agent.attack([mockPlaces[1]], [])).rejects.toThrow(
      "Agent returned evidence outside its FactPacks: XW_DISTANCE",
    );
  });

  it("rejects an attack against a place outside the candidate set", async () => {
    const invalidTargetModel: StructuredModel = {
      async invoke(schema, _messages, name) {
        if (name !== "place_attack") throw new Error("Unexpected test call.");
        return schema.parse({
          targetPoiId: "not-a-candidate",
          claim: "无效目标。",
          evidenceIds: ["NM_ROUTE"],
        });
      },
    };
    const agent = createPlaceAgent(mockPlaces[0], preference, invalidTargetModel);

    await expect(agent.attack([mockPlaces[1]], [])).rejects.toThrow("attacked an unknown competitor");
  });

  it("rejects a rebuttal that copies its attack or binds to the wrong attacker", async () => {
    const copiedModel: StructuredModel = {
      async invoke(schema, _messages, name) {
        if (name !== "place_rebuttal") throw new Error("Unexpected test call.");
        return schema.parse({
          responseToAttackId: "attack-nanjing-museum-xuanwu-lake",
          attackerPoiId: "nanjing-museum",
          claim: "对方的路程更长。",
          evidenceIds: ["XW_DISTANCE"],
        });
      },
    };
    const attack = { id: "attack-nanjing-museum-xuanwu-lake", type: "attack" as const, speakerPoiId: "nanjing-museum", targetPoiId: "xuanwu-lake", claim: "对方的路程更长。", evidenceIds: ["XW_DISTANCE"] };
    await expect(createPlaceAgent(mockPlaces[0], preference, copiedModel).rebuttal(attack)).rejects.toThrow("copied the attack claim");
  });

  it("rejects a rebuttal with an invalid binding", async () => {
    const wrongBindingModel: StructuredModel = {
      async invoke(schema, _messages, name) {
        if (name !== "place_rebuttal") throw new Error("Unexpected test call.");
        return schema.parse({ responseToAttackId: "wrong", attackerPoiId: "wrong", claim: "我会基于自己的证据回应距离取舍。", evidenceIds: ["XW_DISTANCE"] });
      },
    };
    const attack = { id: "attack-nanjing-museum-xuanwu-lake", type: "attack" as const, speakerPoiId: "nanjing-museum", targetPoiId: "xuanwu-lake", claim: "对方的路程更长。", evidenceIds: ["XW_DISTANCE"] };
    await expect(createPlaceAgent(mockPlaces[0], preference, wrongBindingModel).rebuttal(attack)).rejects.toThrow("must bind to attack");
  });

  it("rejects unsupported rating or weather claims about fun", async () => {
    const unsafeModel: StructuredModel = {
      async invoke(schema, _messages, name) {
        if (name !== "place_attack") throw new Error("Unexpected test call.");
        return schema.parse({ targetPoiId: "nanjing-museum", claim: "对方评分较低，因此趣味性有保障不了。", evidenceIds: ["NM_RATING"] });
      },
    };
    await expect(createPlaceAgent(mockPlaces[0], preference, unsafeModel).attack([mockPlaces[1]], [])).rejects.toThrow("unsupported evidence inference");
  });
});
