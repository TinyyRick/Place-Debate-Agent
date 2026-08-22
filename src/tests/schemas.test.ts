import { describe, expect, it } from "vitest";
import { ModeratorResultSchema } from "@/lib/schemas/debate";
import { PlaceFactPackSchema } from "@/lib/schemas/place";
import { mockPlaces } from "@/lib/mock/places";

describe("schemas and fixtures", () => {
  it("validates all mock FactPacks", () => {
    expect(PlaceFactPackSchema.array().parse(mockPlaces)).toHaveLength(3);
  });

  it("keeps evidence IDs globally unique", () => {
    const ids = mockPlaces.flatMap((place) => place.evidence.map((evidence) => evidence.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("validates a ModeratorResult", () => {
    expect(() =>
      ModeratorResultSchema.parse({
        conflictAxes: ["distance"],
        rankingByCurrentFit: [{ poiId: "a", reason: "fit" }],
        tradeoffs: [{ poiId: "a", strengths: ["near"], weaknesses: ["unknown hours"] }],
        recommendationSummary: "Compare the tradeoffs and make the final choice.",
      }),
    ).not.toThrow();
  });
});
