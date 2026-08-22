export const QUALITY_FILTER_CONFIG = {
  preferredDistanceMeters: 5_000,
  fallbackDistanceMeters: 8_000,
  sameDestinationDistanceMeters: 250,
  excludedNameTerms: [
    "入口", "出口", "南门", "北门", "东门", "西门", "牌坊", "售票处", "服务台",
    "游客中心", "卫生间", "停车场", "停车区", "法物流通处", "自动售卖机", "ATM",
    "充电站", "公交站", "地铁口", "学校", "小学", "中学", "大学", "研究院", "研究所", "设计院", "培训", "会堂", "礼堂", "办公",
  ],
  excludedCategoryTerms: [
    "停车", "厕所", "公交", "地铁", "加油", "充电", "自动售卖",
    "学校", "研究院", "研究所", "设计院", "培训", "会堂", "礼堂", "办公", "政府机关", "公司企业",
  ],
  subPoiSuffixTerms: ["入口", "出口", "南门", "北门", "东门", "西门", "午门", "检票口", "售票处", "停车场", "停车区"],
} as const;

export const RANKING_WEIGHTS = {
  interestFit: 0.35,
  distance: 0.25,
  activityFit: 0.20,
  placeQuality: 0.15,
  novelty: 0.05,
} as const;

export const FINAL_RANKING_WEIGHTS = {
  interestFit: 0.30,
  travelFit: 0.25,
  activityFit: 0.15,
  weatherFit: 0.15,
  placeQuality: 0.10,
  novelty: 0.05,
} as const;
