import { z } from "zod";

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["category", "distance", "route_time", "weather", "rating"]),
  value: z.union([z.string(), z.number()]),
  source: z.string().min(1),
});

export const PlaceFactPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  distanceMeters: z.number().nonnegative(),
  travelTimeMinutes: z.number().nonnegative(),
  weather: z.string().min(1),
  rating: z.number().min(0).max(5),
  evidence: z.array(EvidenceSchema).min(1),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type PlaceFactPack = z.infer<typeof PlaceFactPackSchema>;
