type ServiceKind = "tracer" | "oracle" | "documentAgent";
type StreamKind = "tracer" | "oracle" | "document-agent";
type OutputState = "idle" | "running" | "done" | "error";

interface DemoPayload {
	service: ServiceKind;
	prompt: string;
	repositories?: string[];
	dataSources?: string[];
	sourceId?: string;
	sourceIds?: string[];
	mode?: "tracer-fast" | "tracer-deep";
	outputFormat?: string;
	thinkingEnabled?: boolean;
	thinkingBudget?: number;
}

interface StreamPayload extends Omit<DemoPayload, "service"> {
	kind: StreamKind;
}

// ── DOM references ────────────────────────────────

const statusBar = must<HTMLElement>("#statusBar");
const toolsForm = must<HTMLFormElement>("#toolsForm");
const middlewareForm = must<HTMLFormElement>("#middlewareForm");
const streamForm = must<HTMLFormElement>("#streamForm");
const toolsOutput = must<HTMLPreElement>("#toolsOutput");
const middlewareOutput = must<HTMLPreElement>("#middlewareOutput");
const streamOutput = must<HTMLPreElement>("#streamOutput");
const toolsState = must<HTMLElement>("#toolsState");
const middlewareState = must<HTMLElement>("#middlewareState");
const streamState = must<HTMLElement>("#streamState");
const stopStreamButton = must<HTMLButtonElement>("#stopStreamButton");

let activeStreamController: AbortController | null = null;

// ── Initialize ────────────────────────────────────

initTabs();
await refreshConfig();

// ── Tabs ──────────────────────────────────────────

function initTabs(): void {
	const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
	const panels = document.querySelectorAll<HTMLElement>(".panel");
	const ink = document.querySelector<HTMLElement>(".tab-ink");

	function positionInk(tab: HTMLButtonElement, animate: boolean): void {
		if (!ink) return;
		if (!animate) ink.style.transition = "none";
		ink.style.left = `${tab.offsetLeft}px`;
		ink.style.width = `${tab.offsetWidth}px`;
		if (!animate) {
			ink.offsetHeight;
			ink.style.transition = "";
		}
	}

	function activate(tab: HTMLButtonElement): void {
		const target = tab.dataset.tab!;
		tabs.forEach((t) => {
			t.classList.toggle("active", t === tab);
			t.setAttribute("aria-selected", String(t === tab));
		});
		panels.forEach((p) =>
			p.classList.toggle("active", p.id === `${target}-panel`),
		);
		positionInk(tab, true);
	}

	tabs.forEach((t) => t.addEventListener("click", () => activate(t)));

	const active = document.querySelector<HTMLButtonElement>(".tab.active");
	if (active) {
		document.fonts.ready.then(() => positionInk(active, false));
	}

	window.addEventListener("resize", () => {
		const current = document.querySelector<HTMLButtonElement>(".tab.active");
		if (current) positionInk(current, false);
	});
}

// ── Event handlers ────────────────────────────────

toolsForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	setOutputState(toolsState, "running");
	toolsOutput.textContent = "";
	setFormBusy(toolsForm, true);

	try {
		const payload = readDemoPayload(toolsForm);
		const result = await postJson("/api/tools", payload);
		toolsOutput.textContent = formatJson(result);
		setOutputState(toolsState, "done");
	} catch (error) {
		toolsOutput.textContent = formatError(error);
		setOutputState(toolsState, "error");
	} finally {
		setFormBusy(toolsForm, false);
	}
});

middlewareForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	setOutputState(middlewareState, "running");
	middlewareOutput.textContent = "";
	setFormBusy(middlewareForm, true);

	try {
		const payload = readDemoPayload(middlewareForm);
		const result = await postJson("/api/middleware", payload);
		middlewareOutput.textContent = formatJson(result);
		setOutputState(middlewareState, "done");
	} catch (error) {
		middlewareOutput.textContent = formatError(error);
		setOutputState(middlewareState, "error");
	} finally {
		setFormBusy(middlewareForm, false);
	}
});

streamForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	stopActiveStream();
	setOutputState(streamState, "running");
	streamOutput.textContent = "";

	try {
		const payload = readStreamPayload(streamForm);
		activeStreamController = new AbortController();
		await openStream(payload, activeStreamController.signal);
		setOutputState(streamState, "done");
	} catch (error) {
		if (!(error instanceof DOMException && error.name === "AbortError")) {
			streamOutput.textContent += `${formatError(error)}\n`;
			setOutputState(streamState, "error");
		}
	}
});

stopStreamButton.addEventListener("click", () => {
	stopActiveStream();
	streamOutput.textContent += "\n[stream stopped]\n";
	setOutputState(streamState, "idle");
});

// ── Status bar ────────────────────────────────────

async function refreshConfig(): Promise<void> {
	const response = await fetch("/api/config");
	const data = (await response.json()) as Record<string, unknown>;

	const items: string[] = [];

	items.push(
		renderStatusDot(
			data.hasNiaApiKey === true ? "ok" : "err",
			"NIA",
			data.hasNiaApiKey === true ? "present" : "missing",
		),
	);

	items.push(
		renderStatusDot(
			data.hasAnthropicApiKey === true ? "ok" : "err",
			"Anthropic",
			data.hasAnthropicApiKey === true ? "present" : "missing",
		),
	);

	if (data.anthropicModel) {
		items.push(
			renderStatusPair("Model", String(data.anthropicModel)),
		);
	}

	if (data.baseUrl) {
		items.push(renderStatusPair("URL", shortenUrl(String(data.baseUrl))));
	}

	statusBar.innerHTML = items.join("");
}

function renderStatusDot(
	state: string,
	label: string,
	value: string,
): string {
	return `<div class="status-item"><span class="status-dot ${state}"></span><span class="status-key">${escapeHtml(label)}</span><span class="status-val">${escapeHtml(value)}</span></div>`;
}

function renderStatusPair(label: string, value: string): string {
	return `<div class="status-item"><span class="status-key">${escapeHtml(label)}</span><span class="status-val">${escapeHtml(value)}</span></div>`;
}

function shortenUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.hostname}${parsed.pathname}`;
	} catch {
		return url;
	}
}

// ── UI helpers ────────────────────────────────────

function setOutputState(element: HTMLElement, state: OutputState): void {
	element.textContent = state;
	element.className = `out-state${state !== "idle" ? ` ${state}` : ""}`;
}

function setFormBusy(form: HTMLFormElement, busy: boolean): void {
	const btn = form.querySelector<HTMLButtonElement>("button[type=submit]");
	if (btn) btn.disabled = busy;
}

// ── API helpers ───────────────────────────────────

async function postJson(
	url: string,
	payload: DemoPayload,
): Promise<Record<string, unknown>> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	const data = (await response.json()) as Record<string, unknown>;
	if (!response.ok) {
		throw new Error(String(data.error ?? "Request failed"));
	}

	return data;
}

// ── Streaming ─────────────────────────────────────

async function openStream(
	payload: StreamPayload,
	signal: AbortSignal,
): Promise<void> {
	const url = new URL(`/api/streams/${payload.kind}`, window.location.origin);
	writeStreamLine("stream", { kind: payload.kind, status: "opening" });

	setIfPresent(url.searchParams, "prompt", payload.prompt);
	setIfPresent(url.searchParams, "repositories", joinCsv(payload.repositories));
	setIfPresent(url.searchParams, "dataSources", joinCsv(payload.dataSources));
	setIfPresent(url.searchParams, "sourceId", payload.sourceId);
	setIfPresent(url.searchParams, "sourceIds", joinCsv(payload.sourceIds));
	setIfPresent(url.searchParams, "mode", payload.mode);
	setIfPresent(url.searchParams, "outputFormat", payload.outputFormat);
	setIfPresent(
		url.searchParams,
		"thinkingEnabled",
		payload.thinkingEnabled ? "true" : undefined,
	);
	setIfPresent(
		url.searchParams,
		"thinkingBudget",
		payload.thinkingBudget?.toString(),
	);

	const response = await fetch(url, {
		headers: { Accept: "text/event-stream" },
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(errorText || "Stream request failed");
	}

	if (!response.body) {
		throw new Error("Readable stream missing from response.");
	}

	await consumeSse(response.body, (event) => {
		writeStreamLine(event.event, event.data);
	});

	writeStreamLine("stream", { kind: payload.kind, status: "closed" });
}

async function consumeSse(
	stream: ReadableStream<Uint8Array>,
	onEvent: (event: { event: string; data: unknown }) => void,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		buffer = flushBuffer(buffer, onEvent);
	}

	buffer += decoder.decode();
	flushBuffer(buffer, onEvent);
}

function flushBuffer(
	buffer: string,
	onEvent: (event: { event: string; data: unknown }) => void,
): string {
	let remaining = buffer.replaceAll("\r\n", "\n");

	while (true) {
		const boundary = remaining.indexOf("\n\n");
		if (boundary === -1) return remaining;

		const chunk = remaining.slice(0, boundary);
		remaining = remaining.slice(boundary + 2);
		const event = parseSseChunk(chunk);
		if (event) onEvent(event);
	}
}

function parseSseChunk(chunk: string): { event: string; data: unknown } | null {
	const trimmed = chunk.trim();
	if (!trimmed) return null;

	let event = "message";
	const dataLines: string[] = [];

	for (const line of trimmed.split("\n")) {
		if (line.startsWith("event:")) {
			event = line.slice(6).trim();
			continue;
		}
		if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trim());
		}
	}

	const rawData = dataLines.join("\n");
	return { event, data: tryParseJson(rawData) };
}

function writeStreamLine(event: string, data: unknown): void {
	streamOutput.textContent += `${event}\n${formatJson(data)}\n\n`;
	streamOutput.scrollTop = streamOutput.scrollHeight;
}

function stopActiveStream(): void {
	activeStreamController?.abort();
	activeStreamController = null;
}

// ── Form reading ──────────────────────────────────

function readDemoPayload(form: HTMLFormElement): DemoPayload {
	const data = new FormData(form);
	return {
		service: requireValue<ServiceKind>(data, "service"),
		prompt: requireValue(data, "prompt"),
		repositories: splitCsv(readValue(data, "repositories")),
		dataSources: splitCsv(readValue(data, "dataSources")),
		sourceId: readValue(data, "sourceId"),
		sourceIds: splitCsv(readValue(data, "sourceIds")),
		mode: readMode(data, "mode"),
		outputFormat: readValue(data, "outputFormat"),
		thinkingEnabled: readCheckbox(data, "thinkingEnabled"),
		thinkingBudget: readNumber(data, "thinkingBudget"),
	};
}

function readStreamPayload(form: HTMLFormElement): StreamPayload {
	const data = new FormData(form);
	return {
		kind: requireValue<StreamKind>(data, "kind"),
		prompt: requireValue(data, "prompt"),
		repositories: splitCsv(readValue(data, "repositories")),
		dataSources: splitCsv(readValue(data, "dataSources")),
		sourceId: readValue(data, "sourceId"),
		sourceIds: splitCsv(readValue(data, "sourceIds")),
		mode: readMode(data, "mode"),
		outputFormat: readValue(data, "outputFormat"),
		thinkingEnabled: readCheckbox(data, "thinkingEnabled"),
		thinkingBudget: readNumber(data, "thinkingBudget"),
	};
}

function readValue(formData: FormData, key: string): string | undefined {
	const value = formData.get(key);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function requireValue<T extends string = string>(
	formData: FormData,
	key: string,
): T {
	const value = readValue(formData, key);
	if (!value) throw new Error(`${key} is required.`);
	return value as T;
}

function readCheckbox(formData: FormData, key: string): boolean | undefined {
	return formData.get(key) === "on" ? true : undefined;
}

function readNumber(formData: FormData, key: string): number | undefined {
	const value = readValue(formData, key);
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function readMode(
	formData: FormData,
	key: string,
): "tracer-fast" | "tracer-deep" | undefined {
	const value = readValue(formData, key);
	return value === "tracer-fast" || value === "tracer-deep" ? value : undefined;
}

// ── Utilities ─────────────────────────────────────

function splitCsv(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	const parts = value
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts : undefined;
}

function joinCsv(value: string[] | undefined): string | undefined {
	return value && value.length > 0 ? value.join(",") : undefined;
}

function setIfPresent(
	searchParams: URLSearchParams,
	key: string,
	value: string | undefined,
): void {
	if (value) searchParams.set(key, value);
}

function tryParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown error";
}

function must<TElement extends Element>(selector: string): TElement {
	const element = document.querySelector<TElement>(selector);
	if (!element) throw new Error(`Missing element: ${selector}`);
	return element;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
