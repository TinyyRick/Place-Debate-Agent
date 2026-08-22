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
});
