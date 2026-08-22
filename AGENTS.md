# AGENTS.md

# Place Debate Agent — Coding Agent Rules

This file contains non-negotiable rules for Codex and other coding agents.

Before making architectural changes, read:

1. `TECH_SPEC.md`
2. `AGENTS.md`
3. `REFERENCE_IMPLEMENTATIONS.md`

The project is intentionally constrained to reduce unnecessary exploration, dependency growth, and token usage.

---

## 1. Frozen Stack

Use:

- Next.js App Router
- TypeScript
- React
- Tailwind CSS v4
- Motion for React
- Zustand
- AMap APIs
- LangChain JS
- LangGraph JS
- @langchain/deepseek
- DeepSeek via `ChatDeepSeek`
- Zod
- LangSmith
- Vitest
- Vercel

Do not replace these technologies without explicit approval.

---

## 2. Required Agent Architecture

The intended architecture is:

- 1 Intent Interpreter
- 3 dynamic Place Agents created by one factory
- 1 neutral Moderator
- 1 LangGraph StateGraph coordinating workflow

LangChain handles individual agent/model behavior.

LangGraph handles workflow state and orchestration.

LangSmith handles tracing/evaluation.

Do not substitute this with a different agent framework.

---

## 3. Forbidden Agent Frameworks

Do NOT add:

- OpenAI Agents SDK
- AutoGen
- CrewAI
- Semantic Kernel
- custom autonomous-agent runtime

The project uses LangChain + LangGraph intentionally for architectural and portfolio reasons.

Do not run two competing agent frameworks in parallel.

---

## 4. Forbidden Infrastructure Unless Explicitly Approved

Do NOT add:

- Python backend
- FastAPI
- Flask
- Django
- Redis
- Docker
- Kubernetes
- vector database
- RAG framework
- MCP server
- Firebase
- authentication provider
- queue system
- native iOS project
- React Native project

Postgres is allowed only when explicitly requested for durable LangGraph checkpoints or later persistence.

Do not introduce it before the core graph works.

---

## 5. LangGraph Rules

Use LangGraph StateGraph for the main workflow.

Expected conceptual flow:

```text
START
→ parseIntent
→ retrievePlaces
→ filterPlaces
→ rankPlaces
→ enrichFactPacks
→ openingRound
→ attackRound
→ conditional user intervention
→ rebuttalRound
→ moderatorSummary
→ END
```

Application code / graph edges control the round sequence.

Do not create a supervisor LLM that decides the workflow from scratch.

Do not create an endless or free-running multi-agent group chat.

---

## 6. Human-in-the-loop Rules

User intervention should eventually use LangGraph interrupt/resume semantics.

Do not introduce durable Postgres checkpointing until the basic graph works.

Preferred sequence:

1. get graph working without HITL persistence
2. add interrupt
3. add resume
4. add durable checkpointer only if necessary

Avoid prematurely solving distributed systems problems.

---

## 7. Place Agent Rules

Use one factory:

```text
createPlaceAgent(factPack, userPreference)
```

Do not create place-specific source files.

Incorrect:

```text
xuanwu-lake-agent.ts
museum-agent.ts
bookstore-agent.ts
```

Correct:

```text
place-agent-factory.ts
```

Places are runtime data, not hard-coded agent classes.

---

## 8. Grounding Rules

Place Agents must only use supplied PlaceFactPack evidence.

Every factual claim should reference evidence IDs where applicable.

Never fabricate:

- ticket prices
- opening hours
- distance
- route time
- weather
- rating
- current exhibitions/events
- crowd level
- facilities
- reservation requirements

If a required fact is missing, explicitly treat it as unknown.

---

## 9. Structured Output Rules

Any LLM output consumed by application code must be schema validated.

Use Zod schemas.

Do not parse model prose with regex or string splitting.

Structured outputs include:

- UserPreference
- preference delta
- Opening response
- Attack response
- Rebuttal response
- ModeratorResult

---

## 10. Ranking Rules

Do NOT ask the LLM to directly rank raw nearby POIs as the primary ranking mechanism.

Required sequence:

1. retrieve POIs
2. hard filter
3. deterministic scoring
4. select Top 3
5. create Place Agents

LLM may interpret soft preferences.

Code performs candidate ranking.

---

## 11. AMap Rules

AMAP_WEB_SERVICE_KEY is server-side only.

Do not expose it in browser code.

Server-side calls include:

- POI search
- route planning
- weather
- server-side POI enrichment

Client-side map SDK may use only the credentials required for the JS SDK.

Never commit secrets.

---

## 12. LangSmith Rules

Do not build a custom tracing dashboard before LangSmith tracing works.

Trace major graph runs and nodes.

Use LangSmith for:

- execution inspection
- debugging
- latency analysis
- token usage inspection
- evaluation experiments

Do not add unrelated observability platforms during MVP.

---

## 13. UI Rules

The product is mobile-first.

Primary design reference:

```text
390 × 844
```

Do not optimize desktop first.

Do not transform the UI into:

- admin dashboard
- enterprise SaaS panel
- desktop sidebar layout
- generic ChatGPT clone

When implementing approved Figma designs:

- preserve geometry
- preserve hierarchy
- preserve spacing
- preserve visual weight
- preserve interaction intent

Do not invent extra interface elements unless explicitly asked.

---

## 14. State Separation

Zustand:

- UI state only

LangGraph:

- workflow state only

Do not place graph orchestration logic in Zustand.

Do not put React component state inside LangGraph state.

---

## 15. Development Discipline

Before modifying code:

1. inspect the smallest relevant set of files
2. inspect `REFERENCE_IMPLEMENTATIONS.md` when the subsystem is difficult
3. state the intended files to modify
4. avoid unrelated refactoring

After modifying code:

1. run relevant unit tests
2. run typecheck
3. run lint if configured
4. run build when appropriate
5. report modified files
6. report unresolved errors/warnings

Do not silently rewrite unrelated files.

---

## 16. Context / Token Efficiency

Prefer targeted file reads over repository-wide scans.

Prefer a small patch over a broad rewrite.

Do not repeatedly debate alternative frameworks.

Do not regenerate architecture documents unless asked.

When an official/reference example exists, inspect it before implementing from scratch.

Do not spend large context windows exploring technologies already frozen in `TECH_SPEC.md`.

---

## 17. Build Order

Follow this order unless explicitly instructed otherwise:

1. project skeleton
2. mobile UI skeleton
3. AMap map
4. geolocation
5. nearby POI retrieval
6. intent parsing
7. hard filtering
8. ranking
9. FactPack enrichment
10. LangGraph state + mock nodes
11. Place Agent factory
12. Opening round
13. Attack round
14. Rebuttal round
15. Moderator
16. user intervention
17. LangSmith tracing
18. UI integration
19. animation
20. optional streaming
21. evaluation
22. deployment

Do not build database/auth/social features before the core flow works.

---

## 18. MVP Feature Ban

Until the core debate is working, do not add:

- login
- profiles
- long-term memory
- favorites database
- social features
- voice
- embeddings
- RAG
- complex caching
- payments
- recommendation learning
- WebSockets unless actually required
- custom event bus unless actually required

---

## 19. External Reference Rule

Before implementing a difficult subsystem:

1. open `REFERENCE_IMPLEMENTATIONS.md`
2. inspect the named official/reference implementation
3. copy the pattern, not the entire stack
4. adapt it to this project's architecture
5. keep dependencies minimal

If a reference uses Python, do not switch this project to Python.

---

## 20. Definition of Done

A task is complete only when:

- intended behavior works
- code compiles
- relevant tests pass
- typecheck passes
- no unrelated regression is introduced
- implementation follows TECH_SPEC.md
- UI follows approved design where applicable

Writing code alone is not completion.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
