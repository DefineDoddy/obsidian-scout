import type { Plugin } from "obsidian";
import { isAbortError } from "../http";
import { isDetailable } from "../provider";
import type { ProviderRegistry } from "../registry";
import type { ScoutSettings } from "../settings/store";
import type { LibraryEntry } from "./entry";
import type { LibraryIndex } from "./indexer";
import { LibraryMutator, today } from "./mutate";
import {
	dueEntries,
	pruneCheckLog,
	refreshPatch,
	refreshable,
} from "./refresh";

/**
 * Asking sources what has changed.
 *
 * The policy — which notes, how often, what may be written — is all in
 * `refresh.ts` and testable without a vault. What is left here is the part that
 * needs the network and the clock: walking a batch one note at a time, keeping
 * the requests spaced, and stopping the moment Obsidian goes away.
 *
 * One request per note, through the same cached HTTP client everything else
 * uses, and only for notes that record which source they came from.
 */

/** How long after load the first run happens. Long enough to stay out of the way. */
const FIRST_RUN_DELAY_MS = 45_000;

/** How often a run comes round while Obsidian stays open. */
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

/** Between requests inside a run. Politeness, not a rate limit. */
const BETWEEN_REQUESTS_MS = 250;

export interface RefreshReport {
	/** Notes asked about. */
	checked: number;
	/** Notes that had something new and were written. */
	updated: number;
	/** Notes whose source could not be reached. */
	failed: number;
}

export class LibraryRefresher {
	private timer: number | null = null;
	private running = false;

	constructor(
		private readonly settings: ScoutSettings,
		private readonly registry: ProviderRegistry,
		private readonly library: LibraryIndex,
		private readonly mutator: LibraryMutator,
	) {}

	/** Starts the background schedule, if the user has it turned on. */
	start(plugin: Plugin): void {
		const tick = () => {
			if (!this.settings.library().autoRefresh) return;
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

	/** How many notes are waiting, for the settings page to say so. */
	dueCount(): number {
		return dueEntries(
			this.library.all(),
			this.settings.library(),
			this.settings.checkLog(),
		).length;
	}

	/** How many notes could ever be refreshed — those that name a source. */
	eligibleCount(): number {
		return refreshable(this.library.all()).length;
	}

	/** The scheduled run: whatever is overdue, up to this run's budget. */
	async runDue(): Promise<RefreshReport | null> {
		const config = this.settings.library();
		const batch = dueEntries(
			this.library.all(),
			config,
			this.settings.checkLog(),
			new Date(),
			Math.max(1, config.refreshBudget),
		);
		return this.refresh(batch);
	}

	/**
	 * Walks a batch, one note at a time.
	 *
	 * Sequential rather than parallel on purpose: a hundred notes is a hundred
	 * requests, and firing them at once is how a free API key stops being one.
	 * Returns null when a run is already in flight.
	 */
	async refresh(
		entries: readonly LibraryEntry[],
		signal?: AbortSignal,
		onProgress?: (done: number, total: number) => void,
	): Promise<RefreshReport | null> {
		if (this.running) return null;
		this.running = true;

		const report: RefreshReport = { checked: 0, updated: 0, failed: 0 };
		const controller = new AbortController();
		const stop = () => controller.abort();
		signal?.addEventListener("abort", stop);

		try {
			for (const entry of entries) {
				if (controller.signal.aborted) break;
				const outcome = await this.refreshOne(entry, controller.signal);
				if (outcome === "failed") report.failed++;
				else {
					report.checked++;
					if (outcome === "updated") report.updated++;
				}
				onProgress?.(report.checked + report.failed, entries.length);
				if (BETWEEN_REQUESTS_MS > 0) {
					await new Promise((resolve) =>
						window.setTimeout(resolve, BETWEEN_REQUESTS_MS),
					);
				}
			}
			this.prune();
		} finally {
			signal?.removeEventListener("abort", stop);
			this.running = false;
		}

		return report;
	}

	/** One note. Public so the library's context menu can offer it per item. */
	async refreshOne(
		entry: LibraryEntry,
		signal: AbortSignal,
	): Promise<"updated" | "unchanged" | "failed"> {
		const ref = entry.ref;
		if (!ref) return "failed";

		const provider = this.registry.get(ref.providerId);
		if (
			!provider ||
			!isDetailable(provider) ||
			!provider.isConfigured() ||
			!this.settings.isProviderEnabled(provider.id)
		) {
			return "failed";
		}

		let item;
		try {
			item = await provider.details(ref, { signal });
		} catch (err) {
			if (isAbortError(err)) throw err;
			console.warn(`Scout: could not refresh "${entry.title}"`, err);
			return "failed";
		}

		// Recorded whatever the answer was: the point of the log is that the
		// question was asked, so a note whose facts never move is not asked
		// about again tomorrow.
		this.settings.markChecked(entry.path, today());

		const { values, changed } = refreshPatch(
			this.settings.library(),
			entry,
			item,
		);
		if (changed.length === 0) return "unchanged";

		const written = await this.mutator.patch(entry, values, true);
		return written ? "updated" : "failed";
	}

	/** Forgets notes that have left the vault, so the log tracks the library. */
	private prune(): void {
		const log = this.settings.checkLog();
		const pruned = pruneCheckLog(log, this.library.all());
		if (Object.keys(pruned).length !== Object.keys(log).length) {
			this.settings.setCheckLog(pruned);
		}
	}
}
