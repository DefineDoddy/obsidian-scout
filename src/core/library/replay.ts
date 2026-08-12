import { statusWithTone, type LibraryConfig } from "./config";
import type { LibraryEntry } from "./entry";

/**
 * Going through something a second time.
 *
 * Two dates cannot describe a film you have seen three times, and the obvious
 * fixes are both bad: overwriting them loses the first viewing, and a row of
 * date pairs turns a small panel into a spreadsheet.
 *
 * So the note keeps one pair of dates — the run you are on — and a plain list
 * of the dates you finished on before. Nothing that already reads `finished`
 * has to know this exists, `history` is legible in the note and queryable from
 * Dataview, and the count is simply how many dates there are.
 *
 * Pure, so the whole rearrangement can be checked without a vault.
 */

/** How many times through you are, counting the run in progress. */
export function timesFinished(entry: LibraryEntry): number {
	return entry.history.length + (entry.finished ? 1 : 0);
}

/**
 * The frontmatter to write when starting something again.
 *
 * The finish date moves into the history, the dates reset to a run beginning
 * today, and the status goes back to whatever this kind calls "started". The
 * counters that describe *this* run — progress, and how far into a series you
 * are — start over with it; the history is what remembers that you got to the
 * end once already.
 */
export function replayPatch(
	config: LibraryConfig,
	entry: LibraryEntry,
	today: string,
): Record<string, unknown> {
	const fields = config.fields;

	const history = [...entry.history];
	// Only a date that is actually recorded, and only once: pressing this twice
	// in a row should not stack up two of the same day.
	if (entry.finished && !history.includes(entry.finished)) {
		history.push(entry.finished);
	}

	const patch: Record<string, unknown> = {
		[fields.history]: history.length > 0 ? history : null,
		[fields.started]: today,
		[fields.finished]: null,
		[fields.progress]: null,
		[fields.episode]: null,
	};

	const started = statusWithTone(config, entry.kind, "active");
	if (started) patch[fields.status] = started;

	return patch;
}
