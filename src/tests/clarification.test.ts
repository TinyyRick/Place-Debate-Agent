import { describe, expect, it } from "vitest";
import { coreClarificationSlots } from "@/lib/graph/nodes";

describe("core clarification routing", () => {
  it("does not interrupt only for optional time, budget, transport, or companion details", () => {
    expect(coreClarificationSlots(["time", "budget", "transport", "companion"])).toEqual([]);
  });

  it("keeps only recommendation-direction uncertainty", () => {
    expect(coreClarificationSlots(["time", "experience_type", "activity_type"])).toEqual(["experience_type", "activity_type"]);
  });
});
