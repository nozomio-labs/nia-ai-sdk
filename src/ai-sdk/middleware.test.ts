import { describe, expect, test } from "bun:test";
import {
	createDocumentAgentMiddleware,
	createOracleMiddleware,
} from "./middleware";

describe("createOracleMiddleware", () => {
	test("appends grounded context to the last user message", async () => {
		const middleware = createOracleMiddleware({
			apiKey: "nia_test_key",
			baseURL: "https://example.com/v2",
			defaultRequest: {
				repositories: ["vercel/ai"],
				dataSources: ["Vercel AI SDK"],
			},
			fetch: async () =>
				new Response(
					JSON.stringify({
						answer: "Oracle found the relevant answer in the indexed docs.",
						citations: ["https://ai-sdk.dev/docs/ai-sdk-core/middleware"],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		});

		const transformed = await middleware.transformParams?.({
			type: "generate",
			model: {} as never,
			params: {
				prompt: [
					{
						role: "user",
						content: [{ type: "text", text: "How should I use middleware?" }],
					},
				],
			},
		});

		const prompt = transformed?.prompt as Array<{
			role: string;
			content: Array<{ type: string; text?: string }>;
		}>;
		const lastUserMessage = prompt.at(-1);
		const appendedText = lastUserMessage?.content.at(-1)?.text ?? "";

		expect(lastUserMessage?.role).toBe("user");
		expect(appendedText).toContain("Grounding from Nia Oracle:");
		expect(appendedText).toContain(
			"Oracle found the relevant answer in the indexed docs.",
		);
		expect(appendedText).toContain(
			"https://ai-sdk.dev/docs/ai-sdk-core/middleware",
		);
	});
});

describe("createDocumentAgentMiddleware", () => {
	test("appends document-agent grounding to the last user message", async () => {
		const middleware = createDocumentAgentMiddleware({
			apiKey: "nia_test_key",
			baseURL: "https://example.com/v2",
			defaultRequest: {
				sourceId: "src_contract_123",
			},
			fetch: async () =>
				new Response(
					JSON.stringify({
						answer:
							"The contract can be terminated with 90 days written notice.",
						citations: [
							{
								content: "Either party may terminate with 90 days notice.",
								page_number: 8,
								section_title: "Termination",
								tool_source: "read_page",
								source_name: "Master Services Agreement",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		});

		const transformed = await middleware.transformParams?.({
			type: "generate",
			model: {} as never,
			params: {
				prompt: [
					{
						role: "user",
						content: [
							{ type: "text", text: "What is the termination notice?" },
						],
					},
				],
			},
		});

		const prompt = transformed?.prompt as Array<{
			role: string;
			content: Array<{ type: string; text?: string }>;
		}>;
		const lastUserMessage = prompt.at(-1);
		const appendedText = lastUserMessage?.content.at(-1)?.text ?? "";

		expect(lastUserMessage?.role).toBe("user");
		expect(appendedText).toContain("Grounding from Nia Document Agent:");
		expect(appendedText).toContain(
			"The contract can be terminated with 90 days written notice.",
		);
		expect(appendedText).toContain("Termination (page 8)");
	});
});
