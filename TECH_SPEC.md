# TECH_SPEC.md

# Place Debate Agent — Technical Specification

## 1. Product Goal

Build a mobile-first web application that helps users decide where to go nearby when they do not already have a clear destination.

Core experience:

1. User shares current location and a natural-language preference.
2. System retrieves nearby real-world POIs.
3. System filters and ranks candidates.
4. Top 3 places are converted into dynamic Place Agents.
5. Place Agents debate why they are the best fit for the user.
6. User may intervene during the debate and update preferences.
7. A neutral Moderator summarizes trade-offs.
8. User makes the final decision and opens navigation.

The product is an AI-assisted place decision system, not an autonomous travel planner.

---

## 2. MVP Scope

### In scope

- Mobile-first responsive web app
- Browser geolocation
- Real nearby POI search
- Candidate filtering and deterministic ranking
- Route/travel-time lookup
- Weather lookup
- Natural-language preference parsing
- Dynamic Place Agent creation
- Structured 3-place debate
- Opening / Attack / Rebuttal rounds
- Human-in-the-loop user intervention
- Moderator summary
- Evidence-grounded claims
- Final user choice
- AMap navigation handoff
- LangGraph state orchestration
- LangSmith tracing
- Basic evaluation suite
- Vercel deployment

### Out of scope for MVP

- Native iOS / Android
- User authentication
- Social feed
- Payment
- RAG
- Vector database
- MCP
- Voice interaction
- Multi-day trip planning
- Large-scale recommendation infrastructure
- Personalized long-term recommender model

---

## 3. Frozen Technology Stack

### Application

- Next.js App Router
- TypeScript
- React
- Node.js 22+
- Tailwind CSS v4

### UI / Interaction

- Motion for React
- Lucide React
- Mobile-first responsive layout
- Primary Figma frame: 390 × 844

### Client State

- Zustand

### Real-world Data

- AMap Maps JavaScript API 2.0
- @amap/amap-jsapi-loader
- AMap Web Service POI Search 2.0
- AMap Route Planning 2.0
- AMap Weather API

### LLM / Agent Stack

- DeepSeek as the default model provider
- @langchain/deepseek (`ChatDeepSeek`)
- langchain
- @langchain/core
- @langchain/langgraph
- Zod

### Agent Observability

- LangSmith tracing
- LangSmith evaluation where useful

### Persistence

Development:
- LangGraph in-memory checkpointer / MemorySaver-compatible development checkpointer

Portfolio deployment:
- Start without durable persistence if required for speed
- Add Postgres-backed LangGraph checkpointer only when Human-in-the-loop resume across requests/devices becomes necessary

Preferred optional provider:
- Neon Postgres or Supabase Postgres

### Testing

- Vitest
- Deterministic fixtures
- Agent evaluation scenarios

### Deployment

- Vercel

---

## 4. Architecture Philosophy

The system MUST use a hybrid deterministic + agentic workflow.

AI is responsible for:
- understanding soft user preferences
- producing persuasive grounded language
- responding to competitors
- summarizing trade-offs

Application code / LangGraph is responsible for:
- execution order
- graph state
- conditional branches
- debate round transitions
- candidate retrieval
- candidate ranking
- evidence storage
- interruption and resume flow

Do not let a free-form supervisor agent control the entire application.

---

## 5. High-level Architecture

```text
USER
  │
  ▼
Intent Parsing Node
  │
  ▼
UserPreference
  │
  ▼
Retrieve POIs Node
  │
  ▼
Hard Filter Node
  │
  ▼
Deterministic Ranking Node
  │
  ▼
Top 3 Candidates
  │
  ▼
Fact Enrichment Node
  ├── Route
  ├── Weather
  └── POI Details
  │
  ▼
PlaceFactPacks
  │
  ▼
Opening Round
  ├── Place Agent A
  ├── Place Agent B
  └── Place Agent C
  │
  ▼
Attack Round
  │
  ▼
Conditional User Intervention
  ├── no → Rebuttal
  └── yes → LangGraph interrupt → preference delta → resume
  │
  ▼
Rebuttal Round
  │
  ▼
Moderator
  │
  ▼
Final Trade-off Summary
  │
  ▼
USER DECISION
```

---

## 6. LangChain Responsibilities

LangChain is the high-level agent layer.

Use LangChain for:

- model integration
- agent creation
- tool definitions where an agent genuinely needs a tool
- prompts
- structured model outputs
- dynamic Place Agent construction

### Required Agent Types

1. Intent Interpreter
2. Dynamic Place Agents × 3
3. Moderator Agent

Do not create separate source files for physical places.

Correct:

```text
createPlaceAgent(factPack, userPreference)
```

Incorrect:

```text
xuanwu-agent.ts
museum-agent.ts
bookstore-agent.ts
```

Real candidates depend on user location and must be instantiated dynamically.

---

## 7. LangGraph Responsibilities

LangGraph is the workflow orchestration layer.

Use a StateGraph-based workflow.

### Required graph concepts

- shared graph state
- nodes
- edges
- conditional edges
- parallelizable work where useful
- interrupt/resume for Human-in-the-loop
- checkpointer when durable pause/resume is enabled

### Proposed graph

```text
START
  ↓
parseIntent
  ↓
retrievePlaces
  ↓
filterPlaces
  ↓
rankPlaces
  ↓
enrichFactPacks
  ↓
openingRound
  ↓
attackRound
  ↓
shouldInterruptUser?
  ├── false → rebuttalRound
  └── true  → userIntervention
                    ↓
               interrupt()
                    ↓
             preferenceDelta
                    ↓
               rebuttalRound
  ↓
moderatorSummary
  ↓
END
```

### Non-negotiable rule

The graph controls *when* agents act.

Agents control *what they say*.

Do not create a free-running multi-agent chat room.

---

## 8. LangGraph State

Create one central state schema.

Suggested fields:

```text
sessionId
threadId

originalQuery
location
currentTime

userPreference
preferenceHistory

rawPois
filteredPois
rankedCandidates

factPacks

openingMessages
attackMessages
rebuttalMessages

currentRound
activeSpeakerId

userInterventions

moderatorResult
selectedPoiId

errors
telemetry
```

The state should remain serializable.

Avoid storing non-serializable SDK clients inside graph state.

---

## 9. Core Data Models

### UserPreference

Suggested fields:

- durationMinutes
- activityLevel: low | medium | high
- indoorPreference: number 0..1
- naturePreference: number 0..1
- culturePreference: number 0..1
- foodPreference: number 0..1
- shoppingPreference: number 0..1
- budgetLevel: low | medium | flexible
- companions: solo | couple | friends | family
- returnBefore?: string
- heatTolerance: number 0..1
- rainTolerance: number 0..1
- freeTextConstraints: string[]

All model outputs consumed by code must be schema validated.

### PlaceCandidate

Suggested fields:

- id
- name
- category
- longitude
- latitude
- address
- rating?
- openingStatus?
- photos?
- distanceMeters
- preliminaryScore

### Evidence

Suggested fields:

- id
- type
- value
- source
- sourceLabel
- fetchedAt
- metadata

Possible types:

- distance
- route_time
- weather
- rating
- opening_status
- category
- price
- poi_detail

### PlaceFactPack

Suggested fields:

- place
- route
- weather
- openingStatus
- userFit
- evidence[]

### DebateMessage

Suggested fields:

- id
- round
- type: opening | attack | rebuttal | moderator
- speakerPoiId
- targetPoiId?
- claim
- evidenceIds[]
- createdAt

### ModeratorResult

Suggested fields:

- conflictAxes
- rankingByCurrentFit
- tradeoffs
- recommendationSummary
- uncertaintyNotes

---

## 10. Grounded Debate

Place Agents must only make factual claims grounded in supplied evidence.

Every factual claim should reference evidence IDs where applicable.

Agents must not fabricate:

- opening hours
- ticket prices
- current events
- route duration
- distance
- rating
- weather
- facilities
- crowd level
- reservation requirements

If a fact is missing, the agent should not guess.

Example structured claim:

```json
{
  "claim": "今天的高温可能降低户外长时间步行的舒适度。",
  "evidenceIds": ["E_WEATHER_01"]
}
```

---

## 11. Candidate Retrieval and Ranking

Do not ask an LLM to directly select Top 3 from raw nearby POIs without deterministic preprocessing.

### Stage 1 — Retrieval

Retrieve approximately 20–30 POIs based on:

- current coordinates
- radius
- allowed categories

### Stage 2 — Hard Filtering

Remove candidates that are:

- closed when opening status is known
- obviously outside the time window
- too far away
- duplicate / near duplicate
- clearly incompatible with required category constraints

### Stage 3 — Deterministic Scoring

Suggested dimensions:

- distanceScore
- travelTimeScore
- activityFitScore
- weatherFitScore
- durationFitScore
- interestFitScore
- ratingScore
- noveltyScore

Weights should live in configuration, not UI code.

### Stage 4 — Top 3

Only after deterministic ranking should candidates become Place Agents.

---

## 12. Fact Enrichment

For each Top 3 candidate, build a PlaceFactPack.

Use real-world sources for:

- route / travel time
- current weather
- opening status where available
- POI category
- rating
- address
- distance

Do not repeatedly call AMap from every debate turn.

Fetch/enrich facts once, store evidence, and let Place Agents query/use the FactPack.

---

## 13. Debate Protocol

### Round 1 — Opening

Run the three Place Agents independently.

Each returns:

- persuasive pitch
- strongest fit dimension
- evidenceIds

Target Chinese length:
60–120 Chinese characters.

Parallel execution is preferred.

### Round 2 — Attack

Each Place Agent receives:

- own FactPack
- competitor FactPacks
- current UserPreference
- opening messages

Each must:

1. select one competitor
2. identify one concrete weakness
3. ground the critique in evidence

Output:

- targetPoiId
- claim
- evidenceIds

### User Intervention

User may add new information.

Example:

```text
其实我不怕热，我更想看自然景色。
```

Graph behavior:

1. pause at an interrupt-capable node
2. capture user input
3. parse preference delta
4. update graph state
5. resume from the workflow
6. do not restart retrieval unless the new preference invalidates candidate selection

### Round 3 — Rebuttal

Each attacked Place Agent receives:

- relevant attack
- updated preference
- own FactPack

Respond only to relevant criticism.

### Moderator

Moderator is neutral.

It should return:

- key conflict axes
- current fit ranking
- trade-offs
- uncertainty
- concise recommendation summary

The final choice remains with the user.

---

## 14. Human-in-the-loop

Use LangGraph interrupt/resume for the portfolio-complete version.

Development strategy:

### Phase A

Implement the graph without durable interruption first.

### Phase B

Add interrupt-based user intervention.

### Phase C

Add durable checkpointer only if cross-request resume is required.

Do not introduce Postgres before the core debate graph works.

---

## 15. LangSmith

Enable tracing from the beginning once environment variables are available.

Trace important spans/nodes:

- parseIntent
- retrievePlaces
- rankPlaces
- enrichFactPacks
- openingRound
- attackRound
- userIntervention
- rebuttalRound
- moderatorSummary

Use LangSmith later for evaluation of:

- preference alignment
- evidence validity
- hallucination rate
- debate diversity
- intervention sensitivity
- latency
- token usage

Tracing is part of the portfolio story, not decorative infrastructure.

---

## 16. AMap Integration

### Client-side

Use AMap JavaScript API for:

- map rendering
- current position display
- markers
- selected candidate visualization
- map camera transitions

### Server-side

Use AMap Web Service APIs for:

- nearby POI retrieval
- route planning
- weather
- POI enrichment where needed

### Security

Server-only secrets must never reach the browser.

Expected environment variables:

```text
DEEPSEEK_API_KEY
DEEPSEEK_MODEL
LANGSMITH_API_KEY
LANGSMITH_TRACING
LANGSMITH_PROJECT

AMAP_WEB_SERVICE_KEY
NEXT_PUBLIC_AMAP_JS_KEY
AMAP_JS_SECURITY_CODE
```

Do not commit real values.

---

## 17. API / Server Boundaries

Recommended Next.js Route Handlers:

```text
POST /api/intent
POST /api/places
POST /api/debate/start
POST /api/debate/resume
POST /api/debate/result
```

Alternative:
the graph may later be exposed through one consolidated debate endpoint if that simplifies state management.

Do not create a second Python/FastAPI backend.

---

## 18. Client State

Use Zustand only for UI/application view state.

Suggested fields:

- currentScene
- location
- userQuery
- candidateCards
- activeCandidate
- activeSpeaker
- debateRound
- visibleMessages
- interventionDraft
- selectedPlace
- loadingState
- errorState

LangGraph workflow state is not a replacement for UI state.

UI state is not a replacement for LangGraph workflow state.

Keep them separate.

---

## 19. UI Scenes

Primary design frame:

```text
390 × 844
```

Required screens:

```text
01-Home
02-Discovery
03-Candidates
04-Debate-Opening
04-Debate-Attack
04-Debate-Rebuttal
04-Debate-Intervention
05-Result
```

Responsive targets should include approximately:

- 375 × 812
- 390 × 844
- 393 × 852
- 430 × 932

Do not design desktop-first.

---

## 20. Streaming

Streaming is not required for the first working graph.

### V1

Return complete debate turns.

### V2

Add progressive UI events such as:

- GRAPH_STARTED
- NODE_STARTED
- PLACE_AGENT_STARTED
- PLACE_AGENT_FINISHED
- EVIDENCE_USED
- ROUND_FINISHED
- USER_INPUT_REQUIRED
- GRAPH_FINISHED

Token-by-token streaming is UX polish, not a core architectural dependency.

---

## 21. Suggested Source Layout

```text
src/
├── app/
│   ├── page.tsx
│   └── api/
│       ├── intent/
│       │   └── route.ts
│       ├── places/
│       │   └── route.ts
│       └── debate/
│           ├── start/
│           │   └── route.ts
│           ├── resume/
│           │   └── route.ts
│           └── result/
│               └── route.ts
│
├── components/
│   ├── map/
│   ├── discovery/
│   ├── candidates/
│   ├── debate/
│   └── result/
│
├── lib/
│   ├── agents/
│   │   ├── intent-agent.ts
│   │   ├── place-agent-factory.ts
│   │   ├── moderator-agent.ts
│   │   └── prompts/
│   │
│   ├── graph/
│   │   ├── debate-graph.ts
│   │   ├── state.ts
│   │   ├── nodes/
│   │   │   ├── parse-intent.ts
│   │   │   ├── retrieve-places.ts
│   │   │   ├── filter-places.ts
│   │   │   ├── rank-places.ts
│   │   │   ├── enrich-fact-packs.ts
│   │   │   ├── opening-round.ts
│   │   │   ├── attack-round.ts
│   │   │   ├── user-intervention.ts
│   │   │   ├── rebuttal-round.ts
│   │   │   └── moderator-summary.ts
│   │   └── checkpointer.ts
│   │
│   ├── amap/
│   │   ├── places.ts
│   │   ├── route.ts
│   │   ├── weather.ts
│   │   └── types.ts
│   │
│   ├── ranking/
│   │   ├── ranker.ts
│   │   ├── scoring.ts
│   │   └── config.ts
│   │
│   └── schemas/
│       ├── preference.ts
│       ├── place.ts
│       ├── evidence.ts
│       └── debate.ts
│
├── store/
│   └── app-store.ts
│
└── tests/
    ├── ranking/
    ├── graph/
    ├── agents/
    └── fixtures/
```

---

## 22. Testing

### Deterministic tests

Use Vitest for:

- hard filters
- ranking scores
- weather penalties
- travel-time penalties
- duration constraints
- schema validation
- conditional graph routing

### Agent evaluations

Prepare 20–30 fixed scenarios.

Metrics:

- Candidate Recall
- Preference Alignment
- Evidence Validity
- Hallucinated Fact Rate
- Debate Diversity
- User Intervention Sensitivity
- Moderator Trade-off Quality

Keep deterministic logic testable without calling an LLM.

---

## 23. Development Gates

### Gate 1
Mobile product design frozen.

### Gate 2
Map + geolocation + real nearby POIs.

### Gate 3
Intent parser + hard filters + ranking.

### Gate 4
FactPack enrichment.

### Gate 5
LangGraph skeleton runs end-to-end with mocked agents.

### Gate 6
Three dynamic Place Agents produce Opening round.

### Gate 7
Attack + Rebuttal + Moderator work.

### Gate 8
Human-in-the-loop intervention works.

### Gate 9
UI + graph integration + animation.

### Gate 10
LangSmith eval + deployment + portfolio packaging.

---

## 24. Success Criteria

A successful MVP must demonstrate:

1. Real current location or test location.
2. Real nearby POIs.
3. Deterministic Top 3 candidate selection.
4. Dynamic Place Agent creation.
5. A visible structured multi-agent debate.
6. Evidence-backed factual claims.
7. User intervention changes subsequent debate behavior.
8. Moderator summarizes trade-offs.
9. User retains final decision.
10. LangGraph trace can show workflow execution.
