import { Notice } from "obsidian";
import type { ScoutContext } from "../core/context";
import { dueEntries, refreshable } from "../core/library/refresh";
import { confirmModal } from "./confirm";

/**
 * The "refresh now" flow.
 *
 * Lives apart from the settings button that runs it because the command
 * palette offers the same thing, and because the interesting part — telling
 * somebody how many requests they are about to make before they make them — is
 * the same either way.
 */

export interface RefreshRequest {
	/** Every linked note, rather than only the ones that are overdue. */
	all?: boolean;
}

export async function refreshLibrary(
	ctx: ScoutContext,
	{ all = false }: RefreshRequest = {},
): Promise<void> {
	const entries = ctx.library.all();
	const config = ctx.settings.library();
	const targets = all
		? refreshable(entries)
		: dueEntries(entries, config, ctx.settings.checkLog());

	if (targets.length === 0) {
		const linked = refreshable(entries).length;
		new Notice(
			linked === 0
				? "No note in your library records which source it came from, so there is nothing to refresh. Try “Find missing ids” above."
				: "Everything is up to date.",
		);
		return;
	}

	// One request per note is the whole cost, and it is worth saying out loud
	// before somebody points this at two thousand notes on a metered key.
	const ok = await confirmModal(ctx.app, {
		title: all ? "Refresh everything" : "Refresh what is due",
		body:
			`Scout will ask their sources about ${targets.length} ${
				targets.length === 1 ? "note" : "notes"
			} — one request each, a quarter of a second apart. ` +
			"Only facts the source owns are written: scores, dates, genres, runtimes, episode counts. " +
			"Your ratings, statuses, dates, progress, and thoughts are never touched.",
		confirmText: "Refresh",
	});
	if (!ok) return;

	const controller = new AbortController();
	const notice = new Notice(`Refreshing 0 of ${targets.length}…`, 0);
	try {
		const report = await ctx.refresher.refresh(
			targets,
			controller.signal,
			(done, total) => notice.setMessage(`Refreshing ${done} of ${total}…`),
		);
		notice.hide();

		if (!report) {
			new Notice("A refresh is already running.");
			return;
		}
		const parts = [`${report.updated} updated`];
		if (report.checked - report.updated > 0) {
			parts.push(`${report.checked - report.updated} already current`);
		}
		if (report.failed > 0) parts.push(`${report.failed} unreachable`);
		new Notice(`${parts.join(", ")}.`, 8000);
	} catch (err) {
		notice.hide();
		new Notice(
			`Refresh stopped: ${
				err instanceof Error ? err.message : "unknown error"
			}`,
		);
	}
}
