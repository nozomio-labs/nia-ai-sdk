export class NiaAPIError extends Error {
	readonly statusCode: number;
	readonly statusText: string;
	readonly body: string;
	readonly headers: Record<string, string>;

	constructor(options: {
		message: string;
		statusCode: number;
		statusText: string;
		body: string;
		headers: Record<string, string>;
	}) {
		super(options.message);
		this.name = "NiaAPIError";
		this.statusCode = options.statusCode;
		this.statusText = options.statusText;
		this.body = options.body;
		this.headers = options.headers;
	}

	static async fromResponse(response: Response): Promise<NiaAPIError> {
		const body = await response.text();
		const headers = Object.fromEntries(response.headers.entries());
		const message =
			body.trim().length > 0
				? `Nia API request failed with ${response.status} ${response.statusText}: ${body}`
				: `Nia API request failed with ${response.status} ${response.statusText}`;

		return new NiaAPIError({
			message,
			statusCode: response.status,
			statusText: response.statusText,
			body,
			headers,
		});
	}
}

export class NiaTimeoutError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`Nia request timed out after ${timeoutMs}ms`);
		this.name = "NiaTimeoutError";
		this.timeoutMs = timeoutMs;
	}
}

export class NiaJobTimeoutError extends Error {
	readonly timeoutMs: number;
	readonly jobId: string;

	constructor(jobId: string, timeoutMs: number) {
		super(`Nia job ${jobId} did not complete within ${timeoutMs}ms`);
		this.name = "NiaJobTimeoutError";
		this.jobId = jobId;
		this.timeoutMs = timeoutMs;
	}
}
