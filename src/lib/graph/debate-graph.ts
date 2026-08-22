import { END, START, StateGraph } from "@langchain/langgraph";
import { createChatModel, type StructuredModel } from "@/lib/agents/model-factory";
import { DebateResultSchema, type DebateResult } from "@/lib/schemas/debate";
import { createDebateNodes } from "./nodes";
import { DebateStateSchema } from "./state";

export const DEBATE_GRAPH_NODES = [
  "parseIntent",
  "loadMockPlaces",
  "openingRound",
  "attackRound",
  "rebuttalRound",
  "moderatorSummary",
] as const;

export function createDebateGraph(model: StructuredModel = createChatModel()) {
  const nodes = createDebateNodes(model);

  return new StateGraph(DebateStateSchema)
    .addNode("parseIntent", nodes.parseIntent)
    .addNode("loadMockPlaces", nodes.loadMockPlaces)
    .addNode("openingRound", nodes.openingRound)
    .addNode("attackRound", nodes.attackRound)
    .addNode("rebuttalRound", nodes.rebuttalRound)
    .addNode("moderatorSummary", nodes.moderatorSummary)
    .addEdge(START, "parseIntent")
    .addEdge("parseIntent", "loadMockPlaces")
    .addEdge("loadMockPlaces", "openingRound")
    .addEdge("openingRound", "attackRound")
    .addEdge("attackRound", "rebuttalRound")
    .addEdge("rebuttalRound", "moderatorSummary")
    .addEdge("moderatorSummary", END)
    .compile();
}

export async function runDebate(
  originalQuery: string,
  model?: StructuredModel,
): Promise<DebateResult> {
  const graph = createDebateGraph(model);
  const output = await graph.invoke({ originalQuery });
  return DebateResultSchema.parse(output);
}
