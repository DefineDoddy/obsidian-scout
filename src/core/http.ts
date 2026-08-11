import { requestUrl } from "obsidian";
import type { RequestUrlParam } from "obsidian";
import { TtlCache } from "./cache";

/**
 * Every network call in Scout goes through here.
 *
 * Uses Obsidian's `requestUrl` rather than `fetch` so requests are not subject
 * to the webview's CORS policy — this is what lets the plugin work on mobile.
 * Centralizing transport also gives one place for caching, backoff on rate
 * limits, and cancellation.
 */

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly url: string,
		readonly body: string,
	) {
		super(`HTTP ${status} for ${url}`);
		this.name = "HttpError";
	}
}

export class AbortError extends Error {
	constructor() {
		super("Request aborted");
		this.name = "AbortError";
	}
}

export function isAbortError(err: unknown): boolean {
	return err instanceof AbortError || (err as Error)?.name === "AbortError";
}

export interface RequestOptions {
	headers?: Record<string, string>;
	/** Aborting discards the response; the in-flight request itself is not killed. */
	signal?: AbortSignal;
	/** Cache successful GETs for this long. Omit to skip the cache. */
	cacheTtlMs?: number;
	/** Retries on 429 and 5xx. Default 2. */
	retries?: number;
}

const RETRYABLE = (status: number) => status === 429 || status >= 500;

export class HttpClient {
	private readonly cache = new TtlCache<unknown>();

	/** Most recent rate-limit hint seen, surfaced in settings for diagnosis. */
	lastRateLimitAt: number | null = null;

	async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
		const cacheKey = options.cacheTtlMs
			? `GET ${url} ${JSON.stringify(options.headers ?? {})}`
			: null;
		if (cacheKey) {
			const hit = this.cache.get(cacheKey);
			if (hit !== undefined) return hit as T;
		}

		const body = await this.send(
			{ url, method: "GET", headers: options.headers },
			options,
		);
		const parsed = JSON.parse(body) as T;
		if (cacheKey) this.cache.set(cacheKey, parsed, options.cacheTtlMs);
		return parsed;
	}

	async postJson<T>(
		url: string,
		payload: unknown,
		options: RequestOptions = {},
	): Promise<T> {
		const body = await this.send(
			{
				url,
				method: "POST",
				contentType: "application/json",
				headers: { "Content-Type": "application/json", ...options.headers },
				body: JSON.stringify(payload),
			},
			options,
		);
		return JSON.parse(body) as T;
	}

	async postForm<T>(
		url: string,
		form: Record<string, string>,
		options: RequestOptions = {},
	): Promise<T> {
		const body = await this.send(
			{
				url,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					...options.headers,
				},
				body: new URLSearchParams(form).toString(),
			},
			options,
		);
		return JSON.parse(body) as T;
	}

	/** Raw text, for HTML scraping (Open Graph tags). */
	async getText(url: string, options: RequestOptions = {}): Promise<string> {
		return this.send({ url, method: "GET", headers: options.headers }, options);
	}

	clearCache(): void {
		this.cache.clear();
	}

	private async send(
		request: RequestUrlParam,
		options: RequestOptions,
	): Promise<string> {
		const maxAttempts = (options.retries ?? 2) + 1;
		let lastError: unknown;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			this.throwIfAborted(options.signal);

			try {
				// `throw: false` so non-2xx responses are inspectable rather than
				// collapsing into an opaque exception.
				const response = await requestUrl({ ...request, throw: false });
				this.throwIfAborted(options.signal);

				if (response.status >= 200 && response.status < 300) {
					return response.text;
				}
				if (response.status === 429) this.lastRateLimitAt = Date.now();

				const error = new HttpError(
					response.status,
					request.url,
					response.text?.slice(0, 500) ?? "",
				);
				if (!RETRYABLE(response.status) || attempt === maxAttempts - 1) {
					throw error;
				}
				lastError = error;
				await this.backoff(attempt, response.headers, options.signal);
			} catch (err) {
				if (isAbortError(err) || err instanceof HttpError) throw err;
				// Network-level failure: retry, then give up with the real cause.
				lastError = err;
				if (attempt === maxAttempts - 1) throw err;
				await this.backoff(attempt, undefined, options.signal);
			}
		}

		throw lastError instanceof Error
			? lastError
			: new Error(String(lastError));
	}

	private async backoff(
		attempt: number,
		headers: Record<string, string> | undefined,
		signal?: AbortSignal,
	): Promise<void> {
		const retryAfter = Number(headers?.["retry-after"]);
		const delayMs = Number.isFinite(retryAfter)
			? Math.min(retryAfter * 1000, 10_000)
			: Math.min(2 ** attempt * 500, 4000);

		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				signal?.removeEventListener("abort", onAbort);
				resolve();
			}, delayMs);
			const onAbort = () => {
				window.clearTimeout(timer);
				reject(new AbortError());
			};
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private throwIfAborted(signal?: AbortSignal): void {
		if (signal?.aborted) throw new AbortError();
	}
}
