import { describe, expect, test } from "bun:test";
import {
	createDocumentAgentTool,
	createNiaResearchTools,
	createTracerTool,
} from "./tools";

describe("createTracerTool", () => {
	test("runs a tracer job and returns normalized output", async () => {
		const requests: Array<{ url: string; init?: RequestInit; body?: unknown }> =
			[];

		const tracerTool = createTracerTool({
			apiKey: "nia_test_key",
			baseURL: "https://example.com/v2",
			initialBackoffMs: 0,
			defaultRequest: {
				repositories: ["vercel/ai"],
				mode: "tracer-fast",
			},
			pollIntervalMs: 0,
			fetch: async (url, init) => {
				const body =
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
				requests.push({ url: String(url), init, body });

				if (String(url).endsWith("/github/tracer")) {
					return new Response(
						JSON.stringify({
							job_id: "job_123",
							session_id: "session_123",
							status: "queued",
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					);
				}

				return new Response(
					JSON.stringify({
						status: "completed",
						report:
							"Tracer found the streaming implementation in core/generate-text.ts.",
						citations: ["vercel/ai/core/generate-text.ts"],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});

		const result = await tracerTool.execute?.(
			{
				query: "How does generateText stream responses?",
			},
			{
				toolCallId: "tool_123",
				messages: [],
			},
		);

		expect(result).toEqual({
			text: "Tracer found the streaming implementation in core/generate-text.ts.",
			citations: ["vercel/ai/core/generate-text.ts"],
			status: "completed",
			jobId: "job_123",
			sessionId: "session_123",
		});
		expect(requests[0]?.body).toEqual({
			query: "How does generateText stream responses?",
			repositories: ["vercel/ai"],
			context: undefined,
			mode: "tracer-fast",
			model: undefined,
		});
	});
});

describe("createDocumentAgentTool", () => {
	test("runs document agent and returns normalized output", async () => {
		const requests: Array<{ url: string; init?: RequestInit; body?: unknown }> =
			[];

		const documentTool = createDocumentAgentTool({
			apiKey: "nia_test_key",
			baseURL: "https://example.com/v2",
			defaultRequest: {
				sourceId: "src_abc123",
				thinkingEnabled: true,
				thinkingBudget: 12_000,
			},
			fetch: async (url, init) => {
				const body =
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
				requests.push({ url: String(url), init, body });

				return new Response(
					JSON.stringify({
						answer: "The report highlights cybersecurity and regulatory risk.",
						citations: [
							{
								content:
									"Cybersecurity threats may adversely affect the business.",
								page_number: 12,
								section_title: "Cybersecurity",
								section_path: ["Risk Factors", "Cybersecurity"],
								tool_source: "read_section",
								source_name: "Annual Report 2025",
							},
						],
						structured_output: {
							riskFactors: ["cybersecurity", "regulatory"],
						},
						model: "claude-opus-4-6-1m",
						usage: {
							input_tokens: 100,
							output_tokens: 40,
							thinking_tokens: 250,
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});

		const result = await documentTool.execute?.(
			{
				query: "What are the main risk factors?",
			},
			{
				toolCallId: "tool_doc_123",
				messages: [],
			},
		);

		expect(result).toEqual({
			text: "The report highlights cybersecurity and regulatory risk.",
			citations: ["Risk Factors > Cybersecurity (page 12)"],
			documentCitations: [
				{
					content: "Cybersecurity threats may adversely affect the business.",
					pageNumber: 12,
					sectionId: null,
					sectionTitle: "Cybersecurity",
					sectionPath: ["Risk Factors", "Cybersecurity"],
					toolSource: "read_section",
					sourceId: null,
					sourceName: "Annual Report 2025",
				},
			],
			structuredOutput: {
				riskFactors: ["cybersecurity", "regulatory"],
			},
			model: "claude-opus-4-6-1m",
			usage: {
				inputTokens: 100,
				outputTokens: 40,
				thinkingTokens: 250,
				input_tokens: 100,
				output_tokens: 40,
				thinking_tokens: 250,
			},
			status: undefined,
			jobId: undefined,
			sessionId: undefined,
		});
		expect(requests[0]?.url).toBe("https://example.com/v2/document/agent");
		expect(requests[0]?.body).toEqual({
			source_id: "src_abc123",
			source_ids: undefined,
			query: "What are the main risk factors?",
			json_schema: undefined,
			model: undefined,
			thinking_enabled: true,
			thinking_budget: 12000,
			stream: false,
		});
	});
});

describe("createNiaResearchTools", () => {
	const mockFetch = async (url: string | URL | Request) => {
		const u = String(url);

		if (u.endsWith("/github/tracer")) {
			return new Response(
				JSON.stringify({
					job_id: "job_shared",
					session_id: "session_shared",
					status: "queued",
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({
				status: "completed",
				report: "shared transport works",
				citations: [],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	test("accepts shared transport options so apiKey is specified once", async () => {
		const tools = createNiaResearchTools({
			apiKey: "nia_shared_key",
			baseURL: "https://example.com/v2",
			fetch: mockFetch,
			initialBackoffMs: 0,
			tracer: {
				pollIntervalMs: 0,
				defaultRequest: { mode: "tracer-fast" },
			},
			oracle: false,
			documentAgent: false,
		});

		expect(tools.tracer).toBeDefined();
		expect(tools.oracle).toBeUndefined();
		expect(tools.documentAgent).toBeUndefined();

		const result = (await tools.tracer?.execute?.(
			{ query: "shared transport test" },
			{ toolCallId: "tool_shared", messages: [] },
		)) as Record<string, unknown> | undefined;

		expect(result?.text).toBe("shared transport works");
		expect(result?.status).toBe("completed");
	});

	test("per-service apiKey overrides the shared one", async () => {
		const capturedKeys: string[] = [];

		const tools = createNiaResearchTools({
			apiKey: "nia_shared_key",
			baseURL: "https://example.com/v2",
			initialBackoffMs: 0,
			tracer: {
				apiKey: "nia_tracer_override",
				pollIntervalMs: 0,
				defaultRequest: { mode: "tracer-fast" },
				fetch: async (_url, init) => {
					const auth = (init?.headers as Record<string, string>)?.Authorization;
					if (auth) {
						capturedKeys.push(auth.replace("Bearer ", ""));
					}

					if (String(_url).endsWith("/github/tracer")) {
						return new Response(
							JSON.stringify({
								job_id: "job_override",
								status: "queued",
							}),
							{
								status: 200,
								headers: { "Content-Type": "application/json" },
							},
						);
					}

					return new Response(
						JSON.stringify({
							status: "completed",
							report: "override test",
							citations: [],
						}),
						{
							status: 200,
							headers: { "Content-Type": "application/json" },
						},
					);
				},
			},
			oracle: false,
			documentAgent: false,
		});

		await tools.tracer?.execute?.(
			{ query: "override test" },
			{ toolCallId: "tool_override", messages: [] },
		);

		expect(capturedKeys.every((k) => k === "nia_tracer_override")).toBe(true);
	});

	test("throws when no apiKey is provided at any level", () => {
		expect(() =>
			createNiaResearchTools({
				tracer: {
					defaultRequest: { mode: "tracer-fast" },
				},
			}),
		).toThrow("Missing apiKey for tracer");
	});
});
