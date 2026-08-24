import { Command, END, MemorySaver, START, StateGraph, isInterrupted } from "@langchain/langgraph";
import { createChatModel, type StructuredModel } from "@/lib/agents/model-factory";
import { DebateResultSchema, type DebateResult } from "@/lib/schemas/debate";
import { createDebateNodes, type ContextDataSource, type PlaceDataSource } from "./nodes";
import { DebateStateSchema } from "./state";

export const DEBATE_GRAPH_NODES = [
  "parseIntent",
  "experiencePlanner",
  "completenessCheck",
  "clarificationInterrupt",
  "createSearchPlan",
  "resolveLocation",
  "retrievePlaces",
  "preExperienceFilter",
  "placeExperienceScorer",
  "filterPlaces",
  "preliminaryRank",
  "candidateQualityCheck",
  "enrichRoutesAndWeather",
  "finalRank",
  "buildFactPacks",
  "openingRound",
  "attackRound",
  "candidateDecisionGate",
  "eliminateCandidate",
  "finalDuel",
  "finalSelection",
  "refreshCandidates",
  "userIntervention",
  "updatePreference",
  "detectMissingEvidence",
  "enrichInterventionEvidence",
  "rerankFinalists",
  "rebuttalRound",
  "moderatorSummary",
] as const;

export function createDebateGraph(
  model: StructuredModel = createChatModel(),
  dataSource?: PlaceDataSource,
  contextDataSource?: ContextDataSource,
  checkpointer = new MemorySaver(),
) {
  const nodes = createDebateNodes(model, dataSource, contextDataSource);

  return new StateGraph(DebateStateSchema)
    .addNode("parseIntent", nodes.parseIntent)
    .addNode("experiencePlanner", nodes.experiencePlanner)
    .addNode("completenessCheck", nodes.completenessCheck)
    .addNode("clarificationInterrupt", nodes.clarificationInterrupt)
    .addNode("createSearchPlan", nodes.createSearchPlan)
    .addNode("resolveLocation", nodes.resolveLocation)
    .addNode("retrievePlaces", nodes.retrievePlaces)
    .addNode("preExperienceFilter", nodes.preExperienceFilter)
    .addNode("placeExperienceScorer", nodes.placeExperienceScorer)
    .addNode("filterPlaces", nodes.filterPlaces)
    .addNode("preliminaryRank", nodes.preliminaryRank)
    .addNode("candidateQualityCheck", nodes.candidateQualityCheck)
    .addNode("enrichRoutesAndWeather", nodes.enrichRoutesAndWeather)
    .addNode("finalRank", nodes.finalRank)
    .addNode("buildFactPacks", nodes.buildFactPacks)
    .addNode("openingRound", nodes.openingRound)
    .addNode("attackRound", nodes.attackRound)
    .addNode("candidateDecisionGate", nodes.candidateDecision)
    .addNode("eliminateCandidate", nodes.eliminateCandidate)
    .addNode("finalDuel", nodes.finalDuel)
    .addNode("finalSelection", nodes.finalSelection)
    .addNode("refreshCandidates", nodes.refreshCandidates)
    .addNode("userIntervention", nodes.userIntervention)
    .addNode("updatePreference", nodes.updatePreference)
    .addNode("detectMissingEvidence", nodes.detectMissingEvidence)
    .addNode("enrichInterventionEvidence", nodes.enrichInterventionEvidence)
    .addNode("rerankFinalists", nodes.rerankFinalists)
    .addNode("rebuttalRound", nodes.rebuttalRound)
    .addNode("moderatorSummary", nodes.moderatorSummary)
    .addEdge(START, "parseIntent")
    .addEdge("parseIntent", "experiencePlanner")
    .addEdge("experiencePlanner", "completenessCheck")
    .addConditionalEdges("completenessCheck", (state) => state.needsClarification ? "clarificationInterrupt" : "createSearchPlan")
    .addEdge("clarificationInterrupt", "experiencePlanner")
    .addEdge("createSearchPlan", "resolveLocation")
    .addEdge("resolveLocation", "retrievePlaces")
    .addEdge("retrievePlaces", "preExperienceFilter")
    .addEdge("preExperienceFilter", "placeExperienceScorer")
    .addEdge("placeExperienceScorer", "filterPlaces")
    .addEdge("filterPlaces", "preliminaryRank")
    .addEdge("preliminaryRank", "candidateQualityCheck")
    .addEdge("candidateQualityCheck", "enrichRoutesAndWeather")
    .addEdge("enrichRoutesAndWeather", "finalRank")
    .addEdge("finalRank", "buildFactPacks")
    // Debate nodes remain available, but are deliberately disconnected while
    // candidate and intent quality are being validated without Debate LLM cost.
    .addEdge("buildFactPacks", END)
    .addEdge("openingRound", "attackRound")
    .addEdge("attackRound", "candidateDecisionGate")
    .addConditionalEdges("candidateDecisionGate", (state) => state.candidateDecision?.actionType === "eliminate_candidate" ? "eliminateCandidate" : "refreshCandidates")
    .addEdge("eliminateCandidate", "finalDuel")
    .addEdge("finalDuel", "finalSelection")
    .addEdge("finalSelection", END)
    .addEdge("refreshCandidates", "preExperienceFilter")
    .addEdge("userIntervention", "updatePreference")
    .addEdge("updatePreference", "detectMissingEvidence")
    .addConditionalEdges("detectMissingEvidence", (state) => state.missingEvidenceTypes.includes("METRO_ACCESS") ? "enrichInterventionEvidence" : "rerankFinalists")
    .addEdge("enrichInterventionEvidence", "rerankFinalists")
    .addEdge("rerankFinalists", "rebuttalRound")
    .addEdge("rebuttalRound", "moderatorSummary")
    .addEdge("moderatorSummary", END)
    .compile({ checkpointer });
}

export type DebateRuntime = { graph: ReturnType<typeof createDebateGraph> };
export type AwaitingDebate = Pick<DebateResult,
  "originalQuery" | "userPreference" | "originalPreference" | "currentPreference" | "intentProfile" | "experienceProfile" | "userIntent" | "searchPlan" | "location" | "weather" | "rawPois" | "amapQueryMetrics" | "preScoringPois" | "experienceScoringMetrics" | "scoredPois" | "filteredPois" | "rankedCandidates" | "selectedCandidates" | "enrichedCandidates" | "factPacks" | "openingMessages" | "attackMessages" | "requiredEvidenceTypes" | "missingEvidenceTypes" | "beforeInterventionScores"
> & { rebuttalMessages: []; interventionText: ""; preferenceDelta?: undefined; moderatorResult?: undefined };
export type AwaitingIntervention = {
  status: "awaiting_clarification";
  threadId: string;
  debate: AwaitingDebate;
  interrupt: unknown;
};

function newThreadId() { return crypto.randomUUID(); }

export async function startDebate(
  originalQuery: string,
  gpsCoordinates?: { longitude: number; latitude: number },
  runtime: DebateRuntime = getServerDebateRuntime(),
): Promise<AwaitingIntervention | { status: "candidates_ready"; threadId: string; debate: DebateResult }> {
  const threadId = newThreadId();
  const output = await runtime.graph.invoke({ originalQuery, gpsCoordinates }, { configurable: { thread_id: threadId } });
  if (!isInterrupted(output)) return { status: "candidates_ready", threadId, debate: DebateResultSchema.parse(output) };
  const debate = output as unknown as AwaitingIntervention["debate"];
  return { status: "awaiting_clarification", threadId, debate, interrupt: output.__interrupt__ };
}

export async function resumeDebate(
  threadId: string,
  action: unknown,
  runtime: DebateRuntime = getServerDebateRuntime(),
): Promise<{ status: "candidates_ready" | "awaiting_clarification"; debate: DebateResult | unknown }> {
  const output = await runtime.graph.invoke(new Command({ resume: action }), { configurable: { thread_id: threadId } });
  if (isInterrupted(output)) return { status: "awaiting_clarification", debate: output };
  return { status: "candidates_ready", debate: DebateResultSchema.parse(output) };
}

let serverRuntime: DebateRuntime | undefined;
export function getServerDebateRuntime(): DebateRuntime {
  serverRuntime ??= { graph: createDebateGraph() };
  return serverRuntime;
}
