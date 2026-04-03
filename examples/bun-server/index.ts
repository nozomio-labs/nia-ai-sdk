import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import {
	createNiaResearchTools,
	DEFAULT_NIA_BASE_URL,
	type NiaTracerMode,
	streamDocumentAgent,
	streamOracle,
	streamTracer,
	withDocumentAgentContext,
	withOracleContext,
	withTracerContext,
} from "../../src/index.ts";
import index from "./index.html";

type ServiceKind = "tracer" | "oracle" | "documentAgent";
type StreamKind = "tracer" | "oracle" | "document-agent";

interface DemoPayload {
	service: ServiceKind;
	prompt: string;
	repositories?: string[];
	dataSources?: string[];
	sourceId?: string;
	sourceIds?: string[];
	mode?: NiaTracerMode;
	outputFormat?: string;
	thinkingEnabled?: boolean;
	thinkingBudget?: number;
}

class DemoError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "DemoError";
	}
}

const port = Number(Bun.env.PORT ?? 3000);
const anthropicModelId = Bun.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

const server = Bun.serve({
	port,
	development: true,
	routes: {
		"/": index,
		"/api/config": {
			GET: () =>
				Response.json({
					hasAnthropicApiKey: Boolean(Bun.env.ANTHROPIC_API_KEY),
					hasNiaApiKey: Boolean(Bun.env.NIA_API_KEY),
					anthropicModel: anthropicModelId,
					baseUrl: Bun.env.NIA_BASE_URL ?? DEFAULT_NIA_BASE_URL,
				}),
		},
		"/api/tools": {
			POST: handleToolDemo,
		},
		"/api/middleware": {
			POST: handleMiddlewareDemo,
		},
		"/api/streams/:kind": {
			GET: handleStreamDemo,
		},
	},
	fetch() {
		return Response.json({ error: "Not found" }, { status: 404 });
	},
});

console.log(`Nia adapter example server running at ${server.url}`);

async function handleToolDemo(request: Request): Promise<Response> {
	try {
		const payload = sanitizePayload(await readJson(request));
		validatePrompt(payload.prompt);

		const toolEvents: Array<Record<string, unknown>> = [];
		const toolName = payload.service;
		const tools = createTools(payload);

		const result = await generateText({
			model: getAnthropicModel(),
			prompt: buildToolPrompt(payload),
			tools,
			stopWhen: stepCountIs(2),
			prepareStep: ({ stepNumber }) =>
				stepNumber === 0
					? {
							toolChoice: {
								type: "tool",
								toolName,
							},
						}
					: {
							toolChoice: "none",
						},
			experimental_onToolCallStart: ({ toolCall }) => {
				toolEvents.push({
					type: "tool-call-start",
					toolCallId: toolCall?.toolCallId ?? null,
					toolName: toolCall?.toolName ?? null,
					input: toolCall?.input,
				});
			},
			experimental_onToolCallFinish: (event) => {
				toolEvents.push(
					event.success
						? {
								type: "tool-call-finish",
								toolCallId: event.toolCall?.toolCallId ?? null,
								toolName: event.toolCall?.toolName ?? null,
								input: event.toolCall?.input,
								output: event.output,
								success: true,
							}
						: {
								type: "tool-call-finish",
								toolCallId: event.toolCall?.toolCallId ?? null,
								toolName: event.toolCall?.toolName ?? null,
								input: event.toolCall?.input,
								error: getErrorMessage(event.error),
								success: false,
							},
				);
			},
		});

		return Response.json({
			service: payload.service,
			text: result.text,
			finishReason: result.finishReason,
			usage: result.usage,
			toolEvents,
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}

async function handleMiddlewareDemo(request: Request): Promise<Response> {
	try {
		const payload = sanitizePayload(await readJson(request));
		validatePrompt(payload.prompt);

		const result = await generateText({
			model: createMiddlewareModel(payload),
			prompt: payload.prompt,
		});

		return Response.json({
			service: payload.service,
			text: result.text,
			finishReason: result.finishReason,
			usage: result.usage,
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}

async function handleStreamDemo(
	request: Bun.BunRequest<"/api/streams/:kind">,
): Promise<Response> {
	const encoder = new TextEncoder();

	return new Response(
		new ReadableStream<Uint8Array>({
			async start(controller) {
				const send = (event: string, data: unknown) => {
					controller.enqueue(
						encoder.encode(
							`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
						),
					);
				};

				try {
					send("ready", {
						kind: request.params.kind,
					});

					await streamEvents({
						request,
						kind: request.params.kind,
						send,
					});

					send("done", { ok: true });
				} catch (error) {
					send("error", {
						message: getErrorMessage(error),
					});
				} finally {
					controller.close();
				}
			},
		}),
		{
			headers: {
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"Content-Type": "text/event-stream; charset=utf-8",
				"X-Accel-Buffering": "no",
			},
		},
	);
}

async function streamEvents(options: {
	request: Bun.BunRequest<"/api/streams/:kind">;
	kind: string;
	send: (event: string, data: unknown) => void;
}): Promise<void> {
	const payload = sanitizeStreamPayload(options.request, options.kind);
	const requestOptions = {
		abortSignal: options.request.signal,
	};

	switch (payload.kind) {
		case "tracer": {
			const session = await streamTracer(
				getTransportOptions(),
				{
					query: payload.prompt,
					repositories: payload.repositories,
					mode: payload.mode,
				},
				requestOptions,
			);

			options.send("job", session.job);

			for await (const event of session.events) {
				if (options.request.signal.aborted) {
					break;
				}

				options.send(event.event, event.data);
			}
			return;
		}

		case "oracle": {
			const session = await streamOracle(
				getTransportOptions(),
				{
					query: payload.prompt,
					repositories: payload.repositories,
					dataSources: payload.dataSources,
					outputFormat: payload.outputFormat,
				},
				requestOptions,
			);

			options.send("job", session.job);

			for await (const event of session.events) {
				if (options.request.signal.aborted) {
					break;
				}

				options.send(event.event, event.data);
			}
			return;
		}

		case "document-agent": {
			const session = await streamDocumentAgent(
				getTransportOptions(),
				{
					query: payload.prompt,
					sourceId: payload.sourceId,
					sourceIds: payload.sourceIds,
					thinkingEnabled: payload.thinkingEnabled,
					thinkingBudget: payload.thinkingBudget,
				},
				requestOptions,
			);

			for await (const event of session.events) {
				if (options.request.signal.aborted) {
					break;
				}

				options.send(event.event, event.data);
			}
			return;
		}
	}
}

function createTools(payload: DemoPayload) {
	return createNiaResearchTools({
		...getTransportOptions(),
		tracer:
			payload.service === "tracer"
				? {
						defaultRequest: {
							repositories: payload.repositories,
							mode: payload.mode,
						},
					}
				: false,
		oracle:
			payload.service === "oracle"
				? {
						defaultRequest: {
							repositories: payload.repositories,
							dataSources: payload.dataSources,
							outputFormat: payload.outputFormat,
						},
					}
				: false,
		documentAgent:
			payload.service === "documentAgent"
				? {
						defaultRequest: {
							sourceId: payload.sourceId,
							sourceIds: payload.sourceIds,
							thinkingEnabled: payload.thinkingEnabled,
							thinkingBudget: payload.thinkingBudget,
						},
					}
				: false,
	});
}

function createMiddlewareModel(payload: DemoPayload) {
	const model = getAnthropicModel();
	const transport = getTransportOptions();

	switch (payload.service) {
		case "tracer":
			return withTracerContext(model, {
				...transport,
				defaultRequest: {
					repositories: payload.repositories,
					mode: payload.mode,
				},
			});
		case "oracle":
			return withOracleContext(model, {
				...transport,
				defaultRequest: {
					repositories: payload.repositories,
					dataSources: payload.dataSources,
					outputFormat: payload.outputFormat,
				},
			});
		case "documentAgent":
			return withDocumentAgentContext(model, {
				...transport,
				defaultRequest: {
					sourceId: payload.sourceId,
					sourceIds: payload.sourceIds,
					thinkingEnabled: payload.thinkingEnabled,
					thinkingBudget: payload.thinkingBudget,
				},
			});
	}
}

function getAnthropicModel() {
	const apiKey = Bun.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new DemoError(
			500,
			"Set ANTHROPIC_API_KEY before using the tool or middleware demos.",
		);
	}

	return anthropic(anthropicModelId);
}

function getTransportOptions() {
	const apiKey = Bun.env.NIA_API_KEY;
	if (!apiKey) {
		throw new DemoError(
			500,
			"Set NIA_API_KEY before using the Nia adapter demos.",
		);
	}

	return {
		apiKey,
		baseURL: Bun.env.NIA_BASE_URL,
	};
}

function sanitizePayload(value: unknown): DemoPayload {
	if (!isRecord(value)) {
		throw new DemoError(400, "Expected a JSON object request body.");
	}

	const service = value.service;
	if (
		service !== "tracer" &&
		service !== "oracle" &&
		service !== "documentAgent"
	) {
		throw new DemoError(400, "Choose tracer, oracle, or documentAgent.");
	}

	const prompt = readString(value.prompt);
	const sourceId = readOptionalString(value.sourceId);
	const sourceIds = readStringArray(value.sourceIds);

	if (service === "documentAgent" && !sourceId && !sourceIds) {
		throw new DemoError(
			400,
			"Document Agent requires a sourceId or sourceIds value.",
		);
	}

	return {
		service,
		prompt,
		repositories: readStringArray(value.repositories),
		dataSources: readStringArray(value.dataSources),
		sourceId,
		sourceIds,
		mode: readTracerMode(value.mode),
		outputFormat: readOptionalString(value.outputFormat),
		thinkingEnabled:
			typeof value.thinkingEnabled === "boolean"
				? value.thinkingEnabled
				: undefined,
		thinkingBudget: readOptionalPositiveInt(value.thinkingBudget),
	};
}

function sanitizeStreamPayload(
	request: Request,
	kind: string,
):
	| (Omit<DemoPayload, "service"> & {
			kind: StreamKind;
	  })
	| never {
	const streamKind = normalizeStreamKind(kind);
	const url = new URL(request.url);
	const prompt = url.searchParams.get("prompt")?.trim() ?? "";

	validatePrompt(prompt);

	const sourceId = readOptionalSearchParam(url.searchParams, "sourceId");
	const sourceIds = readCsv(url.searchParams.get("sourceIds"));

	if (streamKind === "document-agent" && !sourceId && !sourceIds) {
		throw new DemoError(
			400,
			"Document Agent streaming requires sourceId or sourceIds.",
		);
	}

	return {
		kind: streamKind,
		prompt,
		repositories: readCsv(url.searchParams.get("repositories")),
		dataSources: readCsv(url.searchParams.get("dataSources")),
		sourceId,
		sourceIds,
		mode: readTracerMode(url.searchParams.get("mode")),
		outputFormat: readOptionalSearchParam(url.searchParams, "outputFormat"),
		thinkingEnabled: readBoolean(url.searchParams.get("thinkingEnabled")),
		thinkingBudget: readOptionalPositiveInt(
			url.searchParams.get("thinkingBudget"),
		),
	};
}

function buildToolPrompt(payload: DemoPayload): string {
	const labels: Record<ServiceKind, string> = {
		tracer: "Nia Tracer",
		oracle: "Nia Oracle",
		documentAgent: "Nia Document Agent",
	};

	return [
		`Use ${labels[payload.service]} exactly once before answering.`,
		"Then give a concise summary grounded in the tool result.",
		"",
		payload.prompt,
	].join("\n");
}

function validatePrompt(prompt: string): void {
	if (prompt.trim().length === 0) {
		throw new DemoError(400, "Prompt is required.");
	}
}

function readCsv(value: string | null): string[] | undefined {
	if (!value) {
		return undefined;
	}

	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

	return items.length > 0 ? items : undefined;
}

function readBoolean(value: string | null): boolean | undefined {
	if (value == null || value.length === 0) {
		return undefined;
	}

	if (value === "true") {
		return true;
	}

	if (value === "false") {
		return false;
	}

	return undefined;
}

function readJson(request: Request): Promise<unknown> {
	return request.json();
}

function toErrorResponse(error: unknown): Response {
	const status = error instanceof DemoError ? error.status : 500;
	return Response.json(
		{
			error: getErrorMessage(error),
		},
		{ status },
	);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalSearchParam(
	searchParams: URLSearchParams,
	key: string,
): string | undefined {
	const value = searchParams.get(key)?.trim();
	return value ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const items = value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean);

	return items.length > 0 ? items : undefined;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}

	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isInteger(parsed) && parsed > 0) {
			return parsed;
		}
	}

	return undefined;
}

function readTracerMode(value: unknown): NiaTracerMode | undefined {
	return value === "tracer-fast" || value === "tracer-deep" ? value : undefined;
}

function normalizeStreamKind(value: string): StreamKind {
	if (value === "tracer" || value === "oracle" || value === "document-agent") {
		return value;
	}

	throw new DemoError(
		400,
		"Stream kind must be tracer, oracle, or document-agent.",
	);
}
