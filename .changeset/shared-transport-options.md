---
"@nozomioai/nia-ai-sdk": patch
---

Allow shared transport options (`apiKey`, `baseURL`, etc.) at the top level of `createNiaResearchTools` so credentials only need to be specified once instead of per-service. Per-service values still override the shared ones when provided.
