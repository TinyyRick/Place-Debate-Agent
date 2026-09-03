import { IntentProfileInterpretationSchema, IntentProfileSchema, type IntentProfile } from "@/lib/schemas/intent";
import { ExperienceProfileSchema, type ExperienceProfile } from "@/lib/schemas/experience";
import { PreferenceDeltaSchema, UserPreferenceSchema, type PreferenceDelta, type UserPreference } from "@/lib/schemas/preference";
import type { StructuredModel } from "./model-factory";
import { z } from "zod";

const PreferenceUpdateSchema = z.object({ updatedPreference: UserPreferenceSchema });

const CLARIFICATION_EXPERIENCE_DIRECTIONS = {
  "商场/商业空间": "commercial_browsing",
  "展览馆/博物馆": "exhibition_exploration",
  "书店/文化空间": "reading_cultural_exploration",
} as const;

const DIRECT_RECOMMEND_ANSWERS = new Set([
  "都可以，直接推荐",
  "室内外都可以，直接推荐",
]);

const EXPLICIT_CATEGORY_TERMS = [
  ["fitness", ["健身房", "健身", "瑜伽", "游泳馆", "运动馆"]],
  ["cafe", ["咖啡馆", "咖啡厅", "咖啡", "cafe"]],
  ["cinema", ["电影院", "影城", "看电影", "电影"]],
  ["bookstore", ["书店", "书局", "书城"]],
  ["museum", ["博物馆", "纪念馆"]],
  ["gallery", ["美术馆", "展览馆", "画廊", "看展"]],
  ["park", ["公园", "绿地", "植物园"]],
  ["shopping", ["商场", "购物中心", "逛街"]],
  ["cultural", ["文化空间", "图书馆", "书院"]],
] as const;

// Concrete destination words that are valid AMap keyword searches but do not
// belong in the project's deliberately small internal category taxonomy.
// This is a guardrail for occasional model omissions, not a second intent
// parser: keep it limited to unambiguous destination nouns.
const EXPLICIT_TARGET_TERMS = ["网吧", "网咖", "电竞馆"] as const;

function explicitTargetFromText(text: string): IntentProfile["explicitTarget"] {
  const normalized = text.toLowerCase();
  const target = EXPLICIT_TARGET_TERMS.find((term) => normalized.includes(term));
  return target ? { text: target, specificity: "specific" } : undefined;
}

function explicitCategoriesFromText(text: string): IntentProfile["mentionedCategories"] {
  const normalized = text.toLowerCase();
  const explicitlyAvoided = {
    cafe: /不.*咖啡/.test(normalized),
    cinema: /不.*电影/.test(normalized),
  } as const;
  return EXPLICIT_CATEGORY_TERMS.flatMap(([category, terms]) =>
    terms.some((term) => normalized.includes(term)) && !explicitlyAvoided[category as keyof typeof explicitlyAvoided]
      ? [category]
      : [],
  ) as IntentProfile["mentionedCategories"];
}

function normalizeMentionedCategories(profile: IntentProfile, text: string): IntentProfile {
  const normalizedText = text.toLowerCase();
  const cafeAvoided = profile.avoid.includes("cafe") || /不.*咖啡/.test(normalizedText);
  const cinemaAvoided = profile.avoid.includes("cinema") || /不.*电影/.test(normalizedText);
  // This field is a hard retrieval constraint. Keep only categories that can
  // be verified directly in the user's own wording; model inferences belong
  // to the non-strict experience fallback instead.
  const mentionedCategories = explicitCategoriesFromText(text).filter((category) =>
    !(category === "cafe" && cafeAvoided) && !(category === "cinema" && cinemaAvoided),
  );
  const casualBrowsing = /随便逛逛|随便走走/.test(normalizedText);
  const restDirectionResolved = [
    "室内坐着休息",
    "室内轻松走走/逛逛",
    "户外阴凉处休息",
    "室内外都可以，直接推荐",
  ].some((answer) => normalizedText.includes(answer));
  const ambiguousRestDirection = !restDirectionResolved
    && !mentionedCategories.length
    && ["坐坐", "坐会儿", "坐一会儿", "休息的地方", "可以休息", "歇会儿", "歇一会儿"].some((phrase) => normalizedText.includes(phrase));
  const explicitTarget = profile.explicitTarget?.specificity === "specific"
    ? profile.explicitTarget
    : explicitTargetFromText(text) ?? profile.explicitTarget;
  const hasSpecificTarget = explicitTarget?.specificity === "specific";
  return IntentProfileSchema.parse({
    ...profile,
    mentionedCategories,
    explicitTarget,
    // A user who has explicitly named a destination category has supplied the
    // direction needed for retrieval; never ask the generic activity question.
    missingSlots: profile.missingSlots.filter((slot) =>
      !((mentionedCategories.length || hasSpecificTarget) && slot === "activity_type")
      && !(casualBrowsing && slot === "experience_type"),
    ).concat(ambiguousRestDirection && !hasSpecificTarget && !profile.missingSlots.includes("activity_type") ? ["activity_type"] : []),
  });
}

function appendUnique(values: string[], value: string) {
  return values.includes(value) ? values : [...values.slice(-5), value];
}

/**
 * A clarification button is an explicit user choice, not a suggestion for the
 * model to optionally infer. Preserve it in the intent before retrieval.
 */
function applyClarificationDirection(
  interpretation: { intentProfile: IntentProfile; experienceProfile: ExperienceProfile },
  answer: string,
) {
  const direction = CLARIFICATION_EXPERIENCE_DIRECTIONS[answer as keyof typeof CLARIFICATION_EXPERIENCE_DIRECTIONS];
  const isIndoorSeatedRest = answer === "室内坐着休息";
  const isIndoorBrowsing = answer === "室内轻松走走/逛逛";
  const isOutdoorShadedRest = answer === "户外阴凉处休息";
  const isIndoor = answer === "优先室内运动" || isIndoorSeatedRest || isIndoorBrowsing;
  const isOutdoor = answer === "优先户外运动" || isOutdoorShadedRest;
  const resolvesRestExperience = isIndoorSeatedRest || isIndoorBrowsing || isOutdoorShadedRest || DIRECT_RECOMMEND_ANSWERS.has(answer);
  const shouldResolveActivity = isIndoor || isOutdoor || DIRECT_RECOMMEND_ANSWERS.has(answer);
  if (!direction && !shouldResolveActivity) return interpretation;
  if (!direction) {
    return {
      intentProfile: IntentProfileSchema.parse({
        ...interpretation.intentProfile,
        // These fixed buttons describe a broad experience direction. The LLM
        // may echo their label as a "specific" target, which would make AMap
        // search for the literal sentence instead of the intended categories.
        explicitTarget: undefined,
        constraints: isIndoor
          ? appendUnique(interpretation.intentProfile.constraints, "indoor")
          : isOutdoor
            ? appendUnique(interpretation.intentProfile.constraints, "outdoor")
            : interpretation.intentProfile.constraints,
        activityMode: isIndoorSeatedRest || isOutdoorShadedRest
          ? appendUnique(interpretation.intentProfile.activityMode, "seated_rest")
          : isIndoorBrowsing
            ? appendUnique(interpretation.intentProfile.activityMode, "light_browsing")
            : interpretation.intentProfile.activityMode,
        experienceGoal: isIndoorSeatedRest || isOutdoorShadedRest
          ? appendUnique(interpretation.intentProfile.experienceGoal, "rest")
          : isIndoorBrowsing
            ? appendUnique(interpretation.intentProfile.experienceGoal, "exploration")
            : interpretation.intentProfile.experienceGoal,
        missingSlots: interpretation.intentProfile.missingSlots.filter((slot) =>
          slot !== "activity_type" && !(resolvesRestExperience && slot === "experience_type"),
        ),
      }),
      experienceProfile: ExperienceProfileSchema.parse({
        ...interpretation.experienceProfile,
        ...(isIndoor ? { spatial: "indoor" as const } : isOutdoor ? { spatial: "outdoor" as const } : {}),
        ...(isIndoorSeatedRest || isOutdoorShadedRest ? { engagementType: "rest" as const } : {}),
        ...(isIndoorBrowsing ? { engagementType: "exploration" as const } : {}),
      }),
    };
  }
  return {
    intentProfile: IntentProfileSchema.parse({
      ...interpretation.intentProfile,
      explicitTarget: undefined,
      experienceGoal: appendUnique(interpretation.intentProfile.experienceGoal, direction),
      constraints: appendUnique(interpretation.intentProfile.constraints, "indoor"),
      missingSlots: interpretation.intentProfile.missingSlots.filter((slot) => slot !== "experience_type"),
    }),
    experienceProfile: ExperienceProfileSchema.parse({
      ...interpretation.experienceProfile,
      engagementType: "exploration",
      spatial: "indoor",
    }),
  };
}

export async function interpretIntent(
  originalQuery: string,
  model: StructuredModel,
): Promise<{ intentProfile: IntentProfile; preference: UserPreference; experienceProfile: ExperienceProfile }> {
  const interpretation = await model.invoke(
    IntentProfileInterpretationSchema,
    [
      {
        role: "system",
        content:
          "你是地点决策助手的 Intent Extractor。只提取用户已经表达的需求，输出 intentProfile、preference 和 experienceProfile。intentProfile 的 goal、activityIntensity、activityMode、experienceGoal、constraints、avoid、companion、budget 都描述用户想获得的体验与限制；不得填写任何 POI 类型、搜索关键词或推荐方案。用户明确说出具体目的地或活动（例如羽毛球馆、游泳、攀岩、网吧、网咖、电竞馆、电影院、咖啡馆）时，必须原样提炼到 explicitTarget.text，并令 specificity=specific；宽泛的“运动一下”“出去玩玩”只能是 specificity=broad。明确目标存在时不得再用 activity_type 追问；例如“想找个网吧坐坐”的目标是网吧，“坐坐”只是体验补充，不能触发通用休息追问。mentionedCategories 只记录用户明确提到的内部地点类别：park、museum、gallery、bookstore、cafe、cinema、fitness、shopping、cultural；例如健身房→fitness、咖啡馆→cafe、电影院/看电影→cinema。没有明确提到这些类别时必须为空数组，绝不能凭偏好猜测。experienceProfile 必须用固定七维体验向量描述用户，不得使用地点类别。用户说一个人时 companion=solo 且 experienceProfile.socialFit=solo；说不花钱/免费时 budget=free 且 costTier=free。没有明确说出时 intentProfile 中必须省略 companion 和 budget，禁止输出空字符串；preference.companions 使用 solo 作为保守默认，禁止输出 flexible 或空字符串。engagementType=rest 专指安静坐会儿、休息、放松、低刺激停留等非任务性的恢复体验；这不是 consumption，也不是 functional。functional 只用于学习、办事、锻炼等有明确任务的活动。低强度不等于久坐：若用户说“不想太累”且同时表达“有点意思/探索/体验”，activityMode 应包含 light_exploration，experienceGoal 应包含 exploration，而不是 mostly_seated；对应的 experienceProfile.engagementType 应为 exploration。missingSlots 只能从 experience_type、activity_type、companion、budget、time、transport 中选择。默认空数组：不要因为缺少时间、预算、交通而要求澄清。只有用户目标有多个会导致完全不同推荐方向的解释时才使用 experience_type（例如“室内逛逛”“出去玩玩”）；用户只表达宽泛活动、没有具体项目时才使用 activity_type（例如“想运动”“想找地方坐坐”）。",
      },
      { role: "user", content: originalQuery },
    ],
    "intent_profile",
  );
  return {
    intentProfile: normalizeMentionedCategories(interpretation.intentProfile, originalQuery),
    preference: UserPreferenceSchema.parse(interpretation.preference),
    experienceProfile: interpretation.experienceProfile,
  };
}

export async function updateIntentFromClarification(originalQuery: string, previousProfile: IntentProfile, answer: string, model: StructuredModel) {
  const interpretation = await model.invoke(IntentProfileInterpretationSchema, [
    { role: "system", content: "你是地点决策助手的 Intent Extractor。根据原始需求与用户的澄清，更新 intentProfile、preference 和 experienceProfile；只保留用户说过的信息。若用户自由填写了具体活动或场所，必须把核心原词写入 explicitTarget.text，令 specificity=specific，并移除 activity_type；若用户选择室内、户外或直接推荐，只更新对应约束并移除已回答的 missingSlots。不要输出 POI typecode、搜索词或推荐。" },
    { role: "user", content: `原始需求：${originalQuery}\n当前 IntentProfile：${JSON.stringify(previousProfile)}\n用户澄清：${answer}` },
  ], "intent_profile_update");
  const clarified = applyClarificationDirection(interpretation, answer);
  return {
    intentProfile: normalizeMentionedCategories(clarified.intentProfile, `${originalQuery} ${answer}`),
    preference: UserPreferenceSchema.parse(interpretation.preference),
    experienceProfile: clarified.experienceProfile,
  };
}

function sameValue(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }

export async function updatePreferenceFromIntervention(
  previousPreference: UserPreference,
  interventionText: string,
  model: StructuredModel,
): Promise<{ updatedPreference: UserPreference; preferenceDelta: PreferenceDelta }> {
  if (!interventionText.trim()) {
    return { updatedPreference: previousPreference, preferenceDelta: PreferenceDeltaSchema.parse({ interventionText: "", changedFields: [] }) };
  }
  const { updatedPreference } = await model.invoke(
    PreferenceUpdateSchema,
    [
      { role: "system", content: "你是地点决策助手的偏好更新器。只更新用户这次补充明确改变的字段；其余字段必须与 previousPreference 完全一致。不得从地点事实推断偏好。" },
      { role: "user", content: `previousPreference: ${JSON.stringify(previousPreference)}\ninterventionText: ${interventionText}` },
    ],
    "preference_update",
  );
  // Explicit user phrases are deterministic guardrails over the structured model output.
  const explicit = { ...updatedPreference };
  if (interventionText.includes("室内")) explicit.indoorPreference = Math.max(explicit.indoorPreference, 0.9);
  if (interventionText.includes("不想去坐着不动")) explicit.movementPreference = "walk_around";
  if (interventionText.includes("地铁附近")) explicit.transportPreference = "metro";
  if (interventionText.includes("稍微远一点")) explicit.distanceTolerance = "flexible_if_transit";
  const normalizedPreference = UserPreferenceSchema.parse(explicit);
  const changedFields = (Object.keys(previousPreference) as Array<keyof UserPreference>).flatMap((field) => {
    const before = previousPreference[field];
    const after = normalizedPreference[field];
    return sameValue(before, after) ? [] : [{ field, before, after }];
  });
  return {
    updatedPreference: normalizedPreference,
    preferenceDelta: PreferenceDeltaSchema.parse({ interventionText, changedFields }),
  };
}
