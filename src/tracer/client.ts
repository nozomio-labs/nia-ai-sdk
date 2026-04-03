import { NiaJobTimeoutError } from "../errors";
import { NiaTransport, sleep } from "../transport/client";
import {
	getStatus,
	isTerminalStatus,
	normalizeResearchResult,
} from "../transport/normalize";
import { parseSSEStream } from "../transport/sse";
import {
	DEFAULT_POLL_INTERVAL_MS,
	DEFAULT_TIMEOUT_MS,
	type NiaJobHandle,
	type NiaRequestOptions,
	type NiaResearchResult,
	type NiaTracerEvent,
	type NiaTracerRequest,
	type NiaTransportOptions,
	type NiaWaitOptions,
} from "../types";

export class NiaTracerClient {
	private readonly transport: NiaTransport;

	constructor(options: NiaTransportOptions | NiaTransport) {
		this.transport =
			options instanceof NiaTransport ? options : new NiaTransport(options);
	}

	async createJob(
		request: NiaTracerRequest,
		requestOptions?: NiaRequestOptions,
	): Promise<NiaJobHandle> {
		const raw = await this.transport.postJson<Record<string, unknown>>(
			"/github/tracer",
			{
				query: request.query,
				repositories: request.repositories,
				context: request.context,
				mode: request.mode,
				model: request.model,
			},
			requestOptions,
		);

		return {
			jobId: readString(raw, ["job_id", "jobId"]) ?? "",
			sessionId: readString(raw, ["session_id", "sessionId"]) ?? undefined,
			status: getStatus(raw) ?? undefined,
			raw,
		};
	}

	async getJob(
		jobId: string,
		requestOptions?: NiaRequestOptions,
	): Promise<Record<string, unknown>> {
		return this.transport.getJson<Record<string, unknown>>(
			`/github/tracer/${jobId}`,
			requestOptions,
		);
	}

	async streamJob(
		jobId: string,
		requestOptions?: NiaRequestOptions,
	): Promise<AsyncGenerator<NiaTracerEvent>> {
		const stream = await this.transport.openStream(
			`/github/tracer/${jobId}/stream`,
			{ method: "GET" },
			requestOptions,
		);

		return parseSSEStream(stream);
	}

	async run(
		request: NiaTracerRequest,
		waitOptions?: NiaWaitOptions,
	): Promise<NiaResearchResult> {
		const job = await this.createJob(request, waitOptions);
		if (!job.jobId) {
			return normalizeResearchResult(job.raw, job);
		}

		return this.waitForResult(job, waitOptions);
	}

	async waitForResult(
		job: NiaJobHandle,
		waitOptions?: NiaWaitOptions,
	): Promise<NiaResearchResult> {
		const timeoutMs = waitOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const pollIntervalMs =
			waitOptions?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		const startedAt = Date.now();

		while (Date.now() - startedAt <= timeoutMs) {
			const raw = await this.getJob(job.jobId, waitOptions);
			const status = getStatus(raw);
			const normalized = normalizeResearchResult(raw, {
				jobId: job.jobId,
				sessionId: job.sessionId,
				status: status ?? job.status,
			});

			if (isTerminalStatus(status)) {
				return normalized;
			}

			if (status == null && normalized.text != null) {
				return normalized;
			}

			await sleep(pollIntervalMs, { abortSignal: waitOptions?.abortSignal });
		}

		throw new NiaJobTimeoutError(job.jobId, timeoutMs);
	}
}

function readString(
	value: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate;
		}
	}

	return null;
}
