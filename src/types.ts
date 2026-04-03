export const DEFAULT_NIA_BASE_URL = "https://apigcp.trynia.ai/v2";
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_INITIAL_BACKOFF_MS = 500;
export const DEFAULT_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_TIMEOUT_MS = 60_000;

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface NiaTransportOptions {
	apiKey: string;
	baseURL?: string;
	headers?: Record<string, string>;
	fetch?: FetchLike;
	maxRetries?: number;
	initialBackoffMs?: number;
	defaultTimeoutMs?: number;
}

export interface NiaRequestOptions {
	abortSignal?: AbortSignal;
	headers?: Record<string, string>;
	timeoutMs?: number;
}

export interface NiaWaitOptions extends NiaRequestOptions {
	pollIntervalMs?: number;
}

export type NiaTracerMode = "tracer-fast" | "tracer-deep";

export type NiaTracerModel =
	| "claude-haiku-4-5-20251001"
	| "claude-opus-4-6"
	| "claude-opus-4-6-1m";

export type NiaOracleModel =
	| "claude-opus-4-6"
	| "claude-opus-4-6-1m"
	| "claude-sonnet-4-5-20250929"
	| "claude-sonnet-4-5-1m";

export type NiaDocumentAgentModel = string;

export interface NiaTracerRequest {
	query: string;
	repositories?: string[];
	context?: string;
	mode?: NiaTracerMode;
	model?: NiaTracerModel;
}

export interface NiaOracleRequest {
	query: string;
	repositories?: string[];
	dataSources?: string[];
	outputFormat?: string;
	model?: NiaOracleModel;
}

export interface NiaOracleSessionChatRequest {
	sessionId: string;
	message: string;
}

export interface NiaDocumentAgentRequest {
	query: string;
	sourceId?: string;
	sourceIds?: string[];
	jsonSchema?: Record<string, unknown>;
	model?: NiaDocumentAgentModel;
	thinkingEnabled?: boolean;
	thinkingBudget?: number;
	stream?: boolean;
}

export interface NiaJobHandle {
	jobId: string;
	sessionId?: string;
	status?: string;
	raw: unknown;
}

export interface NiaResearchResult {
	text: string | null;
	citations: string[];
	status?: string;
	jobId?: string;
	sessionId?: string;
	raw: unknown;
}

export interface NiaSSEEvent<TData = unknown> {
	event: string;
	data: TData;
	id?: string;
	raw: string;
}

export type NiaTracerEvent<TData = unknown> = NiaSSEEvent<TData>;
export type NiaOracleEvent<TData = unknown> = NiaSSEEvent<TData>;
export type NiaDocumentAgentEvent<TData = unknown> = NiaSSEEvent<TData>;

export interface NiaStreamSession<TEvent> {
	job: NiaJobHandle;
	events: AsyncGenerator<TEvent>;
}

export interface NiaSessionStream<TEvent> {
	sessionId: string;
	events: AsyncGenerator<TEvent>;
}

export interface NiaDirectStream<TEvent> {
	events: AsyncGenerator<TEvent>;
}

export interface NiaToolResult extends Omit<NiaResearchResult, "raw"> {
	raw?: unknown;
}

export interface NiaDocumentCitation {
	content: string;
	pageNumber?: number | null;
	sectionId?: string | null;
	sectionTitle?: string | null;
	sectionPath?: string[] | null;
	toolSource: string;
	sourceId?: string | null;
	sourceName?: string | null;
}

export interface NiaDocumentUsage {
	inputTokens?: number;
	outputTokens?: number;
	thinkingTokens?: number;
	[key: string]: number | undefined;
}

export interface NiaDocumentAgentResult extends NiaResearchResult {
	documentCitations: NiaDocumentCitation[];
	structuredOutput?: Record<string, unknown> | null;
	model?: string;
	usage?: NiaDocumentUsage | null;
}

export interface NiaDocumentAgentToolResult
	extends Omit<NiaDocumentAgentResult, "raw"> {
	raw?: unknown;
}

export interface NiaTracerToolInput extends NiaTracerRequest {
	includeRaw?: boolean;
	pollIntervalMs?: number;
	timeoutMs?: number;
}

export type NiaOracleExecutionMode = "sync" | "job";

export interface NiaOracleToolInput extends NiaOracleRequest {
	executionMode?: NiaOracleExecutionMode;
	includeRaw?: boolean;
	pollIntervalMs?: number;
	timeoutMs?: number;
}

export interface NiaDocumentAgentToolInput
	extends Omit<NiaDocumentAgentRequest, "stream"> {
	includeRaw?: boolean;
	timeoutMs?: number;
}

export interface NiaMiddlewareContext {
	type: "generate" | "stream";
	lastUserMessage: string;
}
