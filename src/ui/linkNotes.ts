import { Notice } from "obsidian";
import type { ScoutContext } from "../core/context";
import { linkEntriesToSources } from "../core/library/link";
import { confirmModal } from "./confirm";

/**
 * The "find missing source ids" flow.
 *
 * Lives apart from the command that runs it because settings offers the same
 * thing: the command palette is not where somebody wondering why their old
 * notes are not matching search results goes looking.
 */
export async function findMissingSourceIds(ctx: ScoutContext): Promise<void> {
	const pending = ctx.library.all().filter((entry) => !entry.ref);
	if (pending.length === 0) {
		new Notice("Every note in your library already has a source id.");
		return;
	}

	const ok = await confirmModal(ctx.app, {
		title: "Find source ids",
		body:
			`${pending.length} ${pending.length === 1 ? "note has" : "notes have"} no source id. ` +
			"Scout will search your enabled sources for each one and write the id into the note where the match is certain — an exact title, and the same year when the note records one. " +
			"Anything two works could equally be is left alone, and named in the developer console.",
		confirmText: "Search and link",
	});
	if (!ok) return;

	const controller = new AbortController();
	const notice = new Notice(`Linking 0 of ${pending.length}…`, 0);
	try {
		const report = await linkEntriesToSources(
			ctx,
			controller.signal,
			(done, total) => notice.setMessage(`Linking ${done} of ${total}…`),
		);
		notice.hide();
		new Notice(
			report.skipped > 0
				? `Linked ${report.linked} of ${report.total}. ${report.skipped} had no certain match and were left alone.`
				: `Linked all ${report.linked} notes to their sources.`,
			8000,
		);
	} catch (err) {
		notice.hide();
		new Notice(
			`Linking stopped: ${
				err instanceof Error ? err.message : "unknown error"
			}`,
		);
	}
}
