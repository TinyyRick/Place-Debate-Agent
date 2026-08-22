import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { DebateMessageSchema, ModeratorResultSchema } from "@/lib/schemas/debate";
import { PlaceFactPackSchema } from "@/lib/schemas/place";
import { UserPreferenceSchema } from "@/lib/schemas/preference";

export const DebateStateSchema = new StateSchema({
  originalQuery: z.string().min(1),
  userPreference: UserPreferenceSchema.optional(),
  factPacks: z.array(PlaceFactPackSchema).default([]),
  openingMessages: z.array(DebateMessageSchema).default([]),
  attackMessages: z.array(DebateMessageSchema).default([]),
  rebuttalMessages: z.array(DebateMessageSchema).default([]),
  moderatorResult: ModeratorResultSchema.optional(),
});

export type DebateState = typeof DebateStateSchema.State;
