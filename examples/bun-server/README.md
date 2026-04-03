# Bun Server Example

This example app exercises the adapter's three public surfaces from a single Bun server:

- AI SDK tools through `generateText()`
- AI SDK middleware through wrapped Anthropic models
- direct Nia streaming helpers exposed as browser-readable SSE

## Prerequisites

- A valid `NIA_API_KEY`
- A valid `ANTHROPIC_API_KEY`
- Real indexed repositories/data sources for Oracle
- Real indexed document source IDs for Document Agent

## Setup

```bash
cd examples/bun-server
bun install
cp .env.example .env
```

## Run

```bash
bun run dev
```

Then open `http://localhost:3000`.

## Notes

- The example imports the adapter from `../../src/index.ts` so it always exercises the in-repo source directly.
- The tool demo forces one tool call on the first model step, then disables tool calling for the follow-up answer.
- The stream panel forwards raw event names and payloads from Nia, so event shapes will vary by service and lifecycle stage.
