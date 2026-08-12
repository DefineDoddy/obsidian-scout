import { Notice, TFile, type App } from "obsidian";
import type { ScoutSettings } from "../settings/store";
import {
	splitList,
	statusTone,
	statusWithTone,
	type CustomField,
	type FieldKey,
} from "./config";
import type { LibraryEntry } from "./entry";
import {
	episodeKey,
	writeEpisodeLog,
	writeWatchedSet,
	type EpisodeMark,
	type WatchState,
} from "./episodes";
import { replayPatch } from "./replay";
import { readSection, writeSection } from "./section";
import { needsTagSafeNames, tagSafeList } from "./tags";

/**
 * What the vault has this property's type set to, if it can be asked.
 *
 * `metadataTypeManager` is not part of the published API, so every step of the
 * reach is guarded: on a build that has moved it, the answer is simply "don't
 * know", and only `tags` and `tag` are treated as tag properties.
 */
export function assignedPropertyType(
	app: App,
	property: string,
): string | undefined {
	try {
		const manager = (
			app as unknown as {
				metadataTypeManager?: {
					getAssignedType?: (name: string) => string | null;
				};
			}
		).metadataTypeManager;
		return manager?.getAssignedType?.(property) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Everything that writes to a library note.
 *
 * Frontmatter goes through `processFrontMatter`, which serializes YAML the way
 * Obsidian itself does — so a rating set here looks identical to one typed by
 * hand, and no amount of odd characters in a title can corrupt the block.
 */

/** Local `YYYY-MM-DD`; `toISOString` would shift the date across a timezone. */
export function today(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

const lower = (value: string) => value.toLowerCase();

export class LibraryMutator {
	constructor(
		private readonly app: App,
		private readonly settings: ScoutSettings,
	) {}

	file(entry: LibraryEntry): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(entry.path);
		return file instanceof TFile ? file : null;
	}

	/** Writes one of the mapped fields. `null` removes the property. */
	async setField(
		entry: LibraryEntry,
		field: FieldKey,
		value: string | number | boolean | null,
	): Promise<void> {
		const key = this.settings.library().fields[field]?.trim();
		if (!key) return;
		await this.patch(entry, { [key]: value });
	}

	async setRating(entry: LibraryEntry, rating: number | null): Promise<void> {
		await this.setField(entry, "rating", rating);
	}

	async toggleFavorite(entry: LibraryEntry): Promise<void> {
		await this.setField(entry, "favorite", !entry.favorite);
	}

	async setProgress(
		entry: LibraryEntry,
		progress: number | null,
	): Promise<void> {
		await this.setField(entry, "progress", progress);
	}

	/**
	 * Sets the status, and stamps the start/finish dates when the new status
	 * means "started" or "done" — the bookkeeping nobody remembers to do.
	 */
	async setStatus(entry: LibraryEntry, status: string | null): Promise<void> {
		const config = this.settings.library();
		const fields = config.fields;
		const patch: Record<string, unknown> = {
			[fields.status]: status && status.length > 0 ? status : null,
		};

		if (status && config.autoTimestamps) {
			const value = lower(status);
			const started = splitList(config.inProgressStatuses).map(lower);
			const finished = splitList(config.finishedStatuses).map(lower);

			if (started.includes(value) && !entry.started) {
				patch[fields.started] = today();
			}
			if (finished.includes(value)) {
				if (!entry.started) patch[fields.started] = today();
				if (!entry.finished) patch[fields.finished] = today();
			}
		}

		await this.patch(entry, patch);
	}

	/**
	 * Starts it again: archives the finish date and resets the run.
	 *
	 * See `replayPatch` for what moves where — the whole rearrangement is pure
	 * so that it can be reasoned about away from the vault.
	 */
	async replay(entry: LibraryEntry): Promise<void> {
		await this.patch(entry, replayPatch(this.settings.library(), entry, today()));
	}

	/**
	 * Records how far into a series you are.
	 *
	 * Both halves of the record go in one write: the marker for the run watched
	 * in order, and the list for anything ticked off outside it. One patch, so a
	 * tick is one change to the note rather than two the index sees separately.
	 *
	 * `watched` is the number of episodes the two add up to, which the
	 * caller works out from the season list it already has. Writing it to the
	 * ordinary progress property is what keeps one truth: the bar on the card,
	 * the "furthest along" sort, and the ring on the badge all go on reading
	 * the same number they always have.
	 */
	async setEpisode(
		entry: LibraryEntry,
		state: WatchState,
		watched?: number,
	): Promise<void> {
		const config = this.settings.library();
		const fields = config.fields;
		const id = state.marker;
		const patch: Record<string, unknown> = {
			[fields.episode]: id ? episodeKey(id.season, id.episode) : null,
			[fields.watched]: writeWatchedSet(state.extra),
			[fields.progress]: watched && watched > 0 ? watched : null,
		};

		// The same bookkeeping the status control does, under the same setting:
		// nobody who has just ticked off episode one wants to then be told the
		// show is still on their to-watch shelf.
		if ((id || state.extra.size > 0) && config.autoTimestamps) {
			const total = entry.progressTotal;
			const complete =
				total !== undefined &&
				watched !== undefined &&
				watched >= total;
			const tone = statusTone(config, entry.status);

			if (complete) {
				const done = statusWithTone(config, entry.kind, "done");
				if (done) patch[fields.status] = done;
				if (!entry.started) patch[fields.started] = today();
				if (!entry.finished) patch[fields.finished] = today();
			} else if (tone === null || tone === "planned") {
				const active = statusWithTone(config, entry.kind, "active");
				if (active) patch[fields.status] = active;
				if (!entry.started) patch[fields.started] = today();
			}
		}

		await this.patch(entry, patch);
	}

	/** Your rating and note for one episode. Null clears it. */
	async setEpisodeMark(
		entry: LibraryEntry,
		key: string,
		mark: EpisodeMark | null,
	): Promise<void> {
		const log = { ...entry.episodeLog };
		if (!mark || (mark.rating === undefined && !mark.note)) delete log[key];
		else log[key] = mark;

		await this.patch(entry, {
			[this.settings.library().fields.episodeLog]: writeEpisodeLog(log),
		});
	}

	async setCustom(
		entry: LibraryEntry,
		field: CustomField,
		value: string | number | boolean | null,
	): Promise<void> {
		const key = field.key.trim();
		if (!key) return;
		await this.patch(entry, { [key]: value });
	}

	/** Adds or removes a genre, keeping the property a list. */
	async toggleTag(entry: LibraryEntry, tag: string): Promise<void> {
		const key = this.settings.library().fields.tags?.trim();
		if (!key) return;
		const has = entry.tags.some((t) => lower(t) === lower(tag));
		const next = has
			? entry.tags.filter((t) => lower(t) !== lower(tag))
			: [...entry.tags, tag];
		await this.patch(entry, { [key]: next });
	}

	/**
	 * Puts a note in a collection, or takes it out.
	 *
	 * The list is written back whole rather than appended to, so the property
	 * ends up as a clean list whatever it was before — a string, a single value,
	 * or a list with the name already in it under different capitalisation.
	 */
	async setCollections(
		entry: LibraryEntry,
		names: readonly string[],
		quiet = false,
	): Promise<boolean> {
		const key = this.settings.library().fields.collections?.trim();
		if (!key) return false;
		return this.patch(
			entry,
			{ [key]: names.length > 0 ? [...names] : null },
			quiet,
		);
	}

	/* ------------------------------------------------------------- the body */

	/** The current text of the thoughts section, read from disk. */
	async readThoughts(entry: LibraryEntry): Promise<string> {
		const file = this.file(entry);
		if (!file) return "";
		const content = await this.app.vault.cachedRead(file);
		return readSection(content, this.settings.library().thoughtsHeading);
	}

	/** Replaces the thoughts section, creating it if the note has none. */
	async writeThoughts(entry: LibraryEntry, text: string): Promise<void> {
		const file = this.file(entry);
		if (!file) return;
		const heading = this.settings.library().thoughtsHeading;
		await this.app.vault.process(file, (content) =>
			writeSection(content, heading, text),
		);
	}

	/* ---------------------------------------------------------- the file */

	async open(entry: LibraryEntry, newTab?: boolean): Promise<void> {
		const file = this.file(entry);
		if (!file) {
			new Notice(`"${entry.title}" is no longer in the vault.`);
			return;
		}
		const inNewTab = newTab ?? this.settings.library().openInNewTab;
		await this.app.workspace.getLeaf(inNewTab).openFile(file);
	}

	/** Moves the note to the trash, honouring the vault's deletion preference. */
	async trash(entry: LibraryEntry): Promise<void> {
		const file = this.file(entry);
		if (!file) return;
		await this.app.fileManager.trashFile(file);
		new Notice(`Moved "${entry.title}" to the trash`);
	}

	/* --------------------------------------------------------------- write */

	/**
	 * Writes frontmatter values, `null` meaning "remove the property".
	 *
	 * `quiet` is for the background refresh, which walks a batch of notes and
	 * would otherwise stack up one notice per note that had been renamed since
	 * the index last ran. It reports the total itself.
	 */
	/**
	 * A value shaped for the property it is about to land in.
	 *
	 * Only one rule so far, and it exists because Obsidian's tag grammar is
	 * narrower than any source's genre names: a list going into a property the
	 * vault has typed as Tags gets tag-safe names, so "Sci-Fi & Fantasy" does
	 * not arrive struck through with "Invalid tag name" beside it. A property
	 * typed as an ordinary list keeps the wording the source used.
	 */
	private forProperty(key: string, value: unknown): unknown {
		if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
			return value;
		}
		return needsTagSafeNames(key, (name) => assignedPropertyType(this.app, name))
			? tagSafeList(value as string[])
			: value;
	}

	async patch(
		entry: LibraryEntry,
		values: Record<string, unknown>,
		quiet = false,
	): Promise<boolean> {
		const file = this.file(entry);
		if (!file) {
			if (!quiet) new Notice(`"${entry.title}" is no longer in the vault.`);
			return false;
		}

		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					for (const [key, raw] of Object.entries(values)) {
						if (!key) continue;
						const value = this.forProperty(key, raw);
						// Null means "unset", which for YAML means removing the key
						// rather than leaving a dangling `rating:` behind.
						if (value === null || value === undefined || value === "") {
							delete frontmatter[key];
							// The user may have typed the property in another case.
							for (const existing of Object.keys(frontmatter)) {
								if (lower(existing) === lower(key)) {
									delete frontmatter[existing];
								}
							}
						} else {
							const existing = Object.keys(frontmatter).find(
								(name) => lower(name) === lower(key),
							);
							frontmatter[existing ?? key] = value;
						}
					}
				},
			);
			return true;
		} catch (err) {
			if (!quiet) {
				new Notice(
					`Could not update "${entry.title}": ${
						err instanceof Error ? err.message : "unknown error"
					}`,
				);
			}
			return false;
		}
	}
}
