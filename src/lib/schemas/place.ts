import { z } from "zod";
import { RouteContextSchema, WeatherContextSchema } from "./location";

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["category", "distance", "route_time", "weather", "rating", "location"]),
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
  "shopping",
  "entertainment",
  "cultural",
  "other",
]);

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
  evidence: z.array(EvidenceSchema).min(1),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type DestinationCategory = z.infer<typeof DestinationCategorySchema>;
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;
export type PlaceFactPack = z.infer<typeof PlaceFactPackSchema>;
