import { NiaTransport } from "../transport/client";
import { normalizeDocumentAgentResult } from "../transport/normalize";
import { parseSSEStream } from "../transport/sse";
import type {
	NiaDocumentAgentEvent,
	NiaDocumentAgentRequest,
	NiaDocumentAgentResult,
	NiaRequestOptions,
	NiaTransportOptions,
} from "../types";

export class NiaDocumentAgentClient {
	private readonly transport: NiaTransport;

	constructor(options: NiaTransportOptions | NiaTransport) {
		this.transport =
			options instanceof NiaTransport ? options : new NiaTransport(options);
	}

	async run(
		request: NiaDocumentAgentRequest,
		requestOptions?: NiaRequestOptions,
	): Promise<NiaDocumentAgentResult> {
		const raw = await this.transport.postJson<Record<string, unknown>>(
			"/document/agent",
			buildDocumentAgentBody(request, false),
			requestOptions,
		);

		return normalizeDocumentAgentResult(raw);
	}

	async stream(
		request: Omit<NiaDocumentAgentRequest, "stream">,
		requestOptions?: NiaRequestOptions,
	): Promise<AsyncGenerator<NiaDocumentAgentEvent>> {
		const stream = await this.transport.openStream(
			"/document/agent",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(buildDocumentAgentBody(request, true)),
			},
			requestOptions,
		);

		return parseSSEStream(stream);
	}
}

function buildDocumentAgentBody(
	request: NiaDocumentAgentRequest,
	stream: boolean,
): Record<string, unknown> {
	validateDocumentAgentSources(request);

	return {
		source_id: request.sourceId,
		source_ids: request.sourceIds,
		query: request.query,
		json_schema: request.jsonSchema,
		model: request.model,
		thinking_enabled: request.thinkingEnabled,
		thinking_budget: request.thinkingBudget,
		stream,
	};
}

function validateDocumentAgentSources(request: NiaDocumentAgentRequest): void {
	const hasSourceId =
		typeof request.sourceId === "string" && request.sourceId.trim().length > 0;
	const hasSourceIds =
		Array.isArray(request.sourceIds) && request.sourceIds.length > 0;

	if (!hasSourceId && !hasSourceIds) {
		throw new Error("Document Agent requires either sourceId or sourceIds.");
	}

	if (hasSourceId && hasSourceIds) {
		throw new Error(
			"Document Agent accepts either sourceId or sourceIds, but not both.",
		);
	}
}
