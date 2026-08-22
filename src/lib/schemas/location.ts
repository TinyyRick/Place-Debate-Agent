import { z } from "zod";

export const CoordinatesSchema = z.object({ longitude: z.number().finite(), latitude: z.number().finite() });
export const LocationContextSchema = z.object({
  source: z.enum(["browser", "test"]),
  gpsCoordinates: CoordinatesSchema.optional(),
  amapCoordinates: CoordinatesSchema,
  formattedAddress: z.string().min(1),
  province: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  adcode: z.string().min(1),
});
export const WeatherContextSchema = z.object({
  available: z.boolean(), weather: z.string().optional(), temperatureC: z.number().optional(), humidity: z.number().optional(),
  windDirection: z.string().optional(), windPower: z.string().optional(), reportTime: z.string().optional(),
});
export const RouteModeSchema = z.object({ available: z.boolean(), durationMinutes: z.number().nonnegative().optional(), distanceMeters: z.number().nonnegative().optional() });
export const RouteContextSchema = z.object({ walking: RouteModeSchema, driving: RouteModeSchema });
export type Coordinates = z.infer<typeof CoordinatesSchema>;
export type LocationContext = z.infer<typeof LocationContextSchema>;
export type WeatherContext = z.infer<typeof WeatherContextSchema>;
export type RouteContext = z.infer<typeof RouteContextSchema>;
