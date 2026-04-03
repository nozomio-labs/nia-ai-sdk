import { NiaAPIError, NiaTimeoutError } from "../errors";
import {
	DEFAULT_INITIAL_BACKOFF_MS,
	DEFAULT_MAX_RETRIES,
	DEFAULT_NIA_BASE_URL,
	DEFAULT_TIMEOUT_MS,
	type FetchLike,
	type NiaRequestOptions,
	type NiaTransportOptions,
} from "../types";

export class NiaTransport {
	readonly apiKey: string;
	readonly baseURL: string;
	readonly headers: Record<string, string>;
	readonly fetch: FetchLike;
	readonly maxRetries: number;
	readonly initialBackoffMs: number;
	readonly defaultTimeoutMs: number;

	constructor(options: NiaTransportOptions) {
		this.apiKey = options.apiKey;
		this.baseURL = stripTrailingSlash(options.baseURL ?? DEFAULT_NIA_BASE_URL);
		this.headers = options.headers ?? {};
		this.fetch = options.fetch ?? globalThis.fetch;
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		this.initialBackoffMs =
			options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
		this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	async getJson<T>(
		path: string,
		requestOptions?: NiaRequestOptions,
	): Promise<T> {
		const response = await this.request(
			path,
			{ method: "GET" },
			requestOptions,
		);
		return parseJsonResponse<T>(response);
	}

	async postJson<T>(
		path: string,
		body?: unknown,
		requestOptions?: NiaRequestOptions,
	): Promise<T> {
		const response = await this.request(
			path,
			{
				method: "POST",
				body: body == null ? undefined : JSON.stringify(body),
				headers:
					body == null ? undefined : { "Content-Type": "application/json" },
			},
			requestOptions,
		);

		return parseJsonResponse<T>(response);
	}

	async openStream(
		path: string,
		init: RequestInit,
		requestOptions?: NiaRequestOptions,
	): Promise<ReadableStream<Uint8Array>> {
		const response = await this.request(path, init, requestOptions);

		if (response.body == null) {
			throw new Error(`Nia stream response for ${path} did not include a body`);
		}

		return response.body;
	}

	private async request(
		path: string,
		init: RequestInit,
		requestOptions?: NiaRequestOptions,
	): Promise<Response> {
		const url = `${this.baseURL}${path}`;
		const timeoutMs = requestOptions?.timeoutMs ?? this.defaultTimeoutMs;
		const method = init.method ?? "GET";

		for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
			const timeoutController = new AbortController();
			const abortListeners = bindAbortSignal(
				requestOptions?.abortSignal,
				timeoutController,
			);
			const timer = timeoutMs
				? setTimeout(
						() => timeoutController.abort(new NiaTimeoutError(timeoutMs)),
						timeoutMs,
					)
				: undefined;

			try {
				const response = await this.fetch(url, {
					...init,
					method,
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						...this.headers,
						...(init.headers ?? {}),
						...(requestOptions?.headers ?? {}),
					},
					signal: timeoutController.signal,
				});

				if (response.ok) {
					return response;
				}

				if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
					await sleep(
						getRetryDelayMs(response, this.initialBackoffMs, attempt),
						{
							abortSignal: requestOptions?.abortSignal,
						},
					);
					continue;
				}

				throw await NiaAPIError.fromResponse(response);
			} catch (error) {
				if (timeoutController.signal.aborted) {
					const reason = timeoutController.signal.reason;
					if (reason instanceof NiaTimeoutError) {
						throw reason;
					}
					throw reason instanceof Error ? reason : new Error(String(reason));
				}

				if (
					attempt < this.maxRetries &&
					isRetryableError(error) &&
					!requestOptions?.abortSignal?.aborted
				) {
					await sleep(this.initialBackoffMs * 2 ** attempt, {
						abortSignal: requestOptions?.abortSignal,
					});
					continue;
				}

				throw error;
			} finally {
				if (timer != null) {
					clearTimeout(timer);
				}
				abortListeners();
			}
		}

		throw new Error("Unreachable Nia transport state");
	}
}

export async function sleep(
	delayMs: number,
	options?: { abortSignal?: AbortSignal },
): Promise<void> {
	if (delayMs <= 0) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		const abortSignal = options?.abortSignal;

		if (abortSignal == null) {
			return;
		}

		if (abortSignal.aborted) {
			clearTimeout(timer);
			reject(abortSignal.reason);
			return;
		}

		const onAbort = () => {
			clearTimeout(timer);
			reject(abortSignal.reason);
		};

		abortSignal.addEventListener("abort", onAbort, { once: true });
	});
}

function bindAbortSignal(
	abortSignal: AbortSignal | undefined,
	controller: AbortController,
): () => void {
	if (abortSignal == null) {
		return () => {};
	}

	if (abortSignal.aborted) {
		controller.abort(abortSignal.reason);
		return () => {};
	}

	const onAbort = () => controller.abort(abortSignal.reason);
	abortSignal.addEventListener("abort", onAbort, { once: true });

	return () => abortSignal.removeEventListener("abort", onAbort);
}

function stripTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
	const text = await response.text();
	return text.trim().length === 0 ? (undefined as T) : (JSON.parse(text) as T);
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

function isRetryableError(error: unknown): boolean {
	if (error instanceof NiaAPIError) {
		return isRetryableStatus(error.statusCode);
	}

	return error instanceof TypeError || error instanceof DOMException;
}

function getRetryDelayMs(
	response: Response,
	initialBackoffMs: number,
	attempt: number,
): number {
	const retryAfter = response.headers.get("retry-after");

	if (retryAfter != null) {
		const seconds = Number.parseFloat(retryAfter);
		if (Number.isFinite(seconds)) {
			return seconds * 1_000;
		}

		const absoluteTime = Date.parse(retryAfter);
		if (Number.isFinite(absoluteTime)) {
			return Math.max(absoluteTime - Date.now(), initialBackoffMs);
		}
	}

	return initialBackoffMs * 2 ** attempt;
}
