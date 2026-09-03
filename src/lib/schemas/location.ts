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
  cityCode: z.string().min(1).optional(),
});
export const WeatherAssessmentSchema = z.object({
  outdoorComfort: z.enum(["comfortable", "warm", "hot", "hot_humid", "rainy", "severe"]),
  temperatureLevel: z.enum(["comfortable", "warm", "hot"]).optional(),
  humidityLevel: z.enum(["normal", "humid"]).optional(),
  rainImpact: z.enum(["none", "rainy", "severe"]),
});
export const WeatherContextSchema = z.object({
  available: z.boolean(), weather: z.string().optional(), temperatureC: z.number().optional(), humidity: z.number().optional(),
  windDirection: z.string().optional(), windPower: z.string().optional(), reportTime: z.string().optional(),
  assessment: WeatherAssessmentSchema.optional(),
});
export const RouteModeSchema = z.object({ available: z.boolean(), durationMinutes: z.number().nonnegative().optional(), distanceMeters: z.number().nonnegative().optional() });
export const TransitRouteSchema = z.object({
  status: z.enum(["available", "no_route", "unavailable"]),
  available: z.boolean(),
  durationMinutes: z.number().nonnegative().optional(),
  walkingDistanceMeters: z.number().nonnegative().optional(),
  transferCount: z.number().int().nonnegative().optional(),
  usesMetro: z.boolean().optional(),
  directMetro: z.boolean().optional(),
  lineNames: z.array(z.string().min(1)).default([]),
});
export const TransitStrategyRoutesSchema = z.object({
  fastest: TransitRouteSchema.optional(),
  leastWalking: TransitRouteSchema.optional(),
  leastTransfers: TransitRouteSchema.optional(),
});
export const RouteContextSchema = z.object({
  walking: RouteModeSchema,
  driving: RouteModeSchema,
  transit: TransitRouteSchema.optional(),
  transitStrategies: TransitStrategyRoutesSchema.optional(),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;
export type LocationContext = z.infer<typeof LocationContextSchema>;
export type WeatherContext = z.infer<typeof WeatherContextSchema>;
export type WeatherAssessment = z.infer<typeof WeatherAssessmentSchema>;
export type RouteContext = z.infer<typeof RouteContextSchema>;
export type TransitRoute = z.infer<typeof TransitRouteSchema>;
export type TransitStrategyRoutes = z.infer<typeof TransitStrategyRoutesSchema>;
