# Place Experience Layer — Implementation Spec
**Project:** Place Debate Agent
**Scope:** Portfolio/resume project (not production-scale) — MVP first, optimization optional
**Stack:** LangGraph, LangChain.js, ChatDeepSeek, Zod

---

## 1. Background

Current pipeline:

```
Parse Intent → Build Experience Preferences → Check if Clarification Needed → Generate Search Plan
→ Get Location → AMap POI Search → Filter → Initial Ranking → Check for 3 Valid Candidates
→ Fetch Route & Weather → Final Ranking → Generate FactPack
```

Only one LLM runs in the current recommendation flow: the Intent Extractor, using `ChatDeepSeek` via LangChain, with output validated by Zod. (A Debate stage with 3 place-agents + 1 moderator exists in the codebase but is currently disabled to conserve model quota — do not touch it.)

## 2. Problem

The **Filter** stage's second layer (intent-compatibility check) currently relies on AMap category-string matching. AMap groups study rooms, museums, and exhibition halls all under the broad "Science/Education/Culture" typecode, and that typecode is allowed by default. As a result, a query like "want to go out and wander around" can return a self-study room as a candidate — even though a study room (sit-and-focus) and a museum (walk-and-explore) offer opposite experiences.

The ranking weights already reserve 30–35% for "interest/experience match," which implies the design already intended a real experience-dimension score here — it's just currently approximated via category/keyword matching instead of an actual vector.

## 3. Goal

Do **not** restructure the existing pipeline. Make three targeted changes:

1. Extend the "Build Experience Preferences" node so it also outputs a standardized experience-dimension vector for the user's intent.
2. Add one new node — **Place Experience Scorer** — between "AMap POI Search" and "Filter," which scores each candidate POI on the same dimension vector.
3. Use that vector to replace the category-string logic in Filter's second layer, and to power the existing "interest/experience match" ranking weight.

The Debate stage is out of scope for this task.

## 4. Non-Goals (explicitly do not implement unless Part 2 is reached)

This is a portfolio project, not a system built to serve real traffic. Do not add:
- A persistent cache / database layer for scored POIs
- A category-to-default-vector fallback table
- Any async/background scoring

These are listed only as optional Part 2 work below. Skipping them does not compromise correctness — every candidate POI can simply be scored synchronously on each query at this project's scale.

---

## Part 1 — Core Implementation (required)

### 4.1 Schema: `ExperienceProfile`

Shared schema for both user intent and POIs. Add to the existing schema file, next to the Intent schema.

```typescript
import { z } from "zod";

export const ExperienceProfileSchema = z.object({
  activityLevel: z.number().min(0).max(1),        // 0 = seated/static, 1 = physically demanding
  engagementType: z.enum(["exploration", "consumption", "functional", "social"]),
  socialFit: z.enum(["solo", "group", "either"]),
  pace: z.number().min(0).max(1),                  // 0 = slow/contemplative, 1 = fast/energetic
  spatial: z.enum(["indoor", "outdoor", "mixed"]),
  stimulation: z.number().min(0).max(1),           // 0 = quiet, 1 = lively/sensory
  costTier: z.enum(["free", "low", "medium", "high"]),
});

export type ExperienceProfile = z.infer<typeof ExperienceProfileSchema>;
```

**Design constraint:** these are dimensions, not a category taxonomy. Do not extend `engagementType` (or any field) into an enumerated list of place types ("mall," "museum," "gym," "escape room," ...). Any new place type must be describable using these same 7 dimensions without adding new fields or new code. This is the core fix for the original bug — replacing an ever-growing category list with a fixed, small set of attributes.

### 4.2 Extend "Build Experience Preferences" node

This node should additionally output an `ExperienceProfile` for the user's intent, validated by the schema above. Reuse the existing ChatDeepSeek call already used for intent extraction — extend its output schema rather than adding a new LLM call.

Example: "want to go out and wander around by myself" should produce approximately:

```json
{
  "activityLevel": 0.7,
  "engagementType": "exploration",
  "socialFit": "solo",
  "pace": 0.5,
  "spatial": "mixed",
  "stimulation": 0.5,
  "costTier": "low"
}
```

### 4.3 New node: Place Experience Scorer

Insert between "AMap POI Search" and "Filter." Score all candidate POIs from a single query in **one batched LLM call** — never one call per POI.

```typescript
const BatchExperienceSchema = z.array(
  z.object({ poiId: z.string() }).merge(ExperienceProfileSchema)
);

async function scoreCandidates(
  pois: { poiId: string; name: string; typecode: string; tags?: string }[]
) {
  const model = chatDeepSeek; // reuse the same instance used by the Intent Extractor
  const structured = model.withStructuredOutput(BatchExperienceSchema);

  const prompt = `Score each place below on the given dimensions. Return only structured data, no extra text.
Places: ${JSON.stringify(pois)}`;

  return await structured.invoke(prompt);
}

async function placeExperienceScorerNode(state: PipelineState): Promise<PipelineState> {
  const candidates = state.poiCandidates;
  const toScore = candidates.map(poi => ({
    poiId: poi.id, name: poi.name, typecode: poi.typecode, tags: poi.tags,
  }));

  const results = await scoreCandidates(toScore);
  const byId = new Map(results.map(r => [r.poiId, r]));

  const scored = candidates.map(poi => ({
    ...poi,
    experience: byId.get(poi.id) ?? DEFAULT_EXPERIENCE_PROFILE, // simple fallback if model omits an item
  }));

  return { ...state, poiCandidates: scored };
}
```

`DEFAULT_EXPERIENCE_PROFILE` can be a single hardcoded neutral profile (e.g. all mid-range values) — this is just a safety net for missing entries in the model's response, not a real fallback system.

### 4.4 Update Filter (second layer): experience-based hard exclusion

Replace the category-string compatibility check with:

```typescript
function isExperienceCompatible(intent: ExperienceProfile, poi: ExperienceProfile): boolean {
  if (intent.engagementType === "exploration" && poi.engagementType === "functional") return false;
  if (Math.abs(intent.activityLevel - poi.activityLevel) > 0.5) return false;
  return true;
}
```

This directly fixes the study-room bug: "want to wander around" has `engagementType: exploration`; a self-study room should be scored `engagementType: functional`; the two are incompatible and the POI is excluded — independent of whatever AMap category it happens to fall under.

### 4.5 Update Initial/Final Ranking: wire into the existing weight

The ranking weights already reserve 30–35% for "interest/experience match." Compute that score as:

```typescript
function experienceMatchScore(intent: ExperienceProfile, poi: ExperienceProfile): number {
  const numericDist =
    Math.abs(intent.activityLevel - poi.activityLevel) +
    Math.abs(intent.pace - poi.pace) +
    Math.abs(intent.stimulation - poi.stimulation);
  const categoricalPenalty =
    (intent.engagementType === poi.engagementType ? 0 : 1) +
    (poi.socialFit === "either" || intent.socialFit === poi.socialFit ? 0 : 1) +
    (poi.spatial === "mixed" || intent.spatial === poi.spatial ? 0 : 1);
  return 1 - (numericDist + categoricalPenalty) / 6; // normalized to 0–1
}
```

Leave all other ranking weights (distance, activity-intensity match, weather, place quality/rating, diversity) as-is.

### 4.6 Acceptance Test

- Input: "want to go out and wander around by myself"
- Candidates: Yixin Space Self-Study Room / Nanjing Museum / Old Camera Art Museum
- Expected: the self-study room is excluded at the Filter stage, or — if it survives filtering — its "interest/experience match" score is clearly lower than both museums, pushing it out of the top 3.

---

## Part 2 — Optional Engineering Hardening (skip unless time allows)

This section addresses cost control if the system were to serve real traffic (repeated scoring of the same POI across many queries). **For a portfolio project, implementing this is a bonus, but explicitly is not required — describing the design in the README is equally valid** and demonstrates the same architectural judgment without the implementation cost.

If pursued:

1. **Local cache** — `better-sqlite3` (single file, zero external services) keyed by `poi_id`, storing each POI's scored `ExperienceProfile` so repeat encounters skip the LLM call entirely.
2. **Category fallback table** — a small hardcoded map from AMap's ~15–20 top-level typecodes to a default `ExperienceProfile`, used to serve an instant result on a cache miss while the real LLM score is computed.

If not implemented, add a short "Future Work" section to the project README describing this design (lazy enrichment + permanent cache + category fallback) instead of writing the code.

---

## Task Checklist

- [ ] Add `ExperienceProfileSchema` to the schema file.
- [ ] Extend "Build Experience Preferences" node output to include `experienceProfile`.
- [ ] Implement `placeExperienceScorerNode` and add it to the LangGraph graph between "AMap POI Search" and "Filter."
- [ ] Update Filter's second layer with `isExperienceCompatible`.
- [ ] Update Initial/Final Ranking to compute the "interest/experience match" weight via `experienceMatchScore`.
- [ ] Run the acceptance test in 4.6 and confirm the self-study room is excluded or ranked below the museums.
- [ ] (Optional) Implement Part 2 caching/fallback, or write the "Future Work" README section instead.
