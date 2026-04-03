import type {
	NiaDocumentAgentResult,
	NiaDocumentCitation,
	NiaJobHandle,
	NiaResearchResult,
} from "../types";

const TEXT_KEYS = [
	"answer",
	"report",
	"result",
	"output",
	"text",
	"content",
	"summary",
	"message",
	"final_answer",
	"finalAnswer",
	"markdown",
];

const STATUS_KEYS = ["status", "state", "job_status", "jobStatus"];

const CITATION_KEYS = [
	"citations",
	"sources",
	"references",
	"files",
	"results",
	"matches",
];

export function normalizeResearchResult(
	raw: unknown,
	meta: Partial<NiaJobHandle> = {},
): NiaResearchResult {
	return {
		text: extractPrimaryText(raw),
		citations: extractCitations(raw),
		status: meta.status ?? getStatus(raw) ?? undefined,
		jobId: meta.jobId,
		sessionId: meta.sessionId,
		raw,
	};
}

export function normalizeDocumentAgentResult(
	raw: unknown,
	meta: Partial<NiaJobHandle> = {},
): NiaDocumentAgentResult {
	const documentCitations = extractDocumentCitations(raw);

	return {
		text: extractPrimaryText(raw),
		citations: documentCitations.map(formatDocumentCitation),
		status: meta.status ?? getStatus(raw) ?? undefined,
		jobId: meta.jobId,
		sessionId: meta.sessionId,
		documentCitations,
		structuredOutput: extractStructuredOutput(raw),
		model: findFirstStringByKeys(raw, ["model"]) ?? undefined,
		usage: extractUsage(raw),
		raw,
	};
}

export function getStatus(raw: unknown): string | null {
	return findFirstStringAtKeys(raw, STATUS_KEYS);
}

export function isTerminalStatus(status: string | null | undefined): boolean {
	if (status == null) {
		return false;
	}

	return new Set([
		"completed",
		"complete",
		"succeeded",
		"success",
		"finished",
		"failed",
		"error",
		"cancelled",
		"canceled",
	]).has(status.toLowerCase());
}

function extractPrimaryText(raw: unknown): string | null {
	if (typeof raw === "string") {
		return raw;
	}

	const directMatch = findFirstStringByKeys(raw, TEXT_KEYS);
	if (directMatch != null) {
		return directMatch;
	}

	if (Array.isArray(raw)) {
		for (const item of raw) {
			const text = extractPrimaryText(item);
			if (text != null) {
				return text;
			}
		}
	}

	if (isRecord(raw)) {
		const messages = raw.messages;
		if (Array.isArray(messages)) {
			for (let index = messages.length - 1; index >= 0; index -= 1) {
				const text = extractPrimaryText(messages[index]);
				if (text != null) {
					return text;
				}
			}
		}
	}

	return null;
}

function extractCitations(raw: unknown): string[] {
	const collected = new Set<string>();
	collectCitations(raw, collected, 0);
	return [...collected];
}

function extractDocumentCitations(raw: unknown): NiaDocumentCitation[] {
	if (!isRecord(raw)) {
		return [];
	}

	const candidate = raw.citations;
	if (!Array.isArray(candidate)) {
		return [];
	}

	return candidate
		.map((entry) => normalizeDocumentCitation(entry))
		.filter((entry): entry is NiaDocumentCitation => entry != null);
}

function normalizeDocumentCitation(value: unknown): NiaDocumentCitation | null {
	if (!isRecord(value)) {
		return null;
	}

	const content = getOptionalString(value.content);
	const toolSource = getOptionalString(value.tool_source);

	if (content == null || toolSource == null) {
		return null;
	}

	return {
		content,
		pageNumber: getOptionalNumber(value.page_number),
		sectionId: getOptionalString(value.section_id),
		sectionTitle: getOptionalString(value.section_title),
		sectionPath: Array.isArray(value.section_path)
			? value.section_path.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: null,
		toolSource,
		sourceId: getOptionalString(value.source_id),
		sourceName: getOptionalString(value.source_name),
	};
}

function formatDocumentCitation(citation: NiaDocumentCitation): string {
	const location =
		citation.sectionPath?.join(" > ") ??
		citation.sectionTitle ??
		citation.sourceName ??
		"Document citation";

	const page =
		typeof citation.pageNumber === "number"
			? ` (page ${citation.pageNumber})`
			: "";

	return `${location}${page}`;
}

function extractStructuredOutput(
	raw: unknown,
): Record<string, unknown> | null | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const value = raw.structured_output;
	return isRecord(value) ? value : value === null ? null : undefined;
}

function extractUsage(
	raw: unknown,
): Record<string, number | undefined> | null | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const value = raw.usage;
	if (!isRecord(value)) {
		return value === null ? null : undefined;
	}

	const normalized: Record<string, number | undefined> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "number") {
			if (key === "input_tokens") {
				normalized.inputTokens = entry;
			} else if (key === "output_tokens") {
				normalized.outputTokens = entry;
			} else if (key === "thinking_tokens") {
				normalized.thinkingTokens = entry;
			}
			normalized[key] = entry;
		}
	}

	return normalized;
}

function collectCitations(
	value: unknown,
	collected: Set<string>,
	depth: number,
): void {
	if (depth > 4 || value == null) {
		return;
	}

	if (typeof value === "string") {
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectCitations(item, collected, depth + 1);
		}
		return;
	}

	if (!isRecord(value)) {
		return;
	}

	for (const key of CITATION_KEYS) {
		const candidate = value[key];
		if (candidate == null) {
			continue;
		}

		if (Array.isArray(candidate)) {
			for (const entry of candidate) {
				const citation = stringifyCitation(entry);
				if (citation != null) {
					collected.add(citation);
				}
				collectCitations(entry, collected, depth + 1);
			}
		}
	}

	for (const nested of Object.values(value)) {
		collectCitations(nested, collected, depth + 1);
	}
}

function stringifyCitation(value: unknown): string | null {
	if (typeof value === "string") {
		return value;
	}

	if (!isRecord(value)) {
		return null;
	}

	for (const key of [
		"url",
		"path",
		"file_path",
		"filePath",
		"title",
		"identifier",
	]) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate;
		}
	}

	return null;
}

function findFirstStringByKeys(
	value: unknown,
	keys: string[],
	depth = 0,
): string | null {
	if (depth > 5 || value == null) {
		return null;
	}

	if (typeof value === "string") {
		return value.trim().length > 0 ? value : null;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const match = findFirstStringByKeys(item, keys, depth + 1);
			if (match != null) {
				return match;
			}
		}
		return null;
	}

	if (!isRecord(value)) {
		return null;
	}

	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate;
		}

		if (isRecord(candidate)) {
			for (const nestedKey of keys) {
				const nestedCandidate = candidate[nestedKey];
				if (
					typeof nestedCandidate === "string" &&
					nestedCandidate.trim().length > 0
				) {
					return nestedCandidate;
				}
			}
		}
	}

	for (const nested of Object.values(value)) {
		const match = findFirstStringByKeys(nested, keys, depth + 1);
		if (match != null) {
			return match;
		}
	}

	return null;
}

function findFirstStringAtKeys(
	value: unknown,
	keys: string[],
	depth = 0,
): string | null {
	if (depth > 5 || value == null) {
		return null;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const match = findFirstStringAtKeys(item, keys, depth + 1);
			if (match != null) {
				return match;
			}
		}
		return null;
	}

	if (!isRecord(value)) {
		return null;
	}

	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate;
		}
	}

	for (const nested of Object.values(value)) {
		const match = findFirstStringAtKeys(nested, keys, depth + 1);
		if (match != null) {
			return match;
		}
	}

	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value != null;
}

function getOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getOptionalNumber(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}
