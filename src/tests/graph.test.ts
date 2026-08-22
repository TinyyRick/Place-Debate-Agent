import { describe, expect, it } from "vitest";
import { runDebate } from "@/lib/graph/debate-graph";
import { mockCandidates } from "@/lib/mock/places";
import { deterministicModel } from "./fixtures/deterministic-model";

describe("debate graph", () => {
  it("runs from START through moderatorSummary to END with a mock model", async () => {
    const result = await runDebate("想出去走走，但是不要太累。", deterministicModel, {
      retrievePlaces: async () => mockCandidates,
    });

    expect(result.userPreference.activityLevel).toBe("low");
    expect(result.factPacks).toHaveLength(3);
    expect(result.openingMessages).toHaveLength(3);
    expect(result.attackMessages).toHaveLength(3);
    expect(result.rebuttalMessages).toHaveLength(2);
    expect(result.moderatorResult.rankingByCurrentFit).toHaveLength(3);
  });
});
