import { describe, expect, it } from "vitest";
import { RANKING_WEIGHTS } from "@/lib/ranking/config";
import { createFactPacks, hardFilterPois, rankCandidates, selectDiverseCandidates } from "@/lib/ranking/ranker";
import { PlaceCandidateSchema, type PlaceCandidate } from "@/lib/schemas/place";
import type { UserPreference } from "@/lib/schemas/preference";

const preference: UserPreference = {
  activityLevel: "low",
  indoorPreference: 0.6,
  naturePreference: 0.7,
  culturePreference: 0.9,
  budgetLevel: "flexible",
  companions: "solo",
  transportPreference: "flexible",
  heatTolerance: 0.5,
  rainTolerance: 0.5,
  freeTextConstraints: ["有点意思"],
};

function candidate(overrides: Partial<PlaceCandidate> & Pick<PlaceCandidate, "id" | "name" | "category" | "typeCode">): PlaceCandidate {
  return PlaceCandidateSchema.parse({
    longitude: 118.8,
    latitude: 32.06,
    address: "南京",
    distanceMeters: 800,
    ...overrides,
  });
}

describe("destination quality filtering", () => {
  it("filters gateways, parking and utility POIs rather than treating them as destinations", () => {
    const filtered = hardFilterPois([
      candidate({ id: "temple", name: "古鸡鸣寺", category: "风景名胜;旅游景点", typeCode: "110000", rating: 4.6 }),
      candidate({ id: "arch", name: "古鸡鸣寺-牌坊", category: "风景名胜;旅游景点", typeCode: "110000", rating: 4.6 }),
      candidate({ id: "entry", name: "古鸡鸣寺北门", category: "风景名胜;入口", typeCode: "110000" }),
      candidate({ id: "parking", name: "古鸡鸣寺停车场", category: "交通设施服务;停车场", typeCode: "150900" }),
      candidate({ id: "utility", name: "法物流通处", category: "购物服务;购物相关场所", typeCode: "060000" }),
      candidate({ id: "school", name: "北京东路小学", category: "科教文化服务;学校;小学", typeCode: "140000" }),
      candidate({ id: "research", name: "地质研究所", category: "科教文化服务;科教文化场所", typeCode: "140000" }),
      candidate({ id: "museum", name: "南京博物院", category: "科教文化服务;博物馆", typeCode: "140100", rating: 4.8 }),
      candidate({ id: "bookstore", name: "先锋书店", category: "购物服务;专卖店", typeCode: "060000", rating: 4.7 }),
    ]);

    expect(filtered.map((item) => item.id)).toEqual(["temple", "museum", "bookstore"]);
  });

  it("filters compound sub-POI suffixes without rejecting independent gates or historical buildings", () => {
    const filtered = hardFilterPois([
      candidate({ id: "park-gate", name: "午朝门公园-午门(明故宫路)", category: "风景名胜;旅游景点", typeCode: "110000" }),
      candidate({ id: "scenic-entry", name: "某景区-东门", category: "风景名胜;旅游景点", typeCode: "110000" }),
      candidate({ id: "drum-tower", name: "鼓楼", category: "风景名胜;旅游景点", typeCode: "110000" }),
      candidate({ id: "city-gate-ruin", name: "城门遗址", category: "风景名胜;旅游景点", typeCode: "110000" }),
      candidate({ id: "museum", name: "南京博物院", category: "科教文化服务;博物馆", typeCode: "140100" }),
      candidate({ id: "bookstore", name: "先锋书店", category: "购物服务;专卖店", typeCode: "060000" }),
    ]);
    expect(filtered.map((item) => item.id)).toEqual(["drum-tower", "city-gate-ruin", "museum", "bookstore"]);
  });

  it("keeps one best representative when sibling POIs share a parent", () => {
    const filtered = hardFilterPois([
      candidate({ id: "museum-main", name: "南京博物院", category: "科教文化服务;博物馆", typeCode: "140100", rating: 4.8 }),
      candidate({ id: "museum-child-a", name: "南京博物院展厅A", category: "科教文化服务;展览馆", typeCode: "140200", parentId: "museum-main", rating: 4.9 }),
      candidate({ id: "museum-child-b", name: "南京博物院展厅B", category: "科教文化服务;展览馆", typeCode: "140200", parentId: "museum-main", rating: 4.5 }),
      candidate({ id: "park", name: "玄武湖公园", category: "风景名胜;公园广场", typeCode: "110000" }),
      candidate({ id: "bookstore", name: "先锋书店", category: "购物服务;专卖店", typeCode: "060000" }),
    ]);

    expect(filtered.filter((item) => item.id.startsWith("museum-")).map((item) => item.id)).toEqual(["museum-main"]);
    expect(filtered.map((item) => item.id)).not.toContain("museum-child-b");
  });
});

describe("deterministic ranking and diversity", () => {
  it("uses the configured worth-going weights and works when rating is absent", () => {
    expect(Object.values(RANKING_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(1);
    const ranked = rankCandidates(hardFilterPois([
      candidate({ id: "museum", name: "南京博物院", category: "科教文化服务;博物馆", typeCode: "140100" }),
      candidate({ id: "park", name: "玄武湖公园", category: "风景名胜;公园广场", typeCode: "110000", rating: 4.5, distanceMeters: 500 }),
      candidate({ id: "bookstore", name: "先锋书店", category: "购物服务;专卖店", typeCode: "060000", rating: 4.7 }),
    ]), preference);

    expect(ranked.find((item) => item.id === "museum")?.preliminaryScore).toBeTypeOf("number");
    expect(ranked.find((item) => item.id === "museum")?.destinationCategory).toBe("museum");
  });

  it("selects distinct reasonable categories instead of three close siblings", () => {
    const ranked = rankCandidates(hardFilterPois([
      candidate({ id: "museum", name: "南京博物院", category: "科教文化服务;博物馆", typeCode: "140100", rating: 4.8 }),
      candidate({ id: "gallery", name: "南京美术馆", category: "科教文化服务;美术馆", typeCode: "140200", rating: 4.8, distanceMeters: 900 }),
      candidate({ id: "park", name: "玄武湖公园", category: "风景名胜;公园广场", typeCode: "110000", rating: 4.4, distanceMeters: 1_100 }),
      candidate({ id: "bookstore", name: "先锋书店", category: "购物服务;专卖店", typeCode: "060000", rating: 4.7, distanceMeters: 1_300 }),
    ]), preference);

    const selected = selectDiverseCandidates(ranked);
    expect(new Set(selected.map((item) => item.destinationCategory)).size).toBe(3);
    expect(selected).toHaveLength(3);
  });

  it("falls back beyond the preferred radius without ever admitting infrastructure", () => {
    const filtered = hardFilterPois([
      candidate({ id: "museum", name: "南京博物院", category: "科教文化服务;博物馆", typeCode: "140100", distanceMeters: 1_000 }),
      candidate({ id: "park", name: "玄武湖公园", category: "风景名胜;公园广场", typeCode: "110000", distanceMeters: 1_500 }),
      candidate({ id: "far-cafe", name: "远处咖啡馆", category: "餐饮服务;咖啡厅", typeCode: "050000", distanceMeters: 6_500 }),
      candidate({ id: "far-parking", name: "远处停车场", category: "交通设施服务;停车场", typeCode: "150900", distanceMeters: 6_000 }),
    ]);

    expect(filtered.map((item) => item.id)).toEqual(["museum", "park", "far-cafe"]);
  });

  it("creates grounded AMap evidence for the diverse Top 3", () => {
    const [factPack] = createFactPacks(selectDiverseCandidates(rankCandidates(hardFilterPois([
      candidate({ id: "museum", name: "南京博物院", category: "科教文化服务;博物馆", typeCode: "140100", rating: 4.8 }),
      candidate({ id: "park", name: "玄武湖公园", category: "风景名胜;公园广场", typeCode: "110000", rating: 4.5 }),
      candidate({ id: "bookstore", name: "先锋书店", category: "购物服务;专卖店", typeCode: "060000", rating: 4.7 }),
    ]), preference)));

    expect(factPack.evidence.map((evidence) => evidence.id)).toEqual([
      `AMAP_${factPack.id}_CATEGORY`,
      `AMAP_${factPack.id}_DISTANCE`,
      `AMAP_${factPack.id}_RATING`,
    ]);
  });
});
