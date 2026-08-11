import { Notice, TFile, type App } from "obsidian";
import type { ScoutSettings } from "../settings/store";
import { splitList, type CustomField, type FieldKey } from "./config";
import type { LibraryEntry } from "./entry";
import { readSection, writeSection } from "./section";

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

	private async patch(
		entry: LibraryEntry,
		values: Record<string, unknown>,
	): Promise<void> {
		const file = this.file(entry);
		if (!file) {
			new Notice(`"${entry.title}" is no longer in the vault.`);
			return;
		}

		try {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					for (const [key, value] of Object.entries(values)) {
						if (!key) continue;
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
		} catch (err) {
			new Notice(
				`Could not update "${entry.title}": ${
					err instanceof Error ? err.message : "unknown error"
				}`,
			);
		}
	}
}
