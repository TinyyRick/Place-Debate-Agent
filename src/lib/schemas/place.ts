import { z } from "zod";
import { RouteContextSchema, WeatherContextSchema } from "./location";
import { ExperienceProfileSchema } from "./experience";

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["category", "distance", "route_time", "weather", "weather_assessment", "rating", "location", "activity_profile", "metro_access"]),
  value: z.union([z.string(), z.number()]),
  source: z.string().min(1),
  fetchedAt: z.string().optional(),
});

export const DestinationCategorySchema = z.enum([
  "park",
  "attraction",
  "museum",
  "gallery",
  "bookstore",
  "cafe",
  "cinema",
  "fitness",
  "shopping",
  "entertainment",
  "cultural",
  "other",
]);
export const PlaceActivityProfileSchema = z.object({
  indoorOutdoor: z.enum(["indoor", "outdoor", "mixed", "unknown"]),
  movementStyle: z.enum(["mostly_seated", "walk_around", "light_active", "mixed", "unknown"]),
  weatherExposure: z.enum(["low", "medium", "high", "unknown"]),
  activityType: z.string().min(1),
  source: z.literal("derived_category_rule"),
});
export const MetroAccessContextSchema = z.object({
  available: z.boolean(),
  stationName: z.string().min(1).optional(),
  distanceMeters: z.number().nonnegative().optional(),
});
export const FinalistScoreSchema = z.object({ poiId: z.string().min(1), total: z.number().min(0).max(1), dimensions: z.record(z.string(), z.number().min(0).max(1)) });

export const PlaceCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  typeCode: z.string().min(1),
  longitude: z.number().finite(),
  latitude: z.number().finite(),
  address: z.string(),
  distanceMeters: z.number().nonnegative(),
  rating: z.number().min(0).max(5).optional(),
  route: RouteContextSchema.optional(),
  weather: WeatherContextSchema.optional(),
  locationLabel: z.string().optional(),
  parentId: z.string().min(1).optional(),
  childCount: z.number().int().nonnegative().optional(),
  indoorCpid: z.string().min(1).optional(),
  destinationCategory: DestinationCategorySchema.default("other"),
  placeQuality: z.number().min(0).max(1).optional(),
  preliminaryScore: z.number().min(0).max(1).optional(),
  activityProfile: PlaceActivityProfileSchema.optional(),
  experienceProfile: ExperienceProfileSchema.optional(),
  metroAccess: MetroAccessContextSchema.optional(),
});

export const PlaceFactPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  distanceMeters: z.number().nonnegative(),
  travelTimeMinutes: z.number().nonnegative().optional(),
  route: RouteContextSchema.optional(),
  weather: WeatherContextSchema.optional(),
  locationLabel: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  activityProfile: PlaceActivityProfileSchema.optional(),
  metroAccess: MetroAccessContextSchema.optional(),
  evidence: z.array(EvidenceSchema).min(1),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type DestinationCategory = z.infer<typeof DestinationCategorySchema>;
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;
export type PlaceFactPack = z.infer<typeof PlaceFactPackSchema>;
export type PlaceActivityProfile = z.infer<typeof PlaceActivityProfileSchema>;
export type MetroAccessContext = z.infer<typeof MetroAccessContextSchema>;
export type FinalistScore = z.infer<typeof FinalistScoreSchema>;
