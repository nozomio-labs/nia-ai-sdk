import { describe, expect, test } from "bun:test";
import { streamDocumentAgent, streamTracer } from "./streams";

describe("streamTracer", () => {
	test("creates a tracer job and parses streamed SSE events", async () => {
		const encoder = new TextEncoder();

		const session = await streamTracer(
			{
				apiKey: "nia_test_key",
				baseURL: "https://example.com/v2",
				fetch: async (url) => {
					if (String(url).endsWith("/github/tracer")) {
						return new Response(
							JSON.stringify({
								job_id: "job_456",
								session_id: "session_456",
								status: "queued",
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } },
						);
					}

					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								encoder.encode(
									[
										"event: started",
										'data: {"query":"trace streaming"}',
										"",
										"event: complete",
										'data: {"report":"done"}',
										"",
									].join("\n"),
								),
							);
							controller.close();
						},
					});

					return new Response(stream, {
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					});
				},
			},
			{ query: "trace streaming" },
		);

		const events: Array<{ event: string; data: unknown }> = [];
		for await (const event of session.events) {
			events.push({ event: event.event, data: event.data });
		}

		expect(session.job.jobId).toBe("job_456");
		expect(events).toEqual([
			{ event: "started", data: { query: "trace streaming" } },
			{ event: "complete", data: { report: "done" } },
		]);
	});
});

describe("streamDocumentAgent", () => {
	test("streams direct SSE events from the document agent endpoint", async () => {
		const encoder = new TextEncoder();
		const requests: Array<{ url: string; body?: unknown }> = [];

		const session = await streamDocumentAgent(
			{
				apiKey: "nia_test_key",
				baseURL: "https://example.com/v2",
				fetch: async (url, init) => {
					const body =
						typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
					requests.push({ url: String(url), body });

					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(
								encoder.encode(
									[
										"event: progress",
										'data: {"step":"search"}',
										"",
										"event: complete",
										'data: {"answer":"done"}',
										"",
									].join("\n"),
								),
							);
							controller.close();
						},
					});

					return new Response(stream, {
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					});
				},
			},
			{
				sourceId: "src_manual_123",
				query: "Summarize the methodology section.",
			},
		);

		const events: Array<{ event: string; data: unknown }> = [];
		for await (const event of session.events) {
			events.push({ event: event.event, data: event.data });
		}

		expect(requests[0]).toEqual({
			url: "https://example.com/v2/document/agent",
			body: {
				source_id: "src_manual_123",
				source_ids: undefined,
				query: "Summarize the methodology section.",
				json_schema: undefined,
				model: undefined,
				thinking_enabled: undefined,
				thinking_budget: undefined,
				stream: true,
			},
		});
		expect(events).toEqual([
			{ event: "progress", data: { step: "search" } },
			{ event: "complete", data: { answer: "done" } },
		]);
	});
});
