# Place Debate Agent

Nearby-place recommendation built with Next.js, LangGraph, LangChain, DeepSeek, AMap, and deterministic candidate ranking.

## Future work: place-experience scoring cache

The current MVP scores each retrieved POI synchronously in one batch model call per recommendation run. A future production-oriented version can add lazy enrichment with a persistent cache keyed by POI ID, plus a category-level fallback profile for instant responses while a fresh score is computed. This is intentionally not implemented in the MVP: it would add storage and cache-invalidation complexity without improving the correctness of a single recommendation run.
