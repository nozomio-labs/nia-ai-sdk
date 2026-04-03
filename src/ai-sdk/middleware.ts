import { type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { NiaDocumentAgentClient } from "../document-agent/client";
import { NiaOracleClient } from "../oracle/client";
import { NiaTracerClient } from "../tracer/client";
import type {
	NiaDocumentAgentRequest,
	NiaMiddlewareContext,
	NiaOracleRequest,
	NiaResearchResult,
	NiaTracerRequest,
} from "../types";
import type {
	CreateDocumentAgentToolOptions,
	CreateOracleToolOptions,
	CreateTracerToolOptions,
} from "./tools";

type MinimalPrompt = Array<{
	role: string;
	content: unknown;
	providerOptions?: unknown;
}>;

type ModelArgument = Parameters<typeof wrapLanguageModel>[0]["model"];

interface BaseMiddlewareOptions {
	shouldUse?: (context: NiaMiddlewareContext) => boolean | Promise<boolean>;
	createQuery?: (context: NiaMiddlewareContext) => string | Promise<string>;
	formatContext?: (result: NiaResearchResult) => string;
}

export interface CreateTracerMiddlewareOptions
	extends CreateTracerToolOptions,
		BaseMiddlewareOptions {}

export interface CreateOracleMiddlewareOptions
	extends CreateOracleToolOptions,
		BaseMiddlewareOptions {}

export interface CreateDocumentAgentMiddlewareOptions
	extends CreateDocumentAgentToolOptions,
		BaseMiddlewareOptions {}

export function createTracerMiddleware(
	options: CreateTracerMiddlewareOptions,
): LanguageModelMiddleware {
	const client = new NiaTracerClient(options);

	return {
		specificationVersion: "v3",
		transformParams: async ({ params, type }) => {
			const lastUserMessage = getLastUserMessageText(
				params.prompt as MinimalPrompt,
			);
			if (lastUserMessage == null) {
				return params;
			}

			const context: NiaMiddlewareContext = {
				type,
				lastUserMessage,
			};

			if ((await options.shouldUse?.(context)) === false) {
				return params;
			}

			const query = await options.createQuery?.(context);
			const result = await client.run(
				{
					...options.defaultRequest,
					query: query ?? lastUserMessage,
				} satisfies NiaTracerRequest,
				{
					timeoutMs: options.timeoutMs,
					pollIntervalMs: options.pollIntervalMs,
				},
			);

			return {
				...params,
				prompt: addToLastUserMessage(
					params.prompt as MinimalPrompt,
					options.formatContext?.(result) ??
						formatGroundingBlock("Nia Tracer", result),
				) as typeof params.prompt,
			};
		},
	};
}

export function createOracleMiddleware(
	options: CreateOracleMiddlewareOptions,
): LanguageModelMiddleware {
	const client = new NiaOracleClient(options);

	return {
		specificationVersion: "v3",
		transformParams: async ({ params, type }) => {
			const lastUserMessage = getLastUserMessageText(
				params.prompt as MinimalPrompt,
			);
			if (lastUserMessage == null) {
				return params;
			}

			const context: NiaMiddlewareContext = {
				type,
				lastUserMessage,
			};

			if ((await options.shouldUse?.(context)) === false) {
				return params;
			}

			const query = await options.createQuery?.(context);
			const result = await client.run(
				{
					...options.defaultRequest,
					query: query ?? lastUserMessage,
				} satisfies NiaOracleRequest,
				{
					timeoutMs: options.timeoutMs,
				},
			);

			return {
				...params,
				prompt: addToLastUserMessage(
					params.prompt as MinimalPrompt,
					options.formatContext?.(result) ??
						formatGroundingBlock("Nia Oracle", result),
				) as typeof params.prompt,
			};
		},
	};
}

export function createDocumentAgentMiddleware(
	options: CreateDocumentAgentMiddlewareOptions,
): LanguageModelMiddleware {
	const client = new NiaDocumentAgentClient(options);

	return {
		specificationVersion: "v3",
		transformParams: async ({ params, type }) => {
			const lastUserMessage = getLastUserMessageText(
				params.prompt as MinimalPrompt,
			);
			if (lastUserMessage == null) {
				return params;
			}

			const context: NiaMiddlewareContext = {
				type,
				lastUserMessage,
			};

			if ((await options.shouldUse?.(context)) === false) {
				return params;
			}

			const query = await options.createQuery?.(context);
			const result = await client.run(
				{
					...options.defaultRequest,
					query: query ?? lastUserMessage,
				} satisfies NiaDocumentAgentRequest,
				{
					timeoutMs: options.timeoutMs,
				},
			);

			return {
				...params,
				prompt: addToLastUserMessage(
					params.prompt as MinimalPrompt,
					options.formatContext?.(result) ??
						formatGroundingBlock("Nia Document Agent", result),
				) as typeof params.prompt,
			};
		},
	};
}

export function withTracerContext(
	model: ModelArgument,
	options: CreateTracerMiddlewareOptions,
): ModelArgument {
	return wrapLanguageModel({
		model,
		middleware: createTracerMiddleware(options),
	});
}

export function withOracleContext(
	model: ModelArgument,
	options: CreateOracleMiddlewareOptions,
): ModelArgument {
	return wrapLanguageModel({
		model,
		middleware: createOracleMiddleware(options),
	});
}

export function withDocumentAgentContext(
	model: ModelArgument,
	options: CreateDocumentAgentMiddlewareOptions,
): ModelArgument {
	return wrapLanguageModel({
		model,
		middleware: createDocumentAgentMiddleware(options),
	});
}

function getLastUserMessageText(prompt: MinimalPrompt): string | null {
	for (let index = prompt.length - 1; index >= 0; index -= 1) {
		const message = prompt[index];
		if (message?.role !== "user" || !Array.isArray(message.content)) {
			continue;
		}

		const text = message.content
			.filter(isTextPart)
			.map((part) => part.text)
			.join("\n")
			.trim();

		if (text.length > 0) {
			return text;
		}
	}

	return null;
}

function addToLastUserMessage(
	prompt: MinimalPrompt,
	text: string,
): MinimalPrompt {
	const nextPrompt = [...prompt];

	for (let index = nextPrompt.length - 1; index >= 0; index -= 1) {
		const message = nextPrompt[index];
		if (message?.role !== "user" || !Array.isArray(message.content)) {
			continue;
		}

		nextPrompt[index] = {
			...message,
			content: [
				...message.content,
				{
					type: "text",
					text: `\n\n${text}`,
				},
			],
		};

		return nextPrompt;
	}

	nextPrompt.push({
		role: "user",
		content: [{ type: "text", text }],
	});

	return nextPrompt;
}

function formatGroundingBlock(
	label: string,
	result: NiaResearchResult,
): string {
	const citations =
		result.citations.length === 0
			? "No citations were provided."
			: result.citations.map((citation) => `- ${citation}`).join("\n");

	return [
		`Grounding from ${label}:`,
		result.text ?? "No final answer text was returned.",
		"",
		"Citations:",
		citations,
	].join("\n");
}

function isTextPart(value: unknown): value is {
	type: "text";
	text: string;
} {
	return (
		typeof value === "object" &&
		value != null &&
		"type" in value &&
		(value as { type?: unknown }).type === "text" &&
		"text" in value &&
		typeof (value as { text?: unknown }).text === "string"
	);
}
