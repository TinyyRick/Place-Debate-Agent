import { END, START, StateGraph } from "@langchain/langgraph";
import { createChatModel, type StructuredModel } from "@/lib/agents/model-factory";
import { DebateResultSchema, type DebateResult } from "@/lib/schemas/debate";
import { createDebateNodes, type ContextDataSource, type PlaceDataSource } from "./nodes";
import { DebateStateSchema } from "./state";

export const DEBATE_GRAPH_NODES = [
  "parseIntent",
  "resolveLocation",
  "retrievePlaces",
  "filterPlaces",
  "preliminaryRank",
  "enrichRoutesAndWeather",
  "finalRank",
  "buildFactPacks",
  "openingRound",
  "attackRound",
  "rebuttalRound",
  "moderatorSummary",
] as const;

export function createDebateGraph(
  model: StructuredModel = createChatModel(),
  dataSource?: PlaceDataSource,
  contextDataSource?: ContextDataSource,
) {
  const nodes = createDebateNodes(model, dataSource, contextDataSource);

  return new StateGraph(DebateStateSchema)
    .addNode("parseIntent", nodes.parseIntent)
    .addNode("resolveLocation", nodes.resolveLocation)
    .addNode("retrievePlaces", nodes.retrievePlaces)
    .addNode("filterPlaces", nodes.filterPlaces)
    .addNode("preliminaryRank", nodes.preliminaryRank)
    .addNode("enrichRoutesAndWeather", nodes.enrichRoutesAndWeather)
    .addNode("finalRank", nodes.finalRank)
    .addNode("buildFactPacks", nodes.buildFactPacks)
    .addNode("openingRound", nodes.openingRound)
    .addNode("attackRound", nodes.attackRound)
    .addNode("rebuttalRound", nodes.rebuttalRound)
    .addNode("moderatorSummary", nodes.moderatorSummary)
    .addEdge(START, "parseIntent")
    .addEdge("parseIntent", "resolveLocation")
    .addEdge("resolveLocation", "retrievePlaces")
    .addEdge("retrievePlaces", "filterPlaces")
    .addEdge("filterPlaces", "preliminaryRank")
    .addEdge("preliminaryRank", "enrichRoutesAndWeather")
    .addEdge("enrichRoutesAndWeather", "finalRank")
    .addEdge("finalRank", "buildFactPacks")
    .addEdge("buildFactPacks", "openingRound")
    .addEdge("openingRound", "attackRound")
    .addEdge("attackRound", "rebuttalRound")
    .addEdge("rebuttalRound", "moderatorSummary")
    .addEdge("moderatorSummary", END)
    .compile();
}

export async function runDebate(
  originalQuery: string,
  model?: StructuredModel,
  dataSource?: PlaceDataSource,
  gpsCoordinates?: { longitude: number; latitude: number },
  contextDataSource?: ContextDataSource,
): Promise<DebateResult> {
  const graph = createDebateGraph(model, dataSource, contextDataSource);
  const output = await graph.invoke({ originalQuery, gpsCoordinates });
  return DebateResultSchema.parse(output);
}
