# REFERENCE_IMPLEMENTATIONS.md

# Place Debate Agent — Reference Implementations

This file exists to reduce blind exploration and coding-agent token usage.

Before implementing a difficult subsystem, inspect the relevant reference first.

Use reference implementations to borrow patterns, not entire architectures.

---

## 1. LangChain JavaScript / TypeScript

Official docs:

https://docs.langchain.com/oss/javascript/langchain/overview

Use for:

- model abstraction
- agent creation
- tools
- structured outputs
- prompting
- high-level agent patterns

Key principle for this project:

LangChain handles the behavior of individual agents.

LangGraph handles application-level orchestration.

Do not build the entire debate as a free-form LangChain agent loop.

---

## 1.1 Default Model Provider — DeepSeek

Official integration:

https://docs.langchain.com/oss/javascript/integrations/chat/deepseek

Use:

- `@langchain/deepseek`
- `ChatDeepSeek`
- Zod schemas through `withStructuredOutput()`

Current provider rule:

- DeepSeek is the default and only working model provider for this stage.
- Create chat models through one central factory; do not instantiate `ChatDeepSeek` throughout agent files.
- Default model: `deepseek-v4-flash` with conservative temperature and normal non-thinking operation.
- A future adapter may add a provider, but it must not create a competing runtime implementation now.

Do not use `deepseek-reasoner` for this structured-output workflow.

---

## 2. LangGraph JavaScript / TypeScript

Official overview:

https://docs.langchain.com/oss/javascript/langgraph/overview

Use for:

- StateGraph
- state
- nodes
- edges
- conditional edges
- persistence
- Human-in-the-loop
- durable workflow concepts

This is the primary orchestration reference.

### Project mapping

```text
parseIntent          → graph node
retrievePlaces       → graph node
filterPlaces         → graph node
rankPlaces           → graph node
enrichFactPacks      → graph node
openingRound         → graph node
attackRound          → graph node
userIntervention     → interrupt-capable node
rebuttalRound        → graph node
moderatorSummary     → graph node
```

---

## 3. LangGraph Custom Workflows / Multi-Agent

Official docs:

https://docs.langchain.com/oss/javascript/langchain/multi-agent/custom-workflow

Use for:

- mixing deterministic nodes with agents
- sequential steps
- conditional branching
- custom multi-agent workflows
- controlling agent execution explicitly

This is conceptually the closest official reference for our architecture.

Primary lesson:

Do not let a supervisor agent decide everything when the desired workflow is already known.

---

## 4. LangGraph Human-in-the-loop / Interrupt

Official docs:

https://docs.langchain.com/oss/javascript/langgraph/interrupts

Use for:

- pausing the debate
- asking the user for additional preference information
- resuming graph execution

Project use case:

```text
Attack Round
    ↓
User wants to intervene?
    ↓ yes
interrupt()
    ↓
user preference update
    ↓
resume
    ↓
Rebuttal Round
```

Do not add durable persistence before the basic interrupt flow works.

---

## 5. LangGraph Persistence

Official docs:

https://docs.langchain.com/oss/javascript/langgraph/persistence

Use for:

- checkpointers
- threads
- saved graph state
- durable interrupt/resume

Development:

Use an in-memory/development checkpointer where appropriate.

Portfolio-complete deployment:

Consider Postgres checkpointer only after the core graph is stable.

---

## 6. LangSmith

Official docs:

https://docs.smith.langchain.com/

Also accessible through LangChain documentation.

Use for:

- tracing
- graph execution inspection
- LLM call inspection
- debugging
- evaluation
- latency/token analysis

Important portfolio goal:

Be able to show a trace where the interviewer can see:

```text
parseIntent
retrievePlaces
rankPlaces
enrichFactPacks
openingRound
attackRound
userIntervention
rebuttalRound
moderatorSummary
```

Do not build a custom tracing product during MVP.

---

## 7. Hormuz Agent Sandbox

Repository:

https://github.com/Peakstone-Labs/hormuz-agent-sandbox

Background:

https://peakstone-labs.com/posts/four-nations-four-llms-one-strait

Why it matters:

The project models real-world entities as agents with:

- identity
- goals
- constraints
- shared context
- individual context
- turn-based interaction

This is conceptually useful for Place Agents.

Map:

```text
country agent → place agent
shared geopolitical context → shared user/debate context
country facts → PlaceFactPack
round system → debate rounds
```

Use it to study:

- agent identity/persona
- role-conditioned responses
- round-based multi-agent interaction
- shared vs individual context

Do NOT copy:

- Python backend
- FastAPI
- Vue
- LiteLLM
- full project architecture

Our stack remains Next.js + TypeScript + LangChain/LangGraph.

---

## 8. AMap Official Mobile Geolocation / Route Example

Repository:

https://github.com/amap-demo/web-route-base-on-geolocation-and-placesearch

Use for:

- browser/mobile geolocation flow
- current position
- POI interaction
- route planning workflow
- mobile map experience

Important:

This repository may contain older syntax.

Use it as a workflow reference.

When syntax conflicts with current AMap documentation, follow current official docs.

---

## 9. React AMap Example

Repository:

https://github.com/LiYichong1996/gaode_api_example

Use for:

- React map integration
- current location
- nearby POIs
- map markers
- POI detail
- walking/driving/cycling route concepts
- opening external navigation

Extract patterns only.

Do not copy its whole application architecture.

---

## 10. AMap Current Documentation

### Maps JavaScript API 2.0

https://lbs.amap.com/api/javascript-api-v2/summary

Use for:

- map initialization
- markers
- camera/viewport
- geolocation
- client-side interactions

### POI Search 2.0

https://lbs.amap.com/api/webservice/guide/api-advanced/newpoisearch

Use for:

- nearby POI retrieval
- POI details

### Route Planning 2.0

https://lbs.amap.com/api/webservice/guide/api/newroute

Use for:

- walking
- cycling
- driving
- transit travel-time data

### Weather

https://lbs.amap.com/api/webservice/guide/api/weatherinfo

Use for:

- current weather
- forecast data

### JS API Security

https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode

Read before production deployment or credential changes.

---

## 11. Motion for React

Official docs:

https://motion.dev/docs/react

Use for:

- candidate-card entrance
- active Place Agent emphasis
- attack/rebuttal transitions
- bottom sheet
- map-to-debate transitions
- final result animation

Preferred concepts:

- AnimatePresence
- layout animations
- gestures

Do not implement advanced animation before the functional graph works.

---

## 12. Next.js App Router

Official docs:

https://nextjs.org/docs/app

Use for:

- App Router
- Route Handlers
- Server vs Client Components
- environment variables
- Vercel-friendly architecture

Do not create a separate FastAPI/Express service unless explicitly approved.

---

## 13. Zustand

Official repository/docs:

https://github.com/pmndrs/zustand

Use only for client/UI state.

Do not use Zustand as the LangGraph workflow state store.

---

## 14. Zod

Official site:

https://zod.dev/

Use for:

- UserPreference
- PlaceCandidate
- Evidence
- PlaceFactPack
- debate outputs
- ModeratorResult
- API validation where practical

Do not parse structured model output through regex.

---

## 15. Reference-to-Subsystem Map

| Subsystem | Read first |
|---|---|
| Agent basics | LangChain JS docs |
| StateGraph | LangGraph overview |
| Multi-agent orchestration | LangGraph custom workflow docs |
| Human-in-the-loop | LangGraph interrupts docs |
| Persistence/checkpoints | LangGraph persistence docs |
| Tracing/eval | LangSmith docs |
| Place-agent role design | Hormuz Agent Sandbox |
| Browser geolocation | AMap official mobile example |
| POI retrieval | AMap POI Search docs |
| Map markers | React AMap example |
| Route time | AMap Route Planning docs |
| Weather | AMap Weather docs |
| Motion | Motion docs |
| Next.js API architecture | Next.js App Router docs |

---

## 16. Implementation Rule for Codex

Before implementing a difficult subsystem:

1. identify the subsystem
2. read the matching section of this file
3. inspect the official/reference source
4. extract only the relevant pattern
5. adapt it to the frozen architecture
6. avoid adding new frameworks
7. make the smallest viable patch
8. run tests/typecheck/build

Do not begin with broad web research if a reference above already covers the problem.
