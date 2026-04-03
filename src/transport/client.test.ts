import { describe, expect, test } from "bun:test";
import { NiaTransport } from "./client";

describe("NiaTransport", () => {
	test("injects auth headers and retries retryable failures", async () => {
		const attempts: Array<{ url: string; init?: RequestInit }> = [];

		const transport = new NiaTransport({
			apiKey: "nia_test_key",
			baseURL: "https://example.com/v2",
			initialBackoffMs: 0,
			maxRetries: 1,
			fetch: async (url, init) => {
				attempts.push({ url: String(url), init });

				if (attempts.length === 1) {
					return new Response(JSON.stringify({ error: "rate limited" }), {
						status: 429,
						headers: { "Content-Type": "application/json", "Retry-After": "0" },
					});
				}

				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});

		const response = await transport.postJson<{ ok: boolean }>(
			"/github/tracer",
			{
				query: "How does streaming work?",
			},
		);

		expect(response).toEqual({ ok: true });
		expect(attempts).toHaveLength(2);
		expect(attempts[0]?.url).toBe("https://example.com/v2/github/tracer");
		expect(
			(attempts[1]?.init?.headers as Record<string, string>).Authorization,
		).toBe("Bearer nia_test_key");
	});
});
