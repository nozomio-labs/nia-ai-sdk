import { NiaDocumentAgentClient } from "../document-agent/client";
import { NiaOracleClient } from "../oracle/client";
import { NiaTracerClient } from "../tracer/client";
import type {
	NiaDirectStream,
	NiaDocumentAgentEvent,
	NiaDocumentAgentRequest,
	NiaOracleEvent,
	NiaOracleRequest,
	NiaOracleSessionChatRequest,
	NiaRequestOptions,
	NiaSessionStream,
	NiaStreamSession,
	NiaTracerEvent,
	NiaTracerRequest,
	NiaTransportOptions,
} from "../types";

export async function streamTracer(
	options: NiaTransportOptions,
	request: NiaTracerRequest,
	requestOptions?: NiaRequestOptions,
): Promise<NiaStreamSession<NiaTracerEvent>> {
	const client = new NiaTracerClient(options);
	const job = await client.createJob(request, requestOptions);

	return {
		job,
		events: await client.streamJob(job.jobId, requestOptions),
	};
}

export async function streamDocumentAgent(
	options: NiaTransportOptions,
	request: Omit<NiaDocumentAgentRequest, "stream">,
	requestOptions?: NiaRequestOptions,
): Promise<NiaDirectStream<NiaDocumentAgentEvent>> {
	const client = new NiaDocumentAgentClient(options);

	return {
		events: await client.stream(request, requestOptions),
	};
}

export async function streamOracle(
	options: NiaTransportOptions,
	request: NiaOracleRequest,
	requestOptions?: NiaRequestOptions,
): Promise<NiaStreamSession<NiaOracleEvent>> {
	const client = new NiaOracleClient(options);
	const job = await client.createJob(request, requestOptions);

	return {
		job,
		events: await client.streamJob(job.jobId, requestOptions),
	};
}

export async function streamOracleSessionChat(
	options: NiaTransportOptions,
	request: NiaOracleSessionChatRequest,
	requestOptions?: NiaRequestOptions,
): Promise<NiaSessionStream<NiaOracleEvent>> {
	const client = new NiaOracleClient(options);

	return {
		sessionId: request.sessionId,
		events: await client.streamSessionChat(request, requestOptions),
	};
}
