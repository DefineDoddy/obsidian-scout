import { App, Notice, TFile, normalizePath } from "obsidian";
import { NoteWriter, noticeForOutcome, type WriteOutcome } from "./noteWriter";
import { isDetailable, type MediaProvider } from "./provider";
import type { ProviderRegistry } from "./registry";
import type { ScoutSettings } from "./settings/store";
import { renderTemplate } from "./template/engine";
import { toTemplateContext, type MediaItem } from "./types";
import { defaultTemplateFor } from "../templates/defaults";

/**
 * Turns a chosen search result into a note.
 *
 * This is the flow that used to live inside each modal's click handler,
 * duplicated between the TV and book modals. Having it here means every
 * provider gets folder creation, collision handling, YAML-safe rendering, and
 * missing-field warnings for free.
 */
export class NoteFactory {
	private readonly writer: NoteWriter;

	constructor(
		private readonly app: App,
		private readonly settings: ScoutSettings,
		private readonly registry: ProviderRegistry,
	) {
		this.writer = new NoteWriter(app);
	}

	/**
	 * Enriches the item via the provider's detail endpoint (when it has one),
	 * renders the template for its kind, and writes the note.
	 */
	async create(
		item: MediaItem,
		signal: AbortSignal,
	): Promise<WriteOutcome | null> {
		const kind = item.ref.kind;
		const config = this.settings.kind(kind);

		if (!config.outputFolder) {
			new Notice(
				`Set an output folder for ${kind} notes in Scout's settings first.`,
			);
			return null;
		}

		const provider = this.registry.get(item.ref.providerId);
		const enriched = await this.enrich(provider, item, signal);
		const template = await this.resolveTemplate(kind, config.templatePath);

		const { content, missing } = renderTemplate(
			template,
			toTemplateContext(enriched),
		);

		if (missing.length > 0 && this.settings.core("warnOnMissingFields")) {
			new Notice(
				`Template used ${missing.length} unknown field${
					missing.length === 1 ? "" : "s"
				}: ${missing.join(", ")}`,
			);
		}

		const outcome = await this.writer.write({
			folder: config.outputFolder,
			title: enriched.title,
			content,
			policy: this.settings.core("collisionPolicy"),
			openAfterCreate: this.settings.core("openAfterCreate"),
		});

		if (outcome) noticeForOutcome(outcome);
		return outcome;
	}

	/** Second-stage fetch, if the provider offers one. Failure is non-fatal. */
	private async enrich(
		provider: MediaProvider | undefined,
		item: MediaItem,
		signal: AbortSignal,
	): Promise<MediaItem> {
		if (!provider || !isDetailable(provider)) return item;
		try {
			return await provider.details(item.ref, { signal, previous: item });
		} catch (err) {
			// The search result alone is still enough to make a useful note.
			console.warn("Scout: detail fetch failed, using search result", err);
			return item;
		}
	}

	private async resolveTemplate(
		kind: MediaItem["ref"]["kind"],
		templatePath: string,
	): Promise<string> {
		if (!templatePath) return defaultTemplateFor(kind);

		const file = this.app.vault.getAbstractFileByPath(
			normalizePath(templatePath),
		);
		if (!(file instanceof TFile)) {
			new Notice(
				`Template "${templatePath}" not found — using the built-in template.`,
			);
			return defaultTemplateFor(kind);
		}
		return this.app.vault.cachedRead(file);
	}
}
