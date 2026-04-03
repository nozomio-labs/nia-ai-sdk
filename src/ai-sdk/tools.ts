import { type Tool, tool } from "ai";
import { z } from "zod";
import { NiaDocumentAgentClient } from "../document-agent/client";
import { NiaOracleClient } from "../oracle/client";
import { NiaTracerClient } from "../tracer/client";
import type {
	NiaDocumentAgentRequest,
	NiaDocumentAgentToolInput,
	NiaDocumentAgentToolResult,
	NiaOracleRequest,
	NiaOracleToolInput,
	NiaToolResult,
	NiaTracerRequest,
	NiaTracerToolInput,
	NiaTransportOptions,
} from "../types";

const tracerModeSchema = z.enum(["tracer-fast", "tracer-deep"]);
const tracerModelSchema = z.enum([
	"claude-haiku-4-5-20251001",
	"claude-opus-4-6",
	"claude-opus-4-6-1m",
]);

const oracleModelSchema = z.enum([
	"claude-opus-4-6",
	"claude-opus-4-6-1m",
	"claude-sonnet-4-5-20250929",
	"claude-sonnet-4-5-1m",
]);

const jsonSchemaInput = z.record(z.string(), z.unknown());

export interface CreateTracerToolOptions extends NiaTransportOptions {
	description?: string;
	defaultRequest?: Omit<NiaTracerRequest, "query">;
	timeoutMs?: number;
	pollIntervalMs?: number;
	includeRawByDefault?: boolean;
}

export interface CreateOracleToolOptions extends NiaTransportOptions {
	description?: string;
	defaultRequest?: Omit<NiaOracleRequest, "query">;
	timeoutMs?: number;
	pollIntervalMs?: number;
	includeRawByDefault?: boolean;
	defaultExecutionMode?: "sync" | "job";
}

export interface CreateDocumentAgentToolOptions extends NiaTransportOptions {
	description?: string;
	defaultRequest?: Omit<NiaDocumentAgentRequest, "query" | "stream">;
	timeoutMs?: number;
	includeRawByDefault?: boolean;
}

export type CreateTracerToolServiceOptions = Omit<
	CreateTracerToolOptions,
	keyof NiaTransportOptions
> &
	Partial<NiaTransportOptions>;

export type CreateOracleToolServiceOptions = Omit<
	CreateOracleToolOptions,
	keyof NiaTransportOptions
> &
	Partial<NiaTransportOptions>;

export type CreateDocumentAgentToolServiceOptions = Omit<
	CreateDocumentAgentToolOptions,
	keyof NiaTransportOptions
> &
	Partial<NiaTransportOptions>;

export interface CreateNiaResearchToolsOptions
	extends Partial<NiaTransportOptions> {
	tracer?: CreateTracerToolServiceOptions | false;
	oracle?: CreateOracleToolServiceOptions | false;
	documentAgent?: CreateDocumentAgentToolServiceOptions | false;
}

export function createTracerTool(
	options: CreateTracerToolOptions,
): Tool<NiaTracerToolInput, NiaToolResult> {
	const client = new NiaTracerClient(options);

	return tool({
		description:
			options.description ??
			"Use Nia Tracer to research public GitHub repositories without indexing them first. Best for unfamiliar repositories, quick implementation lookups, and code-path investigations.",
		inputSchema: z.object({
			query: z.string().min(1).max(10_000).describe("The research question."),
			repositories: z
				.array(z.string())
				.optional()
				.describe("Repositories in owner/repo format."),
			context: z
				.string()
				.max(5_000)
				.optional()
				.describe("Extra guidance for the Tracer agent."),
			mode: tracerModeSchema
				.optional()
				.describe(
					"Tracer mode. Use tracer-fast for quick lookups or tracer-deep for thorough investigations.",
				),
			model: tracerModelSchema
				.optional()
				.describe(
					"Optional explicit model override. Must agree with mode if both are provided.",
				),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("How long to wait for the job to finish."),
			pollIntervalMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Polling interval while waiting for completion."),
			includeRaw: z
				.boolean()
				.optional()
				.describe("Include the raw Nia response in the tool output."),
		}),
		execute: async (input: NiaTracerToolInput): Promise<NiaToolResult> => {
			const result = await client.run(
				{
					...options.defaultRequest,
					...input,
				},
				{
					timeoutMs: input.timeoutMs ?? options.timeoutMs,
					pollIntervalMs: input.pollIntervalMs ?? options.pollIntervalMs,
				},
			);

			return maybeOmitRaw(
				result,
				input.includeRaw ?? options.includeRawByDefault ?? false,
			);
		},
	});
}

export function createOracleTool(
	options: CreateOracleToolOptions,
): Tool<NiaOracleToolInput, NiaToolResult> {
	const client = new NiaOracleClient(options);

	return tool({
		description:
			options.description ??
			"Use Nia Oracle to run grounded research over indexed repositories and documentation. Best for answers that should be backed by Nia's indexed sources and citations.",
		inputSchema: z.object({
			query: z.string().min(1).describe("The research question."),
			repositories: z
				.array(z.string())
				.optional()
				.describe("Indexed repositories to search."),
			dataSources: z
				.array(z.string())
				.optional()
				.describe("Indexed documentation sources to search."),
			outputFormat: z
				.string()
				.optional()
				.describe("Optional output format guidance passed through to Oracle."),
			model: oracleModelSchema
				.optional()
				.describe("Optional Oracle model override."),
			executionMode: z
				.enum(["sync", "job"])
				.optional()
				.describe(
					"Use sync for one-shot responses or job for async research execution.",
				),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("How long to wait for Oracle to finish."),
			pollIntervalMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Polling interval while waiting for Oracle job completion."),
			includeRaw: z
				.boolean()
				.optional()
				.describe("Include the raw Nia response in the tool output."),
		}),
		execute: async (input: NiaOracleToolInput): Promise<NiaToolResult> => {
			const request: NiaOracleRequest = {
				...options.defaultRequest,
				...input,
			};

			const executionMode =
				input.executionMode ?? options.defaultExecutionMode ?? "sync";

			const result =
				executionMode === "job"
					? await client.runJob(request, {
							timeoutMs: input.timeoutMs ?? options.timeoutMs,
							pollIntervalMs: input.pollIntervalMs ?? options.pollIntervalMs,
						})
					: await client.run(request, {
							timeoutMs: input.timeoutMs ?? options.timeoutMs,
						});

			return maybeOmitRaw(
				result,
				input.includeRaw ?? options.includeRawByDefault ?? false,
			);
		},
	});
}

export function createDocumentAgentTool(
	options: CreateDocumentAgentToolOptions,
): Tool<NiaDocumentAgentToolInput, NiaDocumentAgentToolResult> {
	const client = new NiaDocumentAgentClient(options);

	return tool({
		description:
			options.description ??
			"Use Nia Document Agent to research indexed PDFs or documents with page-level citations and optional structured extraction.",
		inputSchema: z.object({
			query: z.string().min(1).max(10_000).describe("The document question."),
			sourceId: z
				.string()
				.optional()
				.describe("Single indexed document source ID."),
			sourceIds: z
				.array(z.string())
				.max(10)
				.optional()
				.describe(
					"Multiple indexed document source IDs for multi-document queries.",
				),
			jsonSchema: jsonSchemaInput
				.optional()
				.describe("Optional JSON Schema for structured extraction."),
			model: z
				.string()
				.optional()
				.describe("Optional Document Agent model override."),
			thinkingEnabled: z
				.boolean()
				.optional()
				.describe("Enable or disable extended thinking."),
			thinkingBudget: z
				.number()
				.int()
				.min(1000)
				.max(50_000)
				.optional()
				.describe("Thinking token budget."),
			timeoutMs: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("How long to wait for Document Agent to finish."),
			includeRaw: z
				.boolean()
				.optional()
				.describe("Include the raw Nia response in the tool output."),
		}),
		execute: async (
			input: NiaDocumentAgentToolInput,
		): Promise<NiaDocumentAgentToolResult> => {
			const result = await client.run(
				{
					...options.defaultRequest,
					...input,
				},
				{
					timeoutMs: input.timeoutMs ?? options.timeoutMs,
				},
			);

			return maybeOmitRaw(
				result,
				input.includeRaw ?? options.includeRawByDefault ?? false,
			) as NiaDocumentAgentToolResult;
		},
	});
}

export function createNiaResearchTools(
	options: CreateNiaResearchToolsOptions,
): {
	tracer?: Tool<NiaTracerToolInput, NiaToolResult>;
	oracle?: Tool<NiaOracleToolInput, NiaToolResult>;
	documentAgent?: Tool<NiaDocumentAgentToolInput, NiaDocumentAgentToolResult>;
} {
	const { tracer, oracle, documentAgent, ...sharedTransport } = options;

	return {
		...(tracer === false
			? {}
			: {
					tracer: createTracerTool(
						mergeTransport(sharedTransport, tracer, "tracer"),
					),
				}),
		...(oracle === false
			? {}
			: {
					oracle: createOracleTool(
						mergeTransport(sharedTransport, oracle, "oracle"),
					),
				}),
		...(documentAgent === false
			? {}
			: {
					documentAgent: createDocumentAgentTool(
						mergeTransport(sharedTransport, documentAgent, "documentAgent"),
					),
				}),
	};
}

function mergeTransport<T extends Partial<NiaTransportOptions>>(
	shared: Partial<NiaTransportOptions>,
	service: T | undefined,
	name: string,
): T & NiaTransportOptions {
	const merged = { ...shared, ...service };

	if (!merged.apiKey) {
		throw new Error(
			`Missing apiKey for ${name}. Provide it at the top level or per-service.`,
		);
	}

	return merged as T & NiaTransportOptions;
}

function maybeOmitRaw<T extends { raw: unknown }>(
	result: T,
	includeRaw: boolean,
): T | Omit<T, "raw"> {
	if (includeRaw) {
		return result;
	}

	const { raw: _raw, ...rest } = result;
	return rest;
}
