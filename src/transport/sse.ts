import type { NiaSSEEvent } from "../types";

export async function* parseSSEStream<TData = unknown>(
	stream: ReadableStream<Uint8Array>,
): AsyncGenerator<NiaSSEEvent<TData>> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const chunks = splitSSEChunks(buffer);
			buffer = chunks.remainder;

			for (const chunk of chunks.messages) {
				const parsed = parseSSEChunk<TData>(chunk);
				if (parsed != null) {
					yield parsed;
				}
			}
		}

		buffer += decoder.decode();
		const finalChunk = buffer.trim();
		if (finalChunk.length > 0) {
			const parsed = parseSSEChunk<TData>(finalChunk);
			if (parsed != null) {
				yield parsed;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function splitSSEChunks(input: string): {
	messages: string[];
	remainder: string;
} {
	const normalized = input.replaceAll("\r\n", "\n");
	const parts = normalized.split("\n\n");

	if (parts.length === 1) {
		return { messages: [], remainder: normalized };
	}

	return {
		messages: parts.slice(0, -1).filter((part) => part.trim().length > 0),
		remainder: parts.at(-1) ?? "",
	};
}

function parseSSEChunk<TData>(chunk: string): NiaSSEEvent<TData> | null {
	let event = "message";
	let id: string | undefined;
	const dataLines: string[] = [];

	for (const line of chunk.split("\n")) {
		if (line.length === 0 || line.startsWith(":")) {
			continue;
		}

		const separatorIndex = line.indexOf(":");
		const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
		const rawValue =
			separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).trimStart();

		switch (field) {
			case "event":
				event = rawValue;
				break;
			case "id":
				id = rawValue;
				break;
			case "data":
				dataLines.push(rawValue);
				break;
			default:
				break;
		}
	}

	if (dataLines.length === 0) {
		return null;
	}

	const raw = dataLines.join("\n");
	return {
		event,
		id,
		raw,
		data: parseEventData<TData>(raw),
	};
}

function parseEventData<TData>(raw: string): TData {
	try {
		return JSON.parse(raw) as TData;
	} catch {
		return raw as TData;
	}
}
