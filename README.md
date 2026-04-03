# @nozomioai/nia-ai-sdk

[AI SDK adapter](https://ai-sdk.dev/) for [Nia](https://www.trynia.ai/) `Tracer`, `Oracle`, and `Document Agent`.

This package is designed for AI SDK workflows where you want to:

- call Nia `Tracer` as a tool for public GitHub research
- call Nia `Oracle` as a tool for grounded research over indexed repos and docs
- call Nia `Document Agent` as a tool for deep document analysis and structured extraction
- augment an existing AI SDK model with Nia-backed middleware
- stream Tracer, Oracle, or Document Agent events directly in your app

This package is intentionally **not** the general Nia SDK. It is the AI SDK-facing adapter layer only.

## Install

```bash
bun add @nozomioai/nia-ai-sdk ai zod
```

If you want to use middleware with an AI SDK model provider, install that provider too. For example:

```bash
bun add @ai-sdk/openai
```

Set your Nia API key:

```bash
export NIA_API_KEY=nia_your_api_key
```

## Tool Usage

Use Nia as AI SDK tools inside `generateText()` or `streamText()`:

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createNiaResearchTools } from "@nozomioai/nia-ai-sdk";

const tools = createNiaResearchTools({
  tracer: {
    apiKey: process.env.NIA_API_KEY!,
    defaultRequest: {
      mode: "tracer-deep",
    },
  },
  oracle: {
    apiKey: process.env.NIA_API_KEY!,
    defaultRequest: {
      repositories: ["vercel/ai"],
      dataSources: ["Vercel AI SDK"],
    },
  },
  documentAgent: {
    apiKey: process.env.NIA_API_KEY!,
    defaultRequest: {
      sourceId: "src_abc123",
    },
  },
});

const result = await generateText({
  model: openai("gpt-4.1"),
  prompt:
    "Research how AI SDK middleware works, then summarize the best integration pattern.",
  tools,
});

console.log(result.text);
```

## Middleware Usage

Use middleware when you want Nia to augment the last user message before your base model runs:

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { withOracleContext } from "@nozomioai/nia-ai-sdk";

const model = withOracleContext(openai("gpt-4.1"), {
  apiKey: process.env.NIA_API_KEY!,
  defaultRequest: {
    repositories: ["vercel/ai"],
    dataSources: ["Vercel AI SDK"],
  },
});

const result = await generateText({
  model,
  prompt: "How should I think about AI SDK middleware for retrieval?",
});

console.log(result.text);
```

Use `withTracerContext()` the same way when the question is about public GitHub repositories that are not already indexed in Nia.
Use `withDocumentAgentContext()` when the question targets one or more indexed PDFs or documents and you want page-level citations or structured extraction grounding.

## Direct Streaming Helpers

Use the stream helpers when you want raw job events:

```ts
import { streamTracer } from "@nozomioai/nia-ai-sdk";

const session = await streamTracer(
  {
    apiKey: process.env.NIA_API_KEY!,
  },
  {
    query: "How does generateText stream responses?",
    repositories: ["vercel/ai"],
    mode: "tracer-fast",
  }
);

for await (const event of session.events) {
  console.log(event.event, event.data);
}
```

Available helpers:

- `streamTracer()`
- `streamOracle()`
- `streamOracleSessionChat()`
- `streamDocumentAgent()`

## Public API

Main exports:

- `createTracerTool()`
- `createOracleTool()`
- `createDocumentAgentTool()`
- `createNiaResearchTools()`
- `createTracerMiddleware()`
- `createOracleMiddleware()`
- `createDocumentAgentMiddleware()`
- `withTracerContext()`
- `withOracleContext()`
- `withDocumentAgentContext()`
- `streamTracer()`
- `streamOracle()`
- `streamOracleSessionChat()`
- `streamDocumentAgent()`
- adapter-facing types from `src/types.ts`

Internal transport and low-level client classes are not part of the supported public API.

## Local Development

```bash
bun install
bun test
bun run check:types
bun run build
```
