// 与网页端后端接口的结构化子集类型：只声明界面用到的字段。

export type DebateMessage = {
  id: string;
  type: "opening" | "attack" | "rebuttal";
  speakerPoiId: string;
  targetPoiId?: string;
  attackerPoiId?: string;
  claim: string;
  evidenceIds: string[];
};

export type FactPack = {
  id: string;
  name: string;
  category: string;
  distanceMeters: number;
  rating?: number;
  averageCostYuan?: number;
  imageUrl?: string;
  route?: {
    walking?: { durationMinutes?: number };
    driving?: { durationMinutes?: number };
    transit?: {
      status: string;
      usesMetro: boolean;
      directMetro?: boolean;
      transferCount?: number;
      durationMinutes?: number;
      walkingDistanceMeters?: number;
      lineNames: string[];
    };
  };
};

export type PreferenceChange = {
  field: string;
  before: string | number | string[];
  after: string | number | string[];
};

export type PreferenceDelta = {
  interventionText: string;
  changedFields: PreferenceChange[];
};

export type DebateResult = {
  factPacks: FactPack[];
  openingMessages: DebateMessage[];
  attackMessages: DebateMessage[];
  rebuttalMessages: DebateMessage[];
  finalDuelMessages: DebateMessage[];
  survivingCandidateIds: string[];
  eliminatedPoiIds: string[];
  selectedPoiId?: string;
  interventionText: string;
  preferenceDelta?: PreferenceDelta;
  afterInterventionScores?: { poiId: string; total: number }[];
  location: { formattedAddress: string };
  weather: { available: boolean; temperatureC?: number | null; weather?: string | null };
  intentProfile?: {
    goal: string;
    activityIntensity: string;
    constraints: string[];
    avoid: string[];
  };
  experienceProfile?: {
    engagementType: string;
    socialFit: string;
    spatial: string;
    costTier: string;
  };
};

export type AwaitingStatus = "awaiting_clarification" | "awaiting_final_selection" | "awaiting_candidate_decision";

export type AwaitingIntervention = {
  status: AwaitingStatus;
  threadId: string;
  debate: DebateResult;
  interrupt: { value?: { question?: string; options?: string[] } }[];
};
