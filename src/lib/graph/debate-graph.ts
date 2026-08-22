import { END, START, StateGraph } from "@langchain/langgraph";
import { createChatModel, type StructuredModel } from "@/lib/agents/model-factory";
import { DebateResultSchema, type DebateResult } from "@/lib/schemas/debate";
import { createDebateNodes, type PlaceDataSource } from "./nodes";
import { DebateStateSchema } from "./state";

export const DEBATE_GRAPH_NODES = [
  "parseIntent",
  "retrievePlaces",
  "filterPlaces",
  "rankPlaces",
  "enrichFactPacks",
  "openingRound",
  "attackRound",
  "rebuttalRound",
  "moderatorSummary",
] as const;

export function createDebateGraph(
  model: StructuredModel = createChatModel(),
  dataSource?: PlaceDataSource,
) {
  const nodes = createDebateNodes(model, dataSource);

  return new StateGraph(DebateStateSchema)
    .addNode("parseIntent", nodes.parseIntent)
    .addNode("retrievePlaces", nodes.retrievePlaces)
    .addNode("filterPlaces", nodes.filterPlaces)
    .addNode("rankPlaces", nodes.rankPlaces)
    .addNode("enrichFactPacks", nodes.enrichFactPacks)
    .addNode("openingRound", nodes.openingRound)
    .addNode("attackRound", nodes.attackRound)
    .addNode("rebuttalRound", nodes.rebuttalRound)
    .addNode("moderatorSummary", nodes.moderatorSummary)
    .addEdge(START, "parseIntent")
    .addEdge("parseIntent", "retrievePlaces")
    .addEdge("retrievePlaces", "filterPlaces")
    .addEdge("filterPlaces", "rankPlaces")
    .addEdge("rankPlaces", "enrichFactPacks")
    .addEdge("enrichFactPacks", "openingRound")
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
): Promise<DebateResult> {
  const graph = createDebateGraph(model, dataSource);
  const output = await graph.invoke({ originalQuery });
  return DebateResultSchema.parse(output);
}
