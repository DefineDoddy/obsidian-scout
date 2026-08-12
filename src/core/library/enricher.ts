import type { Plugin } from "obsidian";
import { isAbortError } from "../http";
import { isEnrichable } from "../provider";
import type { ProviderRegistry } from "../registry";
import type { ScoutSettings } from "../settings/store";
import type { MediaRef } from "../types";
import {
	dueForEnrichment,
	enrichmentProgress,
	pruneEnrichment,
	recordOf,
} from "./enrich";
import { feedbackKey, pruneFeedback } from "./feedback";
import type { LibraryIndex } from "./indexer";

/**
 * Going and finding out what your library is actually made of.
 *
 * The policy — which notes, in what order, how long an answer stands — is all
 * in `enrich.ts` and testable without a network. What is left here is the part
 * that needs the clock and the wire: walking a batch one note at a time,
 * keeping the requests spaced, and stopping the moment Obsidian goes away.
 * Modelled deliberately on `refresher.ts`, which does the same job for a
 * different reason.
 *
 * **Nothing this class learns is ever written to a note.** It reads the source
 * and writes Scout's own data file, and that is the whole of it. The keywords
 * behind a film are the model's working notes; a vault is not the place for
 * them, and nobody asked for `keywords: [dystopia, time-loop]` to appear in
 * their frontmatter. If a future change makes this write a patch, that change
 * is wrong.
 */

/** After the refresher's first run, so the two never go out together. */
const FIRST_RUN_DELAY_MS = 90_000;

/** How often a run comes round while Obsidian stays open. */
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Between requests inside a run.
 *
 * Longer than the refresher's 250ms because AniList publishes a limit of
 * ninety a minute and this is the one pass that walks a whole library.
 */
const BETWEEN_REQUESTS_MS = 400;

export interface EnrichReport {
	/** Notes asked about. */
	asked: number;
	/** Notes the source had something to say about. */
	harvested: number;
	/** Notes the source knew nothing more about. */
	empty: number;
	/** Notes whose source could not be reached. */
	failed: number;
}

export class LibraryEnricher {
	private timer: number | null = null;
	private running = false;

	constructor(
		private readonly settings: ScoutSettings,
		private readonly registry: ProviderRegistry,
		private readonly library: LibraryIndex,
	) {}

	/** Starts the background schedule, if the user has it turned on. */
	start(plugin: Plugin): void {
		const tick = () => {
			if (!this.settings.library().enrichSuggestions) return;
			void this.runDue();
		};

		this.timer = window.setTimeout(() => {
			tick();
			this.timer = window.setInterval(tick, RUN_EVERY_MS);
			plugin.register(() => {
				if (this.timer !== null) window.clearInterval(this.timer);
			});
		}, FIRST_RUN_DELAY_MS);

		plugin.register(() => {
			if (this.timer !== null) window.clearTimeout(this.timer);
			this.timer = null;
		});
	}

	/** Whether a source could be asked about this at all, right now. */
	private canAsk = (ref: MediaRef): boolean => {
		const provider = this.registry.get(ref.providerId);
		return Boolean(
			provider &&
				isEnrichable(provider) &&
				provider.isConfigured() &&
				this.settings.isProviderEnabled(provider.id),
		);
	};

	/** For the settings page to say how far along it is. */
	progress(): { eligible: number; known: number; waiting: number } {
		return enrichmentProgress(
			this.settings.library(),
			this.library.all(),
			this.settings.enrichment(),
			this.canAsk,
		);
	}

	/** The scheduled run: whatever is most worth knowing, up to the budget. */
	async runDue(): Promise<EnrichReport | null> {
		const config = this.settings.library();
		const batch = dueForEnrichment(
			config,
			this.library.all(),
			this.settings.enrichment(),
			this.canAsk,
			new Date(),
			Math.max(1, config.enrichBudget),
		);
		return this.enrich(batch);
	}

	/**
	 * Walks a batch, one note at a time.
	 *
	 * Sequential rather than parallel on purpose: a hundred notes is a hundred
	 * requests, and firing them at once is how a free API key stops being one.
	 * Returns null when a run is already in flight.
	 */
	async enrich(
		refs: readonly MediaRef[],
		signal?: AbortSignal,
		onProgress?: (done: number, total: number) => void,
	): Promise<EnrichReport | null> {
		if (this.running) return null;
		this.running = true;

		const report: EnrichReport = { asked: 0, harvested: 0, empty: 0, failed: 0 };
		const controller = new AbortController();
		const stop = () => controller.abort();
		signal?.addEventListener("abort", stop);

		try {
			for (const ref of refs) {
				if (controller.signal.aborted) break;
				const outcome = await this.enrichOne(ref, controller.signal);
				report.asked += 1;
				if (outcome === "failed") report.failed += 1;
				else if (outcome === "empty") report.empty += 1;
				else report.harvested += 1;
				onProgress?.(report.asked, refs.length);
				if (BETWEEN_REQUESTS_MS > 0) {
					await new Promise((resolve) =>
						window.setTimeout(resolve, BETWEEN_REQUESTS_MS),
					);
				}
			}
			this.tidy();
		} finally {
			signal?.removeEventListener("abort", stop);
			this.running = false;
		}

		// Once, at the end. A harvest is not a reason to redraw the hub fifteen
		// times, but a run that learned something is a reason to redraw it once.
		if (report.harvested > 0) this.settings.touch();
		return report;
	}

	/** One title. */
	async enrichOne(
		ref: MediaRef,
		signal: AbortSignal,
	): Promise<"harvested" | "empty" | "failed"> {
		const provider = this.registry.get(ref.providerId);
		if (!provider || !isEnrichable(provider) || !provider.isConfigured()) {
			return "failed";
		}

		let traits;
		try {
			traits = await provider.traits(ref, { signal });
		} catch (err) {
			if (isAbortError(err)) throw err;
			console.warn(`Scout: could not read up on ${feedbackKey(ref)}`, err);
			return "failed";
		}

		// Written whatever the answer was, including nothing: the point of the
		// record is that the question was asked, so a title the source knows
		// nothing more about is not asked about again tomorrow.
		const record = recordOf(traits);
		this.settings.setEnrichment(feedbackKey(ref), record);
		return record.empty ? "empty" : "harvested";
	}

	/** Forgets what has stopped being about anything. One timer, two cleanups. */
	private tidy(): void {
		const entries = this.library.all();
		const feedback = this.settings.feedback();

		const cache = this.settings.enrichment();
		const pruned = pruneEnrichment(cache, entries, feedback);
		if (Object.keys(pruned).length !== Object.keys(cache).length) {
			this.settings.setEnrichmentAll(pruned);
		}

		const kept = pruneFeedback(feedback);
		if (Object.keys(kept).length !== Object.keys(feedback).length) {
			this.settings.setFeedbackAll(kept);
		}
	}
}
