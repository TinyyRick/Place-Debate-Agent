import { afterEach, describe, expect, it, vi } from "vitest";
import { retrieveNearbyPois } from "@/lib/amap/places";
import { createSearchPlan } from "@/lib/search/search-plan";

process.env.AMAP_WEB_SERVICE_KEY = "test-key";

afterEach(() => vi.unstubAllGlobals());

describe("AMap search-plan execution", () => {
  it("sends one real around-search request for every indoor exploration category", async () => {
    const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ status: "1", info: "OK", infocode: "10000", pois: [] }));
    });
    vi.stubGlobal("fetch", fakeFetch);
    const plan = createSearchPlan({
      goal: "休闲",
      activityIntensity: "low",
      activityMode: ["indoor_walk"],
      experienceGoal: ["exploration"],
      constraints: ["indoor"],
      avoid: [],
      companion: "solo",
      missingSlots: [],
    });

    await retrieveNearbyPois({ longitude: 118.796877, latitude: 32.060255 }, plan);

    expect(fakeFetch).toHaveBeenCalledTimes(5);
    expect(fakeFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("types"))).toEqual([
      "060100", "140100", "140200", "060000", "140000",
    ]);
  });
});
