// 偏好字段的中英文对照：界面绝不直接显示字段名或枚举值。
export const FIELD_LABELS: Record<string, string> = {
  activityLevel: "活动量",
  indoorPreference: "室内偏好",
  naturePreference: "自然偏好",
  culturePreference: "文化偏好",
  budgetLevel: "预算",
  companions: "同伴",
  transportPreference: "交通方式",
  movementPreference: "活动方式",
  distanceTolerance: "距离接受度",
  heatTolerance: "耐热程度",
  rainTolerance: "防雨程度",
  freeTextConstraints: "附加要求",
};

const FIELD_VALUE_LABELS: Record<string, Record<string, string>> = {
  activityLevel: { low: "低", medium: "中", high: "高" },
  budgetLevel: { low: "花费少", medium: "适中", flexible: "随意" },
  companions: { solo: "一个人", couple: "情侣", friends: "朋友", family: "家人" },
  transportPreference: { walking: "步行", driving: "驾车", metro: "地铁", flexible: "都可以" },
  movementPreference: { flexible: "随意", mostly_seated: "多坐着", walk_around: "四处走走", light_active: "轻量活动" },
  distanceTolerance: { near: "近处为主", moderate: "中等", flexible_if_transit: "有地铁的话远一点也行" },
};

const GENERIC_VALUE_LABELS: Record<string, string> = { free: "免费" };

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function formatPreferenceValue(field: string, value: string | number | string[]): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join("、") : "（无）";
  if (typeof value === "number") return `${Math.round(value * 100)}%`;
  const mapped = FIELD_VALUE_LABELS[field]?.[value] ?? GENERIC_VALUE_LABELS[value];
  return mapped ?? value;
}
